import type {WorkflowStep} from 'cloudflare:workers'
import {
    emptyMediaPreviewRegenerationSummary,
    type MediaPreviewRegenerationSummary,
    mediaPreviewRegenerationWorkflowInstanceId,
} from '../lib/admin/mediaPreviewRegeneration'
import {
    countThumbnailCandidates,
    getThumbnailCandidates,
    regenerateThumbnail,
    type ThumbnailCandidate,
    type ThumbnailCursor,
} from '../lib/admin/thumbnailRegeneration'
import {toSqlTimestamp} from '../lib/auth/session'
import type {Bindings} from '../types/bindings'

const THUMBNAIL_BATCH_SIZE = 25
const THUMBNAILS_PER_WORKFLOW_SEGMENT = 250

const D1_STEP_CONFIG = {
    retries: {
        limit: 5,
        delay: '5 seconds',
        backoff: 'exponential',
    },
    timeout: '1 minute',
} as const

const THUMBNAIL_STEP_CONFIG = {
    retries: {
        limit: 2,
        delay: '10 seconds',
        backoff: 'exponential',
    },
    timeout: '5 minutes',
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
            return params.continuation
                ? await readThumbnailJobState(env.DB, params.runId)
                : await initializeThumbnailJob(env.DB, params.runId)
        },
    )

    if (!initialState.active) {
        return initialState.summary
    }

    let summary = initialState.summary
    let cursor: ThumbnailCursor | null = params.continuation?.cursor ?? null
    const segment = params.continuation?.segment ?? 0
    let processedInSegment = 0

    for (let batchNumber = 1; processedInSegment < THUMBNAILS_PER_WORKFLOW_SEGMENT; batchNumber += 1) {
        const candidates = await step.do(`load thumbnail batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await getThumbnailCandidates(env.DB, cursor, THUMBNAIL_BATCH_SIZE)
        })

        if (candidates.length === 0) {
            await step.do('finish thumbnail job', D1_STEP_CONFIG, async () => {
                await finishThumbnailJob(env.DB, params.runId, summary)
                return {finished: true}
            })
            return summary
        }

        for (const candidate of candidates) {
            const itemNumber = processedInSegment + 1
            const processed = await processThumbnailCandidate(env, params.runId, candidate, itemNumber, summary, step)

            if (!processed.active) {
                return processed.summary
            }

            summary = processed.summary
            processedInSegment += 1
        }

        const lastCandidate = requireLastCandidate(candidates)
        cursor = {kind: lastCandidate.kind, targetId: lastCandidate.targetId}

        if (candidates.length < THUMBNAIL_BATCH_SIZE) {
            await step.do('finish thumbnail job', D1_STEP_CONFIG, async () => {
                await finishThumbnailJob(env.DB, params.runId, summary)
                return {finished: true}
            })
            return summary
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

    return summary
}

function requireLastCandidate(candidates: ThumbnailCandidate[]): ThumbnailCandidate {
    const candidate = candidates.at(-1)

    /* istanbul ignore if -- callers only pass a nonempty candidate batch. */
    if (!candidate) {
        throw new Error('Thumbnail candidate batch is empty')
    }

    return candidate
}

async function processThumbnailCandidate(
    env: Bindings,
    runId: string,
    candidate: ThumbnailCandidate,
    itemNumber: number,
    currentSummary: MediaPreviewRegenerationSummary,
    step: WorkflowStep,
): Promise<{active: boolean; summary: MediaPreviewRegenerationSummary}> {
    let summary: MediaPreviewRegenerationSummary

    try {
        const processing = await step.do(`regenerate thumbnail ${itemNumber}`, THUMBNAIL_STEP_CONFIG, async () => {
            if (!(await isThumbnailJobRunning(env.DB, runId))) {
                return {active: false as const, result: null}
            }

            return {active: true as const, result: await regenerateThumbnail(env, candidate)}
        })

        if (!processing.active) {
            return {active: false, summary: currentSummary}
        }

        summary = {
            ...currentSummary,
            processedVariants: currentSummary.processedVariants + 1,
            regeneratedPreviews: currentSummary.regeneratedPreviews + Number(processing.result.status === 'regenerated'),
            skippedVariants: currentSummary.skippedVariants + Number(processing.result.status === 'skipped'),
        }
    } catch (error) {
        summary = {
            ...currentSummary,
            processedVariants: currentSummary.processedVariants + 1,
            failedVariants: currentSummary.failedVariants + 1,
            lastError: errorMessage(error),
        }
    }

    const active = await step.do(`record thumbnail result ${itemNumber}`, D1_STEP_CONFIG, async () => {
        return await updateThumbnailJobSummary(env.DB, runId, summary)
    })
    return {active, summary}
}

async function initializeThumbnailJob(db: D1Database, runId: string): Promise<{active: boolean; summary: MediaPreviewRegenerationSummary}> {
    const summary = {
        ...emptyMediaPreviewRegenerationSummary(),
        totalVariants: await countThumbnailCandidates(db),
    }
    const result = await db
        .prepare(
            `UPDATE admin_job_runs
             SET summary_json = ?
             WHERE id = ?
               AND job_name = 'thumbnail-regeneration'
               AND status = 'running'`,
        )
        .bind(JSON.stringify(summary), runId)
        .run()

    return {active: Number(result.meta.changes) > 0, summary}
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

    return {
        active: row?.status === 'running',
        summary: parseSummary(row?.summary_json ?? null),
    }
}

async function updateThumbnailJobSummary(db: D1Database, runId: string, summary: MediaPreviewRegenerationSummary): Promise<boolean> {
    const result = await db
        .prepare(
            `UPDATE admin_job_runs
             SET summary_json = ?
             WHERE id = ?
               AND job_name = 'thumbnail-regeneration'
               AND status = 'running'`,
        )
        .bind(JSON.stringify(summary), runId)
        .run()

    return Number(result.meta.changes) > 0
}

async function finishThumbnailJob(db: D1Database, runId: string, summary: MediaPreviewRegenerationSummary): Promise<void> {
    const finishedAt = toSqlTimestamp(new Date())
    await db
        .prepare(
            `UPDATE admin_job_runs
             SET status = 'success',
                 finished_at = ?,
                 duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
                 summary_json = ?,
                 error_message = NULL
             WHERE id = ?
               AND job_name = 'thumbnail-regeneration'
               AND status = 'running'`,
        )
        .bind(finishedAt, finishedAt, JSON.stringify(summary), runId)
        .run()
}

async function isThumbnailJobRunning(db: D1Database, runId: string): Promise<boolean> {
    const running = await db
        .prepare(
            `SELECT EXISTS(
                 SELECT 1
                 FROM admin_job_runs
                 WHERE id = ?
                   AND job_name = 'thumbnail-regeneration'
                   AND status = 'running'
             ) AS running`,
        )
        .bind(runId)
        .first<number>('running')

    return Number(running) === 1
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

    return emptyMediaPreviewRegenerationSummary()
}

function errorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
