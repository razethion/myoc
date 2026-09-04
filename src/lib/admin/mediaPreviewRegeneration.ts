import type {Bindings} from '../../types/bindings'
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

const PREVIEW_REGENERATION_BATCH_SIZE = 25
export const MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW = 250
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
    const segment = Math.floor(processedVariants / MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW)
    const currentId = mediaPreviewRegenerationWorkflowInstanceId(runId, segment)

    if (segment === 0 || processedVariants % MEDIA_PREVIEW_REGENERATION_ITEMS_PER_WORKFLOW !== 0) {
        return [currentId]
    }

    return [mediaPreviewRegenerationWorkflowInstanceId(runId, segment - 1), currentId]
}

export type MediaPreviewRegenerationCandidate = {
    mediaId: string
    userId: string
    characterId: string
    rating: 'sfw' | 'nsfw'
    ratingOrder: number
    imageKey: string
    storedImageContentType: string | null
    imageContentType: string
    previousPreviewKey: string | null
    previousPreviewContentType: string
    previousBlurKey: string | null
    previousBlurContentType: string
    targetPreviewKey: string
    targetBlurKey: string | null
}

export type MediaPreviewRegenerationResult = {
    status: 'regenerated' | 'skipped' | 'failed'
    regeneratedBlur: boolean
    error: string | null
}

type MediaPreviewRegenerationEnv = Pick<
    Bindings,
    'DB' | 'IMAGES' | 'MEDIA_BUCKET' | 'MEDIA_PUBLIC_BASE_URL' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'
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

export async function initializeMediaPreviewRegenerationSummary(db: D1Database): Promise<MediaPreviewRegenerationSummary> {
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
        .bind(cursorMediaId, cursorMediaId, cursorMediaId, cursorRatingOrder, PREVIEW_REGENERATION_BATCH_SIZE)
        .all<CandidateRow>()

    return result.results.flatMap(toCandidate)
}

export function applyMediaPreviewRegenerationResults(
    summary: MediaPreviewRegenerationSummary,
    results: MediaPreviewRegenerationResult[],
): MediaPreviewRegenerationSummary {
    const next = {...summary}

    for (const result of results) {
        next.processedVariants += 1

        if (result.status === 'regenerated') {
            next.regeneratedPreviews += 1
            next.regeneratedBlurs += Number(result.regeneratedBlur)
        } else if (result.status === 'skipped') {
            next.skippedVariants += 1
        } else {
            next.failedVariants += 1
            next.lastError = result.error
        }
    }

    return next
}

export async function regenerateMediaPreviewCandidate(
    env: MediaPreviewRegenerationEnv,
    candidate: MediaPreviewRegenerationCandidate,
): Promise<MediaPreviewRegenerationResult> {
    const newObjectKeys = targetObjectKeys(candidate)
    try {
        const source = await readSourceImage(env.MEDIA_BUCKET, candidate)

        if (!source) {
            await deleteR2Objects(env.MEDIA_BUCKET, newObjectKeys, 'media-preview-regeneration-source-failure')
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
        const preview = await generateMediaPreviewWithContainer(env, sourceUrl, source)
        await putPreview(env.MEDIA_BUCKET, candidate, preview)

        if (candidate.targetBlurKey) {
            await putBlur(env, candidate, candidate.targetBlurKey, preview)
        }

        const updated = await publishRegeneratedPreview(env.DB, candidate, preview)

        if (!updated) {
            await deleteR2Objects(env.MEDIA_BUCKET, newObjectKeys, 'media-preview-regeneration-conflict')
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
        await deleteR2Objects(env.MEDIA_BUCKET, newObjectKeys, 'media-preview-regeneration-failure')

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
): Promise<void> {
    const blur = await generateNsfwBlurImage(env.IMAGES, preview)
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
