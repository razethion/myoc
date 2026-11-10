import {describe, expect, it, vi} from 'vitest'
import {seedCharacter, seedFolder, seedMedia, seedUser, useResetTestDatabase} from '../../test/d1'
import {createMockKVNamespace} from '../../test/mockKV'
import {createWorkerEnv, workerEnv} from '../../test/workerBindings'
import {cleanupStaleR2Media, parseManagedR2MediaKey} from './r2Cleanup'
import {profilePhotoObjectKey} from './url'

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

        expect(parseManagedR2MediaKey('d1/myoc-db/2026/11/10/backup.sql.gz')).toBeNull()
        expect(parseManagedR2MediaKey('backups/characters/user-1/character-1/media/media-1/sfw/image-1.png')).toBeNull()
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
    it('keeps the current AVIF profile photo and deletes a replaced one', async () => {
        await seedUser({id: 'alice', username: 'alice', profilePhotoKey: 'avif-current'})
        const currentKey = profilePhotoObjectKey('alice', 'avif-current')
        const replacedKey = profilePhotoObjectKey('alice', 'avif-replaced')
        await workerEnv.MEDIA_BUCKET.put(currentKey, 'referenced')
        await workerEnv.MEDIA_BUCKET.put(replacedKey, 'stale')

        const summary = await cleanupStaleR2Media(workerEnv, staleCleanupNow)

        expect(summary).toMatchObject({recognized: 2, keptReferenced: 1, deleted: 1, errors: 0})
        expect(await workerEnv.MEDIA_BUCKET.head(currentKey)).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head(replacedKey)).toBeNull()
    })

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

        const first = await cleanupStaleR2Media(env, now, {scanLimit: 900})
        const second = await cleanupStaleR2Media(env, now, {scanLimit: 900})

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

        const summary = await cleanupStaleR2Media(env, staleCleanupNow, {scanLimit: 900})

        expect(summary).toMatchObject({
            scanned: 900,
            recognized: 900,
            keptReferenced: 900,
            stoppedAtScanLimit: true,
        })
        expect(await cache.get('admin:r2-media-cleanup:cursor:v1')).not.toBeNull()
    }, 30_000)

    it('continues with the next managed prefix on the next run', async () => {
        const objectKeys = [
            ...Array.from({length: 900}, (_, index) => `users/user-${index}/profile/photo.webp`),
            'characters/user/character/profile/photo.webp',
        ]
        const bucket = createPagedMediaBucket(objectKeys, new Date())
        const cache = createMockKVNamespace()
        const env = createWorkerEnv({CACHE: cache, MEDIA_BUCKET: bucket})

        const first = await cleanupStaleR2Media(env, new Date(), {scanLimit: 900})
        const second = await cleanupStaleR2Media(env, new Date(), {scanLimit: 900})

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

    it('completes a full sweep in one run when the bucket fits the scan budget', async () => {
        const objectKeys = Array.from({length: 1200}, (_, index) => `users/user-${index}/profile/photo.webp`)
        const bucket = createPagedMediaBucket(objectKeys, new Date(0))
        const cache = createMockKVNamespace()
        const counting = createCountingDb(workerEnv.DB)
        await seedReferencedProfileUsers(1200)
        const env = createWorkerEnv({DB: counting.db, CACHE: cache, MEDIA_BUCKET: bucket})

        const summary = await cleanupStaleR2Media(env, staleCleanupNow)

        expect(summary).toMatchObject({
            scanned: 1200,
            recognized: 1200,
            keptReferenced: 1200,
            deleted: 0,
            stoppedAtScanLimit: false,
        })
        // Indexed objects must not trigger a query each; only the paged index reads run.
        expect(counting.count()).toBeLessThanOrEqual(8)
        await expect(cache.get('admin:r2-media-cleanup:cursor:v1')).resolves.toBeNull()
    }, 30_000)

    it('falls back to the exact check when the index cannot be built', async () => {
        await seedCleanupDatabase('{}')
        await db.exec('ALTER TABLE character_folders RENAME TO character_folders_offline')
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const bucket = createPagedMediaBucket(['characters/alice/blair/media/media-1/sfw/img.png'], new Date(0))

        const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: createMockKVNamespace(), MEDIA_BUCKET: bucket}), staleCleanupNow)

        expect(summary).toMatchObject({keptReferenced: 1, deleted: 0})
    })

    it('matches the exact content-type default when a media type is null', async () => {
        await seedCleanupDatabase('{}')
        await db.prepare('UPDATE character_media SET sfw_content_type = NULL WHERE id = ?').bind('media-1').run()
        const keptKey = 'characters/alice/blair/media/media-1/sfw/img.png'
        const deletedKey = 'characters/alice/blair/media/media-1/sfw/img.avif'
        const bucket = createPagedMediaBucket([keptKey, deletedKey], new Date(0))

        const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: createMockKVNamespace(), MEDIA_BUCKET: bucket}), staleCleanupNow)

        expect(summary).toMatchObject({keptReferenced: 1, deleted: 1})
        expect(vi.mocked(bucket.delete).mock.calls.map(([key]) => key)).toEqual([deletedKey])
    })

    it('protects task outputs only for the job states the exact check allows', async () => {
        await seedCleanupDatabase('{}')
        const inflightKey = 'characters/alice/blair/media/media-1/sfw/inflight.png'
        const failedKey = 'characters/alice/blair/media/media-1/sfw/failed.png'
        await seedGalleryTask({jobId: 'job-inflight', state: 'processing', outputKey: inflightKey})
        await seedGalleryTask({jobId: 'job-failed', state: 'failed', errorCode: 'processor_failed', outputKey: failedKey})
        const bucket = createPagedMediaBucket([inflightKey, failedKey], new Date(0))

        const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: createMockKVNamespace(), MEDIA_BUCKET: bucket}), staleCleanupNow)

        expect(summary).toMatchObject({keptReferenced: 1, deleted: 1})
        expect(vi.mocked(bucket.delete).mock.calls.map(([key]) => key)).toEqual([failedKey])
    })

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
    }, 30_000)

    it.each([new Error('cleanup failed'), 'cleanup failed'])('records object cleanup errors: %s', async (error) => {
        const bucket = createPagedMediaBucket(['users/alice/profile/photo.webp'], new Date(0))
        vi.mocked(bucket.delete).mockRejectedValue(error)
        vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const summary = await cleanupStaleR2Media(createWorkerEnv({CACHE: createMockKVNamespace(), MEDIA_BUCKET: bucket}), staleCleanupNow)

        expect(summary).toMatchObject({deleted: 0, errors: 1})
    })
})

function createCountingDb(db: D1Database): {db: D1Database; count: () => number} {
    let count = 0
    const wrapped = {
        prepare(query: string) {
            count += 1
            return db.prepare(query)
        },
    } as unknown as D1Database

    return {db: wrapped, count: () => count}
}

async function seedGalleryTask(input: {
    jobId: string
    state: 'processing' | 'failed'
    errorCode?: string
    outputKey: string
}): Promise<void> {
    await db
        .prepare(
            `INSERT INTO image_upload_jobs (id, user_id, target_type, target_id, state, idempotency_key, request_json, error_code, deadline_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            input.jobId,
            'alice',
            'gallery_create',
            'blair',
            input.state,
            `idem-${input.jobId}`,
            JSON.stringify({mediaId: 'media-1'}),
            input.errorCode ?? null,
            new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        )
        .run()

    await db
        .prepare('INSERT INTO image_upload_sources (id, job_id, rating, state, object_key, content_type) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(`src-${input.jobId}`, input.jobId, 'sfw', 'ready', `image-sources/alice/blair/${input.jobId}.png`, 'image/png')
        .run()

    await db
        .prepare(
            `INSERT INTO image_processing_tasks (id, job_id, source_id, run_id, recipe, container_slot, state, output_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            `task-${input.jobId}`,
            input.jobId,
            `src-${input.jobId}`,
            `run-${input.jobId}`,
            'gallery-sfw-v1',
            0,
            'ready',
            JSON.stringify({imageObjectKey: input.outputKey}),
        )
        .run()
}

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
