import type {WorkflowStep} from 'cloudflare:workers'
import {
    AVIF_ICON_COLOR_BACKFILL_BATCH_SIZE,
    AVIF_ICON_COLOR_BACKFILL_ITEMS_PER_WORKFLOW,
    type AvifIconColorBackfillCandidate,
    type AvifIconColorBackfillCursor,
    type AvifIconColorBackfillSummary,
    avifIconColorBackfillErrorMessage,
    avifIconColorBackfillWorkflowInstanceId,
    countAvifIconColorBackfillCandidates,
    emptyAvifIconColorBackfillSummary,
    getAvifIconColorBackfillCandidates,
    parseAvifIconColorBackfillSummary,
    repairAvifIconColorCandidate,
} from '../lib/admin/avifIconColorBackfill'
import {completeAdminJobRun} from '../lib/admin/jobs'
import type {Bindings} from '../types/bindings'

const ITEM_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '5 minutes',
} as const

const D1_STEP_CONFIG = {
    retries: {limit: 5, delay: '5 seconds', backoff: 'exponential'},
    timeout: '1 minute',
} as const

export type AvifIconColorBackfillWorkflowParams = {
    kind: 'avif-icon-color-backfill'
    runId: string
    continuation?: {
        cursor: AvifIconColorBackfillCursor
        segment: number
    }
}

export async function runAvifIconColorBackfillWorkflow(
    env: Bindings,
    params: AvifIconColorBackfillWorkflowParams,
    step: WorkflowStep,
): Promise<AvifIconColorBackfillSummary> {
    const summary = await step.do(
        params.continuation ? 'resume AVIF icon color backfill' : 'initialize AVIF icon color backfill',
        D1_STEP_CONFIG,
        async () => {
            return params.continuation ? await readBackfillState(env.DB, params.runId) : await initializeBackfillState(env.DB, params.runId)
        },
    )

    if (!summary) {
        return emptyAvifIconColorBackfillSummary()
    }

    let currentSummary = summary
    let cursor = params.continuation?.cursor ?? null
    const segment = params.continuation?.segment ?? 0
    let segmentItems = 0
    let batchNumber = 0

    while (segmentItems < AVIF_ICON_COLOR_BACKFILL_ITEMS_PER_WORKFLOW) {
        batchNumber += 1
        const candidates = await step.do(`load AVIF icon batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await getAvifIconColorBackfillCandidates(env.DB, cursor)
        })

        if (candidates.length === 0) {
            await step.do('complete AVIF icon color backfill', D1_STEP_CONFIG, async () => {
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
                kind: lastCandidate.kind,
                targetId: lastCandidate.targetId,
            }
        }

        currentSummary = await step.do(`save AVIF icon batch ${batchNumber}`, D1_STEP_CONFIG, async () => {
            return await saveBackfillSummary(env.DB, params.runId, currentSummary)
        })

        if (candidates.length < AVIF_ICON_COLOR_BACKFILL_BATCH_SIZE) {
            await step.do('complete AVIF icon color backfill', D1_STEP_CONFIG, async () => {
                await completeAdminJobRun(env.DB, params.runId, currentSummary)
                return {finished: true}
            })
            return currentSummary
        }
    }

    const nextSegment = segment + 1
    const continuationCursor = cursor as AvifIconColorBackfillCursor
    await step.do(`start AVIF icon continuation ${nextSegment}`, D1_STEP_CONFIG, async () => {
        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({
            id: avifIconColorBackfillWorkflowInstanceId(params.runId, nextSegment),
            params: {
                kind: 'avif-icon-color-backfill',
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
    candidates: AvifIconColorBackfillCandidate[],
    initialSummary: AvifIconColorBackfillSummary,
    offset: number,
): Promise<AvifIconColorBackfillSummary> {
    let summary = initialSummary

    for (const [index, candidate] of candidates.entries()) {
        try {
            const result = await step.do(`repair AVIF icon ${offset + index + 1}`, ITEM_STEP_CONFIG, async () => {
                return await repairAvifIconColorCandidate(env, candidate)
            })
            summary = {
                ...summary,
                processedIcons: summary.processedIcons + 1,
                retaggedIcons: summary.retaggedIcons + (result.status === 'retagged' ? 1 : 0),
                skippedIcons: summary.skippedIcons + (result.status === 'skipped' ? 1 : 0),
            }
        } catch (error) {
            summary = {
                ...summary,
                processedIcons: summary.processedIcons + 1,
                failedIcons: summary.failedIcons + 1,
                lastError: avifIconColorBackfillErrorMessage(error),
            }
        }

        summary.totalIcons = Math.max(summary.totalIcons, summary.processedIcons)
    }

    return summary
}

async function initializeBackfillState(db: D1Database, runId: string): Promise<AvifIconColorBackfillSummary | null> {
    const summary = emptyAvifIconColorBackfillSummary()
    summary.totalIcons = await countAvifIconColorBackfillCandidates(db)
    return await saveBackfillSummary(db, runId, summary)
}

async function readBackfillState(db: D1Database, runId: string): Promise<AvifIconColorBackfillSummary | null> {
    const row = await db
        .prepare(
            `SELECT summary_json
             FROM admin_job_runs
             WHERE id = ?
               AND job_name = 'avif-icon-color-backfill'
               AND status = 'running'`,
        )
        .bind(runId)
        .first<{summary_json: string | null}>()
    return row ? parseAvifIconColorBackfillSummary(row.summary_json) : null
}

async function saveBackfillSummary(
    db: D1Database,
    runId: string,
    summary: AvifIconColorBackfillSummary,
): Promise<AvifIconColorBackfillSummary> {
    await db
        .prepare(
            `UPDATE admin_job_runs
             SET summary_json = ?
             WHERE id = ?
               AND job_name = 'avif-icon-color-backfill'
               AND status = 'running'`,
        )
        .bind(JSON.stringify(summary), runId)
        .run()
    return summary
}
