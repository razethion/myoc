import type {WorkflowStep} from 'cloudflare:workers'
import {completeAdminJobRun} from '../lib/admin/jobs'
import {
    countPngSrgbBackfillCandidates,
    emptyPngSrgbBackfillSummary,
    getPngSrgbBackfillCandidates,
    PNG_SRGB_BACKFILL_BATCH_SIZE,
    PNG_SRGB_BACKFILL_ITEMS_PER_WORKFLOW,
    type PngSrgbBackfillCandidate,
    type PngSrgbBackfillCursor,
    type PngSrgbBackfillSummary,
    parsePngSrgbBackfillSummary,
    pngSrgbBackfillErrorMessage,
    pngSrgbBackfillWorkflowInstanceId,
    tagPngSrgbCandidate,
} from '../lib/admin/pngSrgbBackfill'
import type {Bindings} from '../types/bindings'

const ITEM_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '5 minutes',
} as const

const D1_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '1 minute',
} as const

export type PngSrgbBackfillWorkflowParams = {
    kind: 'png-srgb-backfill'
    runId: string
    continuation?: {
        cursor: PngSrgbBackfillCursor
        segment: number
    }
}

export async function runPngSrgbBackfillWorkflow(
    env: Bindings,
    params: PngSrgbBackfillWorkflowParams,
    step: WorkflowStep,
): Promise<PngSrgbBackfillSummary> {
    const summary = await step.do(
        params.continuation ? 'resume PNG sRGB backfill' : 'initialize PNG sRGB backfill',
        D1_STEP_CONFIG,
        async () => {
            return params.continuation ? await readBackfillState(env.DB, params.runId) : await initializeBackfillState(env.DB, params.runId)
        },
    )

    if (!summary) {
        return emptyPngSrgbBackfillSummary()
    }

    let currentSummary = summary
    let cursor = params.continuation?.cursor ?? null
    const segment = params.continuation?.segment ?? 0
    let segmentItems = 0
    let batchNumber = 0

    while (segmentItems < PNG_SRGB_BACKFILL_ITEMS_PER_WORKFLOW) {
        batchNumber += 1
        const candidates = await step.do(`load PNG batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await getPngSrgbBackfillCandidates(env.DB, cursor)
        })

        if (candidates.length === 0) {
            await step.do('complete PNG sRGB backfill', D1_STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, currentSummary)
                return {finished: true}
            })
            return currentSummary
        }

        currentSummary = await processCandidates(env, step, candidates, currentSummary, segmentItems)

        segmentItems += candidates.length
        const lastCandidate = candidates.at(-1)

        if (lastCandidate) {
            cursor = {
                createdAt: lastCandidate.createdAt,
                mediaId: lastCandidate.mediaId,
                rating: lastCandidate.rating,
            }
        }

        currentSummary = await step.do(`save PNG batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await saveBackfillSummary(env.DB, params.runId, currentSummary)
        })

        if (candidates.length < PNG_SRGB_BACKFILL_BATCH_SIZE) {
            await step.do('complete PNG sRGB backfill', D1_STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, currentSummary)
                return {finished: true}
            })
            return currentSummary
        }
    }

    const nextSegment = segment + 1
    const continuationCursor = cursor as PngSrgbBackfillCursor
    await step.do(`start PNG continuation ${nextSegment}`, D1_STEP_CONFIG, async () => {
        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({
            id: pngSrgbBackfillWorkflowInstanceId(params.runId, nextSegment),
            params: {
                kind: 'png-srgb-backfill',
                runId: params.runId,
                continuation: {cursor: continuationCursor, segment: nextSegment},
            },
        })
        return {started: true}
    })

    return currentSummary
}

async function processCandidates(
    env: Bindings,
    step: WorkflowStep,
    candidates: PngSrgbBackfillCandidate[],
    initialSummary: PngSrgbBackfillSummary,
    offset: number,
): Promise<PngSrgbBackfillSummary> {
    let summary = initialSummary

    for (const [index, candidate] of candidates.entries()) {
        try {
            const result = await step.do(`tag PNG original ${offset + index + 1}`, ITEM_STEP_CONFIG, async () => {
                return await tagPngSrgbCandidate(env, candidate)
            })
            summary = {
                ...summary,
                processedVariants: summary.processedVariants + 1,
                retaggedVariants: summary.retaggedVariants + (result.status === 'retagged' ? 1 : 0),
                skippedVariants: summary.skippedVariants + (result.status === 'skipped' ? 1 : 0),
            }
        } catch (error) {
            summary = {
                ...summary,
                processedVariants: summary.processedVariants + 1,
                failedVariants: summary.failedVariants + 1,
                lastError: pngSrgbBackfillErrorMessage(error),
            }
        }

        summary.totalVariants = Math.max(summary.totalVariants, summary.processedVariants)
    }

    return summary
}

async function initializeBackfillState(db: D1Database, runId: string): Promise<PngSrgbBackfillSummary | null> {
    const summary = emptyPngSrgbBackfillSummary()
    summary.totalVariants = await countPngSrgbBackfillCandidates(db)
    return await saveBackfillSummary(db, runId, summary)
}

async function readBackfillState(db: D1Database, runId: string): Promise<PngSrgbBackfillSummary | null> {
    const row = await db
        .prepare(
            `SELECT summary_json
             FROM admin_job_runs
             WHERE id = ?
               AND job_name = 'png-srgb-backfill'
               AND status = 'running'`,
        )
        .bind(runId)
        .first<{summary_json: string | null}>()
    return row ? parsePngSrgbBackfillSummary(row.summary_json) : null
}

async function saveBackfillSummary(db: D1Database, runId: string, summary: PngSrgbBackfillSummary): Promise<PngSrgbBackfillSummary> {
    await db
        .prepare(
            `UPDATE admin_job_runs
             SET summary_json = ?
             WHERE id = ?
               AND job_name = 'png-srgb-backfill'
               AND status = 'running'`,
        )
        .bind(JSON.stringify(summary), runId)
        .run()
    return summary
}
