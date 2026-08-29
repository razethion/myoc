import {env} from 'cloudflare:workers'
import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES} from '../../lib/media/profileImage'
import {
    queryAll,
    queryOne,
    seedAuthenticatedUser,
    seedCharacter,
    seedFolder,
    seedMedia,
    seedUser,
    useTestDatabase,
    withFailingTrigger,
} from '../../test/d1'
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
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockR2Bucket} from '../../test/mockR2'
import {createRequestHeaders, type TestRequestOptions} from '../../test/request'
import {apiRoutes} from '../api'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const currentUserRecord = {
    id: 'current-user',
    email: 'test@example.com',
    username: 'testuser',
    profile_photo_key: null,
    bio: '',
}

const db = env.DB
useTestDatabase()

async function seedCurrentUser(sessionToken = 'session-token'): Promise<void> {
    await seedAuthenticatedUser(
        {
            id: currentUserRecord.id,
            email: currentUserRecord.email,
            username: currentUserRecord.username,
        },
        sessionToken,
        db,
    )
}

async function seedOtherUser(id = 'other-user'): Promise<void> {
    await seedUser({id}, db)
}

async function seedCharacterRecord(record = createCharacterRecord()): Promise<void> {
    await seedCharacter(
        {
            id: record.id,
            userId: record.user_id,
            name: record.name,
            profileImageKey: record.profile_image_key ?? 'profile-image-key',
            folderId: record.folder_id,
            sortOrder: record.sort_order,
            heightChartJson: record.height_chart_json,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        },
        db,
    )
}

async function seedFolderRecord(record = createFolderRecord()): Promise<void> {
    await seedFolder(
        {
            id: record.id,
            userId: record.user_id,
            name: record.name,
            parentFolderId: record.parent_folder_id,
            sortOrder: record.sort_order,
            folderImageKey: record.folder_image_key,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        },
        db,
    )
}

async function seedMediaRecord(record = createMediaRecord()): Promise<void> {
    await seedMedia(
        {
            id: record.id,
            userId: record.user_id,
            characterId: record.character_id,
            sfwImageKey: record.sfw_image_key,
            nsfwImageKey: record.nsfw_image_key,
            sfwArtist: record.sfw_artist,
            nsfwArtist: record.nsfw_artist,
            sfwWidth: record.sfw_width,
            sfwHeight: record.sfw_height,
            sfwByteSize: record.sfw_byte_size,
            nsfwWidth: record.nsfw_width,
            nsfwHeight: record.nsfw_height,
            nsfwByteSize: record.nsfw_byte_size,
            sfwContentType: record.sfw_content_type,
            nsfwContentType: record.nsfw_content_type,
            sfwPreviewImageKey: record.sfw_preview_image_key,
            sfwPreviewWidth: record.sfw_preview_width,
            sfwPreviewHeight: record.sfw_preview_height,
            sfwPreviewByteSize: record.sfw_preview_byte_size,
            nsfwPreviewImageKey: record.nsfw_preview_image_key,
            nsfwPreviewWidth: record.nsfw_preview_width,
            nsfwPreviewHeight: record.nsfw_preview_height,
            nsfwPreviewByteSize: record.nsfw_preview_byte_size,
            nsfwBlurImageKey: record.nsfw_blur_image_key,
            createdAt: record.created_at,
            updatedAt: record.updated_at,
        },
        db,
    )
}

async function seedMediaRecords(count: number, options: {characterId?: string; idPrefix?: string; userId?: string} = {}): Promise<void> {
    const characterId = options.characterId ?? 'character-id'
    const idPrefix = options.idPrefix ?? 'seed-media'
    const userId = options.userId ?? currentUserRecord.id
    const insert = db.prepare(
        `INSERT INTO character_media (
            id, user_id, character_id, sfw_image_key, sfw_content_type, sfw_width, sfw_height, sfw_byte_size
        ) VALUES (?, ?, ?, ?, 'image/png', 800, 600, 1024)`,
    )

    for (let offset = 0; offset < count; offset += 100) {
        const statements = Array.from({length: Math.min(100, count - offset)}, (_, index) => {
            const number = offset + index
            const id = `${idPrefix}-${String(number).padStart(3, '0')}`
            return insert.bind(id, userId, characterId, `${id}-sfw`)
        })
        await db.batch(statements)
    }
}

async function seedNamedMedia(mediaIds: string[], characterId = 'character-id'): Promise<void> {
    const insert = db.prepare(
        `INSERT INTO character_media (
            id, user_id, character_id, sfw_image_key, sfw_content_type, sfw_width, sfw_height, sfw_byte_size
        ) VALUES (?, ?, ?, ?, 'image/png', 800, 600, 1024)`,
    )
    await db.batch(mediaIds.map((id) => insert.bind(id, currentUserRecord.id, characterId, `${id}-sfw`)))
}

async function expectStoredSfwMedia(
    mediaId: string,
    expected: Partial<{
        sfw_content_type: string
        sfw_width: number
        sfw_height: number
        sfw_byte_size: number
        sfw_preview_width: number
        sfw_preview_height: number
    }>,
): Promise<void> {
    expect(
        await queryOne<{
            sfw_content_type: string
            sfw_width: number
            sfw_height: number
            sfw_byte_size: number
            sfw_preview_width: number
            sfw_preview_height: number
        }>(
            `SELECT sfw_content_type, sfw_width, sfw_height, sfw_byte_size,
                    sfw_preview_width, sfw_preview_height
             FROM character_media WHERE id = ?`,
            [mediaId],
            db,
        ),
    ).toMatchObject(expected)
}

async function seedToyhouseImport(
    options: {
        itemStatus?: 'pending' | 'uploading' | 'imported' | 'failed'
        jobStatus?: 'pending' | 'running' | 'complete' | 'failed'
        mediaId?: string | null
        rating?: 'sfw' | 'nsfw'
        totalImages?: number
    } = {},
): Promise<void> {
    await db
        .prepare('INSERT INTO toyhouse_import_jobs (id, user_id, status, total_images) VALUES (?, ?, ?, ?)')
        .bind('toyhouse-import-job', currentUserRecord.id, options.jobStatus ?? 'running', options.totalImages ?? 1)
        .run()
    await db
        .prepare(
            `INSERT INTO toyhouse_import_items (
                id, job_id, user_id, character_id, toyhouse_character_id, toyhouse_image_url,
                import_mode, rating, status, media_id, error, sort_order
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0)`,
        )
        .bind(
            'toyhouse-import-item',
            'toyhouse-import-job',
            currentUserRecord.id,
            'character-id',
            'toyhouse-character',
            'https://example.test/toyhouse-image.png',
            'existing',
            options.rating ?? 'sfw',
            options.itemStatus ?? 'pending',
            options.mediaId ?? null,
        )
        .run()
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
    await seedCurrentUser(sessionToken)
    await seedCharacterRecord(character)
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
    const expectedUrl = new URL(expectedUrlWithoutQuery)
    const pathParts = expectedUrl.pathname.split('/')
    const expectedSourceUrl = `${expectedUrl.origin}/${pathParts.slice(4).join('/')}`
    const expectedImageOptions = Object.fromEntries(
        (pathParts[3] ?? '').split(',').map((option) => {
            const [key, rawValue] = option.split('=')
            const value = rawValue === 'true' ? true : rawValue === 'false' ? false : Number(rawValue)

            return [key, Number.isNaN(value) ? rawValue : value]
        }),
    )
    const requestInit = init as RequestInit & {
        cf?: {
            cacheTtlByStatus?: Record<string, number>
            image?: Record<string, boolean | number | string>
        }
    }

    const parsedUrl = new URL(url)
    expect(`${parsedUrl.origin}${parsedUrl.pathname}`).toBe(expectedSourceUrl)
    expect(parsedUrl.searchParams.get('preview_cache_bust')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(init).toEqual(
        expect.objectContaining({
            cf: {
                cacheTtlByStatus: {'404': 0, '500-599': 0},
                image: expectedImageOptions,
            },
            headers: expect.objectContaining({
                accept: 'image/webp,image/*,*/*;q=0.8',
                'cache-control': 'no-cache',
            }),
        }),
    )
    expect(requestInit.cf?.image).toEqual(expectedImageOptions)

    return url
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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
    })

    it('rejects folders that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedFolder({id: 'other-users-folder', userId: 'other-user'}, db)

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
    })

    it('accepts an empty folder tree', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
    })

    it('updates folder parents and sort order from the folder tree JSON', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'main', userId: currentUserRecord.id, name: 'Main'}, db)
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)
        await seedFolder({id: 'archive', userId: currentUserRecord.id, name: 'Archive'}, db)

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
        expect(
            await queryAll<{id: string; parent_folder_id: string | null; sort_order: number}>(
                'SELECT id, parent_folder_id, sort_order FROM character_folders ORDER BY id',
                [],
                db,
            ),
        ).toEqual([
            {id: 'archive', parent_folder_id: null, sort_order: 1},
            {id: 'main', parent_folder_id: null, sort_order: 0},
            {id: 'story', parent_folder_id: 'main', sort_order: 0},
        ])
    })
})

describe('POST /characters/order', () => {
    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

        const response = await postCharacterOrder(body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
    })

    it('accepts an empty character order', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
    })

    it('updates the independent all-characters profile order', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(createCharacterRecord({id: 'razeth', name: 'Razeth', sort_order: 8}))
        await seedCharacterRecord(createCharacterRecord({id: 'vyn', name: 'Vyn', sort_order: 9}))

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
        expect(
            await queryAll<{id: string; sort_order: number}>('SELECT id, sort_order FROM characters ORDER BY sort_order', [], db),
        ).toEqual([
            {id: 'razeth', sort_order: 0},
            {id: 'vyn', sort_order: 1},
        ])
    })

    it('rejects characters that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedCharacterRecord(createCharacterRecord({id: 'razeth', name: 'Razeth'}))
        await seedCharacter({id: 'other-users-character', userId: 'other-user', name: 'Other Character'}, db)

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
    })
})

describe('PUT /characters/folders/:id/placements', () => {
    it('returns 400 for invalid folder ids', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)

        const response = await putFolderPlacements('story', '{bad json', db, {
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
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)

        const response = await putFolderPlacements('story', body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
    })

    it('replaces the ordered character placements for one folder', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)
        await seedCharacterRecord(createCharacterRecord({id: 'vyn', name: 'Vyn'}))
        await seedCharacterRecord(createCharacterRecord({id: 'razeth', name: 'Razeth'}))

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
        expect(
            await queryAll<{character_id: string; sort_order: number}>(
                'SELECT character_id, sort_order FROM character_folder_placements ORDER BY sort_order',
                [],
                db,
            ),
        ).toEqual([
            {character_id: 'vyn', sort_order: 0},
            {character_id: 'razeth', sort_order: 1},
        ])
    })

    it('clears placements when the folder order is empty', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)
        await seedCharacterRecord(createCharacterRecord({id: 'vyn', name: 'Vyn'}))
        await db
            .prepare('INSERT INTO character_folder_placements (user_id, folder_id, character_id, sort_order) VALUES (?, ?, ?, ?)')
            .bind(currentUserRecord.id, 'story', 'vyn', 0)
            .run()

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
        expect(await queryAll<{character_id: string}>('SELECT character_id FROM character_folder_placements', [], db)).toEqual([])
    })

    it('rejects placements for a folder the current user does not own', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
    })

    it('rejects characters that are not owned by the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedFolder({id: 'story', userId: currentUserRecord.id, name: 'Story'}, db)
        await seedCharacterRecord(createCharacterRecord({id: 'vyn', name: 'Vyn'}))
        await seedCharacter({id: 'other-users-character', userId: 'other-user', name: 'Other Character'}, db)

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
    })
})

describe('POST /characters/folders', () => {
    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser()

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
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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

        expect(
            await queryOne<{
                id: string
                user_id: string
                name: string
                parent_folder_id: string | null
                folder_image_key: string | null
                sort_order: number
            }>(
                'SELECT id, user_id, name, parent_folder_id, folder_image_key, sort_order FROM character_folders WHERE id = ?',
                [body.folder.id],
                db,
            ),
        ).toEqual({
            id: body.folder.id,
            user_id: currentUserRecord.id,
            name: 'Main Characters',
            parent_folder_id: null,
            folder_image_key: null,
            sort_order: 0,
        })
    })

    it('creates a folder with a cropped image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)

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
        expect(
            await queryOne<{folder_image_key: string}>('SELECT folder_image_key FROM character_folders WHERE id = ?', [body.folder.id], db),
        ).toEqual({folder_image_key: body.folder.folderImageKey})
    })

    it('creates a folder by converting a PNG cropped image data URL to WebP', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        await seedCurrentUser(sessionToken)

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

    it('allows base64-expanded folder image JSON bodies to reach image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        await seedCurrentUser(sessionToken)

        const response = await postFolder(
            {
                name: 'Main Characters',
                parentFolderId: 'root',
                folderImageData: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`,
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
        expect(imagesBinding.input).toHaveBeenCalledOnce()
        expect(mediaBucket.put).toHaveBeenCalledOnce()
    })

    it('creates a nested folder', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'main', userId: currentUserRecord.id, name: 'Main'}, db)

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
        expect(
            await queryOne<{parent_folder_id: string | null}>(
                'SELECT parent_folder_id FROM character_folders WHERE id = ?',
                [body.folder.id],
                db,
            ),
        ).toEqual({parent_folder_id: 'main'})
    })
})

describe('PATCH /characters/folders/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser()

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
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)

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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)

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
        expect(
            await queryOne<{name: string; folder_image_key: string | null}>(
                'SELECT name, folder_image_key FROM character_folders WHERE id = ?',
                [folder.id],
                db,
            ),
        ).toEqual({name: 'Renamed Folder', folder_image_key: 'folder-image-id'})
    })
})

describe('POST /characters/folders/:id/image', () => {
    it('rejects folder image uploads that are larger than 3 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const form = new FormData()
        form.set('folderImage', createWebpFile())

        const response = await postFolderImage('folder-id', form, db, {
            contentLength: String(PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES + 1),
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Folder image upload is too large',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('allows multipart framing around a 3 MB folder image before image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord()
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
        const form = new FormData()
        form.set('folderImage', new File([new Uint8Array(3 * 1024 * 1024)], 'folder.webp', {type: 'image/webp'}))

        const response = await postFolderImage(folder.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Folder image must be 2 MB or smaller'})
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
        const form = new FormData()
        form.set('folderImage', createWebpFile())
        const csrfToken = await createCsrfToken(sessionToken)

        const response = await postFolderImage(folder.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken,
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
        expect(
            await queryOne<{folder_image_key: string}>('SELECT folder_image_key FROM character_folders WHERE id = ?', [folder.id], db),
        ).toEqual({folder_image_key: body.folderImageKey})
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/old-folder-image.webp')
    })

    it('deletes the uploaded folder image when the D1 update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const folder = createFolderRecord()
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
        const form = new FormData()
        form.set('folderImage', createWebpFile())
        const csrfToken = await createCsrfToken(sessionToken)

        try {
            const response = await withFailingTrigger(
                {
                    name: 'folder_image_update',
                    operation: 'UPDATE',
                    table: 'character_folders',
                    columns: ['folder_image_key'],
                },
                () =>
                    postFolderImage(folder.id, form, db, {
                        mediaBucket,
                        sessionToken,
                        csrfToken,
                    }),
                db,
            )

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/folders/folder-id/image/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
            expect(
                await queryOne<{folder_image_key: string | null}>(
                    'SELECT folder_image_key FROM character_folders WHERE id = ?',
                    [folder.id],
                    db,
                ),
            ).toEqual({folder_image_key: null})
        } finally {
            error.mockRestore()
        }
    })
})

describe('DELETE /characters/folders/:id/image', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await deleteFolderImage('folder-id', db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)

        const response = await deleteFolderImage(folder.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(
            await queryOne<{folder_image_key: string | null}>(
                'SELECT folder_image_key FROM character_folders WHERE id = ?',
                [folder.id],
                db,
            ),
        ).toEqual({folder_image_key: null})
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/folder-image-id.webp')
    })

    it('clears an empty folder image without deleting an R2 object', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const folder = createFolderRecord()
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)

        const response = await deleteFolderImage(folder.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(
            await queryOne<{folder_image_key: string | null}>(
                'SELECT folder_image_key FROM character_folders WHERE id = ?',
                [folder.id],
                db,
            ),
        ).toEqual({folder_image_key: null})
        expect(mediaBucket.delete).not.toHaveBeenCalled()
    })
})

describe('POST /characters', () => {
    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser()

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
    })

    it('returns 400 for invalid JSON', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)

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
    })

    it('returns 404 when the selected folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)

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
        expect(
            await queryOne<{
                name: string
                profile_image_key: string
                folder_id: string | null
                sort_order: number
                size_chart_bytes: number
            }>(
                'SELECT name, profile_image_key, folder_id, sort_order, length(size_chart_id) AS size_chart_bytes FROM characters WHERE id = ?',
                [body.character.id],
                db,
            ),
        ).toEqual({
            name: 'Vyn "The Hawk"',
            profile_image_key: body.character.profileImageKey,
            folder_id: null,
            sort_order: 0,
            size_chart_bytes: 6,
        })
    })

    it('creates characters with allowed punctuation at the start and within the name', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)

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
        expect(await queryOne<{name: string}>('SELECT name FROM characters WHERE id = ?', [body.character.id], db)).toEqual({name: '"Ivo"'})
    })

    it('creates a character with a profile image from the reference form fields', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)
        await seedFolder({id: 'story-arc', userId: currentUserRecord.id, name: 'Story Arc'}, db)
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
        expect(
            await queryOne<{name: string; profile_image_key: string; folder_id: string | null}>(
                'SELECT name, profile_image_key, folder_id FROM characters WHERE id = ?',
                [body.character.id],
                db,
            ),
        ).toEqual({name: 'Ren', profile_image_key: body.character.profileImageKey, folder_id: 'story-arc'})
        expect(
            await queryOne<{sort_order: number}>(
                'SELECT sort_order FROM character_folder_placements WHERE folder_id = ? AND character_id = ?',
                ['story-arc', body.character.id],
                db,
            ),
        ).toEqual({sort_order: 0})
    })

    it('rejects unsupported profile image types', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
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
        await seedCurrentUser(sessionToken)
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile())

        const response = await postCharacter(form, db, {
            contentLength: String(PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES + 1),
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Character profile image upload is too large',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('allows multipart framing around a 3 MB character profile image before image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', new File([new Uint8Array(3 * 1024 * 1024)], 'profile.webp', {type: 'image/webp'}))

        const response = await postCharacter(form, db, {
            mediaBucket,
            sessionToken,
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Character profile image must be 2 MB or smaller'})
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('allows base64-expanded JSON profile image bodies to reach image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        await seedCurrentUser(sessionToken)

        const response = await postCharacter(
            {
                name: 'Ren',
                folderId: 'root',
                profileImageData: `data:image/png;base64,${'A'.repeat(3 * 1024 * 1024)}`,
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
        expect(imagesBinding.input).toHaveBeenCalledOnce()
        expect(mediaBucket.put).toHaveBeenCalledOnce()
    })

    it('returns 409 when the character name already exists for the current user', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(createCharacterRecord({id: 'existing-ren', name: 'Ren'}))
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
        await seedCurrentUser(sessionToken)
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('new-character-name', 'Ren')
        form.set('new-character-profile-image', createWebpFile())

        try {
            const response = await withFailingTrigger(
                {name: 'character_insert', operation: 'INSERT', table: 'characters'},
                () => postCharacter(form, db, {mediaBucket, sessionToken}),
                db,
            )

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/${uuidPattern}/profile/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
            expect(await queryAll<{id: string}>('SELECT id FROM characters', [], db)).toEqual([])
        } finally {
            error.mockRestore()
        }
    })
})

describe('PATCH /characters/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser(sessionToken)

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
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedCharacter({id: 'missing-character', userId: 'other-user', name: 'Other Character'}, db)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryOne<{name: string; description: string}>(
                'SELECT name, description FROM characters WHERE id = ?',
                [character.id],
                db,
            ),
        ).toEqual({name: character.name, description: ''})
    })

    it('returns 400 when the character description is too long', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryOne<{name: string; description: string}>(
                'SELECT name, description FROM characters WHERE id = ?',
                [character.id],
                db,
            ),
        ).toEqual({name: character.name, description: ''})
    })

    it('updates a character name with quoted text and hyphenated numbers', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryOne<{name: string; description: string}>(
                'SELECT name, description FROM characters WHERE id = ?',
                [character.id],
                db,
            ),
        ).toEqual({name: 'DRD-5548 "Ivo"', description: 'Updated description'})
    })

    it('returns 409 when renaming to another character name on the same account', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedCharacterRecord(createCharacterRecord({id: 'ren-id', name: 'Ren'}))

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
        expect(
            await queryOne<{name: string; description: string}>(
                'SELECT name, description FROM characters WHERE id = ?',
                [character.id],
                db,
            ),
        ).toEqual({name: character.name, description: ''})
    })
})

describe('POST /characters/:id/profile-image', () => {
    it('rejects profile image upload requests that are larger than 3 MB', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        const response = await postProfileImage('character-id', form, db, {
            contentLength: String(PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES + 1),
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Character profile image upload is too large',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('allows multipart framing around a 3 MB character profile image before image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        const form = new FormData()
        form.set('profileImage', new File([new Uint8Array(3 * 1024 * 1024)], 'profile.webp', {type: 'image/webp'}))

        const response = await postProfileImage(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Character profile image must be 2 MB or smaller'})
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedCharacter({id: 'missing-character', userId: 'other-user', name: 'Other Character'}, db)
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        expect(
            await queryOne<{profile_image_key: string}>('SELECT profile_image_key FROM characters WHERE id = ?', [character.id], db),
        ).toEqual({profile_image_key: body.profileImageKey})
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/old-profile-image.webp')
    })

    it('deletes the uploaded profile image when the D1 update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        const form = new FormData()
        form.set('profileImage', createWebpFile())
        const csrfToken = await createCsrfToken(sessionToken)

        try {
            const response = await withFailingTrigger(
                {
                    name: 'character_profile_image_update',
                    operation: 'UPDATE',
                    table: 'characters',
                    columns: ['profile_image_key'],
                },
                () => postProfileImage(character.id, form, db, {mediaBucket, sessionToken, csrfToken}),
                db,
            )

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(new RegExp(`^characters/current-user/character-id/profile/${uuidPattern}\\.webp$`))
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
            expect(
                await queryOne<{profile_image_key: string}>('SELECT profile_image_key FROM characters WHERE id = ?', [character.id], db),
            ).toEqual({profile_image_key: 'profile-image-key'})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        const form = new FormData()
        form.set('profileImage', createWebpFile())

        try {
            const response = await postProfileImage(character.id, form, db, {
                mediaBucket,
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            })

            expect(response.status).toBe(200)
            const body = (await response.json()) as {profileImageKey: string}
            expect(warning).toHaveBeenCalledWith('Unable to delete old character profile image', expect.any(Error))
            expect(
                await queryOne<{profile_image_key: string}>('SELECT profile_image_key FROM characters WHERE id = ?', [character.id], db),
            ).toEqual({profile_image_key: body.profileImageKey})
        } finally {
            warning.mockRestore()
        }
    })

    it('converts PNG character profile images to WebP before storing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        expect(
            await queryOne<{profile_image_key: string}>('SELECT profile_image_key FROM characters WHERE id = ?', [character.id], db),
        ).toEqual({profile_image_key: body.profileImageKey})
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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
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
        expect(
            await queryOne<{folder_image_key: string}>('SELECT folder_image_key FROM character_folders WHERE id = ?', [folder.id], db),
        ).toEqual({folder_image_key: body.folderImageKey})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        const stored = await queryOne<{profile_image_key: string; height_chart_json: string}>(
            'SELECT profile_image_key, height_chart_json FROM characters WHERE id = ?',
            [character.id],
            db,
        )
        expect(stored?.profile_image_key).toBe('profile-image-key')
        expect(JSON.parse(stored?.height_chart_json ?? '')).toMatchObject({height: {meters: 1.82}})
    })

    it('rejects unsupported height chart image content types', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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

    it.each([
        {
            name: 'malformed JSON',
            heightChartJson: '{not-json',
            expectedError: 'Height chart JSON is invalid',
        },
        {
            name: 'an invalid height',
            heightChartJson: JSON.stringify({
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
            expectedError: 'Height must be between 0.01 and 100 meters',
        },
        {
            name: 'invalid marker positions',
            heightChartJson: JSON.stringify({
                version: 1,
                height: {
                    meters: 1.82,
                },
                image: null,
                calibration: {
                    headYPercent: 95,
                    footYPercent: 95,
                    footIsVirtual: false,
                    nameTagXPercent: 50,
                },
            }),
            expectedError: 'Foot marker must be below the head marker',
        },
    ])('deletes an uploaded height chart image for $name', async ({heightChartJson, expectedError}) => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        const form = new FormData()
        form.set('heightChartJson', heightChartJson)
        form.set('heightChartImage', createPngFile(320, 640))

        const response = await putHeightChart(character.id, form, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: expectedError,
        })
        const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
        expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
    })

    it('saves normalized height chart data and stores the uploaded image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        const stored = await queryOne<{height_chart_json: string}>(
            'SELECT height_chart_json FROM characters WHERE id = ?',
            [character.id],
            db,
        )
        expect(JSON.parse(stored?.height_chart_json ?? '')).toEqual({
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
    })

    it('uses uploaded file dimensions when height chart image bytes cannot be parsed', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        const stored = await queryOne<{height_chart_json: string}>(
            'SELECT height_chart_json FROM characters WHERE id = ?',
            [character.id],
            db,
        )
        expect(JSON.parse(stored?.height_chart_json ?? '').image).toMatchObject({naturalWidth: 321, naturalHeight: 654})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        const stored = await queryOne<{height_chart_json: string}>(
            'SELECT height_chart_json FROM characters WHERE id = ?',
            [character.id],
            db,
        )
        expect(JSON.parse(stored?.height_chart_json ?? '').image.key).toBe('existing-height-chart')
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        const body = (await response.json()) as {heightChart: {image: {key: string}}}
        expect(body.heightChart.image.key).not.toBe('old-height-chart')
        const stored = await queryOne<{height_chart_json: string}>(
            'SELECT height_chart_json FROM characters WHERE id = ?',
            [character.id],
            db,
        )
        expect(JSON.parse(stored?.height_chart_json ?? '').image.key).toBe(body.heightChart.image.key)
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
    ])(
        'rejects invalid chunked upload part requests with $error',
        async ({rating, mediaId, imageKey, contentType, partNumber, body, error}) => {
            const sessionToken = 'session-token'
            const mediaBucket = createMockR2Bucket()
            const character = createCharacterRecord()
            await seedCurrentUser(sessionToken)
            await seedCharacterRecord(character)

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
        },
    )

    it('rejects chunked upload parts with no request body', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        expect(initBody.uploads.sfw.chunkSize).toBe(5 * 1024 * 1024)

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
        expect(
            await queryOne<{
                sfw_image_key: string
                sfw_content_type: string
                sfw_artist: string
                sfw_width: number
                sfw_height: number
                sfw_byte_size: number
                sfw_preview_image_key: string
                sfw_preview_width: number
                sfw_preview_height: number
            }>(
                `SELECT sfw_image_key, sfw_content_type, sfw_artist, sfw_width, sfw_height, sfw_byte_size,
                        sfw_preview_image_key, sfw_preview_width, sfw_preview_height
                 FROM character_media WHERE id = ?`,
                [body.media.id],
                db,
            ),
        ).toEqual({
            sfw_image_key: body.media.sfwImageKey,
            sfw_content_type: 'image/png',
            sfw_artist: 'Chunk Artist',
            sfw_width: 10000,
            sfw_height: 10000,
            sfw_byte_size: pngFile.size,
            sfw_preview_image_key: body.media.sfwPreviewImageKey,
            sfw_preview_width: 1600,
            sfw_preview_height: 1600,
        })
        expect(
            await queryOne<{media_id: string}>('SELECT media_id FROM admin_image_review_queue WHERE media_id = ?', [body.media.id], db),
        ).toEqual({media_id: body.media.id})
    })

    it('passes EXIF orientation transforms to Cloudflare Images for gallery previews', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {
            sfw_width: 4608,
            sfw_height: 3456,
            sfw_preview_width: 1200,
            sfw_preview_height: 1600,
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {
            sfw_width: 4608,
            sfw_height: 3456,
            sfw_preview_width: 1200,
            sfw_preview_height: 1600,
        })
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
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

        for (const testCase of cases) {
            const mediaBucket = createMockR2Bucket()
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
            await expectStoredSfwMedia(initBody.mediaId, {
                sfw_preview_width: testCase.expectedPreview.width,
                sfw_preview_height: testCase.expectedPreview.height,
            })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {sfw_preview_width: 800, sfw_preview_height: 600})
    })

    it('cleans up a completed upload when the preview service returns an empty body', async () => {
        const {sessionToken, mediaBucket, character, csrfToken, initBody} = await createChunkedSfwUploadTestContext()
        const previewContainer = createMockPreviewContainer(
            new Response(new Uint8Array(), {
                headers: {
                    'content-type': 'image/webp',
                },
            }),
        )
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
        const sourceObjectKey = `characters/current-user/character-id/media/${initBody.mediaId}/sfw/${initBody.uploads.sfw.imageKey}.png`
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const response = await completeChunkedMedia(
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
                    cloudflarePreviewResponse: new Response(new Uint8Array([1]), {
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

            expect(response.status).toBe(500)
            expect(await response.json()).toEqual({
                error: expect.stringMatching(/^Media upload could not be completed\..*contact support with reference /),
            })
            expect(await queryOne('SELECT id FROM character_media WHERE id = ?', [initBody.mediaId], db)).toBeNull()
            expect(await mediaBucket.head(sourceObjectKey)).toBeNull()
        } finally {
            warning.mockRestore()
            error.mockRestore()
        }
    }, 10_000)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {sfw_preview_width: 800, sfw_preview_height: 600})
    }, 10_000)

    it('retries Cloudflare preview generation when the transform request fails transiently', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {sfw_preview_width: 800, sfw_preview_height: 600})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {sfw_preview_width: 800, sfw_preview_height: 600})
    }, 12_000)

    it('rejects completed gallery uploads when the character is already at the media limit', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecords(500)

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
        expect(
            await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM character_media WHERE character_id = ?', [character.id], db),
        ).toEqual({count: 500})
        expect(await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', ['media-id'], db)).toBeNull()
    })

    it('generates and stores blurred variants for NSFW gallery previews', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        expect(
            await queryOne<{
                sfw_image_key: string | null
                nsfw_image_key: string
                nsfw_content_type: string
                nsfw_width: number
                nsfw_height: number
                nsfw_preview_image_key: string
                nsfw_blur_image_key: string
            }>(
                `SELECT sfw_image_key, nsfw_image_key, nsfw_content_type, nsfw_width, nsfw_height,
                        nsfw_preview_image_key, nsfw_blur_image_key
                 FROM character_media WHERE id = ?`,
                [initBody.mediaId],
                db,
            ),
        ).toEqual({
            sfw_image_key: null,
            nsfw_image_key: initBody.uploads.nsfw.imageKey,
            nsfw_content_type: 'image/png',
            nsfw_width: 800,
            nsfw_height: 600,
            nsfw_preview_image_key: expect.any(String),
            nsfw_blur_image_key: body.media.nsfwBlurImageKey,
        })
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
        await expectStoredSfwMedia(initBody.mediaId, {sfw_width: 800, sfw_height: 600})
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
        expect(await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', [initBody.mediaId], db)).toBeNull()
        expect(await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', [initBody.mediaId], db)).toBeNull()
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
        expect(await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', [initBody.mediaId], db)).toBeNull()
    })

    it('keeps chunked GIF gallery media as GIF', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {
            sfw_content_type: 'image/gif',
            sfw_width: 320,
            sfw_height: 240,
            sfw_byte_size: gifFile.size,
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
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
        await expectStoredSfwMedia(initBody.mediaId, {
            sfw_content_type: contentType,
            sfw_width: 640,
            sfw_height: 480,
            sfw_byte_size: file.size,
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord()
        await seedToyhouseImport()

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
        expect(
            await queryOne<{status: string; error: string}>(
                'SELECT status, error FROM toyhouse_import_items WHERE id = ?',
                ['toyhouse-import-item'],
                db,
            ),
        ).toEqual({status: 'failed', error: 'Toyhou.se returned 404'})
        expect(
            await queryOne<{status: string}>('SELECT status FROM toyhouse_import_jobs WHERE id = ?', ['toyhouse-import-job'], db),
        ).toEqual({status: 'failed'})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedToyhouseImport()
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
        await expectStoredSfwMedia(body.media.id, {
            sfw_content_type: 'image/png',
            sfw_width: 800,
            sfw_height: 600,
            sfw_byte_size: pngFile.size,
            sfw_preview_width: 800,
            sfw_preview_height: 600,
        })
        expect(
            await queryOne<{status: string; media_id: string; error: string}>(
                'SELECT status, media_id, error FROM toyhouse_import_items WHERE id = ?',
                [importItem.id],
                db,
            ),
        ).toEqual({status: 'imported', media_id: body.media.id, error: ''})
        expect(
            await queryOne<{status: string}>('SELECT status FROM toyhouse_import_jobs WHERE id = ?', ['toyhouse-import-job'], db),
        ).toEqual({status: 'complete'})
    })

    it('fails a Toyhou.se import item and removes uploaded objects when its transaction fails', async () => {
        const {sessionToken, mediaBucket, character, csrfToken, initBody} = await createChunkedSfwUploadTestContext()
        await seedToyhouseImport()
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
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const response = await withFailingTrigger(
                {
                    name: 'toyhouse_media_insert_failure',
                    operation: 'INSERT',
                    table: 'character_media',
                },
                () =>
                    completeToyhouseImportItem(
                        'toyhouse-import-item',
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
                    ),
                db,
            )

            expect(response.status).toBe(500)
            const responseBody = (await response.json()) as {error: string}
            expect(responseBody.error).toMatch(/^Media upload could not be completed\..*contact support with reference /)
            expect(
                await queryOne<{status: string; media_id: string | null; error: string}>(
                    'SELECT status, media_id, error FROM toyhouse_import_items WHERE id = ?',
                    ['toyhouse-import-item'],
                    db,
                ),
            ).toEqual({status: 'failed', media_id: null, error: responseBody.error})
            expect(
                await queryOne<{status: string}>('SELECT status FROM toyhouse_import_jobs WHERE id = ?', ['toyhouse-import-job'], db),
            ).toEqual({status: 'failed'})
            expect(await queryOne('SELECT id FROM character_media WHERE id = ?', [initBody.mediaId], db)).toBeNull()
            const storedObjects = await mediaBucket.list({
                prefix: `characters/current-user/character-id/media/${initBody.mediaId}/`,
            })
            expect(storedObjects.objects).toEqual([])
        } finally {
            error.mockRestore()
        }
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)
        await seedToyhouseImport({itemStatus: 'imported', jobStatus: 'complete', mediaId: media.id})

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
        expect(
            await queryOne<{status: string; media_id: string}>(
                'SELECT status, media_id FROM toyhouse_import_items WHERE id = ?',
                [importItem.id],
                db,
            ),
        ).toEqual({status: 'imported', media_id: media.id})
    })

    it('initializes chunked replacement uploads for existing media', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)

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
        expect(await queryOne<{sfw_image_key: string}>('SELECT sfw_image_key FROM character_media WHERE id = ?', [media.id], db)).toEqual({
            sfw_image_key: media.sfw_image_key,
        })
    })

    it('returns 404 when initializing a replacement upload for missing media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)

        const response = await completeExistingChunkedMedia(character.id, media.id, body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(
            await queryOne<{sfw_image_key: string; nsfw_image_key: string | null}>(
                'SELECT sfw_image_key, nsfw_image_key FROM character_media WHERE id = ?',
                [media.id],
                db,
            ),
        ).toEqual({sfw_image_key: media.sfw_image_key, nsfw_image_key: null})
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)

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
        expect(
            await queryOne<{
                sfw_image_key: string | null
                sfw_preview_image_key: string | null
                nsfw_image_key: string
                nsfw_artist: string
                nsfw_preview_image_key: string
                nsfw_blur_image_key: string
            }>(
                `SELECT sfw_image_key, sfw_preview_image_key, nsfw_image_key, nsfw_artist,
                        nsfw_preview_image_key, nsfw_blur_image_key
                 FROM character_media WHERE id = ?`,
                [media.id],
                db,
            ),
        ).toEqual({
            sfw_image_key: null,
            sfw_preview_image_key: null,
            nsfw_image_key: 'nsfw-image-key',
            nsfw_artist: 'Kept Artist',
            nsfw_preview_image_key: 'nsfw-preview-key',
            nsfw_blur_image_key: 'nsfw-blur-key',
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)
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
        await expectStoredSfwMedia(media.id, {
            sfw_content_type: 'image/png',
            sfw_width: 640,
            sfw_height: 480,
            sfw_byte_size: pngFile.size,
            sfw_preview_width: 640,
            sfw_preview_height: 480,
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)
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
        expect(
            await queryOne<{
                sfw_image_key: string
                nsfw_image_key: string
                nsfw_artist: string
                nsfw_width: number
                nsfw_height: number
                nsfw_preview_width: number
                nsfw_preview_height: number
                nsfw_blur_image_key: string
            }>(
                `SELECT sfw_image_key, nsfw_image_key, nsfw_artist, nsfw_width, nsfw_height,
                        nsfw_preview_width, nsfw_preview_height, nsfw_blur_image_key
                 FROM character_media WHERE id = ?`,
                [media.id],
                db,
            ),
        ).toEqual({
            sfw_image_key: media.sfw_image_key,
            nsfw_image_key: initBody.uploads.nsfw.imageKey,
            nsfw_artist: 'New NSFW Artist',
            nsfw_width: 640,
            nsfw_height: 480,
            nsfw_preview_width: 640,
            nsfw_preview_height: 480,
            nsfw_blur_image_key: body.media.nsfwBlurImageKey,
        })
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)

        const response = await deleteCharacterMedia(character.id, media.id, db, {
            mediaBucket,
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', [media.id], db)).toBeNull()
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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('rejects gallery rows containing more than five images', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('rejects gallery layouts containing media outside the character', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedCharacterRecord(createCharacterRecord({id: 'other-character', name: 'Other Character'}))
        await seedNamedMedia(['other-media'], 'other-character')

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('chunks gallery media ownership validation to stay under D1 SQL variable limits', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        const mediaIds = Array.from({length: 120}, (_, index) => `media-${index}`)
        const rows = Array.from({length: 24}, (_, index) => ({
            id: `row-${index}`,
            mediaIds: mediaIds.slice(index * 5, (index + 1) * 5),
        }))
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(mediaIds)

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
        expect(
            await queryOne<{count: number}>(
                'SELECT COUNT(*) AS count FROM character_gallery_rows WHERE character_id = ?',
                [character.id],
                db,
            ),
        ).toEqual({count: 24})
        expect(
            await queryOne<{count: number}>(
                `SELECT COUNT(*) AS count
                 FROM character_gallery_row_media
                 INNER JOIN character_gallery_rows ON character_gallery_rows.id = character_gallery_row_media.row_id
                 WHERE character_gallery_rows.character_id = ?`,
                [character.id],
                db,
            ),
        ).toEqual({count: 120})
    })

    it('saves tab-only gallery layouts as normalized JSON structure', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryAll<{id: string; name: string; sort_order: number}>(
                'SELECT id, name, sort_order FROM character_gallery_tabs',
                [],
                db,
            ),
        ).toEqual([{id: 'tab-one', name: 'default', sort_order: 0}])
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_rows', [], db)).toEqual([])
        expect(await queryAll<{row_id: string}>('SELECT row_id FROM character_gallery_row_media', [], db)).toEqual([])
    })

    it('persists gallery tabs in request order', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryAll<{id: string; sort_order: number}>(
                'SELECT id, sort_order FROM character_gallery_tabs ORDER BY sort_order',
                [],
                db,
            ),
        ).toEqual([
            {id: 'tab-zeta', sort_order: 0},
            {id: 'tab-alpha', sort_order: 1},
            {id: 'tab-default', sort_order: 2},
        ])
    })

    it('persists gallery rows in request order', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryAll<{id: string; sort_order: number}>(
                'SELECT id, sort_order FROM character_gallery_rows ORDER BY sort_order',
                [],
                db,
            ),
        ).toEqual([
            {id: 'row-third', sort_order: 0},
            {id: 'row-first', sort_order: 1},
            {id: 'row-second', sort_order: 2},
        ])
    })

    it('persists force full width for non-final single-image rows and checked final single-image rows', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(['media-one', 'media-two', 'media-three', 'media-four'])

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

        expect(
            await queryAll<{id: string; force_full_width: number}>(
                'SELECT id, force_full_width FROM character_gallery_rows ORDER BY sort_order',
                [],
                db,
            ),
        ).toEqual([
            {id: 'row-auto', force_full_width: 1},
            {id: 'row-ignored', force_full_width: 0},
            {id: 'row-final-forced', force_full_width: 1},
        ])
    })

    it('allows a single-row tab to leave force full width disabled', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(['media-one'])

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

        expect(
            await queryOne<{force_full_width: number}>(
                'SELECT force_full_width FROM character_gallery_rows WHERE id = ?',
                ['row-only'],
                db,
            ),
        ).toEqual({force_full_width: 0})
    })

    it('rejects gallery layouts when uploaded media is not placed on any tab', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(['media-one', 'media-two'])

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('rejects empty gallery rows when the character has uploaded media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(['media-one'])

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('rejects blank gallery tabs when the character has uploaded media', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedNamedMedia(['media-one'])

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
        expect(await queryAll<{id: string}>('SELECT id FROM character_gallery_tabs', [], db)).toEqual([])
    })

    it('saves a custom name for the default gallery tab', async () => {
        const sessionToken = 'session-token'
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(
            await queryOne<{name: string; sort_order: number}>(
                'SELECT name, sort_order FROM character_gallery_tabs WHERE id = ?',
                ['tab-default'],
                db,
            ),
        ).toEqual({name: 'References', sort_order: 0})
    })
})

describe('DELETE /characters/folders/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await deleteFolder('folder-id', db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        await seedCurrentUser()

        const response = await deleteFolder('folder-id', db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
    })

    it('returns 404 when the folder does not belong to the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedFolder({id: 'missing-folder', userId: 'other-user'}, db)

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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord(folder)
        await seedFolder({id: 'child-folder', userId: currentUserRecord.id, name: 'Child', parentFolderId: folder.id}, db)
        await seedCharacterRecord(createCharacterRecord({folder_id: folder.id}))
        await db
            .prepare('INSERT INTO character_folder_placements (user_id, folder_id, character_id, sort_order) VALUES (?, ?, ?, ?)')
            .bind(currentUserRecord.id, folder.id, 'character-id', 0)
            .run()

        const response = await deleteFolder('folder-id', db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(204)
        expect(await queryOne<{id: string}>('SELECT id FROM character_folders WHERE id = ?', [folder.id], db)).toBeNull()
        expect(
            await queryOne<{parent_folder_id: string | null}>(
                'SELECT parent_folder_id FROM character_folders WHERE id = ?',
                ['child-folder'],
                db,
            ),
        ).toEqual({parent_folder_id: null})
        expect(await queryOne<{folder_id: string | null}>('SELECT folder_id FROM characters WHERE id = ?', ['character-id'], db)).toEqual({
            folder_id: null,
        })
        expect(await queryAll<{folder_id: string}>('SELECT folder_id FROM character_folder_placements', [], db)).toEqual([])
    })
})

describe('DELETE /characters/:id', () => {
    it('returns 401 when the user is not logged in', async () => {
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
        await seedCurrentUser(sessionToken)
        await seedOtherUser()
        await seedCharacter({id: 'missing-character', userId: 'other-user', name: 'Vyn'}, db)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord()

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
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', ['character-id'], db)).toEqual({id: 'character-id'})
    })

    it('requires the permanent deletion confirmation', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord()

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
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', ['character-id'], db)).toEqual({id: 'character-id'})
    })

    it('rejects a mismatched character name confirmation', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord()

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
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', ['character-id'], db)).toEqual({id: 'character-id'})
    })

    it('deletes a character and its profile image', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord({
            profile_image_key: 'profile-image-id',
        })
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

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
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', [character.id], db)).toBeNull()
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/profile-image-id.webp')
    })

    it('loads media objects in chunks before deleting a character', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecords(101, {idPrefix: 'media'})

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
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', [character.id], db)).toBeNull()
        expect(await queryAll<{id: string}>('SELECT id FROM character_media', [], db)).toEqual([])
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/media/media-100/sfw/media-100-sfw.png')
    })
})

describe('remaining character route edge coverage', () => {
    it('requires authentication for remaining unsafe character routes', async () => {
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
        await seedCurrentUser(sessionToken)
        await seedFolderRecord()
        await seedCharacterRecord(character)

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
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)

        const invalidDeleteUploadCases: Array<[string, string, string, string]> = [
            ['bad.id', 'image-key', 'image/png', 'Media id is invalid'],
            ['media-id', '', 'image/png', 'Image key is required'],
            ['media-id', 'image-key', 'text/plain', 'Image must be PNG, JPG, GIF, WebP, or AVIF'],
        ]

        for (const [mediaId, imageKey, contentType, expectedError] of invalidDeleteUploadCases) {
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
        await seedCurrentUser(sessionToken)
        const validUpload = {
            uploadId: 'upload-id',
            imageKey: 'image-key',
            contentType: 'image/png',
            parts: [{partNumber: 1, etag: 'etag'}],
        }

        const invalidIdResponse = await completeToyhouseImportItem('bad.id', {mediaId: 'media-id'}, db, {
            sessionToken,
            csrfToken,
        })
        expect(invalidIdResponse.status).toBe(400)
        expect(await invalidIdResponse.json()).toEqual({error: 'Import item id is invalid'})

        const missingResponse = await completeToyhouseImportItem('item-id', {mediaId: 'media-id'}, db, {
            sessionToken,
            csrfToken,
        })
        expect(missingResponse.status).toBe(404)
        expect(await missingResponse.json()).toEqual({error: 'Import item not found'})

        await seedCharacterRecord()
        await seedToyhouseImport()
        const invalidMediaResponse = await completeToyhouseImportItem(
            'toyhouse-import-item',
            {mediaId: 'bad.id', sfwUpload: validUpload},
            db,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(invalidMediaResponse.status).toBe(400)
        expect(await invalidMediaResponse.json()).toEqual({error: 'Media id is invalid'})

        const missingUploadResponse = await completeToyhouseImportItem('toyhouse-import-item', {mediaId: 'media-id'}, db, {
            sessionToken,
            csrfToken,
        })
        expect(missingUploadResponse.status).toBe(400)
        expect(await missingUploadResponse.json()).toEqual({error: 'SFW upload is required for this import item'})

        const oppositeUploadResponse = await completeToyhouseImportItem(
            'toyhouse-import-item',
            {mediaId: 'media-id', sfwUpload: validUpload, nsfwUpload: validUpload},
            db,
            {sessionToken, csrfToken},
        )
        expect(oppositeUploadResponse.status).toBe(400)
        expect(await oppositeUploadResponse.json()).toEqual({error: 'Import item can only complete one media rating'})

        await seedMediaRecords(500)
        const capacityResponse = await completeToyhouseImportItem(
            'toyhouse-import-item',
            {
                mediaId: 'media-id',
                sfwUpload: validUpload,
            },
            db,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(capacityResponse.status).toBe(409)
        expect(await capacityResponse.json()).toEqual({error: 'Characters can contain 500 gallery images or fewer'})
        expect(
            await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM character_media WHERE character_id = ?', ['character-id'], db),
        ).toEqual({count: 500})
    })

    it('validates chunked create and existing-media completion route branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()
        const media = createMediaRecord({character_id: character.id})
        await seedCurrentUser(sessionToken)
        await seedCharacterRecord(character)
        await seedMediaRecord(media)

        const invalidCreateBodyResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/media/chunked/complete`,
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(db),
        )
        expect(invalidCreateBodyResponse.status).toBe(400)
        expect(await invalidCreateBodyResponse.json()).toEqual({error: 'Invalid JSON body'})

        const invalidMediaResponse = await completeChunkedMedia(character.id, {mediaId: 'bad.id'}, db, {
            sessionToken,
            csrfToken,
        })
        expect(invalidMediaResponse.status).toBe(400)
        expect(await invalidMediaResponse.json()).toEqual({error: 'Media id is invalid'})

        const noUploadResponse = await completeChunkedMedia(character.id, {mediaId: 'media-id'}, db, {
            sessionToken,
            csrfToken,
        })
        expect(noUploadResponse.status).toBe(400)
        expect(await noUploadResponse.json()).toEqual({error: 'At least one image is required'})

        const existingInitResponse = await initExistingChunkedMedia(character.id, media.id, '{bad json', db, {
            sessionToken,
            csrfToken,
        })
        expect(existingInitResponse.status).toBe(400)
        expect(await existingInitResponse.json()).toEqual({error: 'Invalid JSON body'})

        const existingCompleteResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/media/${media.id}/chunked/complete`,
            {
                method: 'POST',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(db),
        )
        expect(existingCompleteResponse.status).toBe(400)
        expect(await existingCompleteResponse.json()).toEqual({error: 'Invalid JSON body'})
    })

    it('validates gallery route invalid JSON and missing character branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        const character = createCharacterRecord()
        await seedCurrentUser(sessionToken)

        const invalidJsonResponse = await apiRoutes.request(
            `https://example.com/characters/${character.id}/gallery`,
            {
                method: 'PUT',
                body: '{bad json',
                headers: createRequestHeaders('{bad json', {sessionToken, csrfToken}),
            },
            requestEnv(db),
        )
        expect(invalidJsonResponse.status).toBe(400)
        expect(await invalidJsonResponse.json()).toEqual({error: 'Invalid JSON body'})

        const missingCharacterResponse = await putGallery(character.id, {tabs: []}, db, {
            sessionToken,
            csrfToken,
        })
        expect(missingCharacterResponse.status).toBe(404)
        expect(await missingCharacterResponse.json()).toEqual({error: 'Character not found'})
    })

    it('covers remaining practical route cleanup branches', async () => {
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)
        await seedCurrentUser(sessionToken)

        const invalidFolderImageResponse = await postFolder(
            {
                name: 'Folder',
                folderImageData: 'bad',
            },
            db,
            {
                sessionToken,
                csrfToken,
            },
        )
        expect(invalidFolderImageResponse.status).toBe(400)
        expect(await invalidFolderImageResponse.json()).toEqual({error: 'Character profile image must be a base64 data URL'})

        const folderBucket = createMockR2Bucket()
        const folderFailureResponse = await withFailingTrigger(
            {name: 'folder_insert_cleanup', operation: 'INSERT', table: 'character_folders'},
            () =>
                postFolder(
                    {
                        name: 'Folder',
                        folderImageData: createPngDataUrl(16, 16),
                    },
                    db,
                    {
                        mediaBucket: folderBucket,
                        sessionToken,
                        csrfToken,
                    },
                ),
            db,
        )
        expect(folderFailureResponse.status).toBe(500)
        expect(folderBucket.delete).toHaveBeenCalled()
        expect(await queryAll<{id: string}>('SELECT id FROM character_folders', [], db)).toEqual([])

        const deleteFolderBucket = createMockR2Bucket()
        await seedFolderRecord(createFolderRecord({folder_image_key: 'folder-image-key'}))
        const deleteFolderResponse = await deleteFolder('folder-id', db, {
            mediaBucket: deleteFolderBucket,
            sessionToken,
            csrfToken,
        })
        expect(deleteFolderResponse.status).toBe(204)
        expect(deleteFolderBucket.delete).toHaveBeenCalledWith('characters/current-user/folders/folder-id/image/folder-image-key.webp')
        expect(await queryOne<{id: string}>('SELECT id FROM character_folders WHERE id = ?', ['folder-id'], db)).toBeNull()

        const character = createCharacterRecord()
        await seedCharacterRecord(character)
        const patchCharacterFailureResponse = await withFailingTrigger(
            {name: 'character_patch_cleanup', operation: 'UPDATE', table: 'characters', columns: ['name', 'description']},
            () => patchCharacter(character.id, {name: 'Updated'}, db, {sessionToken, csrfToken}),
            db,
        )
        expect(patchCharacterFailureResponse.status).toBe(500)
        expect(
            await queryOne<{name: string; description: string}>(
                'SELECT name, description FROM characters WHERE id = ?',
                [character.id],
                db,
            ),
        ).toEqual({name: character.name, description: ''})

        const heightChartBucket = createMockR2Bucket()
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
        const heightChartFailureResponse = await withFailingTrigger(
            {
                name: 'height_chart_update_cleanup',
                operation: 'UPDATE',
                table: 'characters',
                columns: ['height_chart_json'],
            },
            () => putHeightChart(character.id, form, db, {mediaBucket: heightChartBucket, sessionToken, csrfToken}),
            db,
        )
        expect(heightChartFailureResponse.status).toBe(500)
        expect(heightChartBucket.delete).toHaveBeenCalled()
        expect(
            await queryOne<{height_chart_json: string}>('SELECT height_chart_json FROM characters WHERE id = ?', [character.id], db),
        ).toEqual({height_chart_json: ''})

        const deleteCharacterBucket = createMockR2Bucket()
        vi.mocked(deleteCharacterBucket.delete).mockRejectedValueOnce(new Error('profile delete failed'))
        await db
            .prepare('UPDATE characters SET height_chart_json = ? WHERE id = ?')
            .bind(
                JSON.stringify({
                    version: 1,
                    height: {meters: 1.8},
                    image: {key: 'height-image-key', contentType: 'image/png', naturalWidth: 10, naturalHeight: 20},
                    calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
                }),
                character.id,
            )
            .run()
        const deleteCharacterResponse = await deleteCharacter(character.id, {confirmName: character.name, permanent: true}, db, {
            mediaBucket: deleteCharacterBucket,
            sessionToken,
            csrfToken,
        })
        expect(deleteCharacterResponse.status).toBe(204)
        expect(deleteCharacterBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/profile/profile-image-key.webp')
        expect(deleteCharacterBucket.delete).toHaveBeenCalledWith('characters/current-user/character-id/height-chart/height-image-key.png')
        expect(await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', [character.id], db)).toBeNull()
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
