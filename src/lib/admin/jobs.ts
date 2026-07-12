import type {Bindings} from '../../types/bindings'
import {toSqlTimestamp} from '../auth/session'
import {backupD1Database, type D1BackupSummary} from '../db/backup'
import {cleanupStaleR2Media, type R2CleanupSummary} from '../media/r2Cleanup'

export const ADMIN_JOBS = [
    {
        name: 'd1-backup',
        label: 'D1 Database Backup',
    },
    {
        name: 'r2-media-cleanup',
        label: 'R2 Media Cleanup',
    },
] as const

export type AdminJobName = (typeof ADMIN_JOBS)[number]['name']
export type AdminJobTriggerSource = 'cron' | 'manual'
export type AdminJobRunStatus = 'running' | 'success' | 'error'
export type AdminJobSummary = D1BackupSummary | R2CleanupSummary

type AdminJobEnv = Pick<
    Bindings,
    'CLOUDFLARE_ACCOUNT_ID' | 'D1_DATABASE_ID' | 'D1_REST_API_TOKEN' | 'DB' | 'DB_BACKUP_BUCKET' | 'MEDIA_BUCKET'
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
    status: Exclude<AdminJobRunStatus, 'running'>
    summary?: TSummary
}

export type AdminOptionsData = {
    jobs: typeof ADMIN_JOBS
    runs: AdminJobRun[]
}

export async function getAdminOptionsData(db: D1Database): Promise<AdminOptionsData> {
    return {
        jobs: ADMIN_JOBS,
        runs: await getAdminJobRuns(db),
    }
}

export async function getAdminJobRuns(db: D1Database, limit = 25): Promise<AdminJobRun[]> {
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
    return await recordAdminJobRun(env.DB, jobName, options, async () => {
        if (jobName === 'd1-backup') {
            return await backupD1Database(env)
        }

        return await cleanupStaleR2Media(env)
    })
}

export async function recordAdminJobRun<TSummary extends AdminJobSummary>(
    db: D1Database,
    jobName: AdminJobName,
    options: AdminJobRunOptions,
    run: () => Promise<TSummary>,
): Promise<AdminJobRunResult<TSummary>> {
    const runId = crypto.randomUUID()
    const startedAt = toSqlTimestamp(options.now ?? new Date())
    const startedAtMs = Date.now()
    let shouldUpdateRun = true

    try {
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
    } catch (error) {
        shouldUpdateRun = false
        console.warn('Unable to record admin job start', {
            jobName,
            error,
        })
    }

    try {
        const summary = await run()

        if (shouldUpdateRun) {
            await tryFinishAdminJobRun(db, runId, 'success', startedAtMs, summary, null)
        }

        return {
            jobName,
            runId,
            status: 'success',
            summary,
        }
    } catch (error) {
        if (shouldUpdateRun) {
            await tryFinishAdminJobRun(db, runId, 'error', startedAtMs, null, errorMessage(error))
        }

        throw error
    }
}

async function tryFinishAdminJobRun(
    db: D1Database,
    runId: string,
    status: Exclude<AdminJobRunStatus, 'running'>,
    startedAtMs: number,
    summary: AdminJobSummary | null,
    message: string | null,
): Promise<void> {
    try {
        await finishAdminJobRun(db, runId, status, startedAtMs, summary, message)
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
    startedAtMs: number,
    summary: AdminJobSummary | null,
    message: string | null,
): Promise<void> {
    await db
        .prepare(
            `UPDATE admin_job_runs
             SET status = ?,
                 finished_at = ?,
                 duration_ms = ?,
                 summary_json = ?,
                 error_message = ?
             WHERE id = ?`,
        )
        .bind(
            status,
            toSqlTimestamp(new Date()),
            Math.max(0, Date.now() - startedAtMs),
            summary ? JSON.stringify(summary) : null,
            message,
            runId,
        )
        .run()
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

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    return String(error)
}
