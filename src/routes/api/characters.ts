import {Hono} from 'hono'
import type {Context} from 'hono'
import {getCurrentUser, toSqlTimestamp, type CurrentUser} from '../../lib/auth/session'
import {
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterProfileImageObjectKey,
    characterProfileImageUrl,
} from '../../lib/media/url'
import {getPngDimensions} from '../../lib/media/png'
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

type GalleryLayoutRequest = {
    fullsizeLastRow?: unknown
    tabs?: unknown
}

type ChunkedMediaInitRequest = {
    ratings?: unknown
}

type ChunkedMediaCompleteRequest = {
    mediaId?: unknown
    sfwUpload?: unknown
    nsfwUpload?: unknown
    sfwArtist?: unknown
    nsfwArtist?: unknown
    removeSfw?: unknown
    removeNsfw?: unknown
}

type MediaRating = 'sfw' | 'nsfw'

type CompletedChunkedUpload = {
    uploadId: string
    imageKey: string
    parts: R2UploadedPart[]
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

type GalleryPng = {
    bytes: Uint8Array
    width: number
    height: number
}

type ParsedChunkedMediaComplete = {
    body: ChunkedMediaCompleteRequest
    artists: ParsedMediaArtists
    sfwUpload: CompletedChunkedUpload | null
    nsfwUpload: CompletedChunkedUpload | null
}

type ParsedValidatedMediaForm = {
    parsed: ParsedMediaForm
    artists: ParsedMediaArtists
    sfwImage: GalleryPng | null
    nsfwImage: GalleryPng | null
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
    created_at: string
    updated_at: string
}

type CharacterMediaRecord = {
    id: string
    user_id: string
    character_id: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_artist: string
    nsfw_artist: string
    sfw_width: number | null
    sfw_height: number | null
    sfw_byte_size: number | null
    nsfw_width: number | null
    nsfw_height: number | null
    nsfw_byte_size: number | null
    created_at: string
    updated_at: string
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
const DISPLAY_NAME_ALLOWED_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _'.()-]*$/
const DISPLAY_NAME_RULES = 'letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses'
const DUPLICATE_CHARACTER_NAME_ERROR = 'Character name already exists on this account'
const GALLERY_PNG_HTTP_METADATA = {
    cacheControl: 'public, max-age=31536000, immutable',
    contentType: 'image/png',
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
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
        return c.json({error: 'Character profile image upload is too large'}, 413)
    }

    const character = await getOwnedCharacter(c.env.DB, currentUser.id, c.req.param('id') ?? '')

    if (!character) {
        return c.json({error: 'Character not found'}, 404)
    }

    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('multipart/form-data')) {
        return c.json({error: 'Multipart form data is required'}, 400)
    }

    const form = await c.req.formData()
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

characterRoutes.post('/:id/media/chunked/init', async (c) => {
    const owned = await requireOwnedCharacter(c)

    if (owned instanceof Response) {
        return owned
    }

    const {currentUser, character} = owned

    let body: ChunkedMediaInitRequest

    try {
        body = await c.req.json<ChunkedMediaInitRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const ratings = parseChunkedUploadRatings(body.ratings)

    if ('error' in ratings) {
        return c.json({error: ratings.error}, 400)
    }

    const mediaId = crypto.randomUUID()
    const uploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId, ratings.ratings)

    return c.json({mediaId, uploads})
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
    const uploadId = c.req.param('uploadId')
    const partNumber = Number(c.req.param('partNumber'))

    if ('error' in mediaId) {
        return c.json({error: mediaId.error}, 400)
    }

    if ('error' in imageKey) {
        return c.json({error: imageKey.error}, 400)
    }

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
        return c.json({error: 'Part number must be between 1 and 10000'}, 400)
    }

    if (!c.req.raw.body) {
        return c.json({error: 'Chunk body is required'}, 400)
    }

    const objectKey = characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, imageKey.value, rating)
    const upload = c.env.MEDIA_BUCKET.resumeMultipartUpload(objectKey, uploadId)
    const uploadedPart = await upload.uploadPart(partNumber, c.req.raw.body)

    return c.json(uploadedPart)
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

    const {artists, sfwUpload, nsfwUpload} = complete

    if (!sfwUpload && !nsfwUpload) {
        return c.json({error: 'At least one image is required'}, 400)
    }

    const completedKeys: string[] = []

    try {
        let sfwImage: { imageKey: string; width: number; height: number; byteSize: number } | null = null
        let nsfwImage: { imageKey: string; width: number; height: number; byteSize: number } | null = null

        if (sfwUpload && !('error' in sfwUpload)) {
            sfwImage = await completeChunkedGalleryUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, sfwUpload, 'sfw', 'SFW image')
            completedKeys.push(characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, sfwImage.imageKey, 'sfw'))
        }

        if (nsfwUpload && !('error' in nsfwUpload)) {
            nsfwImage = await completeChunkedGalleryUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, mediaId.value, nsfwUpload, 'nsfw', 'NSFW image')
            completedKeys.push(characterMediaImageObjectKey(currentUser.id, character.id, mediaId.value, nsfwImage.imageKey, 'nsfw'))
        }

        const now = toSqlTimestamp(new Date())
        const media: CharacterMediaRecord = {
            id: mediaId.value,
            user_id: currentUser.id,
            character_id: character.id,
            sfw_image_key: sfwImage?.imageKey ?? null,
            nsfw_image_key: nsfwImage?.imageKey ?? null,
            sfw_artist: artists.sfwArtist,
            nsfw_artist: artists.nsfwArtist,
            sfw_width: sfwImage?.width ?? null,
            sfw_height: sfwImage?.height ?? null,
            sfw_byte_size: sfwImage?.byteSize ?? null,
            nsfw_width: nsfwImage?.width ?? null,
            nsfw_height: nsfwImage?.height ?? null,
            nsfw_byte_size: nsfwImage?.byteSize ?? null,
            created_at: now,
            updated_at: now,
        }

        await c.env.DB.prepare(
            `INSERT INTO character_media (
                 id, user_id, character_id,
                 sfw_image_key, nsfw_image_key, sfw_artist, nsfw_artist,
                 sfw_width, sfw_height, sfw_byte_size,
                 nsfw_width, nsfw_height, nsfw_byte_size,
                 created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                media.id,
                media.user_id,
                media.character_id,
                media.sfw_image_key,
                media.nsfw_image_key,
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

    let body: ChunkedMediaInitRequest

    try {
        body = await c.req.json<ChunkedMediaInitRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const ratings = parseChunkedUploadRatings(body.ratings)

    if ('error' in ratings) {
        return c.json({error: ratings.error}, 400)
    }

    const uploads = await createChunkedGalleryUploads(c.env.MEDIA_BUCKET, currentUser.id, character.id, media.id, ratings.ratings)

    return c.json({mediaId: media.id, uploads})
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

    const {artists, sfwUpload, nsfwUpload} = complete
    const removeSfw = normalizePermanentConfirmation(complete.body.removeSfw)
    const removeNsfw = normalizePermanentConfirmation(complete.body.removeNsfw)
    const finalHasSfw = Boolean((media.sfw_image_key && !removeSfw && !sfwUpload) || sfwUpload)
    const finalHasNsfw = Boolean((media.nsfw_image_key && !removeNsfw && !nsfwUpload) || nsfwUpload)

    if (!finalHasSfw && !finalHasNsfw) {
        return c.json({error: 'At least one image must remain on media'}, 400)
    }

    const uploadedKeys: string[] = []
    const deletedKeys: string[] = []
    const nextMedia: CharacterMediaRecord = {
        ...media,
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        updated_at: toSqlTimestamp(new Date()),
    }

    try {
        applyMediaVariantRemovals(currentUser.id, character.id, media, nextMedia, removeSfw, removeNsfw, deletedKeys)

        if (sfwUpload) {
            await replaceMediaVariantWithChunkedUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, sfwUpload, 'sfw', uploadedKeys, deletedKeys)
        }

        if (nsfwUpload) {
            await replaceMediaVariantWithChunkedUpload(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, nsfwUpload, 'nsfw', uploadedKeys, deletedKeys)
        }

        await c.env.DB.prepare(
            `UPDATE character_media
             SET sfw_image_key = ?,
                 nsfw_image_key = ?,
                 sfw_artist = ?,
                 nsfw_artist = ?,
                 sfw_width = ?,
                 sfw_height = ?,
                 sfw_byte_size = ?,
                 nsfw_width = ?,
                 nsfw_height = ?,
                 nsfw_byte_size = ?,
                 updated_at = ?
             WHERE id = ?
               AND character_id = ?
               AND user_id = ?`,
        )
            .bind(
                nextMedia.sfw_image_key,
                nextMedia.nsfw_image_key,
                nextMedia.sfw_artist,
                nextMedia.nsfw_artist,
                nextMedia.sfw_width,
                nextMedia.sfw_height,
                nextMedia.sfw_byte_size,
                nextMedia.nsfw_width,
                nextMedia.nsfw_height,
                nextMedia.nsfw_byte_size,
                nextMedia.updated_at,
                nextMedia.id,
                character.id,
                currentUser.id,
            )
            .run()

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
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        sfw_width: sfwImage?.width ?? null,
        sfw_height: sfwImage?.height ?? null,
        sfw_byte_size: sfwImage?.bytes.byteLength ?? null,
        nsfw_width: nsfwImage?.width ?? null,
        nsfw_height: nsfwImage?.height ?? null,
        nsfw_byte_size: nsfwImage?.bytes.byteLength ?? null,
        created_at: now,
        updated_at: now,
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO character_media (
                id, user_id, character_id,
                sfw_image_key, nsfw_image_key, sfw_artist, nsfw_artist,
                sfw_width, sfw_height, sfw_byte_size,
                nsfw_width, nsfw_height, nsfw_byte_size,
                created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(
                media.id,
                media.user_id,
                media.character_id,
                media.sfw_image_key,
                media.nsfw_image_key,
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
    const nextMedia: CharacterMediaRecord = {
        ...media,
        sfw_artist: artists.sfwArtist,
        nsfw_artist: artists.nsfwArtist,
        updated_at: toSqlTimestamp(new Date()),
    }

    applyMediaVariantRemovals(currentUser.id, character.id, media, nextMedia, removeSfw, removeNsfw, deletedKeys)

    if (sfwImage) {
        await replaceMediaVariantWithPng(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, sfwImage, 'sfw', uploadedKeys, deletedKeys)
    }

    if (nsfwImage) {
        await replaceMediaVariantWithPng(c.env.MEDIA_BUCKET, currentUser.id, character.id, media, nextMedia, nsfwImage, 'nsfw', uploadedKeys, deletedKeys)
    }

    try {
        await c.env.DB.prepare(
            `UPDATE character_media
             SET sfw_image_key = ?,
                 nsfw_image_key = ?,
                 sfw_artist = ?,
                 nsfw_artist = ?,
                 sfw_width = ?,
                 sfw_height = ?,
                 sfw_byte_size = ?,
                 nsfw_width = ?,
                 nsfw_height = ?,
                 nsfw_byte_size = ?,
                 updated_at = ?
             WHERE id = ?
               AND character_id = ?
               AND user_id = ?`,
        )
            .bind(
                nextMedia.sfw_image_key,
                nextMedia.nsfw_image_key,
                nextMedia.sfw_artist,
                nextMedia.nsfw_artist,
                nextMedia.sfw_width,
                nextMedia.sfw_height,
                nextMedia.sfw_byte_size,
                nextMedia.nsfw_width,
                nextMedia.nsfw_height,
                nextMedia.nsfw_byte_size,
                nextMedia.updated_at,
                nextMedia.id,
                character.id,
                currentUser.id,
            )
            .run()
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
        `SELECT id, user_id, name, profile_image_key, folder_id, sort_order, created_at, updated_at
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

function toPublicMedia(baseUrl: string, media: CharacterMediaRecord) {
    return {
        id: media.id,
        sfwImageKey: media.sfw_image_key,
        nsfwImageKey: media.nsfw_image_key,
        sfwImageUrl: media.sfw_image_key
            ? characterMediaImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw')
            : null,
        nsfwImageUrl: media.nsfw_image_key
            ? characterMediaImageUrl(baseUrl, media.user_id, media.character_id, media.id, media.nsfw_image_key, 'nsfw')
            : null,
        sfwArtist: media.sfw_artist,
        nsfwArtist: media.nsfw_artist,
        sfwWidth: media.sfw_width,
        sfwHeight: media.sfw_height,
        sfwByteSize: media.sfw_byte_size,
        nsfwWidth: media.nsfw_width,
        nsfwHeight: media.nsfw_height,
        nsfwByteSize: media.nsfw_byte_size,
        createdAt: media.created_at,
        updatedAt: media.updated_at,
    }
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

    return {
        body,
        artists,
        sfwUpload: uploads.sfwUpload,
        nsfwUpload: uploads.nsfwUpload,
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
    ratings: MediaRating[],
): Promise<Partial<Record<MediaRating, { uploadId: string; imageKey: string; chunkSize: number }>>> {
    const uploads: Partial<Record<MediaRating, { uploadId: string; imageKey: string; chunkSize: number }>> = {}

    for (const rating of ratings) {
        const imageKey = crypto.randomUUID()
        const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, rating)
        const upload = await bucket.createMultipartUpload(objectKey, {
            httpMetadata: GALLERY_PNG_HTTP_METADATA,
        })

        uploads[rating] = {
            uploadId: upload.uploadId,
            imageKey,
            chunkSize: GALLERY_CHUNK_SIZE,
        }
    }

    return uploads
}

function existingMediaVariantKey(media: CharacterMediaRecord, rating: MediaRating): string | null {
    return rating === 'sfw' ? media.sfw_image_key : media.nsfw_image_key
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
        deletedKeys.push(characterMediaImageObjectKey(userId, characterId, media.id, imageKey, rating))
    }
}

function clearMediaVariant(nextMedia: CharacterMediaRecord, rating: MediaRating): void {
    if (rating === 'sfw') {
        nextMedia.sfw_image_key = null
        nextMedia.sfw_width = null
        nextMedia.sfw_height = null
        nextMedia.sfw_byte_size = null
        return
    }

    nextMedia.nsfw_image_key = null
    nextMedia.nsfw_width = null
    nextMedia.nsfw_height = null
    nextMedia.nsfw_byte_size = null
}

function assignMediaVariant(
    nextMedia: CharacterMediaRecord,
    rating: MediaRating,
    image: { imageKey: string; width: number; height: number; byteSize: number },
): void {
    if (rating === 'sfw') {
        nextMedia.sfw_image_key = image.imageKey
        nextMedia.sfw_width = image.width
        nextMedia.sfw_height = image.height
        nextMedia.sfw_byte_size = image.byteSize
        return
    }

    nextMedia.nsfw_image_key = image.imageKey
    nextMedia.nsfw_width = image.width
    nextMedia.nsfw_height = image.height
    nextMedia.nsfw_byte_size = image.byteSize
}

async function replaceMediaVariantWithChunkedUpload(
    bucket: R2Bucket,
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
    assignMediaVariant(nextMedia, rating, image)
    uploadedKeys.push(characterMediaImageObjectKey(userId, characterId, media.id, image.imageKey, rating))
}

async function replaceMediaVariantWithPng(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    media: CharacterMediaRecord,
    nextMedia: CharacterMediaRecord,
    image: GalleryPng,
    rating: MediaRating,
    uploadedKeys: string[],
    deletedKeys: string[],
): Promise<void> {
    queueExistingMediaVariantDelete(userId, characterId, media, rating, deletedKeys)
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaImageObjectKey(userId, characterId, media.id, imageKey, rating)

    await putGalleryPngObject(bucket, objectKey, image.bytes)

    assignMediaVariant(nextMedia, rating, {
        imageKey,
        width: image.width,
        height: image.height,
        byteSize: image.bytes.byteLength,
    })
    uploadedKeys.push(objectKey)
}

async function putNewMediaVariant(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    image: GalleryPng,
    rating: MediaRating,
    uploadedKeys: string[],
): Promise<string> {
    const imageKey = crypto.randomUUID()
    const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, rating)

    await putGalleryPngObject(bucket, objectKey, image.bytes)

    uploadedKeys.push(objectKey)
    return imageKey
}

async function putGalleryPngObject(bucket: R2Bucket, objectKey: string, bytes: Uint8Array): Promise<void> {
    await bucket.put(objectKey, bytes, {
        httpMetadata: GALLERY_PNG_HTTP_METADATA,
    })
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
    sfwImage: GalleryPng | null
    nsfwImage: GalleryPng | null
} | {
    error: string
    status: 400
}> {
    const sfwImage = parsed.sfwFile ? await validateGalleryPng(parsed.sfwFile, 'SFW image') : null
    const nsfwImage = parsed.nsfwFile ? await validateGalleryPng(parsed.nsfwFile, 'NSFW image') : null

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

    if (!DISPLAY_NAME_ALLOWED_PATTERN.test(name)) {
        return {error: `Character name may contain only ${DISPLAY_NAME_RULES}, and must start with a letter or number`}
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
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                nsfw_width,
                nsfw_height,
                nsfw_byte_size,
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
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                nsfw_width,
                nsfw_height,
                nsfw_byte_size,
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

async function validateGalleryPng(file: File, label: string): Promise<{
    bytes: Uint8Array
    width: number
    height: number
} | {
    error: string
    status: 400
}> {
    if (file.type !== 'image/png') {
        return {error: `${label} must be uploaded through the image converter`, status: 400}
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const dimensions = getPngDimensions(bytes)

    if (!dimensions) {
        return {error: `${label} must be a valid PNG image`, status: 400}
    }

    return {
        bytes,
        width: dimensions.width,
        height: dimensions.height,
    }
}

async function deleteCharacterMediaObjects(bucket: R2Bucket, media: CharacterMediaRecord): Promise<void> {
    const objectKeys: string[] = []

    if (media.sfw_image_key) {
        objectKeys.push(characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_image_key, 'sfw'))
    }

    if (media.nsfw_image_key) {
        objectKeys.push(characterMediaImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_image_key, 'nsfw'))
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

function parseChunkedUploadRatings(value: unknown): { ratings: ('sfw' | 'nsfw')[] } | { error: string } {
    if (!Array.isArray(value)) {
        return {error: 'Upload ratings are required'}
    }

    const ratings: ('sfw' | 'nsfw')[] = []

    for (const item of value) {
        const rating = normalizeMediaRating(item)

        if (!rating) {
            return {error: 'Upload ratings must be sfw or nsfw'}
        }

        if (!ratings.includes(rating)) {
            ratings.push(rating)
        }
    }

    if (ratings.length === 0) {
        return {error: 'At least one upload rating is required'}
    }

    return {ratings}
}

function parseCompletedChunkedUpload(value: unknown): {
    uploadId: string
    imageKey: string
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

    if (!uploadId) {
        return {error: 'upload id is required'}
    }

    if ('error' in imageKey) {
        return {error: imageKey.error}
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
        parts,
    }
}

async function completeChunkedGalleryUpload(
    bucket: R2Bucket,
    userId: string,
    characterId: string,
    mediaId: string,
    upload: { uploadId: string; imageKey: string; parts: R2UploadedPart[] },
    rating: 'sfw' | 'nsfw',
    label: string,
): Promise<{ imageKey: string; width: number; height: number; byteSize: number }> {
    const objectKey = characterMediaImageObjectKey(userId, characterId, mediaId, upload.imageKey, rating)
    const multipartUpload = bucket.resumeMultipartUpload(objectKey, upload.uploadId)
    const completedObject = await multipartUpload.complete(upload.parts)

    try {
        const dimensions = await getGalleryPngDimensionsFromR2(bucket, objectKey, label)

        return {
            imageKey: upload.imageKey,
            width: dimensions.width,
            height: dimensions.height,
            byteSize: completedObject.size,
        }
    } catch (error) {
        await deleteR2Objects(bucket, [objectKey])
        throw error
    }
}

async function getGalleryPngDimensionsFromR2(
    bucket: R2Bucket,
    objectKey: string,
    label: string,
): Promise<{ width: number; height: number }> {
    const object = await bucket.get(objectKey, {
        range: {
            offset: 0,
            length: 33,
        },
    })

    if (!object) {
        throw new Error(`${label} could not be read after upload`)
    }

    const dimensions = getPngDimensions(new Uint8Array(await object.arrayBuffer()))

    if (!dimensions) {
        throw new Error(`${label} must be a valid PNG image`)
    }

    return dimensions
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
