import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {createWorkerEnv, resetWorkerBindings, workerEnv} from '../../test/workerBindings'
import {cleanupStaleR2Media, parseManagedR2MediaKey} from './r2Cleanup'

const staleCleanupNow = new Date(Date.now() + 25 * 60 * 60 * 1000)

beforeEach(async () => {
    await resetWorkerBindings()
})

afterEach(async () => {
    await resetWorkerBindings()
})

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
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/nsfw/blur/blur.webp', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/sfw/img.png', 'referenced')
        await workerEnv.MEDIA_BUCKET.put('characters/alice/blair/media/media-1/sfw/preview/preview.webp', 'referenced')
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
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-1/nsfw/blur/blur.webp')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-1/sfw/preview/preview.webp')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/blur/orphan.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/preview/orphan.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/media/media-2/nsfw/orphan.gif')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/folders/main/image/image.webp')).not.toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/folders/main/image/stale.webp')).toBeNull()
        expect(await workerEnv.MEDIA_BUCKET.head('characters/alice/blair/scratch/stale.webp')).not.toBeNull()
    })

    it('does not evaluate recent objects for deletion', async () => {
        await workerEnv.MEDIA_BUCKET.put('users/alice/profile/new.webp', 'recent')

        const summary = await cleanupStaleR2Media(createWorkerEnv({DB: failOnD1Query()}), new Date())

        expect(summary.skippedRecent).toBe(1)
        expect(summary.deleted).toBe(0)
        expect(summary.errors).toBe(0)
        expect(await workerEnv.MEDIA_BUCKET.head('users/alice/profile/new.webp')).not.toBeNull()
    })
})

async function seedCleanupDatabase(heightChartJson: string): Promise<void> {
    await runD1SetupStatements([
        'DROP TABLE IF EXISTS users',
        'DROP TABLE IF EXISTS characters',
        'DROP TABLE IF EXISTS character_folders',
        'DROP TABLE IF EXISTS character_media',
        `CREATE TABLE users (
            id TEXT,
            email TEXT,
            username TEXT,
            password_hash TEXT,
            profile_photo_key TEXT
        )`,
        `CREATE TABLE characters (
            user_id TEXT,
            id TEXT,
            size_chart_id BLOB,
            name TEXT,
            profile_image_key TEXT,
            height_chart_json TEXT
        )`,
        `CREATE TABLE character_folders (
            user_id TEXT,
            id TEXT,
            name TEXT,
            folder_image_key TEXT
        )`,
        `CREATE TABLE character_media (
            user_id TEXT,
            character_id TEXT,
            id TEXT,
            sfw_image_key TEXT,
            nsfw_image_key TEXT,
            sfw_content_type TEXT,
            nsfw_content_type TEXT,
            sfw_preview_image_key TEXT,
            nsfw_preview_image_key TEXT,
            nsfw_blur_image_key TEXT
        )`,
    ])

    await workerEnv.DB.batch([
        workerEnv.DB.prepare('INSERT INTO users (id, email, username, password_hash, profile_photo_key) VALUES (?, ?, ?, ?, ?)').bind(
            'alice',
            'alice@example.test',
            'alice',
            'unused-test-hash',
            'current',
        ),
        workerEnv.DB.prepare(
            'INSERT INTO characters (user_id, id, size_chart_id, name, profile_image_key, height_chart_json) VALUES (?, ?, ?, ?, ?, ?)',
        ).bind('alice', 'blair', new Uint8Array([0xab, 0xcd, 0xef, 0x12, 0x34, 0x56]), 'Blair', 'profile', heightChartJson),
        workerEnv.DB.prepare('INSERT INTO character_folders (user_id, id, name, folder_image_key) VALUES (?, ?, ?, ?)').bind(
            'alice',
            'main',
            'Main',
            'image',
        ),
        workerEnv.DB.prepare(
            `INSERT INTO character_media (
                user_id,
                character_id,
                id,
                sfw_image_key,
                nsfw_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_preview_image_key,
                nsfw_blur_image_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind('alice', 'blair', 'media-1', 'img', null, 'image/png', null, 'preview', 'blur'),
    ])
}

async function runD1SetupStatements(statements: string[]): Promise<void> {
    for (const statement of statements) {
        await workerEnv.DB.prepare(statement).run()
    }
}

function failOnD1Query(): D1Database {
    return {
        prepare: () => {
            throw new Error('recent objects should not query D1')
        },
    } as unknown as D1Database
}
