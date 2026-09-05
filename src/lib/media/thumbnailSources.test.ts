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

        await retainThumbnailOriginal({IMAGE_SOURCE_BUCKET: sourceBucket}, target.objectKey, bytes, 'IMAGE/PNG')

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
        const mediaBucket = createMockR2Bucket()
        const bytes = await pngBytes()
        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, bytes, 'image/png'))

        await expect(
            readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target),
        ).resolves.toEqual({
            bytes,
            contentType: 'image/png',
        })
        expect(mediaBucket.get).not.toHaveBeenCalled()
    })

    it('uses only a ready upload source whose result key matches the current image', async () => {
        await seedUser({id: target.userId})
        const sourceBucket = createMockR2Bucket()
        const mediaBucket = createMockR2Bucket()
        const matchingBytes = await pngBytes()
        const unrelatedBytes = new Uint8Array([1, 2, 3])
        await insertReadySource('job-matching', 'source-matching', 'source/matching.png', target.imageKey, '2026-09-04 12:00:00')
        await insertReadySource('job-newer', 'source-newer', 'source/newer.png', 'other-photo', '2026-09-05 12:00:00')
        vi.mocked(sourceBucket.get)
            .mockResolvedValueOnce(null)
            .mockImplementation(async (key) =>
                key === 'source/matching.png' ? r2Object(key, matchingBytes, 'image/png') : r2Object(key, unrelatedBytes, 'image/png'),
            )

        await expect(
            readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target),
        ).resolves.toEqual({
            bytes: matchingBytes,
            contentType: 'image/png',
        })
        expect(sourceBucket.get).toHaveBeenLastCalledWith('source/matching.png')
        expect(mediaBucket.get).not.toHaveBeenCalled()
    })

    it('retains the current thumbnail when no original source exists', async () => {
        const sourceBucket = createMockR2Bucket()
        const mediaBucket = createMockR2Bucket()
        const bytes = createAvifBytes(512, 512)
        vi.mocked(mediaBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, bytes, 'image/avif'))

        await expect(
            readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target),
        ).resolves.toEqual({
            bytes,
            contentType: 'image/avif',
        })
        expect(sourceBucket.put).toHaveBeenCalledWith(thumbnailOriginalObjectKey(target.objectKey), bytes, {
            onlyIf: expect.any(Headers),
            httpMetadata: {
                cacheControl: 'private, no-store',
                contentType: 'image/avif',
            },
        })
    })

    it('rejects oversized and unsupported retained sources before regeneration', async () => {
        const sourceBucket = createMockR2Bucket()
        const mediaBucket = createMockR2Bucket()
        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, new Uint8Array(3 * 1024 * 1024 + 1), 'image/png'))

        await expect(readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target)).rejects.toThrow(
            'The thumbnail source is too large',
        )

        vi.mocked(sourceBucket.get).mockResolvedValueOnce(r2Object(target.objectKey, new Uint8Array([1]), 'image/gif'))
        await expect(readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target)).rejects.toThrow(
            'The thumbnail source type is not supported',
        )
    })

    it('rejects missing, empty, and oversized sources', async () => {
        const sourceBucket = createMockR2Bucket()
        const mediaBucket = createMockR2Bucket()

        await expect(readThumbnailOriginal({DB: db, IMAGE_SOURCE_BUCKET: sourceBucket, MEDIA_BUCKET: mediaBucket}, target)).rejects.toThrow(
            'The thumbnail source is not available',
        )
        await expect(
            retainThumbnailOriginal({IMAGE_SOURCE_BUCKET: sourceBucket}, target.objectKey, new Uint8Array(), 'image/png'),
        ).rejects.toThrow('The thumbnail source is empty')
        await expect(
            retainThumbnailOriginal(
                {IMAGE_SOURCE_BUCKET: sourceBucket},
                target.objectKey,
                new Uint8Array(3 * 1024 * 1024 + 1),
                'image/png',
            ),
        ).rejects.toThrow('The thumbnail source is too large')
    })
})

async function insertReadySource(jobId: string, sourceId: string, sourceKey: string, resultKey: string, updatedAt: string): Promise<void> {
    await db.batch([
        db
            .prepare(
                `INSERT INTO image_upload_jobs (
                     id, user_id, target_type, target_id, state, idempotency_key, request_json,
                     result_json, deadline_at, created_at, updated_at
                 ) VALUES (?, ?, 'user_profile', ?, 'ready', ?, '{}', ?, ?, ?, ?)`,
            )
            .bind(
                jobId,
                target.userId,
                target.targetId,
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

function r2Object(key: string, bytes: Uint8Array, contentType: string): R2ObjectBody {
    return {
        key,
        size: bytes.byteLength,
        httpMetadata: {contentType},
        arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    } as unknown as R2ObjectBody
}
