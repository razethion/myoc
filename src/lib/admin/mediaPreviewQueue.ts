import {z} from 'zod'
import type {Bindings} from '../../types/bindings'
import {
    type MediaPreviewRegenerationCandidate,
    type MediaPreviewRegenerationFailureMessage,
    type MediaPreviewRegenerationMessage,
    MediaPreviewRegenerationMessageSchema,
} from '../../types/mediaPreviewQueue'
import {
    claimMediaPreviewRegenerationTask,
    deleteFinishedMediaPreviewRegenerationItems,
    getMediaPreviewRegenerationItemState,
    recordMediaPreviewRegenerationAttemptError,
    recordMediaPreviewRegenerationResult,
    regenerateMediaPreviewCandidate,
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

export async function consumeMediaPreviewRegenerationQueue(batch: MessageBatch, env: Bindings, now = () => new Date()): Promise<void> {
    await Promise.all(batch.messages.map(async (message) => consumeMessage(message, env, now)))
}

async function consumeMessage(message: Message, env: Bindings, now: () => Date): Promise<void> {
    const parsedMessage = MediaPreviewRegenerationMessageSchema.safeParse(message.body)

    if (!parsedMessage.success) {
        console.error('Discarded an invalid media preview regeneration message', {
            messageId: message.id,
        })
        message.ack()
        return
    }

    const body = parsedMessage.data satisfies MediaPreviewRegenerationMessage

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
                containerIndex: claimed.containerSlot,
                maxContainerAttempts: 1,
            })
            await recordMediaPreviewRegenerationResult(env.DB, body.taskId, claimed.leaseId, result)
            await deleteFinishedMediaPreviewRegenerationItems(env.DB, claimed.runId)
            message.ack()
        } catch (error) {
            const failure = errorMessage(error)

            if (message.attempts >= MEDIA_PREVIEW_REGENERATION_MAX_ATTEMPTS) {
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
    env: Pick<Bindings, 'MEDIA_PREVIEW_REGENERATION_DLQ'>,
    body: MediaPreviewRegenerationMessage,
    failure: string,
): Promise<void> {
    await env.MEDIA_PREVIEW_REGENERATION_DLQ.send({
        ...body,
        error: failure.slice(0, 2_000),
    } satisfies MediaPreviewRegenerationFailureMessage)
}

function retryDelaySeconds(attempts: number): number {
    return Math.min(60, 2 ** Math.min(6, Math.max(0, attempts - 1)))
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
