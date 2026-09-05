import type {Bindings} from '../../types/bindings'
import type {MediaPreviewRegenerationCandidate, MediaPreviewRegenerationMessage} from '../../types/mediaPreviewQueue'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../media/cacheControl'
import {readGalleryImageMetadata} from '../media/imageMetadata'
import {
    GALLERY_NSFW_BLUR_CONTENT_TYPE,
    GALLERY_PREVIEW_CONTENT_TYPE,
    type GeneratedGalleryPreview,
    generateMediaPreviewWithContainer,
    generateNsfwBlurImage,
} from '../media/previewGeneration'
import {deleteR2Objects} from '../media/r2Delete'
import {
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaPreviewImageObjectKey,
} from '../media/url'

export const MEDIA_PREVIEW_REGENERATION_BATCH_SIZE = 100
export const MEDIA_PREVIEW_REGENERATION_BATCHES_PER_WORKFLOW = 2
const LEGACY_MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW = 250
const GALLERY_IMAGE_DIMENSION_PROBE_BYTES = 1024 * 1024

export type MediaPreviewRegenerationSummary = {
    totalVariants: number
    processedVariants: number
    regeneratedPreviews: number
    regeneratedBlurs: number
    skippedVariants: number
    failedVariants: number
    lastError: string | null
}

export type MediaPreviewRegenerationCursor = {
    mediaId: string
    ratingOrder: number
}

export function mediaPreviewRegenerationWorkflowInstanceId(runId: string, segment: number): string {
    return segment === 0 ? runId : `${runId}-segment-${segment}`
}

export function activeMediaPreviewRegenerationWorkflowInstanceIds(runId: string, processedVariants: number): string[] {
    const segment = Math.floor(processedVariants / LEGACY_MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW)
    const currentId = mediaPreviewRegenerationWorkflowInstanceId(runId, segment)

    if (segment === 0 || processedVariants % LEGACY_MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW !== 0) {
        return [currentId]
    }

    return [mediaPreviewRegenerationWorkflowInstanceId(runId, segment - 1), currentId]
}

export type MediaPreviewRegenerationResult = {
    status: 'regenerated' | 'skipped' | 'failed'
    regeneratedBlur: boolean
    error: string | null
}

type MediaPreviewRegenerationEnv = Pick<
    Bindings,
    'DB' | 'MEDIA_BUCKET' | 'MEDIA_PUBLIC_BASE_URL' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'
>

type MediaPreviewRegenerationOptions = {
    containerIndex?: number
    maxContainerAttempts?: number
}

export type MediaPreviewRegenerationItemStatus = MediaPreviewRegenerationResult['status'] | 'pending' | 'processing'

export type ClaimedMediaPreviewRegenerationTask = {
    candidateJson: string
    containerSlot: 0 | 1 | 2
    leaseId: string
    runId: string
}

type MediaPreviewRegenerationQueues = Pick<
    Bindings,
    'MEDIA_PREVIEW_REGENERATION_QUEUE_0' | 'MEDIA_PREVIEW_REGENERATION_QUEUE_1' | 'MEDIA_PREVIEW_REGENERATION_QUEUE_2'
>

type CandidateRow = {
    media_id: string
    user_id: string
    character_id: string
    rating: 'sfw' | 'nsfw'
    rating_order: number
    image_key: string
    image_content_type: string | null
    preview_key: string | null
    preview_content_type: string
    blur_key: string | null
    blur_content_type: string
}

export function emptyMediaPreviewRegenerationSummary(): MediaPreviewRegenerationSummary {
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

async function initializeMediaPreviewRegenerationSummary(db: D1Database): Promise<MediaPreviewRegenerationSummary> {
    const totalVariants = await db
        .prepare(
            `SELECT COALESCE(SUM(
                        CASE WHEN sfw_image_key IS NOT NULL THEN 1 ELSE 0 END +
                        CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                    ), 0) AS total_variants
             FROM character_media`,
        )
        .first<number>('total_variants')

    return {
        ...emptyMediaPreviewRegenerationSummary(),
        totalVariants: Math.max(0, Number(totalVariants)),
    }
}

export async function initializeMediaPreviewRegenerationDispatch(db: D1Database, runId: string): Promise<MediaPreviewRegenerationSummary> {
    const summary = await initializeMediaPreviewRegenerationSummary(db)
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
                   AND status = 'running'`,
            )
            .bind(JSON.stringify(summary), runId),
    ])
    return summary
}

export async function enqueueMediaPreviewRegenerationCandidates(
    db: D1Database,
    queues: MediaPreviewRegenerationQueues,
    runId: string,
    candidates: MediaPreviewRegenerationCandidate[],
    firstContainerSlot: 0 | 1 | 2,
): Promise<0 | 1 | 2> {
    if (candidates.length === 0) {
        return firstContainerSlot
    }

    const tasks = candidates.map((candidate, index) => {
        const containerSlot = ((firstContainerSlot + index) % 3) as 0 | 1 | 2
        return {
            candidate,
            message: {
                version: 1 as const,
                taskId: `${runId}:${candidate.mediaId}:${candidate.rating}`,
                runId,
                containerSlot,
            },
        }
    })
    await db.batch(
        tasks.map(({candidate, message}) =>
            db
                .prepare(
                    `INSERT INTO media_preview_regeneration_items (
                         task_id, run_id, media_id, rating, container_slot, candidate_json
                     )
                     VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(run_id, media_id, rating) DO NOTHING`,
                )
                .bind(message.taskId, runId, candidate.mediaId, candidate.rating, message.containerSlot, JSON.stringify(candidate)),
        ),
    )
    await Promise.all(
        ([0, 1, 2] as const).map(async (containerSlot) => {
            const messages = tasks
                .filter((task) => task.message.containerSlot === containerSlot)
                .map((task) => ({body: task.message satisfies MediaPreviewRegenerationMessage}))

            if (messages.length > 0) {
                await mediaPreviewRegenerationQueue(queues, containerSlot).sendBatch(messages)
            }
        }),
    )

    return ((firstContainerSlot + candidates.length) % 3) as 0 | 1 | 2
}

function mediaPreviewRegenerationQueue(queues: MediaPreviewRegenerationQueues, containerSlot: 0 | 1 | 2) {
    if (containerSlot === 0) return queues.MEDIA_PREVIEW_REGENERATION_QUEUE_0
    if (containerSlot === 1) return queues.MEDIA_PREVIEW_REGENERATION_QUEUE_1
    return queues.MEDIA_PREVIEW_REGENERATION_QUEUE_2
}

export async function completeMediaPreviewRegenerationDispatch(db: D1Database, runId: string): Promise<void> {
    const completedAt = new Date().toISOString().replace('T', ' ').replace('Z', '')
    await db.batch([
        db
            .prepare(
                `UPDATE media_preview_regeneration_runs
                 SET dispatch_complete = 1,
                     enqueued_items = (
                         SELECT COUNT(*)
                         FROM media_preview_regeneration_items
                         WHERE run_id = ?
                     )
                 WHERE run_id = ?`,
            )
            .bind(runId, runId),
        db
            .prepare(
                `UPDATE admin_job_runs
                 SET summary_json = json_set(
                         summary_json,
                         '$.totalVariants', (
                             SELECT enqueued_items
                             FROM media_preview_regeneration_runs
                             WHERE run_id = ?
                         )
                     ),
                     status = CASE
                         WHEN COALESCE(json_extract(summary_json, '$.processedVariants'), 0) >= (
                             SELECT enqueued_items
                             FROM media_preview_regeneration_runs
                             WHERE run_id = ?
                         ) THEN 'success'
                         ELSE status
                     END,
                     finished_at = CASE
                         WHEN COALESCE(json_extract(summary_json, '$.processedVariants'), 0) >= (
                             SELECT enqueued_items
                             FROM media_preview_regeneration_runs
                             WHERE run_id = ?
                         ) THEN ?
                         ELSE finished_at
                     END,
                     duration_ms = CASE
                         WHEN COALESCE(json_extract(summary_json, '$.processedVariants'), 0) >= (
                             SELECT enqueued_items
                             FROM media_preview_regeneration_runs
                             WHERE run_id = ?
                         ) THEN MAX(0, CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER))
                         ELSE duration_ms
                     END
                 WHERE id = ?
                   AND status = 'running'`,
            )
            .bind(runId, runId, runId, completedAt, runId, completedAt, runId),
    ])
    await deleteFinishedMediaPreviewRegenerationItems(db, runId)
}

export async function isMediaPreviewRegenerationDispatchActive(db: D1Database, runId: string): Promise<boolean> {
    const active = await db
        .prepare(
            `SELECT EXISTS(
                SELECT 1
                FROM media_preview_regeneration_runs AS runs
                WHERE runs.run_id = ?
                  AND (
                      runs.dispatch_complete = 0
                      OR EXISTS(
                          SELECT 1
                          FROM media_preview_regeneration_items AS items
                          WHERE items.run_id = runs.run_id
                            AND items.status IN ('pending', 'processing')
                      )
                  )
            ) AS active`,
        )
        .bind(runId)
        .first<number>('active')

    return Number(active) === 1
}

export async function getMediaPreviewRegenerationItemState(
    db: D1Database,
    runId: string,
    taskId: string,
): Promise<{jobStatus: string | null; itemStatus: MediaPreviewRegenerationItemStatus | null; leaseExpiresAt: string | null}> {
    const row = await db
        .prepare(
            `SELECT admin_job_runs.status AS job_status,
                    media_preview_regeneration_items.status AS item_status,
                    media_preview_regeneration_items.lease_expires_at
             FROM admin_job_runs
             LEFT JOIN media_preview_regeneration_items
               ON media_preview_regeneration_items.run_id = admin_job_runs.id
              AND media_preview_regeneration_items.task_id = ?
             WHERE admin_job_runs.id = ?`,
        )
        .bind(taskId, runId)
        .first<{job_status: string; item_status: MediaPreviewRegenerationItemStatus | null; lease_expires_at: string | null}>()

    return {
        jobStatus: row?.job_status ?? null,
        itemStatus: row?.item_status ?? null,
        leaseExpiresAt: row?.lease_expires_at ?? null,
    }
}

export async function claimMediaPreviewRegenerationTask(
    db: D1Database,
    taskId: string,
    now: Date,
): Promise<ClaimedMediaPreviewRegenerationTask | null> {
    const leaseId = crypto.randomUUID()
    const leasedAt = now.toISOString().replace('T', ' ').replace('Z', '')
    const leaseExpiresAt = new Date(now.getTime() + 2 * 60 * 1_000).toISOString().replace('T', ' ').replace('Z', '')
    const row = await db
        .prepare(
            `UPDATE media_preview_regeneration_items
             SET status = 'processing',
                 lease_id = ?,
                 lease_expires_at = ?
             WHERE task_id = ?
               AND (
                   status = 'pending'
                   OR (status = 'processing' AND lease_expires_at <= ?)
               )
               AND EXISTS(
                   SELECT 1
                   FROM admin_job_runs
                   WHERE id = media_preview_regeneration_items.run_id
                     AND status = 'running'
               )
             RETURNING run_id, candidate_json, container_slot`,
        )
        .bind(leaseId, leaseExpiresAt, taskId, leasedAt)
        .first<{run_id: string; candidate_json: string; container_slot: 0 | 1 | 2}>()

    return row
        ? {
              candidateJson: row.candidate_json,
              containerSlot: row.container_slot,
              leaseId,
              runId: row.run_id,
          }
        : null
}

export async function recordMediaPreviewRegenerationResult(
    db: D1Database,
    taskId: string,
    leaseId: string,
    result: MediaPreviewRegenerationResult,
): Promise<void> {
    await db
        .prepare(
            `UPDATE media_preview_regeneration_items
             SET status = ?,
                 regenerated_blur = ?,
                 last_error = ?,
                 lease_id = NULL,
                 lease_expires_at = NULL
             WHERE task_id = ?
               AND status = 'processing'
               AND lease_id = ?`,
        )
        .bind(result.status, Number(result.regeneratedBlur), result.error, taskId, leaseId)
        .run()
}

export async function recordMediaPreviewRegenerationAttemptError(
    db: D1Database,
    taskId: string,
    leaseId: string,
    message: string,
): Promise<void> {
    await db
        .prepare(
            `UPDATE media_preview_regeneration_items
             SET status = 'pending',
                 lease_id = NULL,
                 lease_expires_at = NULL,
                 last_error = ?
             WHERE task_id = ?
               AND status = 'processing'
               AND lease_id = ?`,
        )
        .bind(message.slice(0, 2_000), taskId, leaseId)
        .run()
}

export async function deleteFinishedMediaPreviewRegenerationItems(db: D1Database, runId: string): Promise<void> {
    await db
        .prepare(
            `DELETE FROM media_preview_regeneration_items
             WHERE run_id = ?
               AND EXISTS(
                   SELECT 1
                   FROM admin_job_runs
                   WHERE id = ?
                     AND status != 'running'
               )`,
        )
        .bind(runId, runId)
        .run()
}

export async function getMediaPreviewRegenerationCandidates(
    db: D1Database,
    cursor: MediaPreviewRegenerationCursor | null,
): Promise<MediaPreviewRegenerationCandidate[]> {
    const cursorMediaId = cursor?.mediaId ?? null
    const cursorRatingOrder = cursor?.ratingOrder ?? -1
    const result = await db
        .prepare(
            `WITH media_variants AS (
                SELECT id AS media_id,
                       user_id,
                       character_id,
                       'sfw' AS rating,
                       0 AS rating_order,
                       sfw_image_key AS image_key,
                       sfw_content_type AS image_content_type,
                       sfw_preview_image_key AS preview_key,
                       sfw_preview_content_type AS preview_content_type,
                       NULL AS blur_key,
                       'image/webp' AS blur_content_type
                FROM character_media
                WHERE sfw_image_key IS NOT NULL
                UNION ALL
                SELECT id AS media_id,
                       user_id,
                       character_id,
                       'nsfw' AS rating,
                       1 AS rating_order,
                       nsfw_image_key AS image_key,
                       nsfw_content_type AS image_content_type,
                       nsfw_preview_image_key AS preview_key,
                       nsfw_preview_content_type AS preview_content_type,
                       nsfw_blur_image_key AS blur_key,
                       nsfw_blur_content_type AS blur_content_type
                FROM character_media
                WHERE nsfw_image_key IS NOT NULL
            )
            SELECT media_id,
                   user_id,
                   character_id,
                   rating,
                   rating_order,
                   image_key,
                   image_content_type,
                   preview_key,
                   preview_content_type,
                   blur_key,
                   blur_content_type
            FROM media_variants
            WHERE ? IS NULL
               OR media_id > ?
               OR (media_id = ? AND rating_order > ?)
            ORDER BY media_id, rating_order
            LIMIT ?`,
        )
        .bind(cursorMediaId, cursorMediaId, cursorMediaId, cursorRatingOrder, MEDIA_PREVIEW_REGENERATION_BATCH_SIZE)
        .all<CandidateRow>()

    return result.results.flatMap(toCandidate)
}

export async function regenerateMediaPreviewCandidate(
    env: MediaPreviewRegenerationEnv,
    candidate: MediaPreviewRegenerationCandidate,
    options: MediaPreviewRegenerationOptions = {},
): Promise<MediaPreviewRegenerationResult> {
    const newObjectKeys = targetObjectKeys(candidate)
    try {
        if (!(await isCandidateSourceCurrent(env.DB, candidate))) {
            return {
                status: 'skipped',
                regeneratedBlur: false,
                error: null,
            }
        }

        const source = await readSourceImage(env.MEDIA_BUCKET, candidate)

        if (!source) {
            await deleteUnreferencedTargetObjects(env, candidate, newObjectKeys, 'media-preview-regeneration-source-failure')
            return {
                status: 'failed',
                regeneratedBlur: false,
                error: `${candidate.rating.toUpperCase()} source image is missing or invalid for media ${candidate.mediaId}`,
            }
        }

        const sourceUrl = characterMediaImageUrl(
            env.MEDIA_PUBLIC_BASE_URL,
            candidate.userId,
            candidate.characterId,
            candidate.mediaId,
            candidate.imageKey,
            candidate.rating,
            candidate.imageContentType,
        )
        const containerOptions = {
            containerIndex: options.containerIndex,
            maxAttempts: options.maxContainerAttempts,
            priority: 'background' as const,
        }
        const preview = await generateMediaPreviewWithContainer(env, sourceUrl, source, containerOptions)
        await putPreview(env.MEDIA_BUCKET, candidate, preview)

        if (candidate.targetBlurKey) {
            await putBlur(env, candidate, candidate.targetBlurKey, preview, containerOptions)
        }

        const updated = await publishRegeneratedPreview(env.DB, candidate, preview)

        if (!updated) {
            /* istanbul ignore if -- this only occurs if a concurrent writer publishes this exact target after the failed update. */
            if (await isTargetPreviewCurrent(env.DB, candidate)) {
                return {
                    status: 'regenerated',
                    regeneratedBlur: Boolean(candidate.targetBlurKey),
                    error: null,
                }
            }

            await deleteUnreferencedTargetObjects(env, candidate, newObjectKeys, 'media-preview-regeneration-conflict')
            return {
                status: 'skipped',
                regeneratedBlur: false,
                error: null,
            }
        }

        return {
            status: 'regenerated',
            regeneratedBlur: Boolean(candidate.targetBlurKey),
            error: null,
        }
    } catch (error) {
        await deleteUnreferencedTargetObjects(env, candidate, newObjectKeys, 'media-preview-regeneration-failure')

        throw error
    }
}

function toCandidate(row: CandidateRow): MediaPreviewRegenerationCandidate[] {
    if (!row.image_key) {
        return []
    }

    return [
        {
            mediaId: row.media_id,
            userId: row.user_id,
            characterId: row.character_id,
            rating: row.rating,
            ratingOrder: row.rating_order,
            imageKey: row.image_key,
            storedImageContentType: row.image_content_type,
            imageContentType: row.image_content_type ?? 'image/png',
            previousPreviewKey: row.preview_key,
            previousPreviewContentType: row.preview_content_type,
            previousBlurKey: row.blur_key,
            previousBlurContentType: row.blur_content_type,
            targetPreviewKey: crypto.randomUUID(),
            targetBlurKey: row.rating === 'nsfw' ? crypto.randomUUID() : null,
        },
    ]
}

async function readSourceImage(
    bucket: R2Bucket,
    candidate: MediaPreviewRegenerationCandidate,
): Promise<ReturnType<typeof readGalleryImageMetadata>> {
    const objectKey = characterMediaImageObjectKey(
        candidate.userId,
        candidate.characterId,
        candidate.mediaId,
        candidate.imageKey,
        candidate.rating,
        candidate.imageContentType,
    )
    const object = await bucket.get(objectKey, {
        range: {
            offset: 0,
            length: GALLERY_IMAGE_DIMENSION_PROBE_BYTES,
        },
    })

    if (!object) {
        return null
    }

    return readGalleryImageMetadata(new Uint8Array(await object.arrayBuffer()), candidate.imageContentType)
}

async function putPreview(bucket: R2Bucket, candidate: MediaPreviewRegenerationCandidate, preview: GeneratedGalleryPreview): Promise<void> {
    await bucket.put(
        characterMediaPreviewImageObjectKey(
            candidate.userId,
            candidate.characterId,
            candidate.mediaId,
            candidate.targetPreviewKey,
            candidate.rating,
            GALLERY_PREVIEW_CONTENT_TYPE,
        ),
        preview.bytes,
        {
            httpMetadata: {
                cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
                contentType: GALLERY_PREVIEW_CONTENT_TYPE,
            },
        },
    )
}

async function putBlur(
    env: MediaPreviewRegenerationEnv,
    candidate: MediaPreviewRegenerationCandidate,
    targetBlurKey: string,
    preview: GeneratedGalleryPreview,
    containerOptions: {containerIndex?: number; maxAttempts?: number; priority: 'background'},
): Promise<void> {
    const blur = await generateNsfwBlurImage(env, preview, containerOptions)
    await env.MEDIA_BUCKET.put(
        characterMediaNsfwBlurImageObjectKey(
            candidate.userId,
            candidate.characterId,
            candidate.mediaId,
            targetBlurKey,
            GALLERY_NSFW_BLUR_CONTENT_TYPE,
        ),
        blur.bytes,
        {
            httpMetadata: {
                cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
                contentType: blur.contentType,
            },
        },
    )
}

async function isCandidateSourceCurrent(db: D1Database, candidate: MediaPreviewRegenerationCandidate): Promise<boolean> {
    const column = candidate.rating === 'sfw' ? 'sfw' : 'nsfw'
    const current = await db
        .prepare(
            `SELECT 1
             FROM character_media
             WHERE id = ?
               AND ${column}_image_key = ?
               AND ${column}_content_type IS ?`,
        )
        .bind(candidate.mediaId, candidate.imageKey, candidate.storedImageContentType)
        .first<number>()

    return current !== null
}

async function isTargetPreviewCurrent(db: D1Database, candidate: MediaPreviewRegenerationCandidate): Promise<boolean> {
    const row = await db
        .prepare(
            `SELECT sfw_preview_image_key,
                    nsfw_preview_image_key,
                    nsfw_blur_image_key
             FROM character_media
             WHERE id = ?`,
        )
        .bind(candidate.mediaId)
        .first<{sfw_preview_image_key: string | null; nsfw_preview_image_key: string | null; nsfw_blur_image_key: string | null}>()

    if (candidate.rating === 'sfw') {
        return row?.sfw_preview_image_key === candidate.targetPreviewKey
    }

    return row?.nsfw_preview_image_key === candidate.targetPreviewKey && row.nsfw_blur_image_key === candidate.targetBlurKey
}

async function deleteUnreferencedTargetObjects(
    env: Pick<MediaPreviewRegenerationEnv, 'DB' | 'MEDIA_BUCKET'>,
    candidate: MediaPreviewRegenerationCandidate,
    objectKeys: string[],
    operation: string,
): Promise<void> {
    if (!(await isTargetPreviewCurrent(env.DB, candidate))) {
        await deleteR2Objects(env.MEDIA_BUCKET, objectKeys, operation)
    }
}

async function publishRegeneratedPreview(
    db: D1Database,
    candidate: MediaPreviewRegenerationCandidate,
    preview: GeneratedGalleryPreview,
): Promise<boolean> {
    const statement =
        candidate.rating === 'sfw'
            ? db.prepare(
                  `UPDATE character_media
                   SET sfw_preview_image_key = ?,
                       sfw_preview_content_type = ?,
                       sfw_preview_width = ?,
                       sfw_preview_height = ?,
                       sfw_preview_byte_size = ?
                   WHERE id = ?
                     AND sfw_image_key = ?
                     AND sfw_content_type IS ?
                     AND (
                         (sfw_preview_image_key IS ? AND sfw_preview_content_type = ?)
                         OR (sfw_preview_image_key = ? AND sfw_preview_content_type = ?)
                     )`,
              )
            : db.prepare(
                  `UPDATE character_media
                   SET nsfw_preview_image_key = ?,
                       nsfw_preview_content_type = ?,
                       nsfw_preview_width = ?,
                       nsfw_preview_height = ?,
                       nsfw_preview_byte_size = ?,
                       nsfw_blur_image_key = ?,
                       nsfw_blur_content_type = ?
                   WHERE id = ?
                     AND nsfw_image_key = ?
                     AND nsfw_content_type IS ?
                     AND (
                         (
                             nsfw_preview_image_key IS ?
                             AND nsfw_preview_content_type = ?
                             AND nsfw_blur_image_key IS ?
                             AND nsfw_blur_content_type = ?
                         )
                         OR (
                             nsfw_preview_image_key = ?
                             AND nsfw_preview_content_type = ?
                             AND nsfw_blur_image_key = ?
                             AND nsfw_blur_content_type = ?
                         )
                     )`,
              )

    const result =
        candidate.rating === 'sfw'
            ? await statement
                  .bind(
                      candidate.targetPreviewKey,
                      GALLERY_PREVIEW_CONTENT_TYPE,
                      preview.width,
                      preview.height,
                      preview.bytes.byteLength,
                      candidate.mediaId,
                      candidate.imageKey,
                      candidate.storedImageContentType,
                      candidate.previousPreviewKey,
                      candidate.previousPreviewContentType,
                      candidate.targetPreviewKey,
                      GALLERY_PREVIEW_CONTENT_TYPE,
                  )
                  .run()
            : await statement
                  .bind(
                      candidate.targetPreviewKey,
                      GALLERY_PREVIEW_CONTENT_TYPE,
                      preview.width,
                      preview.height,
                      preview.bytes.byteLength,
                      candidate.targetBlurKey,
                      GALLERY_NSFW_BLUR_CONTENT_TYPE,
                      candidate.mediaId,
                      candidate.imageKey,
                      candidate.storedImageContentType,
                      candidate.previousPreviewKey,
                      candidate.previousPreviewContentType,
                      candidate.previousBlurKey,
                      candidate.previousBlurContentType,
                      candidate.targetPreviewKey,
                      GALLERY_PREVIEW_CONTENT_TYPE,
                      candidate.targetBlurKey,
                      GALLERY_NSFW_BLUR_CONTENT_TYPE,
                  )
                  .run()

    return Number(result.meta.changes) > 0
}

function targetObjectKeys(candidate: MediaPreviewRegenerationCandidate): string[] {
    const keys = [
        characterMediaPreviewImageObjectKey(
            candidate.userId,
            candidate.characterId,
            candidate.mediaId,
            candidate.targetPreviewKey,
            candidate.rating,
            GALLERY_PREVIEW_CONTENT_TYPE,
        ),
    ]

    if (candidate.targetBlurKey) {
        keys.push(
            characterMediaNsfwBlurImageObjectKey(
                candidate.userId,
                candidate.characterId,
                candidate.mediaId,
                candidate.targetBlurKey,
                GALLERY_NSFW_BLUR_CONTENT_TYPE,
            ),
        )
    }

    return keys
}
