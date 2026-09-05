import type {WorkflowStep} from 'cloudflare:workers'
import {
    completeMediaPreviewRegenerationDispatch,
    type MediaPreviewRegenerationSummary,
    mediaPreviewRegenerationWorkflowInstanceId,
} from '../lib/admin/mediaPreviewRegeneration'
import {
    countThumbnailCandidates,
    enqueueThumbnailRegenerationCandidates,
    getThumbnailCandidates,
    initializeThumbnailRegenerationDispatch,
    type ThumbnailCandidate,
    type ThumbnailCursor,
} from '../lib/admin/thumbnailRegeneration'
import type {Bindings} from '../types/bindings'

const THUMBNAIL_BATCH_SIZE = 25
const THUMBNAIL_BATCHES_PER_WORKFLOW = 10

const D1_STEP_CONFIG = {
    retries: {
        limit: 5,
        delay: '5 seconds',
        backoff: 'exponential',
    },
    timeout: '1 minute',
} as const

type ThumbnailRegenerationContinuation = {
    cursor: ThumbnailCursor
    segment: number
}

export type ThumbnailRegenerationWorkflowParams = {
    kind: 'thumbnails'
    runId: string
    continuation?: ThumbnailRegenerationContinuation
}

export async function runThumbnailRegenerationWorkflow(
    env: Bindings,
    params: ThumbnailRegenerationWorkflowParams,
    step: WorkflowStep,
): Promise<MediaPreviewRegenerationSummary> {
    const initialState = await step.do(
        params.continuation ? 'resume thumbnail job' : 'initialize thumbnail job',
        D1_STEP_CONFIG,
        async () => {
            if (params.continuation) {
                return await readThumbnailJobState(env.DB, params.runId)
            }

            const totalVariants = await countThumbnailCandidates(env.DB)
            return await initializeThumbnailRegenerationDispatch(env.DB, params.runId, totalVariants)
        },
    )

    if (!initialState.active) {
        return initialState.summary
    }

    let cursor: ThumbnailCursor | null = params.continuation?.cursor ?? null
    const segment = params.continuation?.segment ?? 0

    for (let batchNumber = 1; batchNumber <= THUMBNAIL_BATCHES_PER_WORKFLOW; batchNumber += 1) {
        const candidates = await step.do(`load thumbnail batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await getThumbnailCandidates(env.DB, cursor, THUMBNAIL_BATCH_SIZE)
        })

        if (candidates.length === 0) {
            await finishThumbnailDispatch(env.DB, params.runId, step)
            return initialState.summary
        }

        const lastCandidate = requireLastCandidate(candidates)
        const dispatch = await step.do(`queue thumbnail batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            const active = await enqueueThumbnailRegenerationCandidates(env.DB, env, params.runId, candidates)
            return {
                active,
                cursor: {kind: lastCandidate.kind, targetId: lastCandidate.targetId},
            }
        })

        if (!dispatch.active) {
            return initialState.summary
        }

        cursor = dispatch.cursor

        if (candidates.length < THUMBNAIL_BATCH_SIZE) {
            await finishThumbnailDispatch(env.DB, params.runId, step)
            return initialState.summary
        }
    }

    const nextSegment = segment + 1
    const continuationCursor = cursor as ThumbnailCursor
    await step.do(`start thumbnail continuation ${nextSegment}`, D1_STEP_CONFIG, async () => {
        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.createBatch([
            {
                id: mediaPreviewRegenerationWorkflowInstanceId(params.runId, nextSegment),
                params: {
                    kind: 'thumbnails',
                    runId: params.runId,
                    continuation: {
                        cursor: continuationCursor,
                        segment: nextSegment,
                    },
                },
            },
        ])
        return {started: true}
    })

    return initialState.summary
}

function requireLastCandidate(candidates: ThumbnailCandidate[]): ThumbnailCandidate {
    const candidate = candidates.at(-1)

    /* istanbul ignore if -- callers only pass a nonempty candidate batch. */
    if (!candidate) {
        throw new Error('Thumbnail candidate batch is empty')
    }

    return candidate
}

async function finishThumbnailDispatch(db: D1Database, runId: string, step: WorkflowStep): Promise<void> {
    await step.do('finish thumbnail queue dispatch', D1_STEP_CONFIG, async () => {
        await completeMediaPreviewRegenerationDispatch(db, runId)
        return {finished: true}
    })
}

async function readThumbnailJobState(db: D1Database, runId: string): Promise<{active: boolean; summary: MediaPreviewRegenerationSummary}> {
    const row = await db
        .prepare(
            `SELECT status, summary_json
             FROM admin_job_runs
             WHERE id = ?
               AND job_name = 'thumbnail-regeneration'`,
        )
        .bind(runId)
        .first<{status: string; summary_json: string | null}>()

    const active = row?.status === 'running'
    const summary = parseSummary(row?.summary_json ?? null)

    if (active) {
        await db.batch([
            db
                .prepare(
                    `INSERT INTO media_preview_regeneration_runs (run_id, dispatch_complete, enqueued_items)
                     VALUES (?, 0, 0)
                     ON CONFLICT(run_id) DO NOTHING`,
                )
                .bind(runId),
            db
                .prepare(
                    `UPDATE admin_job_runs
                     SET summary_json = ?
                     WHERE id = ?
                       AND job_name = 'thumbnail-regeneration'
                       AND status = 'running'`,
                )
                .bind(JSON.stringify(summary), runId),
        ])
    }

    return {active, summary}
}

function parseSummary(value: string | null): MediaPreviewRegenerationSummary {
    if (value) {
        try {
            const parsed = JSON.parse(value) as MediaPreviewRegenerationSummary
            if ('totalVariants' in parsed && 'processedVariants' in parsed) {
                return parsed
            }
        } catch {
            // Use an empty summary if the stored job data is invalid.
        }
    }

    return {
        totalVariants: 0,
        processedVariants: 0,
        regeneratedPreviews: 0,
        regeneratedBlurs: 0,
        skippedVariants: 0,
        failedVariants: 0,
        lastError: null,
    }
}
