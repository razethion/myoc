import {z} from 'zod'
import type {Bindings} from '../../types/bindings'
import {MediaPreviewRegenerationMessageSchema} from '../../types/mediaPreviewQueue'
import {recordAdminErrorLog} from './errorLog'
import {
    claimMediaPreviewRegenerationTask,
    deleteFinishedMediaPreviewRegenerationItems,
    getMediaPreviewRegenerationItemState,
    recordMediaPreviewRegenerationResult,
} from './mediaPreviewRegeneration'

const ImageProcessingMessageSchema = z
    .object({
        version: z.literal(1),
        taskId: z.uuid(),
        slot: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    })
    .strict()

const ImageProcessingFailureMessageSchema = ImageProcessingMessageSchema.extend({
    failureId: z.string().min(1).max(512),
    jobId: z.uuid(),
    errorCode: z.string().min(1).max(128),
    error: z.string().min(1).max(2_000),
}).strict()

const MediaPreviewRegenerationFailureMessageSchema = MediaPreviewRegenerationMessageSchema.extend({
    error: z.string().min(1).max(2_000),
}).strict()

export async function consumeImageProcessingDeadLetterQueue(
    batch: MessageBatch,
    env: Pick<Bindings, 'DB'>,
    now = () => new Date(),
): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => consumeImageProcessingDeadLetter(message, env.DB, now)))
}

export async function consumeMediaPreviewDeadLetterQueue(
    batch: MessageBatch,
    env: Pick<Bindings, 'DB'>,
    now = () => new Date(),
): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => consumeMediaPreviewDeadLetter(message, env.DB, now)))
}

async function consumeImageProcessingDeadLetter(message: Message, db: D1Database, now: () => Date): Promise<void> {
    try {
        const failure = ImageProcessingFailureMessageSchema.safeParse(message.body)
        const original = ImageProcessingMessageSchema.safeParse(message.body)
        const body = failure.success ? failure.data : original.success ? original.data : null

        if (!body) {
            await recordInvalidDeadLetter(db, 'image-processing', message.id, now())
            message.ack()
            return
        }

        const task = await db.prepare(`SELECT job_id FROM image_processing_tasks WHERE id = ?`).bind(body.taskId).first<{job_id: string}>()
        const jobId = failure.success ? failure.data.jobId : (task?.job_id ?? null)
        const errorCode = failure.success ? failure.data.errorCode : 'queue_delivery_exhausted'
        const error = failure.success ? failure.data.error : 'Image processing stopped after all Queue delivery retries.'
        const messageId = failure.success ? failure.data.failureId : message.id
        const timestamp = now()

        await recordAdminErrorLog(db, {
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
        retryDeadLetter(message, 'image_processing_dlq_consume_failed', error)
    }
}

async function consumeMediaPreviewDeadLetter(message: Message, db: D1Database, now: () => Date): Promise<void> {
    try {
        const failure = MediaPreviewRegenerationFailureMessageSchema.safeParse(message.body)
        const original = MediaPreviewRegenerationMessageSchema.safeParse(message.body)
        const body = failure.success ? failure.data : original.success ? original.data : null

        if (!body) {
            await recordInvalidDeadLetter(db, 'media-preview-regeneration', message.id, now())
            message.ack()
            return
        }

        await recordAdminErrorLog(db, {
            source: 'media-preview-regeneration',
            messageId: failure.success ? `${body.runId}:${body.taskId}` : message.id,
            jobId: body.runId,
            taskId: body.taskId,
            errorCode: failure.success ? 'preview_generation_failed' : 'queue_delivery_exhausted',
            errorMessage: failure.success ? failure.data.error : 'Media preview regeneration stopped after all Queue delivery retries.',
            now: now(),
        })
        if (!failure.success && !(await finishExhaustedPreview(db, body.runId, body.taskId, now()))) {
            message.retry({delaySeconds: 60})
            return
        }
        message.ack()
    } catch (error) {
        retryDeadLetter(message, 'media_preview_dlq_consume_failed', error)
    }
}

async function finishExhaustedPreview(db: D1Database, runId: string, taskId: string, now: Date): Promise<boolean> {
    const state = await getMediaPreviewRegenerationItemState(db, runId, taskId)
    if (state.jobStatus === 'running' && (state.itemStatus === 'pending' || state.itemStatus === 'processing')) {
        const claimed = await claimMediaPreviewRegenerationTask(db, taskId, now)
        if (!claimed) return false
        await recordMediaPreviewRegenerationResult(db, taskId, claimed.leaseId, {
            status: 'failed',
            regeneratedBlur: false,
            error: 'Media preview regeneration stopped after all Queue delivery retries.',
        })
    }
    await deleteFinishedMediaPreviewRegenerationItems(db, runId)
    return true
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
