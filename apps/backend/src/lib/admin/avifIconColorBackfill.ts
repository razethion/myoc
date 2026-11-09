import type {Bindings} from '../../types/bindings'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../media/cacheControl'
import {readGalleryImageDimensions} from '../media/imageMetadata'
import {repairIconColorWithContainer, SQUARE_IMAGE_CONTENT_TYPE} from '../media/previewGeneration'
import {characterFolderImageObjectKey, characterProfileImageObjectKey, profilePhotoObjectKey} from '../media/url'

export const AVIF_ICON_COLOR_BACKFILL_BATCH_SIZE = 25
export const AVIF_ICON_COLOR_BACKFILL_ITEMS_PER_WORKFLOW = 250

export type AvifIconColorBackfillSummary = {
    totalIcons: number
    processedIcons: number
    retaggedIcons: number
    skippedIcons: number
    failedIcons: number
    lastError: string | null
}

export type AvifIconColorBackfillCursor = {
    kind: 'user-profile' | 'character-profile' | 'folder-image'
    targetId: string
}

export type AvifIconColorBackfillCandidate = {
    kind: 'user-profile' | 'character-profile' | 'folder-image'
    userId: string
    targetId: string
    imageKey: string
    contentType: string | null
    objectKey: string
}

export type AvifIconColorBackfillResult = {status: 'retagged'} | {status: 'skipped'}

type BackfillEnv = Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

const CANDIDATE_QUERY = `WITH icon_candidates AS (
    SELECT 'user-profile' AS kind,
           id AS user_id,
           id AS target_id,
           profile_photo_key AS image_key,
           profile_photo_content_type AS content_type
    FROM users
    WHERE profile_photo_key IS NOT NULL
      AND length(profile_photo_key) > 0
    UNION ALL
    SELECT 'character-profile' AS kind,
           user_id,
           id AS target_id,
           profile_image_key AS image_key,
           profile_image_content_type AS content_type
    FROM characters
    WHERE profile_image_key IS NOT NULL
      AND length(profile_image_key) > 0
    UNION ALL
    SELECT 'folder-image' AS kind,
           user_id,
           id AS target_id,
           folder_image_key AS image_key,
           folder_image_content_type AS content_type
    FROM character_folders
    WHERE folder_image_key IS NOT NULL
      AND length(folder_image_key) > 0
)`

export function emptyAvifIconColorBackfillSummary(): AvifIconColorBackfillSummary {
    return {
        totalIcons: 0,
        processedIcons: 0,
        retaggedIcons: 0,
        skippedIcons: 0,
        failedIcons: 0,
        lastError: null,
    }
}

export function avifIconColorBackfillWorkflowInstanceId(runId: string, segment: number): string {
    return segment === 0 ? runId : `${runId}-avif-icon-segment-${segment}`
}

export function activeAvifIconColorBackfillWorkflowInstanceIds(runId: string, processedIcons: number): string[] {
    const segment = Math.floor(processedIcons / AVIF_ICON_COLOR_BACKFILL_ITEMS_PER_WORKFLOW)
    const ids = new Set([runId])
    if (segment > 0) ids.add(avifIconColorBackfillWorkflowInstanceId(runId, segment))
    if (segment > 1) ids.add(avifIconColorBackfillWorkflowInstanceId(runId, segment - 1))
    return [...ids]
}

export function parseAvifIconColorBackfillSummary(value: string | null): AvifIconColorBackfillSummary {
    if (value) {
        try {
            const parsed = JSON.parse(value) as unknown
            if (isAvifIconColorBackfillSummary(parsed)) return parsed
        } catch {
            // Use an empty summary if the stored job data is invalid.
        }
    }
    return emptyAvifIconColorBackfillSummary()
}

function isAvifIconColorBackfillSummary(value: unknown): value is AvifIconColorBackfillSummary {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false

    const summary = value as Record<string, unknown>
    const keys = Object.keys(summary)
    return (
        keys.length === 6 &&
        keys.every((key) => AVIF_ICON_COLOR_BACKFILL_SUMMARY_KEYS.has(key)) &&
        isNonnegativeInteger(summary.totalIcons) &&
        isNonnegativeInteger(summary.processedIcons) &&
        isNonnegativeInteger(summary.retaggedIcons) &&
        isNonnegativeInteger(summary.skippedIcons) &&
        isNonnegativeInteger(summary.failedIcons) &&
        (typeof summary.lastError === 'string' || summary.lastError === null)
    )
}

const AVIF_ICON_COLOR_BACKFILL_SUMMARY_KEYS = new Set([
    'totalIcons',
    'processedIcons',
    'retaggedIcons',
    'skippedIcons',
    'failedIcons',
    'lastError',
])

function isNonnegativeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export async function countAvifIconColorBackfillCandidates(db: D1Database): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM (${CANDIDATE_QUERY} SELECT 1 FROM icon_candidates)`).first<{
        count: number
    }>()
    return Number(row?.count ?? 0)
}

export async function getAvifIconColorBackfillCandidates(
    db: D1Database,
    cursor: AvifIconColorBackfillCursor | null,
    limit = AVIF_ICON_COLOR_BACKFILL_BATCH_SIZE,
): Promise<AvifIconColorBackfillCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1) {
        throw new RangeError('AVIF icon color backfill candidate limit must be positive')
    }

    const result = await db
        .prepare(
            `${CANDIDATE_QUERY}
             SELECT kind, user_id, target_id, image_key, content_type
             FROM icon_candidates
             WHERE ? IS NULL
                OR kind > ?
                OR (kind = ? AND target_id > ?)
             ORDER BY kind, target_id
             LIMIT ?`,
        )
        .bind(cursor?.kind ?? null, cursor?.kind ?? null, cursor?.kind ?? null, cursor?.targetId ?? null, limit)
        .all<{
            kind: 'user-profile' | 'character-profile' | 'folder-image'
            user_id: string
            target_id: string
            image_key: string
            content_type: string | null
        }>()

    return result.results.map((row) => ({
        kind: row.kind,
        userId: row.user_id,
        targetId: row.target_id,
        imageKey: row.image_key,
        contentType: row.content_type,
        objectKey: iconObjectKey(row.kind, row.user_id, row.target_id, row.image_key),
    }))
}

export async function repairAvifIconColorCandidate(
    env: BackfillEnv,
    candidate: AvifIconColorBackfillCandidate,
): Promise<AvifIconColorBackfillResult> {
    const source = await env.MEDIA_BUCKET.get(candidate.objectKey)

    if (!source) {
        throw new Error(`The icon image is missing: ${candidate.objectKey}`)
    }

    const sourceBytes = new Uint8Array(await source.arrayBuffer())

    if (!readGalleryImageDimensions(sourceBytes, SQUARE_IMAGE_CONTENT_TYPE)) {
        return {status: 'skipped'}
    }

    const repaired = await repairIconColorWithContainer(env, sourceBytes, candidate.objectKey, {
        priority: 'background',
    })
    const needsContentTypeFix = candidate.contentType !== SQUARE_IMAGE_CONTENT_TYPE
    const wroteObject = await writeRepairedIcon(env, candidate, source, sourceBytes, repaired, needsContentTypeFix)
    const updatedContentType = needsContentTypeFix ? await updateIconContentType(env.DB, candidate) : false

    if (repaired.changed || wroteObject || updatedContentType) {
        return {status: 'retagged'}
    }

    return {status: 'skipped'}
}

async function writeRepairedIcon(
    env: BackfillEnv,
    candidate: AvifIconColorBackfillCandidate,
    source: R2ObjectBody,
    sourceBytes: Uint8Array,
    repaired: Awaited<ReturnType<typeof repairIconColorWithContainer>>,
    needsContentTypeFix: boolean,
): Promise<boolean> {
    if (!repaired.changed && !needsContentTypeFix) {
        return false
    }

    const bytes = repaired.changed ? repaired.bytes : sourceBytes
    const written = await env.MEDIA_BUCKET.put(candidate.objectKey, bytes, {
        httpMetadata: {
            ...source.httpMetadata,
            cacheControl: source.httpMetadata?.cacheControl ?? REVOCABLE_MEDIA_CACHE_CONTROL,
            contentType: SQUARE_IMAGE_CONTENT_TYPE,
        },
    })

    if (!written) {
        throw new Error(`The repaired icon could not be written: ${candidate.objectKey}`)
    }

    if (written.size !== bytes.byteLength) {
        throw new Error(`The repaired icon size did not match the expected size: ${candidate.objectKey}`)
    }

    return true
}

function iconObjectKey(kind: AvifIconColorBackfillCandidate['kind'], userId: string, targetId: string, imageKey: string): string {
    if (kind === 'user-profile') {
        return profilePhotoObjectKey(userId, imageKey)
    }

    if (kind === 'character-profile') {
        return characterProfileImageObjectKey(userId, targetId, imageKey)
    }

    return characterFolderImageObjectKey(userId, targetId, imageKey)
}

async function updateIconContentType(db: D1Database, candidate: AvifIconColorBackfillCandidate): Promise<boolean> {
    const result =
        candidate.kind === 'user-profile'
            ? await db
                  .prepare(
                      `UPDATE users
                       SET profile_photo_content_type = 'image/avif'
                       WHERE id = ?
                         AND profile_photo_key = ?`,
                  )
                  .bind(candidate.targetId, candidate.imageKey)
                  .run()
            : candidate.kind === 'character-profile'
              ? await db
                    .prepare(
                        `UPDATE characters
                         SET profile_image_content_type = 'image/avif'
                         WHERE id = ?
                           AND user_id = ?
                           AND profile_image_key = ?`,
                    )
                    .bind(candidate.targetId, candidate.userId, candidate.imageKey)
                    .run()
              : await db
                    .prepare(
                        `UPDATE character_folders
                         SET folder_image_content_type = 'image/avif'
                         WHERE id = ?
                           AND user_id = ?
                           AND folder_image_key = ?`,
                    )
                    .bind(candidate.targetId, candidate.userId, candidate.imageKey)
                    .run()

    return Number(result.meta.changes) > 0
}

export function avifIconColorBackfillErrorMessage(error: unknown): string {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return message.slice(0, 2_000)
}
