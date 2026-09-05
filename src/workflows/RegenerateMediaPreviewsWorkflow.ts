import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers'
import {failAdminJobRun} from '../lib/admin/jobs'
import {
    completeMediaPreviewRegenerationDispatch,
    deleteFinishedMediaPreviewRegenerationItems,
    enqueueMediaPreviewRegenerationCandidates,
    getMediaPreviewRegenerationCandidates,
    initializeMediaPreviewRegenerationDispatch,
    MEDIA_PREVIEW_REGENERATION_BATCH_SIZE,
    MEDIA_PREVIEW_REGENERATION_BATCHES_PER_WORKFLOW,
    type MediaPreviewRegenerationCursor,
    mediaPreviewRegenerationWorkflowInstanceId,
} from '../lib/admin/mediaPreviewRegeneration'
import type {Bindings} from '../types/bindings'
import {runThumbnailRegenerationWorkflow, type ThumbnailRegenerationWorkflowParams} from './thumbnailRegeneration'

type MediaPreviewRegenerationWorkflowParams = {
    kind?: 'media-previews'
    runId: string
    continuation?: {
        cursor: MediaPreviewRegenerationCursor
        nextContainerSlot: 0 | 1 | 2
        queuedVariants: number
        segment: number
    }
}

export type RegenerateMediaPreviewsWorkflowParams = MediaPreviewRegenerationWorkflowParams | ThumbnailRegenerationWorkflowParams

const D1_STEP_CONFIG = {
    retries: {
        limit: 5,
        delay: '5 seconds',
        backoff: 'exponential',
    },
    timeout: '1 minute',
} as const

export class RegenerateMediaPreviewsWorkflow extends WorkflowEntrypoint<Bindings, RegenerateMediaPreviewsWorkflowParams> {
    override async run(event: Readonly<WorkflowEvent<RegenerateMediaPreviewsWorkflowParams>>, step: WorkflowStep) {
        try {
            if (event.payload.kind === 'thumbnails') {
                return await runThumbnailRegenerationWorkflow(this.env, event.payload, step)
            }

            return await this.dispatchRegeneration(event.payload, step)
        } catch (error) {
            const message = errorMessage(error)

            await step.do('record job failure', D1_STEP_CONFIG, async () => {
                await failAdminJobRun(this.env.DB, event.payload.runId, message)
                if (event.payload.kind !== 'thumbnails') {
                    await deleteFinishedMediaPreviewRegenerationItems(this.env.DB, event.payload.runId)
                }
                return {recorded: true}
            })

            throw error
        }
    }

    private async dispatchRegeneration(params: MediaPreviewRegenerationWorkflowParams, step: WorkflowStep) {
        const {continuation, runId} = params

        if (!continuation) {
            await step.do('initialize job', D1_STEP_CONFIG, async () => {
                return await initializeMediaPreviewRegenerationDispatch(this.env.DB, runId)
            })
        }

        let cursor: MediaPreviewRegenerationCursor | null = continuation?.cursor ?? null
        let nextContainerSlot = continuation?.nextContainerSlot ?? 0
        let queuedVariants = continuation?.queuedVariants ?? 0
        const segment = continuation?.segment ?? 0

        for (let batchNumber = 1; batchNumber <= MEDIA_PREVIEW_REGENERATION_BATCHES_PER_WORKFLOW; batchNumber += 1) {
            const candidates = await step.do(`load batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
                return await getMediaPreviewRegenerationCandidates(this.env.DB, cursor)
            })

            if (candidates.length === 0) {
                await step.do('finish queue dispatch', D1_STEP_CONFIG, async () => {
                    await completeMediaPreviewRegenerationDispatch(this.env.DB, runId)
                    return {queuedVariants}
                })

                return {queuedVariants}
            }

            const lastCandidate = candidates.at(-1)

            /* istanbul ignore if -- a nonempty candidate batch always has a last item. */
            if (!lastCandidate) {
                throw new Error('Media preview candidate batch is empty')
            }

            const dispatch = await step.do(`queue batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
                const followingContainerSlot = await enqueueMediaPreviewRegenerationCandidates(
                    this.env.DB,
                    this.env,
                    runId,
                    candidates,
                    nextContainerSlot,
                )
                return {
                    cursor: {
                        mediaId: lastCandidate.mediaId,
                        ratingOrder: lastCandidate.ratingOrder,
                    },
                    nextContainerSlot: followingContainerSlot,
                    queuedVariants: queuedVariants + candidates.length,
                }
            })
            cursor = dispatch.cursor
            nextContainerSlot = dispatch.nextContainerSlot
            queuedVariants = dispatch.queuedVariants

            if (candidates.length < MEDIA_PREVIEW_REGENERATION_BATCH_SIZE) {
                await step.do('finish queue dispatch', D1_STEP_CONFIG, async () => {
                    await completeMediaPreviewRegenerationDispatch(this.env.DB, runId)
                    return {queuedVariants}
                })

                return {queuedVariants}
            }
        }

        const nextSegment = segment + 1
        const continuationCursor = cursor as MediaPreviewRegenerationCursor
        await step.do(`start continuation ${nextSegment}`, D1_STEP_CONFIG, async () => {
            await this.env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.createBatch([
                {
                    id: mediaPreviewRegenerationWorkflowInstanceId(runId, nextSegment),
                    params: {
                        runId,
                        continuation: {
                            cursor: continuationCursor,
                            nextContainerSlot,
                            queuedVariants,
                            segment: nextSegment,
                        },
                    },
                },
            ])
            return {started: true}
        })

        return {queuedVariants}
    }
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
