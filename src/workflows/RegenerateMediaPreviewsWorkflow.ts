import {WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers'
import {completeAdminJobRun, failAdminJobRun, updateAdminJobRunSummary} from '../lib/admin/jobs'
import {
    applyMediaPreviewRegenerationResults,
    getMediaPreviewRegenerationCandidates,
    initializeMediaPreviewRegenerationSummary,
    type MediaPreviewRegenerationCursor,
    type MediaPreviewRegenerationResult,
    regenerateMediaPreviewCandidate,
} from '../lib/admin/mediaPreviewRegeneration'
import type {Bindings} from '../types/bindings'

export type RegenerateMediaPreviewsWorkflowParams = {
    runId: string
}

const MEDIA_STEP_CONFIG = {
    retries: {
        limit: 3,
        delay: '10 seconds',
        backoff: 'exponential',
    },
    timeout: '10 minutes',
} as const

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
            return await this.runRegeneration(event.payload.runId, step)
        } catch (error) {
            const message = errorMessage(error)

            await step.do('record job failure', D1_STEP_CONFIG, async () => {
                await failAdminJobRun(this.env.DB, event.payload.runId, message)
                return {recorded: true}
            })

            throw error
        }
    }

    private async runRegeneration(runId: string, step: WorkflowStep) {
        let summary = await step.do('initialize job', D1_STEP_CONFIG, async () => {
            const initial = await initializeMediaPreviewRegenerationSummary(this.env.DB)
            await updateAdminJobRunSummary(this.env.DB, runId, initial)
            return initial
        })
        let cursor: MediaPreviewRegenerationCursor | null = null
        let batchNumber = 1

        while (true) {
            const candidates = await step.do(`load batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
                return await getMediaPreviewRegenerationCandidates(this.env.DB, cursor)
            })

            if (candidates.length === 0) {
                break
            }

            const results: MediaPreviewRegenerationResult[] = []

            for (const [index, candidate] of candidates.entries()) {
                try {
                    results.push(
                        await step.do(`regenerate batch ${batchNumber} item ${index + 1}`, MEDIA_STEP_CONFIG, async () => {
                            return await regenerateMediaPreviewCandidate(this.env, candidate)
                        }),
                    )
                } catch (error) {
                    results.push({
                        status: 'failed',
                        regeneratedBlur: false,
                        error: errorMessage(error),
                    })
                }

                cursor = {
                    mediaId: candidate.mediaId,
                    ratingOrder: candidate.ratingOrder,
                }
            }

            summary = applyMediaPreviewRegenerationResults(summary, results)
            await step.do(`record batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
                await updateAdminJobRunSummary(this.env.DB, runId, summary)
                return summary
            })

            batchNumber += 1
        }

        await step.do('complete job', D1_STEP_CONFIG, async () => {
            await completeAdminJobRun(this.env.DB, runId, summary)
            return summary
        })

        return summary
    }
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
