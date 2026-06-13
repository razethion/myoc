import {describe, expect, it, vi} from 'vitest'
import {apiRoutes} from '../api'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import {
    createMalformedWebpFile,
    createOversizedWebpFile,
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
}

function requestEnv(db: D1Database, mediaBucket?: R2Bucket) {
    return {
        DB: db,
        MEDIA_BUCKET: mediaBucket ?? createMockR2Bucket(),
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

async function postCharacter(
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request('https://example.com/characters', {
        method: 'POST',
        body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
}

async function postMedia(
    characterId: string,
    body: FormData,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/${characterId}/media`, {
        method: 'POST',
        body,
        headers: createRequestHeaders(body, options),
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
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
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/chunked/${mediaId}/${rating}/${encodeURIComponent(uploadId)}/${partNumber}?imageKey=${encodeURIComponent(imageKey)}`,
        {
            method: 'PUT',
            body,
            headers: createRequestHeaders(body, options, false),
        },
        requestEnv(db, options.mediaBucket),
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
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
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
    }, requestEnv(db, options.mediaBucket))
}

async function deleteFolder(
    folderId: string,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(`https://example.com/characters/folders/${folderId}`, {
        method: 'DELETE',
        headers: createRequestHeaders(undefined, options, false),
    }, requestEnv(db, options.mediaBucket))
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
            error: 'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
        })
    })

    it('returns 400 when the character name does not start with a letter or number', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacter({
            name: '.Vyn',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
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

describe('POST /characters/:id/media', () => {
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
                    chunkSize: number
                }
            }
        }

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
                parts: [uploadedPart],
            },
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
                sfwWidth: number
                sfwHeight: number
                sfwByteSize: number
                sfwArtist: string
            }
        }

        expect(body.media.id).toBe(initBody.mediaId)
        expect(body.media.sfwImageKey).toBe(initBody.uploads.sfw.imageKey)
        expect(body.media.sfwImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`)
        expect(body.media.sfwWidth).toBe(10000)
        expect(body.media.sfwHeight).toBe(10000)
        expect(body.media.sfwByteSize).toBe(pngFile.size)
        expect(body.media.sfwArtist).toBe('Chunk Artist')
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledTimes(1)
        expect(mediaBucket.resumeMultipartUpload).toHaveBeenCalledTimes(2)
        expect(mediaBucket.get).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
            {range: {offset: 0, length: 33}},
        )
        expect(boundStatements.at(-1)?.sql).toContain(['INSERT INTO', 'character_media'].join(' '))
        expect(boundStatements.at(-1)?.binds[7]).toBe(10000)
        expect(boundStatements.at(-1)?.binds[8]).toBe(10000)
    })

    it('uploads original-dimension PNG gallery media for the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('sfwImage', createPngFile(640, 480))
        form.set('sfwArtist', 'Artist Name')

        const response = await postMedia(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)

        const body = await response.json() as {
            media: {
                id: string
                sfwImageKey: string
                sfwImageUrl: string
                sfwWidth: number
                sfwHeight: number
                sfwArtist: string
            }
        }

        expect(body.media.id).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.sfwImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.sfwImageUrl).toBe(`${mediaPublicBaseUrl}/characters/current-user/character-id/media/${body.media.id}/sfw/${body.media.sfwImageKey}.png`)
        expect(body.media.sfwWidth).toBe(640)
        expect(body.media.sfwHeight).toBe(480)
        expect(body.media.sfwArtist).toBe('Artist Name')
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${body.media.id}/sfw/${body.media.sfwImageKey}.png`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/png',
                },
            },
        )
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'character_media'].join(' '))
        expect(boundStatements[2]?.binds[7]).toBe(640)
        expect(boundStatements[2]?.binds[8]).toBe(480)
    })

    it('accepts huge-dimension PNG gallery media without an app pixel cap', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('sfwImage', createPngFile(10000, 10000))

        const response = await postMedia(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(201)
        const body = await response.json() as {
            media: {
                sfwWidth: number
                sfwHeight: number
            }
        }

        expect(body.media.sfwWidth).toBe(10000)
        expect(body.media.sfwHeight).toBe(10000)
        expect(boundStatements[2]?.binds[7]).toBe(10000)
        expect(boundStatements[2]?.binds[8]).toBe(10000)
    })

    it('rejects gallery media that bypasses the image converter', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('sfwImage', createPngFile(100, 100, 'image/jpeg'))

        const response = await postMedia(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'SFW image must be uploaded through the image converter',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })
})

describe('PUT /characters/:id/gallery', () => {
    it('rejects gallery layouts containing media outside the character', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(character.id, {
            fullsizeLastRow: true,
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

    it('saves validated gallery layouts as normalized JSON structure', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[{id: 'media-one'}]],
        })

        const response = await putGallery(character.id, {
            fullsizeLastRow: true,
            tabs: [{
                id: 'tab-one',
                name: 'default',
                rows: [{
                    id: 'row-one',
                    mediaIds: ['media-one'],
                }],
            }],
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            gallery: {
                fullsizeLastRow: true,
                tabs: [{
                    id: 'tab-one',
                    name: 'default',
                    rows: [{
                        id: 'row-one',
                        mediaIds: ['media-one'],
                    }],
                }],
            },
        })
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_row_media'].join(' ')))).toBe(true)
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
        expect(boundStatements[2]?.binds).toEqual([character.id, currentUserRecord.id])
        expect(boundStatements[3]?.sql).toContain(['DELETE FROM', 'characters'].join(' '))
        expect(boundStatements[3]?.binds).toEqual([character.id, currentUserRecord.id])
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/profile-image-id.webp')
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
