import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedFolder, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {characterFolderImageObjectKey, characterProfileImageObjectKey, profilePhotoObjectKey} from '../media/url'
import {
    type AvifIconColorBackfillCandidate,
    activeAvifIconColorBackfillWorkflowInstanceIds,
    avifIconColorBackfillWorkflowInstanceId,
    countAvifIconColorBackfillCandidates,
    emptyAvifIconColorBackfillSummary,
    getAvifIconColorBackfillCandidates,
    parseAvifIconColorBackfillSummary,
    repairAvifIconColorCandidate,
} from './avifIconColorBackfill'

const db = useTestDatabase()
const SQUARE_AVIF = createAvifBytes(512, 512)

function containerResponse(bytes: Uint8Array = SQUARE_AVIF, changed = true): Response {
    return new Response(bytes, {
        headers: {
            'content-type': 'image/avif',
            'x-color-changed': String(changed),
            'x-color-reason': changed ? 'repaired' : 'already-tagged',
        },
    })
}

function iconEnv(bucket: R2Bucket, fetch = vi.fn(async () => containerResponse())): Bindings {
    return createWorkerEnv({
        DB: db,
        MEDIA_BUCKET: bucket,
        MYOC_DOCKER_SHARP_CONTAINER: {
            idFromName: vi.fn(() => 'icon-container-id'),
            get: vi.fn(() => ({fetch})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER'],
        PREVIEW_PROCESSOR_TOKEN: 'icon-test-token',
    })
}

function candidate(overrides: Partial<AvifIconColorBackfillCandidate> = {}): AvifIconColorBackfillCandidate {
    return {
        kind: 'user-profile',
        userId: 'icon-user',
        targetId: 'icon-user',
        imageKey: 'icon-source',
        contentType: 'image/webp',
        objectKey: profilePhotoObjectKey('icon-user', 'icon-source'),
        ...overrides,
    }
}

describe('AVIF icon color backfill', () => {
    it('accepts only complete stored summaries', () => {
        const valid = {
            totalIcons: 10,
            processedIcons: 6,
            retaggedIcons: 4,
            skippedIcons: 1,
            failedIcons: 1,
            lastError: 'One icon failed.',
        }

        expect(parseAvifIconColorBackfillSummary(JSON.stringify(valid))).toEqual(valid)
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({totalIcons: 10, processedIcons: 6, retaggedIcons: 4}))).toEqual(
            emptyAvifIconColorBackfillSummary(),
        )
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({...valid, failedIcons: '1'}))).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({...valid, skippedIcons: -1}))).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({...valid, unexpected: true}))).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({...valid, processedIcons: 1.5}))).toEqual(
            emptyAvifIconColorBackfillSummary(),
        )
        expect(parseAvifIconColorBackfillSummary(JSON.stringify({...valid, lastError: 1}))).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary(JSON.stringify([]))).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary(null)).toEqual(emptyAvifIconColorBackfillSummary())
        expect(parseAvifIconColorBackfillSummary('{invalid')).toEqual(emptyAvifIconColorBackfillSummary())
    })

    it('names workflow segments and lists the active owners', () => {
        expect(avifIconColorBackfillWorkflowInstanceId('run', 0)).toBe('run')
        expect(avifIconColorBackfillWorkflowInstanceId('run', 3)).toBe('run-avif-icon-segment-3')
        expect(activeAvifIconColorBackfillWorkflowInstanceIds('run', 0)).toEqual(['run'])
        expect(activeAvifIconColorBackfillWorkflowInstanceIds('run', 250)).toEqual(['run', 'run-avif-icon-segment-1'])
        expect(activeAvifIconColorBackfillWorkflowInstanceIds('run', 500)).toEqual([
            'run',
            'run-avif-icon-segment-2',
            'run-avif-icon-segment-1',
        ])
    })

    it('selects user, character, and folder icons in cursor order', async () => {
        await seedUser({id: 'icon-owner', profilePhotoKey: 'user-icon'})
        await seedCharacter({id: 'icon-character', userId: 'icon-owner', profileImageKey: 'character-icon'})
        await seedFolder({id: 'icon-folder', userId: 'icon-owner', folderImageKey: 'folder-icon'})

        expect(await countAvifIconColorBackfillCandidates(db)).toBe(3)
        const first = await getAvifIconColorBackfillCandidates(db, null, 2)
        expect(first).toHaveLength(2)
        expect(first.map((value) => value.kind)).toEqual(['character-profile', 'folder-image'])
        expect(first[0]).toMatchObject({
            kind: 'character-profile',
            userId: 'icon-owner',
            targetId: 'icon-character',
            imageKey: 'character-icon',
            contentType: 'image/webp',
            objectKey: characterProfileImageObjectKey('icon-owner', 'icon-character', 'character-icon'),
        })
        expect(first[1]).toMatchObject({
            kind: 'folder-image',
            targetId: 'icon-folder',
            objectKey: characterFolderImageObjectKey('icon-owner', 'icon-folder', 'folder-icon'),
        })

        const second = await getAvifIconColorBackfillCandidates(db, {kind: 'folder-image', targetId: 'icon-folder'}, 2)
        expect(second).toEqual([
            expect.objectContaining({
                kind: 'user-profile',
                userId: 'icon-owner',
                targetId: 'icon-owner',
                imageKey: 'user-icon',
                objectKey: profilePhotoObjectKey('icon-owner', 'user-icon'),
            }),
        ])
        await expect(getAvifIconColorBackfillCandidates(db, null, 0)).rejects.toThrow(RangeError)
    })

    it('writes repaired AVIF bytes and updates the content type', async () => {
        const bucket = createMockR2Bucket()
        const fetch = vi.fn(async (_input?: RequestInfo | URL, init?: RequestInit) => {
            expect(new Headers(init?.headers).get('authorization')).toBe('Bearer icon-test-token')
            expect(new Headers(init?.headers).get('content-type')).toBe('image/avif')
            expect(init?.body).toEqual(SQUARE_AVIF)
            return containerResponse(SQUARE_AVIF, true)
        })
        await seedUser({id: 'icon-user', profilePhotoKey: 'icon-source'})
        const key = profilePhotoObjectKey('icon-user', 'icon-source')
        await bucket.put(key, SQUARE_AVIF)
        vi.mocked(bucket.put).mockClear()

        await expect(repairAvifIconColorCandidate(iconEnv(bucket, fetch), candidate())).resolves.toEqual({status: 'retagged'})

        expect(fetch).toHaveBeenCalledOnce()
        expect(fetch.mock.calls[0]?.[0]).toBe('https://container/images/repair-icon-color')
        expect(bucket.put).toHaveBeenCalledOnce()
        expect(bucket.put).toHaveBeenCalledWith(
            key,
            SQUARE_AVIF,
            expect.objectContaining({
                httpMetadata: expect.objectContaining({contentType: 'image/avif'}),
            }),
        )
        expect(
            await queryOne<{profile_photo_content_type: string}>('SELECT profile_photo_content_type FROM users WHERE id = ?', [
                'icon-user',
            ]),
        ).toEqual({profile_photo_content_type: 'image/avif'})
    })

    it('skips the write when the icon changed before the conditional put', async () => {
        const bucket = createMockR2Bucket()
        const fetch = vi.fn(async () => containerResponse(SQUARE_AVIF, true))
        await seedUser({id: 'raced-user', profilePhotoKey: 'raced-icon'})
        const key = profilePhotoObjectKey('raced-user', 'raced-icon')
        await bucket.put(key, SQUARE_AVIF)
        vi.mocked(bucket.put).mockClear()
        vi.mocked(bucket.put).mockResolvedValueOnce(null as unknown as R2Object)

        await expect(
            repairAvifIconColorCandidate(
                iconEnv(bucket, fetch),
                candidate({
                    userId: 'raced-user',
                    targetId: 'raced-user',
                    imageKey: 'raced-icon',
                    objectKey: key,
                }),
            ),
        ).resolves.toEqual({status: 'skipped'})

        expect(bucket.put).toHaveBeenCalledOnce()
        const putOptions = vi.mocked(bucket.put).mock.calls[0]?.[2] as R2PutOptions | undefined
        expect(putOptions?.onlyIf).toBeInstanceOf(Headers)
        expect(putOptions?.onlyIf instanceof Headers ? putOptions.onlyIf.get('if-match') : null).toMatch(/^".*"$/)
        expect(
            await queryOne<{profile_photo_content_type: string | null}>('SELECT profile_photo_content_type FROM users WHERE id = ?', [
                'raced-user',
            ]),
        ).toEqual({profile_photo_content_type: 'image/webp'})
    })

    it('fixes a stale content type without rewriting unchanged bytes', async () => {
        const bucket = createMockR2Bucket()
        const fetch = vi.fn(async () => containerResponse(SQUARE_AVIF, false))
        await seedUser({id: 'stale-user', profilePhotoKey: 'stale-icon'})
        const key = profilePhotoObjectKey('stale-user', 'stale-icon')
        await bucket.put(key, SQUARE_AVIF)
        vi.mocked(bucket.put).mockClear()

        await expect(
            repairAvifIconColorCandidate(
                iconEnv(bucket, fetch),
                candidate({
                    userId: 'stale-user',
                    targetId: 'stale-user',
                    imageKey: 'stale-icon',
                    objectKey: key,
                }),
            ),
        ).resolves.toEqual({status: 'retagged'})

        expect(bucket.put).toHaveBeenCalledWith(
            key,
            SQUARE_AVIF,
            expect.objectContaining({
                httpMetadata: expect.objectContaining({contentType: 'image/avif'}),
            }),
        )
        expect(
            await queryOne<{profile_photo_content_type: string}>('SELECT profile_photo_content_type FROM users WHERE id = ?', [
                'stale-user',
            ]),
        ).toEqual({profile_photo_content_type: 'image/avif'})
    })

    it('skips an already-correct icon that the container leaves unchanged', async () => {
        const bucket = createMockR2Bucket()
        const fetch = vi.fn(async () => containerResponse(SQUARE_AVIF, false))
        await seedUser({id: 'clean-user', profilePhotoKey: 'clean-icon'})
        const key = profilePhotoObjectKey('clean-user', 'clean-icon')
        await bucket.put(key, SQUARE_AVIF)
        vi.mocked(bucket.put).mockClear()

        await expect(
            repairAvifIconColorCandidate(
                iconEnv(bucket, fetch),
                candidate({
                    userId: 'clean-user',
                    targetId: 'clean-user',
                    imageKey: 'clean-icon',
                    contentType: 'image/avif',
                    objectKey: key,
                }),
            ),
        ).resolves.toEqual({status: 'skipped'})

        expect(bucket.put).not.toHaveBeenCalled()
        expect(
            await queryOne<{profile_photo_content_type: string}>('SELECT profile_photo_content_type FROM users WHERE id = ?', [
                'clean-user',
            ]),
        ).toEqual({profile_photo_content_type: 'image/webp'})
    })

    it('skips non-AVIF bytes without asking the container', async () => {
        const bucket = createMockR2Bucket()
        const fetch = vi.fn(async () => containerResponse())
        await seedUser({id: 'not-avif-user', profilePhotoKey: 'not-avif-icon'})
        const key = profilePhotoObjectKey('not-avif-user', 'not-avif-icon')
        await bucket.put(key, new Uint8Array([1, 2, 3]))
        vi.mocked(bucket.put).mockClear()

        await expect(
            repairAvifIconColorCandidate(
                iconEnv(bucket, fetch),
                candidate({
                    userId: 'not-avif-user',
                    targetId: 'not-avif-user',
                    imageKey: 'not-avif-icon',
                    objectKey: key,
                }),
            ),
        ).resolves.toEqual({status: 'skipped'})

        expect(fetch).not.toHaveBeenCalled()
        expect(bucket.put).not.toHaveBeenCalled()
    })

    it('fails when the icon object is missing', async () => {
        await seedUser({id: 'missing-icon-user', profilePhotoKey: 'missing-icon'})

        await expect(
            repairAvifIconColorCandidate(
                iconEnv(createMockR2Bucket()),
                candidate({
                    userId: 'missing-icon-user',
                    targetId: 'missing-icon-user',
                    imageKey: 'missing-icon',
                }),
            ),
        ).rejects.toThrow('The icon image is missing')
    })
})
