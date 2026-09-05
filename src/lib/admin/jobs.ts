import type {Bindings} from '../../types/bindings'
import type {RegenerateMediaPreviewsWorkflowParams} from '../../workflows/RegenerateMediaPreviewsWorkflow'
import {toSqlTimestamp} from '../auth/session'
import {backupD1Database, type D1BackupSummary} from '../db/backup'
import {type LeaderboardRefreshSummary, refreshLeaderboard} from '../leaderboard'
import {cleanupStaleR2Media, type R2CleanupSummary} from '../media/r2Cleanup'
import {type AdminErrorLogEntry, getAdminErrorLogs} from './errorLog'
import {
    activeMediaPreviewRegenerationWorkflowInstanceIds,
    emptyMediaPreviewRegenerationSummary,
    isMediaPreviewRegenerationDispatchActive,
    type MediaPreviewRegenerationSummary,
} from './mediaPreviewRegeneration'

const ADMIN_JOBS = [
    {
        name: 'd1-backup',
        label: 'D1 Database Backup',
    },
    {
        name: 'r2-media-cleanup',
        label: 'R2 Media Cleanup',
    },
    {
        name: 'leaderboard-refresh',
        label: 'Leaderboard Refresh',
    },
    {
        name: 'media-preview-regeneration',
        label: 'Media Preview Regeneration',
    },
    {
        name: 'thumbnail-regeneration',
        label: 'Thumbnail Regeneration',
    },
] as const

export type AdminJobName = (typeof ADMIN_JOBS)[number]['name']
type AdminJobTriggerSource = 'cron' | 'manual'
type AdminJobRunStatus = 'running' | 'success' | 'error'
const WORKFLOW_START_GRACE_PERIOD_MS = 5 * 60 * 1_000
const ACTIVE_WORKFLOW_STATUSES = new Set<InstanceStatus['status']>(['paused', 'queued', 'running', 'unknown', 'waiting', 'waitingForPause'])
type MediaPreviewWorkflowInstanceState = 'active' | 'complete' | 'inactive' | 'missing'
export type AdminJobSummary = D1BackupSummary | R2CleanupSummary | LeaderboardRefreshSummary | MediaPreviewRegenerationSummary

type AdminJobEnv = Pick<
    Bindings,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'D1_DATABASE_ID'
    | 'D1_REST_API_TOKEN'
    | 'DB'
    | 'DB_BACKUP_BUCKET'
    | 'MEDIA_BUCKET'
    | 'CACHE'
    | 'REGENERATE_MEDIA_PREVIEWS_WORKFLOW'
>

type AdminJobRunOptions = {
    cron?: string | null
    now?: Date
    triggeredByUserId?: string | null
    triggerSource: AdminJobTriggerSource
}

type AdminJobRunRow = {
    id: string
    job_name: string
    trigger_source: AdminJobTriggerSource
    triggered_by_user_id: string | null
    triggered_by_username: string | null
    cron: string | null
    status: AdminJobRunStatus
    started_at: string
    finished_at: string | null
    duration_ms: number | null
    summary_json: string | null
    error_message: string | null
}

export type AdminJobRun = {
    id: string
    jobName: AdminJobName
    label: string
    triggerSource: AdminJobTriggerSource
    triggeredByUserId: string | null
    triggeredByUsername: string | null
    cron: string | null
    status: AdminJobRunStatus
    startedAt: string
    finishedAt: string | null
    durationMs: number | null
    summary: AdminJobSummary | null
    errorMessage: string | null
}

export type AdminJobRunResult<TSummary extends AdminJobSummary = AdminJobSummary> = {
    jobName: AdminJobName
    runId: string
    status: AdminJobRunStatus
    summary?: TSummary
}

export type AdminOptionsData = {
    jobs: typeof ADMIN_JOBS
    runs: AdminJobRun[]
    errors: AdminErrorLogEntry[]
}

export async function getAdminOptionsData(db: D1Database): Promise<AdminOptionsData> {
    const [runs, errors] = await Promise.all([getAdminJobRuns(db), getAdminErrorLogs(db)])

    return {
        jobs: ADMIN_JOBS,
        runs,
        errors,
    }
}

async function getAdminJobRuns(db: D1Database, limit = 25): Promise<AdminJobRun[]> {
    const result = await db
        .prepare(
            `SELECT admin_job_runs.id,
                    admin_job_runs.job_name,
                    admin_job_runs.trigger_source,
                    admin_job_runs.triggered_by_user_id,
                    users.username AS triggered_by_username,
                    admin_job_runs.cron,
                    admin_job_runs.status,
                    admin_job_runs.started_at,
                    admin_job_runs.finished_at,
                    admin_job_runs.duration_ms,
                    admin_job_runs.summary_json,
                    admin_job_runs.error_message
             FROM admin_job_runs
             LEFT JOIN users ON users.id = admin_job_runs.triggered_by_user_id
             ORDER BY admin_job_runs.started_at DESC
             LIMIT ?`,
        )
        .bind(limit)
        .all<AdminJobRunRow>()

    return result.results.flatMap(toAdminJobRun)
}

export function parseAdminJobName(value: string): AdminJobName | null {
    return isAdminJobName(value) ? value : null
}

export function isAdminJobName(value: string): value is AdminJobName {
    return ADMIN_JOBS.some((job) => job.name === value)
}

export function getAdminJobLabel(jobName: AdminJobName): string {
    return ADMIN_JOBS.find((job) => job.name === jobName)?.label ?? jobName
}

export async function runAdminJob(env: AdminJobEnv, jobName: AdminJobName, options: AdminJobRunOptions): Promise<AdminJobRunResult> {
    if (jobName === 'media-preview-regeneration') {
        return await startMediaPreviewRegenerationJob(env, options)
    }

    if (jobName === 'thumbnail-regeneration') {
        return await startThumbnailRegenerationJob(env, options)
    }

    return await recordAdminJobRun(env.DB, jobName, options, async () => runAdminJobTask(env, jobName))
}

async function startThumbnailRegenerationJob(
    env: AdminJobEnv,
    options: AdminJobRunOptions,
): Promise<AdminJobRunResult<MediaPreviewRegenerationSummary>> {
    return await startRegenerationWorkflowJob(env, 'thumbnail-regeneration', options, 'thumbnails')
}

/**
 * @internal Exported for focused persistence tests; production callers use runAdminJob.
 */
export async function recordAdminJobRun<TSummary extends AdminJobSummary>(
    db: D1Database,
    jobName: AdminJobName,
    options: AdminJobRunOptions,
    run: () => Promise<TSummary>,
): Promise<AdminJobRunResult<TSummary>> {
    const started = await startAdminJobRun(db, jobName, options)

    try {
        const summary = await run()
        await tryFinishAdminJobRun(db, started.runId, 'success', summary, null)

        return {
            jobName,
            runId: started.runId,
            status: 'success',
            summary,
        }
    } catch (error) {
        await tryFinishAdminJobRun(db, started.runId, 'error', null, errorMessage(error))

        throw error
    }
}

async function startAdminJobRun(db: D1Database, jobName: AdminJobName, options: AdminJobRunOptions): Promise<{runId: string}> {
    const runId = crypto.randomUUID()
    const startedAt = toSqlTimestamp(options.now ?? new Date())

    await db
        .prepare(
            `INSERT INTO admin_job_runs (
                id, job_name, trigger_source, triggered_by_user_id, cron, status, started_at,
                finished_at, duration_ms, summary_json, error_message
            )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            runId,
            jobName,
            options.triggerSource,
            options.triggeredByUserId ?? null,
            options.cron ?? null,
            'running',
            startedAt,
            null,
            null,
            null,
            null,
        )
        .run()

    return {runId}
}

async function startMediaPreviewRegenerationJob(
    env: AdminJobEnv,
    options: AdminJobRunOptions,
): Promise<AdminJobRunResult<MediaPreviewRegenerationSummary>> {
    return await startRegenerationWorkflowJob(env, 'media-preview-regeneration', options, 'media-previews')
}

async function startRegenerationWorkflowJob(
    env: AdminJobEnv,
    jobName: 'media-preview-regeneration' | 'thumbnail-regeneration',
    options: AdminJobRunOptions,
    kind: 'media-previews' | 'thumbnails',
): Promise<AdminJobRunResult<MediaPreviewRegenerationSummary>> {
    const summary = emptyMediaPreviewRegenerationSummary()
    let started = await startExclusiveAdminJobRun(env.DB, jobName, options, summary)

    if (!started.created) {
        const active = await isMediaPreviewWorkflowActive(
            env.DB,
            env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW,
            jobName,
            started.runId,
            started.startedAt,
            started.summary,
        )

        if (active) {
            return {
                jobName,
                runId: started.runId,
                status: 'running',
                summary: started.summary,
            }
        }

        const label = kind === 'thumbnails' ? 'thumbnail regeneration' : 'preview regeneration'
        await failAdminJobRun(env.DB, started.runId, `The ${label} Workflow stopped before the job record finished.`)
        started = await startExclusiveAdminJobRun(env.DB, jobName, options, summary)

        if (!started.created) {
            return {
                jobName,
                runId: started.runId,
                status: 'running',
                summary: started.summary,
            }
        }
    }

    try {
        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({
            id: started.runId,
            params:
                kind === 'thumbnails'
                    ? ({kind, runId: started.runId} satisfies RegenerateMediaPreviewsWorkflowParams)
                    : ({runId: started.runId} satisfies RegenerateMediaPreviewsWorkflowParams),
        })
    } catch (error) {
        await tryFinishAdminJobRun(env.DB, started.runId, 'error', null, errorMessage(error))
        throw error
    }

    return {
        jobName,
        runId: started.runId,
        status: 'running',
        summary,
    }
}

async function startExclusiveAdminJobRun(
    db: D1Database,
    jobName: AdminJobName,
    options: AdminJobRunOptions,
    summary: MediaPreviewRegenerationSummary,
): Promise<{created: boolean; runId: string; startedAt: string; summary: MediaPreviewRegenerationSummary}> {
    const runId = crypto.randomUUID()
    const startedAt = toSqlTimestamp(options.now ?? new Date())
    const summaryJson = JSON.stringify(summary)
    const [insertResult, activeResult] = (await db.batch([
        db
            .prepare(
                `INSERT INTO admin_job_runs (
                id, job_name, trigger_source, triggered_by_user_id, cron, status, started_at,
                finished_at, duration_ms, summary_json, error_message
            )
            SELECT ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, NULL
            WHERE NOT EXISTS (
                SELECT 1
                FROM admin_job_runs
                WHERE job_name = ?
                  AND status = 'running'
            )`,
            )
            .bind(
                runId,
                jobName,
                options.triggerSource,
                options.triggeredByUserId ?? null,
                options.cron ?? null,
                startedAt,
                summaryJson,
                jobName,
            ),
        db
            .prepare(
                `SELECT id, started_at, summary_json
             FROM admin_job_runs
             WHERE job_name = ?
               AND status = 'running'
             ORDER BY started_at DESC
             LIMIT 1`,
            )
            .bind(jobName),
    ])) as [D1Result, D1Result<{id: string; started_at: string; summary_json: string | null}>]
    const active = activeResult.results[0] as {id: string; started_at: string; summary_json: string | null}
    const created = Number(insertResult.meta.changes) > 0

    return {
        created,
        runId: active.id,
        startedAt: active.started_at,
        summary: created ? summary : (parseMediaPreviewRegenerationSummary(active.summary_json) ?? summary),
    }
}

async function isMediaPreviewWorkflowActive(
    db: D1Database,
    workflow: Bindings['REGENERATE_MEDIA_PREVIEWS_WORKFLOW'],
    jobName: 'media-preview-regeneration' | 'thumbnail-regeneration',
    runId: string,
    startedAt: string,
    summary: MediaPreviewRegenerationSummary,
): Promise<boolean> {
    if (jobName === 'media-preview-regeneration' && (await isMediaPreviewRegenerationDispatchActive(db, runId))) {
        return true
    }

    const startedAtMs = Date.parse(`${startedAt.replace(' ', 'T')}Z`)
    const workflowAgeMs = Date.now() - startedAtMs
    const recentlyStarted = Number.isFinite(startedAtMs) && workflowAgeMs >= 0 && workflowAgeMs < WORKFLOW_START_GRACE_PERIOD_MS
    const statusErrors: Error[] = []
    const states: MediaPreviewWorkflowInstanceState[] = []

    for (const instanceId of activeMediaPreviewRegenerationWorkflowInstanceIds(runId, summary.processedVariants)) {
        try {
            const state = await getMediaPreviewWorkflowInstanceState(workflow, instanceId, recentlyStarted)
            if (state === 'active') {
                return true
            }
            states.push(state)
        } catch (error) {
            statusErrors.push(error instanceof Error ? error : new Error(errorMessage(error)))
        }
    }

    if (
        states.length === 2 &&
        states[0] === 'complete' &&
        states[1] === 'missing' &&
        (jobName === 'media-preview-regeneration' || recentlyStarted)
    ) {
        return true
    }

    const [statusError] = statusErrors
    if (statusError) {
        throw statusError
    }

    return false
}

async function getMediaPreviewWorkflowInstanceState(
    workflow: Bindings['REGENERATE_MEDIA_PREVIEWS_WORKFLOW'],
    instanceId: string,
    recentlyStarted: boolean,
): Promise<MediaPreviewWorkflowInstanceState> {
    try {
        const instance = await workflow.get(instanceId)
        const status = (await instance.status()).status

        if (ACTIVE_WORKFLOW_STATUSES.has(status)) {
            return 'active'
        }

        return status === 'complete' ? 'complete' : 'inactive'
    } catch (error) {
        if (recentlyStarted) {
            return 'active'
        }

        if (isMissingWorkflowInstanceError(error)) {
            return 'missing'
        }

        throw error
    }
}

function isMissingWorkflowInstanceError(error: unknown): boolean {
    if (typeof error === 'object' && error && 'code' in error && error.code === 404) {
        return true
    }

    const message = errorMessage(error).toLowerCase()
    return message.includes('not found') || message.includes('does not exist') || message.includes('no such workflow instance')
}

async function runAdminJobTask(env: AdminJobEnv, jobName: AdminJobName): Promise<AdminJobSummary> {
    if (jobName === 'd1-backup') {
        return await backupD1Database(env)
    }

    if (jobName === 'r2-media-cleanup') {
        return await cleanupStaleR2Media(env)
    }

    return await refreshLeaderboard(env)
}

async function tryFinishAdminJobRun(
    db: D1Database,
    runId: string,
    status: Exclude<AdminJobRunStatus, 'running'>,
    summary: AdminJobSummary | null,
    message: string | null,
): Promise<void> {
    try {
        await finishAdminJobRun(db, runId, status, summary, message)
    } catch (error) {
        console.warn('Unable to record admin job finish', {
            runId,
            status,
            error,
        })
    }
}

async function finishAdminJobRun(
    db: D1Database,
    runId: string,
    status: Exclude<AdminJobRunStatus, 'running'>,
    summary: AdminJobSummary | null,
    message: string | null,
): Promise<void> {
    const finishedAt = toSqlTimestamp(new Date())

    await db
        .prepare(
            `UPDATE admin_job_runs
             SET status = ?,
                 finished_at = ?,
                 duration_ms = MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)),
                 summary_json = ?,
                 error_message = ?
             WHERE id = ?
               AND status = 'running'`,
        )
        .bind(status, finishedAt, finishedAt, summary ? JSON.stringify(summary) : null, message, runId)
        .run()
}

export async function failAdminJobRun(db: D1Database, runId: string, message: string): Promise<void> {
    await finishAdminJobRun(db, runId, 'error', null, message)
}

function toAdminJobRun(row: AdminJobRunRow): AdminJobRun[] {
    const jobName = parseAdminJobName(row.job_name)

    if (!jobName) {
        return []
    }

    return [
        {
            id: row.id,
            jobName,
            label: getAdminJobLabel(jobName),
            triggerSource: row.trigger_source,
            triggeredByUserId: row.triggered_by_user_id,
            triggeredByUsername: row.triggered_by_username,
            cron: row.cron,
            status: row.status,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            durationMs: row.duration_ms,
            summary: parseSummary(row.summary_json),
            errorMessage: row.error_message,
        },
    ]
}

function parseSummary(value: string | null): AdminJobSummary | null {
    if (!value) {
        return null
    }

    try {
        return JSON.parse(value) as AdminJobSummary
    } catch {
        return null
    }
}

function parseMediaPreviewRegenerationSummary(value: string | null): MediaPreviewRegenerationSummary | null {
    const parsed = parseSummary(value)

    return parsed && 'totalVariants' in parsed && 'processedVariants' in parsed ? parsed : null
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    return String(error)
}
