import {z} from 'zod'
import type {Bindings} from '../../types/bindings'
import type {ImageProcessingFailureMessage, ImageUploadProcessingMessage} from '../../types/imageProcessing'
import {recordAdminErrorLog} from '../admin/errorLog'
import {toSqlTimestamp} from '../auth/session'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from './cacheControl'
import {readGalleryImageDimensions} from './imageMetadata'
import {
    GALLERY_NSFW_BLUR_CONTENT_TYPE,
    GALLERY_PREVIEW_CONTENT_TYPE,
    generateGalleryOutputsWithContainer,
    generateSquareImageWithContainer,
    PreviewContainerBusyError,
    PreviewValidationError,
} from './previewGeneration'
import {retainThumbnailOriginal, thumbnailOriginalObjectKey} from './thumbnailSources'
import {
    characterFolderImageObjectKey,
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaNsfwBlurImageUrl,
    characterMediaPreviewImageObjectKey,
    characterMediaPreviewImageUrl,
    characterProfileImageObjectKey,
    profilePhotoObjectKey,
} from './url'

const IMAGE_UPLOAD_DEADLINE_MS = 15 * 60 * 1_000
const IMAGE_UPLOAD_RECONCILE_LIMIT = 50
const IMAGE_TASK_LEASE_MS = 2 * 60 * 1_000
const IMAGE_TASK_MAX_SHARP_ATTEMPTS = 3
const IMAGE_TASK_STALE_MS = 2 * 60 * 1_000
const IMAGE_CLEANUP_GRACE_MS = 60 * 60 * 1_000
const SQUARE_SOURCE_MAX_BYTES = 3 * 1024 * 1024

export const ImageUploadKindSchema = z.enum(['gallery', 'user-profile', 'character-profile', 'folder-image'])
type ImageUploadKind = z.infer<typeof ImageUploadKindSchema>

type JobRow = {
    id: string
    user_id: string
    batch_id: string | null
    target_type: 'gallery_create' | 'gallery_replace' | 'user_profile' | 'character_profile' | 'folder_image'
    target_id: string
    state: ImageUploadInternalState
    generation: number
    idempotency_key: string
    last_retry_idempotency_key: string | null
    request_json: string
    result_json: string | null
    error_code: string | null
    error_message: string | null
    deadline_at: string
    created_at: string
    updated_at: string
}

type TaskRow = {
    id: string
    job_id: string
    source_id: string
    run_id: string
    recipe: 'gallery-sfw-v1' | 'gallery-nsfw-v1' | 'user-profile-v1' | 'character-profile-v1' | 'folder-image-v1'
    container_slot: 0 | 1 | 2
    state: 'queued' | 'processing' | 'ready' | 'failed' | 'canceled'
    sharp_attempts: number
    lease_id: string | null
    lease_expires_at: string | null
    output_json: string | null
    source_key: string
    source_content_type: string
    source_byte_size: number | null
    source_width: number | null
    source_height: number | null
    source_rating: 'sfw' | 'nsfw' | null
    user_id: string
    target_id: string
    target_type: JobRow['target_type']
    generation: number
    job_state: ImageUploadInternalState
    request_json: string
}

type FailedTaskReportRow = {
    id: string
    job_id: string
    run_id: string
    failure_event_id: string
    error_code: string
    error_message: string
}

type ImageUploadInternalState =
    | 'uploading'
    | 'queued'
    | 'processing'
    | 'waiting_for_sources'
    | 'publishing'
    | 'ready'
    | 'failed'
    | 'canceled'

export type ImageUploadStatus = {
    id: string
    batchId: string | null
    state: 'checking' | 'uploading' | 'waiting' | 'processing' | 'ready' | 'failed' | 'canceled'
    kind: ImageUploadKind
    result: Record<string, unknown> | null
    error: {code: string; message: string} | null
    createdAt: string
    updatedAt: string
}

type CreateSquareJobInput = {
    userId: string
    kind: Exclude<ImageUploadKind, 'gallery'>
    targetId: string
    idempotencyKey: string
    batchId?: string | null
    bytes: Uint8Array
    now?: Date
}

export type CompletedGalleryJobSource = {
    rating: 'sfw' | 'nsfw'
    objectKey: string
    contentType: string
    byteSize: number
    width: number
    height: number
    displayWidth: number
    displayHeight: number
}

type CreateGalleryJobInput = {
    userId: string
    characterId: string
    mediaId: string
    idempotencyKey: string
    sfwArtist: string
    nsfwArtist: string
    sources: CompletedGalleryJobSource[]
    now?: Date
}

export class ImageUploadConflictError extends Error {}
export class ImageUploadValidationError extends Error {}

export async function createGalleryImageUploadJob(env: Bindings, input: CreateGalleryJobInput): Promise<ImageUploadStatus> {
    if (
        input.sources.length < 1 ||
        input.sources.length > 2 ||
        new Set(input.sources.map((source) => source.rating)).size !== input.sources.length
    ) {
        throw new ImageUploadValidationError('A gallery upload must contain one source for each selected rating')
    }

    await assertOwnedTarget(env.DB, input.userId, 'gallery_create', input.characterId)
    const requestJson = JSON.stringify({
        kind: 'gallery',
        targetId: input.characterId,
        mediaId: input.mediaId,
        sfwArtist: input.sfwArtist,
        nsfwArtist: input.nsfwArtist,
    })
    const existing = await env.DB.prepare(
        `SELECT id, user_id, batch_id, target_type, target_id, state, generation, idempotency_key,
                last_retry_idempotency_key, request_json, result_json, error_code, error_message,
                deadline_at, created_at, updated_at
         FROM image_upload_jobs
         WHERE user_id = ? AND idempotency_key = ?`,
    )
        .bind(input.userId, input.idempotencyKey)
        .first<JobRow>()

    if (existing) {
        if (existing.request_json !== requestJson)
            throw new ImageUploadConflictError('The idempotency key was already used for a different upload')
        return statusFromRow(existing)
    }

    const now = input.now ?? new Date()
    const nowText = toSqlTimestamp(now)
    const jobId = crypto.randomUUID()
    const statements: D1PreparedStatement[] = [
        env.DB.prepare(
            `INSERT INTO image_upload_jobs (
                 id, user_id, target_type, target_id, state, idempotency_key, request_json,
                 deadline_at, created_at, updated_at
             ) VALUES (?, ?, 'gallery_create', ?, 'queued', ?, ?, ?, ?, ?)`,
        ).bind(
            jobId,
            input.userId,
            input.characterId,
            input.idempotencyKey,
            requestJson,
            toSqlTimestamp(new Date(now.getTime() + IMAGE_UPLOAD_DEADLINE_MS)),
            nowText,
            nowText,
        ),
    ]

    for (const source of input.sources) {
        const sourceId = crypto.randomUUID()
        const taskId = crypto.randomUUID()
        const slot = 0
        statements.push(
            env.DB.prepare(
                `INSERT INTO image_upload_sources (
                     id, job_id, rating, state, object_key, content_type, byte_size, width, height, created_at, updated_at
                 ) VALUES (?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                sourceId,
                jobId,
                source.rating,
                source.objectKey,
                source.contentType,
                source.byteSize,
                source.displayWidth,
                source.displayHeight,
                nowText,
                nowText,
            ),
            env.DB.prepare(
                `INSERT INTO image_processing_tasks (
                     id, job_id, source_id, run_id, recipe, container_slot, state, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
            ).bind(taskId, jobId, sourceId, crypto.randomUUID(), `gallery-${source.rating}-v1`, slot, nowText, nowText),
            env.DB.prepare(
                `INSERT INTO image_queue_outbox (id, task_id, container_slot, state, next_attempt_at, created_at)
                 VALUES (?, ?, ?, 'pending', ?, ?)`,
            ).bind(crypto.randomUUID(), taskId, slot, nowText, nowText),
        )
    }

    await env.DB.batch(statements)
    await dispatchImageUploadOutbox(env, now)
    const created = await getOwnedImageUploadJob(env.DB, input.userId, jobId)
    if (!created) throw new Error('Image upload job was not created')
    return statusFromRow(created)
}

export async function createSquareImageUploadJob(env: Bindings, input: CreateSquareJobInput): Promise<ImageUploadStatus> {
    validateSquareSource(input.bytes)
    const targetType = targetTypeForKind(input.kind)
    const requestJson = JSON.stringify({kind: input.kind, targetId: input.targetId})
    const existing = await env.DB.prepare(
        `SELECT id, user_id, batch_id, target_type, target_id, state, generation, idempotency_key,
                last_retry_idempotency_key, request_json, result_json, error_code, error_message,
                deadline_at, created_at, updated_at
         FROM image_upload_jobs
         WHERE user_id = ?
           AND idempotency_key = ?`,
    )
        .bind(input.userId, input.idempotencyKey)
        .first<JobRow>()

    if (existing) {
        if (existing.request_json !== requestJson) {
            throw new ImageUploadConflictError('The idempotency key was already used for a different upload')
        }

        return statusFromRow(existing)
    }

    await assertOwnedTarget(env.DB, input.userId, targetType, input.targetId)

    const now = input.now ?? new Date()
    const nowText = toSqlTimestamp(now)
    const jobId = crypto.randomUUID()
    const sourceId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    const runId = crypto.randomUUID()
    const slot = 0
    const sourceKey = `image-sources/${input.userId}/${jobId}/${sourceId}.png`
    const deadlineAt = toSqlTimestamp(new Date(now.getTime() + IMAGE_UPLOAD_DEADLINE_MS))
    const recipe = recipeForKind(input.kind)

    await env.MEDIA_BUCKET.put(sourceKey, input.bytes, {
        httpMetadata: {
            cacheControl: 'private, no-store',
            contentType: 'image/png',
        },
    })

    try {
        await env.DB.batch([
            env.DB.prepare(
                `INSERT INTO image_upload_jobs (
                     id, user_id, batch_id, target_type, target_id, state, idempotency_key,
                     request_json, deadline_at, created_at, updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
            ).bind(
                jobId,
                input.userId,
                input.batchId ?? null,
                targetType,
                input.targetId,
                input.idempotencyKey,
                requestJson,
                deadlineAt,
                nowText,
                nowText,
            ),
            env.DB.prepare(
                `INSERT INTO image_upload_sources (
                     id, job_id, state, object_key, content_type, byte_size, width, height, created_at, updated_at
                 )
                 VALUES (?, ?, 'ready', ?, 'image/png', ?, 512, 512, ?, ?)`,
            ).bind(sourceId, jobId, sourceKey, input.bytes.byteLength, nowText, nowText),
            env.DB.prepare(
                `INSERT INTO image_processing_tasks (
                     id, job_id, source_id, run_id, recipe, container_slot, state, last_enqueued_at, created_at, updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, 'queued', NULL, ?, ?)`,
            ).bind(taskId, jobId, sourceId, runId, recipe, slot, nowText, nowText),
            env.DB.prepare(
                `INSERT INTO image_queue_outbox (id, task_id, container_slot, state, next_attempt_at, created_at)
                 VALUES (?, ?, ?, 'pending', ?, ?)`,
            ).bind(crypto.randomUUID(), taskId, slot, nowText, nowText),
        ])
    } catch (error) {
        await env.MEDIA_BUCKET.delete(sourceKey)
        throw error
    }

    await dispatchImageUploadOutbox(env, now)
    const created = await getOwnedImageUploadJob(env.DB, input.userId, jobId)

    if (!created) throw new Error('Image upload job was not created')

    return statusFromRow(created)
}

export async function getImageUploadStatus(db: D1Database, userId: string, jobId: string): Promise<ImageUploadStatus | null> {
    const job = await getOwnedImageUploadJob(db, userId, jobId)
    return job ? statusFromRow(job) : null
}

export async function getImageUploadBatchStatus(db: D1Database, userId: string, batchId: string): Promise<ImageUploadStatus[]> {
    const result = await db
        .prepare(
            `SELECT id, user_id, batch_id, target_type, target_id, state, generation, idempotency_key,
                    last_retry_idempotency_key, request_json, result_json, error_code, error_message,
                    deadline_at, created_at, updated_at
             FROM image_upload_jobs
             WHERE user_id = ?
               AND batch_id = ?
             ORDER BY created_at, id`,
        )
        .bind(userId, batchId)
        .all<JobRow>()
    return result.results.map(statusFromRow)
}

export async function cancelImageUploadJob(db: D1Database, userId: string, jobId: string, now = new Date()): Promise<boolean> {
    const nowText = toSqlTimestamp(now)
    const notBefore = toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS))
    const results = await db.batch([
        db
            .prepare(
                `UPDATE image_upload_jobs
                 SET state = 'canceled', updated_at = ?
                 WHERE id = ?
                   AND user_id = ?
                   AND state IN ('uploading', 'queued', 'processing', 'waiting_for_sources')`,
            )
            .bind(nowText, jobId, userId),
        db
            .prepare(
                `UPDATE image_processing_tasks
                 SET state = 'canceled', lease_id = NULL, lease_expires_at = NULL, updated_at = ?
                 WHERE job_id = ?
                   AND state IN ('queued', 'processing')`,
            )
            .bind(nowText, jobId),
        db
            .prepare(
                `INSERT OR IGNORE INTO image_cleanup_tasks (
                     id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                 )
                 SELECT lower(hex(randomblob(16))), sources.job_id, 'source', sources.object_key,
                        'pending', ?, ?, ?
                 FROM image_upload_sources AS sources
                 JOIN image_upload_jobs AS jobs ON jobs.id = sources.job_id
                 WHERE sources.job_id = ?
                   AND jobs.user_id = ?
                   AND jobs.state = 'canceled'`,
            )
            .bind(notBefore, nowText, nowText, jobId, userId),
    ])
    return (results as [D1Result, ...D1Result[]])[0].meta.changes > 0
}

export async function retryImageUploadJob(
    env: Bindings,
    userId: string,
    jobId: string,
    idempotencyKey: string,
    now = new Date(),
): Promise<ImageUploadStatus | null> {
    const job = await getOwnedImageUploadJob(env.DB, userId, jobId)

    if (!job) {
        return null
    }

    if (job.last_retry_idempotency_key === idempotencyKey) {
        return statusFromRow(job)
    }

    if (job.state !== 'failed') {
        throw new ImageUploadConflictError('Only a failed upload can be retried')
    }

    await reportPendingImageTaskFailures(env, {jobId})
    const unreportedFailure = await env.DB.prepare(
        `SELECT 1
         FROM image_processing_tasks
         WHERE job_id = ? AND state = 'failed' AND failure_event_id IS NOT NULL AND failure_reported_at IS NULL
         LIMIT 1`,
    )
        .bind(jobId)
        .first<number>()

    if (unreportedFailure !== null) {
        throw new ImageUploadConflictError('The image upload failure report is pending. Try again later.')
    }

    const tasks = await env.DB.prepare(
        `SELECT id, run_id, container_slot, output_json
         FROM image_processing_tasks
         WHERE job_id = ?
           AND state != 'ready'
           AND EXISTS (
               SELECT 1 FROM image_upload_jobs
               WHERE id = ? AND state = 'failed' AND generation = ?
           )
         ORDER BY created_at, id`,
    )
        .bind(jobId, jobId, job.generation)
        .all<{id: string; run_id: string; container_slot: 0 | 1 | 2; output_json: string | null}>()

    if (tasks.results.length === 0) {
        return await concurrentRetryStatus(env.DB, userId, jobId, idempotencyKey, job.generation)
    }

    const nowText = toSqlTimestamp(now)
    const nextGeneration = job.generation + 1
    const statements: D1PreparedStatement[] = [
        env.DB.prepare(
            `UPDATE image_upload_jobs
             SET state = 'queued', generation = generation + 1, last_retry_idempotency_key = ?, result_json = NULL,
                 error_code = NULL, error_message = NULL, deadline_at = ?, updated_at = ?
             WHERE id = ? AND user_id = ? AND state = 'failed' AND generation = ?`,
        ).bind(idempotencyKey, toSqlTimestamp(new Date(now.getTime() + IMAGE_UPLOAD_DEADLINE_MS)), nowText, jobId, userId, job.generation),
    ]

    for (const task of tasks.results) {
        const nextRunId = crypto.randomUUID()
        statements.push(
            env.DB.prepare(
                `UPDATE image_processing_tasks
                 SET run_id = ?, state = 'queued', sharp_attempts = 0, lease_id = NULL,
                     lease_expires_at = NULL, last_enqueued_at = NULL, output_json = NULL,
                     error_code = NULL, error_message = NULL, failure_event_id = NULL,
                     failure_reported_at = NULL, updated_at = ?
                 WHERE id = ? AND run_id = ?
                   AND EXISTS (
                       SELECT 1 FROM image_upload_jobs
                       WHERE id = ? AND generation = ? AND state = 'queued' AND last_retry_idempotency_key = ?
                   )`,
            ).bind(nextRunId, nowText, task.id, task.run_id, jobId, nextGeneration, idempotencyKey),
            env.DB.prepare(
                `INSERT INTO image_queue_outbox (id, task_id, container_slot, state, next_attempt_at, created_at)
                 SELECT ?, ?, ?, 'pending', ?, ?
                 WHERE EXISTS (
                     SELECT 1 FROM image_processing_tasks
                     WHERE id = ? AND run_id = ? AND state = 'queued'
                 )`,
            ).bind(crypto.randomUUID(), task.id, task.container_slot, nowText, nowText, task.id, nextRunId),
            ...(task.output_json ? cleanupStatementsForOutput(env.DB, jobId, task.output_json, now) : []),
        )
    }

    const results = await env.DB.batch(statements)

    if ((results as [D1Result, ...D1Result[]])[0].meta.changes === 0) {
        return await concurrentRetryStatus(env.DB, userId, jobId, idempotencyKey)
    }

    await dispatchImageUploadOutbox(env, now)
    return await getImageUploadStatus(env.DB, userId, jobId)
}

async function concurrentRetryStatus(
    db: D1Database,
    userId: string,
    jobId: string,
    idempotencyKey: string,
    missingTaskGeneration?: number,
): Promise<ImageUploadStatus> {
    const current = await getOwnedImageUploadJob(db, userId, jobId)
    if (current?.last_retry_idempotency_key === idempotencyKey) return statusFromRow(current)
    if (current?.state === 'failed' && current.generation === missingTaskGeneration) {
        throw new Error('Image upload task was not found')
    }
    throw new ImageUploadConflictError('The image upload retry changed. Reload the upload status and try again.')
}

export async function consumeImageUploadProcessingMessage(
    message: Message,
    body: ImageUploadProcessingMessage,
    env: Bindings,
    now = () => new Date(),
): Promise<void> {
    try {
        const action = await processImageTask(env, body, now())
        await reportPendingImageTaskFailures(env, {taskId: body.taskId})

        if (action === 'retry-capacity') {
            message.retry({delaySeconds: 1})
        } else if (action === 'retry-processing') {
            message.retry({delaySeconds: message.attempts <= 1 ? 1 : 3})
        } else {
            message.ack()
        }
    } catch (error) {
        console.error(
            JSON.stringify({
                event: 'image_task_system_error',
                messageId: message.id,
                taskId: body.taskId,
                error: errorMessage(error),
            }),
        )
        message.retry({delaySeconds: Math.min(60, 2 ** Math.min(6, message.attempts))})
    }
}

async function dispatchImageUploadOutbox(env: Bindings, now: Date): Promise<number> {
    const rows = await env.DB.prepare(
        `SELECT id, task_id
         FROM image_queue_outbox
         WHERE state = 'pending'
           AND next_attempt_at <= ?
         ORDER BY created_at
         LIMIT ?`,
    )
        .bind(toSqlTimestamp(now), IMAGE_UPLOAD_RECONCILE_LIMIT)
        .all<{id: string; task_id: string}>()
    let sent = 0

    for (const row of rows.results) {
        const message = {version: 1, kind: 'upload', taskId: row.task_id} satisfies ImageUploadProcessingMessage

        try {
            await env.IMAGE_PROCESSING_QUEUE.send(message, {contentType: 'json'})
            await env.DB.batch([
                env.DB.prepare(
                    `UPDATE image_queue_outbox
                     SET state = 'sent', send_attempts = send_attempts + 1, sent_at = ?
                     WHERE id = ? AND state = 'pending'`,
                ).bind(toSqlTimestamp(now), row.id),
                env.DB.prepare(
                    `UPDATE image_processing_tasks
                     SET last_enqueued_at = ?, updated_at = ?
                     WHERE id = ? AND state = 'queued'`,
                ).bind(toSqlTimestamp(now), toSqlTimestamp(now), row.task_id),
            ])
            sent += 1
        } catch (error) {
            const nextAttempt = new Date(now.getTime() + 5_000)
            await env.DB.prepare(
                `UPDATE image_queue_outbox
                 SET send_attempts = send_attempts + 1, next_attempt_at = ?
                 WHERE id = ? AND state = 'pending'`,
            )
                .bind(toSqlTimestamp(nextAttempt), row.id)
                .run()
            console.error(JSON.stringify({event: 'image_outbox_send_failed', outboxId: row.id, error: errorMessage(error)}))
        }
    }

    return sent
}

export async function reconcileImageUploads(env: Bindings, now = new Date()): Promise<void> {
    const nowText = toSqlTimestamp(now)
    const staleText = toSqlTimestamp(new Date(now.getTime() - IMAGE_TASK_STALE_MS))
    await dispatchImageUploadOutbox(env, now)

    const expired = await env.DB.prepare(
        `SELECT id, container_slot
         FROM image_processing_tasks
         WHERE state = 'processing'
           AND lease_expires_at <= ?
         ORDER BY lease_expires_at
         LIMIT ?`,
    )
        .bind(nowText, IMAGE_UPLOAD_RECONCILE_LIMIT)
        .all<{id: string; container_slot: 0 | 1 | 2}>()
    const stale = await env.DB.prepare(
        `SELECT id, container_slot
         FROM image_processing_tasks
         WHERE state = 'queued'
           AND (last_enqueued_at IS NULL OR last_enqueued_at <= ?)
         ORDER BY updated_at
         LIMIT ?`,
    )
        .bind(staleText, IMAGE_UPLOAD_RECONCILE_LIMIT)
        .all<{id: string; container_slot: 0 | 1 | 2}>()

    for (const task of [...expired.results, ...stale.results]) {
        const outboxId = crypto.randomUUID()
        await env.DB.batch([
            env.DB.prepare(
                `UPDATE image_processing_tasks
                 SET state = 'queued', lease_id = NULL, lease_expires_at = NULL, updated_at = ?
                 WHERE id = ? AND state IN ('queued', 'processing')`,
            ).bind(nowText, task.id),
            env.DB.prepare(
                `INSERT INTO image_queue_outbox (id, task_id, container_slot, state, next_attempt_at, created_at)
                 VALUES (?, ?, ?, 'pending', ?, ?)`,
            ).bind(outboxId, task.id, task.container_slot, nowText, nowText),
        ])
    }

    await env.DB.batch([
        env.DB.prepare(
            `UPDATE image_upload_jobs
             SET state = 'failed', error_code = 'deadline_exceeded',
                 error_message = 'Image processing took too long. Try again.', updated_at = ?
             WHERE state IN ('uploading', 'queued', 'processing', 'waiting_for_sources')
               AND deadline_at <= ?`,
        ).bind(nowText, nowText),
        env.DB.prepare(
            `UPDATE image_processing_tasks
             SET state = 'failed', lease_id = NULL, lease_expires_at = NULL,
                 error_code = 'deadline_exceeded', error_message = 'Image processing took too long. Try again.',
                 failure_event_id = run_id, failure_reported_at = NULL, updated_at = ?
             WHERE job_id IN (
                 SELECT id FROM image_upload_jobs
                 WHERE state = 'failed' AND error_code = 'deadline_exceeded' AND updated_at = ?
             )
               AND state IN ('queued', 'processing')`,
        ).bind(nowText, nowText),
    ])
    await reportPendingImageTaskFailures(env)

    const cleanup = await env.DB.prepare(
        `SELECT id, bucket, object_key, attempts
         FROM image_cleanup_tasks
         WHERE state = 'pending' AND not_before <= ?
         ORDER BY created_at
         LIMIT ?`,
    )
        .bind(nowText, IMAGE_UPLOAD_RECONCILE_LIMIT)
        .all<{id: string; bucket: 'media' | 'source'; object_key: string; attempts: number}>()

    for (const task of cleanup.results) {
        try {
            await env.MEDIA_BUCKET.delete(task.object_key)
            await env.DB.prepare(`UPDATE image_cleanup_tasks SET state = 'done', updated_at = ? WHERE id = ?`).bind(nowText, task.id).run()
        } catch (error) {
            await env.DB.prepare(
                `UPDATE image_cleanup_tasks
                 SET attempts = attempts + 1, state = CASE WHEN attempts >= 2 THEN 'failed' ELSE 'pending' END,
                     last_error = ?, updated_at = ?
                 WHERE id = ?`,
            )
                .bind(errorMessage(error), nowText, task.id)
                .run()
        }
    }
}

async function processImageTask(
    env: Bindings,
    message: ImageUploadProcessingMessage,
    now: Date,
): Promise<'ack' | 'retry-capacity' | 'retry-processing'> {
    const leaseId = crypto.randomUUID()
    const leaseExpiresAt = toSqlTimestamp(new Date(now.getTime() + IMAGE_TASK_LEASE_MS))
    const claim = await env.DB.prepare(
        `UPDATE image_processing_tasks
         SET state = 'processing', lease_id = ?, lease_expires_at = ?, updated_at = ?
         WHERE id = ?
           AND state = 'queued'
           AND sharp_attempts < ?
           AND EXISTS (
               SELECT 1 FROM image_upload_jobs
               WHERE id = image_processing_tasks.job_id
                 AND state IN ('queued', 'processing', 'waiting_for_sources')
                 AND deadline_at > ?
           )
         RETURNING id`,
    )
        .bind(leaseId, leaseExpiresAt, toSqlTimestamp(now), message.taskId, IMAGE_TASK_MAX_SHARP_ATTEMPTS, toSqlTimestamp(now))
        .first<{id: string}>()

    if (!claim) {
        return 'ack'
    }

    const task = await readTask(env.DB, message.taskId)

    if (task?.lease_id !== leaseId) return 'ack'

    const source = await env.MEDIA_BUCKET.get(task.source_key)

    if (!source || (!task.recipe.startsWith('gallery-') && source.size > SQUARE_SOURCE_MAX_BYTES)) {
        await failTask(env.DB, task, leaseId, 'source_unavailable', 'The uploaded source is not available.', now)
        return 'ack'
    }

    const startedAt = Date.now()
    if (task.recipe.startsWith('gallery-')) {
        return await processGalleryTask(env, task, leaseId, message, now, startedAt)
    }

    let generated: Awaited<ReturnType<typeof generateSquareImageWithContainer>>
    const sourceBytes = new Uint8Array(await source.arrayBuffer())

    try {
        generated = await generateSquareImageWithContainer(env, sourceBytes, task.id, {
            maxAttempts: 1,
            priority: 'interactive',
        })
    } catch (error) {
        return await handleTaskProcessingError(env.DB, task, leaseId, error, now, startedAt)
    }

    const outputKey = outputObjectKey(task)
    try {
        await retainThumbnailOriginal(env, outputKey, sourceBytes, task.source_content_type)
        await env.MEDIA_BUCKET.put(outputKey, generated.bytes, {
            httpMetadata: {
                cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
                contentType: generated.contentType,
            },
        })
    } catch (error) {
        await Promise.allSettled([env.MEDIA_BUCKET.delete(outputKey), env.MEDIA_BUCKET.delete(thumbnailOriginalObjectKey(outputKey))])
        throw error
    }
    const result = await publishSquareOutput(
        env.DB,
        task,
        leaseId,
        outputKey,
        mediaObjectUrl(env.MEDIA_PUBLIC_BASE_URL, outputKey),
        now,
        Date.now() - startedAt,
    )

    if (!result) {
        const notBefore = toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS))
        const nowText = toSqlTimestamp(now)
        await env.DB.batch([
            env.DB.prepare(
                `INSERT OR IGNORE INTO image_cleanup_tasks (id, job_id, bucket, object_key, state, not_before, created_at, updated_at)
                 VALUES (?, ?, 'media', ?, 'pending', ?, ?, ?)`,
            ).bind(crypto.randomUUID(), task.job_id, outputKey, notBefore, nowText, nowText),
            env.DB.prepare(
                `INSERT OR IGNORE INTO image_cleanup_tasks (id, job_id, bucket, object_key, state, not_before, created_at, updated_at)
                 VALUES (?, ?, 'source', ?, 'pending', ?, ?, ?)`,
            ).bind(crypto.randomUUID(), task.job_id, thumbnailOriginalObjectKey(outputKey), notBefore, nowText, nowText),
        ])
    }

    return 'ack'
}

async function processGalleryTask(
    env: Bindings,
    task: TaskRow,
    leaseId: string,
    _message: ImageUploadProcessingMessage,
    now: Date,
    startedAt: number,
): Promise<'ack' | 'retry-capacity' | 'retry-processing'> {
    if (!task.source_rating || !task.source_width || !task.source_height || task.source_byte_size === null) {
        await failTask(env.DB, task, leaseId, 'source_invalid', 'The uploaded source metadata is invalid.', now)
        return 'ack'
    }

    let generated: Awaited<ReturnType<typeof generateGalleryOutputsWithContainer>>

    try {
        generated = await generateGalleryOutputsWithContainer(
            env,
            async () => {
                const source = await env.MEDIA_BUCKET.get(task.source_key)
                if (!source) throw new PreviewValidationError('Gallery source is not available')
                return source.body
            },
            {width: task.source_width, height: task.source_height},
            task.source_rating === 'nsfw',
            task.id,
            {maxAttempts: 1, priority: 'interactive'},
        )
    } catch (error) {
        return await handleTaskProcessingError(env.DB, task, leaseId, error, now, startedAt)
    }

    const imageKey = fileStem(task.source_key)
    const previewKey = crypto.randomUUID()
    const blurKey = task.source_rating === 'nsfw' ? crypto.randomUUID() : null
    const previewObjectKey = characterMediaPreviewImageObjectKey(
        task.user_id,
        task.target_id,
        galleryMediaId(task),
        previewKey,
        task.source_rating,
        GALLERY_PREVIEW_CONTENT_TYPE,
    )
    const blurObjectKey = blurKey
        ? characterMediaNsfwBlurImageObjectKey(task.user_id, task.target_id, galleryMediaId(task), blurKey, GALLERY_NSFW_BLUR_CONTENT_TYPE)
        : null
    const source = await env.MEDIA_BUCKET.get(task.source_key)

    if (!source) {
        await failTask(env.DB, task, leaseId, 'source_unavailable', 'The uploaded source is not available.', now)
        return 'ack'
    }

    const imageObjectKey = characterMediaImageObjectKey(
        task.user_id,
        task.target_id,
        galleryMediaId(task),
        imageKey,
        task.source_rating,
        task.source_content_type,
    )
    await writeGalleryOutputs(env.MEDIA_BUCKET, task, source.body, imageObjectKey, previewObjectKey, blurObjectKey, generated)

    const output = {
        rating: task.source_rating,
        imageKey,
        imageObjectKey,
        imageContentType: task.source_content_type,
        width: task.source_width,
        height: task.source_height,
        byteSize: task.source_byte_size,
        previewKey,
        previewObjectKey,
        previewWidth: generated.preview.width,
        previewHeight: generated.preview.height,
        previewByteSize: generated.preview.bytes.byteLength,
        blurKey,
        blurObjectKey,
    }
    const attemptNumber = task.sharp_attempts + 1
    const results = await env.DB.batch([
        env.DB.prepare(
            `INSERT INTO image_processing_attempts (
                 id, task_id, attempt_number, container_id, state, duration_ms, created_at, finished_at
             )
             SELECT ?, ?, ?, ?, 'ready', ?, ?, ?
             WHERE EXISTS (
                 SELECT 1 FROM image_processing_tasks
                 WHERE id = ? AND lease_id = ? AND state = 'processing'
             )`,
        ).bind(
            crypto.randomUUID(),
            task.id,
            attemptNumber,
            'myoc-docker-sharp-pool',
            Math.max(0, Date.now() - startedAt),
            toSqlTimestamp(now),
            toSqlTimestamp(now),
            task.id,
            leaseId,
        ),
        env.DB.prepare(
            `UPDATE image_processing_tasks
             SET state = 'ready', sharp_attempts = ?, lease_id = NULL, lease_expires_at = NULL,
                 output_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
             WHERE id = ? AND lease_id = ? AND state = 'processing'`,
        ).bind(attemptNumber, JSON.stringify(output), toSqlTimestamp(now), task.id, leaseId),
    ])

    if ((results as [D1Result, D1Result])[1].meta.changes === 0) {
        await env.MEDIA_BUCKET.delete([imageObjectKey, previewObjectKey])
        if (blurObjectKey) await env.MEDIA_BUCKET.delete(blurObjectKey)
        return 'ack'
    }

    if (!(await publishGalleryJobIfReady(env, task.job_id, now))) {
        const current = await env.DB.prepare(`SELECT state FROM image_upload_jobs WHERE id = ?`).bind(task.job_id).first<{state: string}>()
        if (current?.state === 'canceled') await queueGalleryOutputCleanup(env.DB, task.job_id, output, now)
    }

    return 'ack'
}

type GalleryTaskOutput = {
    rating: 'sfw' | 'nsfw'
    imageKey: string
    imageObjectKey: string
    imageContentType: string
    width: number
    height: number
    byteSize: number
    previewKey: string
    previewObjectKey: string
    previewWidth: number
    previewHeight: number
    previewByteSize: number
    blurKey: string | null
    blurObjectKey: string | null
}

async function writeGalleryOutputs(
    bucket: R2Bucket,
    task: TaskRow,
    source: ReadableStream,
    imageObjectKey: string,
    previewObjectKey: string,
    blurObjectKey: string | null,
    generated: Awaited<ReturnType<typeof generateGalleryOutputsWithContainer>>,
): Promise<void> {
    const blur = generated.blur
    await Promise.all([
        Promise.resolve().then(() =>
            bucket.put(imageObjectKey, source, {
                httpMetadata: {cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL, contentType: task.source_content_type},
            }),
        ),
        Promise.resolve().then(() =>
            bucket.put(previewObjectKey, generated.preview.bytes, {
                httpMetadata: {cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL, contentType: GALLERY_PREVIEW_CONTENT_TYPE},
            }),
        ),
        ...(blurObjectKey && blur
            ? [
                  Promise.resolve().then(() =>
                      bucket.put(blurObjectKey, blur.bytes, {
                          httpMetadata: {cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL, contentType: GALLERY_NSFW_BLUR_CONTENT_TYPE},
                      }),
                  ),
              ]
            : []),
    ])
}

async function handleTaskProcessingError(
    db: D1Database,
    task: TaskRow,
    leaseId: string,
    error: unknown,
    now: Date,
    startedAt: number,
): Promise<'ack' | 'retry-capacity' | 'retry-processing'> {
    if (error instanceof PreviewContainerBusyError) {
        await releaseTaskLease(db, task.id, leaseId, now)
        return 'retry-capacity'
    }

    const attemptNumber = task.sharp_attempts + 1
    const terminal = error instanceof PreviewValidationError || attemptNumber >= IMAGE_TASK_MAX_SHARP_ATTEMPTS
    await recordFailedAttempt(db, task, leaseId, attemptNumber, error, terminal, now, Date.now() - startedAt)
    return terminal ? 'ack' : 'retry-processing'
}

async function publishGalleryJobIfReady(env: Bindings, jobId: string, now: Date): Promise<boolean> {
    const job = await env.DB.prepare(
        `SELECT id, user_id, batch_id, target_type, target_id, state, generation, idempotency_key,
                    last_retry_idempotency_key, request_json, result_json, error_code, error_message,
                    deadline_at, created_at, updated_at
             FROM image_upload_jobs
             WHERE id = ?`,
    )
        .bind(jobId)
        .first<JobRow>()

    if (job?.target_type !== 'gallery_create' || !['queued', 'processing', 'waiting_for_sources'].includes(job.state)) {
        return false
    }

    const pending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM image_processing_tasks WHERE job_id = ? AND state != 'ready'`)
        .bind(jobId)
        .first<number>('count')

    if (Number(pending) !== 0) {
        await env.DB.prepare(
            `UPDATE image_upload_jobs SET state = 'waiting_for_sources', updated_at = ? WHERE id = ? AND state != 'canceled'`,
        )
            .bind(toSqlTimestamp(now), jobId)
            .run()
        return false
    }

    const tasks = await env.DB.prepare(`SELECT output_json FROM image_processing_tasks WHERE job_id = ? AND state = 'ready' ORDER BY id`)
        .bind(jobId)
        .all<{output_json: string}>()
    const outputs = tasks.results.map((row) => JSON.parse(row.output_json) as GalleryTaskOutput)
    const sfw = outputs.find((output) => output.rating === 'sfw') ?? null
    const nsfw = outputs.find((output) => output.rating === 'nsfw') ?? null
    const sfwInsert = galleryInsertVariant(sfw)
    const nsfwInsert = galleryInsertVariant(nsfw)
    const request = JSON.parse(job.request_json) as {
        mediaId: string
        sfwArtist: string
        nsfwArtist: string
    }
    const nowText = toSqlTimestamp(now)
    const media = galleryPublicResult(env.MEDIA_PUBLIC_BASE_URL, job, request, sfw, nsfw, nowText)
    const results = await env.DB.batch([
        env.DB.prepare(
            `INSERT INTO character_media (
                 id, user_id, character_id, sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type,
                 sfw_artist, nsfw_artist, sfw_width, sfw_height, sfw_byte_size,
                 sfw_preview_image_key, sfw_preview_content_type, sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                 nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key, nsfw_preview_content_type,
                 nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                 nsfw_blur_image_key, nsfw_blur_content_type, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
                 SELECT 1 FROM image_upload_jobs
                 WHERE id = ? AND generation = ? AND state IN ('queued', 'processing', 'waiting_for_sources')
             )`,
        ).bind(
            request.mediaId,
            job.user_id,
            job.target_id,
            sfwInsert.imageKey,
            nsfwInsert.imageKey,
            sfwInsert.imageContentType,
            nsfwInsert.imageContentType,
            request.sfwArtist,
            request.nsfwArtist,
            sfwInsert.width,
            sfwInsert.height,
            sfwInsert.byteSize,
            sfwInsert.previewKey,
            GALLERY_PREVIEW_CONTENT_TYPE,
            sfwInsert.previewWidth,
            sfwInsert.previewHeight,
            sfwInsert.previewByteSize,
            nsfwInsert.width,
            nsfwInsert.height,
            nsfwInsert.byteSize,
            nsfwInsert.previewKey,
            GALLERY_PREVIEW_CONTENT_TYPE,
            nsfwInsert.previewWidth,
            nsfwInsert.previewHeight,
            nsfwInsert.previewByteSize,
            nsfwInsert.blurKey,
            GALLERY_NSFW_BLUR_CONTENT_TYPE,
            nowText,
            nowText,
            job.id,
            job.generation,
        ),
        env.DB.prepare(
            `INSERT OR IGNORE INTO admin_image_review_queue (media_id, created_at, queued_at)
             SELECT id, created_at, ? FROM character_media WHERE id = ?`,
        ).bind(nowText, request.mediaId),
        env.DB.prepare(
            `UPDATE image_upload_jobs
             SET state = 'ready', result_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
             WHERE id = ? AND generation = ? AND state IN ('queued', 'processing', 'waiting_for_sources')`,
        ).bind(JSON.stringify({media}), nowText, job.id, job.generation),
        successfulSourceCleanupStatement(env.DB, job.id, job.generation, now),
    ])
    const [mediaResult, , jobResult] = results as [D1Result, D1Result, D1Result, ...D1Result[]]
    return mediaResult.meta.changes > 0 && jobResult.meta.changes > 0
}

type GalleryInsertVariant = {
    imageKey: string | null
    imageContentType: string | null
    width: number | null
    height: number | null
    byteSize: number | null
    previewKey: string | null
    previewWidth: number | null
    previewHeight: number | null
    previewByteSize: number | null
    blurKey: string | null
}

function galleryInsertVariant(output: GalleryTaskOutput | null): GalleryInsertVariant {
    if (!output) {
        return {
            imageKey: null,
            imageContentType: null,
            width: null,
            height: null,
            byteSize: null,
            previewKey: null,
            previewWidth: null,
            previewHeight: null,
            previewByteSize: null,
            blurKey: null,
        }
    }

    return output
}

function galleryPublicResult(
    baseUrl: string,
    job: JobRow,
    request: {mediaId: string; sfwArtist: string; nsfwArtist: string},
    sfw: GalleryTaskOutput | null,
    nsfw: GalleryTaskOutput | null,
    now: string,
): Record<string, unknown> {
    const sfwResult = galleryPublicVariant(baseUrl, job, request.mediaId, sfw)
    const nsfwResult = galleryPublicVariant(baseUrl, job, request.mediaId, nsfw)

    return {
        id: request.mediaId,
        sfwImageKey: sfwResult.imageKey,
        nsfwImageKey: nsfwResult.imageKey,
        sfwContentType: sfwResult.imageContentType,
        nsfwContentType: nsfwResult.imageContentType,
        sfwImageUrl: sfwResult.imageUrl,
        nsfwImageUrl: nsfwResult.imageUrl,
        sfwPreviewImageKey: sfwResult.previewKey,
        nsfwPreviewImageKey: nsfwResult.previewKey,
        nsfwBlurImageKey: nsfwResult.blurKey,
        sfwPreviewImageUrl: sfwResult.previewUrl,
        nsfwPreviewImageUrl: nsfwResult.previewUrl,
        nsfwBlurImageUrl: nsfwResult.blurUrl,
        sfwArtist: request.sfwArtist,
        nsfwArtist: request.nsfwArtist,
        sfwWidth: sfwResult.width,
        sfwHeight: sfwResult.height,
        sfwByteSize: sfwResult.byteSize,
        nsfwWidth: nsfwResult.width,
        nsfwHeight: nsfwResult.height,
        nsfwByteSize: nsfwResult.byteSize,
        sfwPreviewWidth: sfwResult.previewWidth,
        sfwPreviewHeight: sfwResult.previewHeight,
        sfwPreviewByteSize: sfwResult.previewByteSize,
        nsfwPreviewWidth: nsfwResult.previewWidth,
        nsfwPreviewHeight: nsfwResult.previewHeight,
        nsfwPreviewByteSize: nsfwResult.previewByteSize,
        createdAt: now,
        updatedAt: now,
    }
}

type GalleryPublicVariant = GalleryInsertVariant & {
    imageUrl: string | null
    previewUrl: string | null
    blurUrl: string | null
}

function galleryPublicVariant(baseUrl: string, job: JobRow, mediaId: string, output: GalleryTaskOutput | null): GalleryPublicVariant {
    const values = galleryInsertVariant(output)

    if (!output) {
        return {...values, imageUrl: null, previewUrl: null, blurUrl: null}
    }

    return {
        ...values,
        imageUrl: characterMediaImageUrl(
            baseUrl,
            job.user_id,
            job.target_id,
            mediaId,
            output.imageKey,
            output.rating,
            output.imageContentType,
        ),
        previewUrl: characterMediaPreviewImageUrl(
            baseUrl,
            job.user_id,
            job.target_id,
            mediaId,
            output.previewKey,
            output.rating,
            GALLERY_PREVIEW_CONTENT_TYPE,
        ),
        blurUrl: output.blurKey
            ? characterMediaNsfwBlurImageUrl(baseUrl, job.user_id, job.target_id, mediaId, output.blurKey, GALLERY_NSFW_BLUR_CONTENT_TYPE)
            : null,
    }
}

async function queueGalleryOutputCleanup(db: D1Database, jobId: string, output: GalleryTaskOutput, now: Date): Promise<void> {
    const keys = [output.imageObjectKey, output.previewObjectKey, output.blurObjectKey].filter((key): key is string => Boolean(key))
    const notBefore = toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS))
    await db.batch(
        keys.map((key) =>
            db
                .prepare(
                    `INSERT OR IGNORE INTO image_cleanup_tasks (
                     id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                 ) VALUES (?, ?, 'media', ?, 'pending', ?, ?, ?)`,
                )
                .bind(crypto.randomUUID(), jobId, key, notBefore, toSqlTimestamp(now), toSqlTimestamp(now)),
        ),
    )
}

function galleryMediaId(task: TaskRow): string {
    const request = JSON.parse(task.request_json) as {mediaId: string}
    return request.mediaId
}

function fileStem(key: string): string {
    const file = key.slice(key.lastIndexOf('/') + 1)
    return file.replace(/\.[^.]+$/, '')
}

function successfulSourceCleanupStatement(db: D1Database, jobId: string, generation: number, now: Date): D1PreparedStatement {
    const nowText = toSqlTimestamp(now)
    return db
        .prepare(
            `INSERT OR IGNORE INTO image_cleanup_tasks (
                 id, job_id, bucket, object_key, state, not_before, created_at, updated_at
             )
             SELECT lower(hex(randomblob(16))), sources.job_id, 'source', sources.object_key,
                    'pending', ?, ?, ?
             FROM image_upload_sources AS sources
             JOIN image_upload_jobs AS jobs ON jobs.id = sources.job_id
             WHERE jobs.id = ? AND jobs.generation = ? AND jobs.state = 'ready'`,
        )
        .bind(toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS)), nowText, nowText, jobId, generation)
}

async function publishSquareOutput(
    db: D1Database,
    task: TaskRow,
    leaseId: string,
    outputKey: string,
    outputUrl: string,
    now: Date,
    durationMs: number,
): Promise<boolean> {
    const key = fileStem(outputKey)
    const old = await currentTargetImage(db, task)
    const targetUpdate = targetUpdateStatement(db, task, leaseId, key, now)
    const attemptNumber = task.sharp_attempts + 1
    const resultJson = JSON.stringify({contentType: 'image/avif', key, objectKey: outputKey, url: outputUrl})
    const statements = [
        targetUpdate,
        // changes() checks the target update immediately before this statement in the batch.
        db
            .prepare(
                `UPDATE image_processing_tasks
             SET state = 'ready', sharp_attempts = ?, lease_id = NULL, lease_expires_at = NULL,
                 output_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
             WHERE id = ? AND lease_id = ? AND state = 'processing' AND changes() = 1`,
            )
            .bind(attemptNumber, resultJson, toSqlTimestamp(now), task.id, leaseId),
        db
            .prepare(
                `INSERT INTO image_processing_attempts (
                     id, task_id, attempt_number, container_id, state, duration_ms, created_at, finished_at
                 )
                 SELECT ?, ?, ?, ?, 'ready', ?, ?, ?
                 WHERE EXISTS (
                     SELECT 1 FROM image_processing_tasks
                     WHERE id = ? AND state = 'ready' AND output_json = ?
                 )`,
            )
            .bind(
                crypto.randomUUID(),
                task.id,
                attemptNumber,
                'myoc-docker-sharp-pool',
                Math.max(0, durationMs),
                toSqlTimestamp(now),
                toSqlTimestamp(now),
                task.id,
                resultJson,
            ),
        db
            .prepare(
                `UPDATE image_upload_jobs
             SET state = 'ready', result_json = ?, error_code = NULL, error_message = NULL, updated_at = ?
             WHERE id = ? AND generation = ? AND state IN ('queued', 'processing', 'waiting_for_sources')
               AND EXISTS (
                   SELECT 1 FROM image_processing_tasks
                   WHERE id = ? AND state = 'ready' AND output_json = ?
               )`,
            )
            .bind(resultJson, toSqlTimestamp(now), task.job_id, task.generation, task.id, resultJson),
        successfulSourceCleanupStatement(db, task.job_id, task.generation, now),
    ]

    if (old) {
        statements.push(
            db
                .prepare(
                    `INSERT OR IGNORE INTO image_cleanup_tasks (
                     id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                 )
                 SELECT ?, ?, 'media', ?, 'pending', ?, ?, ?
                 WHERE EXISTS (
                     SELECT 1 FROM image_upload_jobs
                     WHERE id = ? AND state = 'ready' AND result_json = ?
                 )`,
                )
                .bind(
                    crypto.randomUUID(),
                    task.job_id,
                    old,
                    toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS)),
                    toSqlTimestamp(now),
                    toSqlTimestamp(now),
                    task.job_id,
                    resultJson,
                ),
            db
                .prepare(
                    `INSERT OR IGNORE INTO image_cleanup_tasks (
                     id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                 )
                 SELECT ?, ?, 'source', ?, 'pending', ?, ?, ?
                 WHERE EXISTS (
                     SELECT 1 FROM image_upload_jobs
                     WHERE id = ? AND state = 'ready' AND result_json = ?
                 )`,
                )
                .bind(
                    crypto.randomUUID(),
                    task.job_id,
                    thumbnailOriginalObjectKey(old),
                    toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS)),
                    toSqlTimestamp(now),
                    toSqlTimestamp(now),
                    task.job_id,
                    resultJson,
                ),
        )
    }

    const results = await db.batch(statements)
    const [targetResult, , , jobResult] = results as [D1Result, D1Result, D1Result, D1Result, ...D1Result[]]
    return targetResult.meta.changes > 0 && jobResult.meta.changes > 0
}

function targetUpdateStatement(db: D1Database, task: TaskRow, leaseId: string, key: string, now: Date): D1PreparedStatement {
    const nowText = toSqlTimestamp(now)

    if (task.target_type === 'user_profile') {
        return db
            .prepare(
                `UPDATE users
                 SET profile_photo_key = ?, profile_photo_content_type = 'image/avif'
                 WHERE id = ?
                   AND EXISTS (SELECT 1 FROM image_upload_jobs WHERE id = ? AND generation = ? AND state != 'canceled')
                   AND EXISTS (
                       SELECT 1 FROM image_processing_tasks
                       WHERE id = ? AND lease_id = ? AND state = 'processing'
                   )`,
            )
            .bind(key, task.user_id, task.job_id, task.generation, task.id, leaseId)
    }

    if (task.target_type === 'character_profile') {
        return db
            .prepare(
                `UPDATE characters
                 SET profile_image_key = ?, profile_image_content_type = 'image/avif', updated_at = ?
                 WHERE id = ? AND user_id = ?
                   AND EXISTS (SELECT 1 FROM image_upload_jobs WHERE id = ? AND generation = ? AND state != 'canceled')
                   AND EXISTS (
                       SELECT 1 FROM image_processing_tasks
                       WHERE id = ? AND lease_id = ? AND state = 'processing'
                   )`,
            )
            .bind(key, nowText, task.target_id, task.user_id, task.job_id, task.generation, task.id, leaseId)
    }

    return db
        .prepare(
            `UPDATE character_folders
             SET folder_image_key = ?, folder_image_content_type = 'image/avif', updated_at = ?
             WHERE id = ? AND user_id = ?
               AND EXISTS (SELECT 1 FROM image_upload_jobs WHERE id = ? AND generation = ? AND state != 'canceled')
               AND EXISTS (
                   SELECT 1 FROM image_processing_tasks
                   WHERE id = ? AND lease_id = ? AND state = 'processing'
               )`,
        )
        .bind(key, nowText, task.target_id, task.user_id, task.job_id, task.generation, task.id, leaseId)
}

async function currentTargetImage(db: D1Database, task: TaskRow): Promise<string | null> {
    if (task.target_type === 'user_profile') {
        const row = await db
            .prepare(`SELECT profile_photo_key AS image_key FROM users WHERE id = ?`)
            .bind(task.user_id)
            .first<{image_key: string | null}>()
        return row?.image_key ? profilePhotoObjectKey(task.user_id, row.image_key) : null
    }

    if (task.target_type === 'character_profile') {
        const row = await db
            .prepare(`SELECT profile_image_key AS image_key FROM characters WHERE id = ? AND user_id = ?`)
            .bind(task.target_id, task.user_id)
            .first<{image_key: string | null}>()
        return row?.image_key ? characterProfileImageObjectKey(task.user_id, task.target_id, row.image_key) : null
    }

    const row = await db
        .prepare(`SELECT folder_image_key AS image_key FROM character_folders WHERE id = ? AND user_id = ?`)
        .bind(task.target_id, task.user_id)
        .first<{image_key: string | null}>()
    return row?.image_key ? characterFolderImageObjectKey(task.user_id, task.target_id, row.image_key) : null
}

function outputObjectKey(task: TaskRow): string {
    const key = `avif-${crypto.randomUUID()}`

    if (task.target_type === 'user_profile') {
        return profilePhotoObjectKey(task.user_id, key)
    }

    if (task.target_type === 'character_profile') {
        return characterProfileImageObjectKey(task.user_id, task.target_id, key)
    }

    return characterFolderImageObjectKey(task.user_id, task.target_id, key)
}

async function readTask(db: D1Database, taskId: string): Promise<TaskRow | null> {
    return await db
        .prepare(
            `SELECT tasks.*, sources.object_key AS source_key, sources.content_type AS source_content_type,
                    sources.byte_size AS source_byte_size, sources.width AS source_width,
                    sources.height AS source_height, sources.rating AS source_rating,
                    jobs.user_id, jobs.target_id, jobs.target_type, jobs.generation, jobs.state AS job_state,
                    jobs.request_json
             FROM image_processing_tasks AS tasks
             JOIN image_upload_sources AS sources ON sources.id = tasks.source_id
             JOIN image_upload_jobs AS jobs ON jobs.id = tasks.job_id
             WHERE tasks.id = ?`,
        )
        .bind(taskId)
        .first<TaskRow>()
}

async function releaseTaskLease(db: D1Database, taskId: string, leaseId: string, now: Date): Promise<void> {
    await db
        .prepare(
            `UPDATE image_processing_tasks
         SET state = 'queued', lease_id = NULL, lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND lease_id = ? AND state = 'processing'`,
        )
        .bind(toSqlTimestamp(now), taskId, leaseId)
        .run()
}

async function recordFailedAttempt(
    db: D1Database,
    task: TaskRow,
    leaseId: string,
    attemptNumber: number,
    error: unknown,
    terminal: boolean,
    now: Date,
    durationMs: number,
): Promise<void> {
    const code = error instanceof PreviewValidationError ? 'invalid_image' : 'processor_failed'
    const message = code === 'invalid_image' ? 'The image could not be processed.' : 'Image processing failed. Try again.'
    const nextState = terminal ? 'failed' : 'queued'
    const statements = [
        db
            .prepare(
                `INSERT INTO image_processing_attempts (
                 id, task_id, attempt_number, container_id, state, error_code, duration_ms, created_at, finished_at
             )
             SELECT ?, ?, ?, ?, 'failed', ?, ?, ?, ?
             WHERE EXISTS (
                 SELECT 1 FROM image_processing_tasks
                 WHERE id = ? AND lease_id = ? AND state = 'processing'
             )`,
            )
            .bind(
                crypto.randomUUID(),
                task.id,
                attemptNumber,
                'myoc-docker-sharp-pool',
                code,
                Math.max(0, durationMs),
                toSqlTimestamp(now),
                toSqlTimestamp(now),
                task.id,
                leaseId,
            ),
        db
            .prepare(
                `UPDATE image_processing_tasks
             SET state = ?, sharp_attempts = ?, lease_id = NULL, lease_expires_at = NULL,
                 error_code = ?, error_message = ?,
                 failure_event_id = CASE WHEN ? THEN run_id END,
                 failure_reported_at = NULL, updated_at = ?
             WHERE id = ? AND lease_id = ? AND state = 'processing'`,
            )
            .bind(nextState, attemptNumber, code, message, Number(terminal), toSqlTimestamp(now), task.id, leaseId),
    ]

    if (terminal) {
        statements.push(
            db
                .prepare(
                    `UPDATE image_upload_jobs
                 SET state = 'failed', error_code = ?, error_message = ?, updated_at = ?
                 WHERE id = ? AND state IN ('queued', 'processing', 'waiting_for_sources')
                   AND EXISTS (
                       SELECT 1 FROM image_processing_tasks
                       WHERE id = ? AND state = 'failed' AND failure_event_id = ?
                   )`,
                )
                .bind(code, message, toSqlTimestamp(now), task.job_id, task.id, task.run_id),
        )
    }

    await db.batch(statements)
}

async function failTask(db: D1Database, task: TaskRow, leaseId: string, code: string, message: string, now: Date): Promise<void> {
    await db.batch([
        db
            .prepare(
                `UPDATE image_processing_tasks
             SET state = 'failed', lease_id = NULL, lease_expires_at = NULL,
                 error_code = ?, error_message = ?, failure_event_id = run_id,
                 failure_reported_at = NULL, updated_at = ?
             WHERE id = ? AND lease_id = ?`,
            )
            .bind(code, message, toSqlTimestamp(now), task.id, leaseId),
        db
            .prepare(
                `UPDATE image_upload_jobs
             SET state = 'failed', error_code = ?, error_message = ?, updated_at = ?
             WHERE id = ? AND state IN ('queued', 'processing', 'waiting_for_sources')
               AND EXISTS (
                   SELECT 1 FROM image_processing_tasks
                   WHERE id = ? AND state = 'failed' AND failure_event_id = ?
               )`,
            )
            .bind(code, message, toSqlTimestamp(now), task.job_id, task.id, task.run_id),
    ])
}

async function reportPendingImageTaskFailures(
    env: Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_DLQ'>,
    filter: {jobId?: string; taskId?: string} = {},
): Promise<void> {
    const conditions = ["state = 'failed'", 'failure_event_id IS NOT NULL', 'failure_reported_at IS NULL']
    const values: string[] = []

    if (filter.jobId) {
        conditions.push('job_id = ?')
        values.push(filter.jobId)
    }

    if (filter.taskId) {
        conditions.push('id = ?')
        values.push(filter.taskId)
    }

    const failures = await env.DB.prepare(
        `SELECT id, job_id, run_id, failure_event_id, error_code, error_message
         FROM image_processing_tasks
         WHERE ${conditions.join(' AND ')}
         ORDER BY updated_at, id
         LIMIT ?`,
    )
        .bind(...values, IMAGE_UPLOAD_RECONCILE_LIMIT)
        .all<FailedTaskReportRow>()

    for (const failure of failures.results) {
        try {
            await recordAdminErrorLog(env.DB, {
                source: 'image-processing',
                messageId: failure.failure_event_id,
                jobId: failure.job_id,
                taskId: failure.id,
                errorCode: failure.error_code,
                errorMessage: failure.error_message,
            })
            await env.IMAGE_PROCESSING_DLQ.send(
                {
                    version: 1,
                    kind: 'upload',
                    taskId: failure.id,
                    failureId: failure.failure_event_id,
                    jobId: failure.job_id,
                    errorCode: failure.error_code,
                    error: failure.error_message.slice(0, 2_000),
                } satisfies ImageProcessingFailureMessage,
                {contentType: 'json'},
            )
            await env.DB.prepare(
                `UPDATE image_processing_tasks
                 SET failure_reported_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND state = 'failed' AND failure_event_id = ? AND failure_reported_at IS NULL`,
            )
                .bind(failure.id, failure.failure_event_id)
                .run()
        } catch (error) {
            console.error(
                JSON.stringify({
                    event: 'image_task_failure_report_failed',
                    taskId: failure.id,
                    failureId: failure.failure_event_id,
                    error: errorMessage(error),
                }),
            )
        }
    }
}

async function getOwnedImageUploadJob(db: D1Database, userId: string, jobId: string): Promise<JobRow | null> {
    return await db
        .prepare(
            `SELECT id, user_id, batch_id, target_type, target_id, state, generation, idempotency_key,
                    last_retry_idempotency_key, request_json, result_json, error_code, error_message,
                    deadline_at, created_at, updated_at
             FROM image_upload_jobs
             WHERE id = ? AND user_id = ?`,
        )
        .bind(jobId, userId)
        .first<JobRow>()
}

function statusFromRow(row: JobRow): ImageUploadStatus {
    const request = JSON.parse(row.request_json) as {kind: ImageUploadKind}
    return {
        id: row.id,
        batchId: row.batch_id,
        state: publicState(row.state),
        kind: request.kind,
        result: row.result_json ? (JSON.parse(row.result_json) as Record<string, unknown>) : null,
        error: row.error_code && row.error_message ? {code: row.error_code, message: row.error_message} : null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }
}

function publicState(state: ImageUploadInternalState): ImageUploadStatus['state'] {
    if (state === 'uploading') return 'uploading'
    if (state === 'processing' || state === 'publishing') return 'processing'
    if (state === 'ready' || state === 'failed' || state === 'canceled') return state
    return 'waiting'
}

function validateSquareSource(bytes: Uint8Array): void {
    if (bytes.byteLength === 0 || bytes.byteLength > SQUARE_SOURCE_MAX_BYTES) {
        throw new ImageUploadValidationError('The cropped PNG must be 3 MB or smaller')
    }

    const dimensions = readGalleryImageDimensions(bytes, 'image/png')

    if (dimensions?.width !== 512 || dimensions.height !== 512) {
        throw new ImageUploadValidationError('The cropped PNG must be exactly 512x512 pixels')
    }
}

async function assertOwnedTarget(db: D1Database, userId: string, targetType: JobRow['target_type'], targetId: string): Promise<void> {
    if (targetType === 'user_profile') {
        if (targetId !== userId) throw new ImageUploadValidationError('The profile target is invalid')
        return
    }

    const row = await (targetType === 'character_profile' || targetType === 'gallery_create' || targetType === 'gallery_replace'
        ? db.prepare(`SELECT id FROM characters WHERE id = ? AND user_id = ?`)
        : db.prepare(`SELECT id FROM character_folders WHERE id = ? AND user_id = ?`)
    )
        .bind(targetId, userId)
        .first<{id: string}>()

    if (!row) {
        throw new ImageUploadValidationError(targetType === 'character_profile' ? 'Character not found' : 'Folder not found')
    }
}

function targetTypeForKind(kind: Exclude<ImageUploadKind, 'gallery'>): JobRow['target_type'] {
    if (kind === 'user-profile') return 'user_profile'
    if (kind === 'character-profile') return 'character_profile'
    return 'folder_image'
}

function recipeForKind(kind: Exclude<ImageUploadKind, 'gallery'>): TaskRow['recipe'] {
    if (kind === 'user-profile') return 'user-profile-v1'
    if (kind === 'character-profile') return 'character-profile-v1'
    return 'folder-image-v1'
}

function cleanupStatementsForOutput(db: D1Database, jobId: string, outputJson: string, now: Date): D1PreparedStatement[] {
    const parsed = JSON.parse(outputJson) as {objectKey?: unknown}
    return typeof parsed.objectKey === 'string'
        ? [
              db
                  .prepare(
                      `INSERT OR IGNORE INTO image_cleanup_tasks (
                       id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                   ) VALUES (?, ?, 'media', ?, 'pending', ?, ?, ?)`,
                  )
                  .bind(
                      crypto.randomUUID(),
                      jobId,
                      parsed.objectKey,
                      toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS)),
                      toSqlTimestamp(now),
                      toSqlTimestamp(now),
                  ),
              db
                  .prepare(
                      `INSERT OR IGNORE INTO image_cleanup_tasks (
                       id, job_id, bucket, object_key, state, not_before, created_at, updated_at
                   ) VALUES (?, ?, 'source', ?, 'pending', ?, ?, ?)`,
                  )
                  .bind(
                      crypto.randomUUID(),
                      jobId,
                      thumbnailOriginalObjectKey(parsed.objectKey),
                      toSqlTimestamp(new Date(now.getTime() + IMAGE_CLEANUP_GRACE_MS)),
                      toSqlTimestamp(now),
                      toSqlTimestamp(now),
                  ),
          ]
        : []
}

function errorMessage(error: unknown): string {
    return (error instanceof Error && error.message ? error.message : String(error)).slice(0, 2_000)
}

function mediaObjectUrl(baseUrl: string, key: string): string {
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    return `${baseUrl.replace(/\/+$/, '')}/${encodedKey}`
}
