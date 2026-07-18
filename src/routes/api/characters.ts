import type {Context} from 'hono'
import {Hono} from 'hono'
import {z} from 'zod'
import {queueImageReview} from '../../lib/admin/imageApprovals'
import {type CurrentUser, getCurrentUser, toSqlTimestamp} from '../../lib/auth/session'
import {GALLERY_MAX_IMAGES_PER_ROW, shouldForceGalleryRowFullWidth} from '../../lib/gallery'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {
    CharacterFolderSchema,
    CharacterHeightChartSchema,
    ChunkedUploadSchema,
    ErrorResponseSchema,
    GalleryLayoutResponseSchema,
    OkResponseSchema,
    PublicCharacterSchema,
    PublicMediaSchema,
    R2UploadedPartSchema,
    responseSchema,
} from '../../lib/http/responseSchemas'
import {getPngDimensions} from '../../lib/media/png'
import {PROFILE_IMAGE_MAX_REQUEST_BYTES, validateProfileImagePayload} from '../../lib/media/profileImage'
import {
    characterFolderImageObjectKey,
    characterFolderImageUrl,
    characterHeightChartImageObjectKey,
    characterHeightChartImageUrl,
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaNsfwBlurImageUrl,
    characterMediaPreviewImageObjectKey,
    characterMediaPreviewImageUrl,
    characterProfileImageObjectKey,
    characterProfileImageUrl,
} from '../../lib/media/url'
import {getWebpDimensions} from '../../lib/media/webp'
import type {Bindings} from '../../types/bindings'

type CharacterRouteContext = Context<{Bindings: Bindings}>

const CharacterResponseSchema = responseSchema({character: PublicCharacterSchema})
const FolderResponseSchema = responseSchema({folder: CharacterFolderSchema})
const CharacterProfileImageResponseSchema = responseSchema({
    profileImageKey: z.string(),
    profileImageUrl: z.string(),
})
const CharacterFolderImageResponseSchema = responseSchema({
    folderImageKey: z.string(),
    folderImageUrl: z.string(),
})
const HeightChartResponseSchema = responseSchema({heightChart: CharacterHeightChartSchema})
const ChunkedUploadInitResponseSchema = responseSchema({
    mediaId: z.string(),
    uploads: responseSchema({
        sfw: ChunkedUploadSchema.optional(),
        nsfw: ChunkedUploadSchema.optional(),
    }),
})
const MediaResponseSchema = responseSchema({media: PublicMediaSchema})
const ToyhouseImportCompleteResponseSchema = responseSchema({
    media: PublicMediaSchema,
    skipped: z.boolean(),
})

type CreateCharacterRequest = {
    name?: unknown
    folderId?: unknown
    profileImageData?: unknown
    profileImage?: unknown
    'new-character-name'?: unknown
    'new-character-folder'?: unknown
}

type CreateFolderRequest = {
    name?: unknown
    parentFolderId?: unknown
    parentId?: unknown
    folderImageData?: unknown
    folderImage?: unknown
    'new-folder-name'?: unknown
    'new-folder-parent'?: unknown
}

type UpdateFolderRequest = {
    name?: unknown
    'edit-folder-name'?: unknown
}

type DeleteCharacterRequest = {
    confirmName?: unknown
    permanent?: unknown
    'delete-character-confirm-name'?: unknown
    'delete-confirm-permanent'?: unknown
}

type SortTreeRequest = {
    items?: unknown
}

type SortCharacterOrderRequest = {
    characterIds?: unknown
}

type SaveFolderPlacementsRequest = {
    characterIds?: unknown
}

type UpdateCharacterRequest = {
    name?: unknown
    description?: unknown
}

type HeightChartSaveRequest = {
    height?: unknown
    image?: unknown
    calibration?: unknown
}

type GalleryLayoutRequest = {
    tabs?: unknown
}

type ChunkedMediaInitRequest = {
    uploads?: unknown
    ratings?: unknown
}

type ChunkedMediaCompleteRequest = {
    mediaId?: unknown
    sfwUpload?: unknown
    nsfwUpload?: unknown
    sfwPreview?: unknown
    nsfwPreview?: unknown
    sfwArtist?: unknown
    nsfwArtist?: unknown
    removeSfw?: unknown
    removeNsfw?: unknown
}

type MediaRating = 'sfw' | 'nsfw'

type CompletedChunkedUpload = {
    uploadId: string
    imageKey: string
    contentType: string
    width: number
    height: number
    parts: R2UploadedPart[]
}

type ParsedPreviewImage = {
    bytes: Uint8Array
    contentType: 'image/webp'
    width: number
    height: number
}

type ParsedMediaArtists = {
    sfwArtist: string
    nsfwArtist: string
}

type ParsedChunkedMediaComplete = {
    body: ChunkedMediaCompleteRequest
    artists: ParsedMediaArtists
    sfwUpload: CompletedChunkedUpload | null
    nsfwUpload: CompletedChunkedUpload | null
}

type JsonProfileImage = {
    data: string
}

type CharacterRecord = {
    id: string
    user_id: string
    name: string
    profile_image_key: string | null
    folder_id: string | null
    sort_order: number
    description?: string
    height_chart_json?: string
    created_at: string
    updated_at: string
}

type CharacterHeightChartJson = {
    version: 1
    height: {
        meters: number
    }
    image: null | {
        key: string
        contentType: string
        naturalWidth: number
        naturalHeight: number
    }
    calibration: {
        headYPercent: number
        footYPercent: number
        footIsVirtual: boolean
        nameTagXPercent: number
    }
}

type CharacterMediaRecord = {
    id: string
    user_id: string
    character_id: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_content_type: string | null
    nsfw_content_type: string | null
    sfw_artist: string
    nsfw_artist: string
    sfw_width: number | null
    sfw_height: number | null
    sfw_byte_size: number | null
    nsfw_width: number | null
    nsfw_height: number | null
    nsfw_byte_size: number | null
    sfw_preview_image_key: string | null
    sfw_preview_width: number | null
    sfw_preview_height: number | null
    sfw_preview_byte_size: number | null
    nsfw_preview_image_key: string | null
    nsfw_blur_image_key: string | null
    nsfw_preview_width: number | null
    nsfw_preview_height: number | null
    nsfw_preview_byte_size: number | null
    created_at: string
    updated_at: string
}

type ToyhouseImportItemRecord = {
    id: string
    job_id: string
    user_id: string
    character_id: string
    rating: MediaRating
    status: 'pending' | 'uploading' | 'imported' | 'failed'
    media_id: string | null
}

type CharacterFolderRecord = {
    id: string
    user_id: string
    name: string
    parent_folder_id: string | null
    folder_image_key: string | null
    sort_order: number
    created_at: string
    updated_at: string
}

const CHARACTER_NAME_MAX_LENGTH = 80
const FOLDER_NAME_MAX_LENGTH = 80
const FOLDER_ID_MAX_LENGTH = 128
const CHARACTER_DESCRIPTION_MAX_LENGTH = 255
const ARTIST_NAME_MAX_LENGTH = 80
const GALLERY_CHUNK_SIZE = 8 * 1024 * 1024
const GALLERY_MAX_TABS = 20
const GALLERY_MAX_ROWS = 100
const GALLERY_MAX_MEDIA_PLACEMENTS = 500
const GALLERY_MAX_MEDIA_PER_CHARACTER = GALLERY_MAX_MEDIA_PLACEMENTS
const TREE_MAX_ITEMS = 500
const TREE_MAX_DEPTH = 20
const SQL_IN_CLAUSE_CHUNK_SIZE = 50
const SQL_SELECT_CHUNK_SIZE = 100
const CHARACTER_NAME_ALLOWED_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 _'".()-]+$/
const CHARACTER_NAME_RULES = 'letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses'
const DISPLAY_NAME_ALLOWED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _'.()-]*$/
const DISPLAY_NAME_RULES = 'letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses'
const DUPLICATE_CHARACTER_NAME_ERROR = 'Character name already exists on this account'
const GALLERY_IMAGE_ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'])

const GALLERY_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const GALLERY_IMAGE_MAX_BYTES = 200 * 1024 * 1024
const GALLERY_IMAGE_MAX_PIXELS = 200_000_000
const GALLERY_PREVIEW_CONTENT_TYPE = 'image/webp'
const GALLERY_PREVIEW_MAX_LONG_EDGE = 1600
const GALLERY_PREVIEW_QUALITY = 90
const GALLERY_PREVIEW_MAX_PIXELS = GALLERY_PREVIEW_MAX_LONG_EDGE * GALLERY_PREVIEW_MAX_LONG_EDGE
const GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL = 4
const GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES = 4096
const GALLERY_PREVIEW_MAX_BYTES =
    GALLERY_PREVIEW_MAX_PIXELS * GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL + GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES
const GALLERY_PREVIEW_DIMENSION_TOLERANCE = 1
const GALLERY_IMAGE_DIMENSION_PROBE_BYTES = 1024 * 1024
const GALLERY_NSFW_BLUR_MAX_WIDTH = 960
const GALLERY_NSFW_BLUR_AMOUNT = 250
const GALLERY_NSFW_BLUR_QUALITY = 85
const HEIGHT_CHART_JSON_MAX_LENGTH = 2048
const HEIGHT_CHART_MIN_METERS = 0.01
const HEIGHT_CHART_MAX_METERS = 100
const HEIGHT_CHART_MAX_FOOT_PERCENT = 180

type ChunkedUploadInit = {
    rating: MediaRating
    contentType: string
}

type CompletedGalleryUpload = {
    imageKey: string
    contentType: string
    width: number
    height: number
    byteSize: number
}

type CompletedGalleryPreview = {
    imageKey: string
    width: number
    height: number
    byteSize: number
}

export const characterRoutes = new Hono<{Bindings: Bindings}>()

characterRoutes.post('/folders/tree', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    let body: SortTreeRequest

    try {
        body = await c.req.json<SortTreeRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    if (!Array.isArray(body.items)) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder tree items are required'}, 400)
    }

    const flattened = flattenTreeItems(body.items)

    if ('error' in flattened) {
        return jsonResponse(c, ErrorResponseSchema, {error: flattened.error}, 400)
    }

    if (flattened.items.some((item) => item.type !== 'folder')) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder tree may contain only folders'}, 400)
    }

    const folderIds = flattened.items.map((item) => item.id)
    const ownedFolderIds = await getOwnedFolderIds(c.env.DB, currentUser.id, folderIds)

    for (const folderId of folderIds) {
        if (!ownedFolderIds.has(folderId)) {
            return jsonResponse(c, ErrorResponseSchema, {error: 'Folder tree contains folders that do not belong to the current user'}, 400)
        }
    }

    const now = toSqlTimestamp(new Date())
    const statements = flattened.items.map((item) =>
        c.env.DB.prepare(
            `UPDATE character_folders
         SET parent_folder_id = ?,
             sort_order       = ?,
             updated_at       = ?
         WHERE id = ?
           AND user_id = ?`,
        ).bind(item.parentFolderId, item.sortOrder, now, item.id, currentUser.id),
    )

    if (statements.length > 0) {
        await c.env.DB.batch(statements)
    }

    return jsonResponse(c, OkResponseSchema, {ok: true})
})

characterRoutes.post('/order', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    let body: SortCharacterOrderRequest

    try {
        body = await c.req.json<SortCharacterOrderRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const orderedIds = normalizeOrderedIds(body.characterIds, 'Character order')

    if ('error' in orderedIds) {
        return jsonResponse(c, ErrorResponseSchema, {error: orderedIds.error}, 400)
    }

    const ownedCharacterIds = await getOwnedCharacterIds(c.env.DB, currentUser.id, orderedIds.ids)

    for (const characterId of orderedIds.ids) {
        if (!ownedCharacterIds.has(characterId)) {
            return jsonResponse(
                c,
                ErrorResponseSchema,
                {error: 'Character order contains characters that do not belong to the current user'},
                400,
            )
        }
    }

    const now = toSqlTimestamp(new Date())
    const statements = orderedIds.ids.map((characterId, index) =>
        c.env.DB.prepare(
            `UPDATE characters
         SET sort_order = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`,
        ).bind(index, now, characterId, currentUser.id),
    )

    if (statements.length > 0) {
        await c.env.DB.batch(statements)
    }

    return jsonResponse(c, OkResponseSchema, {ok: true})
})

characterRoutes.put('/folders/:id/placements', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const folderIdResult = normalizeFolderId(c.req.param('id'))

    if ('error' in folderIdResult || !folderIdResult.folderId) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder must be a valid folder id'}, 400)
    }

    if (!(await folderExists(c.env.DB, currentUser.id, folderIdResult.folderId))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    let body: SaveFolderPlacementsRequest

    try {
        body = await c.req.json<SaveFolderPlacementsRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const orderedIds = normalizeOrderedIds(body.characterIds, 'Folder placements')

    if ('error' in orderedIds) {
        return jsonResponse(c, ErrorResponseSchema, {error: orderedIds.error}, 400)
    }

    const ownedCharacterIds = await getOwnedCharacterIds(c.env.DB, currentUser.id, orderedIds.ids)

    for (const characterId of orderedIds.ids) {
        if (!ownedCharacterIds.has(characterId)) {
            return jsonResponse(
                c,
                ErrorResponseSchema,
                {error: 'Folder placements contain characters that do not belong to the current user'},
                400,
            )
        }
    }

    const now = toSqlTimestamp(new Date())
    const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
            `DELETE FROM character_folder_placements
             WHERE user_id = ?
               AND folder_id = ?`,
        ).bind(currentUser.id, folderIdResult.folderId),
    ]

    for (let index = 0; index < orderedIds.ids.length; index += 1) {
        statements.push(
            c.env.DB.prepare(
                `INSERT INTO character_folder_placements (user_id, folder_id, character_id, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(currentUser.id, folderIdResult.folderId, orderedIds.ids[index], index, now, now),
        )
    }

    await c.env.DB.batch(statements)

    return jsonResponse(c, OkResponseSchema, {ok: true})
})

characterRoutes.post('/folders', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const parsed = await parseCreateFolderRequest(c.req)

    if ('error' in parsed) {
        return jsonResponse(c, ErrorResponseSchema, {error: parsed.error}, 400)
    }

    const nameResult = normalizeFolderName(parsed.name)

    if ('error' in nameResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: nameResult.error}, 400)
    }

    const parentResult = normalizeFolderId(parsed.parentFolderId)

    if ('error' in parentResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: parentResult.error}, 400)
    }

    if (parentResult.folderId && !(await folderExists(c.env.DB, currentUser.id, parentResult.folderId))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Parent folder not found'}, 404)
    }

    const folderImageResult = parsed.folderImage ? await validateProfileImage(parsed.folderImage, 'Folder image') : null

    if (folderImageResult && 'error' in folderImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: folderImageResult.error}, folderImageResult.status)
    }

    const now = toSqlTimestamp(new Date())
    const folderId = crypto.randomUUID()
    const folderImageKey = folderImageResult ? crypto.randomUUID() : null
    const folder: CharacterFolderRecord = {
        id: folderId,
        user_id: currentUser.id,
        name: nameResult.name,
        parent_folder_id: parentResult.folderId,
        folder_image_key: folderImageKey,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }

    const uploadedObjectKey =
        folderImageResult && folderImageKey ? characterFolderImageObjectKey(currentUser.id, folder.id, folderImageKey) : null

    if (folderImageResult && uploadedObjectKey) {
        await c.env.MEDIA_BUCKET.put(uploadedObjectKey, folderImageResult.bytes, {
            httpMetadata: {
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: folderImageResult.contentType,
            },
        })
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO character_folders (id, user_id, name, parent_folder_id, folder_image_key, sort_order,
                                            created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                folder.id,
                folder.user_id,
                folder.name,
                folder.parent_folder_id,
                folder.folder_image_key,
                folder.sort_order,
                folder.created_at,
                folder.updated_at,
            )
            .run()
    } catch (error) {
        if (uploadedObjectKey) {
            await c.env.MEDIA_BUCKET.delete(uploadedObjectKey)
        }
        throw error
    }

    return jsonResponse(c, FolderResponseSchema, {folder: toPublicFolder(c.env.MEDIA_PUBLIC_BASE_URL, folder)}, 201)
})

characterRoutes.patch('/folders/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const folder = await getOwnedFolder(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!folder) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    let body: UpdateFolderRequest

    try {
        body = await c.req.json<UpdateFolderRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const nameResult = normalizeFolderName(body.name ?? body['edit-folder-name'])

    if ('error' in nameResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: nameResult.error}, 400)
    }

    const updatedAt = toSqlTimestamp(new Date())
    const updatedFolder = {
        ...folder,
        name: nameResult.name,
        updated_at: updatedAt,
    }

    await c.env.DB.prepare(
        `UPDATE character_folders
         SET name = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`,
    )
        .bind(updatedFolder.name, updatedFolder.updated_at, folder.id, currentUser.id)
        .run()

    return jsonResponse(c, FolderResponseSchema, {folder: toPublicFolder(c.env.MEDIA_PUBLIC_BASE_URL, updatedFolder)})
})

characterRoutes.post('/folders/:id/image', async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder image upload is too large'}, 413)
    }

    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Multipart form data is required'}, 400)
    }

    const form = await c.req.formData()
    const folder = await getOwnedFolder(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!folder) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    const file = form.get('folderImage') ?? form.get('folder-image')
    const folderImageResult = await validateProfileImage(file instanceof File ? file : null, 'Folder image')

    if ('error' in folderImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: folderImageResult.error}, folderImageResult.status)
    }

    const folderImageKey = crypto.randomUUID()
    const folderImageObjectKey = characterFolderImageObjectKey(currentUser.id, folder.id, folderImageKey)

    await c.env.MEDIA_BUCKET.put(folderImageObjectKey, folderImageResult.bytes, {
        httpMetadata: {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: folderImageResult.contentType,
        },
    })

    try {
        await c.env.DB.prepare(
            `UPDATE character_folders
             SET folder_image_key = ?,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind(folderImageKey, toSqlTimestamp(new Date()), folder.id, currentUser.id)
            .run()
    } catch (error) {
        await c.env.MEDIA_BUCKET.delete(folderImageObjectKey)
        throw error
    }

    if (folder.folder_image_key) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, [characterFolderImageObjectKey(currentUser.id, folder.id, folder.folder_image_key)])
    }

    return jsonResponse(c, CharacterFolderImageResponseSchema, {
        folderImageKey,
        folderImageUrl: characterFolderImageUrl(c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id, folder.id, folderImageKey),
    })
})

characterRoutes.delete('/folders/:id/image', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const folder = await getOwnedFolder(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!folder) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    await c.env.DB.prepare(
        `UPDATE character_folders
         SET folder_image_key = NULL,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`,
    )
        .bind(toSqlTimestamp(new Date()), folder.id, currentUser.id)
        .run()

    if (folder.folder_image_key) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, [characterFolderImageObjectKey(currentUser.id, folder.id, folder.folder_image_key)])
    }

    return c.body(null, 204)
})

characterRoutes.delete('/folders/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const folder = await getOwnedFolder(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!folder) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    const now = toSqlTimestamp(new Date())

    await c.env.DB.batch([
        c.env.DB.prepare(
            `DELETE
             FROM character_folder_placements
             WHERE user_id = ?
               AND folder_id = ?`,
        ).bind(currentUser.id, folder.id),
        c.env.DB.prepare(
            `UPDATE character_folders
             SET parent_folder_id = NULL,
                 updated_at = ?
             WHERE user_id = ?
               AND parent_folder_id = ?`,
        ).bind(now, currentUser.id, folder.id),
        c.env.DB.prepare(
            `UPDATE characters
             SET folder_id = NULL,
                 updated_at = ?
             WHERE user_id = ?
               AND folder_id = ?`,
        ).bind(now, currentUser.id, folder.id),
        c.env.DB.prepare(
            `DELETE FROM character_folders
             WHERE id = ?
               AND user_id = ?`,
        ).bind(folder.id, currentUser.id),
    ])

    if (folder.folder_image_key) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, [characterFolderImageObjectKey(currentUser.id, folder.id, folder.folder_image_key)])
    }

    return c.body(null, 204)
})

characterRoutes.post('/', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const parsed = await parseCreateCharacterRequest(c)

    if ('error' in parsed) {
        return jsonResponse(c, ErrorResponseSchema, {error: parsed.error}, parsed.status)
    }

    const nameResult = normalizeCharacterName(parsed.name)

    if ('error' in nameResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: nameResult.error}, 400)
    }

    const folderResult = normalizeFolderId(parsed.folderId)

    if ('error' in folderResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: folderResult.error}, 400)
    }

    if (folderResult.folderId && !(await folderExists(c.env.DB, currentUser.id, folderResult.folderId))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    const profileImageResult = await validateProfileImage(parsed.profileImage)

    if ('error' in profileImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: profileImageResult.error}, profileImageResult.status)
    }

    const now = new Date()
    const characterId = crypto.randomUUID()
    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(currentUser.id, characterId, profileImageKey)

    await c.env.MEDIA_BUCKET.put(profileImageObjectKey, profileImageResult.bytes, {
        httpMetadata: {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: profileImageResult.contentType,
        },
    })

    const character: CharacterRecord = {
        id: characterId,
        user_id: currentUser.id,
        name: nameResult.name,
        profile_image_key: profileImageKey,
        folder_id: folderResult.folderId,
        sort_order: 0,
        created_at: toSqlTimestamp(now),
        updated_at: toSqlTimestamp(now),
    }

    try {
        const statements: D1PreparedStatement[] = [
            c.env.DB.prepare(
                `INSERT INTO characters (id, size_chart_id, user_id, name, profile_image_key, folder_id, sort_order,
                                         created_at,
                                         updated_at)
                 VALUES (?, randomblob(6), ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                character.id,
                character.user_id,
                character.name,
                character.profile_image_key,
                character.folder_id,
                character.sort_order,
                character.created_at,
                character.updated_at,
            ),
        ]

        if (folderResult.folderId) {
            statements.push(
                c.env.DB.prepare(
                    `INSERT OR IGNORE INTO character_folder_placements (user_id, folder_id, character_id, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                ).bind(character.user_id, folderResult.folderId, character.id, 0, character.created_at, character.updated_at),
            )
        }

        await c.env.DB.batch(statements)
    } catch (error) {
        if (profileImageKey) {
            await c.env.MEDIA_BUCKET.delete(profileImageObjectKey)
        }

        if (isDuplicateCharacterNameError(error)) {
            return jsonResponse(c, ErrorResponseSchema, {error: DUPLICATE_CHARACTER_NAME_ERROR}, 409)
        }

        throw error
    }

    return jsonResponse(c, CharacterResponseSchema, {character: toPublicCharacter(c.env.MEDIA_PUBLIC_BASE_URL, character)}, 201)
})

characterRoutes.patch('/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    let body: UpdateCharacterRequest

    try {
        body = await c.req.json<UpdateCharacterRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character not found'}, 404)
    }

    const nameResult = normalizeCharacterName(body.name)

    if ('error' in nameResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: nameResult.error}, 400)
    }

    const descriptionResult = normalizeCharacterDescription(body.description)

    if ('error' in descriptionResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: descriptionResult.error}, 400)
    }

    const now = toSqlTimestamp(new Date())

    try {
        await c.env.DB.prepare(
            `UPDATE characters
             SET name        = ?,
                 description = ?,
                 updated_at  = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind(nameResult.name, descriptionResult.description, now, character.id, currentUser.id)
            .run()
    } catch (error) {
        if (isDuplicateCharacterNameError(error)) {
            return jsonResponse(c, ErrorResponseSchema, {error: DUPLICATE_CHARACTER_NAME_ERROR}, 409)
        }

        throw error
    }

    return jsonResponse(c, CharacterResponseSchema, {
        character: toPublicCharacter(c.env.MEDIA_PUBLIC_BASE_URL, {
            ...character,
            name: nameResult.name,
            description: descriptionResult.description,
            updated_at: now,
        }),
    })
})

characterRoutes.post('/:id/profile-image', async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character profile image upload is too large'}, 413)
    }

    const owned = await requireOwnedCharacterMultipartForm(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, form} = owned
    const file = form.get('profileImage') ?? form.get('character-profile-photo')
    const profileImageResult = await validateProfileImage(file instanceof File ? file : null)

    if ('error' in profileImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: profileImageResult.error}, profileImageResult.status)
    }

    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(currentUser.id, character.id, profileImageKey)

    await c.env.MEDIA_BUCKET.put(profileImageObjectKey, profileImageResult.bytes, {
        httpMetadata: {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: profileImageResult.contentType,
        },
    })

    try {
        await c.env.DB.prepare(
            `UPDATE characters
             SET profile_image_key = ?,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind(profileImageKey, toSqlTimestamp(new Date()), character.id, currentUser.id)
            .run()
    } catch (error) {
        await c.env.MEDIA_BUCKET.delete(profileImageObjectKey)
        throw error
    }

    if (character.profile_image_key) {
        try {
            await c.env.MEDIA_BUCKET.delete(characterProfileImageObjectKey(currentUser.id, character.id, character.profile_image_key))
        } catch (error) {
            console.warn('Unable to delete old character profile image', error)
        }
    }

    return jsonResponse(c, CharacterProfileImageResponseSchema, {
        profileImageKey,
        profileImageUrl: characterProfileImageUrl(c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id, character.id, profileImageKey),
    })
})

characterRoutes.put('/:id/height-chart', async (c) => {
    const owned = await requireOwnedCharacterMultipartForm(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, form} = owned
    const rawJson = form.get('heightChartJson')

    if (typeof rawJson !== 'string') {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Height chart JSON is required'}, 400)
    }

    const existingHeightChart = parseCharacterHeightChartJson(character.height_chart_json)
    const imageFileValue = form.get('heightChartImage')
    const imageFile = imageFileValue instanceof File && imageFileValue.size > 0 ? imageFileValue : null
    let uploadedImage: CompletedGalleryUpload | null = null
    let uploadedObjectKey: string | null = null

    if (imageFile) {
        const imageResult = await validateGalleryImage(imageFile, 'Height chart image')

        if ('error' in imageResult) {
            return jsonResponse(c, ErrorResponseSchema, {error: imageResult.error}, imageResult.status)
        }

        const imageKey = crypto.randomUUID()
        uploadedImage = {
            imageKey,
            contentType: imageResult.contentType,
            width: imageResult.width,
            height: imageResult.height,
            byteSize: imageResult.bytes.byteLength,
        }
        uploadedObjectKey = characterHeightChartImageObjectKey(currentUser.id, character.id, imageKey, imageResult.contentType)

        await c.env.MEDIA_BUCKET.put(uploadedObjectKey, imageResult.bytes, {
            httpMetadata: {
                cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
                contentType: imageResult.contentType,
            },
        })
    }

    const normalized = normalizeHeightChartJson(rawJson, existingHeightChart, uploadedImage)

    if ('error' in normalized) {
        if (uploadedObjectKey) {
            await c.env.MEDIA_BUCKET.delete(uploadedObjectKey)
        }

        return jsonResponse(c, ErrorResponseSchema, {error: normalized.error}, 400)
    }

    const previousImage = existingHeightChart?.image ?? null
    const nextImage = normalized.heightChart.image
    const now = toSqlTimestamp(new Date())

    try {
        await c.env.DB.prepare(
            `UPDATE characters
             SET height_chart_json = ?,
                 updated_at        = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind(JSON.stringify(normalized.heightChart), now, character.id, currentUser.id)
            .run()
    } catch (error) {
        if (uploadedObjectKey) {
            await c.env.MEDIA_BUCKET.delete(uploadedObjectKey)
        }

        throw error
    }

    if (previousImage && previousImage.key !== nextImage?.key) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, [
            characterHeightChartImageObjectKey(currentUser.id, character.id, previousImage.key, previousImage.contentType),
        ])
    }

    return jsonResponse(c, HeightChartResponseSchema, {
        heightChart: toPublicHeightChart(c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id, character.id, normalized.heightChart),
    })
})

characterRoutes.post('/:id/media/chunked/init', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    const uploads = await parseChunkedUploadInitRequest(c)

    if (uploads instanceof Response) {
        return uploads
    }

    const mediaId = crypto.randomUUID()
    const chunkedUploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId, uploads.uploads)

    return jsonResponse(c, ChunkedUploadInitResponseSchema, {mediaId, uploads: chunkedUploads})
})

characterRoutes.put('/:id/media/chunked/:mediaId/:rating/:uploadId/:partNumber', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    const rating = normalizeMediaRating(c.req.param('rating'))

    if (!rating) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Media rating must be sfw or nsfw'}, 400)
    }

    const mediaId = normalizeUploadIdentifier(c.req.param('mediaId'), 'Media id')
    const imageKey = normalizeUploadIdentifier(c.req.query('imageKey'), 'Image key')
    const contentType = normalizeGalleryImageContentType(c.req.query('contentType'))
    const uploadId = c.req.param('uploadId')
    const partNumber = Number(c.req.param('partNumber'))

    if ('error' in mediaId) {
        return jsonResponse(c, ErrorResponseSchema, {error: mediaId.error}, 400)
    }

    if ('error' in imageKey) {
        return jsonResponse(c, ErrorResponseSchema, {error: imageKey.error}, 400)
    }

    if ('error' in contentType) {
        return jsonResponse(c, ErrorResponseSchema, {error: contentType.error}, 400)
    }

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Part number must be between 1 and 10000'}, 400)
    }

    if (!c.req.raw.body) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Chunk body is required'}, 400)
    }

    const objectKey = characterMediaImageObjectKey(
        currentUser.id,
        character.id,
        mediaId.value,
        imageKey.value,
        rating,
        contentType.contentType,
    )
    const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId)
    const uploadedPart = await upload.uploadPart(partNumber, c.req.raw.body)

    return jsonResponse(c, R2UploadedPartSchema, uploadedPart)
})

characterRoutes.delete('/:id/media/chunked/:mediaId/:rating/:uploadId', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned
    const rating = normalizeMediaRating(c.req.param('rating'))

    if (!rating) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Media rating must be sfw or nsfw'}, 400)
    }

    const mediaId = normalizeUploadIdentifier(c.req.param('mediaId'), 'Media id')
    const imageKey = normalizeUploadIdentifier(c.req.query('imageKey'), 'Image key')
    const contentType = normalizeGalleryImageContentType(c.req.query('contentType'))
    const uploadId = c.req.param('uploadId')

    if ('error' in mediaId) {
        return jsonResponse(c, ErrorResponseSchema, {error: mediaId.error}, 400)
    }

    if ('error' in imageKey) {
        return jsonResponse(c, ErrorResponseSchema, {error: imageKey.error}, 400)
    }

    if ('error' in contentType) {
        return jsonResponse(c, ErrorResponseSchema, {error: contentType.error}, 400)
    }

    const objectKey = characterMediaImageObjectKey(
        currentUser.id,
        character.id,
        mediaId.value,
        imageKey.value,
        rating,
        contentType.contentType,
    )
    const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId)
    await upload.abort()

    return c.body(null, 204)
})

characterRoutes.post('/toyhouse-import-items/:itemId/fail', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const itemId = normalizeUploadIdentifier(c.req.param('itemId'), 'Import item id')

    if ('error' in itemId) {
        return jsonResponse(c, ErrorResponseSchema, {error: itemId.error}, 400)
    }

    let body: {error?: unknown}

    try {
        body = await c.req.json<{error?: unknown}>()
    } catch {
        body = {}
    }

    await markToyhouseImportItemFailed(
        c.env.DB,
        currentUser.id,
        itemId.value,
        typeof body.error === 'string' ? body.error : 'Import item failed',
    )

    return jsonResponse(c, OkResponseSchema, {ok: true})
})

characterRoutes.post('/toyhouse-import-items/:itemId/complete', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const itemId = normalizeUploadIdentifier(c.req.param('itemId'), 'Import item id')

    if ('error' in itemId) {
        return jsonResponse(c, ErrorResponseSchema, {error: itemId.error}, 400)
    }

    const complete = await parseChunkedMediaCompleteBody(c)

    if ('error' in complete) {
        return jsonResponse(c, ErrorResponseSchema, {error: complete.error}, complete.status)
    }

    const item = await getToyhouseImportItem(c.env.DB, currentUser.id, itemId.value)

    if (!item) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Import item not found'}, 404)
    }

    if (item.status === 'imported' && item.media_id) {
        const existingMedia = await getOwnedCharacterMedia(c.env.DB, currentUser.id, item.character_id, item.media_id)

        if (existingMedia) {
            return jsonResponse(c, ToyhouseImportCompleteResponseSchema, {
                media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, existingMedia),
                skipped: true,
            })
        }
    }

    const mediaId = normalizeUploadIdentifier(complete.body.mediaId, 'Media id')

    if ('error' in mediaId) {
        return jsonResponse(c, ErrorResponseSchema, {error: mediaId.error}, 400)
    }

    const upload = item.rating === 'sfw' ? complete.sfwUpload : complete.nsfwUpload
    const oppositeUpload = item.rating === 'sfw' ? complete.nsfwUpload : complete.sfwUpload

    if (!upload) {
        return jsonResponse(c, ErrorResponseSchema, {error: `${item.rating.toUpperCase()} upload is required for this import item`}, 400)
    }

    if (oppositeUpload) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Import item can only complete one media rating'}, 400)
    }

    if (!(await characterHasMediaCapacity(c.env.DB, currentUser.id, item.character_id))) {
        return jsonResponse(
            c,
            ErrorResponseSchema,
            {error: `Characters can contain ${GALLERY_MAX_MEDIA_PER_CHARACTER} gallery images or fewer`},
            409,
        )
    }

    const completedKeys: string[] = []

    try {
        const now = toSqlTimestamp(new Date())

        await c.env.DB.prepare(
            `UPDATE toyhouse_import_items
             SET status = ?,
                 error  = '',
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind('uploading', now, item.id, currentUser.id)
            .run()

        const completedImage = await completeChunkedGalleryUpload(
            c.env.MEDIA_BUCKET,
            currentUser.id,
            item.character_id,
            mediaId.value,
            upload,
            item.rating,
            'Toyhou.se image',
        )
        completedKeys.push(
            characterMediaImageObjectKey(
                currentUser.id,
                item.character_id,
                mediaId.value,
                completedImage.imageKey,
                item.rating,
                completedImage.contentType,
            ),
        )
        const completedPreview = await generateAndPutMediaPreviewImage(
            c.env,
            c.env.MEDIA_BUCKET,
            c.env.MEDIA_PUBLIC_BASE_URL,
            currentUser.id,
            item.character_id,
            mediaId.value,
            completedImage,
            item.rating,
            completedKeys,
        )
        const nsfwBlurImageKey =
            item.rating === 'nsfw'
                ? await putNsfwBlurImage(
                      c.env.IMAGES,
                      c.env.MEDIA_BUCKET,
                      currentUser.id,
                      item.character_id,
                      mediaId.value,
                      completedPreview.preview,
                      completedKeys,
                  )
                : null

        const media: CharacterMediaRecord = {
            id: mediaId.value,
            user_id: currentUser.id,
            character_id: item.character_id,
            sfw_image_key: item.rating === 'sfw' ? completedImage.imageKey : null,
            nsfw_image_key: item.rating === 'nsfw' ? completedImage.imageKey : null,
            sfw_content_type: item.rating === 'sfw' ? completedImage.contentType : null,
            nsfw_content_type: item.rating === 'nsfw' ? completedImage.contentType : null,
            sfw_artist: '',
            nsfw_artist: '',
            sfw_width: item.rating === 'sfw' ? completedImage.width : null,
            sfw_height: item.rating === 'sfw' ? completedImage.height : null,
            sfw_byte_size: item.rating === 'sfw' ? completedImage.byteSize : null,
            nsfw_width: item.rating === 'nsfw' ? completedImage.width : null,
            nsfw_height: item.rating === 'nsfw' ? completedImage.height : null,
            nsfw_byte_size: item.rating === 'nsfw' ? completedImage.byteSize : null,
            sfw_preview_image_key: item.rating === 'sfw' ? completedPreview.imageKey : null,
            sfw_preview_width: item.rating === 'sfw' ? completedPreview.width : null,
            sfw_preview_height: item.rating === 'sfw' ? completedPreview.height : null,
            sfw_preview_byte_size: item.rating === 'sfw' ? completedPreview.byteSize : null,
            nsfw_preview_image_key: item.rating === 'nsfw' ? completedPreview.imageKey : null,
            nsfw_blur_image_key: nsfwBlurImageKey,
            nsfw_preview_width: item.rating === 'nsfw' ? completedPreview.width : null,
            nsfw_preview_height: item.rating === 'nsfw' ? completedPreview.height : null,
            nsfw_preview_byte_size: item.rating === 'nsfw' ? completedPreview.byteSize : null,
            created_at: now,
            updated_at: now,
        }

        await c.env.DB.batch([
            c.env.DB.prepare(
                `INSERT INTO character_media (id, user_id, character_id,
                                              sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type,
                                              sfw_artist, nsfw_artist,
                                              sfw_width, sfw_height, sfw_byte_size, sfw_preview_image_key,
                                              sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                                              nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key,
                                              nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                                              nsfw_blur_image_key,
                                              created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                media.id,
                media.user_id,
                media.character_id,
                media.sfw_image_key,
                media.nsfw_image_key,
                media.sfw_content_type,
                media.nsfw_content_type,
                media.sfw_artist,
                media.nsfw_artist,
                media.sfw_width,
                media.sfw_height,
                media.sfw_byte_size,
                media.sfw_preview_image_key,
                media.sfw_preview_width,
                media.sfw_preview_height,
                media.sfw_preview_byte_size,
                media.nsfw_width,
                media.nsfw_height,
                media.nsfw_byte_size,
                media.nsfw_preview_image_key,
                media.nsfw_preview_width,
                media.nsfw_preview_height,
                media.nsfw_preview_byte_size,
                media.nsfw_blur_image_key,
                media.created_at,
                media.updated_at,
            ),
            c.env.DB.prepare(
                `UPDATE toyhouse_import_items
                 SET status   = ?,
                     media_id = ?,
                     error    = '',
                     updated_at = ?
                 WHERE id = ?
                   AND user_id = ?`,
            ).bind('imported', media.id, now, item.id, currentUser.id),
        ])
        await queueImageReview(c.env.DB, media.id)

        await updateToyhouseImportJobStatus(c.env.DB, currentUser.id, item.job_id)

        return jsonResponse(
            c,
            ToyhouseImportCompleteResponseSchema,
            {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media), skipped: false},
            201,
        )
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        await markToyhouseImportItemFailed(c.env.DB, currentUser.id, item.id, error instanceof Error ? error.message : 'Import item failed')

        if (error instanceof Error && error.message) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

characterRoutes.post('/:id/media/chunked/complete', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    const complete = await parseChunkedMediaCompleteBody(c)

    if ('error' in complete) {
        return jsonResponse(c, ErrorResponseSchema, {error: complete.error}, complete.status)
    }

    const mediaId = normalizeUploadIdentifier(complete.body.mediaId, 'Media id')

    if ('error' in mediaId) {
        return jsonResponse(c, ErrorResponseSchema, {error: mediaId.error}, 400)
    }

    const {artists, sfwUpload, nsfwUpload} = complete

    if (!sfwUpload && !nsfwUpload) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'At least one image is required'}, 400)
    }

    if (!(await characterHasMediaCapacity(c.env.DB, currentUser.id, character.id))) {
        return jsonResponse(
            c,
            ErrorResponseSchema,
            {error: `Characters can contain ${GALLERY_MAX_MEDIA_PER_CHARACTER} gallery images or fewer`},
            409,
        )
    }

    const completedKeys: string[] = []

    try {
        let sfwImage: CompletedGalleryUpload | null = null
        let nsfwImage: CompletedGalleryUpload | null = null
        let sfwPreviewImage: (CompletedGalleryPreview & {preview: ParsedPreviewImage}) | null = null
        let nsfwPreviewImage: (CompletedGalleryPreview & {preview: ParsedPreviewImage}) | null = null
        let nsfwBlurImageKey: string | null = null

        if (sfwUpload && !('error' in sfwUpload)) {
            sfwImage = await completeChunkedGalleryUpload(
                c.env.MEDIA_BUCKET,
                currentUser.id,
                character.id,
                mediaId.value,
                sfwUpload,
                'sfw',
                'SFW image',
            )
            completedKeys.push(
                characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, sfwImage.imageKey, 'sfw', sfwImage.contentType),
            )
            sfwPreviewImage = await generateAndPutMediaPreviewImage(
                c.env,
                c.env.MEDIA_BUCKET,
                c.env.MEDIA_PUBLIC_BASE_URL,
                currentUser.id,
                character.id,
                mediaId.value,
                sfwImage,
                'sfw',
                completedKeys,
            )
        }

        if (nsfwUpload && !('error' in nsfwUpload)) {
            nsfwImage = await completeChunkedGalleryUpload(
                c.env.MEDIA_BUCKET,
                currentUser.id,
                character.id,
                mediaId.value,
                nsfwUpload,
                'nsfw',
                'NSFW image',
            )
            completedKeys.push(
                characterMediaImageObjectKey(
                    currentUser.id,
                    character.id,
                    mediaId.value,
                    nsfwImage.imageKey,
                    'nsfw',
                    nsfwImage.contentType,
                ),
            )
            nsfwPreviewImage = await generateAndPutMediaPreviewImage(
                c.env,
                c.env.MEDIA_BUCKET,
                c.env.MEDIA_PUBLIC_BASE_URL,
                currentUser.id,
                character.id,
                mediaId.value,
                nsfwImage,
                'nsfw',
                completedKeys,
            )
            nsfwBlurImageKey = await putNsfwBlurImage(
                c.env.IMAGES,
                c.env.MEDIA_BUCKET,
                currentUser.id,
                character.id,
                mediaId.value,
                nsfwPreviewImage.preview,
                completedKeys,
            )
        }

        const now = toSqlTimestamp(new Date())
        const media: CharacterMediaRecord = {
            id: mediaId.value,
            user_id: currentUser.id,
            character_id: character.id,
            sfw_image_key: sfwImage?.imageKey ?? null,
            nsfw_image_key: nsfwImage?.imageKey ?? null,
            sfw_content_type: sfwImage?.contentType ?? null,
            nsfw_content_type: nsfwImage?.contentType ?? null,
            sfw_artist: artists.sfwArtist,
            nsfw_artist: artists.nsfwArtist,
            sfw_width: sfwImage?.width ?? null,
            sfw_height: sfwImage?.height ?? null,
            sfw_byte_size: sfwImage?.byteSize ?? null,
            nsfw_width: nsfwImage?.width ?? null,
            nsfw_height: nsfwImage?.height ?? null,
            nsfw_byte_size: nsfwImage?.byteSize ?? null,
            sfw_preview_image_key: sfwPreviewImage?.imageKey ?? null,
            sfw_preview_width: sfwPreviewImage?.width ?? null,
            sfw_preview_height: sfwPreviewImage?.height ?? null,
            sfw_preview_byte_size: sfwPreviewImage?.byteSize ?? null,
            nsfw_preview_image_key: nsfwPreviewImage?.imageKey ?? null,
            nsfw_blur_image_key: nsfwBlurImageKey,
            nsfw_preview_width: nsfwPreviewImage?.width ?? null,
            nsfw_preview_height: nsfwPreviewImage?.height ?? null,
            nsfw_preview_byte_size: nsfwPreviewImage?.byteSize ?? null,
            created_at: now,
            updated_at: now,
        }

        await c.env.DB.prepare(
            `INSERT INTO character_media (id, user_id, character_id,
                                          sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type,
                                          sfw_artist, nsfw_artist,
                                          sfw_width, sfw_height, sfw_byte_size, sfw_preview_image_key,
                                          sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                                          nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key,
                                          nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                                          nsfw_blur_image_key,
                                          created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                media.id,
                media.user_id,
                media.character_id,
                media.sfw_image_key,
                media.nsfw_image_key,
                media.sfw_content_type,
                media.nsfw_content_type,
                media.sfw_artist,
                media.nsfw_artist,
                media.sfw_width,
                media.sfw_height,
                media.sfw_byte_size,
                media.sfw_preview_image_key,
                media.sfw_preview_width,
                media.sfw_preview_height,
                media.sfw_preview_byte_size,
                media.nsfw_width,
                media.nsfw_height,
                media.nsfw_byte_size,
                media.nsfw_preview_image_key,
                media.nsfw_preview_width,
                media.nsfw_preview_height,
                media.nsfw_preview_byte_size,
                media.nsfw_blur_image_key,
                media.created_at,
                media.updated_at,
            )
            .run()
        await queueImageReview(c.env.DB, media.id)

        return jsonResponse(c, MediaResponseSchema, {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media)}, 201)
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        if (error instanceof Error && error.message) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

characterRoutes.post('/:id/media/:mediaId/chunked/init', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    const uploads = await parseChunkedUploadInitRequest(c)

    if (uploads instanceof Response) {
        return uploads
    }

    const chunkedUploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, media.id, uploads.uploads)

    return jsonResponse(c, ChunkedUploadInitResponseSchema, {mediaId: media.id, uploads: chunkedUploads})
})

characterRoutes.post('/:id/media/:mediaId/chunked/complete', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    const complete = await parseChunkedMediaCompleteBody(c)

    if ('error' in complete) {
        return jsonResponse(c, ErrorResponseSchema, {error: complete.error}, complete.status)
    }

    const {artists, sfwUpload, nsfwUpload} = complete
    const removeSfw = normalizePermanentConfirmation(complete.body.removeSfw)
    const removeNsfw = normalizePermanentConfirmation(complete.body.removeNsfw)
    const finalHasSfw = Boolean((media.sfw_image_key && !removeSfw && !sfwUpload) || sfwUpload)
    const finalHasNsfw = Boolean((media.nsfw_image_key && !removeNsfw && !nsfwUpload) || nsfwUpload)

    if (!finalHasSfw && !finalHasNsfw) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'At least one image must remain on media'}, 400)
    }

    const uploadedKeys: string[] = []
    const deletedKeys: string[] = []
    const sfwWasModified = removeSfw || Boolean(sfwUpload)
    const nsfwWasModified = removeNsfw || Boolean(nsfwUpload)
    const nextMedia: CharacterMediaRecord = {
        ...media,
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        updated_at: toSqlTimestamp(new Date()),
    }

    try {
        applyMediaVariantRemovals(currentUser.id, character.id, media, nextMedia, removeSfw, removeNsfw, deletedKeys)

        if (sfwUpload) {
            await replaceMediaVariantWithChunkedUpload(
                c.env.IMAGES,
                c.env.MEDIA_BUCKET,
                c.env,
                c.env.MEDIA_PUBLIC_BASE_URL,
                currentUser.id,
                character.id,
                media,
                nextMedia,
                sfwUpload,
                'sfw',
                uploadedKeys,
                deletedKeys,
            )
        }

        if (nsfwUpload) {
            await replaceMediaVariantWithChunkedUpload(
                c.env.IMAGES,
                c.env.MEDIA_BUCKET,
                c.env,
                c.env.MEDIA_PUBLIC_BASE_URL,
                currentUser.id,
                character.id,
                media,
                nextMedia,
                nsfwUpload,
                'nsfw',
                uploadedKeys,
                deletedKeys,
            )
        }

        await updateCharacterMediaRecord(c.env.DB, nextMedia, {
            sfwWasModified,
            nsfwWasModified,
        })
        if (sfwWasModified || nsfwWasModified) {
            await queueImageReview(c.env.DB, media.id)
        }

        await deleteR2Objects(c.env.MEDIA_BUCKET, deletedKeys)

        return jsonResponse(c, MediaResponseSchema, {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, nextMedia)})
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, uploadedKeys)
        if (error instanceof Error && error.message) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

characterRoutes.delete('/:id/media/:mediaId', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    await c.env.DB.prepare(
        `DELETE
         FROM character_media
         WHERE id = ?
           AND character_id = ?
           AND user_id = ?`,
    )
        .bind(media.id, character.id, currentUser.id)
        .run()

    await deleteCharacterMediaObjects(c.env.MEDIA_BUCKET, media)

    return c.body(null, 204)
})

characterRoutes.put('/:id/gallery', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    let body: GalleryLayoutRequest

    try {
        body = await c.req.json<GalleryLayoutRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character not found'}, 404)
    }

    const parsed = parseGalleryLayout(body)

    if ('error' in parsed) {
        return jsonResponse(c, ErrorResponseSchema, {error: parsed.error}, 400)
    }

    const ownedMediaIds = await getOwnedMediaIds(c.env.DB, currentUser.id, character.id, [...parsed.mediaIds])

    for (const mediaId of parsed.mediaIds) {
        if (!ownedMediaIds.has(mediaId)) {
            return jsonResponse(c, ErrorResponseSchema, {error: 'Gallery contains media that does not belong to this character'}, 400)
        }
    }

    const allCharacterMediaIds = await getCharacterMediaIds(c.env.DB, currentUser.id, character.id)
    const completeGalleryValidation = validateCompleteGalleryLayout(parsed, allCharacterMediaIds)

    if (completeGalleryValidation) {
        return jsonResponse(c, ErrorResponseSchema, {error: completeGalleryValidation.error}, 400)
    }

    const now = toSqlTimestamp(new Date())
    const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
            `UPDATE characters
             SET updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        ).bind(now, character.id, currentUser.id),
        c.env.DB.prepare(
            `DELETE
             FROM character_gallery_tabs
             WHERE character_id = ?
               AND user_id = ?`,
        ).bind(character.id, currentUser.id),
    ]

    parsed.tabs.forEach((tab, tabIndex) => {
        statements.push(
            c.env.DB.prepare(
                `INSERT INTO character_gallery_tabs (id, user_id, character_id, name, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).bind(tab.id, currentUser.id, character.id, tab.name, tabIndex, now, now),
        )

        tab.rows.forEach((row, rowIndex) => {
            statements.push(
                c.env.DB.prepare(
                    `INSERT INTO character_gallery_rows (id, user_id, character_id, tab_id, sort_order, force_full_width,
                                                     created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                ).bind(row.id, currentUser.id, character.id, tab.id, rowIndex, row.forceFullWidth ? 1 : 0, now, now),
            )

            row.mediaIds.forEach((mediaId, mediaIndex) => {
                statements.push(
                    c.env.DB.prepare(
                        `INSERT INTO character_gallery_row_media (row_id, media_id, sort_order)
                     VALUES (?, ?, ?)`,
                    ).bind(row.id, mediaId, mediaIndex),
                )
            })
        })
    })

    await c.env.DB.batch(statements)

    return jsonResponse(c, GalleryLayoutResponseSchema, {
        gallery: {
            tabs: parsed.tabs,
        },
    })
})

characterRoutes.delete('/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const body = await parseDeleteCharacterRequest(c.req)
    const confirmName = normalizeOptionalText(body.confirmName ?? body['delete-character-confirm-name'])
    const permanent = normalizePermanentConfirmation(body.permanent ?? body['delete-confirm-permanent'])

    if (!confirmName) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character name confirmation is required'}, 400)
    }

    if (!permanent) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Permanent deletion confirmation is required'}, 400)
    }

    const character = await c.env.DB.prepare(
        `SELECT id,
                user_id,
                name,
                profile_image_key,
                folder_id,
                sort_order,
                height_chart_json,
                created_at,
                updated_at
         FROM characters
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
    )
        .bind(c.req.param('id'), currentUser.id)
        .first<CharacterRecord>()

    if (!character) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character not found'}, 404)
    }

    if (confirmName.toUpperCase() !== character.name.toUpperCase()) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character name confirmation does not match'}, 400)
    }

    const galleryMedia = await getCharacterMedia(c.env.DB, currentUser.id, character.id)

    await c.env.DB.prepare(
        `DELETE FROM characters
         WHERE id = ?
           AND user_id = ?`,
    )
        .bind(character.id, currentUser.id)
        .run()

    if (character.profile_image_key) {
        try {
            await c.env.MEDIA_BUCKET.delete(characterProfileImageObjectKey(currentUser.id, character.id, character.profile_image_key))
        } catch (error) {
            console.warn('Unable to delete character profile image', error)
        }
    }

    for (const media of galleryMedia) {
        await deleteCharacterMediaObjects(c.env.MEDIA_BUCKET, media)
    }

    const heightChart = parseCharacterHeightChartJson(character.height_chart_json)
    if (heightChart?.image) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, [
            characterHeightChartImageObjectKey(currentUser.id, character.id, heightChart.image.key, heightChart.image.contentType),
        ])
    }

    return c.body(null, 204)
})

function toPublicCharacter(baseUrl: string, character: CharacterRecord) {
    return {
        id: character.id,
        name: character.name,
        profileImageKey: character.profile_image_key,
        profileImageUrl: character.profile_image_key
            ? characterProfileImageUrl(baseUrl, character.user_id, character.id, character.profile_image_key)
            : null,
        folderId: character.folder_id,
        sortOrder: character.sort_order,
        description: character.description ?? '',
        createdAt: character.created_at,
        updatedAt: character.updated_at,
    }
}

function toPublicHeightChart(baseUrl: string, userId: string, characterId: string, heightChart: CharacterHeightChartJson | null) {
    if (!heightChart) {
        return null
    }

    return {
        ...heightChart,
        image: heightChart.image
            ? {
                  ...heightChart.image,
                  url: characterHeightChartImageUrl(baseUrl, userId, characterId, heightChart.image.key, heightChart.image.contentType),
              }
            : null,
    }
}

function toPublicMedia(baseUrl: string, media: CharacterMediaRecord) {
    return {
        id: media.id,
        sfwImageKey: media.sfw_image_key,
        nsfwImageKey: media.nsfw_image_key,
        sfwContentType: media.sfw_content_type ?? (media.sfw_image_key ? 'image/png' : null),
        nsfwContentType: media.nsfw_content_type ?? (media.nsfw_image_key ? 'image/png' : null),
        sfwImageUrl: media.sfw_image_key
            ? characterMediaImageUrl(
                  baseUrl,
                  media.user_id,
                  media.character_id,
                  media.id,
                  media.sfw_image_key,
                  'sfw',
                  media.sfw_content_type,
              )
            : null,
        nsfwImageUrl: media.nsfw_image_key
            ? characterMediaImageUrl(
                  baseUrl,
                  media.user_id,
                  media.character_id,
                  media.id,
                  media.nsfw_image_key,
                  'nsfw',
                  media.nsfw_content_type,
              )
            : null,
        sfwPreviewImageKey: media.sfw_preview_image_key,
        nsfwPreviewImageKey: media.nsfw_preview_image_key,
        nsfwBlurImageKey: media.nsfw_blur_image_key,
        sfwPreviewImageUrl: media.sfw_preview_image_key
            ? characterMediaPreviewImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.sfw_preview_image_key, 'sfw')
            : null,
        nsfwPreviewImageUrl: media.nsfw_preview_image_key
            ? characterMediaPreviewImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.nsfw_preview_image_key, 'nsfw')
            : null,
        nsfwBlurImageUrl: media.nsfw_blur_image_key
            ? characterMediaNsfwBlurImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.nsfw_blur_image_key)
            : null,
        sfwArtist: media.sfw_artist,
        nsfwArtist: media.nsfw_artist,
        sfwWidth: media.sfw_width,
        sfwHeight: media.sfw_height,
        sfwByteSize: media.sfw_byte_size,
        nsfwWidth: media.nsfw_width,
        nsfwHeight: media.nsfw_height,
        nsfwByteSize: media.nsfw_byte_size,
        sfwPreviewWidth: media.sfw_preview_width,
        sfwPreviewHeight: media.sfw_preview_height,
        sfwPreviewByteSize: media.sfw_preview_byte_size,
        nsfwPreviewWidth: media.nsfw_preview_width,
        nsfwPreviewHeight: media.nsfw_preview_height,
        nsfwPreviewByteSize: media.nsfw_preview_byte_size,
        createdAt: media.created_at,
        updatedAt: media.updated_at,
    }
}

async function updateCharacterMediaRecord(
    db: D1Database,
    media: CharacterMediaRecord,
    options: {
        sfwWasModified: boolean
        nsfwWasModified: boolean
    },
): Promise<void> {
    await db
        .prepare(
            `UPDATE character_media
         SET sfw_image_key         = ?,
             nsfw_image_key        = ?,
             sfw_content_type      = ?,
             nsfw_content_type     = ?,
             sfw_artist            = ?,
             nsfw_artist           = ?,
             sfw_width             = ?,
             sfw_height            = ?,
             sfw_byte_size         = ?,
             sfw_preview_image_key = ?,
             sfw_preview_width     = ?,
             sfw_preview_height    = ?,
             sfw_preview_byte_size = ?,
             nsfw_width            = ?,
             nsfw_height           = ?,
             nsfw_byte_size        = ?,
             nsfw_preview_image_key = ?,
             nsfw_preview_width     = ?,
             nsfw_preview_height    = ?,
             nsfw_preview_byte_size = ?,
             nsfw_blur_image_key   = ?,
             sfw_review_status     = CASE WHEN ? THEN 'pending' ELSE sfw_review_status END,
             sfw_reviewed_at       = CASE WHEN ? THEN NULL ELSE sfw_reviewed_at END,
             sfw_approved_at       = CASE WHEN ? THEN NULL ELSE sfw_approved_at END,
             sfw_homepage_allowed  = CASE WHEN ? THEN 0 ELSE sfw_homepage_allowed END,
             nsfw_review_status    = CASE WHEN ? THEN 'pending' ELSE nsfw_review_status END,
             nsfw_reviewed_at      = CASE WHEN ? THEN NULL ELSE nsfw_reviewed_at END,
             nsfw_approved_at      = CASE WHEN ? THEN NULL ELSE nsfw_approved_at END,
             updated_at            = ?
         WHERE id = ?
           AND character_id = ?
           AND user_id = ?`,
        )
        .bind(
            media.sfw_image_key,
            media.nsfw_image_key,
            media.sfw_content_type,
            media.nsfw_content_type,
            media.sfw_artist,
            media.nsfw_artist,
            media.sfw_width,
            media.sfw_height,
            media.sfw_byte_size,
            media.sfw_preview_image_key,
            media.sfw_preview_width,
            media.sfw_preview_height,
            media.sfw_preview_byte_size,
            media.nsfw_width,
            media.nsfw_height,
            media.nsfw_byte_size,
            media.nsfw_preview_image_key,
            media.nsfw_preview_width,
            media.nsfw_preview_height,
            media.nsfw_preview_byte_size,
            media.nsfw_blur_image_key,
            options.sfwWasModified ? 1 : 0,
            options.sfwWasModified ? 1 : 0,
            options.sfwWasModified ? 1 : 0,
            options.sfwWasModified ? 1 : 0,
            options.nsfwWasModified ? 1 : 0,
            options.nsfwWasModified ? 1 : 0,
            options.nsfwWasModified ? 1 : 0,
            media.updated_at,
            media.id,
            media.character_id,
            media.user_id,
        )
        .run()
}

function toPublicFolder(baseUrl: string, folder: CharacterFolderRecord) {
    return {
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        folderImageKey: folder.folder_image_key,
        folderImageUrl: folder.folder_image_key
            ? characterFolderImageUrl(baseUrl, folder.user_id, folder.id, folder.folder_image_key)
            : null,
        sortOrder: folder.sort_order,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
    }
}

async function requireOwnedCharacter(c: CharacterRouteContext): Promise<
    | {
          currentUser: CurrentUser
          character: CharacterRecord
      }
    | Response
> {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character not found'}, 404)
    }

    return {currentUser, character}
}

async function requireOwnedCharacterMultipartForm(c: CharacterRouteContext): Promise<
    | {
          currentUser: CurrentUser
          character: CharacterRecord
          form: FormData
      }
    | Response
> {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Multipart form data is required'}, 400)
    }

    return {
        ...owned,
        form: await c.req.formData(),
    }
}

async function requireOwnedCharacterMedia(c: CharacterRouteContext): Promise<
    | {
          currentUser: CurrentUser
          character: CharacterRecord
          media: CharacterMediaRecord
      }
    | Response
> {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const media = await getOwnedCharacterMedia(c.env.DB, owned.currentUser.id, owned.character.id, c.req.param('mediaId') ?? '')

    if (!media) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Media not found'}, 404)
    }

    return {...owned, media}
}

async function parseChunkedUploadInitRequest(c: CharacterRouteContext): Promise<
    | {
          uploads: ChunkedUploadInit[]
      }
    | Response
> {
    let body: ChunkedMediaInitRequest

    try {
        body = await c.req.json<ChunkedMediaInitRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const uploads = parseChunkedUploadInits(body.uploads ?? body.ratings)

    if ('error' in uploads) {
        return jsonResponse(c, ErrorResponseSchema, {error: uploads.error}, 400)
    }

    return uploads
}

function parseMediaArtists(sfwValue: unknown, nsfwValue: unknown): ParsedMediaArtists | {error: string} {
    const sfwArtist = normalizeArtistName(sfwValue)
    const nsfwArtist = normalizeArtistName(nsfwValue)

    if ('error' in sfwArtist) {
        return {error: `SFW ${sfwArtist.error}`}
    }

    if ('error' in nsfwArtist) {
        return {error: `NSFW ${nsfwArtist.error}`}
    }

    return {
        sfwArtist: sfwArtist.artist,
        nsfwArtist: nsfwArtist.artist,
    }
}

function parseChunkedUploadPair(
    sfwValue: unknown,
    nsfwValue: unknown,
):
    | {
          sfwUpload: CompletedChunkedUpload | null
          nsfwUpload: CompletedChunkedUpload | null
      }
    | {error: string} {
    const sfwUpload = parseCompletedChunkedUpload(sfwValue)
    const nsfwUpload = parseCompletedChunkedUpload(nsfwValue)

    if (sfwUpload && 'error' in sfwUpload) {
        return {error: `SFW ${sfwUpload.error}`}
    }

    if (nsfwUpload && 'error' in nsfwUpload) {
        return {error: `NSFW ${nsfwUpload.error}`}
    }

    return {sfwUpload, nsfwUpload}
}

function maxPreviewByteSize(width: number, height: number): number {
    return width * height * GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL + GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES
}

function expectedPreviewDimensions(original: {width: number; height: number}): {width: number; height: number} {
    const longEdge = Math.max(original.width, original.height)
    const scale = Math.min(1, GALLERY_PREVIEW_MAX_LONG_EDGE / longEdge)

    return {
        width: Math.max(1, Math.round(original.width * scale)),
        height: Math.max(1, Math.round(original.height * scale)),
    }
}

function assertPreviewMatchesOriginal(
    preview: ParsedPreviewImage,
    original: {
        width: number
        height: number
    },
    label: string,
): void {
    const expected = expectedPreviewDimensions(original)
    const widthDelta = Math.abs(preview.width - expected.width)
    const heightDelta = Math.abs(preview.height - expected.height)

    if (widthDelta > GALLERY_PREVIEW_DIMENSION_TOLERANCE || heightDelta > GALLERY_PREVIEW_DIMENSION_TOLERANCE) {
        throw new Error(`${label} dimensions must match the uploaded image scaled to ${GALLERY_PREVIEW_MAX_LONG_EDGE}px`)
    }
}

async function parseChunkedMediaCompleteBody(c: CharacterRouteContext): Promise<
    | ParsedChunkedMediaComplete
    | {
          error: string
          status: 400
      }
> {
    let body: ChunkedMediaCompleteRequest

    try {
        body = await c.req.json<ChunkedMediaCompleteRequest>()
    } catch {
        return {error: 'Invalid JSON body', status: 400}
    }

    const artists = parseMediaArtists(body.sfwArtist, body.nsfwArtist)

    if ('error' in artists) {
        return {error: artists.error, status: 400}
    }

    const uploads = parseChunkedUploadPair(body.sfwUpload, body.nsfwUpload)

    if ('error' in uploads) {
        return {error: uploads.error, status: 400}
    }

    return {
        body,
        artists,
        sfwUpload: uploads.sfwUpload,
        nsfwUpload: uploads.nsfwUpload,
    }
}

function applyMediaVariantRemovals(
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    nextMedia: CharacterMediaRecord,
    removeSfw: boolean,
    removeNsfw: boolean,
    deletedKeys: string[],
): void {
    if (removeSfw && media.sfw_image_key) {
        queueExistingMediaVariantDelete(userId, characterId, media, 'sfw', deletedKeys)
        clearMediaVariant(nextMedia, 'sfw')
    }

    if (removeNsfw && media.nsfw_image_key) {
        queueExistingMediaVariantDelete(userId, characterId, media, 'nsfw', deletedKeys)
        clearMediaVariant(nextMedia, 'nsfw')
    }
}

async function createChunkedGalleryUploads(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    uploadInits: ChunkedUploadInit[],
): Promise<
    Partial<
        Record<
            MediaRating,
            {
                uploadId: string
                imageKey: string
                contentType: string
                chunkSize: number
            }
        >
    >
> {
    const uploads: Partial<
        Record<
            MediaRating,
            {
                uploadId: string
                imageKey: string
                contentType: string
                chunkSize: number
            }
        >
    > = {}

    for (const uploadInit of uploadInits) {
        const imageKey = crypto.randomUUID()
        const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, uploadInit.rating, uploadInit.contentType)
        const upload = await bucket.createMultipartUpload(objectKey, {
            httpMetadata: {
                cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
                contentType: uploadInit.contentType,
            },
        })

        uploads[uploadInit.rating] = {
            uploadId: upload.uploadId,
            imageKey,
            contentType: uploadInit.contentType,
            chunkSize: GALLERY_CHUNK_SIZE,
        }
    }

    return uploads
}

function existingMediaVariantKey(media: CharacterMediaRecord, rating: MediaRating): string | null {
    return rating === 'sfw' ? media.sfw_image_key : media.nsfw_image_key
}

function existingMediaVariantContentType(media: CharacterMediaRecord, rating: MediaRating): string | null {
    return rating === 'sfw' ? media.sfw_content_type : media.nsfw_content_type
}

function existingMediaPreviewKey(media: CharacterMediaRecord, rating: MediaRating): string | null {
    return rating === 'sfw' ? media.sfw_preview_image_key : media.nsfw_preview_image_key
}

function queueExistingMediaVariantDelete(
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    rating: MediaRating,
    deletedKeys: string[],
): void {
    const imageKey = existingMediaVariantKey(media, rating)

    if (imageKey) {
        deletedKeys.push(
            characterMediaImageObjectKey(userId, characterId, media.id, imageKey, rating, existingMediaVariantContentType(media, rating)),
        )
    }

    const previewImageKey = existingMediaPreviewKey(media, rating)

    if (previewImageKey) {
        deletedKeys.push(characterMediaPreviewImageObjectKey(userId, characterId, media.id, previewImageKey, rating))
    }

    if (rating === 'nsfw' && media.nsfw_blur_image_key) {
        deletedKeys.push(characterMediaNsfwBlurImageObjectKey(userId, characterId, media.id, media.nsfw_blur_image_key))
    }
}

function clearMediaVariant(nextMedia: CharacterMediaRecord, rating: MediaRating): void {
    if (rating === 'sfw') {
        nextMedia.sfw_image_key = null
        nextMedia.sfw_content_type = null
        nextMedia.sfw_width = null
        nextMedia.sfw_height = null
        nextMedia.sfw_byte_size = null
        nextMedia.sfw_preview_image_key = null
        nextMedia.sfw_preview_width = null
        nextMedia.sfw_preview_height = null
        nextMedia.sfw_preview_byte_size = null
        return
    }

    nextMedia.nsfw_image_key = null
    nextMedia.nsfw_content_type = null
    nextMedia.nsfw_width = null
    nextMedia.nsfw_height = null
    nextMedia.nsfw_byte_size = null
    nextMedia.nsfw_preview_image_key = null
    nextMedia.nsfw_preview_width = null
    nextMedia.nsfw_preview_height = null
    nextMedia.nsfw_preview_byte_size = null
    nextMedia.nsfw_blur_image_key = null
}

function assignMediaVariant(
    nextMedia: CharacterMediaRecord,
    rating: MediaRating,
    image: {imageKey: string; contentType: string; width: number; height: number; byteSize: number},
    preview: CompletedGalleryPreview | null,
): void {
    if (rating === 'sfw') {
        nextMedia.sfw_image_key = image.imageKey
        nextMedia.sfw_content_type = image.contentType
        nextMedia.sfw_width = image.width
        nextMedia.sfw_height = image.height
        nextMedia.sfw_byte_size = image.byteSize
        nextMedia.sfw_preview_image_key = preview?.imageKey ?? null
        nextMedia.sfw_preview_width = preview?.width ?? null
        nextMedia.sfw_preview_height = preview?.height ?? null
        nextMedia.sfw_preview_byte_size = preview?.byteSize ?? null
        return
    }

    nextMedia.nsfw_image_key = image.imageKey
    nextMedia.nsfw_content_type = image.contentType
    nextMedia.nsfw_width = image.width
    nextMedia.nsfw_height = image.height
    nextMedia.nsfw_byte_size = image.byteSize
    nextMedia.nsfw_preview_image_key = preview?.imageKey ?? null
    nextMedia.nsfw_preview_width = preview?.width ?? null
    nextMedia.nsfw_preview_height = preview?.height ?? null
    nextMedia.nsfw_preview_byte_size = preview?.byteSize ?? null
    nextMedia.nsfw_blur_image_key = null
}

async function replaceMediaVariantWithChunkedUpload(
    images: ImagesBinding,
    bucket: R2Bucket,
    env: Bindings,
    mediaPublicBaseUrl: string,
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    nextMedia: CharacterMediaRecord,
    upload: CompletedChunkedUpload,
    rating: MediaRating,
    uploadedKeys: string[],
    deletedKeys: string[],
): Promise<void> {
    queueExistingMediaVariantDelete(userId, characterId, media, rating, deletedKeys)
    const label = rating === 'sfw' ? 'SFW image' : 'NSFW image'
    const image = await completeChunkedGalleryUpload(bucket, userId, characterId, media.id, upload, rating, label)
    uploadedKeys.push(characterMediaImageObjectKey(userId, characterId, media.id, image.imageKey, rating, image.contentType))
    const previewImage = await generateAndPutMediaPreviewImage(
        env,
        bucket,
        mediaPublicBaseUrl,
        userId,
        characterId,
        media.id,
        image,
        rating,
        uploadedKeys,
    )
    assignMediaVariant(nextMedia, rating, image, previewImage)

    if (rating === 'nsfw') {
        nextMedia.nsfw_blur_image_key = await putNsfwBlurImage(
            images,
            bucket,
            userId,
            characterId,
            media.id,
            previewImage.preview,
            uploadedKeys,
        )
    }
}

async function putMediaPreviewImage(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    preview: ParsedPreviewImage,
    rating: MediaRating,
    uploadedKeys: string[],
): Promise<CompletedGalleryPreview> {
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaPreviewImageObjectKey(userId, characterId, mediaId, imageKey, rating)

    await bucket.put(objectKey, preview.bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: preview.contentType,
        },
    })

    uploadedKeys.push(objectKey)

    return {
        imageKey,
        width: preview.width,
        height: preview.height,
        byteSize: preview.bytes.byteLength,
    }
}

async function generateAndPutMediaPreviewImage(
    env: Bindings,
    bucket: R2Bucket,
    mediaPublicBaseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    image: CompletedGalleryUpload,
    rating: MediaRating,
    uploadedKeys: string[],
): Promise<CompletedGalleryPreview & {preview: ParsedPreviewImage}> {
    const preview = await generateMediaPreviewImage(env, mediaPublicBaseUrl, userId, characterId, mediaId, image, rating)
    const stored = await putMediaPreviewImage(bucket, userId, characterId, mediaId, preview, rating, uploadedKeys)

    return {
        ...stored,
        preview,
    }
}

async function generateMediaPreviewImage(
    env: Bindings,
    mediaPublicBaseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    image: CompletedGalleryUpload,
    rating: MediaRating,
): Promise<ParsedPreviewImage> {
    const sourceObjectKey = characterMediaImageObjectKey(userId, characterId, mediaId, image.imageKey, rating, image.contentType)
    const sourceUrl = characterMediaImageUrl(mediaPublicBaseUrl, userId, characterId, mediaId, image.imageKey, rating, image.contentType)

    try {
        return await generateMediaPreviewWithCloudflareImages(mediaPublicBaseUrl, sourceObjectKey, image)
    } catch (error) {
        console.warn('Cloudflare Images preview generation failed, falling back to container', {
            error: error instanceof Error ? error.message : String(error),
            sourceObjectKey,
        })
    }

    return await generateMediaPreviewWithContainer(env, sourceUrl, image)
}

async function generateMediaPreviewWithCloudflareImages(
    mediaPublicBaseUrl: string,
    sourceObjectKey: string,
    image: CompletedGalleryUpload,
): Promise<ParsedPreviewImage> {
    const maxAttempts = 3
    const retryDelayMs = 2_000
    const options = new URLSearchParams()
    options.set('width', String(GALLERY_PREVIEW_MAX_LONG_EDGE))
    options.set('height', String(GALLERY_PREVIEW_MAX_LONG_EDGE))
    options.set('fit', 'scale-down')
    options.set('format', 'webp')
    options.set('quality', String(GALLERY_PREVIEW_QUALITY))

    const previewUrl = `${mediaPublicBaseUrl}/cdn-cgi/image/${[...options.entries()].map(([key, value]) => `${key}=${value}`).join(',')}/${sourceObjectKey}`

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(previewUrl, {
                headers: {
                    accept: 'image/webp,image/*,*/*;q=0.8',
                },
            })

            return await previewFromResponse(response, image, 'Cloudflare Images preview')
        } catch (error) {
            if (attempt === maxAttempts) {
                throw error
            }

            await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
        }
    }

    throw new Error('Cloudflare Images preview failed unexpectedly.')
}

async function generateMediaPreviewWithContainer(
    env: Bindings,
    sourceUrl: string,
    image: CompletedGalleryUpload,
): Promise<ParsedPreviewImage> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Preview container binding is not configured.')
    }

    const id = env.MYOC_DOCKER_SHARP_CONTAINER.idFromName('myoc-docker-sharp')
    const container = env.MYOC_DOCKER_SHARP_CONTAINER.get(id)
    const response = await container.fetch('https://container/images/preview', {
        body: JSON.stringify({imageUrl: sourceUrl}),
        headers: {
            authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
            'content-type': 'application/json',
        },
        method: 'POST',
    })

    return await previewFromResponse(response, image, 'Container preview')
}

async function previewFromResponse(response: Response, image: CompletedGalleryUpload, label: string): Promise<ParsedPreviewImage> {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? ''

    if (!response.ok || contentType !== GALLERY_PREVIEW_CONTENT_TYPE) {
        const message = new TextDecoder().decode(bytes).slice(0, 500)
        throw new Error(`${label} failed with ${response.status}${message ? `: ${message}` : ''}`)
    }

    if (bytes.byteLength <= 0) {
        throw new Error(`${label} is empty`)
    }

    if (bytes.byteLength > GALLERY_PREVIEW_MAX_BYTES) {
        throw new Error(`${label} is too large`)
    }

    const dimensions = getWebpDimensions(bytes)

    if (!dimensions) {
        throw new Error(`${label} returned an invalid WebP image`)
    }

    const preview = {
        bytes,
        contentType: GALLERY_PREVIEW_CONTENT_TYPE,
        width: dimensions.width,
        height: dimensions.height,
    } satisfies ParsedPreviewImage

    assertPreviewMatchesOriginal(preview, image, label)

    if (bytes.byteLength > maxPreviewByteSize(preview.width, preview.height)) {
        throw new Error(`${label} is too large for its dimensions`)
    }

    return preview
}

async function putNsfwBlurImage(
    images: ImagesBinding | undefined,
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    preview: ParsedPreviewImage,
    uploadedKeys: string[],
): Promise<string> {
    if (!images) {
        throw new Error('Cloudflare Images binding is not configured.')
    }

    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, imageKey)
    const result = await images
        .input(streamFromBytes(preview.bytes))
        .transform({width: GALLERY_NSFW_BLUR_MAX_WIDTH, fit: 'scale-down'})
        .transform({blur: GALLERY_NSFW_BLUR_AMOUNT})
        .output({format: 'image/webp', quality: GALLERY_NSFW_BLUR_QUALITY})

    const response = result.response()
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? GALLERY_PREVIEW_CONTENT_TYPE

    await bucket.put(objectKey, bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType,
        },
    })

    uploadedKeys.push(objectKey)

    return imageKey
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}

async function parseCreateCharacterRequest(c: CharacterRouteContext): Promise<
    | {
          name: unknown
          folderId: unknown
          profileImage: File | JsonProfileImage | null
      }
    | {
          error: string
          status: 400 | 413
      }
> {
    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
        const contentLength = Number(c.req.header('content-length') ?? 0)

        if (contentLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
            return {error: 'Character profile image upload is too large', status: 413}
        }

        const form = await c.req.formData()
        const profileImage = form.get('profileImage') ?? form.get('new-character-profile-image')

        return {
            name: form.get('name') ?? form.get('new-character-name'),
            folderId: form.get('folderId') ?? form.get('new-character-folder'),
            profileImage: profileImage instanceof File ? profileImage : null,
        }
    }

    if (contentType.includes('application/json')) {
        try {
            const body = await c.req.json<CreateCharacterRequest>()

            return {
                name: body.name ?? body['new-character-name'],
                folderId: body.folderId ?? body['new-character-folder'],
                profileImage: readJsonProfileImage(body),
            }
        } catch {
            return {error: 'Invalid JSON body', status: 400}
        }
    }

    return {error: 'JSON or multipart form data is required', status: 400}
}

async function parseCreateFolderRequest(req: CharacterRouteContext['req']): Promise<
    | {
          name: unknown
          parentFolderId: unknown
          folderImage: JsonProfileImage | null
      }
    | {
          error: string
      }
> {
    const contentType = req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            const body = await req.json<CreateFolderRequest>()

            return {
                name: body.name ?? body['new-folder-name'],
                parentFolderId: body.parentFolderId ?? body.parentId ?? body['new-folder-parent'],
                folderImage: readJsonImage(body.folderImageData ?? body.folderImage),
            }
        } catch {
            return {error: 'Invalid JSON body'}
        }
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const form = await req.formData()

        return {
            name: form.get('name') ?? form.get('new-folder-name'),
            parentFolderId: form.get('parentFolderId') ?? form.get('parentId') ?? form.get('new-folder-parent'),
            folderImage: null,
        }
    }

    return {error: 'JSON or form data is required'}
}

async function parseDeleteCharacterRequest(req: CharacterRouteContext['req']): Promise<DeleteCharacterRequest> {
    const contentType = req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            return await req.json<DeleteCharacterRequest>()
        } catch {
            return {}
        }
    }

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
        const form = await req.formData()

        return {
            confirmName: form.get('confirmName'),
            permanent: form.get('permanent'),
            'delete-character-confirm-name': form.get('delete-character-confirm-name'),
            'delete-confirm-permanent': form.get('delete-confirm-permanent'),
        }
    }

    return {}
}

function normalizeCharacterName(value: unknown): {name: string} | {error: string} {
    const name = normalizeOptionalText(value)

    if (!name) {
        return {error: 'Character name is required'}
    }

    if (name.length > CHARACTER_NAME_MAX_LENGTH) {
        return {error: 'Character name must be 80 characters or fewer'}
    }

    if (!CHARACTER_NAME_ALLOWED_PATTERN.test(name)) {
        return {error: `Character name may contain only ${CHARACTER_NAME_RULES}, and must include at least one letter or number`}
    }

    return {name}
}

function normalizeCharacterDescription(value: unknown): {description: string} | {error: string} {
    const description = normalizeOptionalText(value) ?? ''

    if (description.length > CHARACTER_DESCRIPTION_MAX_LENGTH) {
        return {error: 'Character description must be 255 characters or fewer'}
    }

    return {description}
}

function normalizeFolderName(value: unknown): {name: string} | {error: string} {
    const name = normalizeOptionalText(value)

    if (!name) {
        return {error: 'Folder name is required'}
    }

    if (name.length > FOLDER_NAME_MAX_LENGTH) {
        return {error: 'Folder name must be 80 characters or fewer'}
    }

    if (!DISPLAY_NAME_ALLOWED_PATTERN.test(name)) {
        return {error: `Folder name may contain only ${DISPLAY_NAME_RULES}, and must start with a letter or number`}
    }

    return {name}
}

function normalizeFolderId(value: unknown): {folderId: string | null} | {error: string} {
    const folderId = normalizeOptionalText(value)

    if (!folderId || folderId === 'root') {
        return {folderId: null}
    }

    if (folderId.length > FOLDER_ID_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(folderId)) {
        return {error: 'Folder must be root or a valid folder id'}
    }

    return {folderId}
}

function normalizeGalleryTabName(value: unknown): {name: string} | {error: string} {
    const name = normalizeOptionalText(value)

    if (!name) {
        return {error: 'Gallery tab name is required'}
    }

    if (name.length > 32) {
        return {error: 'Gallery tab name must be 32 characters or fewer'}
    }

    if (!DISPLAY_NAME_ALLOWED_PATTERN.test(name)) {
        return {error: `Gallery tab name may contain only ${DISPLAY_NAME_RULES}, and must start with a letter or number`}
    }

    return {name}
}

function normalizeArtistName(value: unknown): {artist: string} | {error: string} {
    const artist = normalizeOptionalText(value) ?? ''

    if (artist.length > ARTIST_NAME_MAX_LENGTH) {
        return {error: 'artist name must be 80 characters or fewer'}
    }

    return {artist}
}

type ParsedGalleryLayout = {
    mediaIds: Set<string>
    tabs: {
        id: string
        name: string
        rows: {
            id: string
            mediaIds: string[]
            forceFullWidth: boolean
        }[]
    }[]
}

function parseGalleryLayout(body: GalleryLayoutRequest): ParsedGalleryLayout | {error: string} {
    if (!Array.isArray(body.tabs)) {
        return {error: 'Gallery tabs are required'}
    }

    if (body.tabs.length < 1 || body.tabs.length > GALLERY_MAX_TABS) {
        return {error: `Gallery must contain between 1 and ${GALLERY_MAX_TABS} tabs`}
    }

    const parsed: ParsedGalleryLayout = {
        mediaIds: new Set(),
        tabs: [],
    }
    const tabIds = new Set<string>()
    const rowIds = new Set<string>()
    let rowCount = 0
    let placementCount = 0

    for (const tabItem of body.tabs) {
        if (!isRecord(tabItem)) {
            return {error: 'Gallery tab must be an object'}
        }

        const tabId = normalizeOptionalText(tabItem.id)
        const name = normalizeGalleryTabName(tabItem.name)

        if (!tabId || !isValidTreeId(tabId)) {
            return {error: 'Gallery tab id is invalid'}
        }

        if (tabIds.has(tabId)) {
            return {error: 'Gallery tab ids must be unique'}
        }

        if ('error' in name) {
            return name
        }

        const rowItems = tabItem.rows === undefined ? [] : tabItem.rows

        if (!Array.isArray(rowItems)) {
            return {error: 'Gallery tab rows are required'}
        }

        const tab = {
            id: tabId,
            name: name.name,
            rows: [] as {id: string; mediaIds: string[]; forceFullWidth: boolean}[],
        }
        const mediaIdsInTab = new Set<string>()
        tabIds.add(tabId)

        for (const rowItem of rowItems) {
            rowCount += 1

            if (rowCount > GALLERY_MAX_ROWS) {
                return {error: `Gallery must contain ${GALLERY_MAX_ROWS} rows or fewer`}
            }

            if (!isRecord(rowItem)) {
                return {error: 'Gallery row must be an object'}
            }

            const rowId = normalizeOptionalText(rowItem.id)

            if (!rowId || !isValidTreeId(rowId)) {
                return {error: 'Gallery row id is invalid'}
            }

            if (rowIds.has(rowId)) {
                return {error: 'Gallery row ids must be unique'}
            }

            if (!Array.isArray(rowItem.mediaIds)) {
                return {error: 'Gallery row media ids are required'}
            }

            if (rowItem.mediaIds.length > GALLERY_MAX_IMAGES_PER_ROW) {
                return {error: `Gallery rows can contain ${GALLERY_MAX_IMAGES_PER_ROW} images or fewer`}
            }

            rowIds.add(rowId)

            const row = {
                id: rowId,
                mediaIds: [] as string[],
                forceFullWidth: rowItem.forceFullWidth === true,
            }

            for (const rawMediaId of rowItem.mediaIds) {
                const mediaId = normalizeOptionalText(rawMediaId)
                placementCount += 1

                if (placementCount > GALLERY_MAX_MEDIA_PLACEMENTS) {
                    return {error: `Gallery must contain ${GALLERY_MAX_MEDIA_PLACEMENTS} media placements or fewer`}
                }

                if (!mediaId || !isValidTreeId(mediaId)) {
                    return {error: 'Gallery media id is invalid'}
                }

                if (mediaIdsInTab.has(mediaId)) {
                    return {error: 'A media item can only appear once in each gallery tab'}
                }

                mediaIdsInTab.add(mediaId)
                parsed.mediaIds.add(mediaId)
                row.mediaIds.push(mediaId)
            }

            tab.rows.push(row)
        }

        tab.rows.forEach((row, rowIndex) => {
            row.forceFullWidth = shouldForceGalleryRowFullWidth(row, rowIndex, tab.rows.length)
        })
        parsed.tabs.push(tab)
    }

    return parsed
}

function validateCompleteGalleryLayout(
    layout: ParsedGalleryLayout,
    allCharacterMediaIds: Set<string>,
): {
    error: string
} | null {
    if (allCharacterMediaIds.size === 0) {
        return null
    }

    for (const mediaId of allCharacterMediaIds) {
        if (!layout.mediaIds.has(mediaId)) {
            return {error: 'All character media must be placed on at least one gallery tab'}
        }
    }

    for (const tab of layout.tabs) {
        if (tab.rows.length === 0 || tab.rows.every((row) => row.mediaIds.length === 0)) {
            return {error: 'Gallery tabs cannot be blank while this character has media'}
        }

        if (tab.rows.some((row) => row.mediaIds.length === 0)) {
            return {error: 'Gallery rows cannot be empty while this character has media'}
        }
    }

    return null
}

type FlattenedTreeItem = {
    type: 'folder' | 'character'
    id: string
    parentFolderId: string | null
    sortOrder: number
}

function flattenTreeItems(
    items: unknown[],
    parentFolderId: string | null = null,
    seen = new Set<string>(),
    depth = 0,
    itemCount = {value: 0},
):
    | {
          items: FlattenedTreeItem[]
      }
    | {
          error: string
      } {
    if (depth > TREE_MAX_DEPTH) {
        return {error: 'Folder nesting is too deep'}
    }

    const flattened: FlattenedTreeItem[] = []

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]

        itemCount.value += 1

        if (itemCount.value > TREE_MAX_ITEMS) {
            return {error: 'Tree contains too many items'}
        }

        if (!isRecord(item)) {
            return {error: 'Tree item must be an object'}
        }

        const type = item.type
        const id = normalizeOptionalText(item.id)

        if (type !== 'folder' && type !== 'character') {
            return {error: 'Tree item type must be folder or character'}
        }

        if (!id || !isValidTreeId(id)) {
            return {error: 'Tree item id is invalid'}
        }

        const seenKey = `${type}:${id}`

        if (seen.has(seenKey)) {
            return {error: 'Tree item ids must be unique'}
        }

        seen.add(seenKey)
        flattened.push({
            type,
            id,
            parentFolderId,
            sortOrder: index,
        })

        if (type === 'folder') {
            const children = item.children

            if (children !== undefined && !Array.isArray(children)) {
                return {error: 'Folder children must be an array'}
            }

            const childResult = flattenTreeItems(children ?? [], id, seen, depth + 1, itemCount)

            if ('error' in childResult) {
                return childResult
            }

            flattened.push(...childResult.items)
        } else if (item.children !== undefined) {
            return {error: 'Characters cannot contain children'}
        }
    }

    return {items: flattened}
}

function normalizeOrderedIds(value: unknown, label: string): {ids: string[]} | {error: string} {
    if (!Array.isArray(value)) {
        return {error: `${label} must be an array`}
    }

    if (value.length > TREE_MAX_ITEMS) {
        return {error: `${label} contains too many items`}
    }

    const ids: string[] = []
    const seen = new Set<string>()

    for (const rawId of value) {
        const id = normalizeOptionalText(rawId)

        if (!id || !isValidTreeId(id)) {
            return {error: `${label} contains an invalid character id`}
        }

        if (seen.has(id)) {
            return {error: `${label} contains duplicate characters`}
        }

        seen.add(id)
        ids.push(id)
    }

    return {ids}
}

async function getOwnedFolderIds(db: D1Database, userId: string, folderIds: string[]): Promise<Set<string>> {
    if (folderIds.length === 0) {
        return new Set()
    }

    const ownedIds = new Set<string>()

    for (const chunk of chunkArray(folderIds, SQL_IN_CLAUSE_CHUNK_SIZE)) {
        const placeholders = chunk.map(() => '?').join(', ')
        const result = await db
            .prepare(
                `SELECT id
             FROM character_folders
             WHERE user_id = ?
               AND id IN (${placeholders})`,
            )
            .bind(userId, ...chunk)
            .all<Pick<CharacterFolderRecord, 'id'>>()

        for (const folder of result.results ?? []) {
            ownedIds.add(folder.id)
        }
    }

    return ownedIds
}

async function getOwnedCharacterIds(db: D1Database, userId: string, characterIds: string[]): Promise<Set<string>> {
    if (characterIds.length === 0) {
        return new Set()
    }

    const ownedIds = new Set<string>()

    for (const chunk of chunkArray(characterIds, SQL_IN_CLAUSE_CHUNK_SIZE)) {
        const placeholders = chunk.map(() => '?').join(', ')
        const result = await db
            .prepare(
                `SELECT id
             FROM characters
             WHERE user_id = ?
               AND id IN (${placeholders})`,
            )
            .bind(userId, ...chunk)
            .all<Pick<CharacterRecord, 'id'>>()

        for (const character of result.results ?? []) {
            ownedIds.add(character.id)
        }
    }

    return ownedIds
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = []

    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize))
    }

    return chunks
}

async function getOwnedMediaIds(db: D1Database, userId: string, characterId: string, mediaIds: string[]): Promise<Set<string>> {
    if (mediaIds.length === 0) {
        return new Set()
    }

    const ownedIds = new Set<string>()

    for (const chunk of chunkArray(mediaIds, SQL_IN_CLAUSE_CHUNK_SIZE)) {
        const placeholders = chunk.map(() => '?').join(', ')
        const result = await db
            .prepare(
                `SELECT id
             FROM character_media
             WHERE user_id = ?
               AND character_id = ?
               AND id IN (${placeholders})`,
            )
            .bind(userId, characterId, ...chunk)
            .all<Pick<CharacterMediaRecord, 'id'>>()

        for (const media of result.results ?? []) {
            ownedIds.add(media.id)
        }
    }

    return ownedIds
}

async function getCharacterMediaIds(db: D1Database, userId: string, characterId: string): Promise<Set<string>> {
    const result = await db
        .prepare(
            `SELECT id
         FROM character_media
         WHERE user_id = ?
           AND character_id = ?`,
        )
        .bind(userId, characterId)
        .all<Pick<CharacterMediaRecord, 'id'>>()

    return new Set((result.results ?? []).map((media) => media.id))
}

async function characterHasMediaCapacity(db: D1Database, userId: string, characterId: string): Promise<boolean> {
    const row = await db
        .prepare(
            `SELECT COUNT(*) AS count
         FROM character_media
         WHERE user_id = ?
           AND character_id = ?`,
        )
        .bind(userId, characterId)
        .first<{count: number}>()

    return Number(row?.count ?? 0) < GALLERY_MAX_MEDIA_PER_CHARACTER
}

function readJsonProfileImage(body: {profileImageData?: unknown; profileImage?: unknown}): JsonProfileImage | null {
    return readJsonImage(body.profileImageData ?? body.profileImage)
}

function readJsonImage(value: unknown): JsonProfileImage | null {
    if (typeof value === 'string') {
        return {data: value}
    }

    if (isRecord(value) && typeof value.data === 'string') {
        return {data: value.data}
    }

    return null
}

function parseCharacterHeightChartJson(value: string | null | undefined): CharacterHeightChartJson | null {
    if (!value) {
        return null
    }

    try {
        const parsed = JSON.parse(value) as unknown

        if (!isRecord(parsed) || !isRecord(parsed.height) || !isRecord(parsed.calibration)) {
            return null
        }

        const image = isRecord(parsed.image) ? parsed.image : null
        const meters = Number(parsed.height.meters)
        const headYPercent = Number(parsed.calibration.headYPercent)
        const footYPercent = Number(parsed.calibration.footYPercent)
        const nameTagXPercent = Number(parsed.calibration.nameTagXPercent ?? 50)

        if (
            !Number.isFinite(meters) ||
            !Number.isFinite(headYPercent) ||
            !Number.isFinite(footYPercent) ||
            !Number.isFinite(nameTagXPercent)
        ) {
            return null
        }

        return {
            version: 1,
            height: {
                meters,
            },
            image: image
                ? {
                      key: typeof image.key === 'string' ? image.key : '',
                      contentType: typeof image.contentType === 'string' ? image.contentType : 'image/png',
                      naturalWidth: Number(image.naturalWidth) || 1,
                      naturalHeight: Number(image.naturalHeight) || 1,
                  }
                : null,
            calibration: {
                headYPercent,
                footYPercent,
                footIsVirtual: Boolean(parsed.calibration.footIsVirtual),
                nameTagXPercent,
            },
        }
    } catch {
        return null
    }
}

function normalizeHeightChartJson(
    rawJson: string,
    existingHeightChart: CharacterHeightChartJson | null,
    uploadedImage: CompletedGalleryUpload | null,
): {heightChart: CharacterHeightChartJson} | {error: string} {
    if (rawJson.length > HEIGHT_CHART_JSON_MAX_LENGTH) {
        return {error: 'Height chart JSON is too large'}
    }

    let body: HeightChartSaveRequest

    try {
        body = JSON.parse(rawJson) as HeightChartSaveRequest
    } catch {
        return {error: 'Height chart JSON is invalid'}
    }

    if (!isRecord(body.height) || !isRecord(body.calibration)) {
        return {error: 'Height and calibration data are required'}
    }

    const meters = Number(body.height.meters)

    if (!Number.isFinite(meters) || meters < HEIGHT_CHART_MIN_METERS || meters > HEIGHT_CHART_MAX_METERS) {
        return {error: 'Height must be between 0.01 and 100 meters'}
    }

    const footIsVirtual = Boolean(body.calibration.footIsVirtual)
    const maxFootPercent = footIsVirtual ? HEIGHT_CHART_MAX_FOOT_PERCENT : 100
    const headYPercent = Number(body.calibration.headYPercent)
    const footYPercent = Number(body.calibration.footYPercent)
    const nameTagXPercent = Number(body.calibration.nameTagXPercent ?? 50)

    if (!Number.isFinite(headYPercent) || headYPercent < 0 || headYPercent > 100) {
        return {error: 'Head marker must be between 0 and 100 percent'}
    }

    if (!Number.isFinite(footYPercent) || footYPercent < 0 || footYPercent > maxFootPercent) {
        return {
            error: footIsVirtual
                ? 'Virtual foot marker must be between 0 and 180 percent'
                : 'Foot marker must be between 0 and 100 percent',
        }
    }

    if (footYPercent - headYPercent < 2) {
        return {error: 'Foot marker must be below the head marker'}
    }

    if (!Number.isFinite(nameTagXPercent) || nameTagXPercent < 0 || nameTagXPercent > 100) {
        return {error: 'Nametag marker must be between 0 and 100 percent'}
    }

    let image: CharacterHeightChartJson['image'] = null

    if (uploadedImage) {
        image = {
            key: uploadedImage.imageKey,
            contentType: uploadedImage.contentType,
            naturalWidth: uploadedImage.width,
            naturalHeight: uploadedImage.height,
        }
    } else if (isRecord(body.image) && existingHeightChart?.image && body.image.key === existingHeightChart.image.key) {
        image = existingHeightChart.image
    }

    return {
        heightChart: {
            version: 1,
            height: {
                meters: Number(meters.toFixed(4)),
            },
            image,
            calibration: {
                headYPercent: Number(headYPercent.toFixed(2)),
                footYPercent: Number(footYPercent.toFixed(2)),
                footIsVirtual,
                nameTagXPercent: Number(nameTagXPercent.toFixed(2)),
            },
        },
    }
}

function isValidTreeId(value: string): boolean {
    return value.length <= FOLDER_ID_MAX_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
}

async function folderExists(db: D1Database, userId: string, folderId: string): Promise<boolean> {
    const folder = await db
        .prepare(
            `SELECT id
         FROM character_folders
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(folderId, userId)
        .first<Pick<CharacterFolderRecord, 'id'>>()

    return Boolean(folder)
}

async function getOwnedFolder(db: D1Database, userId: string, folderId: string): Promise<CharacterFolderRecord | null> {
    return await db
        .prepare(
            `SELECT id, user_id, name, parent_folder_id, folder_image_key, sort_order, created_at, updated_at
         FROM character_folders
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(folderId, userId)
        .first<CharacterFolderRecord>()
}

async function getOwnedCharacter(db: D1Database, userId: string, characterId: string): Promise<CharacterRecord | null> {
    return await db
        .prepare(
            `SELECT id,
                user_id,
                name,
                profile_image_key,
                folder_id,
                sort_order,
                description,
                height_chart_json,
                created_at,
                updated_at
         FROM characters
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(characterId, userId)
        .first<CharacterRecord>()
}

async function getOwnedCharacterMedia(
    db: D1Database,
    userId: string,
    characterId: string,
    mediaId: string,
): Promise<CharacterMediaRecord | null> {
    return await db
        .prepare(
            `SELECT id,
                user_id,
                character_id,
                sfw_image_key,
                nsfw_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                nsfw_width,
                nsfw_height,
                nsfw_byte_size,
                sfw_preview_image_key,
                sfw_preview_width,
                sfw_preview_height,
                sfw_preview_byte_size,
                nsfw_preview_image_key,
                nsfw_blur_image_key,
                nsfw_preview_width,
                nsfw_preview_height,
                nsfw_preview_byte_size,
                created_at,
                updated_at
         FROM character_media
         WHERE id = ?
           AND character_id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(mediaId, characterId, userId)
        .first<CharacterMediaRecord>()
}

async function getToyhouseImportItem(db: D1Database, userId: string, itemId: string): Promise<ToyhouseImportItemRecord | null> {
    return await db
        .prepare(
            `SELECT id,
                job_id,
                user_id,
                character_id,
                rating,
                status,
                media_id
         FROM toyhouse_import_items
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(itemId, userId)
        .first<ToyhouseImportItemRecord>()
}

async function markToyhouseImportItemFailed(db: D1Database, userId: string, itemId: string, error: string): Promise<void> {
    const now = toSqlTimestamp(new Date())

    await db.batch([
        db
            .prepare(
                `UPDATE toyhouse_import_items
             SET status = ?,
                 error  = ?,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
            )
            .bind('failed', error.slice(0, 500), now, itemId, userId),
        db
            .prepare(
                `UPDATE toyhouse_import_jobs
             SET status = ?,
                 updated_at = ?
             WHERE user_id = ?
               AND id = (SELECT job_id
                         FROM toyhouse_import_items
                         WHERE id = ?
                           AND user_id = ?
                         LIMIT 1)`,
            )
            .bind('failed', now, userId, itemId, userId),
    ])
}

async function updateToyhouseImportJobStatus(db: D1Database, userId: string, jobId: string): Promise<void> {
    const remaining = await db
        .prepare(
            `SELECT COUNT(*) AS count
         FROM toyhouse_import_items
         WHERE job_id = ?
           AND user_id = ?
           AND status <> 'imported'`,
        )
        .bind(jobId, userId)
        .first<{count: number}>()
    const status = (remaining?.count ?? 0) === 0 ? 'complete' : 'running'
    const now = toSqlTimestamp(new Date())

    await db
        .prepare(
            `UPDATE toyhouse_import_jobs
         SET status = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`,
        )
        .bind(status, now, jobId, userId)
        .run()
}

async function getCharacterMedia(db: D1Database, userId: string, characterId: string): Promise<CharacterMediaRecord[]> {
    const media: CharacterMediaRecord[] = []
    let cursor: Pick<CharacterMediaRecord, 'created_at' | 'id'> | null = null

    while (true) {
        const cursorFilter: string = cursor ? `AND (created_at > ? OR (created_at = ? AND id > ?))` : ''
        const result: {results?: CharacterMediaRecord[]} = await db
            .prepare(
                `SELECT id,
                    user_id,
                    character_id,
                    sfw_image_key,
                    nsfw_image_key,
                    sfw_content_type,
                    nsfw_content_type,
                    sfw_artist,
                    nsfw_artist,
                    sfw_width,
                    sfw_height,
                    sfw_byte_size,
                    nsfw_width,
                    nsfw_height,
                    nsfw_byte_size,
                    sfw_preview_image_key,
                    sfw_preview_width,
                    sfw_preview_height,
                    sfw_preview_byte_size,
                    nsfw_preview_image_key,
                    nsfw_blur_image_key,
                    nsfw_preview_width,
                    nsfw_preview_height,
                    nsfw_preview_byte_size,
                    created_at,
                    updated_at
             FROM character_media
             WHERE character_id = ?
               AND user_id = ? ${cursorFilter}
             ORDER BY created_at, id
             LIMIT ?`,
            )
            .bind(
                ...(cursor
                    ? [characterId, userId, cursor.created_at, cursor.created_at, cursor.id, SQL_SELECT_CHUNK_SIZE]
                    : [characterId, userId, SQL_SELECT_CHUNK_SIZE]),
            )
            .all<CharacterMediaRecord>()
        const rows: CharacterMediaRecord[] = result.results ?? []

        media.push(...rows)

        if (rows.length < SQL_SELECT_CHUNK_SIZE) {
            return media
        }

        const lastRow: CharacterMediaRecord | undefined = rows.at(-1)

        if (!lastRow) {
            return media
        }

        cursor = {
            created_at: lastRow.created_at,
            id: lastRow.id,
        }
    }
}

async function validateGalleryImage(
    file: File,
    label: string,
): Promise<
    | {
          bytes: Uint8Array
          contentType: string
          width: number
          height: number
      }
    | {
          error: string
          status: 400
      }
> {
    const contentType = normalizeGalleryImageContentType(file.type)

    if ('error' in contentType) {
        return {error: contentType.error, status: 400}
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    if (bytes.byteLength <= 0) {
        return {error: `${label} is empty`, status: 400}
    }

    const dimensions =
        readGalleryImageDimensions(bytes, contentType.contentType) ??
        normalizeGalleryImageDimensions(
            'width' in file ? (file as File & {width?: unknown}).width : undefined,
            'height' in file ? (file as File & {height?: unknown}).height : undefined,
        )

    if ('error' in dimensions) {
        return {error: `${label} dimensions are required`, status: 400}
    }

    return {
        bytes,
        contentType: contentType.contentType,
        width: dimensions.width,
        height: dimensions.height,
    }
}

async function deleteCharacterMediaObjects(bucket: R2Bucket, media: CharacterMediaRecord): Promise<void> {
    const objectKeys: string[] = []

    if (media.sfw_image_key) {
        objectKeys.push(
            characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw', media.sfw_content_type),
        )
    }

    if (media.sfw_preview_image_key) {
        objectKeys.push(
            characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_preview_image_key, 'sfw'),
        )
    }

    if (media.nsfw_image_key) {
        objectKeys.push(
            characterMediaImageObjectKey(
                media.user_id,
                media.character_id,
                media.id,
                media.nsfw_image_key,
                'nsfw',
                media.nsfw_content_type,
            ),
        )
    }

    if (media.nsfw_preview_image_key) {
        objectKeys.push(
            characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_preview_image_key, 'nsfw'),
        )
    }

    if (media.nsfw_blur_image_key) {
        objectKeys.push(characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_blur_image_key))
    }

    await deleteR2Objects(bucket, objectKeys)
}

async function deleteR2Objects(bucket: R2Bucket, objectKeys: string[]): Promise<void> {
    for (const objectKey of objectKeys) {
        try {
            await bucket.delete(objectKey)
        } catch (error) {
            console.warn('Unable to delete media object', error)
        }
    }
}

async function validateProfileImage(
    file: File | JsonProfileImage | null,
    label = 'Character profile image',
): Promise<
    | {
          contentType: string
          bytes: Uint8Array
      }
    | {
          error: string
          status: 400 | 413
      }
> {
    if (!file || (file instanceof File && file.size === 0)) {
        return {error: `${label} is required`, status: 400}
    }

    const profileImage = file instanceof File ? await readProfileImageFile(file) : readProfileImageDataUrl(file.data)

    if ('error' in profileImage) {
        return profileImage
    }

    const validation = validateProfileImagePayload(profileImage, label)

    if ('error' in validation) {
        return validation
    }

    return {
        contentType: profileImage.contentType,
        bytes: profileImage.bytes,
    }
}

async function readProfileImageFile(file: File): Promise<{
    contentType: string
    bytes: Uint8Array
}> {
    return {
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
    }
}

function readProfileImageDataUrl(value: string):
    | {
          contentType: string
          bytes: Uint8Array
      }
    | {
          error: string
          status: 400
      } {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(value)

    if (!match) {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }

    const [, contentType, encodedBytes] = match

    if (!contentType || !encodedBytes) {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }

    try {
        const binary = atob(encodedBytes)
        const bytes = new Uint8Array(binary.length)

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index)
        }

        return {
            contentType: contentType.toLowerCase(),
            bytes,
        }
    } catch {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }
}

function normalizePermanentConfirmation(value: unknown): boolean {
    return value === true || value === 'true' || value === 'on' || value === '1'
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() : null
}

function isDuplicateCharacterNameError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false
    }

    const message = error.message.toLowerCase()

    return (
        message.includes('unique') &&
        (message.includes('idx_characters_user_name_unique') ||
            (message.includes('characters.user_id') && message.includes('characters.name')))
    )
}

function normalizeMediaRating(value: unknown): 'sfw' | 'nsfw' | null {
    return value === 'sfw' || value === 'nsfw' ? value : null
}

function normalizeUploadIdentifier(value: unknown, label: string): {value: string} | {error: string} {
    if (typeof value !== 'string' || !value.trim()) {
        return {error: `${label} is required`}
    }

    const normalized = value.trim()

    if (normalized.length > 128 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
        return {error: `${label} is invalid`}
    }

    return {value: normalized}
}

function normalizeGalleryImageContentType(value: unknown): {contentType: string} | {error: string} {
    if (typeof value !== 'string') {
        return {error: 'Image content type is required'}
    }

    const contentType = value.trim().toLowerCase()

    if (!GALLERY_IMAGE_ALLOWED_CONTENT_TYPES.has(contentType)) {
        return {error: 'Image must be PNG, JPG, GIF, WebP, or AVIF'}
    }

    return {contentType}
}

function normalizeGalleryImageDimensions(
    widthValue: unknown,
    heightValue: unknown,
):
    | {
          width: number
          height: number
      }
    | {error: string} {
    const width = Number(widthValue)
    const height = Number(heightValue)

    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return {error: 'Image dimensions are required'}
    }

    return {width, height}
}

function parseChunkedUploadInits(value: unknown): {uploads: ChunkedUploadInit[]} | {error: string} {
    if (!Array.isArray(value)) {
        return {error: 'Upload ratings are required'}
    }

    const uploads: ChunkedUploadInit[] = []

    for (const item of value) {
        const rating = normalizeMediaRating(isRecord(item) ? item.rating : item)

        if (!rating) {
            return {error: 'Upload ratings must be sfw or nsfw'}
        }

        const contentType = normalizeGalleryImageContentType(isRecord(item) ? item.contentType : 'image/png')

        if ('error' in contentType) {
            return {error: contentType.error}
        }

        if (!uploads.some((upload) => upload.rating === rating)) {
            uploads.push({rating, contentType: contentType.contentType})
        }
    }

    if (uploads.length === 0) {
        return {error: 'At least one upload rating is required'}
    }

    return {uploads}
}

function parseCompletedChunkedUpload(value: unknown):
    | {
          uploadId: string
          imageKey: string
          contentType: string
          width: number
          height: number
          parts: R2UploadedPart[]
      }
    | {error: string}
    | null {
    if (value === undefined || value === null) {
        return null
    }

    if (!isRecord(value)) {
        return {error: 'upload is invalid'}
    }

    const uploadId = normalizeOptionalText(value.uploadId)
    const imageKey = normalizeUploadIdentifier(value.imageKey, 'Image key')
    const contentType = normalizeGalleryImageContentType(value.contentType)
    const dimensions = normalizeGalleryImageDimensions(value.width, value.height)

    if (!uploadId) {
        return {error: 'upload id is required'}
    }

    if ('error' in imageKey) {
        return {error: imageKey.error}
    }

    if ('error' in contentType) {
        return {error: contentType.error}
    }

    if ('error' in dimensions) {
        return {error: dimensions.error}
    }

    if (!Array.isArray(value.parts) || value.parts.length === 0) {
        return {error: 'uploaded parts are required'}
    }

    const parts: R2UploadedPart[] = []

    for (const part of value.parts) {
        if (!isRecord(part)) {
            return {error: 'uploaded part is invalid'}
        }

        const partNumber = Number(part.partNumber)
        const etag = normalizeOptionalText(part.etag)

        if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000 || !etag) {
            return {error: 'uploaded part is invalid'}
        }

        parts.push({partNumber, etag})
    }

    parts.sort((left, right) => left.partNumber - right.partNumber)

    return {
        uploadId,
        imageKey: imageKey.value,
        contentType: contentType.contentType,
        width: dimensions.width,
        height: dimensions.height,
        parts,
    }
}

function readGalleryImageDimensions(bytes: Uint8Array, contentType: string): {width: number; height: number} | null {
    if (contentType === 'image/png') {
        return getPngDimensions(bytes)
    }

    if (contentType === 'image/webp') {
        return getWebpDimensions(bytes)
    }

    if (contentType === 'image/gif') {
        return readGifDimensions(bytes)
    }

    if (contentType === 'image/jpeg') {
        return readJpegDimensions(bytes)
    }

    if (contentType === 'image/avif') {
        return readAvifDimensions(bytes)
    }

    return null
}

function readGifDimensions(bytes: Uint8Array): {width: number; height: number} | null {
    if (bytes.length < 10) {
        return null
    }

    const signature = String.fromCharCode(...bytes.slice(0, 6))

    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
        return null
    }

    return {
        width: byteAt(bytes, 6) | (byteAt(bytes, 7) << 8),
        height: byteAt(bytes, 8) | (byteAt(bytes, 9) << 8),
    }
}

function readJpegDimensions(bytes: Uint8Array): {width: number; height: number} | null {
    if (bytes.length < 4 || byteAt(bytes, 0) !== 0xff || byteAt(bytes, 1) !== 0xd8) {
        return null
    }

    let offset = 2

    while (offset + 9 < bytes.length) {
        if (byteAt(bytes, offset) !== 0xff) {
            return null
        }

        const marker = byteAt(bytes, offset + 1)
        offset += 2

        if (marker === 0xd9 || marker === 0xda) {
            return null
        }

        const length = (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1)

        if (length < 2 || offset + length > bytes.length) {
            return null
        }

        if (
            (marker >= 0xc0 && marker <= 0xc3) ||
            (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) ||
            (marker >= 0xcd && marker <= 0xcf)
        ) {
            return {
                height: (byteAt(bytes, offset + 3) << 8) | byteAt(bytes, offset + 4),
                width: (byteAt(bytes, offset + 5) << 8) | byteAt(bytes, offset + 6),
            }
        }

        offset += length
    }

    return null
}

function readAvifDimensions(bytes: Uint8Array): {width: number; height: number} | null {
    return findIsobmffImageSpatialExtents(bytes, 0, bytes.length, 0)
}

function findIsobmffImageSpatialExtents(
    bytes: Uint8Array,
    start: number,
    end: number,
    depth: number,
): {width: number; height: number} | null {
    if (depth > 8) {
        return null
    }

    let offset = start

    while (offset + 8 <= end) {
        const boxStart = offset
        let boxSize = readUint32Be(bytes, offset)
        const boxType = readAscii(bytes, offset + 4, 4)
        offset += 8

        if (boxSize === 1) {
            if (offset + 8 > end) {
                return null
            }

            const high = readUint32Be(bytes, offset)
            const low = readUint32Be(bytes, offset + 4)
            offset += 8

            if (high !== 0 || low > Number.MAX_SAFE_INTEGER) {
                return null
            }

            boxSize = low
        } else if (boxSize === 0) {
            boxSize = end - boxStart
        }

        if (boxSize < offset - boxStart || boxStart + boxSize > end) {
            return null
        }

        const boxEnd = boxStart + boxSize

        if (boxType === 'ispe') {
            if (offset + 12 > boxEnd) {
                return null
            }

            const width = readUint32Be(bytes, offset + 4)
            const height = readUint32Be(bytes, offset + 8)

            return width > 0 && height > 0 ? {width, height} : null
        }

        const childStart = boxType === 'meta' ? offset + 4 : offset

        if ((boxType === 'meta' || boxType === 'iprp' || boxType === 'ipco') && childStart < boxEnd) {
            const dimensions = findIsobmffImageSpatialExtents(bytes, childStart, boxEnd, depth + 1)

            if (dimensions) {
                return dimensions
            }
        }

        offset = boxEnd
    }

    return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let value = ''

    for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(byteAt(bytes, offset + index))
    }

    return value
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        byteAt(bytes, offset) * 0x1000000 +
        ((byteAt(bytes, offset + 1) << 16) >>> 0) +
        ((byteAt(bytes, offset + 2) << 8) >>> 0) +
        byteAt(bytes, offset + 3)
    )
}

function byteAt(bytes: Uint8Array, offset: number): number {
    const value = bytes[offset]

    if (value === undefined) {
        throw new Error(`Image byte offset out of range: ${offset}`)
    }

    return value
}

async function completeChunkedGalleryUpload(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    upload: CompletedChunkedUpload,
    rating: 'sfw' | 'nsfw',
    label: string,
): Promise<CompletedGalleryUpload> {
    const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, upload.imageKey, rating, upload.contentType)
    const multipartUpload = bucket.resumeMultipartUpload(objectKey, upload.uploadId)
    const completedObject = await multipartUpload.complete(upload.parts)

    if (completedObject.size <= 0) {
        await deleteR2Objects(bucket, [objectKey])
        throw new Error(`${label} is empty`)
    }

    if (completedObject.size > GALLERY_IMAGE_MAX_BYTES) {
        await deleteR2Objects(bucket, [objectKey])
        throw new Error(`${label} must be 200 MB or smaller`)
    }

    const dimensions = await readStoredGalleryImageDimensions(bucket, objectKey, upload.contentType)

    if (!dimensions) {
        await deleteR2Objects(bucket, [objectKey])
        throw new Error(`${label} dimensions could not be verified`)
    }

    if (dimensions.width !== upload.width || dimensions.height !== upload.height) {
        await deleteR2Objects(bucket, [objectKey])
        throw new Error(`${label} dimensions do not match the uploaded image`)
    }

    if (dimensions.width * dimensions.height > GALLERY_IMAGE_MAX_PIXELS) {
        await deleteR2Objects(bucket, [objectKey])
        throw new Error(`${label} must be ${GALLERY_IMAGE_MAX_PIXELS.toLocaleString('en-US')} pixels or smaller`)
    }

    return {
        imageKey: upload.imageKey,
        contentType: upload.contentType,
        width: dimensions.width,
        height: dimensions.height,
        byteSize: completedObject.size,
    }
}

async function readStoredGalleryImageDimensions(
    bucket: R2Bucket,
    objectKey: string,
    contentType: string,
): Promise<{width: number; height: number} | null> {
    const object = await bucket.get(objectKey, {
        range: {
            offset: 0,
            length: GALLERY_IMAGE_DIMENSION_PROBE_BYTES,
        },
    })

    if (!object) {
        return null
    }

    return readGalleryImageDimensions(new Uint8Array(await object.arrayBuffer()), contentType)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
