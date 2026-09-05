import {z} from 'zod'
import type {Bindings} from '../../types/bindings'
import type {
    MediaPreviewRegenerationCandidate,
    MediaPreviewRegenerationFailureMessage,
    MediaPreviewRegenerationMessage,
} from '../../types/mediaPreviewQueue'
import {PreviewContainerBusyError} from '../media/previewGeneration'
import {imageProcessingErrorMessage as errorMessage, imageProcessingRetryDelaySeconds as retryDelaySeconds} from '../media/queueErrors'
import {
    claimMediaPreviewRegenerationTask,
    deleteFinishedMediaPreviewRegenerationItems,
    getMediaPreviewRegenerationItemState,
    recordMediaPreviewRegenerationAttemptError,
    recordMediaPreviewRegenerationResult,
    regenerateMediaPreviewCandidate,
    releaseMediaPreviewRegenerationCapacityLease,
} from './mediaPreviewRegeneration'

const MEDIA_PREVIEW_REGENERATION_MAX_ATTEMPTS = 3

const MediaPreviewRegenerationCandidateSchema = z
    .object({
        mediaId: z.string().min(1),
        userId: z.string().min(1),
        characterId: z.string().min(1),
        rating: z.enum(['sfw', 'nsfw']),
        ratingOrder: z.number().int().min(0).max(1),
        imageKey: z.string().min(1),
        storedImageContentType: z.string().nullable(),
        imageContentType: z.string().min(1),
        previousPreviewKey: z.string().nullable(),
        previousPreviewContentType: z.string().min(1),
        previousBlurKey: z.string().nullable(),
        previousBlurContentType: z.string().min(1),
        targetPreviewKey: z.string().min(1),
        targetBlurKey: z.string().nullable(),
    })
    .strict()

export async function consumeMediaPreviewRegenerationMessage(
    message: Message,
    body: MediaPreviewRegenerationMessage,
    env: Bindings,
    now: () => Date,
): Promise<void> {
    try {
        const claimed = await claimMediaPreviewRegenerationTask(env.DB, body.taskId, now())

        if (!claimed) {
            await handleUnclaimedMessage(message, env, body, now())
            return
        }

        let candidate: MediaPreviewRegenerationCandidate

        try {
            candidate = MediaPreviewRegenerationCandidateSchema.parse(JSON.parse(claimed.candidateJson))
        } catch {
            await finishFailedMessage(message, env, body, claimed.leaseId, 'Stored media preview task data is invalid')
            return
        }

        try {
            const result = await regenerateMediaPreviewCandidate(env, candidate, {
                maxContainerAttempts: 1,
            })
            await recordMediaPreviewRegenerationResult(env.DB, body.taskId, claimed.leaseId, result)
            await deleteFinishedMediaPreviewRegenerationItems(env.DB, claimed.runId)
            message.ack()
        } catch (error) {
            const failure = errorMessage(error)

            if (error instanceof PreviewContainerBusyError) {
                await releaseMediaPreviewRegenerationCapacityLease(env.DB, body.taskId, claimed.leaseId)
                await env.IMAGE_PROCESSING_QUEUE.send(body, {contentType: 'json', delaySeconds: 1})
                message.ack()
                return
            }

            if (claimed.processingAttempts >= MEDIA_PREVIEW_REGENERATION_MAX_ATTEMPTS) {
                await finishFailedMessage(message, env, body, claimed.leaseId, failure)
                return
            }

            await recordMediaPreviewRegenerationAttemptError(env.DB, body.taskId, claimed.leaseId, failure)
            message.retry({delaySeconds: retryDelaySeconds(message.attempts)})
        }
    } catch (error) {
        console.error('Media preview queue handling failed', {
            error: errorMessage(error),
            messageId: message.id,
            taskId: body.taskId,
        })
        message.retry({delaySeconds: retryDelaySeconds(message.attempts)})
    }
}

async function handleUnclaimedMessage(message: Message, env: Bindings, body: MediaPreviewRegenerationMessage, now: Date): Promise<void> {
    const state = await getMediaPreviewRegenerationItemState(env.DB, body.runId, body.taskId)

    if (state.jobStatus !== 'running' || (state.itemStatus !== 'pending' && state.itemStatus !== 'processing')) {
        await deleteFinishedMediaPreviewRegenerationItems(env.DB, body.runId)
        message.ack()
        return
    }

    const leaseDelay = state.leaseExpiresAt
        ? Math.ceil((Date.parse(`${state.leaseExpiresAt.replace(' ', 'T')}Z`) - now.getTime()) / 1_000)
        : 1
    message.retry({delaySeconds: Math.max(1, Math.min(120, leaseDelay))})
}

async function finishFailedMessage(
    message: Message,
    env: Bindings,
    body: MediaPreviewRegenerationMessage,
    leaseId: string,
    failure: string,
): Promise<void> {
    await sendToDeadLetterQueue(env, body, failure)
    await recordMediaPreviewRegenerationResult(env.DB, body.taskId, leaseId, {
        status: 'failed',
        regeneratedBlur: false,
        error: failure,
    })
    await deleteFinishedMediaPreviewRegenerationItems(env.DB, body.runId)
    message.ack()
}

async function sendToDeadLetterQueue(
    env: Pick<Bindings, 'IMAGE_PROCESSING_DLQ'>,
    body: MediaPreviewRegenerationMessage,
    failure: string,
): Promise<void> {
    await env.IMAGE_PROCESSING_DLQ.send({
        ...body,
        errorCode: 'preview_generation_failed',
        error: failure.slice(0, 2_000),
    } satisfies MediaPreviewRegenerationFailureMessage)
}
