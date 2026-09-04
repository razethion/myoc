import {describe, expect, it, vi} from 'vitest'
import {seedCharacter, seedFolder, seedMedia, seedUser, useResetTestDatabase} from '../../test/d1'
import {createMockKVNamespace} from '../../test/mockKV'
import {createWorkerEnv, workerEnv} from '../../test/workerBindings'
import {cleanupStaleR2Media, parseManagedR2MediaKey} from './r2Cleanup'

const staleCleanupNow = new Date(Date.now() + 25 * 60 * 60 * 1000)
const db = useResetTestDatabase()

describe('parseManagedR2MediaKey', () => {
    it('recognizes only managed MyOC media object keys', () => {
        expect(parseManagedR2MediaKey('users/user-1/profile/photo-1.webp')).toMatchObject({
            kind: 'userProfile',
            userId: 'user-1',
            profilePhotoKey: 'photo-1',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/profile/profile-1.webp')).toMatchObject({
            kind: 'characterProfile',
            userId: 'user-1',
            characterId: 'character-1',
            profileImageKey: 'profile-1',
        })

        expect(parseManagedR2MediaKey('characters/user-1/folders/folder-1/image/image-1.webp')).toMatchObject({
            kind: 'characterFolderImage',
            userId: 'user-1',
            folderId: 'folder-1',
            folderImageKey: 'image-1',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/image-1.gif')).toMatchObject({
            kind: 'characterMedia',
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            rating: 'nsfw',
            imageKey: 'image-1',
            contentType: 'image/gif',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/preview/preview-1.webp')).toMatchObject({
            kind: 'characterMediaPreview',
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            rating: 'nsfw',
            imageKey: 'preview-1',
            contentType: 'image/webp',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/sfw/preview/preview-2.avif')).toMatchObject({
            kind: 'characterMediaPreview',
            imageKey: 'preview-2',
            contentType: 'image/avif',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/blur/blur-1.webp')).toMatchObject({
            kind: 'characterMediaNsfwBlur',
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            imageKey: 'blur-1',
            contentType: 'image/webp',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/blur/blur-2.avif')).toMatchObject({
            kind: 'characterMediaNsfwBlur',
            imageKey: 'blur-2',
            contentType: 'image/avif',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/height-chart/chart-1.png')).toMatchObject({
            kind: 'characterHeightChart',
            userId: 'user-1',
            characterId: 'character-1',
            imageKey: 'chart-1',
            contentType: 'image/png',
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/scratch/file.webp')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/sfw/image-1.bmp')).toBeNull()
        expect(parseManagedR2MediaKey('users/user-1/profile/photo-1.png')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/character-1/profile/photo.png')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/folders/folder-1/image/photo.png')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/sfw/preview/photo.png')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/blur/photo.png')).toBeNull()
        expect(parseManagedR2MediaKey('characters/user-1/character-1/height-chart/photo.bmp')).toBeNull()
    })
})

describe('cleanupStaleR2Media', () => {
    it('deletes stale managed objects that are not referenced in D1', async () => {
        const heightChartJson = JSON.stringify({
            image: {
                key: 'chart',
                contentType: 'image/png',
            },
        })

        await seedCleanupDatabase(heightChartJson)
        await workerEnv.MEDIA_BUCKET.put('users/alice/profile/current.webp', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('users/alice/profile/old.png', 'unknown')
        await workerEnv.MEDIA_BUCKET.put('users/alice/profile/old.webp', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/height-chart/chart.png', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/nsfw/blur/blur.avif', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/sfw/img.png', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/sfw/preview/preview.avif', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-2/nsfw/orphan.gif', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/profile/profile.webp', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/profile/stale.webp', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/folders/main/image/image.webp', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/folders/main/image/stale.webp', 'stale')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/scratch/stale.webp', 'unknown')

        const summary = await cleanupStaleR2Media(workerEnv, staleCleanupNow)

        expect(summary).toMatchObject({
            scanned: 15,
            recognized: 13,
            skippedUnknown: 2,
            skippedRecent: 0,
            keptReferenced: 7,
            deleted: 6,
            errors: 0,
            stoppedAtDeleteLimit: false,
        })
        expect(await workerEnv.MEDIA_BUCKET.head('users/alice/profile/current.webp')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('users/alice/profile/old.png')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('users/alice/profile/old.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-1/nsfw/blur/blur.avif')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-1/sfw/preview/preview.avif')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/orphan.gif')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/folders/main/image/image.webp')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/folders/main/image/stale.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/scratch/stale.webp')).not.toBeNull()
    })

    it('does not evaluate recent objects for deletion', async () => {
        await workerEnv.MEDIA_BUCKET.put('users/alice/profile/new.webp', 'recent')
        await db.exec('ALTER TABLE users RENAME TO test_unavailable_users')

        const summary = await cleanupStaleR2Media(workerEnv, new Date())

        expect(summary.skippedRecent).toBe(1)
        expect(summary.deleted).toBe(0)
        expect(summary.errors).toBe(0)
        expect(await workerEnv.MEDIA_BUCKET.head('users/alice/profile/new.webp')).not.toBeNull()
    })

    it('resumes a bounded scan on the next run', async () => {
        const objectKeys = Array.from({length: 1200}, (_, index) => `users/user-${index}/profile/photo.webp`)
        const bucket = createPagedMediaBucket(objectKeys, new Date())
        const cache = createMockKVNamespace()
        const env = createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket})
        const now = new Date()

        const first = await cleanupStaleR2Media(env, now)
        const second = await cleanupStaleR2Media(env, now)

        expect(first.stoppedAtScanLimit).toBe(true)
        expect(first.scanned).toBe(900)
        expect(second.stoppedAtScanLimit).toBe(false)
        expect(second.scanned).toBe(300)
        expect(await cache.get('admin:r2-media-cleanup:cursor:v1')).toBeNull()
    })

    it('stops at the scan limit with referenced objects', async () => {
        const objectKeys = Array.from({length: 901}, (_, index) => `users/user-${index}/profile/photo.webp`)
        const bucket = createPagedMediaBucket(objectKeys, new Date(0))
        const cache = createMockKVNamespace()
        await seedReferencedProfileUsers(900)
        const env = createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket})

        const summary = await cleanupStaleR2Media(env, staleCleanupNow)

        expect(summary).toMatchObject({
            scanned: 900,
            recognized: 900,
            keptReferenced: 900,
            stoppedAtScanLimit: true,
        })
        expect(await cache.get('admin:r2-media-cleanup:cursor:v1')).not.toBeNull()
    }, 10_000)

    it('continues with the next managed prefix on the next run', async () => {
        const objectKeys = [
            ...Array.from({length: 900}, (_, index) => `users/user-${index}/profile/photo.webp`),
            'characters/user/character/profile/photo.webp',
        ]
        const bucket = createPagedMediaBucket(objectKeys, new Date())
        const cache = createMockKVNamespace()
        const env = createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket})

        const first = await cleanupStaleR2Media(env, new Date())
        const second = await cleanupStaleR2Media(env, new Date())

        expect(first).toMatchObject({scanned: 900, stoppedAtScanLimit: true})
        expect(second).toMatchObject({scanned: 1, stoppedAtScanLimit: false})
        await expect(cache.get('admin:r2-media-cleanup:cursor:v1')).resolves.toBeNull()
    })

    it.each(['{', '[]', JSON.stringify({prefix: 'invalid/'}), JSON.stringify({prefix: 'users/', cursor: 1})])(
        'discards an invalid saved cursor: %s',
        async (savedCursor) => {
            const cache = createMockKVNamespace({values: {'admin:r2-media-cleanup:cursor:v1': savedCursor}})
            const bucket = createPagedMediaBucket(['users/alice/profile/photo.webp'], new Date())

            const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket}), new Date())

            expect(summary.scanned).toBe(1)
            await expect(cache.get('admin:r2-media-cleanup:cursor:v1')).resolves.toBeNull()
        },
    )

    it('stops after the per-run delete limit', async () => {
        const objectKeys = Array.from({length: 501}, (_, index) => `users/user-${index}/profile/photo.webp`)
        const bucket = createPagedMediaBucket(objectKeys, new Date(0))
        const cache = createMockKVNamespace()
        const env = createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket})

        const first = await cleanupStaleR2Media(env, staleCleanupNow)
        const second = await cleanupStaleR2Media(env, staleCleanupNow)

        expect(first).toMatchObject({deleted: 500, stoppedAtDeleteLimit: true})
        expect(second).toMatchObject({deleted: 1, stoppedAtDeleteLimit: false})
        expect(await cache.get('admin:r2-media-cleanup:cursor:v1')).toBeNull()
    })

    it.each([new Error('cleanup failed'), 'cleanup failed'])('records object cleanup errors: %s', async (error) => {
        const bucket = createPagedMediaBucket(['users/alice/profile/photo.webp'], new Date(0))
        vi.mocked(bucket.delete).mockRejectedValue(error)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: createMockKVNamespace(), MEDIA_BUCKET: bucket}), staleCleanupNow)

        expect(summary).toMatchObject({deleted: 0, errors: 1})
    })
})

function createPagedMediaBucket(keys: string[], uploaded: Date): R2Bucket {
    const objectKeys = new Set(keys)

    return {
        delete: vi.fn(async (key: string) => {
            objectKeys.delete(key)
        }),
        list: vi.fn(async (options: R2ListOptions = {}) => {
            const matchingKeys = [...objectKeys].filter((key) => key.startsWith(options.prefix ?? ''))
            const offset = Number(options.cursor ?? 0)
            const limit = options.limit ?? 1000
            const pageKeys = matchingKeys.slice(offset, offset + limit)
            const nextOffset = offset + pageKeys.length
            const truncated = nextOffset < matchingKeys.length

            return {
                cursor: truncated ? String(nextOffset) : undefined,
                delimitedPrefixes: [],
                objects: pageKeys.map((key) => ({key, uploaded})),
                truncated,
            }
        }),
    } as unknown as R2Bucket
}

async function seedCleanupDatabase(heightChartJson: string): Promise<void> {
    await seedUser({id: 'alice', username: 'alice', profilePhotoKey: 'current'})
    await seedFolder({id: 'main', userId: 'alice', name: 'Main', folderImageKey: 'image'})
    await seedCharacter({
        id: 'blair',
        userId: 'alice',
        name: 'Blair',
        profileImageKey: 'profile',
        heightChartJson,
    })
    await seedMedia({
        id: 'media-1',
        userId: 'alice',
        characterId: 'blair',
        sfwImageKey: 'img',
        sfwContentType: 'image/png',
        sfwPreviewImageKey: 'preview',
        sfwPreviewContentType: 'image/avif',
        sfwPreviewWidth: 800,
        sfwPreviewHeight: 600,
        sfwPreviewByteSize: 512,
        nsfwBlurImageKey: 'blur',
        nsfwBlurContentType: 'image/avif',
    })
}

async function seedReferencedProfileUsers(count: number): Promise<void> {
    await db
        .prepare(
            `WITH RECURSIVE sequence(value) AS (
                VALUES (0)
                UNION ALL
                SELECT value + 1 FROM sequence WHERE value + 1 < ?
            )
            INSERT INTO users (id, email, username, password_hash, profile_photo_key)
            SELECT 'user-' || value,
                   'user-' || value || '@example.test',
                   'user_' || value,
                   'test-hash',
                   'photo'
            FROM sequence`,
        )
        .bind(count)
        .run()
}
