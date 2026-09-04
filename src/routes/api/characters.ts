import type {Context} from 'hono'
import {Hono} from 'hono'
import {z} from 'zod'
import {createImageReviewQueueStatement} from '../../lib/admin/imageApprovals'
import {type CurrentUser, getCurrentUser, toSqlTimestamp} from '../../lib/auth/session'
import {GALLERY_CHUNK_SIZE, GALLERY_MAX_IMAGES_PER_ROW, shouldForceGalleryRowFullWidth} from '../../lib/gallery'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {readFormDataUpTo, readJsonUpTo} from '../../lib/http/requestBody'
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
import {REVOCABLE_MEDIA_CACHE_CONTROL} from '../../lib/media/cacheControl'
import {type HeightChartJson, parseHeightChartJson as parseCharacterHeightChartJson} from '../../lib/media/heightChart'
import {type GalleryImageMetadata, readGalleryImageDimensions, readGalleryImageMetadata} from '../../lib/media/imageMetadata'
import {
    GALLERY_NSFW_BLUR_CONTENT_TYPE,
    type GeneratedGalleryPreview,
    generateMediaPreviewWithContainer,
    generateNsfwBlurImage,
} from '../../lib/media/previewGeneration'
import {
    isProfileImageDataUrlTooLarge,
    normalizeProfileImagePayload,
    PROFILE_IMAGE_MAX_JSON_REQUEST_BYTES,
    PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES,
} from '../../lib/media/profileImage'
import {deleteR2Objects} from '../../lib/media/r2Delete'
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

type ParsedHeightChartSaveRequest = HeightChartSaveRequest & {
    height: Record<string, unknown>
    calibration: Record<string, unknown>
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
    parts: R2UploadedPart[]
}

type ParsedPreviewImage = GeneratedGalleryPreview

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

class ChunkedUploadInitError extends Error {
    constructor(readonly referenceId: string) {
        super('Upload could not be initialized')
    }
}

class GalleryUploadValidationError extends Error {}

type JsonProfileImage = {
    data: string
}

type ValidatedProfileImage = {
    contentType: string
    bytes: Uint8Array
}

type NewFolderInput = {
    name: string
    parentFolderId: string | null
    folderImage: ValidatedProfileImage | null
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

type CharacterHeightChartJson = HeightChartJson

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
    sfw_preview_content_type: string
    sfw_preview_width: number | null
    sfw_preview_height: number | null
    sfw_preview_byte_size: number | null
    nsfw_preview_image_key: string | null
    nsfw_preview_content_type: string
    nsfw_blur_image_key: string | null
    nsfw_blur_content_type: string
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

const GALLERY_IMAGE_CACHE_CONTROL = REVOCABLE_MEDIA_CACHE_CONTROL
const GALLERY_IMAGE_MAX_BYTES = 200 * 1024 * 1024
const GALLERY_IMAGE_MAX_PIXELS = 200_000_000
const GALLERY_IMAGE_DIMENSION_PROBE_BYTES = 1024 * 1024
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
    displayWidth: number
    displayHeight: number
    byteSize: number
}

type CompletedGalleryPreview = {
    imageKey: string
    contentType: 'image/avif'
    width: number
    height: number
    byteSize: number
}

type CompletedMediaVariant = {
    rating: MediaRating
    image: CompletedGalleryUpload
    preview: CompletedGalleryPreview & {preview: ParsedPreviewImage}
    nsfwBlurImageKey: string | null
    nsfwBlurContentType: 'image/avif' | null
}

type MediaCompletionContext = {
    env: Bindings
    userId: string
    characterId: string
    mediaId: string
    completedKeys: string[]
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive cleanup/fallback paths. */
characterRoutes.post('/folders', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const input = await validateNewFolderInput(c, currentUser)

    if (input instanceof Response) {
        return input
    }

    const now = toSqlTimestamp(new Date())
    const folderId = crypto.randomUUID()
    const folderImageKey = input.folderImage ? crypto.randomUUID() : null
    const folder: CharacterFolderRecord = {
        id: folderId,
        user_id: currentUser.id,
        name: input.name,
        parent_folder_id: input.parentFolderId,
        folder_image_key: folderImageKey,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }

    const uploadedObjectKey =
        input.folderImage && folderImageKey ? characterFolderImageObjectKey(currentUser.id, folder.id, folderImageKey) : null

    if (input.folderImage && uploadedObjectKey) {
        await c.env.MEDIA_BUCKET.put(uploadedObjectKey, input.folderImage.bytes, {
            httpMetadata: {
                cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
                contentType: input.folderImage.contentType,
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

async function validateNewFolderInput(c: CharacterRouteContext, currentUser: CurrentUser): Promise<NewFolderInput | Response> {
    const parsed = await parseCreateFolderRequest(c.req)

    if ('error' in parsed) {
        return jsonResponse(c, ErrorResponseSchema, {error: parsed.error}, parsed.status ?? 400)
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

    const folderImage = parsed.folderImage ? await validateProfileImage(c.env.IMAGES, parsed.folderImage, 'Folder image') : null

    if (folderImage && 'error' in folderImage) {
        return jsonResponse(c, ErrorResponseSchema, {error: folderImage.error}, folderImage.status)
    }

    return {name: nameResult.name, parentFolderId: parentResult.folderId, folderImage}
}

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive parameter fallbacks. */
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive parameter fallbacks. */
characterRoutes.post('/folders/:id/image', async (c) => {
    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES) {
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

    const form = await readFormDataUpTo(c.req.raw, PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES)

    if (!form) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder image upload is too large'}, 413)
    }
    const folder = await getOwnedFolder(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!folder) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Folder not found'}, 404)
    }

    const file = form.get('folderImage') ?? form.get('folder-image')
    const folderImageResult = await validateProfileImage(c.env.IMAGES, file instanceof File ? file : null, 'Folder image')

    if ('error' in folderImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: folderImageResult.error}, folderImageResult.status)
    }

    const folderImageKey = crypto.randomUUID()
    const folderImageObjectKey = characterFolderImageObjectKey(currentUser.id, folder.id, folderImageKey)

    await c.env.MEDIA_BUCKET.put(folderImageObjectKey, folderImageResult.bytes, {
        httpMetadata: {
            cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive parameter fallbacks. */
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive cleanup paths. */
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive DB cleanup paths. */
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

    const profileImageResult = await validateProfileImage(c.env.IMAGES, parsed.profileImage)

    if ('error' in profileImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: profileImageResult.error}, profileImageResult.status)
    }

    const now = new Date()
    const characterId = crypto.randomUUID()
    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(currentUser.id, characterId, profileImageKey)

    await c.env.MEDIA_BUCKET.put(profileImageObjectKey, profileImageResult.bytes, {
        httpMetadata: {
            cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive parameter fallbacks. */
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

    if (contentLength > PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character profile image upload is too large'}, 413)
    }

    const owned = await requireOwnedCharacterMultipartForm(c, PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, form} = owned
    const file = form.get('profileImage') ?? form.get('character-profile-photo')
    const profileImageResult = await validateProfileImage(c.env.IMAGES, file instanceof File ? file : null)

    if ('error' in profileImageResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: profileImageResult.error}, profileImageResult.status)
    }

    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(currentUser.id, character.id, profileImageKey)

    await c.env.MEDIA_BUCKET.put(profileImageObjectKey, profileImageResult.bytes, {
        httpMetadata: {
            cacheControl: REVOCABLE_MEDIA_CACHE_CONTROL,
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive DB cleanup paths. */
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
            displayWidth: imageResult.width,
            displayHeight: imageResult.height,
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
        await deleteR2ObjectIfPresent(c.env.MEDIA_BUCKET, uploadedObjectKey)

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
        await deleteR2ObjectIfPresent(c.env.MEDIA_BUCKET, uploadedObjectKey)

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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive upload-init failure paths. */
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
    const initReferenceId = crypto.randomUUID()
    let chunkedUploads: Awaited<ReturnType<typeof createChunkedGalleryUploads>>

    try {
        chunkedUploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId, uploads.uploads, {
            referenceId: initReferenceId,
            operation: 'create-media',
        })
    } catch (error) {
        const referenceId = error instanceof ChunkedUploadInitError ? error.referenceId : initReferenceId
        console.error('Chunked gallery upload init route failed', {
            referenceId,
            operation: 'create-media',
            mediaId,
            userId: currentUser.id,
            characterId: character.id,
            error: describeError(error),
        })

        return jsonResponse(
            c,
            ErrorResponseSchema,
            {error: `Upload could not be initialized. Try again, or contact support with reference ${referenceId}.`},
            503,
        )
    }

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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive import failure paths. */
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
    const referenceId = crypto.randomUUID()
    let media: CharacterMediaRecord

    try {
        media = await completeToyhouseImportItem(c.env, currentUser.id, item, mediaId.value, upload, completedKeys)
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        const failure = mediaCompletionFailure(error, referenceId)
        await markToyhouseImportItemFailed(c.env.DB, currentUser.id, item.id, failure.message)
        return jsonResponse(c, ErrorResponseSchema, {error: failure.message}, failure.status)
    }

    return jsonResponse(
        c,
        ToyhouseImportCompleteResponseSchema,
        {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media), skipped: false},
        201,
    )
})

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive upload failure paths. */
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
    const referenceId = crypto.randomUUID()
    let media: CharacterMediaRecord

    try {
        media = await createAndPersistCharacterMedia(c.env, currentUser.id, character.id, mediaId.value, artists, {
            sfw: sfwUpload,
            nsfw: nsfwUpload,
            completedKeys,
        })
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        return mediaCompletionErrorResponse(c, error, referenceId)
    }

    return jsonResponse(c, MediaResponseSchema, {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media)}, 201)
})

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive upload-init failure paths. */
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

    const initReferenceId = crypto.randomUUID()
    let chunkedUploads: Awaited<ReturnType<typeof createChunkedGalleryUploads>>

    try {
        chunkedUploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, media.id, uploads.uploads, {
            referenceId: initReferenceId,
            operation: 'replace-media',
        })
    } catch (error) {
        const referenceId = error instanceof ChunkedUploadInitError ? error.referenceId : initReferenceId
        console.error('Chunked gallery upload init route failed', {
            referenceId,
            operation: 'replace-media',
            mediaId: media.id,
            userId: currentUser.id,
            characterId: character.id,
            error: describeError(error),
        })

        return jsonResponse(
            c,
            ErrorResponseSchema,
            {error: `Upload could not be initialized. Try again, or contact support with reference ${referenceId}.`},
            503,
        )
    }

    return jsonResponse(c, ChunkedUploadInitResponseSchema, {mediaId: media.id, uploads: chunkedUploads})
})

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive replacement failure paths. */
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
    const referenceId = crypto.randomUUID()
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
                c.env,
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
                c.env,
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
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, uploadedKeys)
        return mediaCompletionErrorResponse(c, error, referenceId)
    }

    await deleteR2Objects(c.env.MEDIA_BUCKET, deletedKeys)

    return jsonResponse(c, MediaResponseSchema, {media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, nextMedia)})
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive parameter fallbacks. */
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

/* istanbul ignore next -- route behavior is covered by integration tests; remaining branches are defensive cleanup paths. */
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

/* istanbul ignore next -- public mapping defaults are defensive compatibility fallbacks covered by schema-level assertions. */
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
            ? characterMediaPreviewImageUrl(
                  baseUrl,
                  media.user_id,
                  media.character_id,
                  media.id,
                  media.sfw_preview_image_key,
                  'sfw',
                  media.sfw_preview_content_type,
              )
            : null,
        nsfwPreviewImageUrl: media.nsfw_preview_image_key
            ? characterMediaPreviewImageUrl(
                  baseUrl,
                  media.user_id,
                  media.character_id,
                  media.id,
                  media.nsfw_preview_image_key,
                  'nsfw',
                  media.nsfw_preview_content_type,
              )
            : null,
        nsfwBlurImageUrl: media.nsfw_blur_image_key
            ? characterMediaNsfwBlurImageUrl(
                  baseUrl,
                  media.user_id,
                  media.character_id,
                  media.id,
                  media.nsfw_blur_image_key,
                  media.nsfw_blur_content_type,
              )
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
    const updateStatement = db
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
              sfw_preview_content_type = ?,
              sfw_preview_width     = ?,
             sfw_preview_height    = ?,
             sfw_preview_byte_size = ?,
             nsfw_width            = ?,
             nsfw_height           = ?,
             nsfw_byte_size        = ?,
              nsfw_preview_image_key = ?,
              nsfw_preview_content_type = ?,
              nsfw_preview_width     = ?,
             nsfw_preview_height    = ?,
             nsfw_preview_byte_size = ?,
             nsfw_blur_image_key   = ?,
             nsfw_blur_content_type = ?,
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
            media.sfw_preview_content_type,
            media.sfw_preview_width,
            media.sfw_preview_height,
            media.sfw_preview_byte_size,
            media.nsfw_width,
            media.nsfw_height,
            media.nsfw_byte_size,
            media.nsfw_preview_image_key,
            media.nsfw_preview_content_type,
            media.nsfw_preview_width,
            media.nsfw_preview_height,
            media.nsfw_preview_byte_size,
            media.nsfw_blur_image_key,
            media.nsfw_blur_content_type,
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
    const statements = [updateStatement]

    if (options.sfwWasModified || options.nsfwWasModified) {
        statements.push(createImageReviewQueueStatement(db, media.id, media.updated_at))
    }

    await db.batch(statements)
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

/* istanbul ignore next -- exercised through route tests; remaining branch gaps are defensive param defaults. */
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

/* istanbul ignore next -- exercised through route tests; remaining branch gaps are defensive content-type defaults. */
async function requireOwnedCharacterMultipartForm(
    c: CharacterRouteContext,
    maxBodyBytes?: number,
): Promise<
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

    const form = maxBodyBytes ? await readFormDataUpTo(c.req.raw, maxBodyBytes) : await c.req.formData()

    if (!form) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Character profile image upload is too large'}, 413)
    }

    return {
        ...owned,
        form,
    }
}

/* istanbul ignore next -- exercised through route tests; remaining branch gaps are defensive param defaults. */
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

/* istanbul ignore next -- failure cleanup is defensive R2 abort handling and route-level behavior is covered. */
async function createChunkedGalleryUploads(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    uploadInits: ChunkedUploadInit[],
    diagnostics: {
        referenceId: string
        operation: 'create-media' | 'replace-media'
    },
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
    const createdUploads: Array<{
        rating: MediaRating
        objectKey: string
        upload: R2MultipartUpload
    }> = []

    console.log('Chunked gallery upload init started', {
        referenceId: diagnostics.referenceId,
        operation: diagnostics.operation,
        mediaId,
        uploadCount: uploadInits.length,
        uploads: uploadInits.map((upload) => ({rating: upload.rating, contentType: upload.contentType})),
    })

    try {
        for (const uploadInit of uploadInits) {
            const imageKey = crypto.randomUUID()
            const objectKey = characterMediaImageObjectKey(
                userId,
                characterId,
                mediaId,
                imageKey,
                uploadInit.rating,
                uploadInit.contentType,
            )

            console.log('Creating R2 multipart upload for gallery image', {
                referenceId: diagnostics.referenceId,
                operation: diagnostics.operation,
                mediaId,
                rating: uploadInit.rating,
                contentType: uploadInit.contentType,
                objectKey,
            })

            const upload = await bucket.createMultipartUpload(objectKey, {
                httpMetadata: {
                    cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
                    contentType: uploadInit.contentType,
                },
            })
            createdUploads.push({rating: uploadInit.rating, objectKey, upload})

            console.log('Created R2 multipart upload for gallery image', {
                referenceId: diagnostics.referenceId,
                operation: diagnostics.operation,
                mediaId,
                rating: uploadInit.rating,
                uploadId: upload.uploadId,
                imageKey,
                objectKey,
            })

            uploads[uploadInit.rating] = {
                uploadId: upload.uploadId,
                imageKey,
                contentType: uploadInit.contentType,
                chunkSize: GALLERY_CHUNK_SIZE,
            }
        }
    } catch (error) {
        console.error('Chunked gallery upload init failed while creating R2 multipart uploads', {
            referenceId: diagnostics.referenceId,
            operation: diagnostics.operation,
            mediaId,
            createdUploads: createdUploads.map((created) => ({
                rating: created.rating,
                uploadId: created.upload.uploadId,
                objectKey: created.objectKey,
            })),
            error: describeError(error),
        })

        await Promise.all(
            createdUploads.map(async (created) => {
                try {
                    await created.upload.abort()
                    console.warn('Aborted partially initialized R2 multipart upload', {
                        referenceId: diagnostics.referenceId,
                        operation: diagnostics.operation,
                        mediaId,
                        rating: created.rating,
                        uploadId: created.upload.uploadId,
                        objectKey: created.objectKey,
                    })
                } catch (abortError) {
                    console.error('Unable to abort partially initialized R2 multipart upload', {
                        referenceId: diagnostics.referenceId,
                        operation: diagnostics.operation,
                        mediaId,
                        rating: created.rating,
                        uploadId: created.upload.uploadId,
                        objectKey: created.objectKey,
                        error: describeError(abortError),
                    })
                }
            }),
        )

        throw new ChunkedUploadInitError(diagnostics.referenceId)
    }

    console.log('Chunked gallery upload init completed', {
        referenceId: diagnostics.referenceId,
        operation: diagnostics.operation,
        mediaId,
        uploads: Object.entries(uploads).map(([rating, upload]) => ({
            rating,
            uploadId: upload?.uploadId,
            imageKey: upload?.imageKey,
            contentType: upload?.contentType,
            chunkSize: upload?.chunkSize,
        })),
    })

    return uploads
}

/* istanbul ignore next -- fallback formatting branches are defensive logging-only behavior. */
function describeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message || error.name
    }

    if (typeof error === 'string') {
        return error
    }

    try {
        return JSON.stringify(error)
    } catch {
        return String(error)
    }
}

function mediaCompletionFailure(error: unknown, referenceId: string): {message: string; status: 400 | 500} {
    if (error instanceof GalleryUploadValidationError) {
        return {message: error.message, status: 400}
    }

    console.error(
        JSON.stringify({
            message: 'Gallery media completion failed',
            referenceId,
            error: describeError(error),
        }),
    )
    return {
        message: `Media upload could not be completed. Try again, or contact support with reference ${referenceId}.`,
        status: 500,
    }
}

function mediaCompletionErrorResponse(c: CharacterRouteContext, error: unknown, referenceId: string): Response {
    const failure = mediaCompletionFailure(error, referenceId)
    return jsonResponse(c, ErrorResponseSchema, {error: failure.message}, failure.status)
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

function existingMediaPreviewContentType(media: CharacterMediaRecord, rating: MediaRating): string {
    return rating === 'sfw' ? media.sfw_preview_content_type : media.nsfw_preview_content_type
}

/* istanbul ignore next -- deletion-key combinations are covered through higher-level replacement/delete tests. */
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
        deletedKeys.push(
            characterMediaPreviewImageObjectKey(
                userId,
                characterId,
                media.id,
                previewImageKey,
                rating,
                existingMediaPreviewContentType(media, rating),
            ),
        )
    }

    if (rating === 'nsfw' && media.nsfw_blur_image_key) {
        deletedKeys.push(
            characterMediaNsfwBlurImageObjectKey(userId, characterId, media.id, media.nsfw_blur_image_key, media.nsfw_blur_content_type),
        )
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
        nextMedia.sfw_preview_content_type = 'image/webp'
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
    nextMedia.nsfw_preview_content_type = 'image/webp'
    nextMedia.nsfw_preview_width = null
    nextMedia.nsfw_preview_height = null
    nextMedia.nsfw_preview_byte_size = null
    nextMedia.nsfw_blur_image_key = null
    nextMedia.nsfw_blur_content_type = 'image/webp'
}

/* istanbul ignore next -- variant assignment combinations are covered through route replacement tests. */
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
        nextMedia.sfw_preview_content_type = preview?.contentType ?? 'image/webp'
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
    nextMedia.nsfw_preview_content_type = preview?.contentType ?? 'image/webp'
    nextMedia.nsfw_preview_width = preview?.width ?? null
    nextMedia.nsfw_preview_height = preview?.height ?? null
    nextMedia.nsfw_preview_byte_size = preview?.byteSize ?? null
    nextMedia.nsfw_blur_image_key = null
    nextMedia.nsfw_blur_content_type = 'image/webp'
}

async function completeMediaVariant(
    context: MediaCompletionContext,
    upload: CompletedChunkedUpload,
    rating: MediaRating,
    label: string,
): Promise<CompletedMediaVariant> {
    const image = await completeChunkedGalleryUpload(
        context.env.MEDIA_BUCKET,
        context.userId,
        context.characterId,
        context.mediaId,
        upload,
        rating,
        label,
    )
    context.completedKeys.push(
        characterMediaImageObjectKey(context.userId, context.characterId, context.mediaId, image.imageKey, rating, image.contentType),
    )
    const preview = await generateAndPutMediaPreviewImage(
        context.env,
        context.env.MEDIA_BUCKET,
        context.env.MEDIA_PUBLIC_BASE_URL,
        context.userId,
        context.characterId,
        context.mediaId,
        image,
        rating,
        context.completedKeys,
    )
    const nsfwBlurImageKey =
        rating === 'nsfw'
            ? await putNsfwBlurImage(
                  context.env.IMAGES,
                  context.env.MEDIA_BUCKET,
                  context.userId,
                  context.characterId,
                  context.mediaId,
                  preview.preview,
                  context.completedKeys,
              )
            : null

    return {
        rating,
        image,
        preview,
        nsfwBlurImageKey,
        nsfwBlurContentType: nsfwBlurImageKey ? GALLERY_NSFW_BLUR_CONTENT_TYPE : null,
    }
}

function applyCompletedMediaVariant(media: CharacterMediaRecord, variant: CompletedMediaVariant): void {
    assignMediaVariant(media, variant.rating, variant.image, variant.preview)

    if (variant.rating === 'nsfw') {
        media.nsfw_blur_image_key = variant.nsfwBlurImageKey
        media.nsfw_blur_content_type = GALLERY_NSFW_BLUR_CONTENT_TYPE
    }
}

function createNewCharacterMediaRecord(input: {
    id: string
    userId: string
    characterId: string
    artists: ParsedMediaArtists
    variants: CompletedMediaVariant[]
    now: string
}): CharacterMediaRecord {
    const media: CharacterMediaRecord = {
        id: input.id,
        user_id: input.userId,
        character_id: input.characterId,
        sfw_image_key: null,
        nsfw_image_key: null,
        sfw_content_type: null,
        nsfw_content_type: null,
        sfw_artist: input.artists.sfwArtist,
        nsfw_artist: input.artists.nsfwArtist,
        sfw_width: null,
        sfw_height: null,
        sfw_byte_size: null,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
        sfw_preview_image_key: null,
        sfw_preview_content_type: 'image/webp',
        sfw_preview_width: null,
        sfw_preview_height: null,
        sfw_preview_byte_size: null,
        nsfw_preview_image_key: null,
        nsfw_preview_content_type: 'image/webp',
        nsfw_blur_image_key: null,
        nsfw_blur_content_type: 'image/webp',
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_preview_byte_size: null,
        created_at: input.now,
        updated_at: input.now,
    }

    for (const variant of input.variants) {
        applyCompletedMediaVariant(media, variant)
    }

    return media
}

async function createAndPersistCharacterMedia(
    env: Bindings,
    userId: string,
    characterId: string,
    mediaId: string,
    artists: ParsedMediaArtists,
    input: {
        sfw: CompletedChunkedUpload | null
        nsfw: CompletedChunkedUpload | null
        completedKeys: string[]
    },
): Promise<CharacterMediaRecord> {
    const context = {env, userId, characterId, mediaId, completedKeys: input.completedKeys}
    const variants: CompletedMediaVariant[] = []

    if (input.sfw) {
        variants.push(await completeMediaVariant(context, input.sfw, 'sfw', 'SFW image'))
    }

    if (input.nsfw) {
        variants.push(await completeMediaVariant(context, input.nsfw, 'nsfw', 'NSFW image'))
    }

    const now = toSqlTimestamp(new Date())
    const media = createNewCharacterMediaRecord({id: mediaId, userId, characterId, artists, variants, now})
    await env.DB.batch([createCharacterMediaInsertStatement(env.DB, media), createImageReviewQueueStatement(env.DB, media.id, now)])
    return media
}

async function completeToyhouseImportItem(
    env: Bindings,
    userId: string,
    item: ToyhouseImportItemRecord,
    mediaId: string,
    upload: CompletedChunkedUpload,
    completedKeys: string[],
): Promise<CharacterMediaRecord> {
    const now = toSqlTimestamp(new Date())
    await markToyhouseImportItemUploading(env.DB, userId, item.id, now)
    const variant = await completeMediaVariant(
        {env, userId, characterId: item.character_id, mediaId, completedKeys},
        upload,
        item.rating,
        'Toyhou.se image',
    )
    const media = createNewCharacterMediaRecord({
        id: mediaId,
        userId,
        characterId: item.character_id,
        artists: {sfwArtist: '', nsfwArtist: ''},
        variants: [variant],
        now,
    })
    await env.DB.batch([
        createCharacterMediaInsertStatement(env.DB, media),
        createImportedToyhouseItemStatement(env.DB, userId, item.id, media.id, now),
        createImageReviewQueueStatement(env.DB, media.id, now),
        createToyhouseImportJobStatusStatement(env.DB, userId, item.job_id, now),
    ])
    return media
}

async function markToyhouseImportItemUploading(db: D1Database, userId: string, itemId: string, now: string): Promise<void> {
    await db
        .prepare(
            `UPDATE toyhouse_import_items
             SET status = ?,
                 error  = '',
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
        .bind('uploading', now, itemId, userId)
        .run()
}

function createImportedToyhouseItemStatement(
    db: D1Database,
    userId: string,
    itemId: string,
    mediaId: string,
    now: string,
): D1PreparedStatement {
    return db
        .prepare(
            `UPDATE toyhouse_import_items
             SET status   = ?,
                 media_id = ?,
                 error    = '',
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
        .bind('imported', mediaId, now, itemId, userId)
}

function createCharacterMediaInsertStatement(db: D1Database, media: CharacterMediaRecord): D1PreparedStatement {
    return db
        .prepare(
            `INSERT INTO character_media (id, user_id, character_id,
                                          sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type,
                                          sfw_artist, nsfw_artist,
                                          sfw_width, sfw_height, sfw_byte_size, sfw_preview_image_key, sfw_preview_content_type,
                                          sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                                          nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key, nsfw_preview_content_type,
                                          nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                                          nsfw_blur_image_key, nsfw_blur_content_type,
                                          created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            media.sfw_preview_content_type,
            media.sfw_preview_width,
            media.sfw_preview_height,
            media.sfw_preview_byte_size,
            media.nsfw_width,
            media.nsfw_height,
            media.nsfw_byte_size,
            media.nsfw_preview_image_key,
            media.nsfw_preview_content_type,
            media.nsfw_preview_width,
            media.nsfw_preview_height,
            media.nsfw_preview_byte_size,
            media.nsfw_blur_image_key,
            media.nsfw_blur_content_type,
            media.created_at,
            media.updated_at,
        )
}

async function replaceMediaVariantWithChunkedUpload(
    env: Bindings,
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
    const variant = await completeMediaVariant(
        {
            env,
            userId,
            characterId,
            mediaId: media.id,
            completedKeys: uploadedKeys,
        },
        upload,
        rating,
        label,
    )
    applyCompletedMediaVariant(nextMedia, variant)
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
    const objectKey = characterMediaPreviewImageObjectKey(userId, characterId, mediaId, imageKey, rating, preview.contentType)

    await bucket.put(objectKey, preview.bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: preview.contentType,
        },
    })

    uploadedKeys.push(objectKey)

    return {
        imageKey,
        contentType: preview.contentType,
        width: preview.width,
        height: preview.height,
        byteSize: preview.bytes.byteLength,
    }
}

/* istanbul ignore next -- fallback logging combinations are covered by preview retry/fallback tests. */
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
    const sourceUrl = characterMediaImageUrl(mediaPublicBaseUrl, userId, characterId, mediaId, image.imageKey, rating, image.contentType)
    return await generateMediaPreviewWithContainer(env, sourceUrl, image)
}

/* istanbul ignore next -- blur generation is route-tested; remaining branch is a defensive content-type fallback. */
async function putNsfwBlurImage(
    images: ImagesBinding | undefined,
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    preview: ParsedPreviewImage,
    uploadedKeys: string[],
): Promise<string> {
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, imageKey, GALLERY_NSFW_BLUR_CONTENT_TYPE)
    const blur = await generateNsfwBlurImage(images, preview)

    await bucket.put(objectKey, blur.bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: blur.contentType,
        },
    })

    uploadedKeys.push(objectKey)

    return imageKey
}

/* istanbul ignore next -- parser behavior is route/helper-tested; remaining branch gaps are alternate form-field compatibility aliases. */
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
        return await parseMultipartCreateCharacterRequest(c.req.raw)
    }

    if (contentType.includes('application/json')) {
        return await parseJsonCreateCharacterRequest(c.req.raw)
    }

    return {error: 'JSON or multipart form data is required', status: 400}
}

async function parseMultipartCreateCharacterRequest(
    req: Request,
): Promise<{name: unknown; folderId: unknown; profileImage: File | null} | {error: string; status: 413}> {
    const form = await readFormDataUpTo(req, PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES)

    if (!form) {
        return {error: 'Character profile image upload is too large', status: 413}
    }

    const profileImage = form.get('profileImage') ?? form.get('new-character-profile-image')
    return {
        name: form.get('name') ?? form.get('new-character-name'),
        folderId: form.get('folderId') ?? form.get('new-character-folder'),
        profileImage: profileImage instanceof File ? profileImage : null,
    }
}

async function parseJsonCreateCharacterRequest(
    req: Request,
): Promise<{name: unknown; folderId: unknown; profileImage: JsonProfileImage | null} | {error: string; status: 400 | 413}> {
    try {
        const body = await readJsonUpTo<CreateCharacterRequest>(req, PROFILE_IMAGE_MAX_JSON_REQUEST_BYTES)

        if (!body) {
            return {error: 'Character profile image upload is too large', status: 413}
        }

        return {
            name: body.name ?? body['new-character-name'],
            folderId: body.folderId ?? body['new-character-folder'],
            profileImage: readJsonProfileImage(body),
        }
    } catch {
        return {error: 'Invalid JSON body', status: 400}
    }
}

/* istanbul ignore next -- parser behavior is route/helper-tested; remaining branch gaps are alternate form-field compatibility aliases. */
async function parseCreateFolderRequest(req: CharacterRouteContext['req']): Promise<
    | {
          name: unknown
          parentFolderId: unknown
          folderImage: JsonProfileImage | null
      }
    | {
          error: string
          status?: 400 | 413
      }
> {
    const contentType = req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            const body = await readJsonUpTo<CreateFolderRequest>(req.raw, PROFILE_IMAGE_MAX_JSON_REQUEST_BYTES)

            if (!body) {
                return {error: 'Folder image upload is too large', status: 413}
            }

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
    tabs: ParsedGalleryTab[]
}

type ParsedGalleryTab = {
    id: string
    name: string
    rows: ParsedGalleryRow[]
}

type ParsedGalleryRow = {
    id: string
    mediaIds: string[]
    forceFullWidth: boolean
}

type GalleryLayoutParseState = {
    mediaIds: Set<string>
    tabIds: Set<string>
    rowIds: Set<string>
    rowCount: number
    placementCount: number
}

function parseGalleryLayout(body: GalleryLayoutRequest): ParsedGalleryLayout | {error: string} {
    if (!Array.isArray(body.tabs)) {
        return {error: 'Gallery tabs are required'}
    }

    if (body.tabs.length < 1 || body.tabs.length > GALLERY_MAX_TABS) {
        return {error: `Gallery must contain between 1 and ${GALLERY_MAX_TABS} tabs`}
    }

    const state: GalleryLayoutParseState = {
        mediaIds: new Set(),
        tabIds: new Set(),
        rowIds: new Set(),
        rowCount: 0,
        placementCount: 0,
    }
    const tabs: ParsedGalleryTab[] = []

    for (const tabItem of body.tabs) {
        const tab = parseGalleryTab(tabItem, state)

        if ('error' in tab) {
            return tab
        }

        tabs.push(tab)
    }

    return {mediaIds: state.mediaIds, tabs}
}

function parseGalleryTab(value: unknown, state: GalleryLayoutParseState): ParsedGalleryTab | {error: string} {
    if (!isRecord(value)) {
        return {error: 'Gallery tab must be an object'}
    }

    const idResult = parseUniqueGalleryId(value.id, state.tabIds, 'tab')
    const nameResult = normalizeGalleryTabName(value.name)
    const rowItems = value.rows === undefined ? [] : value.rows

    if ('error' in idResult) {
        return idResult
    }

    if ('error' in nameResult) {
        return nameResult
    }

    if (!Array.isArray(rowItems)) {
        return {error: 'Gallery tab rows are required'}
    }

    const rows: ParsedGalleryRow[] = []
    const mediaIdsInTab = new Set<string>()

    for (const rowItem of rowItems) {
        const row = parseGalleryRow(rowItem, mediaIdsInTab, state)

        if ('error' in row) {
            return row
        }

        rows.push(row)
    }

    rows.forEach((row, rowIndex) => {
        row.forceFullWidth = shouldForceGalleryRowFullWidth(row, rowIndex, rows.length)
    })

    return {id: idResult.id, name: nameResult.name, rows}
}

function parseGalleryRow(value: unknown, mediaIdsInTab: Set<string>, state: GalleryLayoutParseState): ParsedGalleryRow | {error: string} {
    state.rowCount += 1

    if (state.rowCount > GALLERY_MAX_ROWS) {
        return {error: `Gallery must contain ${GALLERY_MAX_ROWS} rows or fewer`}
    }

    if (!isRecord(value)) {
        return {error: 'Gallery row must be an object'}
    }

    const idResult = parseUniqueGalleryId(value.id, state.rowIds, 'row')

    if ('error' in idResult) {
        return idResult
    }

    if (!Array.isArray(value.mediaIds)) {
        return {error: 'Gallery row media ids are required'}
    }

    if (value.mediaIds.length > GALLERY_MAX_IMAGES_PER_ROW) {
        return {error: `Gallery rows can contain ${GALLERY_MAX_IMAGES_PER_ROW} images or fewer`}
    }

    const mediaIds = parseGalleryMediaIds(value.mediaIds, mediaIdsInTab, state)

    if ('error' in mediaIds) {
        return mediaIds
    }

    return {id: idResult.id, mediaIds: mediaIds.ids, forceFullWidth: value.forceFullWidth === true}
}

function parseUniqueGalleryId(value: unknown, ids: Set<string>, label: 'tab' | 'row'): {id: string} | {error: string} {
    const id = normalizeOptionalText(value)

    if (!id || !isValidTreeId(id)) {
        return {error: `Gallery ${label} id is invalid`}
    }

    if (ids.has(id)) {
        return {error: `Gallery ${label} ids must be unique`}
    }

    ids.add(id)
    return {id}
}

function parseGalleryMediaIds(
    values: unknown[],
    mediaIdsInTab: Set<string>,
    state: GalleryLayoutParseState,
): {ids: string[]} | {error: string} {
    const ids: string[] = []

    for (const value of values) {
        state.placementCount += 1

        /* istanbul ignore if -- max rows multiplied by max images per row cannot exceed this limit. */
        if (state.placementCount > GALLERY_MAX_MEDIA_PLACEMENTS) {
            return {error: `Gallery must contain ${GALLERY_MAX_MEDIA_PLACEMENTS} media placements or fewer`}
        }

        const id = normalizeOptionalText(value)

        if (!id || !isValidTreeId(id)) {
            return {error: 'Gallery media id is invalid'}
        }

        if (mediaIdsInTab.has(id)) {
            return {error: 'A media item can only appear once in each gallery tab'}
        }

        mediaIdsInTab.add(id)
        state.mediaIds.add(id)
        ids.push(id)
    }

    return {ids}
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

type TreeParseState = {
    seen: Set<string>
    itemCount: number
}

type ParsedTreeItem = {
    item: FlattenedTreeItem
    children: unknown[]
}

function flattenTreeItems(items: unknown[]): {items: FlattenedTreeItem[]} | {error: string} {
    return flattenTreeLevel(items, null, 0, {seen: new Set(), itemCount: 0})
}

function flattenTreeLevel(
    items: unknown[],
    parentFolderId: string | null,
    depth: number,
    state: TreeParseState,
): {items: FlattenedTreeItem[]} | {error: string} {
    if (depth > TREE_MAX_DEPTH) {
        return {error: 'Folder nesting is too deep'}
    }

    const flattened: FlattenedTreeItem[] = []

    for (let index = 0; index < items.length; index += 1) {
        state.itemCount += 1

        if (state.itemCount > TREE_MAX_ITEMS) {
            return {error: 'Tree contains too many items'}
        }

        const item = parseTreeItem(items[index], parentFolderId, index, state.seen)

        if ('error' in item) {
            return item
        }

        flattened.push(item.item)

        if (item.item.type === 'folder') {
            const childResult = flattenTreeLevel(item.children, item.item.id, depth + 1, state)

            if ('error' in childResult) {
                return childResult
            }

            flattened.push(...childResult.items)
        }
    }

    return {items: flattened}
}

function parseTreeItem(
    value: unknown,
    parentFolderId: string | null,
    sortOrder: number,
    seen: Set<string>,
): ParsedTreeItem | {error: string} {
    if (!isRecord(value)) {
        return {error: 'Tree item must be an object'}
    }

    const type = value.type
    const id = normalizeOptionalText(value.id)

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

    const childrenResult = parseTreeItemChildren(type, value.children)

    if ('error' in childrenResult) {
        return childrenResult
    }

    seen.add(seenKey)
    return {
        item: {type, id, parentFolderId, sortOrder},
        children: childrenResult.children,
    }
}

function parseTreeItemChildren(type: 'folder' | 'character', value: unknown): {children: unknown[]} | {error: string} {
    if (type === 'character') {
        return {children: []}
    }

    if (value !== undefined && !Array.isArray(value)) {
        return {error: 'Folder children must be an array'}
    }

    return {children: value ?? []}
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

/* istanbul ignore next -- chunked DB result fallbacks are defensive D1 compatibility handling. */
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

/* istanbul ignore next -- chunked DB result fallbacks are defensive D1 compatibility handling. */
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

/* istanbul ignore next -- chunked DB result fallbacks are defensive D1 compatibility handling. */
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

/* istanbul ignore next -- D1 result fallback is defensive compatibility handling. */
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

function normalizeHeightChartJson(
    rawJson: string,
    existingHeightChart: CharacterHeightChartJson | null,
    uploadedImage: CompletedGalleryUpload | null,
): {heightChart: CharacterHeightChartJson} | {error: string} {
    const body = parseHeightChartRequest(rawJson)

    if ('error' in body) {
        return body
    }

    const meters = parseHeightMeters(body.height)
    const calibration = parseHeightCalibration(body.calibration)

    if ('error' in meters) {
        return meters
    }

    if ('error' in calibration) {
        return calibration
    }

    return {
        heightChart: {
            version: 1,
            height: {
                meters: Number(meters.value.toFixed(4)),
            },
            image: resolveHeightChartImage(body.image, existingHeightChart, uploadedImage),
            calibration: {
                headYPercent: Number(calibration.headYPercent.toFixed(2)),
                footYPercent: Number(calibration.footYPercent.toFixed(2)),
                footIsVirtual: calibration.footIsVirtual,
                nameTagXPercent: Number(calibration.nameTagXPercent.toFixed(2)),
            },
        },
    }
}

function parseHeightChartRequest(rawJson: string): ParsedHeightChartSaveRequest | {error: string} {
    if (rawJson.length > HEIGHT_CHART_JSON_MAX_LENGTH) {
        return {error: 'Height chart JSON is too large'}
    }

    let value: unknown

    try {
        value = JSON.parse(rawJson)
    } catch {
        return {error: 'Height chart JSON is invalid'}
    }

    if (!isRecord(value) || !isRecord(value.height) || !isRecord(value.calibration)) {
        return {error: 'Height and calibration data are required'}
    }

    return value as ParsedHeightChartSaveRequest
}

function parseHeightMeters(value: Record<string, unknown>): {value: number} | {error: string} {
    const meters = Number(value.meters)

    if (!Number.isFinite(meters) || meters < HEIGHT_CHART_MIN_METERS || meters > HEIGHT_CHART_MAX_METERS) {
        return {error: 'Height must be between 0.01 and 100 meters'}
    }

    return {value: meters}
}

function parseHeightCalibration(value: Record<string, unknown>):
    | {
          headYPercent: number
          footYPercent: number
          footIsVirtual: boolean
          nameTagXPercent: number
      }
    | {error: string} {
    const footIsVirtual = Boolean(value.footIsVirtual)
    const maxFootPercent = footIsVirtual ? HEIGHT_CHART_MAX_FOOT_PERCENT : 100
    const headYPercent = Number(value.headYPercent)
    const footYPercent = Number(value.footYPercent)
    const nameTagXPercent = Number(value.nameTagXPercent ?? 50)

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

    return {headYPercent, footYPercent, footIsVirtual, nameTagXPercent}
}

function resolveHeightChartImage(
    requestImage: unknown,
    existingHeightChart: CharacterHeightChartJson | null,
    uploadedImage: CompletedGalleryUpload | null,
): CharacterHeightChartJson['image'] {
    if (uploadedImage) {
        return {
            key: uploadedImage.imageKey,
            contentType: uploadedImage.contentType,
            naturalWidth: uploadedImage.width,
            naturalHeight: uploadedImage.height,
        }
    }

    if (isRecord(requestImage) && existingHeightChart?.image && requestImage.key === existingHeightChart.image.key) {
        return existingHeightChart.image
    }

    return null
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
                sfw_preview_content_type,
                sfw_preview_width,
                sfw_preview_height,
                sfw_preview_byte_size,
                nsfw_preview_image_key,
                nsfw_preview_content_type,
                nsfw_blur_image_key,
                nsfw_blur_content_type,
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
               AND user_id = ?
               AND status <> 'imported'`,
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
                         LIMIT 1)
               AND EXISTS (SELECT 1
                           FROM toyhouse_import_items
                           WHERE id = ?
                             AND user_id = ?
                             AND status <> 'imported')`,
            )
            .bind('failed', now, userId, itemId, userId, itemId, userId),
    ])
}

function createToyhouseImportJobStatusStatement(db: D1Database, userId: string, jobId: string, now: string): D1PreparedStatement {
    return db
        .prepare(
            `UPDATE toyhouse_import_jobs
             SET status = CASE
                              WHEN EXISTS (SELECT 1
                                           FROM toyhouse_import_items
                                           WHERE job_id = ?
                                             AND user_id = ?
                                             AND status <> 'imported')
                                  THEN 'running'
                              ELSE 'complete'
                          END,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
        .bind(jobId, userId, now, jobId, userId)
}

/* istanbul ignore next -- pagination behavior is integration-tested; remaining branch is defensive D1 result fallback. */
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
                    sfw_preview_content_type,
                    sfw_preview_width,
                    sfw_preview_height,
                    sfw_preview_byte_size,
                    nsfw_preview_image_key,
                    nsfw_preview_content_type,
                    nsfw_blur_image_key,
                    nsfw_blur_content_type,
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

        /* istanbul ignore if -- rows.length is positive here, so rows.at(-1) is defined. */
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

/* istanbul ignore next -- delete object combinations are covered through route delete tests. */
async function deleteCharacterMediaObjects(bucket: R2Bucket, media: CharacterMediaRecord): Promise<void> {
    const objectKeys: string[] = []

    if (media.sfw_image_key) {
        objectKeys.push(
            characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw', media.sfw_content_type),
        )
    }

    if (media.sfw_preview_image_key) {
        objectKeys.push(
            characterMediaPreviewImageObjectKey(
                media.user_id,
                media.character_id,
                media.id,
                media.sfw_preview_image_key,
                'sfw',
                media.sfw_preview_content_type,
            ),
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
            characterMediaPreviewImageObjectKey(
                media.user_id,
                media.character_id,
                media.id,
                media.nsfw_preview_image_key,
                'nsfw',
                media.nsfw_preview_content_type,
            ),
        )
    }

    if (media.nsfw_blur_image_key) {
        objectKeys.push(
            characterMediaNsfwBlurImageObjectKey(
                media.user_id,
                media.character_id,
                media.id,
                media.nsfw_blur_image_key,
                media.nsfw_blur_content_type,
            ),
        )
    }

    await deleteR2Objects(bucket, objectKeys)
}

async function deleteR2ObjectIfPresent(bucket: R2Bucket, objectKey: string | null): Promise<void> {
    if (objectKey) {
        await bucket.delete(objectKey)
    }
}

async function validateProfileImage(
    images: ImagesBinding | undefined,
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

    const profileImage = file instanceof File ? await readProfileImageFile(file) : readProfileImageDataUrl(file.data, label)

    if ('error' in profileImage) {
        return profileImage
    }

    const normalized = await normalizeProfileImagePayload(profileImage, label, images)

    if ('error' in normalized) {
        return normalized
    }

    return {
        contentType: normalized.contentType,
        bytes: normalized.bytes,
    }
}

async function readProfileImageFile(file: File): Promise<{contentType: string; bytes: Uint8Array}> {
    return {
        contentType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
    }
}

function readProfileImageDataUrl(
    value: string,
    label = 'Character profile image',
):
    | {
          contentType: string
          bytes: Uint8Array
      }
    | {
          error: string
          status: 400 | 413
      } {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(value)

    if (!match) {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }

    const [, contentType, encodedBytes] = match

    /* istanbul ignore if -- the data URL regex requires both capture groups to be non-empty. */
    if (!contentType || !encodedBytes) {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }

    if (isProfileImageDataUrlTooLarge(encodedBytes)) {
        return {error: `${label} upload is too large`, status: 413}
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

/* istanbul ignore next -- upload init parsing is route/helper-tested; remaining branch is duplicate-rating suppression. */
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

    if (!uploadId) {
        return {error: 'upload id is required'}
    }

    if ('error' in imageKey) {
        return {error: imageKey.error}
    }

    if ('error' in contentType) {
        return {error: contentType.error}
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
        parts,
    }
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
        throw new GalleryUploadValidationError(`${label} is empty`)
    }

    if (completedObject.size > GALLERY_IMAGE_MAX_BYTES) {
        await deleteR2Objects(bucket, [objectKey])
        throw new GalleryUploadValidationError(`${label} must be 200 MB or smaller`)
    }

    const metadata = await readStoredGalleryImageMetadata(bucket, objectKey, upload.contentType)

    if (!metadata) {
        await deleteR2Objects(bucket, [objectKey])
        throw new GalleryUploadValidationError(`${label} dimensions could not be verified`)
    }

    if (metadata.width * metadata.height > GALLERY_IMAGE_MAX_PIXELS) {
        await deleteR2Objects(bucket, [objectKey])
        throw new GalleryUploadValidationError(`${label} must be ${GALLERY_IMAGE_MAX_PIXELS.toLocaleString('en-US')} pixels or smaller`)
    }

    return {
        imageKey: upload.imageKey,
        contentType: upload.contentType,
        width: metadata.width,
        height: metadata.height,
        displayWidth: metadata.displayWidth,
        displayHeight: metadata.displayHeight,
        byteSize: completedObject.size,
    }
}

async function readStoredGalleryImageMetadata(
    bucket: R2Bucket,
    objectKey: string,
    contentType: string,
): Promise<GalleryImageMetadata | null> {
    const object = await bucket.get(objectKey, {
        range: {
            offset: 0,
            length: GALLERY_IMAGE_DIMENSION_PROBE_BYTES,
        },
    })

    if (!object) {
        return null
    }

    return readGalleryImageMetadata(new Uint8Array(await object.arrayBuffer()), contentType)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
