import type {Bindings} from '../../types/bindings'

const MANAGED_PREFIXES = ['users/', 'characters/'] as const
const CLEANUP_CURSOR_CACHE_KEY = 'admin:r2-media-cleanup:cursor:v1'
const LIST_LIMIT = 500
const SCAN_LIMIT_PER_RUN = 20_000
const DELETE_LIMIT_PER_RUN = 500
const REFERENCE_INDEX_PAGE_SIZE = 500
const PROTECTED_KEY_PREFIXES = ['d1/', 'backups/', 'originals/'] as const
const MIN_STALE_AGE_MS = 24 * 60 * 60 * 1000
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string[]> = {
    'image/avif': ['avif'],
    'image/gif': ['gif'],
    'image/jpeg': ['jpg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
}

const PROFILE_EXTENSIONS = ['webp', 'avif']

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
          contentType: string
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

export type R2CleanupOptions = {
    scanLimit?: number
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

export async function cleanupStaleR2Media(
    env: R2CleanupEnv,
    now: Date = new Date(),
    options: R2CleanupOptions = {},
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
        stoppedAtScanLimit: false,
    }
    const scanLimit = Math.max(1, Math.floor(options.scanLimit ?? SCAN_LIMIT_PER_RUN))
    const referencedKeys = await tryBuildReferencedMediaKeyIndex(env.DB)
    const savedCursor = await readCleanupCursor(env.CACHE)
    const startingPrefixIndex = savedCursor ? MANAGED_PREFIXES.indexOf(savedCursor.prefix) : 0

    const prefixes = MANAGED_PREFIXES.slice(startingPrefixIndex)

    for (const [prefixIndex, prefix] of prefixes.entries()) {
        const cursor = prefixIndex === 0 ? savedCursor?.cursor : undefined
        const result = await cleanupR2Prefix(env, prefix, cursor, now, summary, scanLimit, referencedKeys)

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

        if (summary.scanned >= scanLimit && nextPrefix) {
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
    scanLimit: number,
    referencedKeys: Set<string> | null,
): Promise<PrefixCleanupResult> {
    let cursor = initialCursor

    do {
        const remainingScanCount = scanLimit - summary.scanned
        const pageStartCursor = cursor
        const listed = await env.MEDIA_BUCKET.list({prefix, limit: Math.min(LIST_LIMIT, remainingScanCount), cursor})

        for (const object of listed.objects) {
            if (await cleanupR2Object(env, object, now, summary, referencedKeys)) {
                return {status: 'stopped', reason: 'deleteLimit', cursor: pageStartCursor}
            }
        }

        cursor = listed.truncated ? listed.cursor : undefined

        if (cursor && summary.scanned >= scanLimit) {
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

async function cleanupR2Object(
    env: R2CleanupEnv,
    object: R2Object,
    now: Date,
    summary: R2CleanupSummary,
    referencedKeys: Set<string> | null,
): Promise<boolean> {
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
        if (referencedKeys?.has(object.key)) {
            summary.keptReferenced += 1
            return false
        }

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

type UserReferenceRow = {id: string; profile_photo_key: string}
type CharacterReferenceRow = {
    user_id: string
    id: string
    profile_image_key: string
    profile_image_content_type: string | null
    height_chart_json: string | null
}
type FolderReferenceRow = {user_id: string; id: string; folder_image_key: string; folder_image_content_type: string | null}
type MediaReferenceRow = {
    user_id: string
    character_id: string
    id: string
    sfw_image_key: string | null
    sfw_content_type: string | null
    nsfw_image_key: string | null
    nsfw_content_type: string | null
    sfw_preview_image_key: string | null
    sfw_preview_content_type: string | null
    nsfw_preview_image_key: string | null
    nsfw_preview_content_type: string | null
    nsfw_blur_image_key: string | null
    nsfw_blur_content_type: string | null
}
type TaskReferenceRow = {
    user_id: string
    target_id: string
    media_id: string | null
    output_json: string
}

async function tryBuildReferencedMediaKeyIndex(db: D1Database): Promise<Set<string> | null> {
    try {
        return await buildReferencedMediaKeyIndex(db)
    } catch (error) {
        console.warn(
            JSON.stringify({
                message: 'Unable to build R2 cleanup reference index; falling back to per-object checks',
                error: error instanceof Error ? error.message : String(error),
            }),
        )
        return null
    }
}

async function buildReferencedMediaKeyIndex(db: D1Database): Promise<Set<string>> {
    const keys = new Set<string>()

    const users = await selectAllRows<UserReferenceRow>(db, 'SELECT id, profile_photo_key FROM users WHERE profile_photo_key IS NOT NULL')

    for (const user of users) {
        addProfileKeyVariants(keys, `users/${user.id}/profile`, user.profile_photo_key)
    }

    const characters = await selectAllRows<CharacterReferenceRow>(
        db,
        'SELECT user_id, id, profile_image_key, profile_image_content_type, height_chart_json FROM characters',
    )

    for (const character of characters) {
        addProfileKeyVariants(keys, `characters/${character.user_id}/${character.id}/profile`, character.profile_image_key)

        const heightChart = parseHeightChartReference(character.height_chart_json)

        if (heightChart) {
            addReferencedKeyVariants(
                keys,
                `characters/${character.user_id}/${character.id}/height-chart`,
                heightChart.key,
                heightChart.contentType,
                'image/png',
            )
        }
    }

    const folders = await selectAllRows<FolderReferenceRow>(
        db,
        'SELECT user_id, id, folder_image_key, folder_image_content_type FROM character_folders WHERE folder_image_key IS NOT NULL',
    )

    for (const folder of folders) {
        addProfileKeyVariants(keys, `characters/${folder.user_id}/folders/${folder.id}/image`, folder.folder_image_key)
    }

    const media = await selectAllRows<MediaReferenceRow>(
        db,
        `SELECT user_id, character_id, id,
                sfw_image_key, sfw_content_type,
                nsfw_image_key, nsfw_content_type,
                sfw_preview_image_key, sfw_preview_content_type,
                nsfw_preview_image_key, nsfw_preview_content_type,
                nsfw_blur_image_key, nsfw_blur_content_type
         FROM character_media`,
    )

    for (const row of media) {
        const baseKey = `characters/${row.user_id}/${row.character_id}/media/${row.id}`
        addReferencedKeyVariants(keys, `${baseKey}/sfw`, row.sfw_image_key, row.sfw_content_type, 'image/png')
        addReferencedKeyVariants(keys, `${baseKey}/nsfw`, row.nsfw_image_key, row.nsfw_content_type, 'image/png')
        addReferencedKeyVariants(keys, `${baseKey}/sfw/preview`, row.sfw_preview_image_key, row.sfw_preview_content_type, 'image/webp')
        addReferencedKeyVariants(keys, `${baseKey}/nsfw/preview`, row.nsfw_preview_image_key, row.nsfw_preview_content_type, 'image/webp')
        addReferencedKeyVariants(keys, `${baseKey}/nsfw/blur`, row.nsfw_blur_image_key, row.nsfw_blur_content_type, 'image/webp')
    }

    const tasks = await selectAllRows<TaskReferenceRow>(
        db,
        `SELECT jobs.user_id AS user_id,
                jobs.target_id AS target_id,
                json_extract(jobs.request_json, '$.mediaId') AS media_id,
                tasks.output_json AS output_json
         FROM image_processing_tasks AS tasks
         JOIN image_upload_jobs AS jobs ON jobs.id = tasks.job_id
         WHERE jobs.target_type = 'gallery_create'
           AND tasks.state = 'ready'
           AND tasks.output_json IS NOT NULL
           AND (
               jobs.state IN ('queued', 'processing', 'waiting_for_sources', 'publishing')
               OR (jobs.state = 'failed' AND jobs.error_code = 'gallery_capacity_exceeded')
           )`,
    )

    for (const task of tasks) {
        for (const key of parseTaskOutputKeys(task.output_json)) {
            if (taskOutputMatchesJob(key, task)) {
                keys.add(key)
            }
        }
    }

    return keys
}

async function selectAllRows<T>(db: D1Database, sql: string): Promise<T[]> {
    const rows: T[] = []
    let offset = 0

    while (true) {
        const result = await db.prepare(`${sql} LIMIT ${REFERENCE_INDEX_PAGE_SIZE} OFFSET ${offset}`).all<T>()
        rows.push(...result.results)

        if (result.results.length < REFERENCE_INDEX_PAGE_SIZE) {
            return rows
        }

        offset += REFERENCE_INDEX_PAGE_SIZE
    }
}

function addProfileKeyVariants(keys: Set<string>, baseKey: string, imageKey: string): void {
    for (const extension of PROFILE_EXTENSIONS) {
        keys.add(`${baseKey}/${imageKey}.${extension}`)
    }
}

function addReferencedKeyVariants(
    keys: Set<string>,
    baseKey: string,
    imageKey: string | null,
    contentType: string | null,
    defaultContentType: 'image/png' | 'image/webp',
): void {
    if (!imageKey) {
        return
    }

    const normalizedContentType = typeof contentType === 'string' ? contentType.toLowerCase() : defaultContentType
    const extensions = CONTENT_TYPE_EXTENSIONS[normalizedContentType]

    if (!extensions) {
        return
    }

    for (const extension of extensions) {
        keys.add(`${baseKey}/${imageKey}.${extension}`)
    }
}

function taskOutputMatchesJob(key: string, task: TaskReferenceRow): boolean {
    if (!task.media_id) {
        return false
    }

    const parsed = parseManagedR2MediaKey(key)

    if (!parsed) {
        return false
    }

    switch (parsed.kind) {
        case 'characterMedia':
        case 'characterMediaPreview':
        case 'characterMediaNsfwBlur':
            return parsed.userId === task.user_id && parsed.characterId === task.target_id && parsed.mediaId === task.media_id
        default:
            return false
    }
}

function parseHeightChartReference(rawJson: string | null | undefined): {key: string; contentType: string | null} | null {
    if (!rawJson) {
        return null
    }

    try {
        const parsed = JSON.parse(rawJson) as unknown

        if (!isRecord(parsed) || !isRecord(parsed.image) || typeof parsed.image.key !== 'string') {
            return null
        }

        return {
            key: parsed.image.key,
            contentType: typeof parsed.image.contentType === 'string' ? parsed.image.contentType : null,
        }
    } catch {
        return null
    }
}

function parseTaskOutputKeys(rawJson: string): string[] {
    const parsed = JSON.parse(rawJson) as unknown

    if (!isRecord(parsed)) {
        return []
    }

    return ['imageObjectKey', 'previewObjectKey', 'blurObjectKey'].flatMap((field) => {
        const value = parsed[field]
        return typeof value === 'string' ? [value] : []
    })
}

function logCleanupSummary(message: string, summary: R2CleanupSummary, level: 'log' | 'warn'): void {
    console[level](JSON.stringify({message, ...summary}))
}

export function parseManagedR2MediaKey(key: string): ManagedR2MediaKey | null {
    if (PROTECTED_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        return null
    }

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
    return isSafeSegment(profilePhotoKey) && (extension === 'webp' || extension === 'avif')
        ? {kind: 'userProfile', key, userId, profilePhotoKey}
        : null
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
    return isSafeSegment(profileImageKey) && (extension === 'webp' || extension === 'avif')
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
    return isSafeSegment(folderImageKey) && (extension === 'webp' || extension === 'avif')
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
    const contentType = contentTypeForExtension(extension)
    return isSafeSegment(imageKey) && (contentType === 'image/webp' || contentType === 'image/avif')
        ? {kind: 'characterMediaNsfwBlur', key, userId, characterId, mediaId, imageKey, contentType}
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
            return await characterMediaObjectIsReferenced(db, {
                ...parsed,
                imageKeyColumn,
                contentTypeColumn,
                defaultContentType: 'image/png',
            })
        }

        case 'characterMediaPreview': {
            const imageKeyColumn = parsed.rating === 'sfw' ? 'sfw_preview_image_key' : 'nsfw_preview_image_key'
            const contentTypeColumn = parsed.rating === 'sfw' ? 'sfw_preview_content_type' : 'nsfw_preview_content_type'
            return await characterMediaObjectIsReferenced(db, {
                ...parsed,
                imageKeyColumn,
                contentTypeColumn,
                defaultContentType: 'image/webp',
            })
        }

        case 'characterMediaNsfwBlur': {
            return await characterMediaObjectIsReferenced(db, {
                ...parsed,
                imageKeyColumn: 'nsfw_blur_image_key',
                contentTypeColumn: 'nsfw_blur_content_type',
                defaultContentType: 'image/webp',
            })
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

async function characterMediaObjectIsReferenced(
    db: D1Database,
    input: {
        key: string
        userId: string
        characterId: string
        mediaId: string
        imageKey: string
        contentType: string
        imageKeyColumn: 'sfw_image_key' | 'nsfw_image_key' | 'sfw_preview_image_key' | 'nsfw_preview_image_key' | 'nsfw_blur_image_key'
        contentTypeColumn:
            | 'sfw_content_type'
            | 'nsfw_content_type'
            | 'sfw_preview_content_type'
            | 'nsfw_preview_content_type'
            | 'nsfw_blur_content_type'
        defaultContentType: 'image/png' | 'image/webp'
    },
): Promise<boolean> {
    const row = await db
        .prepare(
            `SELECT 1
             WHERE EXISTS (
                 SELECT 1
                 FROM character_media
                 WHERE user_id = ?
                   AND character_id = ?
                   AND id = ?
                   AND ${input.imageKeyColumn} = ?
                   AND lower(coalesce(${input.contentTypeColumn}, ?)) = ?
             )
                OR EXISTS (
                    SELECT 1
                    FROM image_processing_tasks AS tasks
                    JOIN image_upload_jobs AS jobs ON jobs.id = tasks.job_id
                    WHERE jobs.target_type = 'gallery_create'
                      AND jobs.user_id = ?
                      AND jobs.target_id = ?
                      AND json_extract(jobs.request_json, '$.mediaId') = ?
                      AND tasks.state = 'ready'
                      AND (
                          jobs.state IN ('queued', 'processing', 'waiting_for_sources', 'publishing')
                          OR (jobs.state = 'failed' AND jobs.error_code = 'gallery_capacity_exceeded')
                      )
                      AND (
                          json_extract(tasks.output_json, '$.imageObjectKey') = ?
                          OR json_extract(tasks.output_json, '$.previewObjectKey') = ?
                          OR json_extract(tasks.output_json, '$.blurObjectKey') = ?
                      )
               )
             LIMIT 1`,
        )
        .bind(
            input.userId,
            input.characterId,
            input.mediaId,
            input.imageKey,
            input.defaultContentType,
            input.contentType,
            input.userId,
            input.characterId,
            input.mediaId,
            input.key,
            input.key,
            input.key,
        )
        .first()
    return Boolean(row)
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
