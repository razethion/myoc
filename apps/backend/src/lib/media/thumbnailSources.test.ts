import {describe, expect, it, vi} from 'vitest'
import {seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {readThumbnailOriginal, retainThumbnailOriginal, type ThumbnailSourceTarget, thumbnailOriginalObjectKey} from './thumbnailSources'

const db = useTestDatabase()
const target: ThumbnailSourceTarget = {
    kind: 'user-profile',
    userId: 'user-1',
    targetId: 'user-1',
    imageKey: 'photo-1',
    objectKey: 'users/user-1/profile/photo-1.avif',
    contentType: 'image/avif',
}

describe('thumbnail sources', () => {
    it('stores an original under the thumbnail object key with private metadata', async () => {
        const sourceBucket = createMockR2Bucket()
        const bytes = await pngBytes()

        await retainThumbnailOriginal({MEDIA_BUCKET: sourceBucket}, target.objectKey, bytes, 'IMAGE/PNG')

        expect(sourceBucket.put).toHaveBeenCalledWith(thumbnailOriginalObjectKey(target.objectKey), bytes, {
            onlyIf: expect.any(Headers),
            httpMetadata: {
                cacheControl: 'private, no-store',
                contentType: 'image/png',
            },
        })
        const options = vi.mocked(sourceBucket.put).mock.calls[0]?.[2]
        expect(options?.onlyIf).toBeInstanceOf(Headers)
        expect(options?.onlyIf instanceof Headers ? options.onlyIf.get('if-none-match') : null).toBe('*')
    })

    it('reads the deterministic retained original before other sources', async () => {
        const sourceBucket = createMockR2Bucket()
        const bytes = await pngBytes()
        const retainedKey = thumbnailOriginalObjectKey(target.objectKey)
        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(retainedKey, bytes, 'image/png'))

        await expect(readThumbnailOriginal({DB: db, MEDIA_BUCKET: sourceBucket}, target)).resolves.toEqual({
            bytes,
            contentType: 'image/png',
        })
        expect(sourceBucket.get).toHaveBeenCalledTimes(1)
        expect(sourceBucket.get).toHaveBeenCalledWith(retainedKey)
    })

    it('uses only a ready upload source whose result key matches the current image', async () => {
        await seedUser({id: target.userId})
        const sourceBucket = createMockR2Bucket()
        const matchingBytes = await pngBytes()
        const unrelatedBytes = new Uint8Array([1, 2, 3])
        await insertReadySource('job-matching', 'source-matching', 'source/matching.png', target.imageKey, '2026-09-04 12:00:00')
        await insertReadySource('job-newer', 'source-newer', 'source/newer.png', 'other-photo', '2026-09-05 12:00:00')
        vi.mocked(sourceBucket.get)
            .mockResolvedValueOnce(null)
            .mockImplementation(async (key) =>
                key === 'source/matching.png' ? r2Object(key, matchingBytes, 'image/png') : r2Object(key, unrelatedBytes, 'image/png'),
            )

        await expect(readThumbnailOriginal({DB: db, MEDIA_BUCKET: sourceBucket}, target)).resolves.toEqual({
            bytes: matchingBytes,
            contentType: 'image/png',
        })
        expect(sourceBucket.get).toHaveBeenLastCalledWith('source/matching.png')
    })

    it.each([
        ['character-profile', 'character_profile'],
        ['folder-image', 'folder_image'],
    ] as const)('uses a ready upload source for a %s target', async (kind, targetType) => {
        await seedUser({id: target.userId})
        const sourceBucket = createMockR2Bucket()
        const bytes = await pngBytes()
        const sourceTarget = {...target, kind, targetId: `${kind}-1`}
        await insertReadySource('job-ready', 'source-ready', 'source/ready.png', sourceTarget.imageKey, '2026-09-05 12:00:00', {
            targetId: sourceTarget.targetId,
            targetType,
        })
        vi.mocked(sourceBucket.get)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(r2Object('source/ready.png', bytes, 'image/png'))

        await expect(readThumbnailOriginal({DB: db, MEDIA_BUCKET: sourceBucket}, sourceTarget)).resolves.toEqual({
            bytes,
            contentType: 'image/png',
        })
    })

    it('uses the current thumbnail when a ready upload source object is missing', async () => {
        await seedUser({id: target.userId})
        await insertReadySource('job-missing', 'source-missing', 'source/missing.png', target.imageKey, '2026-09-05 12:00:00')
        const sourceBucket = createMockR2Bucket()
        const bytes = createAvifBytes(512, 512)
        vi.mocked(sourceBucket.get)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(r2Object(target.objectKey, bytes))

        await expect(readThumbnailOriginal({DB: db, MEDIA_BUCKET: sourceBucket}, target)).resolves.toEqual({
            bytes,
            contentType: target.contentType,
        })
        expect(sourceBucket.put).toHaveBeenCalledWith(
            thumbnailOriginalObjectKey(target.objectKey),
            bytes,
            expect.objectContaining({httpMetadata: expect.objectContaining({contentType: target.contentType})}),
        )
    })

    it('retains the current thumbnail when no original source exists', async () => {
        const mediaBucket = createMockR2Bucket()
        const bytes = createAvifBytes(512, 512)
        vi.mocked(mediaBucket.get)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(r2Object(target.objectKey, bytes, 'image/avif'))

        await expect(readThumbnailOriginal({DB: db, MEDIA_BUCKET: mediaBucket}, target)).resolves.toEqual({
            bytes,
            contentType: 'image/avif',
        })
        expect(mediaBucket.put).toHaveBeenCalledWith(thumbnailOriginalObjectKey(target.objectKey), bytes, {
            onlyIf: expect.any(Headers),
            httpMetadata: {
                cacheControl: 'private, no-store',
                contentType: 'image/avif',
            },
        })
    })

    it('rejects oversized and unsupported retained sources before regeneration', async () => {
        const sourceBucket = createMockR2Bucket()
        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, new Uint8Array(3 * 1024 * 1024 + 1), 'image/png'))

        const env = {DB: db, MEDIA_BUCKET: sourceBucket}
        await expect(readThumbnailOriginal(env, target)).rejects.toThrow('The thumbnail source is too large')

        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, new Uint8Array([1]), 'image/gif'))
        await expect(readThumbnailOriginal(env, target)).rejects.toThrow('The thumbnail source type is not supported')

        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, new Uint8Array([1])))
        await expect(readThumbnailOriginal(env, target)).rejects.toThrow('The thumbnail source type is not supported')
    })

    it('rejects missing, empty, and oversized sources', async () => {
        const mediaBucket = createMockR2Bucket()

        const env = {DB: db, MEDIA_BUCKET: mediaBucket}
        await expect(readThumbnailOriginal(env, target)).rejects.toThrow('The thumbnail source is not available')
        await expect(retainThumbnailOriginal(env, target.objectKey, new Uint8Array(), 'image/png')).rejects.toThrow(
            'The thumbnail source is empty',
        )
        await expect(retainThumbnailOriginal(env, target.objectKey, new Uint8Array(3 * 1024 * 1024 + 1), 'image/png')).rejects.toThrow(
            'The thumbnail source is too large',
        )
    })
})

async function insertReadySource(
    jobId: string,
    sourceId: string,
    sourceKey: string,
    resultKey: string,
    updatedAt: string,
    options: {targetId?: string; targetType?: string} = {},
): Promise<void> {
    await db.batch([
        db
            .prepare(
                `INSERT INTO image_upload_jobs (
                     id, user_id, target_type, target_id, state, idempotency_key, request_json,
                     result_json, deadline_at, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, 'ready', ?, '{}', ?, ?, ?, ?)`,
            )
            .bind(
                jobId,
                target.userId,
                options.targetType ?? 'user_profile',
                options.targetId ?? target.targetId,
                jobId,
                JSON.stringify({key: resultKey}),
                '2026-09-10 12:00:00',
                updatedAt,
                updatedAt,
            ),
        db
            .prepare(
                `INSERT INTO image_upload_sources (
                     id, job_id, state, object_key, content_type, byte_size, width, height, created_at, updated_at
                 ) VALUES (?, ?, 'ready', ?, 'image/png', 1, 512, 512, ?, ?)`,
            )
            .bind(sourceId, jobId, sourceKey, updatedAt, updatedAt),
    ])
}

async function pngBytes(): Promise<Uint8Array> {
    return new Uint8Array(await createPngFile(512, 512).arrayBuffer())
}

function r2Object(key: string, bytes: Uint8Array, contentType?: string): R2ObjectBody {
    return {
        key,
        size: bytes.byteLength,
        httpMetadata: contentType ? {contentType} : undefined,
        arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    } as unknown as R2ObjectBody
}
