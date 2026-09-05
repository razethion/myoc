import type {Bindings} from '../../types/bindings'
import {toSqlTimestamp} from '../auth/session'
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../media/cacheControl'
import {generateSquareImageWithContainer} from '../media/previewGeneration'
import {readThumbnailOriginal, retainThumbnailOriginal, thumbnailOriginalObjectKey} from '../media/thumbnailSources'
import {characterFolderImageObjectKey, characterProfileImageObjectKey, profilePhotoObjectKey} from '../media/url'

const THUMBNAIL_CLEANUP_GRACE_MS = 60 * 60 * 1_000
const DEFAULT_CANDIDATE_LIMIT = 25
const MAX_CANDIDATE_LIMIT = 100

type ThumbnailKind = 'user-profile' | 'character-profile' | 'folder-image'

export type ThumbnailCandidate = {
    kind: ThumbnailKind
    userId: string
    targetId: string
    imageKey: string
    objectKey: string
    contentType: string
    outputImageKey: string
    outputObjectKey: string
}

export type ThumbnailCursor = {
    kind: string
    targetId: string
}

type ThumbnailCandidateRow = {
    kind: ThumbnailKind
    user_id: string
    target_id: string
    image_key: string
    content_type: string
}

type ThumbnailReference = {
    image_key: string
    content_type: string
}

export async function countThumbnailCandidates(db: D1Database): Promise<number> {
    const count = await db
        .prepare(
            `SELECT (
                 (SELECT COUNT(*) FROM users WHERE profile_photo_key IS NOT NULL) +
                 (SELECT COUNT(*) FROM characters WHERE profile_image_key IS NOT NULL AND length(profile_image_key) > 0) +
                 (SELECT COUNT(*) FROM character_folders WHERE folder_image_key IS NOT NULL)
             ) AS candidate_count`,
        )
        .first<number>('candidate_count')

    return Math.max(0, Number(count ?? 0))
}

export async function getThumbnailCandidates(
    db: D1Database,
    cursor: ThumbnailCursor | null,
    limit = DEFAULT_CANDIDATE_LIMIT,
): Promise<ThumbnailCandidate[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CANDIDATE_LIMIT) {
        throw new RangeError(`Thumbnail candidate limit must be from 1 through ${MAX_CANDIDATE_LIMIT}`)
    }

    const cursorKind = cursor?.kind ?? null
    const cursorTargetId = cursor?.targetId ?? null
    const result = await db
        .prepare(
            `WITH thumbnail_candidates AS (
                 SELECT 'user-profile' AS kind,
                        id AS user_id,
                        id AS target_id,
                        profile_photo_key AS image_key,
                        profile_photo_content_type AS content_type
                 FROM users
                 WHERE profile_photo_key IS NOT NULL
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
             )
             SELECT kind, user_id, target_id, image_key, content_type
             FROM thumbnail_candidates
             WHERE ? IS NULL
                OR kind > ?
                OR (kind = ? AND target_id > ?)
             ORDER BY kind, target_id
             LIMIT ?`,
        )
        .bind(cursorKind, cursorKind, cursorKind, cursorTargetId, limit)
        .all<ThumbnailCandidateRow>()

    return result.results.map(toThumbnailCandidate)
}

export async function regenerateThumbnail(
    env: Bindings,
    candidate: ThumbnailCandidate,
): Promise<{status: 'regenerated' | 'skipped'; error: null}> {
    const current = await readCurrentReference(env.DB, candidate)

    if (current?.image_key === candidate.outputImageKey) {
        await enqueuePreviousThumbnailCleanup(env.DB, candidate)
        return {status: 'regenerated', error: null}
    }

    if (!matchesCandidate(current, candidate)) {
        await enqueueNewThumbnailCleanup(env.DB, candidate)
        return {status: 'skipped', error: null}
    }

    const source = await readThumbnailOriginal(env, candidate)
    const generated = await generateSquareImageWithContainer(env, source.bytes, candidate.outputImageKey, {
        maxAttempts: 1,
        priority: 'background',
        sourceContentType: source.contentType,
    })

    let updated: boolean
    try {
        await retainThumbnailOriginal(env, candidate.outputObjectKey, source.bytes, source.contentType)
        await env.MEDIA_BUCKET.put(candidate.outputObjectKey, generated.bytes, {
            httpMetadata: {
                cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
                contentType: generated.contentType,
            },
        })
        updated = await publishThumbnail(env.DB, candidate)
    } catch (error) {
        if (await isOutputCurrent(env.DB, candidate)) {
            await finalizePublishedThumbnail(env.DB, candidate)
            return {status: 'regenerated', error: null}
        }

        await enqueueNewThumbnailCleanup(env.DB, candidate)
        throw error
    }

    if (updated || (await isOutputCurrent(env.DB, candidate))) {
        return {status: 'regenerated', error: null}
    }

    await enqueueNewThumbnailCleanup(env.DB, candidate)
    return {status: 'skipped', error: null}
}

function toThumbnailCandidate(row: ThumbnailCandidateRow): ThumbnailCandidate {
    const outputImageKey = `avif-${crypto.randomUUID()}`
    const objectKey = thumbnailObjectKey(row.kind, row.user_id, row.target_id, row.image_key)
    const outputObjectKey = thumbnailObjectKey(row.kind, row.user_id, row.target_id, outputImageKey)

    return {
        kind: row.kind,
        userId: row.user_id,
        targetId: row.target_id,
        imageKey: row.image_key,
        objectKey,
        contentType: row.content_type,
        outputImageKey,
        outputObjectKey,
    }
}

function thumbnailObjectKey(kind: ThumbnailKind, userId: string, targetId: string, imageKey: string): string {
    if (kind === 'user-profile') {
        return profilePhotoObjectKey(userId, imageKey)
    }

    if (kind === 'character-profile') {
        return characterProfileImageObjectKey(userId, targetId, imageKey)
    }

    return characterFolderImageObjectKey(userId, targetId, imageKey)
}

async function readCurrentReference(db: D1Database, candidate: ThumbnailCandidate): Promise<ThumbnailReference | null> {
    if (candidate.kind === 'user-profile') {
        return await db
            .prepare(
                `SELECT profile_photo_key AS image_key,
                        profile_photo_content_type AS content_type
                 FROM users
                 WHERE id = ?
                   AND id = ?`,
            )
            .bind(candidate.targetId, candidate.userId)
            .first<ThumbnailReference>()
    }

    if (candidate.kind === 'character-profile') {
        return await db
            .prepare(
                `SELECT profile_image_key AS image_key,
                        profile_image_content_type AS content_type
                 FROM characters
                 WHERE id = ?
                   AND user_id = ?`,
            )
            .bind(candidate.targetId, candidate.userId)
            .first<ThumbnailReference>()
    }

    return await db
        .prepare(
            `SELECT folder_image_key AS image_key,
                    folder_image_content_type AS content_type
             FROM character_folders
             WHERE id = ?
               AND user_id = ?`,
        )
        .bind(candidate.targetId, candidate.userId)
        .first<ThumbnailReference>()
}

function matchesCandidate(current: ThumbnailReference | null, candidate: ThumbnailCandidate): boolean {
    return current?.image_key === candidate.imageKey && current.content_type === candidate.contentType
}

async function isOutputCurrent(db: D1Database, candidate: ThumbnailCandidate): Promise<boolean> {
    return (await readCurrentReference(db, candidate))?.image_key === candidate.outputImageKey
}

async function publishThumbnail(db: D1Database, candidate: ThumbnailCandidate): Promise<boolean> {
    const statements = [
        updateThumbnailReference(db, candidate),
        ...cancelNewThumbnailCleanupStatements(db, candidate),
        ...previousThumbnailCleanupStatements(db, candidate),
    ]
    const results = await db.batch(statements)
    return (results[0]?.meta.changes ?? 0) > 0
}

function updateThumbnailReference(db: D1Database, candidate: ThumbnailCandidate): D1PreparedStatement {
    if (candidate.kind === 'user-profile') {
        return db
            .prepare(
                `UPDATE users
                 SET profile_photo_key = ?,
                     profile_photo_content_type = 'image/avif'
                 WHERE id = ?
                   AND id = ?
                   AND profile_photo_key = ?
                   AND profile_photo_content_type = ?`,
            )
            .bind(candidate.outputImageKey, candidate.targetId, candidate.userId, candidate.imageKey, candidate.contentType)
    }

    if (candidate.kind === 'character-profile') {
        return db
            .prepare(
                `UPDATE characters
                 SET profile_image_key = ?,
                     profile_image_content_type = 'image/avif',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                   AND user_id = ?
                   AND profile_image_key = ?
                   AND profile_image_content_type = ?`,
            )
            .bind(candidate.outputImageKey, candidate.targetId, candidate.userId, candidate.imageKey, candidate.contentType)
    }

    return db
        .prepare(
            `UPDATE character_folders
             SET folder_image_key = ?,
                 folder_image_content_type = 'image/avif',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND user_id = ?
               AND folder_image_key = ?
               AND folder_image_content_type = ?`,
        )
        .bind(candidate.outputImageKey, candidate.targetId, candidate.userId, candidate.imageKey, candidate.contentType)
}

async function enqueuePreviousThumbnailCleanup(db: D1Database, candidate: ThumbnailCandidate): Promise<void> {
    await finalizePublishedThumbnail(db, candidate)
}

async function finalizePublishedThumbnail(db: D1Database, candidate: ThumbnailCandidate): Promise<void> {
    await db.batch([...cancelNewThumbnailCleanupStatements(db, candidate), ...previousThumbnailCleanupStatements(db, candidate)])
}

function cancelNewThumbnailCleanupStatements(db: D1Database, candidate: ThumbnailCandidate): D1PreparedStatement[] {
    return [
        {bucket: 'media', objectKey: candidate.outputObjectKey},
        {bucket: 'source', objectKey: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
    ].map(({bucket, objectKey}) =>
        db
            .prepare(
                `DELETE FROM image_cleanup_tasks
                 WHERE bucket = ?
                   AND object_key = ?
                   AND ${outputReferenceExistsSql(candidate.kind)}`,
            )
            .bind(bucket, objectKey, candidate.targetId, candidate.userId, candidate.outputImageKey),
    )
}

function previousThumbnailCleanupStatements(db: D1Database, candidate: ThumbnailCandidate): D1PreparedStatement[] {
    return cleanupStatements(
        db,
        candidate,
        [
            {bucket: 'media', objectKey: candidate.objectKey},
            {bucket: 'source', objectKey: thumbnailOriginalObjectKey(candidate.objectKey)},
        ],
        {exists: true, imageKey: candidate.outputImageKey},
    )
}

async function enqueueNewThumbnailCleanup(db: D1Database, candidate: ThumbnailCandidate): Promise<void> {
    const objects: Array<{bucket: 'media' | 'source'; objectKey: string}> = [
        {bucket: 'media', objectKey: candidate.outputObjectKey},
        {bucket: 'source', objectKey: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
    ]
    await db.batch(
        cleanupStatements(db, candidate, objects, {exists: false, imageKey: candidate.outputImageKey}).concat(
            cleanupStatements(db, candidate, [{bucket: 'source', objectKey: thumbnailOriginalObjectKey(candidate.objectKey)}], {
                exists: false,
                imageKey: candidate.imageKey,
            }),
        ),
    )
}

function cleanupStatements(
    db: D1Database,
    candidate: ThumbnailCandidate,
    objects: Array<{bucket: 'media' | 'source'; objectKey: string}>,
    reference: {exists: boolean; imageKey: string},
): D1PreparedStatement[] {
    const now = new Date()
    const nowText = toSqlTimestamp(now)
    const notBefore = toSqlTimestamp(new Date(now.getTime() + THUMBNAIL_CLEANUP_GRACE_MS))

    return objects.map(({bucket, objectKey}) => {
        const statement = db.prepare(
            `INSERT OR IGNORE INTO image_cleanup_tasks (
                 id, job_id, bucket, object_key, state, not_before, created_at, updated_at
             )
             SELECT ?, NULL, ?, ?, 'pending', ?, ?, ?
             WHERE ${reference.exists ? '' : 'NOT '}${outputReferenceExistsSql(candidate.kind)}`,
        )
        const values: Array<string | null> = [crypto.randomUUID(), bucket, objectKey, notBefore, nowText, nowText]
        values.push(candidate.targetId, candidate.userId, reference.imageKey)

        return statement.bind(...values)
    })
}

function outputReferenceExistsSql(kind: ThumbnailKind): string {
    if (kind === 'user-profile') {
        return `EXISTS (
                    SELECT 1 FROM users
                    WHERE id = ? AND id = ? AND profile_photo_key = ?
                )`
    }

    if (kind === 'character-profile') {
        return `EXISTS (
                    SELECT 1 FROM characters
                    WHERE id = ? AND user_id = ? AND profile_image_key = ?
                )`
    }

    return `EXISTS (
                SELECT 1 FROM character_folders
                WHERE id = ? AND user_id = ? AND folder_image_key = ?
            )`
}
