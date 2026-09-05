import type {Bindings} from '../../types/bindings'
import {ImageProcessingFailureMessageSchema, type ImageProcessingMessage, ImageProcessingMessageSchema} from '../../types/imageProcessing'
import {recordAdminErrorLog} from './errorLog'
import {
    deleteFinishedMediaPreviewRegenerationItems,
    failExhaustedMediaPreviewRegenerationTask,
    getMediaPreviewRegenerationItemState,
} from './mediaPreviewRegeneration'

export async function consumeImageProcessingDeadLetterQueue(
    batch: MessageBatch,
    env: Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_QUEUE'>,
    now = () => new Date(),
): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => consumeProcessingDeadLetter(message, env, now)))
}

async function consumeProcessingDeadLetter(
    message: Message,
    env: Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_QUEUE'>,
    now: () => Date,
): Promise<void> {
    try {
        const failure = ImageProcessingFailureMessageSchema.safeParse(message.body)
        const original = ImageProcessingMessageSchema.safeParse(message.body)
        const body = failure.success ? failure.data : original.success ? original.data : null

        if (!body) {
            await recordInvalidDeadLetter(env.DB, 'image-processing', message.id, now())
            message.ack()
            return
        }

        if (body.kind !== 'upload') {
            await consumeRegenerationDeadLetter(message, env, body, failure.success ? failure.data : null, now())
            return
        }

        const task = await env.DB.prepare(`SELECT job_id FROM image_processing_tasks WHERE id = ?`)
            .bind(body.taskId)
            .first<{job_id: string}>()
        const uploadFailure = failure.success && failure.data.kind === 'upload' ? failure.data : null
        const jobId = uploadFailure?.jobId ?? task?.job_id ?? null
        const errorCode = uploadFailure?.errorCode ?? 'queue_delivery_exhausted'
        const error = uploadFailure?.error ?? 'Image processing stopped after all Queue delivery retries.'
        const messageId = uploadFailure?.failureId ?? message.id
        const timestamp = now()

        await recordAdminErrorLog(env.DB, {
            source: 'image-processing',
            messageId,
            jobId,
            taskId: body.taskId,
            errorCode,
            errorMessage: error,
            now: timestamp,
        })

        // A delayed delivery can belong to an older run. The reconciler owns recovery.
        message.ack()
    } catch (error) {
        retryDeadLetter(message, 'processing_dlq_consume_failed', error)
    }
}

async function consumeRegenerationDeadLetter(
    message: Message,
    env: Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_QUEUE'>,
    body: Exclude<ImageProcessingMessage, {kind: 'upload'}>,
    failure: {errorCode: string; error: string} | null,
    now: Date,
): Promise<void> {
    const media = body.kind === 'media-regeneration'
    const description = media ? 'Media preview regeneration' : 'Thumbnail regeneration'

    if (!failure) {
        const result = await finishExhaustedRegeneration(env, body, description, now)
        if (result === 'retry') {
            message.retry({delaySeconds: 60})
            return
        }
        if (result === 'requeued') {
            message.ack()
            return
        }
    }

    await recordAdminErrorLog(env.DB, {
        source: media ? 'media-preview-regeneration' : 'image-processing',
        messageId: failure ? `${body.runId}:${body.taskId}` : message.id,
        jobId: body.runId,
        taskId: body.taskId,
        errorCode: failure?.errorCode ?? 'queue_delivery_exhausted',
        errorMessage: failure?.error ?? `${description} stopped after all Queue delivery retries.`,
        now,
    })
    message.ack()
}

async function finishExhaustedRegeneration(
    env: Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_QUEUE'>,
    body: Exclude<ImageProcessingMessage, {kind: 'upload'}>,
    description: string,
    now: Date,
): Promise<'failed' | 'inactive' | 'requeued' | 'retry'> {
    const state = await getMediaPreviewRegenerationItemState(env.DB, body.runId, body.taskId)
    if (state.jobStatus === 'running' && (state.itemStatus === 'pending' || state.itemStatus === 'processing')) {
        if (state.processingAttempts < 3) {
            await env.IMAGE_PROCESSING_QUEUE.send(body, {contentType: 'json', delaySeconds: 1})
            return 'requeued'
        }

        const failed = await failExhaustedMediaPreviewRegenerationTask(
            env.DB,
            body.taskId,
            `${description} stopped after all Queue delivery retries.`,
            now,
            3,
        )
        if (!failed) return 'retry'
        await deleteFinishedMediaPreviewRegenerationItems(env.DB, body.runId)
        return 'failed'
    }
    await deleteFinishedMediaPreviewRegenerationItems(env.DB, body.runId)
    return 'inactive'
}

async function recordInvalidDeadLetter(
    db: D1Database,
    source: 'image-processing' | 'media-preview-regeneration',
    messageId: string,
    now: Date,
): Promise<void> {
    await recordAdminErrorLog(db, {
        source,
        messageId,
        errorCode: 'invalid_dead_letter_message',
        errorMessage: 'The dead-letter queue received an invalid message.',
        now,
    })
}

function retryDeadLetter(message: Message, event: string, error: unknown): void {
    console.error(
        JSON.stringify({
            event,
            messageId: message.id,
            error: error instanceof Error && error.message ? error.message : String(error),
        }),
    )
    message.retry({delaySeconds: Math.min(60, 2 ** Math.min(6, message.attempts))})
}
