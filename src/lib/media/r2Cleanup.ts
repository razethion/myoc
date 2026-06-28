import type {Bindings} from '../../types/bindings'

const MANAGED_PREFIXES = ['users/', 'characters/']
const LIST_LIMIT = 1000
const DELETE_LIMIT_PER_RUN = 5000
const MIN_STALE_AGE_MS = 24 * 60 * 60 * 1000
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
}

type ManagedR2MediaKey =
    | {
    kind: 'userProfile'
    key: string
    userId: string
    profilePhotoKey: string
}
    | {
    kind: 'characterProfile'
    key: string
    userId: string
    characterId: string
    profileImageKey: string
}
    | {
    kind: 'characterMedia'
    key: string
    userId: string
    characterId: string
    mediaId: string
    rating: 'sfw' | 'nsfw'
    imageKey: string
    contentType: string
}
    | {
    kind: 'characterMediaPreview'
    key: string
    userId: string
    characterId: string
    mediaId: string
    rating: 'sfw' | 'nsfw'
    imageKey: string
}
    | {
    kind: 'characterHeightChart'
    key: string
    userId: string
    characterId: string
    imageKey: string
    contentType: string
}

export type R2CleanupSummary = {
    scanned: number
    recognized: number
    skippedUnknown: number
    skippedRecent: number
    keptReferenced: number
    deleted: number
    errors: number
    stoppedAtDeleteLimit: boolean
}

type R2CleanupEnv = Pick<Bindings, 'DB' | 'MEDIA_BUCKET'>

export async function cleanupStaleR2Media(
    env: R2CleanupEnv,
    now: Date = new Date(),
): Promise<R2CleanupSummary> {
    const summary: R2CleanupSummary = {
        scanned: 0,
        recognized: 0,
        skippedUnknown: 0,
        skippedRecent: 0,
        keptReferenced: 0,
        deleted: 0,
        errors: 0,
        stoppedAtDeleteLimit: false,
    }

    for (const prefix of MANAGED_PREFIXES) {
        let cursor: string | undefined

        do {
            const listed = await env.MEDIA_BUCKET.list({
                prefix,
                limit: LIST_LIMIT,
                cursor,
            })

            for (const object of listed.objects) {
                summary.scanned += 1

                if (!isOldEnoughToClean(object, now)) {
                    summary.skippedRecent += 1
                    continue
                }

                const parsed = parseManagedR2MediaKey(object.key)

                if (!parsed) {
                    summary.skippedUnknown += 1
                    continue
                }

                summary.recognized += 1

                try {
                    const referenced = await isManagedR2MediaKeyReferenced(env.DB, parsed)

                    if (referenced) {
                        summary.keptReferenced += 1
                        continue
                    }

                    await env.MEDIA_BUCKET.delete(object.key)
                    summary.deleted += 1

                    if (summary.deleted >= DELETE_LIMIT_PER_RUN) {
                        summary.stoppedAtDeleteLimit = true
                        console.warn('R2 media cleanup stopped at per-run delete limit', summary)
                        return summary
                    }
                } catch (error) {
                    summary.errors += 1
                    console.warn('Unable to evaluate R2 media object for cleanup', {
                        key: object.key,
                        error,
                    })
                }
            }

            cursor = listed.truncated ? listed.cursor : undefined
        } while (cursor)
    }

    console.log('R2 media cleanup complete', summary)
    return summary
}

export function parseManagedR2MediaKey(key: string): ManagedR2MediaKey | null {
    const parts = key.split('/')

    if (parts.length === 4 && parts[0] === 'users' && parts[2] === 'profile') {
        const [profilePhotoKey, extension] = splitFileName(parts[3])

        if (isSafeSegment(parts[1]) && isSafeSegment(profilePhotoKey) && extension === 'webp') {
            return {
                kind: 'userProfile',
                key,
                userId: parts[1],
                profilePhotoKey,
            }
        }
    }

    if (parts.length === 5 && parts[0] === 'characters' && parts[3] === 'profile') {
        const [profileImageKey, extension] = splitFileName(parts[4])

        if (
            isSafeSegment(parts[1])
            && isSafeSegment(parts[2])
            && isSafeSegment(profileImageKey)
            && extension === 'webp'
        ) {
            return {
                kind: 'characterProfile',
                key,
                userId: parts[1],
                characterId: parts[2],
                profileImageKey,
            }
        }
    }

    if (parts.length === 7 && parts[0] === 'characters' && parts[3] === 'media') {
        const [imageKey, extension] = splitFileName(parts[6])
        const contentType = contentTypeForExtension(extension)

        if (
            isSafeSegment(parts[1])
            && isSafeSegment(parts[2])
            && isSafeSegment(parts[4])
            && (parts[5] === 'sfw' || parts[5] === 'nsfw')
            && isSafeSegment(imageKey)
            && contentType
        ) {
            return {
                kind: 'characterMedia',
                key,
                userId: parts[1],
                characterId: parts[2],
                mediaId: parts[4],
                rating: parts[5],
                imageKey,
                contentType,
            }
        }
    }

    if (parts.length === 8 && parts[0] === 'characters' && parts[3] === 'media' && parts[6] === 'preview') {
        const [imageKey, extension] = splitFileName(parts[7])

        if (
            isSafeSegment(parts[1])
            && isSafeSegment(parts[2])
            && isSafeSegment(parts[4])
            && (parts[5] === 'sfw' || parts[5] === 'nsfw')
            && isSafeSegment(imageKey)
            && extension === 'webp'
        ) {
            return {
                kind: 'characterMediaPreview',
                key,
                userId: parts[1],
                characterId: parts[2],
                mediaId: parts[4],
                rating: parts[5],
                imageKey,
            }
        }
    }

    if (parts.length === 5 && parts[0] === 'characters' && parts[3] === 'height-chart') {
        const [imageKey, extension] = splitFileName(parts[4])
        const contentType = contentTypeForExtension(extension)

        if (
            isSafeSegment(parts[1])
            && isSafeSegment(parts[2])
            && isSafeSegment(imageKey)
            && contentType
        ) {
            return {
                kind: 'characterHeightChart',
                key,
                userId: parts[1],
                characterId: parts[2],
                imageKey,
                contentType,
            }
        }
    }

    return null
}

async function isManagedR2MediaKeyReferenced(db: D1Database, parsed: ManagedR2MediaKey): Promise<boolean> {
    switch (parsed.kind) {
        case 'userProfile': {
            const row = await db.prepare(
                `SELECT 1
                 FROM users
                 WHERE id = ?
                   AND profile_photo_key = ?
                 LIMIT 1`,
            )
                .bind(parsed.userId, parsed.profilePhotoKey)
                .first()
            return Boolean(row)
        }

        case 'characterProfile': {
            const row = await db.prepare(
                `SELECT 1
                 FROM characters
                 WHERE user_id = ?
                   AND id = ?
                   AND profile_image_key = ?
                 LIMIT 1`,
            )
                .bind(parsed.userId, parsed.characterId, parsed.profileImageKey)
                .first()
            return Boolean(row)
        }

        case 'characterMedia': {
            const imageKeyColumn = parsed.rating === 'sfw' ? 'sfw_image_key' : 'nsfw_image_key'
            const contentTypeColumn = parsed.rating === 'sfw' ? 'sfw_content_type' : 'nsfw_content_type'
            const row = await db.prepare(
                `SELECT 1
                 FROM character_media
                 WHERE user_id = ?
                   AND character_id = ?
                   AND id = ?
                   AND ${imageKeyColumn} = ?
                   AND lower(coalesce(${contentTypeColumn}, 'image/png')) = ?
                 LIMIT 1`,
            )
                .bind(parsed.userId, parsed.characterId, parsed.mediaId, parsed.imageKey, parsed.contentType)
                .first()
            return Boolean(row)
        }

        case 'characterMediaPreview': {
            const imageKeyColumn = parsed.rating === 'sfw' ? 'sfw_preview_image_key' : 'nsfw_preview_image_key'
            const row = await db.prepare(
                `SELECT 1
                 FROM character_media
                 WHERE user_id = ?
                   AND character_id = ?
                   AND id = ?
                   AND ${imageKeyColumn} = ?
                 LIMIT 1`,
            )
                .bind(parsed.userId, parsed.characterId, parsed.mediaId, parsed.imageKey)
                .first()
            return Boolean(row)
        }

        case 'characterHeightChart': {
            const row = await db.prepare(
                `SELECT height_chart_json
                 FROM characters
                 WHERE user_id = ?
                   AND id = ?
                 LIMIT 1`,
            )
                .bind(parsed.userId, parsed.characterId)
                .first<{ height_chart_json?: string | null }>()

            return heightChartReferencesImage(row?.height_chart_json, parsed.imageKey, parsed.contentType)
        }
    }
}

function isOldEnoughToClean(object: R2Object, now: Date): boolean {
    return now.getTime() - object.uploaded.getTime() >= MIN_STALE_AGE_MS
}

function heightChartReferencesImage(
    rawJson: string | null | undefined,
    imageKey: string,
    contentType: string,
): boolean {
    if (!rawJson) {
        return false
    }

    try {
        const parsed = JSON.parse(rawJson) as unknown

        if (!isRecord(parsed) || !isRecord(parsed.image)) {
            return false
        }

        return parsed.image.key === imageKey
            && normalizeContentType(parsed.image.contentType) === contentType
    } catch {
        return false
    }
}

function splitFileName(fileName: string): [string, string] {
    const dotIndex = fileName.lastIndexOf('.')

    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
        return ['', '']
    }

    return [fileName.slice(0, dotIndex), fileName.slice(dotIndex + 1).toLowerCase()]
}

function contentTypeForExtension(extension: string): string | null {
    return EXTENSION_CONTENT_TYPES[extension] ?? null
}

function normalizeContentType(value: unknown): string {
    return typeof value === 'string' ? value.toLowerCase() : 'image/png'
}

function isSafeSegment(value: string): boolean {
    return SAFE_SEGMENT.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}
