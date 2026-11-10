import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import {characterMediaImageObjectKey} from '../media/url'
import {
    activePngSrgbBackfillWorkflowInstanceIds,
    countPngSrgbBackfillCandidates,
    emptyPngSrgbBackfillSummary,
    getPngSrgbBackfillCandidates,
    type PngSrgbBackfillCandidate,
    parsePngSrgbBackfillSummary,
    tagPngSrgbCandidate,
} from './pngSrgbBackfill'

const db = useTestDatabase()

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SRGB_CHUNK = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9])

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }

    return out
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = (value >>> 24) & 0xff
    bytes[offset + 1] = (value >>> 16) & 0xff
    bytes[offset + 2] = (value >>> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index)
    }
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    writeUint32Be(out, 0, data.length)
    writeAscii(out, 4, type)
    out.set(data, 8)
    return out
}

function pngBytes({tagged = false, width = 800, height = 600}: {tagged?: boolean; width?: number; height?: number} = {}): Uint8Array {
    const ihdr = new Uint8Array(13)
    writeUint32Be(ihdr, 0, width)
    writeUint32Be(ihdr, 4, height)
    ihdr[8] = 8
    ihdr[9] = 6
    const colorChunks = tagged ? [SRGB_CHUNK] : []
    return concat([
        SIGNATURE,
        chunk('IHDR', ihdr),
        ...colorChunks,
        chunk('IDAT', new Uint8Array([1, 2, 3, 4, 5])),
        chunk('IEND', new Uint8Array(0)),
    ])
}

function chunkTypes(bytes: Uint8Array): string[] {
    const types: string[] = []
    let offset = SIGNATURE.length

    while (offset + 8 <= bytes.length) {
        const length =
            (bytes[offset] ?? 0) * 0x1000000 + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0)
        const type = String.fromCharCode(bytes[offset + 4] ?? 0, bytes[offset + 5] ?? 0, bytes[offset + 6] ?? 0, bytes[offset + 7] ?? 0)
        types.push(type)
        offset += 8 + length + 4

        if (type === 'IEND') break
    }

    return types
}

function candidate(overrides: Partial<PngSrgbBackfillCandidate> = {}): PngSrgbBackfillCandidate {
    return {
        mediaId: 'media-1',
        userId: 'user-1',
        characterId: 'character-1',
        createdAt: '2026-01-01 00:00:00',
        rating: 'sfw',
        imageKey: 'source',
        contentType: 'image/png',
        byteSize: 0,
        ...overrides,
    }
}

describe('PNG sRGB backfill', () => {
    it('accepts only complete stored summaries', () => {
        const valid = {
            totalVariants: 10,
            processedVariants: 6,
            retaggedVariants: 4,
            skippedVariants: 1,
            failedVariants: 1,
            lastError: 'One image failed.',
        }

        expect(parsePngSrgbBackfillSummary(JSON.stringify(valid))).toEqual(valid)
        expect(parsePngSrgbBackfillSummary(JSON.stringify({totalVariants: 10, processedVariants: 6, retaggedVariants: 4}))).toEqual(
            emptyPngSrgbBackfillSummary(),
        )
        expect(parsePngSrgbBackfillSummary(JSON.stringify({...valid, failedVariants: '1'}))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(JSON.stringify({...valid, skippedVariants: -1}))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(JSON.stringify({...valid, unexpected: true}))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(JSON.stringify({...valid, processedVariants: 1.5}))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(JSON.stringify({...valid, lastError: 1}))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(JSON.stringify([]))).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary(null)).toEqual(emptyPngSrgbBackfillSummary())
        expect(parsePngSrgbBackfillSummary('{invalid')).toEqual(emptyPngSrgbBackfillSummary())
    })

    it('lists workflow instances that can own the active segment', () => {
        expect(activePngSrgbBackfillWorkflowInstanceIds('run', 0)).toEqual(['run'])
        expect(activePngSrgbBackfillWorkflowInstanceIds('run', 250)).toEqual(['run', 'run-png-srgb-segment-1'])
        expect(activePngSrgbBackfillWorkflowInstanceIds('run', 500)).toEqual(['run', 'run-png-srgb-segment-2', 'run-png-srgb-segment-1'])
    })

    it('selects legacy PNG variants and paginates by cursor', async () => {
        await seedUser({id: 'png-owner'})
        await seedCharacter({id: 'png-character', userId: 'png-owner'})
        await seedMedia({
            id: 'png-media-a',
            userId: 'png-owner',
            characterId: 'png-character',
            sfwImageKey: 'sfw-a',
            sfwContentType: 'image/png',
            nsfwImageKey: 'nsfw-a',
            nsfwContentType: 'image/png',
            createdAt: '2026-01-01 00:00:00',
        })
        await seedMedia({
            id: 'png-media-b',
            userId: 'png-owner',
            characterId: 'png-character',
            sfwImageKey: 'sfw-b',
            sfwContentType: null,
            createdAt: '2026-01-02 00:00:00',
        })
        await seedMedia({
            id: 'png-media-c',
            userId: 'png-owner',
            characterId: 'png-character',
            sfwImageKey: 'sfw-c',
            sfwContentType: 'image/webp',
            createdAt: '2026-01-03 00:00:00',
        })

        expect(await countPngSrgbBackfillCandidates(db)).toBe(3)
        const first = await getPngSrgbBackfillCandidates(db, null, 2)
        expect(first).toHaveLength(2)
        expect(first.map((value) => value.mediaId)).toEqual(['png-media-a', 'png-media-a'])
        expect(first[0]).toMatchObject({mediaId: 'png-media-a', rating: 'nsfw', contentType: 'image/png'})
        expect(first[1]).toMatchObject({mediaId: 'png-media-a', rating: 'sfw', contentType: 'image/png'})

        const nextCursor = {createdAt: first[1]?.createdAt ?? '', mediaId: first[1]?.mediaId ?? '', rating: first[1]?.rating ?? 'sfw'}
        const second = await getPngSrgbBackfillCandidates(db, nextCursor, 2)
        expect(second.map((value) => value.mediaId)).toEqual(['png-media-b'])
        expect(second[0]).toMatchObject({mediaId: 'png-media-b', contentType: null})
        await expect(getPngSrgbBackfillCandidates(db, null, 0)).rejects.toThrow(RangeError)
    })

    it('tags an untagged RGB PNG and records its new byte size', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'png-user'
        const characterId = 'png-character'
        const mediaId = 'png-media'
        const original = pngBytes()
        const key = characterMediaImageObjectKey(userId, characterId, mediaId, 'source', 'sfw', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({id: mediaId, userId, characterId, sfwImageKey: 'source', sfwByteSize: original.length})
        await bucket.put(key, original)
        vi.mocked(bucket.put).mockClear()

        const result = await tagPngSrgbCandidate(
            createWorkerEnv({DB: db, MEDIA_BUCKET: bucket}),
            candidate({
                mediaId,
                userId,
                characterId,
                byteSize: original.length,
            }),
        )

        expect(result).toEqual({status: 'retagged'})
        const stored = await bucket.get(key)
        if (!stored) {
            throw new Error('Expected the tagged PNG in the bucket')
        }
        const bytes = new Uint8Array(await stored.arrayBuffer())
        expect(bytes.byteLength).toBe(original.length + SRGB_CHUNK.length)
        expect(chunkTypes(original)).toEqual(['IHDR', 'IDAT', 'IEND'])
        expect(chunkTypes(bytes)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
        expect(await queryOne<{sfw_byte_size: number}>('SELECT sfw_byte_size FROM character_media WHERE id = ?', [mediaId])).toEqual({
            sfw_byte_size: bytes.byteLength,
        })
        expect(bucket.put).toHaveBeenCalledOnce()
        expect(bucket.put).toHaveBeenCalledWith(
            key,
            expect.anything(),
            expect.objectContaining({
                httpMetadata: expect.objectContaining({contentType: 'image/png'}),
            }),
        )
    })

    it('skips the write when the object changed before the conditional put', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'raced-user'
        const characterId = 'raced-character'
        const mediaId = 'raced-media'
        const original = pngBytes()
        const key = characterMediaImageObjectKey(userId, characterId, mediaId, 'source', 'sfw', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({id: mediaId, userId, characterId, sfwImageKey: 'source', sfwByteSize: original.length})
        await bucket.put(key, original)
        vi.mocked(bucket.put).mockClear()
        vi.mocked(bucket.put).mockResolvedValueOnce(null as unknown as R2Object)

        const result = await tagPngSrgbCandidate(
            createWorkerEnv({DB: db, MEDIA_BUCKET: bucket}),
            candidate({
                mediaId,
                userId,
                characterId,
                byteSize: original.length,
            }),
        )

        expect(result).toEqual({status: 'skipped'})
        expect(bucket.put).toHaveBeenCalledOnce()
        const putOptions = vi.mocked(bucket.put).mock.calls[0]?.[2] as R2PutOptions | undefined
        expect(putOptions?.onlyIf).toBeInstanceOf(Headers)
        expect(putOptions?.onlyIf instanceof Headers ? putOptions.onlyIf.get('if-match') : null).toMatch(/^".*"$/)
        expect(await queryOne<{sfw_byte_size: number}>('SELECT sfw_byte_size FROM character_media WHERE id = ?', [mediaId])).toEqual({
            sfw_byte_size: original.length,
        })
        const stored = await bucket.get(key)
        if (!stored) {
            throw new Error('Expected the untouched PNG in the bucket')
        }
        expect(chunkTypes(new Uint8Array(await stored.arrayBuffer()))).toEqual(['IHDR', 'IDAT', 'IEND'])
    })

    it('skips an already tagged PNG without rewriting it', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'tagged-user'
        const characterId = 'tagged-character'
        const mediaId = 'tagged-media'
        const original = pngBytes({tagged: true})
        const key = characterMediaImageObjectKey(userId, characterId, mediaId, 'source', 'sfw', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({id: mediaId, userId, characterId, sfwImageKey: 'source', sfwByteSize: original.length})
        await bucket.put(key, original)
        vi.mocked(bucket.put).mockClear()

        const result = await tagPngSrgbCandidate(
            createWorkerEnv({DB: db, MEDIA_BUCKET: bucket}),
            candidate({
                mediaId,
                userId,
                characterId,
                byteSize: original.length,
            }),
        )

        expect(result).toEqual({status: 'skipped'})
        expect(bucket.put).not.toHaveBeenCalled()
        expect(await bucket.get(key)).not.toBeNull()
    })

    it('skips non-PNG bytes that cannot be tagged', async () => {
        const bucket = createMockR2Bucket()
        const userId = 'webp-user'
        const characterId = 'webp-character'
        const mediaId = 'webp-media'
        const original = new Uint8Array([1, 2, 3])
        const key = characterMediaImageObjectKey(userId, characterId, mediaId, 'source', 'sfw', 'image/png')
        await seedUser({id: userId})
        await seedCharacter({id: characterId, userId})
        await seedMedia({id: mediaId, userId, characterId, sfwImageKey: 'source', sfwByteSize: original.length})
        await bucket.put(key, original)
        vi.mocked(bucket.put).mockClear()

        await expect(
            tagPngSrgbCandidate(
                createWorkerEnv({DB: db, MEDIA_BUCKET: bucket}),
                candidate({
                    mediaId,
                    userId,
                    characterId,
                    byteSize: original.length,
                }),
            ),
        ).resolves.toEqual({status: 'skipped'})
        expect(bucket.put).not.toHaveBeenCalled()
    })

    it('fails when the PNG object is missing', async () => {
        await seedUser({id: 'missing-user'})
        await seedCharacter({id: 'missing-character', userId: 'missing-user'})
        await seedMedia({id: 'missing-media', userId: 'missing-user', characterId: 'missing-character', sfwImageKey: 'missing-source'})

        await expect(
            tagPngSrgbCandidate(
                createWorkerEnv({DB: db, MEDIA_BUCKET: createMockR2Bucket()}),
                candidate({
                    mediaId: 'missing-media',
                    userId: 'missing-user',
                    characterId: 'missing-character',
                    imageKey: 'missing-source',
                }),
            ),
        ).rejects.toThrow('The PNG original is missing')
    })
})
