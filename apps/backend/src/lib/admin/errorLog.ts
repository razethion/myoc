import {toSqlTimestamp} from '../auth/session'

type AdminErrorLogSource = 'image-processing' | 'media-preview-regeneration'

export type AdminErrorLogEntry = {
    source: AdminErrorLogSource
    sourceLabel: string
    messageId: string
    jobId: string | null
    taskId: string | null
    errorCode: string
    errorMessage: string
    createdAt: string
}

type AdminErrorLogRow = {
    source: AdminErrorLogSource
    message_id: string
    job_id: string | null
    task_id: string | null
    error_code: string
    error_message: string
    created_at: string
}

type RecordAdminErrorLogInput = {
    source: AdminErrorLogSource
    messageId: string
    jobId?: string | null
    taskId?: string | null
    errorCode: string
    errorMessage: string
    now?: Date
}

export async function recordAdminErrorLog(db: D1Database, input: RecordAdminErrorLogInput): Promise<void> {
    await db
        .prepare(
            `INSERT OR IGNORE INTO admin_error_logs (
                source, message_id, job_id, task_id, error_code, error_message, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            input.source,
            input.messageId,
            input.jobId ?? null,
            input.taskId ?? null,
            input.errorCode,
            input.errorMessage.slice(0, 2_000),
            toSqlTimestamp(input.now ?? new Date()),
        )
        .run()
}

export async function getAdminErrorLogs(db: D1Database, limit = 50): Promise<AdminErrorLogEntry[]> {
    const result = await db
        .prepare(
            `SELECT source, message_id, job_id, task_id, error_code, error_message, created_at
             FROM admin_error_logs
             ORDER BY created_at DESC, message_id DESC
             LIMIT ?`,
        )
        .bind(limit)
        .all<AdminErrorLogRow>()

    return result.results.map((row) => ({
        source: row.source,
        sourceLabel: row.source === 'image-processing' ? 'Image Processing' : 'Media Preview Regeneration',
        messageId: row.message_id,
        jobId: row.job_id,
        taskId: row.task_id,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        createdAt: row.created_at,
    }))
}
