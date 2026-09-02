import type {Bindings} from '../../types/bindings'

const MANAGED_PREFIXES = ['users/', 'characters/'] as const
const CLEANUP_CURSOR_CACHE_KEY = 'admin:r2-media-cleanup:cursor:v1'
const LIST_LIMIT = 500
const SCAN_LIMIT_PER_RUN = 900
const DELETE_LIMIT_PER_RUN = 500
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
          kind: 'characterFolderImage'
          key: string
          userId: string
          folderId: string
          folderImageKey: string
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
          contentType: string
      }
    | {
          kind: 'characterMediaNsfwBlur'
          key: string
          userId: string
          characterId: string
          mediaId: string
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
    stoppedAtScanLimit: boolean
}

type R2CleanupEnv = Pick<Bindings, 'CACHE' | 'DB' | 'MEDIA_BUCKET'>

type CleanupCursor = {
    cursor?: string
    prefix: (typeof MANAGED_PREFIXES)[number]
}

type PrefixCleanupResult = {status: 'complete'} | {status: 'stopped'; cursor?: string; reason: 'deleteLimit' | 'scanLimit'}

type ManagedR2MediaKeyParser = (key: string, parts: string[]) => ManagedR2MediaKey | null

const MANAGED_KEY_PARSERS: ManagedR2MediaKeyParser[] = [
    parseUserProfileKey,
    parseCharacterProfileKey,
    parseCharacterFolderImageKey,
    parseCharacterMediaKey,
    parseCharacterMediaPreviewKey,
    parseCharacterMediaBlurKey,
    parseCharacterHeightChartKey,
]

export async function cleanupStaleR2Media(env: R2CleanupEnv, now: Date = new Date()): Promise<R2CleanupSummary> {
    const summary: R2CleanupSummary = {
        scanned: 0,
        recognized: 0,
        skippedUnknown: 0,
        skippedRecent: 0,
        keptReferenced: 0,
        deleted: 0,
        errors: 0,
        stoppedAtDeleteLimit: false,
        stoppedAtScanLimit: false,
    }
    const savedCursor = await readCleanupCursor(env.CACHE)
    const startingPrefixIndex = savedCursor ? MANAGED_PREFIXES.indexOf(savedCursor.prefix) : 0

    const prefixes = MANAGED_PREFIXES.slice(startingPrefixIndex)

    for (const [prefixIndex, prefix] of prefixes.entries()) {
        const cursor = prefixIndex === 0 ? savedCursor?.cursor : undefined
        const result = await cleanupR2Prefix(env, prefix, cursor, now, summary)

        if (result.status === 'stopped') {
            summary.stoppedAtDeleteLimit = result.reason === 'deleteLimit'
            summary.stoppedAtScanLimit = result.reason === 'scanLimit'
            await writeCleanupCursor(env.CACHE, {prefix, cursor: result.cursor})
            logCleanupSummary(
                `R2 media cleanup stopped at per-run ${result.reason === 'deleteLimit' ? 'delete' : 'scan'} limit`,
                summary,
                'warn',
            )
            return summary
        }

        const nextPrefix = prefixes[prefixIndex + 1]

        if (summary.scanned >= SCAN_LIMIT_PER_RUN && nextPrefix) {
            summary.stoppedAtScanLimit = true
            await writeCleanupCursor(env.CACHE, {prefix: nextPrefix})
            logCleanupSummary('R2 media cleanup stopped at per-run scan limit', summary, 'warn')
            return summary
        }
    }

    await env.CACHE.delete(CLEANUP_CURSOR_CACHE_KEY)
    logCleanupSummary('R2 media cleanup complete', summary, 'log')
    return summary
}

async function cleanupR2Prefix(
    env: R2CleanupEnv,
    prefix: string,
    initialCursor: string | undefined,
    now: Date,
    summary: R2CleanupSummary,
): Promise<PrefixCleanupResult> {
    let cursor = initialCursor

    do {
        const remainingScanCount = SCAN_LIMIT_PER_RUN - summary.scanned
        const pageStartCursor = cursor
        const listed = await env.MEDIA_BUCKET.list({prefix, limit: Math.min(LIST_LIMIT, remainingScanCount), cursor})

        for (const object of listed.objects) {
            if (await cleanupR2Object(env, object, now, summary)) {
                return {status: 'stopped', reason: 'deleteLimit', cursor: pageStartCursor}
            }
        }

        cursor = listed.truncated ? listed.cursor : undefined

        if (cursor && summary.scanned >= SCAN_LIMIT_PER_RUN) {
            return {status: 'stopped', reason: 'scanLimit', cursor}
        }
    } while (cursor)

    return {status: 'complete'}
}

async function readCleanupCursor(cache: KVNamespace): Promise<CleanupCursor | null> {
    const rawValue = await cache.get(CLEANUP_CURSOR_CACHE_KEY)

    if (!rawValue) {
        return null
    }

    let value: unknown

    try {
        value = JSON.parse(rawValue) as unknown
    } catch {
        await cache.delete(CLEANUP_CURSOR_CACHE_KEY)
        return null
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        await cache.delete(CLEANUP_CURSOR_CACHE_KEY)
        return null
    }

    const {cursor, prefix} = value as Record<string, unknown>

    if (!MANAGED_PREFIXES.includes(prefix as CleanupCursor['prefix']) || (cursor !== undefined && typeof cursor !== 'string')) {
        await cache.delete(CLEANUP_CURSOR_CACHE_KEY)
        return null
    }

    return {
        prefix: prefix as CleanupCursor['prefix'],
        ...(typeof cursor === 'string' ? {cursor} : {}),
    }
}

async function writeCleanupCursor(cache: KVNamespace, cursor: CleanupCursor): Promise<void> {
    await cache.put(CLEANUP_CURSOR_CACHE_KEY, JSON.stringify(cursor))
}

async function cleanupR2Object(env: R2CleanupEnv, object: R2Object, now: Date, summary: R2CleanupSummary): Promise<boolean> {
    summary.scanned += 1

    if (!isOldEnoughToClean(object, now)) {
        summary.skippedRecent += 1
        return false
    }

    const parsed = parseManagedR2MediaKey(object.key)

    if (!parsed) {
        summary.skippedUnknown += 1
        return false
    }

    summary.recognized += 1

    try {
        if (await isManagedR2MediaKeyReferenced(env.DB, parsed)) {
            summary.keptReferenced += 1
            return false
        }

        await env.MEDIA_BUCKET.delete(object.key)
        summary.deleted += 1
        summary.stoppedAtDeleteLimit = summary.deleted >= DELETE_LIMIT_PER_RUN
        return summary.stoppedAtDeleteLimit
    } catch (error) {
        summary.errors += 1
        console.warn(
            JSON.stringify({
                message: 'Unable to evaluate R2 media object for cleanup',
                key: object.key,
                error: error instanceof Error ? error.message : String(error),
            }),
        )
        return false
    }
}

function logCleanupSummary(message: string, summary: R2CleanupSummary, level: 'log' | 'warn'): void {
    console[level](JSON.stringify({message, ...summary}))
}

export function parseManagedR2MediaKey(key: string): ManagedR2MediaKey | null {
    const parts = key.split('/')

    for (const parser of MANAGED_KEY_PARSERS) {
        const parsed = parser(key, parts)

        if (parsed) {
            return parsed
        }
    }

    return null
}

function parseUserProfileKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, segment, fileName] = parts

    if (parts.length !== 4 || prefix !== 'users' || segment !== 'profile' || !isSafeSegment(userId) || typeof fileName !== 'string') {
        return null
    }

    const [profilePhotoKey, extension] = splitFileName(fileName)
    return isSafeSegment(profilePhotoKey) && extension === 'webp' ? {kind: 'userProfile', key, userId, profilePhotoKey} : null
}

function parseCharacterProfileKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, characterId, segment, fileName] = parts

    if (
        parts.length !== 5 ||
        prefix !== 'characters' ||
        segment !== 'profile' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(characterId) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [profileImageKey, extension] = splitFileName(fileName)
    return isSafeSegment(profileImageKey) && extension === 'webp'
        ? {kind: 'characterProfile', key, userId, characterId, profileImageKey}
        : null
}

function parseCharacterFolderImageKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, folderSegment, folderId, imageSegment, fileName] = parts

    if (
        parts.length !== 6 ||
        prefix !== 'characters' ||
        folderSegment !== 'folders' ||
        imageSegment !== 'image' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(folderId) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [folderImageKey, extension] = splitFileName(fileName)
    return isSafeSegment(folderImageKey) && extension === 'webp'
        ? {kind: 'characterFolderImage', key, userId, folderId, folderImageKey}
        : null
}

function parseCharacterMediaKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, characterId, mediaSegment, mediaId, rating, fileName] = parts

    if (
        parts.length !== 7 ||
        prefix !== 'characters' ||
        mediaSegment !== 'media' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(characterId) ||
        !isSafeSegment(mediaId) ||
        !isRating(rating) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [imageKey, extension] = splitFileName(fileName)
    const contentType = contentTypeForExtension(extension)
    return isSafeSegment(imageKey) && contentType
        ? {kind: 'characterMedia', key, userId, characterId, mediaId, rating, imageKey, contentType}
        : null
}

function parseCharacterMediaPreviewKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, characterId, mediaSegment, mediaId, rating, previewSegment, fileName] = parts

    if (
        parts.length !== 8 ||
        prefix !== 'characters' ||
        mediaSegment !== 'media' ||
        previewSegment !== 'preview' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(characterId) ||
        !isSafeSegment(mediaId) ||
        !isRating(rating) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [imageKey, extension] = splitFileName(fileName)
    const contentType = contentTypeForExtension(extension)
    return isSafeSegment(imageKey) && (contentType === 'image/webp' || contentType === 'image/avif')
        ? {kind: 'characterMediaPreview', key, userId, characterId, mediaId, rating, imageKey, contentType}
        : null
}

function parseCharacterMediaBlurKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, characterId, mediaSegment, mediaId, rating, blurSegment, fileName] = parts

    if (
        parts.length !== 8 ||
        prefix !== 'characters' ||
        mediaSegment !== 'media' ||
        rating !== 'nsfw' ||
        blurSegment !== 'blur' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(characterId) ||
        !isSafeSegment(mediaId) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [imageKey, extension] = splitFileName(fileName)
    return isSafeSegment(imageKey) && extension === 'webp'
        ? {kind: 'characterMediaNsfwBlur', key, userId, characterId, mediaId, imageKey}
        : null
}

function parseCharacterHeightChartKey(key: string, parts: string[]): ManagedR2MediaKey | null {
    const [prefix, userId, characterId, segment, fileName] = parts

    if (
        parts.length !== 5 ||
        prefix !== 'characters' ||
        segment !== 'height-chart' ||
        !isSafeSegment(userId) ||
        !isSafeSegment(characterId) ||
        typeof fileName !== 'string'
    ) {
        return null
    }

    const [imageKey, extension] = splitFileName(fileName)
    const contentType = contentTypeForExtension(extension)
    return isSafeSegment(imageKey) && contentType ? {kind: 'characterHeightChart', key, userId, characterId, imageKey, contentType} : null
}

async function isManagedR2MediaKeyReferenced(db: D1Database, parsed: ManagedR2MediaKey): Promise<boolean> {
    switch (parsed.kind) {
        case 'userProfile': {
            const row = await db
                .prepare(
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
            const row = await db
                .prepare(
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

        case 'characterFolderImage': {
            const row = await db
                .prepare(
                    `SELECT 1
                 FROM character_folders
                 WHERE user_id = ?
                   AND id = ?
                   AND folder_image_key = ?
                 LIMIT 1`,
                )
                .bind(parsed.userId, parsed.folderId, parsed.folderImageKey)
                .first()
            return Boolean(row)
        }

        case 'characterMedia': {
            const imageKeyColumn = parsed.rating === 'sfw' ? 'sfw_image_key' : 'nsfw_image_key'
            const contentTypeColumn = parsed.rating === 'sfw' ? 'sfw_content_type' : 'nsfw_content_type'
            const row = await db
                .prepare(
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
            const contentTypeColumn = parsed.rating === 'sfw' ? 'sfw_preview_content_type' : 'nsfw_preview_content_type'
            const row = await db
                .prepare(
                    `SELECT 1
                 FROM character_media
                 WHERE user_id = ?
                   AND character_id = ?
                   AND id = ?
                   AND ${imageKeyColumn} = ?
                   AND lower(coalesce(${contentTypeColumn}, 'image/webp')) = ?
                 LIMIT 1`,
                )
                .bind(parsed.userId, parsed.characterId, parsed.mediaId, parsed.imageKey, parsed.contentType)
                .first()
            return Boolean(row)
        }

        case 'characterMediaNsfwBlur': {
            const row = await db
                .prepare(
                    `SELECT 1
                 FROM character_media
                 WHERE user_id = ?
                   AND character_id = ?
                   AND id = ?
                   AND nsfw_blur_image_key = ?
                 LIMIT 1`,
                )
                .bind(parsed.userId, parsed.characterId, parsed.mediaId, parsed.imageKey)
                .first()
            return Boolean(row)
        }

        case 'characterHeightChart': {
            const row = await db
                .prepare(
                    `SELECT height_chart_json
                 FROM characters
                 WHERE user_id = ?
                   AND id = ?
                 LIMIT 1`,
                )
                .bind(parsed.userId, parsed.characterId)
                .first<{height_chart_json?: string | null}>()

            return heightChartReferencesImage(row?.height_chart_json, parsed.imageKey, parsed.contentType)
        }
    }
}

function isOldEnoughToClean(object: R2Object, now: Date): boolean {
    return now.getTime() - object.uploaded.getTime() >= MIN_STALE_AGE_MS
}

function heightChartReferencesImage(rawJson: string | null | undefined, imageKey: string, contentType: string): boolean {
    if (!rawJson) {
        return false
    }

    try {
        const parsed = JSON.parse(rawJson) as unknown

        if (!isRecord(parsed) || !isRecord(parsed.image)) {
            return false
        }

        return parsed.image.key === imageKey && normalizeContentType(parsed.image.contentType) === contentType
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

function isRating(value: unknown): value is 'sfw' | 'nsfw' {
    return value === 'sfw' || value === 'nsfw'
}

function isSafeSegment(value: unknown): value is string {
    return typeof value === 'string' && SAFE_SEGMENT.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}
