import type {Bindings} from '../../types/bindings'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../media/cacheControl'
import {tagPngWithSrgbFixedLengthResult} from '../media/pngColorSpace'
import {characterMediaImageObjectKey} from '../media/url'

export const PNG_SRGB_BACKFILL_BATCH_SIZE = 25
export const PNG_SRGB_BACKFILL_ITEMS_PER_WORKFLOW = 250

export type PngSrgbBackfillSummary = {
    totalVariants: number
    processedVariants: number
    retaggedVariants: number
    skippedVariants: number
    failedVariants: number
    lastError: string | null
}

export type PngSrgbBackfillCursor = {
    createdAt: string
    mediaId: string
    rating: 'sfw' | 'nsfw'
}

export type PngSrgbBackfillCandidate = {
    mediaId: string
    userId: string
    characterId: string
    createdAt: string
    rating: 'sfw' | 'nsfw'
    imageKey: string
    contentType: string | null
    byteSize: number | null
}

export type PngSrgbBackfillResult = {status: 'retagged'} | {status: 'skipped'}

type BackfillEnv = Pick<Bindings, 'DB' | 'MEDIA_BUCKET'>

const CANDIDATE_QUERY = `WITH variants AS (
    SELECT id AS media_id,
           user_id,
           character_id,
           created_at,
           'sfw' AS rating,
           sfw_image_key AS image_key,
           sfw_content_type AS content_type,
           sfw_byte_size AS byte_size
    FROM character_media
    WHERE sfw_image_key IS NOT NULL
      AND (sfw_content_type IS NULL OR lower(sfw_content_type) = 'image/png')
    UNION ALL
    SELECT id,
           user_id,
           character_id,
           created_at,
           'nsfw' AS rating,
           nsfw_image_key AS image_key,
           nsfw_content_type AS content_type,
           nsfw_byte_size AS byte_size
    FROM character_media
    WHERE nsfw_image_key IS NOT NULL
      AND (nsfw_content_type IS NULL OR lower(nsfw_content_type) = 'image/png')
)`

export function emptyPngSrgbBackfillSummary(): PngSrgbBackfillSummary {
    return {
        totalVariants: 0,
        processedVariants: 0,
        retaggedVariants: 0,
        skippedVariants: 0,
        failedVariants: 0,
        lastError: null,
    }
}

export function pngSrgbBackfillWorkflowInstanceId(runId: string, segment: number): string {
    return segment === 0 ? runId : `${runId}-png-srgb-segment-${segment}`
}

export function activePngSrgbBackfillWorkflowInstanceIds(runId: string, processedVariants: number): string[] {
    const segment = Math.floor(processedVariants / PNG_SRGB_BACKFILL_ITEMS_PER_WORKFLOW)
    const ids = new Set([runId])
    if (segment > 0) ids.add(pngSrgbBackfillWorkflowInstanceId(runId, segment))
    if (segment > 1) ids.add(pngSrgbBackfillWorkflowInstanceId(runId, segment - 1))
    return [...ids]
}

export function parsePngSrgbBackfillSummary(value: string | null): PngSrgbBackfillSummary {
    if (value) {
        try {
            const parsed = JSON.parse(value) as unknown
            if (isPngSrgbBackfillSummary(parsed)) return parsed
        } catch {
            // Use an empty summary if the stored job data is invalid.
        }
    }
    return emptyPngSrgbBackfillSummary()
}

function isPngSrgbBackfillSummary(value: unknown): value is PngSrgbBackfillSummary {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

    const summary = value as Record<string, unknown>
    const keys = Object.keys(summary)
    return (
        keys.length === 6 &&
        keys.every((key) => PNG_SRGB_BACKFILL_SUMMARY_KEYS.has(key)) &&
        isNonnegativeInteger(summary.totalVariants) &&
        isNonnegativeInteger(summary.processedVariants) &&
        isNonnegativeInteger(summary.retaggedVariants) &&
        isNonnegativeInteger(summary.skippedVariants) &&
        isNonnegativeInteger(summary.failedVariants) &&
        (typeof summary.lastError === 'string' || summary.lastError === null)
    )
}

const PNG_SRGB_BACKFILL_SUMMARY_KEYS = new Set([
    'totalVariants',
    'processedVariants',
    'retaggedVariants',
    'skippedVariants',
    'failedVariants',
    'lastError',
])

function isNonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export async function countPngSrgbBackfillCandidates(db: D1Database): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM (${CANDIDATE_QUERY} SELECT 1 FROM variants)`).first<{
        count: number
    }>()
    return Number(row?.count ?? 0)
}

export async function getPngSrgbBackfillCandidates(
    db: D1Database,
    cursor: PngSrgbBackfillCursor | null,
    limit = PNG_SRGB_BACKFILL_BATCH_SIZE,
): Promise<PngSrgbBackfillCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('PNG sRGB backfill candidate limit must be positive')
    }

    const result = await db
        .prepare(
            `${CANDIDATE_QUERY}
             SELECT media_id, user_id, character_id, created_at, rating, image_key, content_type, byte_size
             FROM variants
             WHERE ? IS NULL
                OR created_at > ?
                OR (created_at = ? AND (media_id > ? OR (media_id = ? AND rating > ?)))
             ORDER BY created_at, media_id, rating
             LIMIT ?`,
        )
        .bind(
            cursor?.createdAt ?? null,
            cursor?.createdAt ?? null,
            cursor?.createdAt ?? null,
            cursor?.mediaId ?? null,
            cursor?.mediaId ?? null,
            cursor?.rating ?? null,
            limit,
        )
        .all<{
            media_id: string
            user_id: string
            character_id: string
            created_at: string
            rating: 'sfw' | 'nsfw'
            image_key: string
            content_type: string | null
            byte_size: number | null
        }>()

    return result.results.map((row) => ({
        mediaId: row.media_id,
        userId: row.user_id,
        characterId: row.character_id,
        createdAt: row.created_at,
        rating: row.rating,
        imageKey: row.image_key,
        contentType: row.content_type,
        byteSize: row.byte_size,
    }))
}

export async function tagPngSrgbCandidate(env: BackfillEnv, candidate: PngSrgbBackfillCandidate): Promise<PngSrgbBackfillResult> {
    const objectKey = characterMediaImageObjectKey(
        candidate.userId,
        candidate.characterId,
        candidate.mediaId,
        candidate.imageKey,
        candidate.rating,
        candidate.contentType,
    )
    const source = await env.MEDIA_BUCKET.get(objectKey)

    if (!source) {
        throw new Error(`The PNG original is missing: ${objectKey}`)
    }

    const contentType = source.httpMetadata?.contentType ?? candidate.contentType ?? 'image/png'
    const tagged = await tagPngWithSrgbFixedLengthResult(source.body, source.size, {
        bucket: env.MEDIA_BUCKET,
        key: objectKey,
    })

    if (!tagged.changed) {
        await tagged.body.cancel().catch(() => undefined)

        if (contentType === 'image/png' && candidate.byteSize !== source.size) {
            const updated = await updateVariantByteSize(env.DB, candidate, source.size)
            return updated ? {status: 'retagged'} : {status: 'skipped'}
        }

        return {status: 'skipped'}
    }

    const written = await env.MEDIA_BUCKET.put(objectKey, tagged.body, {
        onlyIf: new Headers({'if-match': source.httpEtag}),
        httpMetadata: {
            ...source.httpMetadata,
            cacheControl: source.httpMetadata?.cacheControl ?? REVOCABLE_MEDIA_CACHE_CONTROL,
            contentType,
        },
    })

    if (!written) {
        // The object was deleted or replaced while the tag was being built.
        // The conditional write refused to restore the removed image, so
        // treat this candidate as skipped instead of resurrecting it.
        try {
            await tagged.body.cancel()
        } catch {
            // The failed write may have already consumed or closed the body.
        }

        return {status: 'skipped'}
    }

    if (written.size !== tagged.size) {
        throw new Error(`The tagged PNG size did not match the expected size: ${objectKey}`)
    }

    const updated = await updateVariantByteSize(env.DB, candidate, written.size)
    return updated ? {status: 'retagged'} : {status: 'skipped'}
}

async function updateVariantByteSize(db: D1Database, candidate: PngSrgbBackfillCandidate, byteSize: number): Promise<boolean> {
    const result =
        candidate.rating === 'sfw'
            ? await db
                  .prepare(
                      `UPDATE character_media
                       SET sfw_byte_size = ?
                       WHERE id = ?
                         AND user_id = ?
                         AND character_id = ?
                         AND sfw_image_key = ?`,
                  )
                  .bind(byteSize, candidate.mediaId, candidate.userId, candidate.characterId, candidate.imageKey)
                  .run()
            : await db
                  .prepare(
                      `UPDATE character_media
                       SET nsfw_byte_size = ?
                       WHERE id = ?
                         AND user_id = ?
                         AND character_id = ?
                         AND nsfw_image_key = ?`,
                  )
                  .bind(byteSize, candidate.mediaId, candidate.userId, candidate.characterId, candidate.imageKey)
                  .run()

    return Number(result.meta.changes) > 0
}

export function pngSrgbBackfillErrorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
