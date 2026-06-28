import {Hono} from 'hono'
import type {Context} from 'hono'
import {getCurrentUser, toSqlTimestamp, type CurrentUser} from '../../lib/auth/session'
import {GALLERY_MAX_IMAGES_PER_ROW} from '../../lib/gallery'
import {
    characterHeightChartImageObjectKey,
    characterHeightChartImageUrl,
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterMediaPreviewImageObjectKey,
    characterMediaPreviewImageUrl,
    characterProfileImageObjectKey,
    characterProfileImageUrl,
} from '../../lib/media/url'
import {getPngDimensions} from '../../lib/media/png'
import {getWebpDimensions} from '../../lib/media/webp'
import {
    PROFILE_IMAGE_MAX_REQUEST_BYTES,
    validateProfileImagePayload,
} from '../../lib/media/profileImage'
import type {Bindings} from '../../types/bindings'

type CharacterRouteContext = Context<{ Bindings: Bindings }>

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
    'new-folder-name'?: unknown
    'new-folder-parent'?: unknown
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
    fullsizeLastRow?: unknown
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

type ParsedMediaForm = {
    sfwFile: File | null
    nsfwFile: File | null
    sfwArtist: unknown
    nsfwArtist: unknown
    removeSfw: unknown
    removeNsfw: unknown
}

type GalleryImage = {
    bytes: Uint8Array
    contentType: string
    width: number
    height: number
}

type ParsedChunkedMediaComplete = {
    body: ChunkedMediaCompleteRequest
    artists: ParsedMediaArtists
    sfwUpload: CompletedChunkedUpload | null
    nsfwUpload: CompletedChunkedUpload | null
    sfwPreview: ParsedPreviewImage | null
    nsfwPreview: ParsedPreviewImage | null
}

type ParsedValidatedMediaForm = {
    parsed: ParsedMediaForm
    artists: ParsedMediaArtists
    sfwImage: GalleryImage | null
    nsfwImage: GalleryImage | null
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
    gallery_fullsize_last_row?: number
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
const TREE_MAX_ITEMS = 500
const TREE_MAX_DEPTH = 20
const CHARACTER_NAME_ALLOWED_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 _'".()-]+$/
const CHARACTER_NAME_RULES = 'letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses'
const DISPLAY_NAME_ALLOWED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _'.()-]*$/
const DISPLAY_NAME_RULES = 'letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses'
const DUPLICATE_CHARACTER_NAME_ERROR = 'Character name already exists on this account'
const GALLERY_IMAGE_ALLOWED_CONTENT_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
])

const GALLERY_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const GALLERY_PREVIEW_CONTENT_TYPE = 'image/webp'
const GALLERY_PREVIEW_MAX_LONG_EDGE = 1600
const GALLERY_PREVIEW_MAX_BYTES = 1024 * 1024
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

export const characterRoutes = new Hono<{ Bindings: Bindings }>()

characterRoutes.post('/tree', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    let body: SortTreeRequest

    try {
        body = await c.req.json<SortTreeRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    if (!Array.isArray(body.items)) {
        return c.json({error: 'Tree items are required'}, 400)
    }

    const flattened = flattenTreeItems(body.items)

    if ('error' in flattened) {
        return c.json({error: flattened.error}, 400)
    }

    const ownership = await validateTreeOwnership(c.env.DB, currentUser.id, flattened.items)

    if ('error' in ownership) {
        return c.json({error: ownership.error}, 400)
    }

    const now = toSqlTimestamp(new Date())
    const statements: D1PreparedStatement[] = []

    for (const item of flattened.items) {
        if (item.type === 'folder') {
            statements.push(c.env.DB.prepare(
                `UPDATE character_folders
                 SET parent_folder_id = ?,
                     sort_order = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND user_id = ?`,
            ).bind(item.parentFolderId, item.sortOrder, now, item.id, currentUser.id))
        } else {
            statements.push(c.env.DB.prepare(
                `UPDATE characters
                 SET folder_id = ?,
                     sort_order = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND user_id = ?`,
            ).bind(item.parentFolderId, item.sortOrder, now, item.id, currentUser.id))
        }
    }

    if (statements.length > 0) {
        await c.env.DB.batch(statements)
    }

    return c.json({ok: true})
})

characterRoutes.post('/folders', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const parsed = await parseCreateFolderRequest(c.req)

    if ('error' in parsed) {
        return c.json({error: parsed.error}, 400)
    }

    const nameResult = normalizeFolderName(parsed.name)

    if ('error' in nameResult) {
        return c.json({error: nameResult.error}, 400)
    }

    const parentResult = normalizeFolderId(parsed.parentFolderId)

    if ('error' in parentResult) {
        return c.json({error: parentResult.error}, 400)
    }

    if (parentResult.folderId && !(await folderExists(c.env.DB, currentUser.id, parentResult.folderId))) {
        return c.json({error: 'Parent folder not found'}, 404)
    }

    const now = toSqlTimestamp(new Date())
    const folder: CharacterFolderRecord = {
        id: crypto.randomUUID(),
        user_id: currentUser.id,
        name: nameResult.name,
        parent_folder_id: parentResult.folderId,
        sort_order: 0,
        created_at: now,
        updated_at: now,
    }

    await c.env.DB.prepare(
        `INSERT INTO character_folders (id, user_id, name, parent_folder_id, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
        .bind(
            folder.id,
            folder.user_id,
            folder.name,
            folder.parent_folder_id,
            folder.sort_order,
            folder.created_at,
            folder.updated_at,
        )
        .run()

    return c.json({folder: toPublicFolder(folder)}, 201)
})

characterRoutes.delete('/folders/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const folder = await c.env.DB.prepare(
        `SELECT id, user_id, name, parent_folder_id, sort_order, created_at, updated_at
         FROM character_folders
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
    )
        .bind(c.req.param('id'), currentUser.id)
        .first<CharacterFolderRecord>()

    if (!folder) {
        return c.json({error: 'Folder not found'}, 404)
    }

    const now = toSqlTimestamp(new Date())

    await c.env.DB.batch([
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

    return c.body(null, 204)
})

characterRoutes.post('/', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const parsed = await parseCreateCharacterRequest(c)

    if ('error' in parsed) {
        return c.json({error: parsed.error}, parsed.status)
    }

    const nameResult = normalizeCharacterName(parsed.name)

    if ('error' in nameResult) {
        return c.json({error: nameResult.error}, 400)
    }

    const folderResult = normalizeFolderId(parsed.folderId)

    if ('error' in folderResult) {
        return c.json({error: folderResult.error}, 400)
    }

    if (folderResult.folderId && !(await folderExists(c.env.DB, currentUser.id, folderResult.folderId))) {
        return c.json({error: 'Folder not found'}, 404)
    }

    const profileImageResult = await validateProfileImage(parsed.profileImage)

    if ('error' in profileImageResult) {
        return c.json({error: profileImageResult.error}, profileImageResult.status)
    }

    const now = new Date()
    const characterId = crypto.randomUUID()
    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(
        currentUser.id,
        characterId,
        profileImageKey,
    )

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
        await c.env.DB.prepare(
            `INSERT INTO characters (id, user_id, name, profile_image_key, folder_id, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                character.id,
                character.user_id,
                character.name,
                character.profile_image_key,
                character.folder_id,
                character.sort_order,
                character.created_at,
                character.updated_at,
            )
            .run()
    } catch (error) {
        if (profileImageKey) {
            await c.env.MEDIA_BUCKET.delete(profileImageObjectKey)
        }

        if (isUniqueConstraintError(error)) {
            return c.json({error: DUPLICATE_CHARACTER_NAME_ERROR}, 409)
        }

        throw error
    }

    return c.json({character: toPublicCharacter(c.env.MEDIA_PUBLIC_BASE_URL, character)}, 201)
})

characterRoutes.patch('/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    let body: UpdateCharacterRequest

    try {
        body = await c.req.json<UpdateCharacterRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return c.json({error: 'Character not found'}, 404)
    }

    const nameResult = normalizeCharacterName(body.name)

    if ('error' in nameResult) {
        return c.json({error: nameResult.error}, 400)
    }

    const descriptionResult = normalizeCharacterDescription(body.description)

    if ('error' in descriptionResult) {
        return c.json({error: descriptionResult.error}, 400)
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
        if (isUniqueConstraintError(error)) {
            return c.json({error: DUPLICATE_CHARACTER_NAME_ERROR}, 409)
        }

        throw error
    }

    return c.json({
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
        return c.json({error: 'Character profile image upload is too large'}, 413)
    }

    const owned = await requireOwnedCharacterMultipartForm(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, form} = owned
    const file = form.get('profileImage') ?? form.get('character-profile-photo')
    const profileImageResult = await validateProfileImage(file instanceof File ? file : null)

    if ('error' in profileImageResult) {
        return c.json({error: profileImageResult.error}, profileImageResult.status)
    }

    const profileImageKey = crypto.randomUUID()
    const profileImageObjectKey = characterProfileImageObjectKey(
        currentUser.id,
        character.id,
        profileImageKey,
    )

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
            await c.env.MEDIA_BUCKET.delete(characterProfileImageObjectKey(
                currentUser.id,
                character.id,
                character.profile_image_key,
            ))
        } catch (error) {
            console.warn('Unable to delete old character profile image', error)
        }
    }

    return c.json({
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
        return c.json({error: 'Height chart JSON is required'}, 400)
    }

    const existingHeightChart = parseCharacterHeightChartJson(character.height_chart_json)
    const imageFileValue = form.get('heightChartImage')
    const imageFile = imageFileValue instanceof File && imageFileValue.size > 0 ? imageFileValue : null
    let uploadedImage: CompletedGalleryUpload | null = null
    let uploadedObjectKey: string | null = null

    if (imageFile) {
        const imageResult = await validateGalleryImage(imageFile, 'Height chart image')

        if ('error' in imageResult) {
            return c.json({error: imageResult.error}, imageResult.status)
        }

        const imageKey = crypto.randomUUID()
        uploadedImage = {
            imageKey,
            contentType: imageResult.contentType,
            width: imageResult.width,
            height: imageResult.height,
            byteSize: imageResult.bytes.byteLength,
        }
        uploadedObjectKey = characterHeightChartImageObjectKey(
            currentUser.id,
            character.id,
            imageKey,
            imageResult.contentType,
        )

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

        return c.json({error: normalized.error}, 400)
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
            characterHeightChartImageObjectKey(
                currentUser.id,
                character.id,
                previousImage.key,
                previousImage.contentType,
            ),
        ])
    }

    return c.json({
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

    return c.json({mediaId, uploads: chunkedUploads})
})

characterRoutes.put('/:id/media/chunked/:mediaId/:rating/:uploadId/:partNumber', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    const rating = normalizeMediaRating(c.req.param('rating'))

    if (!rating) {
        return c.json({error: 'Media rating must be sfw or nsfw'}, 400)
    }

    const mediaId = normalizeUploadIdentifier(c.req.param('mediaId'), 'Media id')
    const imageKey = normalizeUploadIdentifier(c.req.query('imageKey'), 'Image key')
    const contentType = normalizeGalleryImageContentType(c.req.query('contentType'))
    const uploadId = c.req.param('uploadId')
    const partNumber = Number(c.req.param('partNumber'))

    if ('error' in mediaId) {
        return c.json({error: mediaId.error}, 400)
    }

    if ('error' in imageKey) {
        return c.json({error: imageKey.error}, 400)
    }

    if ('error' in contentType) {
        return c.json({error: contentType.error}, 400)
    }

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
        return c.json({error: 'Part number must be between 1 and 10000'}, 400)
    }

    if (!c.req.raw.body) {
        return c.json({error: 'Chunk body is required'}, 400)
    }

    const objectKey = characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, imageKey.value, rating, contentType.contentType)
    const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId)
    const uploadedPart = await upload.uploadPart(partNumber, c.req.raw.body)

    return c.json(uploadedPart)
})

characterRoutes.delete('/:id/media/chunked/:mediaId/:rating/:uploadId', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned
    const rating = normalizeMediaRating(c.req.param('rating'))

    if (!rating) {
        return c.json({error: 'Media rating must be sfw or nsfw'}, 400)
    }

    const mediaId = normalizeUploadIdentifier(c.req.param('mediaId'), 'Media id')
    const imageKey = normalizeUploadIdentifier(c.req.query('imageKey'), 'Image key')
    const contentType = normalizeGalleryImageContentType(c.req.query('contentType'))
    const uploadId = c.req.param('uploadId')

    if ('error' in mediaId) {
        return c.json({error: mediaId.error}, 400)
    }

    if ('error' in imageKey) {
        return c.json({error: imageKey.error}, 400)
    }

    if ('error' in contentType) {
        return c.json({error: contentType.error}, 400)
    }

    const objectKey = characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, imageKey.value, rating, contentType.contentType)
    const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId)
    await upload.abort()

    return c.body(null, 204)
})

characterRoutes.post('/toyhouse-import-items/:itemId/fail', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const itemId = normalizeUploadIdentifier(c.req.param('itemId'), 'Import item id')

    if ('error' in itemId) {
        return c.json({error: itemId.error}, 400)
    }

    let body: { error?: unknown }

    try {
        body = await c.req.json<{ error?: unknown }>()
    } catch {
        body = {}
    }

    await markToyhouseImportItemFailed(c.env.DB, currentUser.id, itemId.value, typeof body.error === 'string' ? body.error : 'Import item failed')

    return c.json({ok: true})
})

characterRoutes.post('/toyhouse-import-items/:itemId/complete', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const itemId = normalizeUploadIdentifier(c.req.param('itemId'), 'Import item id')

    if ('error' in itemId) {
        return c.json({error: itemId.error}, 400)
    }

    const complete = await parseChunkedMediaCompleteBody(c)

    if ('error' in complete) {
        return c.json({error: complete.error}, complete.status)
    }

    const item = await getToyhouseImportItem(c.env.DB, currentUser.id, itemId.value)

    if (!item) {
        return c.json({error: 'Import item not found'}, 404)
    }

    if (item.status === 'imported' && item.media_id) {
        const existingMedia = await getOwnedCharacterMedia(c.env.DB, currentUser.id, item.character_id, item.media_id)

        if (existingMedia) {
            return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, existingMedia), skipped: true})
        }
    }

    const mediaId = normalizeUploadIdentifier(complete.body.mediaId, 'Media id')

    if ('error' in mediaId) {
        return c.json({error: mediaId.error}, 400)
    }

    const upload = item.rating === 'sfw' ? complete.sfwUpload : complete.nsfwUpload
    const preview = item.rating === 'sfw' ? complete.sfwPreview : complete.nsfwPreview
    const oppositeUpload = item.rating === 'sfw' ? complete.nsfwUpload : complete.sfwUpload
    const oppositePreview = item.rating === 'sfw' ? complete.nsfwPreview : complete.sfwPreview

    if (!upload) {
        return c.json({error: `${item.rating.toUpperCase()} upload is required for this import item`}, 400)
    }

    if (!preview) {
        return c.json({error: `${item.rating.toUpperCase()} preview is required for this import item`}, 400)
    }

    if (oppositeUpload || oppositePreview) {
        return c.json({error: 'Import item can only complete one media rating'}, 400)
    }

    const completedKeys: string[] = []

    try {
        const now = toSqlTimestamp(new Date())

        await c.env.DB.prepare(
            `UPDATE toyhouse_import_items
             SET status = ?,
                 error = '',
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind('uploading', now, item.id, currentUser.id)
            .run()

        const completedImage = await completeChunkedGalleryUpload(c.env.MEDIA_BUCKET, currentUser.id, item.character_id, mediaId.value, upload, item.rating, 'Toyhou.se image')
        completedKeys.push(characterMediaImageObjectKey(currentUser.id, item.character_id, mediaId.value, completedImage.imageKey, item.rating, completedImage.contentType))
        const completedPreview = await putMediaPreviewImage(c.env.MEDIA_BUCKET, currentUser.id, item.character_id, mediaId.value, preview, item.rating, completedKeys)

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
            nsfw_preview_width: item.rating === 'nsfw' ? completedPreview.width : null,
            nsfw_preview_height: item.rating === 'nsfw' ? completedPreview.height : null,
            nsfw_preview_byte_size: item.rating === 'nsfw' ? completedPreview.byteSize : null,
            created_at: now,
            updated_at: now,
        }

        await c.env.DB.batch([
            c.env.DB.prepare(
                `INSERT INTO character_media (
                     id, user_id, character_id,
                     sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type, sfw_artist, nsfw_artist,
                     sfw_width, sfw_height, sfw_byte_size, sfw_preview_image_key, sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                     nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key, nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                     created_at, updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                    media.created_at,
                    media.updated_at,
                ),
            c.env.DB.prepare(
                `UPDATE toyhouse_import_items
                 SET status = ?,
                     media_id = ?,
                     error = '',
                     updated_at = ?
                 WHERE id = ?
                   AND user_id = ?`,
            )
                .bind('imported', media.id, now, item.id, currentUser.id),
        ])

        await updateToyhouseImportJobStatus(c.env.DB, currentUser.id, item.job_id)

        return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media), skipped: false}, 201)
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        await markToyhouseImportItemFailed(c.env.DB, currentUser.id, item.id, error instanceof Error ? error.message : 'Import item failed')

        if (error instanceof Error && error.message) {
            return c.json({error: error.message}, 400)
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
        return c.json({error: complete.error}, complete.status)
    }

    const mediaId = normalizeUploadIdentifier(complete.body.mediaId, 'Media id')

    if ('error' in mediaId) {
        return c.json({error: mediaId.error}, 400)
    }

    const {artists, sfwUpload, nsfwUpload, sfwPreview, nsfwPreview} = complete

    if (!sfwUpload && !nsfwUpload) {
        return c.json({error: 'At least one image is required'}, 400)
    }

    if (sfwUpload && !sfwPreview) {
        return c.json({error: 'SFW preview is required'}, 400)
    }

    if (nsfwUpload && !nsfwPreview) {
        return c.json({error: 'NSFW preview is required'}, 400)
    }

    if (!sfwUpload && sfwPreview) {
        return c.json({error: 'SFW preview requires an SFW upload'}, 400)
    }

    if (!nsfwUpload && nsfwPreview) {
        return c.json({error: 'NSFW preview requires an NSFW upload'}, 400)
    }

    const completedKeys: string[] = []

    try {
        let sfwImage: CompletedGalleryUpload | null = null
        let nsfwImage: CompletedGalleryUpload | null = null
        let sfwPreviewImage: CompletedGalleryPreview | null = null
        let nsfwPreviewImage: CompletedGalleryPreview | null = null

        if (sfwUpload && !('error' in sfwUpload)) {
            sfwImage = await completeChunkedGalleryUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, sfwUpload, 'sfw', 'SFW image')
            completedKeys.push(characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, sfwImage.imageKey, 'sfw', sfwImage.contentType))
            sfwPreviewImage = await putMediaPreviewImage(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, sfwPreview as ParsedPreviewImage, 'sfw', completedKeys)
        }

        if (nsfwUpload && !('error' in nsfwUpload)) {
            nsfwImage = await completeChunkedGalleryUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, nsfwUpload, 'nsfw', 'NSFW image')
            completedKeys.push(characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, nsfwImage.imageKey, 'nsfw', nsfwImage.contentType))
            nsfwPreviewImage = await putMediaPreviewImage(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, nsfwPreview as ParsedPreviewImage, 'nsfw', completedKeys)
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
            nsfw_preview_width: nsfwPreviewImage?.width ?? null,
            nsfw_preview_height: nsfwPreviewImage?.height ?? null,
            nsfw_preview_byte_size: nsfwPreviewImage?.byteSize ?? null,
            created_at: now,
            updated_at: now,
        }

        await c.env.DB.prepare(
            `INSERT INTO character_media (
                 id, user_id, character_id,
                 sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type, sfw_artist, nsfw_artist,
                 sfw_width, sfw_height, sfw_byte_size, sfw_preview_image_key, sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                 nsfw_width, nsfw_height, nsfw_byte_size, nsfw_preview_image_key, nsfw_preview_width, nsfw_preview_height, nsfw_preview_byte_size,
                 created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                media.created_at,
                media.updated_at,
            )
            .run()

        return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media)}, 201)
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, completedKeys)
        if (error instanceof Error && error.message) {
            return c.json({error: error.message}, 400)
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

    return c.json({mediaId: media.id, uploads: chunkedUploads})
})

characterRoutes.post('/:id/media/:mediaId/chunked/complete', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    const complete = await parseChunkedMediaCompleteBody(c)

    if ('error' in complete) {
        return c.json({error: complete.error}, complete.status)
    }

    const {artists, sfwUpload, nsfwUpload, sfwPreview, nsfwPreview} = complete
    const removeSfw = normalizePermanentConfirmation(complete.body.removeSfw)
    const removeNsfw = normalizePermanentConfirmation(complete.body.removeNsfw)
    const finalHasSfw = Boolean((media.sfw_image_key && !removeSfw && !sfwUpload) || sfwUpload)
    const finalHasNsfw = Boolean((media.nsfw_image_key && !removeNsfw && !nsfwUpload) || nsfwUpload)

    if (!finalHasSfw && !finalHasNsfw) {
        return c.json({error: 'At least one image must remain on media'}, 400)
    }

    if (sfwUpload && !sfwPreview) {
        return c.json({error: 'SFW preview is required'}, 400)
    }

    if (nsfwUpload && !nsfwPreview) {
        return c.json({error: 'NSFW preview is required'}, 400)
    }

    if (!sfwUpload && sfwPreview) {
        return c.json({error: 'SFW preview requires an SFW upload'}, 400)
    }

    if (!nsfwUpload && nsfwPreview) {
        return c.json({error: 'NSFW preview requires an NSFW upload'}, 400)
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
            await replaceMediaVariantWithChunkedUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, sfwUpload, sfwPreview as ParsedPreviewImage, 'sfw', uploadedKeys, deletedKeys)
        }

        if (nsfwUpload) {
            await replaceMediaVariantWithChunkedUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, nsfwUpload, nsfwPreview as ParsedPreviewImage, 'nsfw', uploadedKeys, deletedKeys)
        }

        await updateCharacterMediaRecord(c.env.DB, nextMedia, {
            sfwWasModified,
            nsfwWasModified,
        })

        await deleteR2Objects(c.env.MEDIA_BUCKET, deletedKeys)

        return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, nextMedia)})
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, uploadedKeys)
        if (error instanceof Error && error.message) {
            return c.json({error: error.message}, 400)
        }

        throw error
    }
})

characterRoutes.post('/:id/media', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    const mediaForm = await parseValidatedMediaForm(c.req)

    if ('error' in mediaForm) {
        return c.json({error: mediaForm.error}, mediaForm.status)
    }

    const {artists, sfwImage, nsfwImage} = mediaForm

    if (!sfwImage && !nsfwImage) {
        return c.json({error: 'At least one image is required'}, 400)
    }

    const now = toSqlTimestamp(new Date())
    const mediaId = crypto.randomUUID()
    const uploadedKeys: string[] = []
    const sfwImageKey = sfwImage ? await putNewMediaVariant(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId, sfwImage, 'sfw', uploadedKeys) : null
    const nsfwImageKey = nsfwImage ? await putNewMediaVariant(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId, nsfwImage, 'nsfw', uploadedKeys) : null

    const media: CharacterMediaRecord = {
        id: mediaId,
        user_id: currentUser.id,
        character_id: character.id,
        sfw_image_key: sfwImageKey,
        nsfw_image_key: nsfwImageKey,
        sfw_content_type: sfwImage?.contentType ?? null,
        nsfw_content_type: nsfwImage?.contentType ?? null,
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        sfw_width: sfwImage?.width ?? null,
        sfw_height: sfwImage?.height ?? null,
        sfw_byte_size: sfwImage?.bytes.byteLength ?? null,
        nsfw_width: nsfwImage?.width ?? null,
        nsfw_height: nsfwImage?.height ?? null,
        nsfw_byte_size: nsfwImage?.bytes.byteLength ?? null,
        sfw_preview_image_key: null,
        sfw_preview_width: null,
        sfw_preview_height: null,
        sfw_preview_byte_size: null,
        nsfw_preview_image_key: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_preview_byte_size: null,
        created_at: now,
        updated_at: now,
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO character_media (
                id, user_id, character_id,
                sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type, sfw_artist, nsfw_artist,
                sfw_width, sfw_height, sfw_byte_size,
                nsfw_width, nsfw_height, nsfw_byte_size,
                created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
                media.nsfw_width,
                media.nsfw_height,
                media.nsfw_byte_size,
                media.created_at,
                media.updated_at,
            )
            .run()
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, uploadedKeys)
        throw error
    }

    return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, media)}, 201)
})

characterRoutes.patch('/:id/media/:mediaId', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    const mediaForm = await parseValidatedMediaForm(c.req)

    if ('error' in mediaForm) {
        return c.json({error: mediaForm.error}, mediaForm.status)
    }

    const {parsed, artists, sfwImage, nsfwImage} = mediaForm
    const removeSfw = normalizePermanentConfirmation(parsed.removeSfw)
    const removeNsfw = normalizePermanentConfirmation(parsed.removeNsfw)
    const finalHasSfw = Boolean((media.sfw_image_key && !removeSfw) || sfwImage)
    const finalHasNsfw = Boolean((media.nsfw_image_key && !removeNsfw) || nsfwImage)

    if (!finalHasSfw && !finalHasNsfw) {
        return c.json({error: 'At least one image must remain on media'}, 400)
    }

    const uploadedKeys: string[] = []
    const deletedKeys: string[] = []
    const sfwWasModified = removeSfw || Boolean(sfwImage)
    const nsfwWasModified = removeNsfw || Boolean(nsfwImage)
    const nextMedia: CharacterMediaRecord = {
        ...media,
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        updated_at: toSqlTimestamp(new Date()),
    }

    applyMediaVariantRemovals(currentUser.id, character.id, media, nextMedia, removeSfw, removeNsfw, deletedKeys)

    if (sfwImage) {
        await replaceMediaVariantWithImage(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, sfwImage, 'sfw', uploadedKeys, deletedKeys)
    }

    if (nsfwImage) {
        await replaceMediaVariantWithImage(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, nsfwImage, 'nsfw', uploadedKeys, deletedKeys)
    }

    try {
        await updateCharacterMediaRecord(c.env.DB, nextMedia, {
            sfwWasModified,
            nsfwWasModified,
        })
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, uploadedKeys)
        throw error
    }

    await deleteR2Objects(c.env.MEDIA_BUCKET, deletedKeys)

    return c.json({media: toPublicMedia(c.env.MEDIA_PUBLIC_BASE_URL, nextMedia)})
})

characterRoutes.delete('/:id/media/:mediaId', async (c) => {
    const owned = await requireOwnedCharacterMedia(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character, media} = owned

    await c.env.DB.prepare(
        `DELETE FROM character_media
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
        return c.json({error: 'Authentication required'}, 401)
    }

    let body: GalleryLayoutRequest

    try {
        body = await c.req.json<GalleryLayoutRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return c.json({error: 'Character not found'}, 404)
    }

    const parsed = parseGalleryLayout(body)

    if ('error' in parsed) {
        return c.json({error: parsed.error}, 400)
    }

    const ownedMediaIds = await getOwnedMediaIds(c.env.DB, currentUser.id, character.id, [...parsed.mediaIds])

    for (const mediaId of parsed.mediaIds) {
        if (!ownedMediaIds.has(mediaId)) {
            return c.json({error: 'Gallery contains media that does not belong to this character'}, 400)
        }
    }

    const now = toSqlTimestamp(new Date())
    const statements: D1PreparedStatement[] = [
        c.env.DB.prepare(
            `UPDATE characters
             SET gallery_fullsize_last_row = ?,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        ).bind(parsed.fullsizeLastRow ? 1 : 0, now, character.id, currentUser.id),
        c.env.DB.prepare(
            `DELETE FROM character_gallery_tabs
             WHERE character_id = ?
               AND user_id = ?`,
        ).bind(character.id, currentUser.id),
    ]

    parsed.tabs.forEach((tab, tabIndex) => {
        statements.push(c.env.DB.prepare(
            `INSERT INTO character_gallery_tabs (id, user_id, character_id, name, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(tab.id, currentUser.id, character.id, tab.name, tabIndex, now, now))

        tab.rows.forEach((row, rowIndex) => {
            statements.push(c.env.DB.prepare(
                `INSERT INTO character_gallery_rows (id, user_id, character_id, tab_id, sort_order, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ).bind(row.id, currentUser.id, character.id, tab.id, rowIndex, now, now))

            row.mediaIds.forEach((mediaId, mediaIndex) => {
                statements.push(c.env.DB.prepare(
                    `INSERT INTO character_gallery_row_media (row_id, media_id, sort_order)
                     VALUES (?, ?, ?)`,
                ).bind(row.id, mediaId, mediaIndex))
            })
        })
    })

    await c.env.DB.batch(statements)

    return c.json({
        gallery: {
            fullsizeLastRow: parsed.fullsizeLastRow,
            tabs: parsed.tabs,
        },
    })
})

characterRoutes.delete('/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const body = await parseDeleteCharacterRequest(c.req)
    const confirmName = normalizeOptionalText(body.confirmName ?? body['delete-character-confirm-name'])
    const permanent = normalizePermanentConfirmation(body.permanent ?? body['delete-confirm-permanent'])

    if (!confirmName) {
        return c.json({error: 'Character name confirmation is required'}, 400)
    }

    if (!permanent) {
        return c.json({error: 'Permanent deletion confirmation is required'}, 400)
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
        return c.json({error: 'Character not found'}, 404)
    }

    if (confirmName.toUpperCase() !== character.name.toUpperCase()) {
        return c.json({error: 'Character name confirmation does not match'}, 400)
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
            await c.env.MEDIA_BUCKET.delete(characterProfileImageObjectKey(
                currentUser.id,
                character.id,
                character.profile_image_key,
            ))
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
            characterHeightChartImageObjectKey(
                currentUser.id,
                character.id,
                heightChart.image.key,
                heightChart.image.contentType,
            ),
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
        description: character.description ?? '',
        galleryFullsizeLastRow: Boolean(character.gallery_fullsize_last_row),
        createdAt: character.created_at,
        updatedAt: character.updated_at,
    }
}

function toPublicHeightChart(
    baseUrl: string,
    userId: string,
    characterId: string,
    heightChart: CharacterHeightChartJson | null,
) {
    if (!heightChart) {
        return null
    }

    return {
        ...heightChart,
        image: heightChart.image
            ? {
                ...heightChart.image,
                url: characterHeightChartImageUrl(
                    baseUrl,
                    userId,
                    characterId,
                    heightChart.image.key,
                    heightChart.image.contentType,
                ),
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
            ? characterMediaImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw', media.sfw_content_type)
            : null,
        nsfwImageUrl: media.nsfw_image_key
            ? characterMediaImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.nsfw_image_key, 'nsfw', media.nsfw_content_type)
            : null,
        sfwPreviewImageKey: media.sfw_preview_image_key,
        nsfwPreviewImageKey: media.nsfw_preview_image_key,
        sfwPreviewImageUrl: media.sfw_preview_image_key
            ? characterMediaPreviewImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.sfw_preview_image_key, 'sfw')
            : null,
        nsfwPreviewImageUrl: media.nsfw_preview_image_key
            ? characterMediaPreviewImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.nsfw_preview_image_key, 'nsfw')
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
    await db.prepare(
        `UPDATE character_media
         SET sfw_image_key        = ?,
             nsfw_image_key       = ?,
             sfw_content_type     = ?,
             nsfw_content_type    = ?,
             sfw_artist           = ?,
             nsfw_artist          = ?,
             sfw_width            = ?,
             sfw_height           = ?,
             sfw_byte_size        = ?,
             sfw_preview_image_key = ?,
             sfw_preview_width     = ?,
             sfw_preview_height    = ?,
             sfw_preview_byte_size = ?,
             nsfw_width           = ?,
             nsfw_height          = ?,
             nsfw_byte_size       = ?,
             nsfw_preview_image_key = ?,
             nsfw_preview_width     = ?,
             nsfw_preview_height    = ?,
             nsfw_preview_byte_size = ?,
             sfw_review_status    = CASE WHEN ? THEN 'pending' ELSE sfw_review_status END,
             sfw_reviewed_at      = CASE WHEN ? THEN NULL ELSE sfw_reviewed_at END,
             sfw_approved_at      = CASE WHEN ? THEN NULL ELSE sfw_approved_at END,
             sfw_homepage_allowed = CASE WHEN ? THEN 0 ELSE sfw_homepage_allowed END,
             nsfw_review_status   = CASE WHEN ? THEN 'pending' ELSE nsfw_review_status END,
             nsfw_reviewed_at     = CASE WHEN ? THEN NULL ELSE nsfw_reviewed_at END,
             nsfw_approved_at     = CASE WHEN ? THEN NULL ELSE nsfw_approved_at END,
             updated_at           = ?
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

function toPublicFolder(folder: CharacterFolderRecord) {
    return {
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        createdAt: folder.created_at,
        updatedAt: folder.updated_at,
    }
}

async function requireOwnedCharacter(c: CharacterRouteContext): Promise<{
    currentUser: CurrentUser
    character: CharacterRecord
} | Response> {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return c.json({error: 'Character not found'}, 404)
    }

    return {currentUser, character}
}

async function requireOwnedCharacterMultipartForm(c: CharacterRouteContext): Promise<{
    currentUser: CurrentUser
    character: CharacterRecord
    form: FormData
} | Response> {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
        return c.json({error: 'Multipart form data is required'}, 400)
    }

    return {
        ...owned,
        form: await c.req.formData(),
    }
}

async function requireOwnedCharacterMedia(c: CharacterRouteContext): Promise<{
    currentUser: CurrentUser
    character: CharacterRecord
    media: CharacterMediaRecord
} | Response> {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const media = await getOwnedCharacterMedia(c.env.DB, owned.currentUser.id, owned.character.id, c.req.param('mediaId') ?? '')

    if (!media) {
        return c.json({error: 'Media not found'}, 404)
    }

    return {...owned, media}
}

async function parseChunkedUploadInitRequest(c: CharacterRouteContext): Promise<{
    uploads: ChunkedUploadInit[]
} | Response> {
    let body: ChunkedMediaInitRequest

    try {
        body = await c.req.json<ChunkedMediaInitRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const uploads = parseChunkedUploadInits(body.uploads ?? body.ratings)

    if ('error' in uploads) {
        return c.json({error: uploads.error}, 400)
    }

    return uploads
}

function parseMediaArtists(sfwValue: unknown, nsfwValue: unknown): ParsedMediaArtists | { error: string } {
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

function parseChunkedUploadPair(sfwValue: unknown, nsfwValue: unknown): {
    sfwUpload: CompletedChunkedUpload | null
    nsfwUpload: CompletedChunkedUpload | null
} | { error: string } {
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

function parsePreviewImagePair(sfwValue: unknown, nsfwValue: unknown): {
    sfwPreview: ParsedPreviewImage | null
    nsfwPreview: ParsedPreviewImage | null
} | { error: string } {
    const sfwPreview = parsePreviewImage(sfwValue)
    const nsfwPreview = parsePreviewImage(nsfwValue)

    if (sfwPreview && 'error' in sfwPreview) {
        return {error: `SFW ${sfwPreview.error}`}
    }

    if (nsfwPreview && 'error' in nsfwPreview) {
        return {error: `NSFW ${nsfwPreview.error}`}
    }

    return {sfwPreview, nsfwPreview}
}

function parsePreviewImage(value: unknown): ParsedPreviewImage | null | { error: string } {
    if (value === undefined || value === null) {
        return null
    }

    if (!isRecord(value)) {
        return {error: 'preview must be an object'}
    }

    const contentType = typeof value.contentType === 'string' ? value.contentType.toLowerCase() : GALLERY_PREVIEW_CONTENT_TYPE

    if (contentType !== GALLERY_PREVIEW_CONTENT_TYPE) {
        return {error: 'preview must be a WebP image'}
    }

    if (typeof value.data !== 'string' || value.data.length === 0) {
        return {error: 'preview data is required'}
    }

    const normalizedDimensions = normalizeGalleryImageDimensions(value.width, value.height)

    if ('error' in normalizedDimensions) {
        return {error: 'preview dimensions are required'}
    }

    if (Math.max(normalizedDimensions.width, normalizedDimensions.height) > GALLERY_PREVIEW_MAX_LONG_EDGE) {
        return {error: `preview long edge must be ${GALLERY_PREVIEW_MAX_LONG_EDGE}px or smaller`}
    }

    const bytes = decodePreviewBase64(value.data)

    if ('error' in bytes) {
        return bytes
    }

    if (bytes.bytes.byteLength <= 0) {
        return {error: 'preview is empty'}
    }

    if (bytes.bytes.byteLength > GALLERY_PREVIEW_MAX_BYTES) {
        return {error: 'preview is too large'}
    }

    const dimensions = getWebpDimensions(bytes.bytes)

    if (!dimensions) {
        return {error: 'preview must be a valid WebP image'}
    }

    if (dimensions.width !== normalizedDimensions.width || dimensions.height !== normalizedDimensions.height) {
        return {error: 'preview dimensions do not match the WebP file'}
    }

    return {
        bytes: bytes.bytes,
        contentType: GALLERY_PREVIEW_CONTENT_TYPE,
        width: dimensions.width,
        height: dimensions.height,
    }
}

function decodePreviewBase64(value: string): { bytes: Uint8Array } | { error: string } {
    const data = value.startsWith('data:')
        ? value.replace(/^data:image\/webp;base64,/i, '')
        : value

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0) {
        return {error: 'preview data must be base64 WebP data'}
    }

    try {
        const decoded = atob(data)
        const bytes = new Uint8Array(decoded.length)

        for (let index = 0; index < decoded.length; index += 1) {
            bytes[index] = decoded.charCodeAt(index)
        }

        return {bytes}
    } catch {
        return {error: 'preview data must be base64 WebP data'}
    }
}

async function parseChunkedMediaCompleteBody(c: CharacterRouteContext): Promise<ParsedChunkedMediaComplete | {
    error: string
    status: 400
}> {
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

    const previews = parsePreviewImagePair(body.sfwPreview, body.nsfwPreview)

    if ('error' in previews) {
        return {error: previews.error, status: 400}
    }

    return {
        body,
        artists,
        sfwUpload: uploads.sfwUpload,
        nsfwUpload: uploads.nsfwUpload,
        sfwPreview: previews.sfwPreview,
        nsfwPreview: previews.nsfwPreview,
    }
}

async function parseValidatedMediaForm(req: CharacterRouteContext['req']): Promise<ParsedValidatedMediaForm | {
    error: string
    status: 400
}> {
    const parsed = await parseMediaForm(req)

    if ('error' in parsed) {
        return parsed
    }

    const artists = parseMediaArtists(parsed.sfwArtist, parsed.nsfwArtist)

    if ('error' in artists) {
        return {error: artists.error, status: 400}
    }

    const images = await validateMediaFormImages(parsed)

    if ('error' in images) {
        return images
    }

    return {
        parsed,
        artists,
        sfwImage: images.sfwImage,
        nsfwImage: images.nsfwImage,
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
): Promise<Partial<Record<MediaRating, {
    uploadId: string;
    imageKey: string;
    contentType: string;
    chunkSize: number
}>>> {
    const uploads: Partial<Record<MediaRating, {
        uploadId: string;
        imageKey: string;
        contentType: string;
        chunkSize: number
    }>> = {}

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
        deletedKeys.push(characterMediaImageObjectKey(userId, characterId, media.id, imageKey, rating, existingMediaVariantContentType(media, rating)))
    }

    const previewImageKey = existingMediaPreviewKey(media, rating)

    if (previewImageKey) {
        deletedKeys.push(characterMediaPreviewImageObjectKey(userId, characterId, media.id, previewImageKey, rating))
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
}

function assignMediaVariant(
    nextMedia: CharacterMediaRecord,
    rating: MediaRating,
    image: { imageKey: string; contentType: string; width: number; height: number; byteSize: number },
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
}

async function replaceMediaVariantWithChunkedUpload(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    nextMedia: CharacterMediaRecord,
    upload: CompletedChunkedUpload,
    preview: ParsedPreviewImage,
    rating: MediaRating,
    uploadedKeys: string[],
    deletedKeys: string[],
): Promise<void> {
    queueExistingMediaVariantDelete(userId, characterId, media, rating, deletedKeys)
    const label = rating === 'sfw' ? 'SFW image' : 'NSFW image'
    const image = await completeChunkedGalleryUpload(bucket, userId, characterId, media.id, upload, rating, label)
    uploadedKeys.push(characterMediaImageObjectKey(userId, characterId, media.id, image.imageKey, rating, image.contentType))
    const previewImage = await putMediaPreviewImage(bucket, userId, characterId, media.id, preview, rating, uploadedKeys)
    assignMediaVariant(nextMedia, rating, image, previewImage)
}

async function replaceMediaVariantWithImage(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    nextMedia: CharacterMediaRecord,
    image: GalleryImage,
    rating: MediaRating,
    uploadedKeys: string[],
    deletedKeys: string[],
): Promise<void> {
    queueExistingMediaVariantDelete(userId, characterId, media, rating, deletedKeys)
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaImageObjectKey(userId, characterId, media.id, imageKey, rating, image.contentType)

    await putGalleryImageObject(bucket, objectKey, image)

    assignMediaVariant(nextMedia, rating, {
        imageKey,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        byteSize: image.bytes.byteLength,
    }, null)
    uploadedKeys.push(objectKey)
}

async function putNewMediaVariant(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    image: GalleryImage,
    rating: MediaRating,
    uploadedKeys: string[],
): Promise<string> {
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, rating, image.contentType)

    await putGalleryImageObject(bucket, objectKey, image)

    uploadedKeys.push(objectKey)
    return imageKey
}

async function putGalleryImageObject(bucket: R2Bucket, objectKey: string, image: GalleryImage): Promise<void> {
    await bucket.put(objectKey, image.bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: image.contentType,
        },
    })
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

async function parseCreateCharacterRequest(c: CharacterRouteContext): Promise<{
    name: unknown
    folderId: unknown
    profileImage: File | JsonProfileImage | null
} | {
    error: string
    status: 400 | 413
}> {
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

async function parseCreateFolderRequest(req: CharacterRouteContext['req']): Promise<{
    name: unknown
    parentFolderId: unknown
} | {
    error: string
}> {
    const contentType = req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            const body = await req.json<CreateFolderRequest>()

            return {
                name: body.name ?? body['new-folder-name'],
                parentFolderId: body.parentFolderId ?? body.parentId ?? body['new-folder-parent'],
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

async function parseMediaForm(req: CharacterRouteContext['req']): Promise<ParsedMediaForm | {
    error: string
    status: 400
}> {
    const contentType = req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
        return {error: 'Multipart form data is required', status: 400}
    }

    const form = await req.formData()
    const sfwFile = form.get('sfwImage') ?? form.get('gallery-image-sfw-file') ?? form.get('edit-gallery-image-sfw-file')
    const nsfwFile = form.get('nsfwImage') ?? form.get('gallery-image-nsfw-file') ?? form.get('edit-gallery-image-nsfw-file')

    return {
        sfwFile: sfwFile instanceof File && sfwFile.size > 0 ? sfwFile : null,
        nsfwFile: nsfwFile instanceof File && nsfwFile.size > 0 ? nsfwFile : null,
        sfwArtist: form.get('sfwArtist') ?? form.get('gallery-image-sfw-artist') ?? form.get('edit-gallery-image-sfw-artist'),
        nsfwArtist: form.get('nsfwArtist') ?? form.get('gallery-image-nsfw-artist') ?? form.get('edit-gallery-image-nsfw-artist'),
        removeSfw: form.get('removeSfw'),
        removeNsfw: form.get('removeNsfw'),
    }
}

async function validateMediaFormImages(parsed: ParsedMediaForm): Promise<{
    sfwImage: GalleryImage | null
    nsfwImage: GalleryImage | null
} | {
    error: string
    status: 400
}> {
    const sfwImage = parsed.sfwFile ? await validateGalleryImage(parsed.sfwFile, 'SFW image') : null
    const nsfwImage = parsed.nsfwFile ? await validateGalleryImage(parsed.nsfwFile, 'NSFW image') : null

    if (sfwImage && 'error' in sfwImage) {
        return {error: sfwImage.error, status: sfwImage.status}
    }

    if (nsfwImage && 'error' in nsfwImage) {
        return {error: nsfwImage.error, status: nsfwImage.status}
    }

    return {sfwImage, nsfwImage}
}

function normalizeCharacterName(value: unknown): { name: string } | { error: string } {
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

function normalizeCharacterDescription(value: unknown): { description: string } | { error: string } {
    const description = normalizeOptionalText(value) ?? ''

    if (description.length > CHARACTER_DESCRIPTION_MAX_LENGTH) {
        return {error: 'Character description must be 255 characters or fewer'}
    }

    return {description}
}

function normalizeFolderName(value: unknown): { name: string } | { error: string } {
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

function normalizeFolderId(value: unknown): { folderId: string | null } | { error: string } {
    const folderId = normalizeOptionalText(value)

    if (!folderId || folderId === 'root') {
        return {folderId: null}
    }

    if (folderId.length > FOLDER_ID_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(folderId)) {
        return {error: 'Folder must be root or a valid folder id'}
    }

    return {folderId}
}

function normalizeGalleryTabName(value: unknown): { name: string } | { error: string } {
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

function normalizeArtistName(value: unknown): { artist: string } | { error: string } {
    const artist = normalizeOptionalText(value) ?? ''

    if (artist.length > ARTIST_NAME_MAX_LENGTH) {
        return {error: 'artist name must be 80 characters or fewer'}
    }

    return {artist}
}

type ParsedGalleryLayout = {
    fullsizeLastRow: boolean
    mediaIds: Set<string>
    tabs: {
        id: string
        name: string
        rows: {
            id: string
            mediaIds: string[]
        }[]
    }[]
}

function parseGalleryLayout(body: GalleryLayoutRequest): ParsedGalleryLayout | { error: string } {
    if (!Array.isArray(body.tabs)) {
        return {error: 'Gallery tabs are required'}
    }

    if (body.tabs.length < 1 || body.tabs.length > GALLERY_MAX_TABS) {
        return {error: `Gallery must contain between 1 and ${GALLERY_MAX_TABS} tabs`}
    }

    const parsed: ParsedGalleryLayout = {
        fullsizeLastRow: body.fullsizeLastRow === true,
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

        if (!Array.isArray(tabItem.rows)) {
            return {error: 'Gallery tab rows are required'}
        }

        if (tabItem.rows.length < 1) {
            return {error: 'Gallery tabs must contain at least one row'}
        }

        const tab = {
            id: tabId,
            name: name.name,
            rows: [] as { id: string; mediaIds: string[] }[],
        }
        const mediaIdsInTab = new Set<string>()
        tabIds.add(tabId)

        for (const rowItem of tabItem.rows) {
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

        parsed.tabs.push(tab)
    }

    return parsed
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
): {
    items: FlattenedTreeItem[]
} | {
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

async function validateTreeOwnership(
    db: D1Database,
    userId: string,
    items: FlattenedTreeItem[],
): Promise<{ ok: true } | { error: string }> {
    const folderIds = new Set<string>()
    const characterIds = new Set<string>()

    for (const item of items) {
        if (item.type === 'folder') {
            folderIds.add(item.id)
        } else {
            characterIds.add(item.id)
        }
    }

    const [ownedFolderIds, ownedCharacterIds] = await Promise.all([
        getOwnedFolderIds(db, userId, [...folderIds]),
        getOwnedCharacterIds(db, userId, [...characterIds]),
    ])

    for (const folderId of folderIds) {
        if (!ownedFolderIds.has(folderId)) {
            return {error: 'Tree contains folders that do not belong to the current user'}
        }
    }

    for (const characterId of characterIds) {
        if (!ownedCharacterIds.has(characterId)) {
            return {error: 'Tree contains characters that do not belong to the current user'}
        }
    }

    return {ok: true}
}

async function getOwnedFolderIds(db: D1Database, userId: string, folderIds: string[]): Promise<Set<string>> {
    if (folderIds.length === 0) {
        return new Set()
    }

    const placeholders = folderIds.map(() => '?').join(', ')
    const result = await db.prepare(
        `SELECT id
         FROM character_folders
         WHERE user_id = ?
           AND id IN (${placeholders})`,
    )
        .bind(userId, ...folderIds)
        .all<Pick<CharacterFolderRecord, 'id'>>()

    return new Set((result.results ?? []).map((folder) => folder.id))
}

async function getOwnedCharacterIds(db: D1Database, userId: string, characterIds: string[]): Promise<Set<string>> {
    if (characterIds.length === 0) {
        return new Set()
    }

    const placeholders = characterIds.map(() => '?').join(', ')
    const result = await db.prepare(
        `SELECT id
         FROM characters
         WHERE user_id = ?
           AND id IN (${placeholders})`,
    )
        .bind(userId, ...characterIds)
        .all<Pick<CharacterRecord, 'id'>>()

    return new Set((result.results ?? []).map((character) => character.id))
}

async function getOwnedMediaIds(
    db: D1Database,
    userId: string,
    characterId: string,
    mediaIds: string[],
): Promise<Set<string>> {
    if (mediaIds.length === 0) {
        return new Set()
    }

    const placeholders = mediaIds.map(() => '?').join(', ')
    const result = await db.prepare(
        `SELECT id
         FROM character_media
         WHERE user_id = ?
           AND character_id = ?
           AND id IN (${placeholders})`,
    )
        .bind(userId, characterId, ...mediaIds)
        .all<Pick<CharacterMediaRecord, 'id'>>()

    return new Set((result.results ?? []).map((media) => media.id))
}

function readJsonProfileImage(body: CreateCharacterRequest): JsonProfileImage | null {
    const value = body.profileImageData ?? body.profileImage

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

        if (!Number.isFinite(meters) || !Number.isFinite(headYPercent) || !Number.isFinite(footYPercent)) {
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
): { heightChart: CharacterHeightChartJson } | { error: string } {
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

    if (!Number.isFinite(headYPercent) || headYPercent < 0 || headYPercent > 100) {
        return {error: 'Head marker must be between 0 and 100 percent'}
    }

    if (!Number.isFinite(footYPercent) || footYPercent < 0 || footYPercent > maxFootPercent) {
        return {error: footIsVirtual ? 'Virtual foot marker must be between 0 and 180 percent' : 'Foot marker must be between 0 and 100 percent'}
    }

    if (footYPercent - headYPercent < 2) {
        return {error: 'Foot marker must be below the head marker'}
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
            },
        },
    }
}

function isValidTreeId(value: string): boolean {
    return value.length <= FOLDER_ID_MAX_LENGTH && /^[A-Za-z0-9_-]+$/.test(value)
}

async function folderExists(db: D1Database, userId: string, folderId: string): Promise<boolean> {
    const folder = await db.prepare(
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

async function getOwnedCharacter(db: D1Database, userId: string, characterId: string): Promise<CharacterRecord | null> {
    return await db.prepare(
        `SELECT id,
                user_id,
                name,
                profile_image_key,
                folder_id,
                sort_order,
                description,
                gallery_fullsize_last_row,
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
    return await db.prepare(
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

async function getToyhouseImportItem(
    db: D1Database,
    userId: string,
    itemId: string,
): Promise<ToyhouseImportItemRecord | null> {
    return await db.prepare(
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

async function markToyhouseImportItemFailed(
    db: D1Database,
    userId: string,
    itemId: string,
    error: string,
): Promise<void> {
    const now = toSqlTimestamp(new Date())

    await db.batch([
        db.prepare(
            `UPDATE toyhouse_import_items
             SET status = ?,
                 error = ?,
                 updated_at = ?
             WHERE id = ?
               AND user_id = ?`,
        )
            .bind('failed', error.slice(0, 500), now, itemId, userId),
        db.prepare(
            `UPDATE toyhouse_import_jobs
             SET status = ?,
                 updated_at = ?
             WHERE user_id = ?
               AND id = (
                   SELECT job_id
                   FROM toyhouse_import_items
                   WHERE id = ?
                     AND user_id = ?
                   LIMIT 1
               )`,
        )
            .bind('failed', now, userId, itemId, userId),
    ])
}

async function updateToyhouseImportJobStatus(
    db: D1Database,
    userId: string,
    jobId: string,
): Promise<void> {
    const remaining = await db.prepare(
        `SELECT COUNT(*) AS count
         FROM toyhouse_import_items
         WHERE job_id = ?
           AND user_id = ?
           AND status <> 'imported'`,
    )
        .bind(jobId, userId)
        .first<{ count: number }>()
    const status = (remaining?.count ?? 0) === 0 ? 'complete' : 'running'
    const now = toSqlTimestamp(new Date())

    await db.prepare(
        `UPDATE toyhouse_import_jobs
         SET status = ?,
             updated_at = ?
         WHERE id = ?
           AND user_id = ?`,
    )
        .bind(status, now, jobId, userId)
        .run()
}

async function getCharacterMedia(
    db: D1Database,
    userId: string,
    characterId: string,
): Promise<CharacterMediaRecord[]> {
    const result = await db.prepare(
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
                nsfw_preview_width,
                nsfw_preview_height,
                nsfw_preview_byte_size,
                created_at,
                updated_at
         FROM character_media
         WHERE character_id = ?
           AND user_id = ?
         ORDER BY created_at, id`,
    )
        .bind(characterId, userId)
        .all<CharacterMediaRecord>()

    return result.results ?? []
}

async function validateGalleryImage(file: File, label: string): Promise<{
    bytes: Uint8Array
    contentType: string
    width: number
    height: number
} | {
    error: string
    status: 400
}> {
    const contentType = normalizeGalleryImageContentType(file.type)

    if ('error' in contentType) {
        return {error: contentType.error, status: 400}
    }

    const bytes = new Uint8Array(await file.arrayBuffer())

    if (bytes.byteLength <= 0) {
        return {error: `${label} is empty`, status: 400}
    }

    const dimensions = readGalleryImageDimensions(bytes, contentType.contentType) ?? normalizeGalleryImageDimensions(
        'width' in file ? (file as File & { width?: unknown }).width : undefined,
        'height' in file ? (file as File & { height?: unknown }).height : undefined,
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
        objectKeys.push(characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw', media.sfw_content_type))
    }

    if (media.sfw_preview_image_key) {
        objectKeys.push(characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_preview_image_key, 'sfw'))
    }

    if (media.nsfw_image_key) {
        objectKeys.push(characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_image_key, 'nsfw', media.nsfw_content_type))
    }

    if (media.nsfw_preview_image_key) {
        objectKeys.push(characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_preview_image_key, 'nsfw'))
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

async function validateProfileImage(file: File | JsonProfileImage | null): Promise<{
    contentType: string
    bytes: Uint8Array
} | {
    error: string
    status: 400 | 413
}> {
    if (!file || (file instanceof File && file.size === 0)) {
        return {error: 'Character profile image is required', status: 400}
    }

    const profileImage = file instanceof File
        ? await readProfileImageFile(file)
        : readProfileImageDataUrl(file.data)

    if ('error' in profileImage) {
        return profileImage
    }

    const validation = validateProfileImagePayload(profileImage, 'Character profile image')

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

function readProfileImageDataUrl(value: string): {
    contentType: string
    bytes: Uint8Array
} | {
    error: string
    status: 400
} {
    const match = /^data:([^;,]+);base64,(.+)$/i.exec(value)

    if (!match) {
        return {error: 'Character profile image must be a base64 data URL', status: 400}
    }

    try {
        const binary = atob(match[2])
        const bytes = new Uint8Array(binary.length)

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index)
        }

        return {
            contentType: match[1].toLowerCase(),
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

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('unique')
}

function normalizeMediaRating(value: unknown): 'sfw' | 'nsfw' | null {
    return value === 'sfw' || value === 'nsfw' ? value : null
}

function normalizeUploadIdentifier(value: unknown, label: string): { value: string } | { error: string } {
    if (typeof value !== 'string' || !value.trim()) {
        return {error: `${label} is required`}
    }

    const normalized = value.trim()

    if (normalized.length > 128 || !/^[A-Za-z0-9_-]+$/.test(normalized)) {
        return {error: `${label} is invalid`}
    }

    return {value: normalized}
}

function normalizeGalleryImageContentType(value: unknown): { contentType: string } | { error: string } {
    if (typeof value !== 'string') {
        return {error: 'Image content type is required'}
    }

    const contentType = value.trim().toLowerCase()

    if (!GALLERY_IMAGE_ALLOWED_CONTENT_TYPES.has(contentType)) {
        return {error: 'Image must be PNG, JPG, GIF, WebP, or AVIF'}
    }

    return {contentType}
}

function normalizeGalleryImageDimensions(widthValue: unknown, heightValue: unknown): {
    width: number
    height: number
} | { error: string } {
    const width = Number(widthValue)
    const height = Number(heightValue)

    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
        return {error: 'Image dimensions are required'}
    }

    return {width, height}
}

function parseChunkedUploadInits(value: unknown): { uploads: ChunkedUploadInit[] } | { error: string } {
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

function parseCompletedChunkedUpload(value: unknown): {
    uploadId: string
    imageKey: string
    contentType: string
    width: number
    height: number
    parts: R2UploadedPart[]
} | { error: string } | null {
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

function readGalleryImageDimensions(bytes: Uint8Array, contentType: string): { width: number; height: number } | null {
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

    return null
}

function readGifDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (bytes.length < 10) {
        return null
    }

    const signature = String.fromCharCode(...bytes.slice(0, 6))

    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
        return null
    }

    return {
        width: bytes[6] | (bytes[7] << 8),
        height: bytes[8] | (bytes[9] << 8),
    }
}

function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return null
    }

    let offset = 2

    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            return null
        }

        const marker = bytes[offset + 1]
        offset += 2

        if (marker === 0xd9 || marker === 0xda) {
            return null
        }

        const length = (bytes[offset] << 8) | bytes[offset + 1]

        if (length < 2 || offset + length > bytes.length) {
            return null
        }

        if (
            (marker >= 0xc0 && marker <= 0xc3)
            || (marker >= 0xc5 && marker <= 0xc7)
            || (marker >= 0xc9 && marker <= 0xcb)
            || (marker >= 0xcd && marker <= 0xcf)
        ) {
            return {
                height: (bytes[offset + 3] << 8) | bytes[offset + 4],
                width: (bytes[offset + 5] << 8) | bytes[offset + 6],
            }
        }

        offset += length
    }

    return null
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

    return {
        imageKey: upload.imageKey,
        contentType: upload.contentType,
        width: upload.width,
        height: upload.height,
        byteSize: completedObject.size,
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
