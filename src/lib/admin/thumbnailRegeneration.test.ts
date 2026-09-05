import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedFolder, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {thumbnailOriginalObjectKey} from '../media/thumbnailSources'
import {countThumbnailCandidates, getThumbnailCandidates, regenerateThumbnail, type ThumbnailCandidate} from './thumbnailRegeneration'

const db = useTestDatabase()
const userId = 'thumbnail-owner'
const characterId = 'thumbnail-character'
const folderId = 'thumbnail-folder'

function createThumbnailBucket(onPut?: (key: string) => Promise<void> | void): R2Bucket {
    const bucket = createMockR2Bucket()
    const contentTypes = new Map<string, string | undefined>()
    const put = vi.fn(async (key: string, value: Parameters<R2Bucket['put']>[1], options?: R2PutOptions) => {
        const metadata = options?.httpMetadata
        contentTypes.set(key, metadata instanceof Headers ? (metadata.get('content-type') ?? undefined) : metadata?.contentType)
        const object = await bucket.put(key, value, options)
        await onPut?.(key)
        return object
    })
    const get = vi.fn(async (key: string, options?: R2GetOptions) => withContentType(await bucket.get(key, options), contentTypes.get(key)))
    const head = vi.fn(async (key: string) => withContentType(await bucket.head(key), contentTypes.get(key)))

    return new Proxy(bucket, {
        get(target, property, receiver) {
            if (property === 'put') return put
            if (property === 'get') return get
            if (property === 'head') return head
            return Reflect.get(target, property, receiver)
        },
    })
}

function withContentType<T extends R2Object | R2ObjectBody | null>(object: T, contentType: string | undefined): T {
    if (object) Object.defineProperty(object, 'httpMetadata', {value: {contentType}})
    return object
}

function createSquareContainer(onFetch?: (request: Request) => Promise<void> | void): Bindings['MYOC_DOCKER_SHARP_CONTAINER'] {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        await onFetch?.(request)
        return new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}})
    })

    return {
        idFromName: vi.fn(() => 'thumbnail-container-id'),
        get: vi.fn(() => ({fetch})),
    } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']
}

function regenerationEnv(mediaBucket: R2Bucket, sourceBucket: R2Bucket, container = createSquareContainer()): Bindings {
    return createWorkerEnv({
        DB: db,
        IMAGE_SOURCE_BUCKET: sourceBucket,
        MEDIA_BUCKET: mediaBucket,
        MYOC_DOCKER_SHARP_CONTAINER: container,
        PREVIEW_PROCESSOR_TOKEN: 'thumbnail-test-token',
    })
}

async function pngBytes(): Promise<Uint8Array> {
    return new Uint8Array(await createPngFile(512, 512).arrayBuffer())
}

async function seedThumbnailTargets(): Promise<void> {
    await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
    await seedFolder({id: folderId, userId, name: 'Thumbnail Folder', folderImageKey: 'folder-old'})
    await seedCharacter({id: characterId, userId, name: 'Thumbnail Character', profileImageKey: 'character-old'})
}

function candidateFor(candidates: ThumbnailCandidate[], kind: ThumbnailCandidate['kind']): ThumbnailCandidate {
    const candidate = candidates.find((item) => item.kind === kind)
    if (!candidate) throw new Error(`Expected a ${kind} candidate`)
    return candidate
}

async function currentImageKey(candidate: ThumbnailCandidate): Promise<string | null> {
    if (candidate.kind === 'user-profile') {
        return (
            (await db
                .prepare('SELECT profile_photo_key FROM users WHERE id = ?')
                .bind(candidate.targetId)
                .first<string>('profile_photo_key')) ?? null
        )
    }
    if (candidate.kind === 'character-profile') {
        return (
            (await db
                .prepare('SELECT profile_image_key FROM characters WHERE id = ?')
                .bind(candidate.targetId)
                .first<string>('profile_image_key')) ?? null
        )
    }
    return (
        (await db
            .prepare('SELECT folder_image_key FROM character_folders WHERE id = ?')
            .bind(candidate.targetId)
            .first<string>('folder_image_key')) ?? null
    )
}

describe('thumbnail regeneration', () => {
    it('counts and returns all thumbnail kinds in stable cursor order', async () => {
        await seedThumbnailTargets()

        expect(await countThumbnailCandidates(db)).toBe(3)
        const firstPage = await getThumbnailCandidates(db, null, 2)
        expect(firstPage.map(({kind, targetId}) => ({kind, targetId}))).toEqual([
            {kind: 'character-profile', targetId: characterId},
            {kind: 'folder-image', targetId: folderId},
        ])
        const last = firstPage[1]
        if (!last) throw new Error('Expected a second thumbnail candidate')
        const secondPage = await getThumbnailCandidates(db, {kind: last.kind, targetId: last.targetId}, 2)
        expect(secondPage.map(({kind, targetId}) => ({kind, targetId}))).toEqual([{kind: 'user-profile', targetId: userId}])
        expect(firstPage[0]?.outputImageKey).toMatch(/^avif-[0-9a-f-]+$/)
        expect(firstPage[0]?.outputObjectKey).toMatch(/\.avif$/)
        await expect(getThumbnailCandidates(db, null, 0)).rejects.toThrow('Thumbnail candidate limit must be from 1 through 100')
    })

    it('skips a reference that changed before processing starts', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await db
            .prepare(`UPDATE users SET profile_photo_key = 'new-upload', profile_photo_content_type = 'image/avif' WHERE id = ?`)
            .bind(userId)
            .run()
        const container = createSquareContainer()

        await expect(
            regenerateThumbnail(regenerationEnv(createThumbnailBucket(), createThumbnailBucket(), container), candidate),
        ).resolves.toEqual({
            status: 'skipped',
            error: null,
        })

        expect(container.get).not.toHaveBeenCalled()
        expect(await currentImageKey(candidate)).toBe('new-upload')
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(3)
    })

    it.each(['user-profile', 'character-profile', 'folder-image'] as const)(
        'regenerates a %s thumbnail from its retained original',
        async (kind) => {
            await seedThumbnailTargets()
            const candidate = candidateFor(await getThumbnailCandidates(db, null), kind)
            const mediaBucket = createThumbnailBucket()
            const sourceBucket = createThumbnailBucket()
            const original = await pngBytes()
            const seenSources: Uint8Array[] = []
            const container = createSquareContainer(async (request) => {
                seenSources.push(new Uint8Array(await request.arrayBuffer()))
                expect(request.headers.get('content-type')).toBe('image/png')
            })
            await mediaBucket.put(candidate.objectKey, createAvifBytes(512, 512), {
                httpMetadata: {contentType: candidate.contentType},
            })
            await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), original, {
                httpMetadata: {contentType: 'image/png'},
            })

            await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
                status: 'regenerated',
                error: null,
            })

            expect(seenSources).toEqual([original])
            expect(await currentImageKey(candidate)).toBe(candidate.outputImageKey)
            await expect(mediaBucket.get(candidate.outputObjectKey)).resolves.not.toBeNull()
            const copiedOriginal = await sourceBucket.get(thumbnailOriginalObjectKey(candidate.outputObjectKey))
            expect(copiedOriginal ? new Uint8Array(await copiedOriginal.arrayBuffer()) : null).toEqual(original)
            expect(
                await queryAll<{bucket: string; object_key: string}>(
                    'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket, object_key',
                    [],
                    db,
                ),
            ).toEqual([
                {bucket: 'media', object_key: candidate.objectKey},
                {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
            ])
        },
    )

    it('retains a public thumbnail as the original when no retained source exists', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const original = await pngBytes()
        await db.prepare(`UPDATE users SET profile_photo_content_type = 'image/png' WHERE id = ?`).bind(userId).run()
        const refreshedCandidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await mediaBucket.put(refreshedCandidate.objectKey, original, {httpMetadata: {contentType: 'image/png'}})

        await regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), refreshedCandidate)

        for (const key of [refreshedCandidate.objectKey, refreshedCandidate.outputObjectKey]) {
            const retained = await sourceBucket.get(thumbnailOriginalObjectKey(key))
            expect(retained ? new Uint8Array(await retained.arrayBuffer()) : null).toEqual(original)
        }
        expect(candidate.imageKey).toBe(refreshedCandidate.imageKey)
    })

    it('uses the same original through repeated regeneration', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        await db.prepare(`UPDATE users SET profile_photo_content_type = 'image/png' WHERE id = ?`).bind(userId).run()
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const original = await pngBytes()
        const seenSources: Uint8Array[] = []
        const container = createSquareContainer(async (request) => {
            seenSources.push(new Uint8Array(await request.arrayBuffer()))
        })
        const first = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await mediaBucket.put(first.objectKey, original, {httpMetadata: {contentType: 'image/png'}})
        const env = regenerationEnv(mediaBucket, sourceBucket, container)

        await regenerateThumbnail(env, first)
        const second = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await regenerateThumbnail(env, second)

        expect(seenSources).toEqual([original, original])
        expect(await currentImageKey(second)).toBe(second.outputImageKey)
    })

    it('keeps a newer upload when it wins the publish race', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await mediaBucket.put(candidate.objectKey, await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = createSquareContainer(async () => {
            await db
                .prepare(`UPDATE users SET profile_photo_key = 'new-upload', profile_photo_content_type = 'image/avif' WHERE id = ?`)
                .bind(userId)
                .run()
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
            status: 'skipped',
            error: null,
        })

        expect(await currentImageKey(candidate)).toBe('new-upload')
        const cleanup = await queryAll<{bucket: string; object_key: string}>(
            'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
            [],
            db,
        )
        expect(cleanup).toEqual([
            {bucket: 'media', object_key: candidate.outputObjectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
        ])
        expect(cleanup.some(({object_key}) => object_key.includes('new-upload'))).toBe(false)
    })

    it('skips a target that is deleted while processing', async () => {
        await seedThumbnailTargets()
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'folder-image')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = createSquareContainer(async () => {
            await db.prepare('DELETE FROM character_folders WHERE id = ?').bind(folderId).run()
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
            status: 'skipped',
            error: null,
        })
        expect(await currentImageKey(candidate)).toBeNull()
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(3)
    })

    it('returns an idempotent result when the output is already current', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const container = createSquareContainer()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const env = regenerationEnv(mediaBucket, sourceBucket, container)

        await regenerateThumbnail(env, candidate)
        await expect(regenerateThumbnail(env, candidate)).resolves.toEqual({status: 'regenerated', error: null})

        const stub = container.get(container.idFromName('thumbnail-container-id'))
        expect(stub.fetch).toHaveBeenCalledTimes(1)
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(2)
    })

    it('keeps the old thumbnail when image processing fails', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await mediaBucket.put(candidate.objectKey, createAvifBytes(512, 512), {
            httpMetadata: {contentType: candidate.contentType},
        })
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = {
            idFromName: vi.fn(() => 'thumbnail-container-id'),
            get: vi.fn(() => ({fetch: vi.fn(async () => Promise.reject(new Error('Container stopped')))})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).rejects.toThrow(
            'Container stopped',
        )

        expect(await currentImageKey(candidate)).toBe(candidate.imageKey)
        await expect(mediaBucket.get(candidate.objectKey)).resolves.not.toBeNull()
        await expect(mediaBucket.get(candidate.outputObjectKey)).resolves.toBeNull()
        expect(await queryOne<{total: number}>('SELECT COUNT(*) AS total FROM image_cleanup_tasks', [], db)).toEqual({total: 0})
    })

    it('queues staged objects for cleanup when the public write fails', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket((key) => {
            if (key === candidate.outputObjectKey) throw new Error('R2 write failed')
        })
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), candidate)).rejects.toThrow('R2 write failed')

        expect(await currentImageKey(candidate)).toBe(candidate.imageKey)
        expect(
            await queryAll<{bucket: string; object_key: string}>(
                'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
                [],
                db,
            ),
        ).toEqual([
            {bucket: 'media', object_key: candidate.outputObjectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
        ])
    })

    it('finishes cleanup when a write reports an error after publication', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket(async (key) => {
            if (key !== candidate.outputObjectKey) return
            await db
                .prepare(`UPDATE users SET profile_photo_key = ?, profile_photo_content_type = 'image/avif' WHERE id = ?`)
                .bind(candidate.outputImageKey, userId)
                .run()
            throw new Error('R2 response was lost')
        })
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), candidate)).resolves.toEqual({
            status: 'regenerated',
            error: null,
        })

        expect(await currentImageKey(candidate)).toBe(candidate.outputImageKey)
        expect(
            await queryAll<{bucket: string; object_key: string}>(
                'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
                [],
                db,
            ),
        ).toEqual([
            {bucket: 'media', object_key: candidate.objectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
        ])
    })
})
