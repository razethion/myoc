import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {
    createAvifFile,
    createBigEndianExifOrientationJpegFile,
    createExifOrientationJpegFile,
    createGifFile,
    createJpegFile,
    createJpegFileWithExifWithoutOrientation,
    createMalformedWebpFile,
    createOversizedWebpFile,
    createPngDataUrl,
    createPngFile,
    createWebpBytes,
    createWebpDataUrl,
    createWebpFile,
} from '../../test/imageFixtures'
import {createMockDb} from '../../test/mockD1'
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockR2Bucket} from '../../test/mockR2'
import {createRequestHeaders, type TestRequestOptions} from '../../test/request'
import {apiRoutes} from '../api'
import {__charactersTestHooks} from './characters'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const currentUserRecord = {
    id: 'current-user',
    email: 'test@example.com',
    username: 'testuser',
    profile_photo_key: null,
    bio: '',
}

function normalizedSql(sql: string | undefined): string {
    return sql?.replace(/\s+/g, ' ').trim() ?? ''
}

function sqlFragment(...tokens: string[]): string {
    return tokens.join(' ')
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
        folderImageKey: string | null
        folderImageUrl: string | null
        createdAt: string
        updatedAt: string
    }
}

type CharacterRequestOptions = TestRequestOptions & {
    mediaBucket?: R2Bucket
    imagesBinding?: ImagesBinding
    previewContainer?: DurableObjectNamespace
    cloudflarePreviewResponse?: Response
    cloudflarePreviewResponses?: Array<Response | Error>
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

function requestEnv(
    db: D1Database,
    mediaBucket?: R2Bucket,
    imagesBinding = createMockImagesBinding(),
    previewContainer?: DurableObjectNamespace,
) {
    return {
        DB: db,
        MEDIA_BUCKET: mediaBucket ?? createMockR2Bucket(),
        IMAGES: imagesBinding,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        MYOC_DOCKER_SHARP_CONTAINER: previewContainer,
        PREVIEW_PROCESSOR_TOKEN: 'preview-token',
    }
}

function createMockPreviewContainer(responses: Response | Array<Response | Error>) {
    const responseSequence = Array.isArray(responses) ? responses : [responses]
    let responseIndex = 0
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const response = responseSequence[Math.min(responseIndex, responseSequence.length - 1)]
        responseIndex += 1

        if (!response) {
            throw new Error('Missing mocked container preview response')
        }

        if (response instanceof Error) {
            throw response
        }

        return response.clone()
    })
    const namespace = {
        idFromName: vi.fn(() => 'preview-container-id'),
        get: vi.fn(() => ({fetch})),
    }

    return {
        fetch,
        namespace: namespace as unknown as DurableObjectNamespace,
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

function expectStoredFolderImage(mediaBucket: R2Bucket, folder: FolderResponse['folder']): void {
    expect(folder.folderImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
    expect(folder.folderImageUrl).toBe(
        `${mediaPublicBaseUrl}/characters/current-user/folders/${folder.id}/image/${folder.folderImageKey}.webp`,
    )
    expect(mediaBucket.put).toHaveBeenCalledWith(
        `characters/current-user/folders/${folder.id}/image/${folder.folderImageKey}.webp`,
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

    const initResponse = await initChunkedMedia(
        character.id,
        {
            ratings: ['sfw'],
        },
        db,
        {
            mediaBucket,
            sessionToken,
            csrfToken,
        },
    )
    const initBody = (await initResponse.json()) as ChunkedSfwInitBody

    return {
        sessionToken,
        mediaBucket,
        character,
        db,
        csrfToken,
        initBody,
    }
}

async function postCharacter(body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/characters',
        {
            method: 'POST',
            body: body instanceof FormData || typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function postFolder(body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/characters/folders',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function postFolderImage(folderId: string, body: BodyInit, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/folders/${folderId}/image`,
        {
            method: 'POST',
            body,
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function deleteFolderImage(folderId: string, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/folders/${folderId}/image`,
        {
            method: 'DELETE',
            headers: createRequestHeaders(undefined, options, false),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function postFolderTree(body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/characters/folders/tree',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function postCharacterOrder(body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/characters/order',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function putFolderPlacements(
    folderId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/folders/${folderId}/placements`,
        {
            method: 'PUT',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function initChunkedMedia(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/chunked/init`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function putChunkedMediaPart(
    characterId: string,
    mediaId: string,
    rating: string,
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

async function deleteChunkedMediaUpload(
    characterId: string,
    mediaId: string,
    rating: string,
    uploadId: string,
    imageKey: string,
    db: D1Database,
    options: CharacterRequestOptions = {},
    contentType = 'image/png',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/chunked/${mediaId}/${rating}/${encodeURIComponent(uploadId)}?imageKey=${encodeURIComponent(imageKey)}&contentType=${encodeURIComponent(contentType)}`,
        {
            method: 'DELETE',
            headers: createRequestHeaders(undefined, options, false),
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
    mockCloudflareImagePreviewResponse(
        body,
        options.cloudflarePreviewResponses ?? (options.cloudflarePreviewResponse ? [options.cloudflarePreviewResponse] : undefined),
    )

    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/chunked/complete`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding, options.previewContainer),
    )
}

function mockCloudflareImagePreviewResponse(body: unknown, responses?: Array<Response | Error>): void {
    const preview = firstPreviewPayload(body)

    if (!preview) {
        return
    }

    let responseIndex = 0

    vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
            if (responses?.length) {
                const response = responses[Math.min(responseIndex, responses.length - 1)]
                responseIndex += 1

                if (response instanceof Error) {
                    throw response
                }

                if (!response) {
                    throw new Error('Missing mocked Cloudflare preview response')
                }

                return response.clone()
            }

            const bytes = decodePreviewPayloadBytes(preview.data)

            return new Response(bytes, {
                headers: {
                    'content-type': 'image/webp',
                },
            })
        }),
    )
}

function firstPreviewPayload(body: unknown): {data: string} | null {
    if (!body || typeof body !== 'object') {
        return null
    }

    const record = body as Record<string, unknown>

    for (const key of ['sfwPreview', 'nsfwPreview']) {
        const preview = record[key]

        if (preview && typeof preview === 'object' && typeof (preview as {data?: unknown}).data === 'string') {
            return {data: (preview as {data: string}).data}
        }
    }

    return null
}

function decodePreviewPayloadBytes(value: string): Uint8Array {
    const data = value.replace(/^data:image\/webp;base64,/i, '')
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }

    return bytes
}

function expectCloudflarePreviewFetch(callIndex: number, expectedUrlWithoutQuery: string): string {
    const call = vi.mocked(globalThis.fetch).mock.calls[callIndex]
    const input = call?.[0]
    const init = call?.[1]
    const url = String(input)

    expect(url).toMatch(new RegExp(`^${escapeRegExp(expectedUrlWithoutQuery)}\\?preview_cache_bust=${uuidPattern}$`))
    expect(init).toEqual(
        expect.objectContaining({
            headers: expect.objectContaining({
                accept: 'image/webp,image/*,*/*;q=0.8',
                'cache-control': 'no-cache',
            }),
        }),
    )

    return url
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function initExistingChunkedMedia(
    characterId: string,
    mediaId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/${mediaId}/chunked/init`,
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function completeExistingChunkedMedia(
    characterId: string,
    mediaId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    mockCloudflareImagePreviewResponse(body)

    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/${mediaId}/chunked/complete`,
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function deleteCharacterMedia(characterId: string, mediaId: string, db: D1Database, options: CharacterRequestOptions = {}) {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/media/${mediaId}`,
        {
            method: 'DELETE',
            headers: createRequestHeaders(undefined, options, false),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function completeToyhouseImportItem(
    itemId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    mockCloudflareImagePreviewResponse(body)

    return apiRoutes.request(
        `https://example.com/characters/toyhouse-import-items/${itemId}/complete`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function failToyhouseImportItem(
    itemId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/toyhouse-import-items/${itemId}/fail`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function postProfileImage(
    characterId: string,
    body: BodyInit,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/profile-image`,
        {
            method: 'POST',
            body,
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function putHeightChart(
    characterId: string,
    body: FormData,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/height-chart`,
        {
            method: 'PUT',
            body,
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function patchFolder(folderId: string, body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/folders/${folderId}`,
        {
            method: 'PATCH',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function patchCharacter(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}`,
        {
            method: 'PATCH',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function putGallery(characterId: string, body: unknown, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}/gallery`,
        {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function deleteCharacter(
    characterId: string,
    body: unknown,
    db: D1Database,
    options: CharacterRequestOptions = {},
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/${characterId}`,
        {
            method: 'DELETE',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

async function deleteFolder(folderId: string, db: D1Database, options: CharacterRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/characters/folders/${folderId}`,
        {
            method: 'DELETE',
            headers: createRequestHeaders(undefined, options, false),
        },
        requestEnv(db, options.mediaBucket, options.imagesBinding),
    )
}

describe('POST /characters/folders/tree', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postFolderTree(
            {
                items: [],
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolderTree('{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when folder tree items are not an array', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolderTree(
            {
                items: 'main',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder tree items are required',
        })
    })

    it('rejects character items in the folder-only tree', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolderTree(
            {
                items: [{type: 'character', id: 'razeth'}],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder tree may contain only folders',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects folders that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [[]],
        })

        const response = await postFolderTree(
            {
                items: [{type: 'folder', id: 'other-users-folder'}],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder tree contains folders that do not belong to the current user',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('accepts an empty folder tree without issuing batch updates', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolderTree(
            {
                items: [],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('updates folder parents and sort order from the folder tree JSON', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [[{id: 'main'}, {id: 'story'}, {id: 'archive'}]],
        })

        const response = await postFolderTree(
            {
                items: [
                    {
                        type: 'folder',
                        id: 'main',
                        children: [{type: 'folder', id: 'story'}],
                    },
                    {type: 'folder', id: 'archive'},
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)

        const updateStatements = boundStatements.filter((statement) => statement.sql.includes('UPDATE character_folders'))
        expect(updateStatements).toHaveLength(3)
        expect(updateStatements[0]?.binds[0]).toBeNull()
        expect(updateStatements[0]?.binds[1]).toBe(0)
        expect(updateStatements[0]?.binds[3]).toBe('main')
        expect(updateStatements[1]?.binds[0]).toBe('main')
        expect(updateStatements[1]?.binds[1]).toBe(0)
        expect(updateStatements[1]?.binds[3]).toBe('story')
        expect(updateStatements[2]?.binds[0]).toBeNull()
        expect(updateStatements[2]?.binds[1]).toBe(1)
        expect(updateStatements[2]?.binds[3]).toBe('archive')
    })
})

describe('POST /characters/order', () => {
    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacterOrder('{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it.each([
        {
            body: {characterIds: 'razeth'},
            error: 'Character order must be an array',
        },
        {
            body: {characterIds: ['bad id']},
            error: 'Character order contains an invalid character id',
        },
        {
            body: {characterIds: ['razeth', 'razeth']},
            error: 'Character order contains duplicate characters',
        },
        {
            body: {characterIds: Array.from({length: 501}, (_, index) => `character-${index}`)},
            error: 'Character order contains too many items',
        },
    ])('returns 400 when character order validation fails with $error', async ({body, error}) => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacterOrder(body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('accepts an empty character order without issuing batch updates', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCharacterOrder(
            {
                characterIds: [],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('updates the independent all-characters profile order', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [[{id: 'razeth'}, {id: 'vyn'}]],
        })

        const response = await postCharacterOrder(
            {
                characterIds: ['razeth', 'vyn'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)

        const updateStatements = boundStatements.filter((statement) => statement.sql.includes('UPDATE characters'))
        expect(updateStatements).toHaveLength(2)
        expect(updateStatements[0]?.binds[0]).toBe(0)
        expect(updateStatements[0]?.binds[2]).toBe('razeth')
        expect(updateStatements[1]?.binds[0]).toBe(1)
        expect(updateStatements[1]?.binds[2]).toBe('vyn')
    })

    it('rejects characters that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            allResults: [[{id: 'razeth'}]],
        })

        const response = await postCharacterOrder(
            {
                characterIds: ['razeth', 'other-users-character'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character order contains characters that do not belong to the current user',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })
})

describe('PUT /characters/folders/:id/placements', () => {
    it('returns 400 for invalid folder ids', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await putFolderPlacements(
            'bad.folder',
            {
                characterIds: [],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder must be a valid folder id',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story'}],
        })

        const response = await putFolderPlacements('story', '{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it.each([
        {
            body: {characterIds: 'razeth'},
            error: 'Folder placements must be an array',
        },
        {
            body: {characterIds: ['bad id']},
            error: 'Folder placements contains an invalid character id',
        },
        {
            body: {characterIds: ['razeth', 'razeth']},
            error: 'Folder placements contains duplicate characters',
        },
    ])('returns 400 when folder placement validation fails with $error', async ({body, error}) => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story'}],
        })

        const response = await putFolderPlacements('story', body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('replaces the ordered character placements for one folder', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story'}],
            allResults: [[{id: 'vyn'}, {id: 'razeth'}]],
        })

        const response = await putFolderPlacements(
            'story',
            {
                characterIds: ['vyn', 'razeth'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)

        const placementStatements = boundStatements.filter((statement) => statement.sql.includes('character_folder_placements'))
        expect(placementStatements).toHaveLength(3)
        expect(normalizedSql(placementStatements[0]?.sql)).toContain(sqlFragment('DELETE', 'FROM', 'character_folder_placements'))
        expect(placementStatements[0]?.binds).toEqual([currentUserRecord.id, 'story'])
        expect(placementStatements[1]?.binds).toEqual([currentUserRecord.id, 'story', 'vyn', 0, expect.any(String), expect.any(String)])
        expect(placementStatements[2]?.binds).toEqual([currentUserRecord.id, 'story', 'razeth', 1, expect.any(String), expect.any(String)])
    })

    it('clears placements when the folder order is empty', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story'}],
        })

        const response = await putFolderPlacements(
            'story',
            {
                characterIds: [],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(db.batch).toHaveBeenCalledTimes(1)

        const placementStatements = boundStatements.filter((statement) => statement.sql.includes('character_folder_placements'))
        expect(placementStatements).toHaveLength(1)
        expect(normalizedSql(placementStatements[0]?.sql)).toContain(sqlFragment('DELETE', 'FROM', 'character_folder_placements'))
        expect(placementStatements[0]?.binds).toEqual([currentUserRecord.id, 'story'])
    })

    it('rejects placements for a folder the current user does not own', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await putFolderPlacements(
            'missing-folder',
            {
                characterIds: ['vyn'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects characters that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, {id: 'story'}],
            allResults: [[{id: 'vyn'}]],
        })

        const response = await putFolderPlacements(
            'story',
            {
                characterIds: ['vyn', 'other-users-character'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder placements contain characters that do not belong to the current user',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })
})

describe('POST /characters/folders', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postFolder(
            {
                name: 'Main Characters',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postFolder(
            {
                name: 'Main Characters',
            },
            db,
            {
                sessionToken: 'session-token',
            },
        )

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

        const response = await postFolder(
            {
                parentFolderId: 'root',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: 'a'.repeat(81),
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: 'Story/Arc',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: '-Story Arc',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: 'Main Characters',
                parentFolderId: '../bad',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: 'Story Arc',
                parentFolderId: 'missing-parent',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postFolder(
            {
                name: ' Main Characters ',
                parentFolderId: 'root',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as FolderResponse
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
            null,
            0,
            body.folder.createdAt,
            body.folder.updatedAt,
        ])
    })

    it('creates a folder with a cropped image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder(
            {
                name: ' Main Characters ',
                parentFolderId: 'root',
                folderImageData: createWebpDataUrl(512, 512),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as FolderResponse
        expectStoredFolderImage(mediaBucket, body.folder)
        expect(boundStatements[1]?.binds[4]).toBe(body.folder.folderImageKey)
    })

    it('creates a folder by converting a PNG cropped image data URL to WebP', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolder(
            {
                name: ' Main Characters ',
                parentFolderId: 'root',
                folderImageData: createPngDataUrl(512, 512),
            },
            db,
            {
                imagesBinding,
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as FolderResponse
        expectStoredFolderImage(mediaBucket, body.folder)
        expect(imagesBinding.input).toHaveBeenCalledTimes(1)
        const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
        expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 90})
    })

    it('creates a nested folder', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, {id: 'main'}],
        })

        const response = await postFolder(
            {
                name: 'Story Arc',
                parentFolderId: 'main',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as FolderResponse
        expect(body.folder.name).toBe('Story Arc')
        expect(body.folder.parentFolderId).toBe('main')
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['main', currentUserRecord.id])
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'character_folders'].join(' '))
        expect(boundStatements[2]?.binds[3]).toBe('main')
    })
})

describe('PATCH /characters/folders/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await patchFolder(
            'folder-id',
            {
                name: 'Renamed Folder',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await patchFolder(
            'folder-id',
            {
                name: 'Renamed Folder',
            },
            db,
            {
                sessionToken: 'session-token',
            },
        )

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

        const response = await patchFolder(
            'missing-folder',
            {
                name: 'Renamed Folder',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
    })

    it('returns 400 when the folder name is invalid', async () => {
        const sessionToken = 'session-token'
        const folder = createFolderRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })

        const response = await patchFolder(
            folder.id,
            {
                name: 'Bad/Name',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder name may contain only letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
        })
    })

    it('renames a folder', async () => {
        const sessionToken = 'session-token'
        const folder = createFolderRecord({
            folder_image_key: 'folder-image-id',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })

        const response = await patchFolder(
            folder.id,
            {
                name: ' Renamed Folder ',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)

        const body = (await response.json()) as FolderResponse
        expect(body.folder.id).toBe(folder.id)
        expect(body.folder.name).toBe('Renamed Folder')
        expect(body.folder.folderImageKey).toBe('folder-image-id')
        expect(body.folder.folderImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/folders/${folder.id}/image/folder-image-id.webp`,
        )
        expect(boundStatements[2]?.sql).toContain('UPDATE character_folders')
        expect(boundStatements[2]?.binds[0]).toBe('Renamed Folder')
        expect(boundStatements[2]?.binds[2]).toBe(folder.id)
        expect(boundStatements[2]?.binds[3]).toBe(currentUserRecord.id)
    })
})

describe('POST /characters/folders/:id/image', () => {
    it('rejects folder image uploads that are larger than 3 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb()
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        const response = await postFolderImage('folder-id', form, db, {
            contentLength: String(3 * 1024 * 1024 + 1),
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Folder image upload is too large',
        })
        expect(db.prepare).not.toHaveBeenCalled()
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        const response = await postFolderImage('folder-id', form, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 400 when multipart form data is missing', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postFolderImage('folder-id', JSON.stringify({}), db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Multipart form data is required',
        })
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        const response = await postFolderImage('missing-folder', form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 400 when the folder image file is missing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })
        const form = new FormData()

        const response = await postFolderImage(folder.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Folder image is required',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('replaces the folder image and deletes the old object', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord({
            folder_image_key: 'old-folder-image',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        const response = await postFolderImage(folder.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as {
            folderImageKey: string
            folderImageUrl: string
        }

        expect(body.folderImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.folderImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/folders/folder-id/image/${body.folderImageKey}.webp`,
        )
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/folders/folder-id/image/${body.folderImageKey}.webp`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(boundStatements[2]?.sql).toContain('UPDATE character_folders')
        expect(boundStatements[2]?.binds[0]).toBe(body.folderImageKey)
        expect(boundStatements[2]?.binds[2]).toBe(folder.id)
        expect(boundStatements[2]?.binds[3]).toBe(currentUserRecord.id)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/old-folder-image.webp')
    })

    it('deletes the uploaded folder image when the D1 update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const folder = createFolderRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, folder],
            runError: new Error('D1 update failed'),
        })
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        try {
            const response = await postFolderImage(folder.id, form, db, {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            })

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/folders/folder-id/image/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
        } finally {
            error.mockRestore()
        }
    })
})

describe('DELETE /characters/folders/:id/image', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await deleteFolderImage('folder-id', db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await deleteFolderImage('missing-folder', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Folder not found',
        })
    })

    it('clears the folder image and deletes the stored object', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord({
            folder_image_key: 'folder-image-id',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })

        const response = await deleteFolderImage(folder.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(boundStatements[2]?.sql).toContain('UPDATE character_folders')
        expect(boundStatements[2]?.binds[1]).toBe(folder.id)
        expect(boundStatements[2]?.binds[2]).toBe(currentUserRecord.id)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/folder-image-id.webp')
    })

    it('clears an empty folder image without deleting an R2 object', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })

        const response = await deleteFolderImage(folder.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(mediaBucket.delete).not.toHaveBeenCalled()
    })
})

describe('POST /characters', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postCharacter(
            {
                name: 'Vyn',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postCharacter(
            {
                name: 'Vyn',
            },
            db,
            {
                sessionToken: 'session-token',
            },
        )

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

        const response = await postCharacter(
            {
                folderId: 'root',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: 'a'.repeat(81),
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: 'Vyn#1',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: '---',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: 'Vyn',
                folderId: '../bad',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: ' Vyn ',
                folderId: 'root',
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await postCharacter(
            {
                name: ' Vyn "The Hawk" ',
                folderId: 'root',
                profileImageData: createWebpDataUrl(),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as CharacterResponse
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

        const response = await postCharacter(
            {
                name: ' "Ivo" ',
                folderId: 'root',
                profileImageData: createWebpDataUrl(),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as CharacterResponse
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

        const body = (await response.json()) as CharacterResponse
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
        form.set('new-character-profile-image', createGifFile(512, 512, 'profile.gif'))

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Unexpected media, contact support',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('creates a character by converting a PNG cropped profile image to WebP', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const form = new FormData()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createPngFile(512, 512, 'image/png', 'profile.png'))

        const response = await postCharacter(form, db, {
            imagesBinding,
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(201)
        const body = (await response.json()) as CharacterResponse
        expectStoredCharacterProfileImage(mediaBucket, body.character)
        expect(imagesBinding.input).toHaveBeenCalledTimes(1)
        const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
        expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 90})
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
            error: 'Unexpected media, contact support',
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
            contentLength: String(3 * 1024 * 1024 + 1),
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
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await patchCharacter(
            'character-id',
            {
                name: 'Ren',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await patchCharacter('character-id', '{bad json', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 404 when the character does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await patchCharacter(
            'missing-character',
            {
                name: 'Ren',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Character not found',
        })
    })

    it('returns 400 when the character name is invalid', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await patchCharacter(
            character.id,
            {
                name: 'Bad#Name',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must include at least one letter or number',
        })
    })

    it('returns 400 when the character description is too long', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await patchCharacter(
            character.id,
            {
                name: 'Ren',
                description: 'a'.repeat(256),
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character description must be 255 characters or fewer',
        })
    })

    it('updates a character name with quoted text and hyphenated numbers', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await patchCharacter(
            character.id,
            {
                name: 'DRD-5548 "Ivo"',
                description: 'Updated description',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)

        const body = (await response.json()) as CharacterResponse
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

        const response = await patchCharacter(
            character.id,
            {
                name: 'Ren',
                description: 'Updated description',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Character name already exists on this account',
        })
    })
})

describe('POST /characters/:id/profile-image', () => {
    it('rejects profile image upload requests that are larger than 3 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb()
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        const response = await postProfileImage('character-id', form, db, {
            contentLength: String(3 * 1024 * 1024 + 1),
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Character profile image upload is too large',
        })
        expect(db.prepare).not.toHaveBeenCalled()
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        const response = await postProfileImage('character-id', form, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 404 when the character does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, null],
        })
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        const response = await postProfileImage('missing-character', form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Character not found',
        })
    })

    it('returns 400 when multipart form data is missing', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await postProfileImage(character.id, JSON.stringify({}), db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Multipart form data is required',
        })
    })

    it('returns 400 when the profile image file is missing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()

        const response = await postProfileImage(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Character profile image is required',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

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

        const body = (await response.json()) as {
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

    it('deletes the uploaded profile image when the D1 update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            runError: new Error('D1 update failed'),
        })
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        try {
            const response = await postProfileImage(character.id, form, db, {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            })

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/character-id/profile/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
        } finally {
            error.mockRestore()
        }
    })

    it('keeps responding successfully when deleting the old profile image fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.mocked(mediaBucket.delete).mockRejectedValueOnce(new Error('R2 delete failed'))
        const character = createCharacterRecord({
            profile_image_key: 'old-profile-image',
        })
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        try {
            const response = await postProfileImage(character.id, form, db, {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            })

            expect(response.status).toBe(200)
            expect(warning).toHaveBeenCalledWith('Unable to delete old character profile image', expect.any(Error))
        } finally {
            warning.mockRestore()
        }
    })

    it('converts PNG character profile images to WebP before storing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set('profileImage', createPngFile(512, 512))

        const response = await postProfileImage(character.id, form, db, {
            imagesBinding,
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {profileImageKey: string}
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
        expect(imagesBinding.input).toHaveBeenCalledTimes(1)
        const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
        expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 90})
    })

    it('converts JPEG folder images to WebP before storing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const folder = createFolderRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, folder],
        })
        const form = new FormData()
        form.set('folderImage', createJpegFile(512, 512, 'folder.jpg'))

        const response = await postFolderImage(folder.id, form, db, {
            imagesBinding,
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {folderImageKey: string}
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/folders/folder-id/image/${body.folderImageKey}.webp`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(imagesBinding.input).toHaveBeenCalledTimes(1)
        const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
        expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 90})
    })
})

describe('PUT /characters/:id/height-chart', () => {
    it('returns 400 when height chart JSON is missing', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()

        const response = await putHeightChart(character.id, form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Height chart JSON is required',
        })
    })

    it('uses the character profile image column when loading the owned character', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.82,
                },
                image: null,
                calibration: {
                    headYPercent: 5,
                    footYPercent: 95,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        )

        const response = await putHeightChart(character.id, form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(boundStatements[1]?.sql).toContain('profile_image_key')
        expect(boundStatements[1]?.sql).not.toContain('folder_image_key')
    })

    it('rejects unsupported height chart image content types', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.82,
                },
                image: null,
                calibration: {
                    headYPercent: 5,
                    footYPercent: 95,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        )
        form.set('heightChartImage', new File(['not an image'], 'chart.txt', {type: 'text/plain'}))

        const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValueOnce(form)
        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })
        formDataSpy.mockRestore()

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Image must be PNG, JPG, GIF, WebP, or AVIF',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('deletes an uploaded height chart image when JSON validation fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 0,
                },
                image: null,
                calibration: {
                    headYPercent: 5,
                    footYPercent: 95,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        )
        form.set('heightChartImage', createPngFile(320, 640))

        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Height must be between 0.01 and 100 meters',
        })
        const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
        expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
    })

    it('saves normalized height chart data and stores the uploaded image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.8288,
                },
                image: null,
                calibration: {
                    headYPercent: 4.567,
                    footYPercent: 94.321,
                    footIsVirtual: false,
                    nameTagXPercent: 52.345,
                },
            }),
        )
        form.set('heightChartImage', createPngFile(320, 640))

        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as {
            heightChart: {
                height: {
                    meters: number
                }
                image: {
                    key: string
                    contentType: string
                    naturalWidth: number
                    naturalHeight: number
                    url: string
                }
                calibration: {
                    headYPercent: number
                    footYPercent: number
                    nameTagXPercent: number
                }
            }
        }

        expect(body.heightChart.height.meters).toBe(1.8288)
        expect(body.heightChart.image.key).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.heightChart.image.contentType).toBe('image/png')
        expect(body.heightChart.image.naturalWidth).toBe(320)
        expect(body.heightChart.image.naturalHeight).toBe(640)
        expect(body.heightChart.image.url).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/height-chart/${body.heightChart.image.key}.png`,
        )
        expect(body.heightChart.calibration.headYPercent).toBe(4.57)
        expect(body.heightChart.calibration.footYPercent).toBe(94.32)
        expect(body.heightChart.calibration.nameTagXPercent).toBe(52.34)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            `characters/current-user/character-id/height-chart/${body.heightChart.image.key}.png`,
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/png',
                },
            },
        )
        expect(boundStatements[2]?.sql).toContain('UPDATE characters')
        expect(JSON.parse(boundStatements[2]?.binds[0] as string)).toEqual({
            version: 1,
            height: {
                meters: 1.8288,
            },
            image: {
                key: body.heightChart.image.key,
                contentType: 'image/png',
                naturalWidth: 320,
                naturalHeight: 640,
            },
            calibration: {
                headYPercent: 4.57,
                footYPercent: 94.32,
                footIsVirtual: false,
                nameTagXPercent: 52.34,
            },
        })
        expect(boundStatements[2]?.binds[2]).toBe(character.id)
        expect(boundStatements[2]?.binds[3]).toBe(currentUserRecord.id)
    })

    it('uses uploaded file dimensions when height chart image bytes cannot be parsed', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        const fallbackImage = new File([new Uint8Array([1, 2, 3, 4])], 'chart.png', {type: 'image/png'})
        Object.defineProperties(fallbackImage, {
            width: {value: 321},
            height: {value: 654},
        })
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.7,
                },
                image: null,
                calibration: {
                    headYPercent: 5,
                    footYPercent: 95,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        )
        form.set('heightChartImage', fallbackImage)

        const formDataSpy = vi.spyOn(Request.prototype, 'formData').mockResolvedValueOnce(form)
        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })
        formDataSpy.mockRestore()

        const responseBody = await response.clone().json()
        expect(response.status, JSON.stringify(responseBody)).toBe(200)
        const body = responseBody as {
            heightChart: {
                image: {
                    naturalWidth: number
                    naturalHeight: number
                }
            }
        }
        expect(body.heightChart.image.naturalWidth).toBe(321)
        expect(body.heightChart.image.naturalHeight).toBe(654)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            expect.stringMatching(/^characters\/current-user\/character-id\/height-chart\/.+\.png$/),
            expect.any(Uint8Array),
            expect.objectContaining({
                httpMetadata: expect.objectContaining({
                    contentType: 'image/png',
                }),
            }),
        )
    })

    it('keeps the existing height chart image when the saved JSON references it', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord({
            height_chart_json: JSON.stringify({
                version: 1,
                height: {
                    meters: 1.75,
                },
                image: {
                    key: 'existing-height-chart',
                    contentType: 'image/png',
                    naturalWidth: 300,
                    naturalHeight: 600,
                },
                calibration: {
                    headYPercent: 4,
                    footYPercent: 96,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        })
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.8,
                },
                image: {
                    key: 'existing-height-chart',
                },
                calibration: {
                    headYPercent: 5,
                    footYPercent: 95,
                    footIsVirtual: true,
                    nameTagXPercent: 55,
                },
            }),
        )

        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as {
            heightChart: {
                image: {
                    key: string
                    url: string
                }
                calibration: {
                    footIsVirtual: boolean
                }
            }
        }

        expect(body.heightChart.image.key).toBe('existing-height-chart')
        expect(body.heightChart.image.url).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/height-chart/existing-height-chart.png`,
        )
        expect(body.heightChart.calibration.footIsVirtual).toBe(true)
        expect(JSON.parse(boundStatements[2]?.binds[0] as string).image.key).toBe('existing-height-chart')
        expect(mediaBucket.put).not.toHaveBeenCalled()
        expect(mediaBucket.delete).not.toHaveBeenCalled()
    })

    it('deletes the previous height chart image after replacing it', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord({
            height_chart_json: JSON.stringify({
                version: 1,
                height: {
                    meters: 1.75,
                },
                image: {
                    key: 'old-height-chart',
                    contentType: 'image/png',
                    naturalWidth: 300,
                    naturalHeight: 600,
                },
                calibration: {
                    headYPercent: 4,
                    footYPercent: 96,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        })
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {
                    meters: 1.9,
                },
                image: null,
                calibration: {
                    headYPercent: 6,
                    footYPercent: 94,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
        )
        form.set('heightChartImage', createPngFile(320, 640))

        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/height-chart/old-height-chart.png')
    })
})

describe('character media uploads', () => {
    it.each([
        {
            body: {},
            error: 'Upload ratings are required',
        },
        {
            body: {ratings: []},
            error: 'At least one upload rating is required',
        },
        {
            body: {ratings: ['private']},
            error: 'Upload ratings must be sfw or nsfw',
        },
        {
            body: {ratings: [{rating: 'sfw', contentType: 'text/plain'}]},
            error: 'Image must be PNG, JPG, GIF, WebP, or AVIF',
        },
    ])('rejects invalid chunked upload init requests with $error', async ({body, error}) => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await initChunkedMedia(character.id, body, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(mediaBucket.createMultipartUpload).not.toHaveBeenCalled()
    })

    it('reports chunked upload init failures and aborts partially initialized multipart uploads', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const firstUpload = {
            key: 'first-key',
            uploadId: 'first-upload',
            uploadPart: vi.fn(),
            abort: vi.fn(async () => {}),
            complete: vi.fn(),
        } as unknown as R2MultipartUpload
        vi.mocked(mediaBucket.createMultipartUpload)
            .mockResolvedValueOnce(firstUpload)
            .mockRejectedValueOnce(new Error('R2 multipart init failed'))
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        try {
            const response = await initChunkedMedia(
                character.id,
                {
                    uploads: [
                        {rating: 'sfw', contentType: 'image/png'},
                        {rating: 'nsfw', contentType: 'image/jpeg'},
                    ],
                },
                db,
                {
                    mediaBucket,
                    sessionToken,
                    csrfToken: await createCsrfToken(sessionToken),
                },
            )

            expect(response.status).toBe(503)
            const body = (await response.json()) as {error: string}
            expect(body.error).toMatch(/^Upload could not be initialized\. Try again, or contact support with reference /)
            expect(mediaBucket.createMultipartUpload).toHaveBeenCalledTimes(2)
            expect(firstUpload.abort).toHaveBeenCalledTimes(1)
            expect(errorSpy).toHaveBeenCalledWith(
                'Chunked gallery upload init failed while creating R2 multipart uploads',
                expect.objectContaining({
                    error: 'R2 multipart init failed',
                    createdUploads: [
                        expect.objectContaining({
                            rating: 'sfw',
                            uploadId: 'first-upload',
                        }),
                    ],
                }),
            )
        } finally {
            logSpy.mockRestore()
            warnSpy.mockRestore()
            errorSpy.mockRestore()
        }
    })

    it.each([
        {
            thrown: 'string failure',
            expected: 'string failure',
        },
        {
            thrown: {code: 'bad-r2-state'},
            expected: '{"code":"bad-r2-state"}',
        },
        {
            thrown: (() => {
                const circular: {self?: unknown} = {}
                circular.self = circular
                return circular
            })(),
            expected: '[object Object]',
        },
    ])('describes non-Error chunked upload init failures as $expected', async ({thrown, expected}) => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        vi.mocked(mediaBucket.createMultipartUpload).mockRejectedValueOnce(thrown)
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        try {
            const response = await initChunkedMedia(
                character.id,
                {
                    uploads: [{rating: 'sfw', contentType: 'image/png'}],
                },
                db,
                {
                    mediaBucket,
                    sessionToken,
                    csrfToken: await createCsrfToken(sessionToken),
                },
            )

            expect(response.status).toBe(503)
            expect(errorSpy).toHaveBeenCalledWith(
                'Chunked gallery upload init failed while creating R2 multipart uploads',
                expect.objectContaining({
                    error: expected,
                }),
            )
        } finally {
            logSpy.mockRestore()
            warnSpy.mockRestore()
            errorSpy.mockRestore()
        }
    })

    it.each([
        {
            rating: 'private',
            mediaId: 'media-id',
            imageKey: 'image-key',
            contentType: 'image/png',
            partNumber: 1,
            body: new Uint8Array([1]),
            error: 'Media rating must be sfw or nsfw',
        },
        {
            rating: 'sfw',
            mediaId: 'bad.media',
            imageKey: 'image-key',
            contentType: 'image/png',
            partNumber: 1,
            body: new Uint8Array([1]),
            error: 'Media id is invalid',
        },
        {
            rating: 'sfw',
            mediaId: 'media-id',
            imageKey: 'bad.image',
            contentType: 'image/png',
            partNumber: 1,
            body: new Uint8Array([1]),
            error: 'Image key is invalid',
        },
        {
            rating: 'sfw',
            mediaId: 'media-id',
            imageKey: 'image-key',
            contentType: 'text/plain',
            partNumber: 1,
            body: new Uint8Array([1]),
            error: 'Image must be PNG, JPG, GIF, WebP, or AVIF',
        },
        {
            rating: 'sfw',
            mediaId: 'media-id',
            imageKey: 'image-key',
            contentType: 'image/png',
            partNumber: 0,
            body: new Uint8Array([1]),
            error: 'Part number must be between 1 and 10000',
        },
    ])('rejects invalid chunked upload part requests with $error', async ({
        rating,
        mediaId,
        imageKey,
        contentType,
        partNumber,
        body,
        error,
    }) => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putChunkedMediaPart(
            character.id,
            mediaId,
            rating,
            'upload-id',
            partNumber,
            imageKey,
            body,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
            contentType,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(mediaBucket.resumeMultipartUpload).not.toHaveBeenCalled()
    })

    it('rejects chunked upload parts with no request body', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await apiRoutes.request(
            `https://example.com/characters/${character.id}/media/chunked/media-id/sfw/upload-id/1?imageKey=image-key&contentType=image%2Fpng`,
            {
                method: 'PUT',
                headers: createRequestHeaders(undefined, {
                    sessionToken,
                    csrfToken: await createCsrfToken(sessionToken),
                }),
            },
            requestEnv(db, mediaBucket),
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Chunk body is required',
        })
        expect(mediaBucket.resumeMultipartUpload).not.toHaveBeenCalled()
    })

    it('aborts chunked gallery media uploads', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await deleteChunkedMediaUpload(character.id, 'media-id', 'sfw', 'upload-id', 'image-key', db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(mediaBucket.resumeMultipartUpload).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/sfw/image-key.png',
            'upload-id',
        )
        const upload = vi.mocked(mediaBucket.resumeMultipartUpload).mock.results[0]?.value as R2MultipartUpload
        expect(upload.abort).toHaveBeenCalledTimes(1)
    })

    it('uploads gallery media through R2 multipart chunks', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [
                currentUserRecord,
                character,
                currentUserRecord,
                character,
                currentUserRecord,
                character,
                currentUserRecord,
                character,
            ],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: ['sfw'],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(initResponse.status).toBe(200)
        const initBody = (await initResponse.json()) as {
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart
        const emptyPartResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            2,
            initBody.uploads.sfw.imageKey,
            new Blob([]),
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(emptyPartResponse.status).toBe(200)
        const emptyUploadedPart = (await emptyPartResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwArtist: 'Chunk Artist',
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [emptyUploadedPart, uploadedPart],
                },
                sfwPreview: createPreviewPayload(1600, 1600),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {
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
        expect(body.media.sfwImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
        expect(body.media.sfwWidth).toBe(10000)
        expect(body.media.sfwHeight).toBe(10000)
        expect(body.media.sfwByteSize).toBe(pngFile.size)
        expect(body.media.sfwPreviewImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.sfwPreviewImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/preview/${body.media.sfwPreviewImageKey}.webp`,
        )
        expect(body.media.sfwPreviewWidth).toBe(1600)
        expect(body.media.sfwPreviewHeight).toBe(1600)
        expect(body.media.sfwPreviewByteSize).toBeGreaterThan(0)
        expect(body.media.sfwArtist).toBe('Chunk Artist')
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledTimes(1)
        expect(mediaBucket.resumeMultipartUpload).toHaveBeenCalledTimes(3)
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
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[5]).toBe('image/png')
        expect(mediaInsert?.binds[9]).toBe(10000)
        expect(mediaInsert?.binds[10]).toBe(10000)
        expect(mediaInsert?.binds[12]).toBe(body.media.sfwPreviewImageKey)
        expect(mediaInsert?.binds[13]).toBe(1600)
        expect(mediaInsert?.binds[14]).toBe(1600)
    })

    it('passes EXIF orientation transforms to Cloudflare Images for gallery previews', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/jpeg'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
        const jpegFile = createExifOrientationJpegFile(4608, 3456, 6)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            jpegFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
            'image/jpeg',
        )
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/jpeg',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(1200, 1600),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        const body = responseBody as {
            media: {
                sfwWidth: number
                sfwHeight: number
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwWidth).toBe(4608)
        expect(body.media.sfwHeight).toBe(3456)
        expect(body.media.sfwPreviewWidth).toBe(1200)
        expect(body.media.sfwPreviewHeight).toBe(1600)
        expectCloudflarePreviewFetch(
            0,
            `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,rotate=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.jpg`,
        )
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[9]).toBe(4608)
        expect(mediaInsert?.binds[10]).toBe(3456)
        expect(mediaInsert?.binds[13]).toBe(1200)
        expect(mediaInsert?.binds[14]).toBe(1600)
    })

    it('falls back to the container when Cloudflare returns the wrong EXIF-oriented preview dimensions', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const previewContainer = createMockPreviewContainer(
            new Response(createWebpBytes(1200, 1600), {
                headers: {
                    'content-type': 'image/webp',
                },
            }),
        )
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/jpeg'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
        const jpegFile = createExifOrientationJpegFile(4608, 3456, 6)
        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            jpegFile,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
            'image/jpeg',
        )
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/jpeg',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(1600, 1200),
            },
            db,
            {
                mediaBucket,
                previewContainer: previewContainer.namespace,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        const body = responseBody as {
            media: {
                sfwWidth: number
                sfwHeight: number
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwWidth).toBe(4608)
        expect(body.media.sfwHeight).toBe(3456)
        expect(body.media.sfwPreviewWidth).toBe(1200)
        expect(body.media.sfwPreviewHeight).toBe(1600)
        expectCloudflarePreviewFetch(
            0,
            `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,rotate=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.jpg`,
        )
        expect(previewContainer.fetch).toHaveBeenCalledTimes(1)
        expect(await vi.mocked(previewContainer.fetch).mock.calls[0]?.[1]?.body).toBe(
            JSON.stringify({
                imageUrl: `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.jpg`,
            }),
        )
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[9]).toBe(4608)
        expect(mediaInsert?.binds[10]).toBe(3456)
        expect(mediaInsert?.binds[13]).toBe(1200)
        expect(mediaInsert?.binds[14]).toBe(1600)
    })

    it('handles big-endian EXIF orientation and EXIF without orientation for gallery previews', async () => {
        const cases = [
            {
                file: createBigEndianExifOrientationJpegFile(4608, 3456, 6),
                preview: createPreviewPayload(1200, 1600),
                expectedPreview: {width: 1200, height: 1600},
                expectedTransformOptions: 'anim=false,fit=scale-down,format=webp,height=1600,quality=90,rotate=90,width=1600',
            },
            {
                file: createJpegFileWithExifWithoutOrientation(800, 600),
                preview: createPreviewPayload(800, 600),
                expectedPreview: {width: 800, height: 600},
                expectedTransformOptions: 'anim=false,fit=scale-down,format=webp,height=1600,quality=90,width=1600',
            },
        ]

        for (const testCase of cases) {
            const sessionToken = crypto.randomUUID()
            const mediaBucket = createMockR2Bucket()
            const character = createCharacterRecord()
            const {db} = createMockDb({
                firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
            })
            const csrfToken = await createCsrfToken(sessionToken)

            const initResponse = await initChunkedMedia(
                character.id,
                {
                    ratings: [{rating: 'sfw', contentType: 'image/jpeg'}],
                },
                db,
                {
                    mediaBucket,
                    sessionToken,
                    csrfToken,
                },
            )
            const initBody = (await initResponse.json()) as ChunkedSfwInitBody
            const partResponse = await putChunkedMediaPart(
                character.id,
                initBody.mediaId,
                'sfw',
                initBody.uploads.sfw.uploadId,
                1,
                initBody.uploads.sfw.imageKey,
                testCase.file,
                db,
                {
                    mediaBucket,
                    sessionToken,
                    csrfToken,
                },
                'image/jpeg',
            )
            const uploadedPart = (await partResponse.json()) as R2UploadedPart

            const completeResponse = await completeChunkedMedia(
                character.id,
                {
                    mediaId: initBody.mediaId,
                    sfwUpload: {
                        uploadId: initBody.uploads.sfw.uploadId,
                        imageKey: initBody.uploads.sfw.imageKey,
                        contentType: 'image/jpeg',
                        parts: [uploadedPart],
                    },
                    sfwPreview: testCase.preview,
                },
                db,
                {
                    mediaBucket,
                    sessionToken,
                    csrfToken,
                },
            )

            const responseBody = await completeResponse.json()
            expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
            const body = responseBody as {
                media: {
                    sfwPreviewWidth: number
                    sfwPreviewHeight: number
                }
            }
            expect(body.media.sfwPreviewWidth).toBe(testCase.expectedPreview.width)
            expect(body.media.sfwPreviewHeight).toBe(testCase.expectedPreview.height)
            expectCloudflarePreviewFetch(
                0,
                `${mediaPublicBaseUrl}/cdn-cgi/image/${testCase.expectedTransformOptions}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.jpg`,
            )
        }
    }, 10_000)

    it('falls back to the container when Cloudflare returns a non-WebP preview response', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const previewContainer = createMockPreviewContainer(
            new Response(createWebpBytes(800, 600), {
                headers: {
                    'content-type': 'image/webp',
                },
            }),
        )
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                cloudflarePreviewResponse: new Response(new Uint8Array([1, 2, 3]), {
                    headers: {
                        'content-type': 'image/jpeg',
                    },
                }),
                mediaBucket,
                previewContainer: previewContainer.namespace,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        const body = responseBody as {
            media: {
                sfwWidth: number
                sfwHeight: number
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwWidth).toBe(800)
        expect(body.media.sfwHeight).toBe(600)
        expect(body.media.sfwPreviewWidth).toBe(800)
        expect(body.media.sfwPreviewHeight).toBe(600)
        expect(globalThis.fetch).toHaveBeenCalledTimes(1)
        expectCloudflarePreviewFetch(
            0,
            `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
        expect(previewContainer.fetch).toHaveBeenCalledTimes(1)
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[13]).toBe(800)
        expect(mediaInsert?.binds[14]).toBe(600)
    })

    it('retries container preview generation when the container request fails transiently', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const previewContainer = createMockPreviewContainer([
            new Error('container was destroyed while handling the request'),
            new Response(createWebpBytes(800, 600), {
                headers: {
                    'content-type': 'image/webp',
                },
            }),
        ])
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                cloudflarePreviewResponse: new Response(new Uint8Array([1, 2, 3]), {
                    headers: {
                        'content-type': 'image/jpeg',
                    },
                }),
                mediaBucket,
                previewContainer: previewContainer.namespace,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        expect(globalThis.fetch).toHaveBeenCalledTimes(1)
        expect(previewContainer.fetch).toHaveBeenCalledTimes(2)
        expect(await vi.mocked(previewContainer.fetch).mock.calls[0]?.[1]?.body).toBe(
            JSON.stringify({
                imageUrl: `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
            }),
        )
        expect(await vi.mocked(previewContainer.fetch).mock.calls[1]?.[1]?.body).toBe(
            JSON.stringify({
                imageUrl: `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
            }),
        )
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[13]).toBe(800)
        expect(mediaInsert?.binds[14]).toBe(600)
    }, 10_000)

    it('retries Cloudflare preview generation when the transform request fails transiently', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                cloudflarePreviewResponses: [
                    new Error('temporary Cloudflare fetch failure'),
                    new Response(createWebpBytes(800, 600), {
                        headers: {
                            'content-type': 'image/webp',
                        },
                    }),
                ],
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        const body = responseBody as {
            media: {
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwPreviewWidth).toBe(800)
        expect(body.media.sfwPreviewHeight).toBe(600)
        expect(globalThis.fetch).toHaveBeenCalledTimes(2)
        const firstPreviewUrl = expectCloudflarePreviewFetch(
            0,
            `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
        const secondPreviewUrl = expectCloudflarePreviewFetch(
            1,
            `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
        expect(secondPreviewUrl).not.toBe(firstPreviewUrl)
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[13]).toBe(800)
        expect(mediaInsert?.binds[14]).toBe(600)
    }, 10_000)

    it('falls back to the container after Cloudflare preview generation keeps returning errors', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const previewContainer = createMockPreviewContainer(
            new Response(createWebpBytes(800, 600), {
                headers: {
                    'content-type': 'image/webp',
                },
            }),
        )
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                cloudflarePreviewResponse: new Response(JSON.stringify({error: 'preview failed'}), {
                    status: 502,
                    headers: {
                        'content-type': 'application/json',
                    },
                }),
                mediaBucket,
                previewContainer: previewContainer.namespace,
                sessionToken,
                csrfToken,
            },
        )

        const responseBody = await completeResponse.json()
        expect(completeResponse.status, JSON.stringify(responseBody)).toBe(201)
        const body = responseBody as {
            media: {
                sfwPreviewWidth: number
                sfwPreviewHeight: number
            }
        }
        expect(body.media.sfwPreviewWidth).toBe(800)
        expect(body.media.sfwPreviewHeight).toBe(600)
        expect(globalThis.fetch).toHaveBeenCalledTimes(6)
        const previewUrls = Array.from({length: 6}, (_, index) =>
            expectCloudflarePreviewFetch(
                index,
                `${mediaPublicBaseUrl}/cdn-cgi/image/anim=false,fit=scale-down,format=webp,height=1600,quality=90,width=1600/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
            ),
        )
        expect(new Set(previewUrls).size).toBe(6)
        expect(previewContainer.fetch).toHaveBeenCalledTimes(1)
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[13]).toBe(800)
        expect(mediaInsert?.binds[14]).toBe(600)
    }, 12_000)

    it('rejects completed gallery uploads when the character is already at the media limit', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, {count: 500}],
        })

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: 'media-id',
                sfwUpload: {
                    uploadId: 'upload-id',
                    imageKey: 'image-key',
                    contentType: 'image/png',
                    parts: [{partNumber: 1, etag: 'etag'}],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const initResponse = await initChunkedMedia(
            character.id,
            {
                ratings: ['nsfw'],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as {
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                nsfwUpload: {
                    uploadId: initBody.uploads.nsfw.uploadId,
                    imageKey: initBody.uploads.nsfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                nsfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                imagesBinding,
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {
            media: {
                nsfwBlurImageKey: string
                nsfwBlurImageUrl: string
            }
        }
        expect(body.media.nsfwBlurImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(body.media.nsfwBlurImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/nsfw/blur/${body.media.nsfwBlurImageKey}.webp`,
        )
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
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[23]).toBe(body.media.nsfwBlurImageKey)
    })

    it('uses stored image dimensions when declared original dimensions do not match the stored image', async () => {
        const {sessionToken, mediaBucket, character, db, csrfToken, initBody} = await createChunkedSfwUploadTestContext()

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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    width: 1600,
                    height: 1600,
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {media: {sfwWidth: number; sfwHeight: number}}
        expect(body.media.sfwWidth).toBe(800)
        expect(body.media.sfwHeight).toBe(600)
        expect(mediaBucket.delete).not.toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
    })

    it('rejects chunked gallery media larger than 200 MB', async () => {
        const {sessionToken, mediaBucket, character, db, csrfToken, initBody} = await createChunkedSfwUploadTestContext()

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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart
        vi.mocked(mediaBucket.resumeMultipartUpload).mockReturnValueOnce({
            complete: vi.fn(async () => ({size: 200 * 1024 * 1024 + 1})),
        } as unknown as R2MultipartUpload)

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW image must be 200 MB or smaller',
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
    })

    it('rejects chunked gallery media larger than 200,000,000 pixels', async () => {
        const {sessionToken, mediaBucket, character, db, csrfToken, initBody} = await createChunkedSfwUploadTestContext()

        const pngFile = createPngFile(20001, 10000)
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW image must be 200,000,000 pixels or smaller',
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
    })

    it('keeps chunked GIF gallery media as GIF', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                uploads: [{rating: 'sfw', contentType: 'image/gif'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(initResponse.status).toBe(200)
        const initBody = (await initResponse.json()) as {
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/gif',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(320, 240),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {
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
        expect(body.media.sfwImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.gif`,
        )
        expect(body.media.sfwWidth).toBe(320)
        expect(body.media.sfwHeight).toBe(240)
        expect(body.media.sfwByteSize).toBe(gifFile.size)
        expect(body.media.sfwPreviewWidth).toBe(320)
        expect(body.media.sfwPreviewHeight).toBe(240)
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[5]).toBe('image/gif')
    })

    it.each([
        {
            label: 'JPEG',
            contentType: 'image/jpeg',
            extension: 'jpg',
            file: createJpegFile(640, 480),
        },
        {
            label: 'AVIF',
            contentType: 'image/avif',
            extension: 'avif',
            file: createAvifFile(640, 480),
        },
    ])('verifies chunked $label gallery media dimensions from the stored object', async ({contentType, extension, file}) => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, currentUserRecord, character, currentUserRecord, character],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initChunkedMedia(
            character.id,
            {
                uploads: [{rating: 'sfw', contentType}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(initResponse.status).toBe(200)
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody

        const partResponse = await putChunkedMediaPart(
            character.id,
            initBody.mediaId,
            'sfw',
            initBody.uploads.sfw.uploadId,
            1,
            initBody.uploads.sfw.imageKey,
            file,
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
            contentType,
        )
        expect(partResponse.status).toBe(200)
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType,
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(640, 480),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {
            media: {
                sfwContentType: string
                sfwImageUrl: string
                sfwWidth: number
                sfwHeight: number
                sfwByteSize: number
            }
        }
        expect(body.media.sfwContentType).toBe(contentType)
        expect(body.media.sfwImageUrl).toBe(
            `${mediaPublicBaseUrl}/characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.${extension}`,
        )
        expect(body.media.sfwWidth).toBe(640)
        expect(body.media.sfwHeight).toBe(480)
        expect(body.media.sfwByteSize).toBe(file.size)
        const mediaInsert = boundStatements.find((statement) => statement.sql.includes(['INSERT INTO', 'character_media'].join(' ')))
        expect(mediaInsert?.binds[5]).toBe(contentType)
    })

    it('rejects chunked gallery media when the completed object cannot be re-read for verification', async () => {
        const {sessionToken, mediaBucket, character, db, csrfToken, initBody} = await createChunkedSfwUploadTestContext()

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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart
        vi.mocked(mediaBucket.get).mockResolvedValueOnce(null)

        const completeResponse = await completeChunkedMedia(
            character.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(400)
        expect(await completeResponse.json()).toEqual({
            error: 'SFW image dimensions could not be verified',
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`,
        )
    })

    it('marks Toyhou.se import items and their jobs as failed', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await failToyhouseImportItem(
            'toyhouse-import-item',
            {
                error: 'Toyhou.se returned 404',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const initResponse = await initChunkedMedia(
            character.id,
            {
                uploads: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(initResponse.status).toBe(200)
        const initBody = (await initResponse.json()) as {
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const completeResponse = await completeToyhouseImportItem(
            importItem.id,
            {
                mediaId: initBody.mediaId,
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(800, 600),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(completeResponse.status).toBe(201)
        const body = (await completeResponse.json()) as {
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

    it('initializes chunked replacement uploads for existing media', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character, media],
        })

        const response = await initExistingChunkedMedia(
            character.id,
            media.id,
            {
                uploads: [{rating: 'nsfw', contentType: 'image/webp'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            mediaId: string
            uploads: {
                nsfw: {
                    imageKey: string
                    contentType: string
                }
            }
        }
        expect(body.mediaId).toBe(media.id)
        expect(body.uploads.nsfw.contentType).toBe('image/webp')
        expect(mediaBucket.createMultipartUpload).toHaveBeenCalledWith(
            `characters/current-user/character-id/media/${media.id}/nsfw/${body.uploads.nsfw.imageKey}.webp`,
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
    })

    it('returns 404 when initializing a replacement upload for missing media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character, null],
        })

        const response = await initExistingChunkedMedia(
            character.id,
            'missing-media',
            {
                ratings: ['sfw'],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Media not found',
        })
    })

    it.each([
        {
            body: {removeSfw: true},
            error: 'At least one image must remain on media',
        },
    ])('rejects invalid existing media chunked completions with $error', async ({body, error}) => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character, media],
        })

        const response = await completeExistingChunkedMedia(character.id, media.id, body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(db.prepare).toHaveBeenCalled()
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('removes the SFW variant from existing media while preserving NSFW media', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({
            character_id: character.id,
            nsfw_image_key: 'nsfw-image-key',
            nsfw_content_type: 'image/png',
            nsfw_artist: 'NSFW Artist',
            nsfw_width: 700,
            nsfw_height: 500,
            nsfw_byte_size: 2048,
            nsfw_preview_image_key: 'nsfw-preview-key',
            nsfw_blur_image_key: 'nsfw-blur-key',
            nsfw_preview_width: 700,
            nsfw_preview_height: 500,
            nsfw_preview_byte_size: 512,
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, media],
        })

        const response = await completeExistingChunkedMedia(
            character.id,
            media.id,
            {
                removeSfw: true,
                nsfwArtist: 'Kept Artist',
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            media: {
                sfwImageKey: string | null
                nsfwImageKey: string | null
                nsfwArtist: string
            }
        }
        expect(body.media.sfwImageKey).toBeNull()
        expect(body.media.nsfwImageKey).toBe('nsfw-image-key')
        expect(body.media.nsfwArtist).toBe('Kept Artist')
        const mediaUpdate = boundStatements.find((statement) => statement.sql.includes('UPDATE character_media'))
        expect(mediaUpdate?.binds[0]).toBeNull()
        expect(mediaUpdate?.binds[21]).toBe(1)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/sfw/sfw-image-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/sfw/preview/sfw-preview-key.webp',
        )
    })

    it('replaces the SFW variant on existing media from a chunked upload', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, media, currentUserRecord, character, currentUserRecord, character, media],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initExistingChunkedMedia(
            character.id,
            media.id,
            {
                uploads: [{rating: 'sfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as ChunkedSfwInitBody
        const pngFile = createPngFile(640, 480)
        const partResponse = await putChunkedMediaPart(
            character.id,
            media.id,
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const response = await completeExistingChunkedMedia(
            character.id,
            media.id,
            {
                sfwArtist: 'New SFW Artist',
                sfwUpload: {
                    uploadId: initBody.uploads.sfw.uploadId,
                    imageKey: initBody.uploads.sfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                sfwPreview: createPreviewPayload(640, 480),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            media: {
                sfwImageKey: string | null
                sfwArtist: string
                sfwWidth: number | null
                sfwHeight: number | null
                sfwPreviewWidth: number | null
                sfwPreviewHeight: number | null
            }
        }
        expect(body.media.sfwImageKey).toBe(initBody.uploads.sfw.imageKey)
        expect(body.media.sfwArtist).toBe('New SFW Artist')
        expect(body.media.sfwWidth).toBe(640)
        expect(body.media.sfwHeight).toBe(480)
        expect(body.media.sfwPreviewWidth).toBe(640)
        expect(body.media.sfwPreviewHeight).toBe(480)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/sfw/sfw-image-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/sfw/preview/sfw-preview-key.webp',
        )
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE character_media'))).toBe(true)
    })

    it('replaces the NSFW variant on existing media and regenerates its blur image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({
            character_id: character.id,
            nsfw_image_key: 'old-nsfw-image-key',
            nsfw_content_type: 'image/png',
            nsfw_width: 700,
            nsfw_height: 500,
            nsfw_byte_size: 2048,
            nsfw_preview_image_key: 'old-nsfw-preview-key',
            nsfw_blur_image_key: 'old-nsfw-blur-key',
            nsfw_preview_width: 700,
            nsfw_preview_height: 500,
            nsfw_preview_byte_size: 512,
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, media, currentUserRecord, character, currentUserRecord, character, media],
        })
        const csrfToken = await createCsrfToken(sessionToken)

        const initResponse = await initExistingChunkedMedia(
            character.id,
            media.id,
            {
                uploads: [{rating: 'nsfw', contentType: 'image/png'}],
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )
        const initBody = (await initResponse.json()) as {
            uploads: {
                nsfw: {
                    uploadId: string
                    imageKey: string
                    contentType: string
                }
            }
        }
        const pngFile = createPngFile(640, 480)
        const partResponse = await putChunkedMediaPart(
            character.id,
            media.id,
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
        const uploadedPart = (await partResponse.json()) as R2UploadedPart

        const response = await completeExistingChunkedMedia(
            character.id,
            media.id,
            {
                nsfwArtist: 'New NSFW Artist',
                nsfwUpload: {
                    uploadId: initBody.uploads.nsfw.uploadId,
                    imageKey: initBody.uploads.nsfw.imageKey,
                    contentType: 'image/png',
                    parts: [uploadedPart],
                },
                nsfwPreview: createPreviewPayload(640, 480),
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken,
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            media: {
                nsfwImageKey: string | null
                nsfwArtist: string
                nsfwWidth: number | null
                nsfwHeight: number | null
                nsfwPreviewWidth: number | null
                nsfwPreviewHeight: number | null
                nsfwBlurImageKey: string | null
            }
        }
        expect(body.media.nsfwImageKey).toBe(initBody.uploads.nsfw.imageKey)
        expect(body.media.nsfwArtist).toBe('New NSFW Artist')
        expect(body.media.nsfwWidth).toBe(640)
        expect(body.media.nsfwHeight).toBe(480)
        expect(body.media.nsfwPreviewWidth).toBe(640)
        expect(body.media.nsfwPreviewHeight).toBe(480)
        expect(body.media.nsfwBlurImageKey).toMatch(new RegExp(`^${uuidPattern}$`))
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/nsfw/old-nsfw-image-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/nsfw/preview/old-nsfw-preview-key.webp',
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/nsfw/blur/old-nsfw-blur-key.webp',
        )
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE character_media'))).toBe(true)
    })

    it('deletes a media item and all of its stored objects', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({
            character_id: character.id,
            nsfw_image_key: 'nsfw-image-key',
            nsfw_content_type: 'image/png',
            nsfw_preview_image_key: 'nsfw-preview-key',
            nsfw_blur_image_key: 'nsfw-blur-key',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character, media],
        })

        const response = await deleteCharacterMedia(character.id, media.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(boundStatements.at(-1)?.sql).toContain('DELETE')
        expect(boundStatements.at(-1)?.sql).toContain('FROM character_media')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/sfw/sfw-image-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/sfw/preview/sfw-preview-key.webp',
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/nsfw/nsfw-image-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith(
            'characters/current-user/character-id/media/media-id/nsfw/preview/nsfw-preview-key.webp',
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-id/nsfw/blur/nsfw-blur-key.webp')
    })
})

describe('PUT /characters/:id/gallery', () => {
    it('rejects gallery layouts with no tabs', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Gallery must contain between 1 and 20 tabs',
        })
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('rejects gallery rows containing more than five images', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-one',
                        name: 'default',
                        rows: [
                            {
                                id: 'row-one',
                                mediaIds: ['media-one', 'media-two', 'media-three', 'media-four', 'media-five', 'media-six'],
                            },
                        ],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-one',
                        name: 'default',
                        rows: [
                            {
                                id: 'row-one',
                                mediaIds: ['other-media'],
                            },
                        ],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-one',
                        name: 'default',
                        rows,
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)

        const ownershipQueries = boundStatements.filter(
            (statement) => statement.sql.includes('FROM character_media') && statement.sql.includes('id IN'),
        )

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

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-one',
                        name: 'default',
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            gallery: {
                tabs: [
                    {
                        id: 'tab-one',
                        name: 'default',
                        rows: [],
                    },
                ],
            },
        })
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')))).toBe(false)
        expect(boundStatements.some((statement) => statement.sql.includes(['INSERT INTO', 'character_gallery_row_media'].join(' ')))).toBe(
            false,
        )
    })

    it('persists gallery tabs in request order', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[]],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {id: 'tab-zeta', name: 'Zeta'},
                    {id: 'tab-alpha', name: 'Alpha'},
                    {id: 'tab-default', name: 'default'},
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {gallery: {tabs: {id: string}[]}}
        expect(body.gallery.tabs.map((tab) => tab.id)).toEqual(['tab-zeta', 'tab-alpha', 'tab-default'])
        const tabInsertStatements = boundStatements.filter((statement) =>
            statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')),
        )
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

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        rows: [
                            {id: 'row-third', mediaIds: []},
                            {id: 'row-first', mediaIds: []},
                            {id: 'row-second', mediaIds: []},
                        ],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {gallery: {tabs: {rows: {id: string}[]}[]}}
        expect(body.gallery.tabs[0]?.rows.map((row) => row.id)).toEqual(['row-third', 'row-first', 'row-second'])
        const rowInsertStatements = boundStatements.filter((statement) =>
            statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')),
        )
        expect(rowInsertStatements.map((statement) => [statement.binds[0], statement.binds[4]])).toEqual([
            ['row-third', 0],
            ['row-first', 1],
            ['row-second', 2],
        ])
    })

    it('persists force full width for non-final single-image rows and checked final single-image rows', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [
                [{id: 'media-one'}, {id: 'media-two'}, {id: 'media-three'}, {id: 'media-four'}],
                [{id: 'media-one'}, {id: 'media-two'}, {id: 'media-three'}, {id: 'media-four'}],
            ],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        rows: [
                            {id: 'row-auto', mediaIds: ['media-one'], forceFullWidth: false},
                            {id: 'row-ignored', mediaIds: ['media-three', 'media-four'], forceFullWidth: true},
                            {id: 'row-final-forced', mediaIds: ['media-two'], forceFullWidth: true},
                        ],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            gallery: {tabs: {rows: {id: string; mediaIds: string[]; forceFullWidth: boolean}[]}[]}
        }
        expect(body.gallery.tabs[0]?.rows).toEqual([
            {id: 'row-auto', mediaIds: ['media-one'], forceFullWidth: true},
            {id: 'row-ignored', mediaIds: ['media-three', 'media-four'], forceFullWidth: false},
            {id: 'row-final-forced', mediaIds: ['media-two'], forceFullWidth: true},
        ])

        const rowInsertStatements = boundStatements.filter((statement) =>
            statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')),
        )
        expect(rowInsertStatements.every((statement) => statement.sql.includes('force_full_width'))).toBe(true)
        expect(rowInsertStatements.map((statement) => [statement.binds[0], statement.binds[5]])).toEqual([
            ['row-auto', 1],
            ['row-ignored', 0],
            ['row-final-forced', 1],
        ])
    })

    it('allows a single-row tab to leave force full width disabled', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[{id: 'media-one'}], [{id: 'media-one'}]],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        rows: [{id: 'row-only', mediaIds: ['media-one'], forceFullWidth: false}],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            gallery: {tabs: {rows: {id: string; mediaIds: string[]; forceFullWidth: boolean}[]}[]}
        }
        expect(body.gallery.tabs[0]?.rows).toEqual([{id: 'row-only', mediaIds: ['media-one'], forceFullWidth: false}])

        const rowInsertStatements = boundStatements.filter((statement) =>
            statement.sql.includes(['INSERT INTO', 'character_gallery_rows'].join(' ')),
        )
        expect(rowInsertStatements.map((statement) => [statement.binds[0], statement.binds[5]])).toEqual([['row-only', 0]])
    })

    it('rejects gallery layouts when uploaded media is not placed on any tab', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const {db} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [[{id: 'media-one'}], [{id: 'media-one'}, {id: 'media-two'}]],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        rows: [{id: 'row-one', mediaIds: ['media-one']}],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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
            allResults: [[{id: 'media-one'}], [{id: 'media-one'}]],
        })

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        rows: [
                            {id: 'row-one', mediaIds: ['media-one']},
                            {id: 'row-empty', mediaIds: []},
                        ],
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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
            allResults: [[{id: 'media-one'}], [{id: 'media-one'}]],
        })

        const response = await putGallery(
            character.id,
            {
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
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await putGallery(
            character.id,
            {
                tabs: [
                    {
                        id: 'tab-default',
                        name: 'References',
                    },
                ],
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {gallery: {tabs: {id: string; name: string}[]}}
        expect(body.gallery.tabs).toEqual([
            {
                id: 'tab-default',
                name: 'References',
                rows: [],
            },
        ])
        const tabInsertStatement = boundStatements.find((statement) =>
            statement.sql.includes(['INSERT INTO', 'character_gallery_tabs'].join(' ')),
        )
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
        expect(boundStatements).toHaveLength(6)
        expect(boundStatements[1]?.sql).toContain('FROM character_folders')
        expect(boundStatements[1]?.binds).toEqual(['folder-id', currentUserRecord.id])
        expect(normalizedSql(boundStatements[2]?.sql)).toContain(sqlFragment('DELETE', 'FROM', 'character_folder_placements'))
        expect(boundStatements[2]?.binds).toEqual([currentUserRecord.id, folder.id])
        expect(boundStatements[3]?.sql).toContain('UPDATE character_folders')
        expect(boundStatements[3]?.binds[1]).toBe(currentUserRecord.id)
        expect(boundStatements[3]?.binds[2]).toBe(folder.id)
        expect(boundStatements[4]?.sql).toContain('UPDATE characters')
        expect(boundStatements[4]?.binds[1]).toBe(currentUserRecord.id)
        expect(boundStatements[4]?.binds[2]).toBe(folder.id)
        expect(boundStatements[5]?.sql).toContain(['DELETE FROM', 'character_folders'].join(' '))
        expect(boundStatements[5]?.binds).toEqual([folder.id, currentUserRecord.id])
    })
})

describe('DELETE /characters/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'Vyn',
                permanent: true,
            },
            db,
        )

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

        const response = await deleteCharacter(
            'missing-character',
            {
                confirmName: 'Vyn',
                permanent: true,
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await deleteCharacter(
            'character-id',
            {
                permanent: true,
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'Vyn',
                permanent: false,
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'Wrong name',
                permanent: true,
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'vyn',
                permanent: true,
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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
        const firstMediaChunk = Array.from({length: 100}, (_, index) =>
            createMediaRecord({
                id: `media-${index.toString().padStart(3, '0')}`,
                sfw_image_key: `sfw-key-${index}`,
                created_at: '2026-06-11 12:00:00',
            }),
        )
        const secondMediaChunk = [
            createMediaRecord({
                id: 'media-100',
                sfw_image_key: 'sfw-key-100',
                created_at: '2026-06-11 12:00:01',
            }),
        ]
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, character],
            allResults: [firstMediaChunk, secondMediaChunk],
        })

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'Vyn',
                permanent: true,
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

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

        const response = await deleteCharacter(
            'character-id',
            {
                confirmName: 'Vyn',
                permanent: true,
            },
            db,
            {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(204)
        expect(mediaBucket.delete).not.toHaveBeenCalled()
    })
})

describe('characters internal helper coverage', () => {
    const completedImage = {
        imageKey: 'image-key',
        contentType: 'image/png',
        width: 800,
        height: 600,
        displayWidth: 800,
        displayHeight: 600,
        byteSize: 1234,
        exifOrientation: null,
    }

    it('normalizes gallery and media helper inputs', () => {
        expect(__charactersTestHooks.normalizeGalleryTabName(' Main ')).toEqual({name: 'Main'})
        expect(__charactersTestHooks.normalizeGalleryTabName('')).toEqual({error: 'Gallery tab name is required'})
        expect(__charactersTestHooks.normalizeGalleryTabName('x'.repeat(33))).toEqual({
            error: 'Gallery tab name must be 32 characters or fewer',
        })
        expect(__charactersTestHooks.normalizeGalleryTabName('bad/name')).toEqual({
            error: 'Gallery tab name may contain only letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses, and must start with a letter or number',
        })

        expect(__charactersTestHooks.normalizeArtistName(' Artist ')).toEqual({artist: 'Artist'})
        expect(__charactersTestHooks.normalizeArtistName('x'.repeat(121))).toEqual({
            error: 'artist name must be 80 characters or fewer',
        })
        expect(__charactersTestHooks.normalizeUploadIdentifier('', 'Image key')).toEqual({error: 'Image key is required'})
        expect(__charactersTestHooks.normalizeUploadIdentifier('bad/key', 'Image key')).toEqual({error: 'Image key is invalid'})
        expect(__charactersTestHooks.normalizeGalleryImageContentType(undefined)).toEqual({error: 'Image content type is required'})
        expect(__charactersTestHooks.normalizeGalleryImageContentType('text/plain')).toEqual({
            error: 'Image must be PNG, JPG, GIF, WebP, or AVIF',
        })
        expect(__charactersTestHooks.normalizeGalleryImageDimensions('320', '640')).toEqual({width: 320, height: 640})
        expect(__charactersTestHooks.normalizeGalleryImageDimensions('0', '640')).toEqual({error: 'Image dimensions are required'})
        expect(__charactersTestHooks.isDuplicateCharacterNameError('not an error')).toBe(false)
        expect(
            __charactersTestHooks.isDuplicateCharacterNameError(new Error('UNIQUE constraint failed: characters.user_id, characters.name')),
        ).toBe(true)
    })

    it('parses completed chunked upload helper variants', () => {
        expect(__charactersTestHooks.parseMediaArtists('SFW Artist', 'NSFW Artist')).toEqual({
            sfwArtist: 'SFW Artist',
            nsfwArtist: 'NSFW Artist',
        })
        expect(__charactersTestHooks.parseMediaArtists('x'.repeat(81), '')).toEqual({
            error: 'SFW artist name must be 80 characters or fewer',
        })
        expect(__charactersTestHooks.parseMediaArtists('', 'x'.repeat(81))).toEqual({
            error: 'NSFW artist name must be 80 characters or fewer',
        })
        expect(__charactersTestHooks.parseCompletedChunkedUpload(undefined)).toBeNull()
        expect(__charactersTestHooks.parseCompletedChunkedUpload('bad')).toEqual({error: 'upload is invalid'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                imageKey: 'image-key',
                contentType: 'image/png',
                parts: [],
            }),
        ).toEqual({
            error: 'upload id is required',
        })
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'bad/key',
                contentType: 'image/png',
                parts: [],
            }),
        ).toEqual({error: 'Image key is invalid'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'text/plain',
                parts: [],
            }),
        ).toEqual({error: 'Image must be PNG, JPG, GIF, WebP, or AVIF'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'image/png',
            }),
        ).toEqual({error: 'uploaded parts are required'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'image/png',
                parts: ['bad'],
            }),
        ).toEqual({error: 'uploaded part is invalid'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'image/png',
                parts: [{partNumber: 0, etag: 'etag'}],
            }),
        ).toEqual({error: 'uploaded part is invalid'})
        expect(
            __charactersTestHooks.parseCompletedChunkedUpload({
                uploadId: 'upload-id',
                imageKey: 'image-key',
                contentType: 'image/png',
                parts: [
                    {partNumber: 2, etag: 'etag-2'},
                    {partNumber: 1, etag: 'etag-1'},
                ],
            }),
        ).toEqual({
            uploadId: 'upload-id',
            imageKey: 'image-key',
            contentType: 'image/png',
            parts: [
                {partNumber: 1, etag: 'etag-1'},
                {partNumber: 2, etag: 'etag-2'},
            ],
        })
        expect(
            __charactersTestHooks.parseChunkedUploadPair(
                {
                    uploadId: '',
                    imageKey: 'image-key',
                    contentType: 'image/png',
                    parts: [],
                },
                null,
            ),
        ).toEqual({error: 'SFW upload id is required'})
        expect(
            __charactersTestHooks.parseChunkedUploadPair(null, {
                uploadId: '',
                imageKey: 'image-key',
                contentType: 'image/png',
                parts: [],
            }),
        ).toEqual({error: 'NSFW upload id is required'})
    })

    it('parses request helper failures and form variants', async () => {
        const jsonReq = (body: unknown, contentType = 'application/json') => ({
            header: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? contentType : undefined)),
            json: vi.fn(async () => body),
            formData: vi.fn(),
        })
        const badJsonReq = {
            header: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : undefined)),
            json: vi.fn(async () => {
                throw new Error('bad json')
            }),
            formData: vi.fn(),
        }
        const form = new FormData()
        form.set('name', 'Name From Form')
        form.set('parentId', 'parent-folder')
        form.set('confirmName', 'Vyn')
        form.set('permanent', 'on')
        const formReq = {
            header: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? 'multipart/form-data' : undefined)),
            json: vi.fn(),
            formData: vi.fn(async () => form),
        }
        const noTypeReq = {
            header: vi.fn(() => undefined),
            json: vi.fn(),
            formData: vi.fn(),
        }
        const badJsonContext = {
            req: badJsonReq,
            json: vi.fn((body: unknown, status?: number) => new Response(JSON.stringify(body), {status})),
        } as never

        await expect(__charactersTestHooks.parseChunkedUploadInitRequest(badJsonContext)).resolves.toMatchObject({status: 400})
        await expect(__charactersTestHooks.parseChunkedMediaCompleteBody({req: badJsonReq} as never)).resolves.toEqual({
            error: 'Invalid JSON body',
            status: 400,
        })
        await expect(
            __charactersTestHooks.parseChunkedMediaCompleteBody({req: jsonReq({sfwArtist: 'x'.repeat(81)})} as never),
        ).resolves.toEqual({error: 'SFW artist name must be 80 characters or fewer', status: 400})
        await expect(
            __charactersTestHooks.parseChunkedMediaCompleteBody({
                req: jsonReq({sfwUpload: {uploadId: '', imageKey: 'image-key', contentType: 'image/png', parts: []}}),
            } as never),
        ).resolves.toEqual({error: 'SFW upload id is required', status: 400})

        await expect(
            __charactersTestHooks.parseCreateCharacterRequest({
                req: jsonReq({}, 'text/plain'),
            } as never),
        ).resolves.toEqual({error: 'JSON or multipart form data is required', status: 400})
        await expect(__charactersTestHooks.parseCreateFolderRequest(badJsonReq as never)).resolves.toEqual({error: 'Invalid JSON body'})
        await expect(__charactersTestHooks.parseCreateFolderRequest(formReq as never)).resolves.toEqual({
            name: 'Name From Form',
            parentFolderId: 'parent-folder',
            folderImage: null,
        })
        await expect(__charactersTestHooks.parseCreateFolderRequest(noTypeReq as never)).resolves.toEqual({
            error: 'JSON or form data is required',
        })
        await expect(__charactersTestHooks.parseDeleteCharacterRequest(badJsonReq as never)).resolves.toEqual({})
        await expect(__charactersTestHooks.parseDeleteCharacterRequest(formReq as never)).resolves.toEqual({
            confirmName: 'Vyn',
            permanent: 'on',
            'delete-character-confirm-name': null,
            'delete-confirm-permanent': null,
        })
        await expect(__charactersTestHooks.parseDeleteCharacterRequest(noTypeReq as never)).resolves.toEqual({})
    })

    it('parses gallery tree and layout helper edge cases', () => {
        expect(__charactersTestHooks.flattenTreeItems([{type: 'folder', id: 'folder', children: []}])).toEqual({
            items: [{id: 'folder', parentFolderId: null, sortOrder: 0, type: 'folder'}],
        })
        expect(
            __charactersTestHooks.flattenTreeItems([
                {
                    type: 'folder',
                    id: 'root',
                    children: [{type: 'character', id: 'child'}],
                },
            ]),
        ).toEqual({
            items: [
                {id: 'root', parentFolderId: null, sortOrder: 0, type: 'folder'},
                {id: 'child', parentFolderId: 'root', sortOrder: 0, type: 'character'},
            ],
        })
        expect(
            __charactersTestHooks.flattenTreeItems([
                {
                    type: 'folder',
                    id: 'root',
                    children: [{type: 'folder', id: 'root'}],
                },
            ]),
        ).toEqual({
            error: 'Tree item ids must be unique',
        })
        expect(__charactersTestHooks.flattenTreeItems([{type: 'other', id: 'item'}])).toEqual({
            error: 'Tree item type must be folder or character',
        })
        expect(__charactersTestHooks.flattenTreeItems(['bad'])).toEqual({error: 'Tree item must be an object'})
        expect(__charactersTestHooks.flattenTreeItems([{type: 'folder'}])).toEqual({error: 'Tree item id is invalid'})
        expect(__charactersTestHooks.flattenTreeItems([{type: 'folder', id: 'folder', children: 'bad'}])).toEqual({
            error: 'Folder children must be an array',
        })
        expect(__charactersTestHooks.flattenTreeItems([{type: 'character', id: 'character', children: []}])).toEqual({
            error: 'Characters cannot contain children',
        })
        expect(
            __charactersTestHooks.flattenTreeItems([
                {
                    type: 'folder',
                    id: 'root',
                    children: [{type: 'other', id: 'child'}],
                },
            ]),
        ).toEqual({
            error: 'Tree item type must be folder or character',
        })
        const tooDeepTree = [{type: 'folder', id: 'root', children: []}]
        let cursor = tooDeepTree[0] as { children: Array<{ type: string; id: string; children: unknown[] }> }
        for (let index = 0; index < 25; index += 1) {
            const child = {type: 'folder', id: `folder-${index}`, children: []}
            cursor.children.push(child)
            cursor = child
        }
        expect(__charactersTestHooks.flattenTreeItems(tooDeepTree)).toEqual({error: 'Folder nesting is too deep'})
        expect(
            __charactersTestHooks.flattenTreeItems(
                Array.from({length: 501}, (_, index) => ({
                    type: 'folder',
                    id: `folder-${index}`,
                })),
            ),
        ).toEqual({
            error: 'Tree contains too many items',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [{id: 'row', mediaIds: ['media-2', 'media-1'], forceFullWidth: true}],
                    },
                ],
            }),
        ).toEqual({
            tabs: [
                {
                    id: 'tab',
                    name: 'Tab',
                    rows: [{id: 'row', mediaIds: ['media-2', 'media-1'], forceFullWidth: false}],
                },
            ],
            mediaIds: new Set(['media-2', 'media-1']),
        })
        expect(__charactersTestHooks.parseGalleryLayout({tabs: 'bad'})).toEqual({error: 'Gallery tabs are required'})
        expect(__charactersTestHooks.parseGalleryLayout({tabs: []})).toEqual({error: 'Gallery must contain between 1 and 20 tabs'})
        expect(__charactersTestHooks.parseGalleryLayout({tabs: ['bad']})).toEqual({error: 'Gallery tab must be an object'})
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: Array.from({length: 501}, (_, index) => ({id: `row-${index}`, mediaIds: []})),
                    },
                ],
            }),
        ).toEqual({error: 'Gallery must contain 100 rows or fewer'})
        expect(__charactersTestHooks.parseGalleryLayout({tabs: [{id: '', name: 'Tab', rows: []}]})).toEqual({
            error: 'Gallery tab id is invalid',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {id: 'tab', name: 'Tab', rows: []},
                    {id: 'tab', name: 'Other', rows: []},
                ],
            }),
        ).toEqual({error: 'Gallery tab ids must be unique'})
        expect(__charactersTestHooks.parseGalleryLayout({tabs: [{id: 'tab', name: '', rows: []}]})).toEqual({
            error: 'Gallery tab name is required',
        })
        expect(__charactersTestHooks.parseGalleryLayout({tabs: [{id: 'tab', name: 'Tab', rows: 'bad'}]})).toEqual({
            error: 'Gallery tab rows are required',
        })
        expect(__charactersTestHooks.parseGalleryLayout({tabs: [{id: 'tab', name: 'Tab', rows: ['bad']}]})).toEqual({
            error: 'Gallery row must be an object',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [{id: '', mediaIds: []}],
                    },
                ],
            }),
        ).toEqual({
            error: 'Gallery row id is invalid',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [
                            {id: 'row', mediaIds: []},
                            {id: 'row', mediaIds: []},
                        ],
                    },
                ],
            }),
        ).toEqual({error: 'Gallery row ids must be unique'})
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [{id: 'row', mediaIds: 'bad'}],
                    },
                ],
            }),
        ).toEqual({
            error: 'Gallery row media ids are required',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [{id: 'row', mediaIds: ['bad/media']}],
                    },
                ],
            }),
        ).toEqual({
            error: 'Gallery media id is invalid',
        })
        expect(
            __charactersTestHooks.parseGalleryLayout({
                tabs: [
                    {
                        id: 'tab',
                        name: 'Tab',
                        rows: [{id: 'row', mediaIds: ['media', 'media']}],
                    },
                ],
            }),
        ).toEqual({
            error: 'A media item can only appear once in each gallery tab',
        })
    })

    it('parses height chart helper variants', () => {
        expect(__charactersTestHooks.parseCharacterHeightChartJson(null)).toBeNull()
        expect(__charactersTestHooks.parseCharacterHeightChartJson('{bad json')).toBeNull()
        expect(__charactersTestHooks.parseCharacterHeightChartJson(JSON.stringify({height: {meters: 1.8}}))).toBeNull()
        expect(
            __charactersTestHooks.parseCharacterHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: {key: 'height-key', contentType: 'image/png', naturalWidth: 320, naturalHeight: 640},
                    calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: true, nameTagXPercent: 50},
                }),
            ),
        ).toEqual({
            version: 1,
            height: {meters: 1.8},
            image: {key: 'height-key', contentType: 'image/png', naturalWidth: 320, naturalHeight: 640},
            calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: true, nameTagXPercent: 50},
        })
        expect(
            __charactersTestHooks.parseCharacterHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 'bad'},
                    image: null,
                    calibration: {headYPercent: 5, footYPercent: 95, nameTagXPercent: 50},
                }),
            ),
        ).toBeNull()

        expect(__charactersTestHooks.normalizeHeightChartJson('{bad json', null, null)).toEqual({error: 'Height chart JSON is invalid'})
        expect(__charactersTestHooks.normalizeHeightChartJson('x'.repeat(20_001), null, null)).toEqual({
            error: 'Height chart JSON is too large',
        })
        expect(__charactersTestHooks.normalizeHeightChartJson(JSON.stringify({version: 1}), null, null)).toEqual({
            error: 'Height and calibration data are required',
        })
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 101},
                    image: null,
                    calibration: {headYPercent: 5, footYPercent: 95},
                }),
                null,
                null,
            ),
        ).toEqual({error: 'Height must be between 0.01 and 100 meters'})
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: null,
                    calibration: {headYPercent: -1, footYPercent: 95},
                }),
                null,
                null,
            ),
        ).toEqual({error: 'Head marker must be between 0 and 100 percent'})
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: null,
                    calibration: {headYPercent: 5, footYPercent: 181, footIsVirtual: true},
                }),
                null,
                null,
            ),
        ).toEqual({error: 'Virtual foot marker must be between 0 and 180 percent'})
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: null,
                    calibration: {headYPercent: 95, footYPercent: 96},
                }),
                null,
                null,
            ),
        ).toEqual({error: 'Foot marker must be below the head marker'})
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: null,
                    calibration: {headYPercent: 5, footYPercent: 95, nameTagXPercent: 101},
                }),
                null,
                null,
            ),
        ).toEqual({error: 'Nametag marker must be between 0 and 100 percent'})
        expect(
            __charactersTestHooks.normalizeHeightChartJson(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: {key: 'missing'},
                    calibration: {headYPercent: 5, footYPercent: 95, nameTagXPercent: 50},
                }),
                null,
                null,
            ),
        ).toEqual({
            heightChart: {
                version: 1,
                height: {meters: 1.8},
                image: null,
                calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
            },
        })
    })

    it('handles preview and image metadata helper branches', async () => {
        await expect(
            __charactersTestHooks.previewFromResponse(
                new Response('not found', {status: 404, headers: {'content-type': 'text/plain'}}),
                completedImage,
                'Preview',
            ),
        ).rejects.toThrow('Preview failed with 404: not found')
        await expect(
            __charactersTestHooks.previewFromResponse(
                new Response(new Uint8Array([1]), {headers: {'content-type': 'image/jpeg'}}),
                completedImage,
                'Preview',
            ),
        ).rejects.toThrow('Preview returned an unexpected content type (image/jpeg)')
        await expect(
            __charactersTestHooks.previewFromResponse(
                new Response(new Uint8Array(), {headers: {'content-type': 'image/webp'}}),
                completedImage,
                'Preview',
            ),
        ).rejects.toThrow('Preview is empty')
        await expect(
            __charactersTestHooks.previewFromResponse(
                new Response(new Uint8Array([1]), {headers: {'content-type': 'image/webp'}}),
                completedImage,
                'Preview',
            ),
        ).rejects.toThrow('Preview returned an invalid WebP image')

        const tinyWebp = createWebpBytes(1, 1)
        const oversizedForDimensions = new Uint8Array(__charactersTestHooks.maxPreviewByteSize(1, 1) + 1)
        oversizedForDimensions.set(tinyWebp)
        await expect(
            __charactersTestHooks.previewFromResponse(
                new Response(oversizedForDimensions, {headers: {'content-type': 'image/webp'}}),
                {...completedImage, width: 1, height: 1, displayWidth: 1, displayHeight: 1},
                'Preview',
            ),
        ).rejects.toThrow('Preview is too large for its dimensions')

        expect(__charactersTestHooks.expectedPreviewDimensions({width: 4000, height: 2000})).toEqual({
            width: 1600,
            height: 800,
        })
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(2)).toEqual({flip: 'h'})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(3)).toEqual({rotate: 180})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(4)).toEqual({flip: 'v'})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(5)).toEqual({flip: 'h', rotate: 270})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(6)).toEqual({rotate: 90})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(7)).toEqual({flip: 'h', rotate: 90})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(8)).toEqual({rotate: 270})
        expect(__charactersTestHooks.cloudflareExifOrientationTransform(null)).toEqual({})
        await expect(
            __charactersTestHooks.generateMediaPreviewWithContainer(
                {} as Parameters<typeof __charactersTestHooks.generateMediaPreviewWithContainer>[0],
                'https://example.com/image.png',
                completedImage,
            ),
        ).rejects.toThrow('Preview container binding is not configured.')
        await expect(
            __charactersTestHooks.putNsfwBlurImage(
                undefined,
                createMockR2Bucket(),
                'current-user',
                'character-id',
                'media-id',
                {
                    bytes: createWebpBytes(10, 10),
                    contentType: 'image/webp',
                    width: 10,
                    height: 10,
                },
                [],
            ),
        ).rejects.toThrow('Cloudflare Images binding is not configured.')
        const failingPreviewContainer = createMockPreviewContainer([
            new Error('container failed once'),
            new Error('container failed twice'),
            new Error('container failed finally'),
        ])
        await expect(
            __charactersTestHooks.generateMediaPreviewWithContainer(
                {
                    MYOC_DOCKER_SHARP_CONTAINER: failingPreviewContainer.namespace,
                    PREVIEW_PROCESSOR_TOKEN: 'preview-token',
                } as Parameters<typeof __charactersTestHooks.generateMediaPreviewWithContainer>[0],
                'https://example.com/image.png',
                completedImage,
            ),
        ).rejects.toThrow('container failed finally')
    })

    it('reads image dimensions and profile image data URL helper branches', async () => {
        expect(__charactersTestHooks.readJsonImage('data:image/png;base64,AAAA')).toEqual({data: 'data:image/png;base64,AAAA'})
        expect(__charactersTestHooks.readJsonImage({data: 'data:image/png;base64,AAAA'})).toEqual({data: 'data:image/png;base64,AAAA'})
        expect(__charactersTestHooks.readJsonImage({data: 1})).toBeNull()
        expect(__charactersTestHooks.readProfileImageDataUrl('bad')).toEqual({
            error: 'Character profile image must be a base64 data URL',
            status: 400,
        })
        expect(__charactersTestHooks.readProfileImageDataUrl('data:image/png;base64,%%%%')).toEqual({
            error: 'Character profile image must be a base64 data URL',
            status: 400,
        })
        expect(__charactersTestHooks.readProfileImageDataUrl('data:IMAGE/PNG;base64,AQID')).toEqual({
            contentType: 'image/png',
            bytes: new Uint8Array([1, 2, 3]),
        })

        expect(__charactersTestHooks.readGifDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
        expect(__charactersTestHooks.readGifDimensions(new Uint8Array([78, 79, 84, 71, 73, 70, 2, 0, 3, 0]))).toBeNull()
        expect(__charactersTestHooks.readGifDimensions(new Uint8Array([71, 73, 70, 56, 57, 97, 2, 0, 3, 0]))).toEqual({
            width: 2,
            height: 3,
        })
        expect(__charactersTestHooks.readJpegDimensions(new Uint8Array([1, 2, 3]))).toBeNull()
        const nonMarkerJpeg = new Uint8Array(12)
        nonMarkerJpeg.set([0xff, 0xd8, 0x00])
        expect(__charactersTestHooks.readJpegDimensions(nonMarkerJpeg)).toBeNull()
        const earlyEndJpeg = new Uint8Array(12)
        earlyEndJpeg.set([0xff, 0xd8, 0xff, 0xd9])
        expect(__charactersTestHooks.readJpegDimensions(earlyEndJpeg)).toBeNull()
        const invalidLengthJpeg = new Uint8Array(12)
        invalidLengthJpeg.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])
        expect(__charactersTestHooks.readJpegDimensions(invalidLengthJpeg)).toBeNull()
        expect(__charactersTestHooks.readJpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBeNull()
        expect(__charactersTestHooks.readJpegDimensions(new Uint8Array(await createJpegFile(320, 240).arrayBuffer()))).toEqual({
            width: 320,
            height: 240,
        })
        expect(__charactersTestHooks.readJpegExifOrientation(new Uint8Array([1, 2, 3]))).toBeNull()
        expect(__charactersTestHooks.readJpegExifOrientation(nonMarkerJpeg)).toBeNull()
        expect(__charactersTestHooks.readJpegExifOrientation(earlyEndJpeg)).toBeNull()
        expect(__charactersTestHooks.readJpegExifOrientation(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
        expect(__charactersTestHooks.readJpegExifOrientation(invalidLengthJpeg)).toBeNull()
        expect(
            __charactersTestHooks.readJpegExifOrientation(new Uint8Array(await createExifOrientationJpegFile(10, 20, 6).arrayBuffer())),
        ).toBe(6)
        expect(
            __charactersTestHooks.readGalleryImageDimensions(new Uint8Array(await createPngFile(12, 34).arrayBuffer()), 'image/png'),
        ).toEqual({
            width: 12,
            height: 34,
        })
        expect(__charactersTestHooks.readGalleryImageDimensions(createWebpBytes(12, 34), 'image/webp')).toEqual({
            width: 12,
            height: 34,
        })
        expect(__charactersTestHooks.readGalleryImageDimensions(new Uint8Array([1, 2]), 'image/unknown')).toBeNull()
        expect(
            __charactersTestHooks.readGalleryImageMetadata(
                new Uint8Array(await createExifOrientationJpegFile(10, 20, 6).arrayBuffer()),
                'image/jpeg',
            ),
        ).toEqual({width: 10, height: 20, displayWidth: 20, displayHeight: 10, exifOrientation: 6})
        expect(__charactersTestHooks.readGalleryImageMetadata(new Uint8Array([1, 2, 3]), 'image/png')).toBeNull()
        expect(() => __charactersTestHooks.byteAt(new Uint8Array(), 1)).toThrow('Image byte offset out of range: 1')

        const exifHeader = new Uint8Array(64)
        exifHeader.set([69, 120, 105, 102, 0, 0], 0)
        expect(__charactersTestHooks.readExifOrientationFromApp1(new Uint8Array([1, 2, 3]), 0, 3)).toBeNull()
        exifHeader.set([88, 88], 6)
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, exifHeader.byteLength)).toBeNull()
        exifHeader.set([73, 73, 0, 0], 6)
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, exifHeader.byteLength)).toBeNull()
        exifHeader.set([73, 73, 42, 0, 4, 0, 0, 0], 6)
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, exifHeader.byteLength)).toBeNull()
        exifHeader.set([73, 73, 42, 0, 8, 0, 0, 0, 1, 0], 6)
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, 20)).toBeNull()
        exifHeader.fill(0)
        exifHeader.set([69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0], 0)
        exifHeader.set([0x12, 0x01, 4, 0, 1, 0, 0, 0, 6, 0], 16)
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, exifHeader.byteLength)).toBeNull()
        expect(__charactersTestHooks.readExifOrientationFromApp1(exifHeader, 0, 24)).toBeNull()
        const shortEntryExif = new Uint8Array(40)
        shortEntryExif.set([69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 24, 0, 0, 0], 0)
        shortEntryExif.set([1, 0], 30)
        expect(__charactersTestHooks.readExifOrientationFromApp1(shortEntryExif, 0, 33)).toBeNull()

        const ispeTooShort = new Uint8Array([0, 0, 0, 12, 105, 115, 112, 101, 0, 0, 0, 0])
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(new Uint8Array(), 0, 0, 9)).toBeNull()
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(new Uint8Array([0, 0, 0, 1, 105, 115, 112, 101]), 0, 8, 0)).toBeNull()
        expect(
            __charactersTestHooks.findIsobmffImageSpatialExtents(
                new Uint8Array([0, 0, 0, 1, 106, 117, 110, 107, 0, 0, 0, 1, 0, 0, 0, 20]),
                0,
                16,
                0,
            ),
        ).toBeNull()
        expect(
            __charactersTestHooks.findIsobmffImageSpatialExtents(
                new Uint8Array([0, 0, 0, 1, 106, 117, 110, 107, 0, 0, 0, 0, 0, 0, 0, 16]),
                0,
                16,
                0,
            ),
        ).toBeNull()
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(new Uint8Array([0, 0, 0, 0, 106, 117, 110, 107]), 0, 8, 0)).toBeNull()
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(new Uint8Array([0, 0, 0, 4, 106, 117, 110, 107]), 0, 8, 0)).toBeNull()
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(ispeTooShort, 0, ispeTooShort.byteLength, 0)).toBeNull()
        expect(__charactersTestHooks.findIsobmffImageSpatialExtents(new Uint8Array([0, 0, 0, 8, 106, 117, 110, 107]), 0, 8, 0)).toBeNull()
    })

    it('clears and removes media variants through helper branches', () => {
        const media = createMediaRecord({
            nsfw_image_key: 'nsfw-image-key',
            nsfw_content_type: 'image/png',
            nsfw_preview_image_key: 'nsfw-preview-key',
            nsfw_blur_image_key: 'nsfw-blur-key',
        })
        const nextMedia = {...media}
        const deletedKeys: string[] = []

        __charactersTestHooks.applyMediaVariantRemovals('current-user', 'character-id', media, nextMedia, true, true, deletedKeys)

        expect(nextMedia.sfw_image_key).toBeNull()
        expect(nextMedia.nsfw_image_key).toBeNull()
        expect(nextMedia.nsfw_blur_image_key).toBeNull()
        expect(deletedKeys).toContain('characters/current-user/character-id/media/media-id/sfw/sfw-image-key.png')
        expect(deletedKeys).toContain('characters/current-user/character-id/media/media-id/nsfw/blur/nsfw-blur-key.webp')

        const onlyNsfwMedia = createMediaRecord({
            sfw_image_key: null,
            sfw_content_type: null,
            sfw_preview_image_key: null,
        })
        __charactersTestHooks.clearMediaVariant(onlyNsfwMedia, 'nsfw')
        expect(onlyNsfwMedia.nsfw_image_key).toBeNull()
    })

    it('validates gallery/profile images and chunk completion helper failures', async () => {
        expect(await __charactersTestHooks.validateGalleryImage(new File([], 'empty.png', {type: 'image/png'}), 'Gallery image')).toEqual({
            error: 'Gallery image is empty',
            status: 400,
        })
        expect(
            await __charactersTestHooks.validateGalleryImage(
                new File([new Uint8Array([1])], 'bad.png', {type: 'image/png'}),
                'Gallery image',
            ),
        ).toEqual({error: 'Gallery image dimensions are required', status: 400})
        expect(await __charactersTestHooks.validateProfileImage(createMockImagesBinding(), {data: 'bad'})).toEqual({
            error: 'Character profile image must be a base64 data URL',
            status: 400,
        })
        expect(
            __charactersTestHooks.toPublicHeightChart(mediaPublicBaseUrl, 'current-user', 'character-id', {
                version: 1,
                height: {meters: 1.8},
                image: null,
                calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
            }),
        ).toEqual({
            version: 1,
            height: {meters: 1.8},
            image: null,
            calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
        })
        expect(__charactersTestHooks.toPublicHeightChart(mediaPublicBaseUrl, 'current-user', 'character-id', null)).toBeNull()
        const deleteBucket = createMockR2Bucket()
        vi.mocked(deleteBucket.delete).mockRejectedValueOnce(new Error('delete failed'))
        await expect(__charactersTestHooks.deleteR2Objects(deleteBucket, ['missing-key'])).resolves.toBeUndefined()

        const bucket = createMockR2Bucket()
        await expect(
            __charactersTestHooks.completeChunkedGalleryUpload(
                bucket,
                'current-user',
                'character-id',
                'media-id',
                {uploadId: 'upload-id', imageKey: 'image-key', contentType: 'image/png', parts: []},
                'sfw',
                'SFW image',
            ),
        ).rejects.toThrow('SFW image is empty')
    })
})

describe('remaining character route edge coverage', () => {
    it('requires authentication for remaining unsafe character routes', async () => {
        const {db} = createMockDb()
        const requests: Array<[string, RequestInit]> = [
            [
                '/characters/order',
                {
                    method: 'POST',
                    body: JSON.stringify({characterIds: []}),
                    headers: {'content-type': 'application/json'},
                },
            ],
            [
                '/characters/folders/folder-id/placements',
                {
                    method: 'PUT',
                    body: JSON.stringify({characterIds: []}),
                    headers: {'content-type': 'application/json'},
                },
            ],
            ['/characters/character-id/height-chart', {method: 'PUT', body: new FormData()}],
            [
                '/characters/character-id/media/chunked/init',
                {
                    method: 'POST',
                    body: JSON.stringify({ratings: ['sfw']}),
                    headers: {'content-type': 'application/json'},
                },
            ],
            [
                '/characters/character-id/media/chunked/media-id/sfw/upload-id/1?imageKey=image-key&contentType=image%2Fpng',
                {method: 'PUT', body: createPngFile(1, 1)},
            ],
            [
                '/characters/character-id/media/chunked/media-id/sfw/upload-id?imageKey=image-key&contentType=image%2Fpng',
                {method: 'DELETE'},
            ],
            [
                '/characters/toyhouse-import-items/item-id/fail',
                {method: 'POST', body: JSON.stringify({}), headers: {'content-type': 'application/json'}},
            ],
            [
                '/characters/toyhouse-import-items/item-id/complete',
                {method: 'POST', body: JSON.stringify({}), headers: {'content-type': 'application/json'}},
            ],
            [
                '/characters/character-id/media/chunked/complete',
                {method: 'POST', body: JSON.stringify({}), headers: {'content-type': 'application/json'}},
            ],
            [
                '/characters/character-id/media/media-id/chunked/init',
                {
                    method: 'POST',
                    body: JSON.stringify({ratings: ['sfw']}),
                    headers: {'content-type': 'application/json'},
                },
            ],
            [
                '/characters/character-id/media/media-id/chunked/complete',
                {method: 'POST', body: JSON.stringify({}), headers: {'content-type': 'application/json'}},
            ],
            ['/characters/character-id/media/media-id', {method: 'DELETE'}],
            [
                '/characters/character-id/gallery',
                {method: 'PUT', body: JSON.stringify({tabs: []}), headers: {'content-type': 'application/json'}},
            ],
        ]

        for (const [path, init] of requests) {
            const response = await apiRoutes.request(`https://example.com${path}`, init, requestEnv(db))
            expect(response.status, path).toBe(401)
            expect(await response.json(), path).toEqual({error: 'Authentication required'})
        }
    })

    it('returns route validation errors for remaining cheap branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [
                currentUserRecord,
                currentUserRecord,
                character,
                currentUserRecord,
                character,
                currentUserRecord,
                currentUserRecord,
                currentUserRecord,
            ],
        })

        const treeResponse = await postFolderTree(
            {
                items: [{type: 'folder', id: 'root', children: [{type: 'other', id: 'child'}]}],
            },
            db,
            {sessionToken, csrfToken},
        )
        expect(treeResponse.status).toBe(400)
        expect(await treeResponse.json()).toEqual({error: 'Tree item type must be folder or character'})

        const patchFolderResponse = await patchFolder('folder-id', '{bad json', db, {sessionToken, csrfToken})
        expect(patchFolderResponse.status).toBe(400)
        expect(await patchFolderResponse.json()).toEqual({error: 'Invalid JSON body'})

        const deleteUploadInvalidRating = await deleteChunkedMediaUpload(
            character.id,
            'media-id',
            'explicit',
            'upload-id',
            'image-key',
            db,
            {mediaBucket, sessionToken, csrfToken},
        )
        expect(deleteUploadInvalidRating.status).toBe(400)
        expect(await deleteUploadInvalidRating.json()).toEqual({error: 'Media rating must be sfw or nsfw'})

        const failImportBadJson = await apiRoutes.request(
            'https://example.com/characters/toyhouse-import-items/item-id/fail',
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(db),
        )
        expect(failImportBadJson.status).toBe(200)

        const failImportInvalidId = await failToyhouseImportItem('bad.id', {}, db, {sessionToken, csrfToken})
        expect(failImportInvalidId.status).toBe(400)
        expect(await failImportInvalidId.json()).toEqual({error: 'Import item id is invalid'})

        const completeImportInvalidBody = await apiRoutes.request(
            'https://example.com/characters/toyhouse-import-items/item-id/complete',
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(db),
        )
        expect(completeImportInvalidBody.status).toBe(400)
        expect(await completeImportInvalidBody.json()).toEqual({error: 'Invalid JSON body'})
    })

    it('validates delete chunked upload parameters', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()

        const invalidDeleteUploadCases: Array<[string, string, string, string]> = [
            ['bad.id', 'image-key', 'image/png', 'Media id is invalid'],
            ['media-id', '', 'image/png', 'Image key is required'],
            ['media-id', 'image-key', 'text/plain', 'Image must be PNG, JPG, GIF, WebP, or AVIF'],
        ]

        for (const [mediaId, imageKey, contentType, expectedError] of invalidDeleteUploadCases) {
            const {db} = createMockDb({
                firstResults: [currentUserRecord, character],
            })
            const response = await deleteChunkedMediaUpload(
                character.id,
                mediaId,
                'sfw',
                'upload-id',
                imageKey,
                db,
                {
                    sessionToken,
                    csrfToken,
                },
                contentType,
            )

            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({error: expectedError})
        }
    })

    it('validates Toyhou.se import completion route branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const sfwItem = {
            id: 'item-id',
            job_id: 'job-id',
            user_id: currentUserRecord.id,
            character_id: 'character-id',
            rating: 'sfw',
            status: 'pending',
            media_id: null,
        }
        const validUpload = {
            uploadId: 'upload-id',
            imageKey: 'image-key',
            contentType: 'image/png',
            parts: [{partNumber: 1, etag: 'etag'}],
        }

        const invalidIdDb = createMockDb({firstResults: [currentUserRecord]}).db
        const invalidIdResponse = await completeToyhouseImportItem('bad.id', {mediaId: 'media-id'}, invalidIdDb, {
            sessionToken,
            csrfToken,
        })
        expect(invalidIdResponse.status).toBe(400)
        expect(await invalidIdResponse.json()).toEqual({error: 'Import item id is invalid'})

        const missingDb = createMockDb({firstResults: [currentUserRecord, null]}).db
        const missingResponse = await completeToyhouseImportItem('item-id', {mediaId: 'media-id'}, missingDb, {
            sessionToken,
            csrfToken,
        })
        expect(missingResponse.status).toBe(404)
        expect(await missingResponse.json()).toEqual({error: 'Import item not found'})

        const invalidMediaDb = createMockDb({firstResults: [currentUserRecord, sfwItem]}).db
        const invalidMediaResponse = await completeToyhouseImportItem(
            'item-id',
            {mediaId: 'bad.id', sfwUpload: validUpload},
            invalidMediaDb,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(invalidMediaResponse.status).toBe(400)
        expect(await invalidMediaResponse.json()).toEqual({error: 'Media id is invalid'})

        const missingUploadDb = createMockDb({firstResults: [currentUserRecord, sfwItem]}).db
        const missingUploadResponse = await completeToyhouseImportItem('item-id', {mediaId: 'media-id'}, missingUploadDb, {
            sessionToken,
            csrfToken,
        })
        expect(missingUploadResponse.status).toBe(400)
        expect(await missingUploadResponse.json()).toEqual({error: 'SFW upload is required for this import item'})

        const oppositeUploadDb = createMockDb({firstResults: [currentUserRecord, sfwItem]}).db
        const oppositeUploadResponse = await completeToyhouseImportItem(
            'item-id',
            {mediaId: 'media-id', sfwUpload: validUpload, nsfwUpload: validUpload},
            oppositeUploadDb,
            {sessionToken, csrfToken},
        )
        expect(oppositeUploadResponse.status).toBe(400)
        expect(await oppositeUploadResponse.json()).toEqual({error: 'Import item can only complete one media rating'})

        const capacityDb = createMockDb({firstResults: [currentUserRecord, sfwItem, {count: 500}]}).db
        const capacityResponse = await completeToyhouseImportItem(
            'item-id',
            {
                mediaId: 'media-id',
                sfwUpload: validUpload,
            },
            capacityDb,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(capacityResponse.status).toBe(409)
        expect(await capacityResponse.json()).toEqual({error: 'Characters can contain 500 gallery images or fewer'})
    })

    it('validates chunked create and existing-media completion route branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})

        const invalidCreateBodyDb = createMockDb({firstResults: [currentUserRecord, character]}).db
        const invalidCreateBodyResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/media/chunked/complete`,
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(invalidCreateBodyDb),
        )
        expect(invalidCreateBodyResponse.status).toBe(400)
        expect(await invalidCreateBodyResponse.json()).toEqual({error: 'Invalid JSON body'})

        const invalidMediaDb = createMockDb({firstResults: [currentUserRecord, character]}).db
        const invalidMediaResponse = await completeChunkedMedia(character.id, {mediaId: 'bad.id'}, invalidMediaDb, {
            sessionToken,
            csrfToken,
        })
        expect(invalidMediaResponse.status).toBe(400)
        expect(await invalidMediaResponse.json()).toEqual({error: 'Media id is invalid'})

        const noUploadDb = createMockDb({firstResults: [currentUserRecord, character]}).db
        const noUploadResponse = await completeChunkedMedia(character.id, {mediaId: 'media-id'}, noUploadDb, {
            sessionToken,
            csrfToken,
        })
        expect(noUploadResponse.status).toBe(400)
        expect(await noUploadResponse.json()).toEqual({error: 'At least one image is required'})

        const existingInitDb = createMockDb({firstResults: [currentUserRecord, character, media]}).db
        const existingInitResponse = await initExistingChunkedMedia(character.id, media.id, '{bad json', existingInitDb, {
            sessionToken,
            csrfToken,
        })
        expect(existingInitResponse.status).toBe(400)
        expect(await existingInitResponse.json()).toEqual({error: 'Invalid JSON body'})

        const existingCompleteDb = createMockDb({firstResults: [currentUserRecord, character, media]}).db
        const existingCompleteResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/media/${media.id}/chunked/complete`,
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(existingCompleteDb),
        )
        expect(existingCompleteResponse.status).toBe(400)
        expect(await existingCompleteResponse.json()).toEqual({error: 'Invalid JSON body'})
    })

    it('validates gallery route invalid JSON and missing character branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()

        const invalidJsonDb = createMockDb({firstResults: [currentUserRecord]}).db
        const invalidJsonResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/gallery`,
            {
                method: 'PUT',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(invalidJsonDb),
        )
        expect(invalidJsonResponse.status).toBe(400)
        expect(await invalidJsonResponse.json()).toEqual({error: 'Invalid JSON body'})

        const missingCharacterDb = createMockDb({firstResults: [currentUserRecord, null]}).db
        const missingCharacterResponse = await putGallery(character.id, {tabs: []}, missingCharacterDb, {
            sessionToken,
            csrfToken,
        })
        expect(missingCharacterResponse.status).toBe(404)
        expect(await missingCharacterResponse.json()).toEqual({error: 'Character not found'})
    })

    it('covers remaining practical route cleanup branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)

        const invalidFolderImageDb = createMockDb({firstResults: [currentUserRecord]}).db
        const invalidFolderImageResponse = await postFolder(
            {
                name: 'Folder',
                folderImageData: 'bad',
            },
            invalidFolderImageDb,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(invalidFolderImageResponse.status).toBe(400)
        expect(await invalidFolderImageResponse.json()).toEqual({error: 'Character profile image must be a base64 data URL'})

        const folderBucket = createMockR2Bucket()
        const folderFailureDb = createMockDb({
            firstResults: [currentUserRecord],
            runError: new Error('insert failed'),
        }).db
        const folderFailureResponse = await postFolder(
            {
                name: 'Folder',
                folderImageData: createPngDataUrl(16, 16),
            },
            folderFailureDb,
            {
                mediaBucket: folderBucket,
                sessionToken,
                csrfToken,
            },
        )
        expect(folderFailureResponse.status).toBe(500)
        expect(folderBucket.delete).toHaveBeenCalled()

        const deleteFolderBucket = createMockR2Bucket()
        const deleteFolderDb = createMockDb({
            firstResults: [currentUserRecord, createFolderRecord({folder_image_key: 'folder-image-key'})],
        }).db
        const deleteFolderResponse = await deleteFolder('folder-id', deleteFolderDb, {
            mediaBucket: deleteFolderBucket,
            sessionToken,
            csrfToken,
        })
        expect(deleteFolderResponse.status).toBe(204)
        expect(deleteFolderBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/folder-image-key.webp')

        const character = createCharacterRecord()
        const patchCharacterDb = createMockDb({
            firstResults: [currentUserRecord, character],
            runError: new Error('update failed'),
        }).db
        const patchCharacterFailureResponse = await patchCharacter(character.id, {name: 'Updated'}, patchCharacterDb, {
            sessionToken,
            csrfToken,
        })
        expect(patchCharacterFailureResponse.status).toBe(500)

        const heightChartBucket = createMockR2Bucket()
        const heightChartDb = createMockDb({
            firstResults: [currentUserRecord, character],
            runError: new Error('height update failed'),
        }).db
        const form = new FormData()
        form.set(
            'heightChartJson',
            JSON.stringify({
                version: 1,
                height: {meters: 1.8},
                image: null,
                calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
            }),
        )
        form.set('heightChartImage', createPngFile(16, 32))
        const heightChartFailureResponse = await putHeightChart(character.id, form, heightChartDb, {
            mediaBucket: heightChartBucket,
            sessionToken,
            csrfToken,
        })
        expect(heightChartFailureResponse.status).toBe(500)
        expect(heightChartBucket.delete).toHaveBeenCalled()

        const deleteCharacterBucket = createMockR2Bucket()
        vi.mocked(deleteCharacterBucket.delete).mockRejectedValueOnce(new Error('profile delete failed'))
        const deleteCharacterDb = createMockDb({
            firstResults: [
                currentUserRecord,
                createCharacterRecord({
                    profile_image_key: 'profile-image-key',
                    height_chart_json: JSON.stringify({
                        version: 1,
                        height: {meters: 1.8},
                        image: {key: 'height-image-key', contentType: 'image/png', naturalWidth: 10, naturalHeight: 20},
                        calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
                    }),
                }),
            ],
            allResults: [[]],
        }).db
        const deleteCharacterResponse = await deleteCharacter(
            character.id,
            {confirmName: character.name, permanent: true},
            deleteCharacterDb,
            {mediaBucket: deleteCharacterBucket, sessionToken, csrfToken},
        )
        expect(deleteCharacterResponse.status).toBe(204)
        expect(deleteCharacterBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/profile-image-key.webp')
        expect(deleteCharacterBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/height-chart/height-image-key.png')
    })
})

function createCharacterRecord(
    overrides: Partial<{
        id: string
        user_id: string
        name: string
        profile_image_key: string | null
        folder_id: string | null
        sort_order: number
        height_chart_json: string
        created_at: string
        updated_at: string
    }> = {},
) {
    return {
        id: 'character-id',
        user_id: currentUserRecord.id,
        name: 'Vyn',
        profile_image_key: null,
        folder_id: null,
        sort_order: 0,
        height_chart_json: '',
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}

function createMediaRecord(
    overrides: Partial<{
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
    }> = {},
) {
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
        sfw_preview_image_key: 'sfw-preview-key',
        sfw_preview_width: 800,
        sfw_preview_height: 600,
        sfw_preview_byte_size: 512,
        nsfw_preview_image_key: null,
        nsfw_blur_image_key: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_preview_byte_size: null,
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}

function createFolderRecord(
    overrides: Partial<{
        id: string
        user_id: string
        name: string
        parent_folder_id: string | null
        folder_image_key: string | null
        sort_order: number
        created_at: string
        updated_at: string
    }> = {},
) {
    return {
        id: 'folder-id',
        user_id: currentUserRecord.id,
        name: 'Main Characters',
        parent_folder_id: null,
        folder_image_key: null,
        sort_order: 0,
        created_at: '2026-06-11 12:00:00',
        updated_at: '2026-06-11 12:00:00',
        ...overrides,
    }
}
