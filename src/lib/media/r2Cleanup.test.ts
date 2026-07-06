import {describe, expect, it, vi} from 'vitest'
import {cleanupStaleR2Media, parseManagedR2MediaKey} from './r2Cleanup'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'

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
        })

        expect(parseManagedR2MediaKey('characters/user-1/character-1/media/media-1/nsfw/blur/blur-1.webp')).toMatchObject({
            kind: 'characterMediaNsfwBlur',
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            imageKey: 'blur-1',
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
    })
})

describe('cleanupStaleR2Media', () => {
    it('deletes stale managed objects that are not referenced in D1', async () => {
        const bucket = createMockR2Bucket()
        const heightChartJson = JSON.stringify({
            image: {
                key: 'chart',
                contentType: 'image/png',
            },
        })
        const {db} = createMockDb({
            firstResults: [
                {found: 1},
                null,
                {height_chart_json: heightChartJson},
                {found: 1},
                {found: 1},
                {found: 1},
                null,
                null,
                null,
                {found: 1},
                null,
                {found: 1},
                null,
            ],
        })

        await bucket.put('users/alice/profile/current.webp', 'referenced')
        await bucket.put('users/alice/profile/old.png', 'unknown')
        await bucket.put('users/alice/profile/old.webp', 'stale')
        await bucket.put('characters/alice/blair/height-chart/chart.png', 'referenced')
        await bucket.put('characters/alice/blair/media/media-1/nsfw/blur/blur.webp', 'referenced')
        await bucket.put('characters/alice/blair/media/media-1/sfw/img.png', 'referenced')
        await bucket.put('characters/alice/blair/media/media-1/sfw/preview/preview.webp', 'referenced')
        await bucket.put('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp', 'stale')
        await bucket.put('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp', 'stale')
        await bucket.put('characters/alice/blair/media/media-2/nsfw/orphan.gif', 'stale')
        await bucket.put('characters/alice/blair/profile/profile.webp', 'referenced')
        await bucket.put('characters/alice/blair/profile/stale.webp', 'stale')
        await bucket.put('characters/alice/folders/main/image/image.webp', 'referenced')
        await bucket.put('characters/alice/folders/main/image/stale.webp', 'stale')
        await bucket.put('characters/alice/blair/scratch/stale.webp', 'unknown')

        const summary = await cleanupStaleR2Media({DB: db, MEDIA_BUCKET: bucket}, new Date('2026-06-26T12:00:00Z'))

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
        expect(bucket.delete).toHaveBeenCalledWith('users/alice/profile/old.webp')
        expect(bucket.delete).toHaveBeenCalledWith('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp')
        expect(bucket.delete).toHaveBeenCalledWith('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp')
        expect(bucket.delete).toHaveBeenCalledWith('characters/alice/blair/media/media-2/nsfw/orphan.gif')
        expect(bucket.delete).toHaveBeenCalledWith('characters/alice/blair/profile/stale.webp')
        expect(bucket.delete).toHaveBeenCalledWith('characters/alice/folders/main/image/stale.webp')
        expect(await bucket.head('users/alice/profile/current.webp')).not.toBeNull()
        expect(await bucket.head('users/alice/profile/old.png')).not.toBeNull()
        expect(await bucket.head('users/alice/profile/old.webp')).toBeNull()
        expect(await bucket.head('characters/alice/blair/media/media-1/nsfw/blur/blur.webp')).not.toBeNull()
        expect(await bucket.head('characters/alice/blair/media/media-1/sfw/preview/preview.webp')).not.toBeNull()
        expect(await bucket.head('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp')).toBeNull()
        expect(await bucket.head('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp')).toBeNull()
        expect(await bucket.head('characters/alice/blair/media/media-2/nsfw/orphan.gif')).toBeNull()
        expect(await bucket.head('characters/alice/folders/main/image/image.webp')).not.toBeNull()
        expect(await bucket.head('characters/alice/folders/main/image/stale.webp')).toBeNull()
        expect(await bucket.head('characters/alice/blair/scratch/stale.webp')).not.toBeNull()
    })

    it('does not evaluate recent objects for deletion', async () => {
        const recentObject = {
            key: 'users/alice/profile/new.webp',
            uploaded: new Date('2026-06-26T11:30:00Z'),
        } as R2Object
        const bucket = {
            list: vi.fn(async (options?: R2ListOptions) => ({
                objects: recentObject.key.startsWith(options?.prefix ?? '') ? [recentObject] : [],
                truncated: false,
                delimitedPrefixes: [],
            })),
            delete: vi.fn(),
        } as unknown as R2Bucket
        const db = {
            prepare: vi.fn(() => {
                throw new Error('recent objects should not query D1')
            }),
        } as unknown as D1Database

        const summary = await cleanupStaleR2Media({DB: db, MEDIA_BUCKET: bucket}, new Date('2026-06-26T12:00:00Z'))

        expect(summary.skippedRecent).toBe(1)
        expect(summary.deleted).toBe(0)
        expect(bucket.delete).not.toHaveBeenCalled()
        expect(db.prepare).not.toHaveBeenCalled()
    })
})
