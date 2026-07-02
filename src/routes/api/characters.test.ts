import {describe, expect, it, vi} from 'vitest'
import {apiRoutes} from '../api'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockR2Bucket} from '../../test/mockR2'
import {
    createGifFile,
    createMalformedWebpFile,
    createOversizedWebpFile,
    createPaddedWebpDataUrl,
    createPngFile,
    createWebpDataUrl,
    createWebpFile,
} from '../../test/imageFixtures'
import {createRequestHeaders, type TestRequestOptions} from '../../test/request'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const currentUserRecord = {
    id: 'current-user',
    email: 'test@example.com',
    username: 'testuser',
    profile_photo_key: null,
    bio: '',
}

type CharacterResponse = {
    character: {
        id: string
        name: string
        profileImageKey: string | null
        profileImageUrl: string | null
        folderId: string | null
        createdAt: string
        updatedAt: string
    }
}

type FolderResponse = {
    folder: {
        id: string
        name: string
        parentFolderId: string | null
        createdAt: string
        updatedAt: string
    }
}

type CharacterRequestOptions = TestRequestOptions & {
    mediaBucket?: R2Bucket
    imagesBinding?: ImagesBinding
}

type ChunkedSfwInitBody = {
    mediaId: string
    uploads: {
        sfw: {
            uploadId: string
            imageKey: string
            contentType: string
        }
    }
}

function requestEnv(db: D1Database, mediaBucket?: R2Bucket, imagesBinding = createMockImagesBinding()) {
    return {
        DB: db,
        MEDIA_BUCKET: mediaBucket ?? createMockR2Bucket(),
        IMAGES: imagesBinding,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    }
}

function expectStoredCharacterProfileImage(mediaBucket: R2Bucket, character: CharacterResponse['character']): void {
    expect(character.profileImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
    expect(character.profileImageUrl).toBe(
        `${mediaPublicBaseUrl}/characters/current-user/${character.id}/profile/${character.profileImageKey}.webp`,
    )
    expect(mediaBucket.put).toHaveBeenCalledWith(
        `characters/current-user/${character.id}/profile/${character.profileImageKey}.webp`,
        expect.any(Uint8Array),
        {
            httpMetadata: {
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'image/webp',
            },
        },
    )
}

function createPreviewPayload(width: number, height: number) {
    return {
        data: createWebpDataUrl(width, height),
        contentType: 'image/webp',
        width,
        height,
    }
}

async function createChunkedSfwUploadTestContext() {
    const sessionToken = 'session-token'
    const mediaBucket = createMockR2Bucket()
    const character = createCharacterRecord()
    const {db} = createMockDb({
        firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
    })
    const csrfToken = await createCsrfToken(sessionToken)

    const initResponse = await initChunkedMedia(character.id, {
        ratings: ['sfw'],
    }, db, {
        mediaBucket,
        sessionToken,
        csrfToken,
    })
    const initBody = await initResponse.json() as ChunkedSfwInitBody

    return {
        sessionToken,
        mediaBucket,
        character,
        db,
        csrfToken,
        initBody,
    }
}

async function postCharacter(
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request('https://example.com/characters', {
        method: 'POST',
        body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function postFolder(
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request('https://example.com/characters/folders', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function postTree(
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request('https://example.com/characters/tree', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function initChunkedMedia(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}/media/chunked/init`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function putChunkedMediaPart(
    characterId: string,
    mediaId: string,
    rating: 'sfw' | 'nsfw',
    uploadId: string,
    partNumber: number,
    imageKey: string,
    body: BodyInit,
    db: D1Database,
    options: CharacterRequestOptions = {},
    contentType = 'image/png',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/chunked/${mediaId}/${rating}/${encodeURIComponent(uploadId)}/${partNumber}?imageKey=${encodeURIComponent(imageKey)}&contentType=${encodeURIComponent(contentType)}`,
        {
            method: 'PUT',
            body,
            headers: createRequestHeaders(body, options, false),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function completeChunkedMedia(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}/media/chunked/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function completeToyhouseImportItem(
    itemId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/toyhouse-import-items/${itemId}/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function failToyhouseImportItem(
    itemId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/toyhouse-import-items/${itemId}/fail`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function postProfileImage(
    characterId: string,
    body: FormData,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}/profile-image`, {
        method: 'POST',
        body,
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function patchCharacter(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function putGallery(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}/gallery`, {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function deleteCharacter(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}`, {
        method: 'DELETE',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

async function deleteFolder(
    folderId: string,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/folders/${folderId}`, {
        method: 'DELETE',
        headers: createRequestHeaders(undefined, options, false),
    }, requestEnv(db, options.mediaBucket, options.imagesBinding))
}

describe('POST /characters/tree', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postTree({
            items: [],
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postTree({
            items: [],
        }, db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postTree('{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 for malformed tree items', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postTree({
            items: [{type: 'folder', id: 'main', children: [{type: 'folder', id: 'main'}]}],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Tree item ids must be unique',
        })
    })

    it('returns 400 when a submitted folder is not owned by the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [
                [],
                [],
            ],
        })

        const response = await postTree({
            items: [{type: 'folder', id: 'other-users-folder'}],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Tree contains folders that do not belong to the current user',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('returns 400 when a submitted character is not owned by the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [
                [],
                [],
            ],
        })

        const response = await postTree({
            items: [{type: 'character', id: 'other-users-character'}],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Tree contains characters that do not belong to the current user',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('returns 400 when tree payloads are too large', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postTree({
            items: Array.from({length: 501}, (_, index) => ({type: 'character', id: `character-${index}`})),
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Tree contains too many items',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('chunks tree ownership validation to stay under D1 SQL variable limits', async () => {
        const sessionToken = 'session-token'
        const folders = Array.from({length: 120}, (_, index) => `folder-${index}`)
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [
                folders.slice(0, 50).map((id) => ({id})),
                folders.slice(50, 100).map((id) => ({id})),
                folders.slice(100).map((id) => ({id})),
            ],
        })

        const response = await postTree({
            items: folders.map((id) => ({type: 'folder', id})),
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const ownershipQueries = boundStatements.filter((statement) => (
            statement.sql.includes('FROM character_folders') && statement.sql.includes('id IN')
        ))

        expect(ownershipQueries).toHaveLength(3)
        expect(ownershipQueries.map((statement) => statement.binds.length)).toEqual([51, 51, 21])
        expect(db.batch).toHaveBeenCalledTimes(1)
    })

    it('updates folder parents, character folders, and sort order from the tree JSON', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [
                [{id: 'main'}, {id: 'story'}],
                [{id: 'razeth'}, {id: 'vyn'}, {id: 'kitty'}],
            ],
        })

        const response = await postTree({
            items: [
                {
                    type: 'folder',
                    id: 'main',
                    children: [
                        {type: 'character', id: 'razeth'},
                        {type: 'folder', id: 'story', children: [{type: 'character', id: 'vyn'}]},
                    ],
                },
                {type: 'character', id: 'kitty'},
            ],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(8)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['current-user', 'main', 'story'])
        expect(boundStatements[2]?.sql).toContain('FROM characters')
        expect(boundStatements[2]?.binds).toEqual(['current-user', 'razeth', 'vyn', 'kitty'])

        const updateStatements = boundStatements.filter((statement) => statement.sql.includes('UPDATE'))

        expect(updateStatements).toHaveLength(5)
        expect(updateStatements[0]?.sql).toContain('UPDATE character_folders')
        expect(updateStatements[0]?.binds[0]).toBeNull()
        expect(updateStatements[0]?.binds[1]).toBe(0)
        expect(updateStatements[0]?.binds[3]).toBe('main')
        expect(updateStatements[1]?.sql).toContain('UPDATE characters')
        expect(updateStatements[1]?.binds[0]).toBe('main')
        expect(updateStatements[1]?.binds[1]).toBe(0)
        expect(updateStatements[1]?.binds[3]).toBe('razeth')
        expect(updateStatements[2]?.binds[0]).toBe('main')
        expect(updateStatements[2]?.binds[1]).toBe(1)
        expect(updateStatements[2]?.binds[3]).toBe('story')
        expect(updateStatements[3]?.binds[0]).toBe('story')
        expect(updateStatements[3]?.binds[1]).toBe(0)
        expect(updateStatements[3]?.binds[3]).toBe('vyn')
        expect(updateStatements[4]?.binds[0]).toBeNull()
        expect(updateStatements[4]?.binds[1]).toBe(1)
        expect(updateStatements[4]?.binds[3]).toBe('kitty')
    })
})

describe('POST /characters/folders', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postFolder({
            name: 'Main Characters',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postFolder({
            name: 'Main Characters',
        }, db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder('{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when the folder name is missing', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            parentFolderId: 'root',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder name is required',
        })
    })

    it('returns 400 when the folder name is too long', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            name: 'a'.repeat(81),
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder name must be 80 characters or fewer',
        })
    })

    it('returns 400 when the folder name contains URL-hostile characters', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            name: 'Story/Arc',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder name may contain only letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
        })
    })

    it('returns 400 when the folder name does not start with a letter or number', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            name: '-Story Arc',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder name may contain only letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
        })
    })

    it('returns 400 when the parent folder id is invalid', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            name: 'Main Characters',
            parentFolderId: '../bad',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder must be root or a valid folder id',
        })
    })

    it('returns 404 when the parent folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await postFolder({
            name: 'Story Arc',
            parentFolderId: 'missing-parent',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Parent folder not found',
        })
    })

    it('creates a root folder', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder({
            name: ' Main Characters ',
            parentFolderId: 'root',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)

        const body = await response.json() as FolderResponse
        expect(body.folder.id).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.folder.name).toBe('Main Characters')
        expect(body.folder.parentFolderId).toBeNull()
        expect(body.folder.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        expect(body.folder.updatedAt).toBe(body.folder.createdAt)

        expect(boundStatements).toHaveLength(2)
        expect(boundStatements[0]?.sql).toContain('INNER JOIN users')
        expect(boundStatements[1]?.sql).toContain(['INSERT INTO', 'character_folders'].join(' '))
        expect(boundStatements[1]?.binds).toEqual([
            body.folder.id,
            currentUserRecord.id,
            'Main Characters',
            null,
            0,
            body.folder.createdAt,
            body.folder.updatedAt,
        ])
    })

    it('creates a nested folder', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, {id: 'main'}],
        })

        const response = await postFolder({
            name: 'Story Arc',
            parentFolderId: 'main',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)

        const body = await response.json() as FolderResponse
        expect(body.folder.name).toBe('Story Arc')
        expect(body.folder.parentFolderId).toBe('main')
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['main', currentUserRecord.id])
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'character_folders'].join(' '))
        expect(boundStatements[2]?.binds[3]).toBe('main')
    })
})

describe('POST /characters', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postCharacter({
            name: 'Vyn',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postCharacter({
            name: 'Vyn',
        }, db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter('{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when the character name is missing', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            folderId: 'root',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name is required',
        })
    })

    it('returns 400 when the character name is too long', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: 'a'.repeat(81),
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name must be 80 characters or fewer',
        })
    })

    it('returns 400 when the character name contains URL-hostile characters', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: 'Vyn#1',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must include at least one letter or number',
        })
    })

    it('returns 400 when the character name does not include a letter or number', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: '---',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must include at least one letter or number',
        })
    })

    it('returns 400 when the folder id is invalid', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: 'Vyn',
            folderId: '../bad',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder must be root or a valid folder id',
        })
    })

    it('returns 400 when the profile image is missing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: ' Vyn ',
            folderId: 'root',
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image is required',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
        expect(boundStatements).toHaveLength(1)
    })

    it('returns 404 when the selected folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-folder', 'missing-folder')
        form.set('new-character-profile-image', createWebpFile())

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('creates a root character from JSON with a WebP data URL', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: ' Vyn "The Hawk" ',
            folderId: 'root',
            profileImageData: createWebpDataUrl(),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)

        const body = await response.json() as CharacterResponse
        expect(body.character.name).toBe('Vyn "The Hawk"')
        expect(body.character.folderId).toBeNull()
        expectStoredCharacterProfileImage(mediaBucket, body.character)
        expect(boundStatements).toHaveLength(2)
        expect(boundStatements[1]?.sql).toContain(['INSERT INTO', 'characters'].join(' '))
        expect(boundStatements[1]?.binds[2]).toBe('Vyn "The Hawk"')
        expect(boundStatements[1]?.binds[3]).toBe(body.character.profileImageKey)
        expect(boundStatements[1]?.binds[4]).toBeNull()
        expect(boundStatements[1]?.binds[5]).toBe(0)
    })

    it('creates characters with allowed punctuation at the start and within the name', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: ' "Ivo" ',
            folderId: 'root',
            profileImageData: createWebpDataUrl(),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)

        const body = await response.json() as CharacterResponse
        expect(body.character.name).toBe('"Ivo"')
        expect(boundStatements[1]?.sql).toContain(['INSERT INTO', 'characters'].join(' '))
        expect(boundStatements[1]?.binds[2]).toBe('"Ivo"')
    })

    it('creates a character with a profile image from the reference form fields', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story-arc'}],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', ' Ren ')
        form.set('new-character-folder', 'story-arc')
        form.set('new-character-profile-image', createWebpFile())

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(201)

        const body = await response.json() as CharacterResponse
        expect(body.character.name).toBe('Ren')
        expect(body.character.folderId).toBe('story-arc')
        expectStoredCharacterProfileImage(mediaBucket, body.character)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['story-arc', currentUserRecord.id])
        expect(boundStatements[2]?.binds[2]).toBe('Ren')
        expect(boundStatements[2]?.binds[3]).toBe(body.character.profileImageKey)
        expect(boundStatements[2]?.binds[4]).toBe('story-arc')
    })

    it('rejects unsupported profile image types', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile(512, 512, 'image/png'))

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image must be a WebP image',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile images that are not exactly 512x512', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile(1024, 1024))

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image must be exactly 512x512 pixels',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile images that are larger than 2 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createOversizedWebpFile())

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image must be 2 MB or smaller',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects malformed WebP profile images', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createMalformedWebpFile())

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image must be a valid WebP image',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile image upload requests that are larger than 3 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile())

        const response = await postCharacter(form, db, {
            contentLength: String((3 * 1024 * 1024) + 1),
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Character profile image upload is too large',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 409 when the character name already exists for the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            runError: new Error('UNIQUE constraint failed: characters.user_id, characters.name'),
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile())

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Character name already exists on this account',
        })
        const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
        expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
    })

    it('deletes the uploaded profile image when the D1 insert fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            runError: new Error('D1 insert failed'),
        })
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile())

        try {
            const response = await postCharacter(form, db, {
                mediaBucket,
                sessionToken,
            })

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/${uuidPattern}/profile/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
        } finally {
            error.mockRestore()
        }
    })
})

describe('PATCH /characters/:id', () => {
    it('updates a character name with quoted text and hyphenated numbers', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await patchCharacter(character.id, {
            name: 'DRD-5548 "Ivo"',
            description: 'Updated description',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const body = await response.json() as CharacterResponse
        expect(body.character.name).toBe('DRD-5548 "Ivo"')
        expect(boundStatements.at(-1)?.sql).toContain('UPDATE characters')
        expect(boundStatements.at(-1)?.binds[0]).toBe('DRD-5548 "Ivo"')
    })

    it('returns 409 when renaming to another character name on the same account', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            runError: new Error('UNIQUE constraint failed: characters.user_id, characters.name'),
        })

        const response = await patchCharacter(character.id, {
            name: 'Ren',
            description: 'Updated description',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Character name already exists on this account',
        })
    })
})

describe('POST /characters/:id/profile-image', () => {
    it('replaces the character profile image and deletes the old object', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord({
            profile_image_key: 'old-profile-image',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        const response = await postProfileImage(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const body = await response.json() as {
            profileImageKey: string
            profileImageUrl: string
        }

        expect(body.profileImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.profileImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/profile/${body.profileImageKey}.webp`)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/character-id/profile/${body.profileImageKey}.webp`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(boundStatements[2]?.sql).toContain('UPDATE characters')
        expect(boundStatements[2]?.binds[0]).toBe(body.profileImageKey)
        expect(boundStatements[2]?.binds[2]).toBe(character.id)
        expect(boundStatements[2]?.binds[3]).toBe(currentUserRecord.id)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/old-profile-image.webp')
    })

    it('rejects profile images that are not 512x512 WebP files', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('profileImage', createPngFile(512, 512))

        const response = await postProfileImage(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image must be a WebP image',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })
})

describe('character media uploads', () => {
    it('uploads gallery media through R2 multipart chunks', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(character.id, {
            ratings: ['sfw'],
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })
        expect(initResponse.status).toBe(200)
        const initBody = await initResponse.json() as {
            mediaId: string
            uploads: {
                sfw: {
                    uploadId: string
                    imageKey: string
                    contentType: string
                    chunkSize: number
                }
            }
        }
        expect(initBody.uploads.sfw.contentType).toBe('image/png')

        const pngFile = createPngFile(10000, 10000)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            pngFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(partResponse.status).toBe(200)
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            sfwArtist: 'Chunk Artist',
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/png',
                width: 10000,
                height: 10000,
                parts: [uploadedPart],
            },
            sfwPreview: createPreviewPayload(1600, 1600),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(201)
        const body = await completeResponse.json() as {
            media: {
                id: string
                sfwImageKey: string
                sfwImageUrl: string
                sfwContentType: string
                sfwWidth: number
                sfwHeight: number
                sfwByteSize: number
                sfwPreviewImageKey: string
                sfwPreviewImageUrl: string
                sfwPreviewWidth: number
                sfwPreviewHeight: number
                sfwPreviewByteSize: number
                sfwArtist: string
            }
        }

        expect(body.media.id).toBe(initBody.mediaId)
        expect(body.media.sfwImageKey).toBe(initBody.uploads.sfw.imageKey)
        expect(body.media.sfwContentType).toBe('image/png')
        expect(body.media.sfwImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`)
        expect(body.media.sfwWidth).toBe(10000)
        expect(body.media.sfwHeight).toBe(10000)
        expect(body.media.sfwByteSize).toBe(pngFile.size)
        expect(body.media.sfwPreviewImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.sfwPreviewImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/preview/${body.media.sfwPreviewImageKey}.webp`)
        expect(body.media.sfwPreviewWidth).toBe(1600)
        expect(body.media.sfwPreviewHeight).toBe(1600)
        expect(body.media.sfwPreviewByteSize).toBeGreaterThan(0)
        expect(body.media.sfwArtist).toBe('Chunk Artist')
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledTimes(1)
        expect(mediaBucket.resumeMultipartUpload).toHaveBeenCalledTimes(2)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/preview/${body.media.sfwPreviewImageKey}.webp`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(mediaBucket.get).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
            {
                range: {
                    offset: 0,
                    length: 1024 * 1024,
                },
            },
        )
        expect(boundStatements.at(-1)?.sql).toContain(['INSERT INTO', 'character_media'].join(' '))
        expect(boundStatements.at(-1)?.binds[5]).toBe('image/png')
        expect(boundStatements.at(-1)?.binds[9]).toBe(10000)
        expect(boundStatements.at(-1)?.binds[10]).toBe(10000)
        expect(boundStatements.at(-1)?.binds[12]).toBe(body.media.sfwPreviewImageKey)
        expect(boundStatements.at(-1)?.binds[13]).toBe(1600)
        expect(boundStatements.at(-1)?.binds[14]).toBe(1600)
    })

    it('rejects completed gallery uploads when the character is already at the media limit', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, {count: 500}],
        })

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: 'media-id',
            sfwUpload: {
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'image/png',
                width: 800,
                height: 600,
                parts: [{partNumber: 1, etag: 'etag'}],
            },
            sfwPreview: createPreviewPayload(800, 600),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(completeResponse.status).toBe(409)
        expect(await completeResponse.json()).toEqual({
            error: 'Characters can contain 500 gallery images or fewer',
        })
        expect(mediaBucket.resumeMultipartUpload).not.toHaveBeenCalled()
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))).toBe(false)
    })

    it('generates and stores blurred variants for NSFW gallery previews', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(character.id, {
            ratings: ['nsfw'],
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })
        const initBody = await initResponse.json() as {
            mediaId: string
            uploads: {
                nsfw: {
                    uploadId: string
                    imageKey: string
                    contentType: string
                }
            }
        }

        const pngFile = createPngFile(800, 600)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'nsfw',
            initBody.uploads.nsfw.uploadId,
            1,
            initBody.uploads.nsfw.imageKey,
            pngFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            nsfwUpload: {
                uploadId: initBody.uploads.nsfw.uploadId,
                imageKey: initBody.uploads.nsfw.imageKey,
                contentType: 'image/png',
                width: 800,
                height: 600,
                parts: [uploadedPart],
            },
            nsfwPreview: createPreviewPayload(800, 600),
        }, db, {
            imagesBinding,
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(201)
        const body = await completeResponse.json() as {
            media: {
                nsfwBlurImageKey: string
                nsfwBlurImageUrl: string
            }
        }
        expect(body.media.nsfwBlurImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.nsfwBlurImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/nsfw/blur/${body.media.nsfwBlurImageKey}.webp`)
        expect(imagesBinding.input).toHaveBeenCalledTimes(1)
        const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
        expect(imageTransformer.transform).toHaveBeenNthCalledWith(1, {width: 960, fit: 'scale-down'})
        expect(imageTransformer.transform).toHaveBeenNthCalledWith(2, {blur: 250})
        expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 85})
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/nsfw/blur/${body.media.nsfwBlurImageKey}.webp`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(boundStatements.at(-1)?.binds[23]).toBe(body.media.nsfwBlurImageKey)
    })

    it('rejects chunked gallery media when declared original dimensions do not match the stored image', async () => {
        const {
            sessionToken,
            mediaBucket,
            character,
            db,
            csrfToken,
            initBody
        } = await createChunkedSfwUploadTestContext()

        const pngFile = createPngFile(800, 600)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            pngFile,
            db,
            {mediaBucket, sessionToken, csrfToken},
        )
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/png',
                width: 1600,
                height: 1600,
                parts: [uploadedPart],
            },
            sfwPreview: createPreviewPayload(1600, 1600),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW image dimensions do not match the uploaded image',
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
    })

    it('rejects chunked gallery previews whose dimensions do not match the downscaled original', async () => {
        const {
            sessionToken,
            mediaBucket,
            character,
            db,
            csrfToken,
            initBody
        } = await createChunkedSfwUploadTestContext()

        const pngFile = createPngFile(10000, 5000)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            pngFile,
            db,
            {mediaBucket, sessionToken, csrfToken},
        )
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/png',
                width: 10000,
                height: 5000,
                parts: [uploadedPart],
            },
            sfwPreview: createPreviewPayload(1600, 1000),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW preview dimensions must match the uploaded image scaled to 1600px',
        })
    })

    it('rejects gallery previews that are too large for their dimensions', async () => {
        const {
            sessionToken,
            mediaBucket,
            character,
            db,
            csrfToken,
            initBody
        } = await createChunkedSfwUploadTestContext()

        const pngFile = createPngFile(1, 1)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            pngFile,
            db,
            {mediaBucket, sessionToken, csrfToken},
        )
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/png',
                width: 1,
                height: 1,
                parts: [uploadedPart],
            },
            sfwPreview: {
                data: createPaddedWebpDataUrl(1, 1, 5000),
                contentType: 'image/webp',
                width: 1,
                height: 1,
            },
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW preview is too large for its dimensions',
        })
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledTimes(1)
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('keeps chunked GIF gallery media as GIF', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(character.id, {
            uploads: [{rating: 'sfw', contentType: 'image/gif'}],
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })
        expect(initResponse.status).toBe(200)
        const initBody = await initResponse.json() as {
            mediaId: string
            uploads: {
                sfw: {
                    uploadId: string
                    imageKey: string
                    contentType: string
                    chunkSize: number
                }
            }
        }
        expect(initBody.uploads.sfw.contentType).toBe('image/gif')
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.gif`,
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/gif',
                },
            },
        )

        const gifFile = createGifFile(320, 240)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            gifFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
            'image/gif',
        )
        expect(partResponse.status).toBe(200)
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeChunkedMedia(character.id, {
            mediaId: initBody.mediaId,
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/gif',
                width: 320,
                height: 240,
                parts: [uploadedPart],
            },
            sfwPreview: createPreviewPayload(320, 240),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(201)
        const body = await completeResponse.json() as {
            media: {
                sfwContentType: string
                sfwImageUrl: string
                sfwWidth: number
                sfwHeight: number
                sfwByteSize: number
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwContentType).toBe('image/gif')
        expect(body.media.sfwImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.gif`)
        expect(body.media.sfwWidth).toBe(320)
        expect(body.media.sfwHeight).toBe(240)
        expect(body.media.sfwByteSize).toBe(gifFile.size)
        expect(body.media.sfwPreviewWidth).toBe(320)
        expect(body.media.sfwPreviewHeight).toBe(240)
        expect(boundStatements.at(-1)?.binds[5]).toBe('image/gif')
    })

    it('marks Toyhou.se import items and their jobs as failed', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await failToyhouseImportItem('toyhouse-import-item', {
            error: 'Toyhou.se returned 404',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[1]?.sql).toContain('UPDATE toyhouse_import_items')
        expect(boundStatements[1]?.binds[0]).toBe('failed')
        expect(boundStatements[1]?.binds[1]).toBe('Toyhou.se returned 404')
        expect(boundStatements[2]?.sql).toContain('UPDATE toyhouse_import_jobs')
        expect(boundStatements[2]?.binds[0]).toBe('failed')
    })

    it('completes Toyhou.se import items through chunked gallery media upload', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const importItem = {
            id: 'toyhouse-import-item',
            job_id: 'toyhouse-import-job',
            user_id: currentUserRecord.id,
            character_id: character.id,
            rating: 'sfw',
            status: 'pending',
            media_id: null,
        }
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, importItem, {count: 0}],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(character.id, {
            uploads: [{rating: 'sfw', contentType: 'image/png'}],
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })
        expect(initResponse.status).toBe(200)
        const initBody = await initResponse.json() as {
            mediaId: string
            uploads: {
                sfw: {
                    uploadId: string
                    imageKey: string
                    contentType: string
                    chunkSize: number
                }
            }
        }

        const pngFile = createPngFile(800, 600)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            pngFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(partResponse.status).toBe(200)
        const uploadedPart = await partResponse.json() as R2UploadedPart

        const completeResponse = await completeToyhouseImportItem(importItem.id, {
            mediaId: initBody.mediaId,
            sfwUpload: {
                uploadId: initBody.uploads.sfw.uploadId,
                imageKey: initBody.uploads.sfw.imageKey,
                contentType: 'image/png',
                width: 800,
                height: 600,
                parts: [uploadedPart],
            },
            sfwPreview: createPreviewPayload(800, 600),
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
        })

        expect(completeResponse.status).toBe(201)
        const body = await completeResponse.json() as {
            media: {
                id: string
                sfwImageKey: string
                sfwContentType: string
                sfwWidth: number
                sfwHeight: number
                sfwByteSize: number
                sfwPreviewImageKey: string
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
            skipped: boolean
        }
        expect(body.skipped).toBe(false)
        expect(body.media.id).toBe(initBody.mediaId)
        expect(body.media.sfwImageKey).toBe(initBody.uploads.sfw.imageKey)
        expect(body.media.sfwContentType).toBe('image/png')
        expect(body.media.sfwWidth).toBe(800)
        expect(body.media.sfwHeight).toBe(600)
        expect(body.media.sfwByteSize).toBe(pngFile.size)
        expect(body.media.sfwPreviewImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.sfwPreviewWidth).toBe(800)
        expect(body.media.sfwPreviewHeight).toBe(600)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE toyhouse_import_items'))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE toyhouse_import_jobs'))).toBe(true)
    })

    it('returns existing media when a Toyhou.se import item is already imported', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        const importItem = {
            id: 'toyhouse-import-item',
            job_id: 'toyhouse-import-job',
            user_id: currentUserRecord.id,
            character_id: character.id,
            rating: 'sfw',
            status: 'imported',
            media_id: media.id,
        }
        const {db} = createMockDb({
            firstResults: [currentUserRecord, importItem, media],
        })

        const response = await completeToyhouseImportItem(importItem.id, {}, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            media: {
                id: media.id,
                sfwImageKey: media.sfw_image_key,
            },
            skipped: true,
        })
        expect(mediaBucket.resumeMultipartUpload).not.toHaveBeenCalled()
        expect(db.batch).not.toHaveBeenCalled()
    })

})

describe('PUT /characters/:id/gallery', () => {
    it('rejects gallery layouts with no tabs', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(character.id, {
            tabs: [],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery must contain between 1 and 20 tabs',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('accepts gallery tabs without rows', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-one',
                name: 'default',
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            gallery: {
                tabs: [{
                    id: 'tab-one',
                    name: 'default',
                    rows: [],
                }],
            },
        })
        expect(db.batch).toHaveBeenCalledTimes(1)
    })

    it('rejects gallery rows containing more than five images', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-one',
                name: 'default',
                rows: [{
                    id: 'row-one',
                    mediaIds: ['media-one', 'media-two', 'media-three', 'media-four', 'media-five', 'media-six'],
                }],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery rows can contain 5 images or fewer',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects gallery layouts containing media outside the character', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-one',
                name: 'default',
                rows: [{
                    id: 'row-one',
                    mediaIds: ['other-media'],
                }],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery contains media that does not belong to this character',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('chunks gallery media ownership validation to stay under D1 SQL variable limits', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const mediaIds = Array.from({length: 120}, (_, index) => `media-${index}`)
        const rows = Array.from({length: 24}, (_, index) => ({
            id: `row-${index}`,
            mediaIds: mediaIds.slice(index * 5, (index + 1) * 5),
        }))
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [
                mediaIds.slice(0, 50).map((id) => ({id})),
                mediaIds.slice(50, 100).map((id) => ({id})),
                mediaIds.slice(100).map((id) => ({id})),
            ],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-one',
                name: 'default',
                rows,
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const ownershipQueries = boundStatements.filter((statement) => (
            statement.sql.includes('FROM character_media') && statement.sql.includes('id IN')
        ))

        expect(ownershipQueries).toHaveLength(3)
        expect(ownershipQueries.map((statement) => statement.binds.length)).toEqual([52, 52, 22])
        expect(db.batch).toHaveBeenCalledTimes(1)
    })

    it('saves tab-only gallery layouts as normalized JSON structure', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-one',
                name: 'default',
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            gallery: {
                tabs: [{
                    id: 'tab-one',
                    name: 'default',
                    rows: [],
                }],
            },
        })
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')))).toBe(false)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_row_media'].join(' ')))).toBe(false)
    })

    it('persists gallery tabs in request order', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(character.id, {
            tabs: [
                {id: 'tab-zeta', name: 'Zeta'},
                {id: 'tab-alpha', name: 'Alpha'},
                {id: 'tab-default', name: 'default'},
            ],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { gallery: { tabs: { id: string }[] } }
        expect(body.gallery.tabs.map((tab) => tab.id)).toEqual([
            'tab-zeta',
            'tab-alpha',
            'tab-default',
        ])
        const tabInsertStatements = boundStatements.filter((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')))
        expect(tabInsertStatements.map((statement) => [statement.binds[0], statement.binds[4]])).toEqual([
            ['tab-zeta', 0],
            ['tab-alpha', 1],
            ['tab-default', 2],
        ])
    })

    it('persists gallery rows in request order', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-default',
                name: 'default',
                rows: [
                    {id: 'row-third', mediaIds: []},
                    {id: 'row-first', mediaIds: []},
                    {id: 'row-second', mediaIds: []},
                ],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { gallery: { tabs: { rows: { id: string }[] }[] } }
        expect(body.gallery.tabs[0]?.rows.map((row) => row.id)).toEqual([
            'row-third',
            'row-first',
            'row-second',
        ])
        const rowInsertStatements = boundStatements.filter((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')))
        expect(rowInsertStatements.map((statement) => [statement.binds[0], statement.binds[4]])).toEqual([
            ['row-third', 0],
            ['row-first', 1],
            ['row-second', 2],
        ])
    })

    it('persists force full width only on single-image rows', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[
                {id: 'media-one'},
                {id: 'media-two'},
                {id: 'media-three'},
                {id: 'media-four'},
            ], [
                {id: 'media-one'},
                {id: 'media-two'},
                {id: 'media-three'},
                {id: 'media-four'},
            ]],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-default',
                name: 'default',
                rows: [
                    {id: 'row-forced', mediaIds: ['media-one'], forceFullWidth: true},
                    {id: 'row-unforced', mediaIds: ['media-two']},
                    {id: 'row-ignored', mediaIds: ['media-three', 'media-four'], forceFullWidth: true},
                ],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            gallery: { tabs: { rows: { id: string; mediaIds: string[]; forceFullWidth: boolean }[] }[] }
        }
        expect(body.gallery.tabs[0]?.rows).toEqual([
            {id: 'row-forced', mediaIds: ['media-one'], forceFullWidth: true},
            {id: 'row-unforced', mediaIds: ['media-two'], forceFullWidth: false},
            {id: 'row-ignored', mediaIds: ['media-three', 'media-four'], forceFullWidth: false},
        ])

        const rowInsertStatements = boundStatements.filter((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')))
        expect(rowInsertStatements.every((statement) => statement.sql.includes('force_full_width'))).toBe(true)
        expect(rowInsertStatements.map((statement) => [statement.binds[0], statement.binds[5]])).toEqual([
            ['row-forced', 1],
            ['row-unforced', 0],
            ['row-ignored', 0],
        ])
    })

    it('rejects gallery layouts when uploaded media is not placed on any tab', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [
                [{id: 'media-one'}],
                [{id: 'media-one'}, {id: 'media-two'}],
            ],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-default',
                name: 'default',
                rows: [{id: 'row-one', mediaIds: ['media-one']}],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'All character media must be placed on at least one gallery tab',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects empty gallery rows when the character has uploaded media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [
                [{id: 'media-one'}],
                [{id: 'media-one'}],
            ],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-default',
                name: 'default',
                rows: [
                    {id: 'row-one', mediaIds: ['media-one']},
                    {id: 'row-empty', mediaIds: []},
                ],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery rows cannot be empty while this character has media',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects blank gallery tabs when the character has uploaded media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [
                [{id: 'media-one'}],
                [{id: 'media-one'}],
            ],
        })

        const response = await putGallery(character.id, {
            tabs: [
                {
                    id: 'tab-default',
                    name: 'default',
                    rows: [{id: 'row-one', mediaIds: ['media-one']}],
                },
                {
                    id: 'tab-blank',
                    name: 'Blank',
                },
            ],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery tabs cannot be blank while this character has media',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('saves a custom name for the default gallery tab', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(character.id, {
            tabs: [{
                id: 'tab-default',
                name: 'References',
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = await response.json() as { gallery: { tabs: { id: string; name: string }[] } }
        expect(body.gallery.tabs).toEqual([{
            id: 'tab-default',
            name: 'References',
            rows: [],
        }])
        const tabInsertStatement = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')))
        expect(tabInsertStatement?.binds[3]).toBe('References')
    })
})

describe('DELETE /characters/folders/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await deleteFolder('folder-id', db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await deleteFolder('folder-id', db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await deleteFolder('missing-folder', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
    })

    it('moves nested folders and characters to root before deleting the folder', async () => {
        const sessionToken = 'session-token'
        const folder = createFolderRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })

        const response = await deleteFolder('folder-id', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(5)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['folder-id', currentUserRecord.id])
        expect(boundStatements[2]?.sql).toContain('UPDATE character_folders')
        expect(boundStatements[2]?.binds[1]).toBe(currentUserRecord.id)
        expect(boundStatements[2]?.binds[2]).toBe(folder.id)
        expect(boundStatements[3]?.sql).toContain('UPDATE characters')
        expect(boundStatements[3]?.binds[1]).toBe(currentUserRecord.id)
        expect(boundStatements[3]?.binds[2]).toBe(folder.id)
        expect(boundStatements[4]?.sql).toContain(['DELETE FROM', 'character_folders'].join(' '))
        expect(boundStatements[4]?.binds).toEqual([folder.id, currentUserRecord.id])
    })
})

describe('DELETE /characters/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await deleteCharacter('character-id', {
            confirmName: 'Vyn',
            permanent: true,
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 404 when the character does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await deleteCharacter('missing-character', {
            confirmName: 'Vyn',
            permanent: true,
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Character not found',
        })
    })

    it('requires the character name confirmation', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await deleteCharacter('character-id', {
            permanent: true,
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name confirmation is required',
        })
        expect(boundStatements).toHaveLength(1)
    })

    it('requires the permanent deletion confirmation', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await deleteCharacter('character-id', {
            confirmName: 'Vyn',
            permanent: false,
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Permanent deletion confirmation is required',
        })
        expect(boundStatements).toHaveLength(1)
    })

    it('rejects a mismatched character name confirmation', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, createCharacterRecord()],
        })

        const response = await deleteCharacter('character-id', {
            confirmName: 'Wrong name',
            permanent: true,
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name confirmation does not match',
        })
    })

    it('deletes a character and its profile image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord({
            profile_image_key: 'profile-image-id',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await deleteCharacter('character-id', {
            confirmName: 'vyn',
            permanent: true,
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(boundStatements).toHaveLength(4)
        expect(boundStatements[1]?.sql).toContain('FROM characters')
        expect(boundStatements[1]?.binds).toEqual(['character-id', currentUserRecord.id])
        expect(boundStatements[2]?.sql).toContain('FROM character_media')
        expect(boundStatements[2]?.binds).toEqual([character.id, currentUserRecord.id, 100])
        expect(boundStatements[3]?.sql).toContain(['DELETE FROM', 'characters'].join(' '))
        expect(boundStatements[3]?.binds).toEqual([character.id, currentUserRecord.id])
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/profile-image-id.webp')
    })

    it('loads media objects in chunks before deleting a character', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const firstMediaChunk = Array.from({length: 100}, (_, index) => createMediaRecord({
            id: `media-${index.toString().padStart(3, '0')}`,
            sfw_image_key: `sfw-key-${index}`,
            created_at: '2026-06-11 12:00:00',
        }))
        const secondMediaChunk = [createMediaRecord({
            id: 'media-100',
            sfw_image_key: 'sfw-key-100',
            created_at: '2026-06-11 12:00:01',
        })]
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [firstMediaChunk, secondMediaChunk],
        })

        const response = await deleteCharacter('character-id', {
            confirmName: 'Vyn',
            permanent: true,
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)

        const mediaQueries = boundStatements.filter((statement) => statement.sql.includes('FROM character_media'))

        expect(mediaQueries).toHaveLength(2)
        expect(mediaQueries[0]?.binds).toEqual([character.id, currentUserRecord.id, 100])
        expect(mediaQueries[1]?.binds).toEqual([
            character.id,
            currentUserRecord.id,
            '2026-06-11 12:00:00',
            '2026-06-11 12:00:00',
            'media-099',
            100,
        ])
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-100/sfw/sfw-key-100.png')
    })

    it('does not call R2 when the deleted character has no profile image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord({
            profile_image_key: null,
        })
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await deleteCharacter('character-id', {
            confirmName: 'Vyn',
            permanent: true,
        }, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(mediaBucket.delete).not.toHaveBeenCalled()
    })
})

function createCharacterRecord(overrides: Partial<{
    id: string
    user_id: string
    name: string
    profile_image_key: string | null
    folder_id: string | null
    created_at: string
    updated_at: string
}> = {}) {
    return {
        id: 'character-id',
        user_id: currentUserRecord.id,
        name: 'Vyn',
        profile_image_key: null,
        folder_id: null,
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}

function createMediaRecord(overrides: Partial<{
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
    created_at: string
    updated_at: string
}> = {}) {
    return {
        id: 'media-id',
        user_id: currentUserRecord.id,
        character_id: 'character-id',
        sfw_image_key: 'sfw-image-key',
        nsfw_image_key: null,
        sfw_content_type: 'image/png',
        nsfw_content_type: null,
        sfw_artist: '',
        nsfw_artist: '',
        sfw_width: 800,
        sfw_height: 600,
        sfw_byte_size: 1234,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}

function createFolderRecord(overrides: Partial<{
    id: string
    user_id: string
    name: string
    parent_folder_id: string | null
    created_at: string
    updated_at: string
}> = {}) {
    return {
        id: 'folder-id',
        user_id: currentUserRecord.id,
        name: 'Main Characters',
        parent_folder_id: null,
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}
