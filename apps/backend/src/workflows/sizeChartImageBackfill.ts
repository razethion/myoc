import type {WorkflowStep} from 'cloudflare:workers'
import {completeAdminJobRun} from '../lib/admin/jobs'
import {
    countSizeChartImageBackfillCandidates,
    emptySizeChartImageBackfillSummary,
    getSizeChartImageBackfillCandidates,
    parseSizeChartImageBackfillSummary,
    replaceSizeChartImage,
    SIZE_CHART_IMAGE_BACKFILL_BATCH_SIZE,
    SIZE_CHART_IMAGE_BACKFILL_ITEMS_PER_WORKFLOW,
    type SizeChartImageBackfillCandidate,
    type SizeChartImageBackfillSummary,
    sizeChartImageBackfillErrorMessage,
    sizeChartImageBackfillWorkflowInstanceId,
} from '../lib/admin/sizeChartImageBackfill'
import type {Bindings} from '../types/bindings'

const ITEM_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '5 minutes',
} as const

const D1_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '1 minute',
} as const

export type SizeChartImageBackfillWorkflowParams = {
    kind: 'size-chart-images'
    runId: string
    continuation?: {
        cursor: string
        segment: number
    }
}

export async function runSizeChartImageBackfillWorkflow(
    env: Bindings,
    params: SizeChartImageBackfillWorkflowParams,
    step: WorkflowStep,
): Promise<SizeChartImageBackfillSummary> {
    const summary = await step.do(
        params.continuation ? 'resume size chart image backfill' : 'initialize size chart image backfill',
        D1_STEP_CONFIG,
        async () => {
            return params.continuation ? await readBackfillState(env.DB, params.runId) : await initializeBackfillState(env.DB, params.runId)
        },
    )

    if (!summary) {
        return emptySizeChartImageBackfillSummary()
    }
    let currentSummary = summary

    let cursor = params.continuation?.cursor ?? null
    const segment = params.continuation?.segment ?? 0
    let segmentItems = 0
    let batchNumber = 0

    while (segmentItems < SIZE_CHART_IMAGE_BACKFILL_ITEMS_PER_WORKFLOW) {
        batchNumber += 1
        const candidates = await step.do(`load size chart batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await getSizeChartImageBackfillCandidates(env.DB, cursor)
        })

        if (candidates.length === 0) {
            await step.do('complete size chart image backfill', D1_STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, currentSummary)
                return {finished: true}
            })
            return currentSummary
        }

        currentSummary = await processCandidates(env, step, candidates, currentSummary, segmentItems)

        segmentItems += candidates.length
        cursor = candidates.at(-1)?.characterId ?? cursor
        currentSummary = await step.do(`save size chart batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await saveBackfillSummary(env.DB, params.runId, currentSummary)
        })

        if (candidates.length < SIZE_CHART_IMAGE_BACKFILL_BATCH_SIZE) {
            await step.do('complete size chart image backfill', D1_STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, currentSummary)
                return {finished: true}
            })
            return currentSummary
        }
    }

    const nextSegment = segment + 1
    const continuationCursor = cursor as string
    await step.do(`start size chart continuation ${nextSegment}`, D1_STEP_CONFIG, async () => {
        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({
            id: sizeChartImageBackfillWorkflowInstanceId(params.runId, nextSegment),
            params: {
                kind: 'size-chart-images',
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
    candidates: SizeChartImageBackfillCandidate[],
    initialSummary: SizeChartImageBackfillSummary,
    offset: number,
): Promise<SizeChartImageBackfillSummary> {
    let summary = initialSummary
    for (const [index, candidate] of candidates.entries()) {
        try {
            const result = await step.do(`replace size chart image ${offset + index + 1}`, ITEM_STEP_CONFIG, async () => {
                return await replaceSizeChartImage(env, candidate)
            })
            summary = {
                ...summary,
                processedImages: summary.processedImages + 1,
                replacedImages: summary.replacedImages + (result.status === 'replaced' ? 1 : 0),
                skippedImages: summary.skippedImages + (result.status === 'skipped' ? 1 : 0),
            }
        } catch (error) {
            summary = {
                ...summary,
                processedImages: summary.processedImages + 1,
                failedImages: summary.failedImages + 1,
                lastError: sizeChartImageBackfillErrorMessage(error),
            }
        }
        summary.totalImages = Math.max(summary.totalImages, summary.processedImages)
    }
    return summary
}

async function initializeBackfillState(db: D1Database, runId: string): Promise<SizeChartImageBackfillSummary | null> {
    const summary = emptySizeChartImageBackfillSummary()
    summary.totalImages = await countSizeChartImageBackfillCandidates(db)
    return await saveBackfillSummary(db, runId, summary)
}

async function readBackfillState(db: D1Database, runId: string): Promise<SizeChartImageBackfillSummary | null> {
    const row = await db
        .prepare(
            `SELECT summary_json
             FROM admin_job_runs
             WHERE id = ?
               AND job_name = 'size-chart-image-backfill'
               AND status = 'running'`,
        )
        .bind(runId)
        .first<{summary_json: string | null}>()
    return row ? parseSizeChartImageBackfillSummary(row.summary_json) : null
}

async function saveBackfillSummary(
    db: D1Database,
    runId: string,
    summary: SizeChartImageBackfillSummary,
): Promise<SizeChartImageBackfillSummary> {
    await db
        .prepare(
            `UPDATE admin_job_runs
             SET summary_json = ?
             WHERE id = ?
               AND job_name = 'size-chart-image-backfill'
               AND status = 'running'`,
        )
        .bind(JSON.stringify(summary), runId)
        .run()
    return summary
}
