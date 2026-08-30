import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaRow} from '../recentMedia'
import {RecentFeedDayManifestSchema, RecentFeedMonthManifestSchema, RecentFeedYearManifestSchema} from './model'
import {buildRecentFeedVariantTree, publishRecentFeed} from './publisher'

const db = useTestDatabase()

describe('recent feed publisher', () => {
    it('writes a bounded content-addressed manifest tree and immutable blocks', async () => {
        const bucket = createMockR2Bucket()
        const metrics = {objectsWritten: 0, bytesWritten: 0}
        const root = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([['2026-08-25T12', [recentRow('media-1'), recentRow('media-2')]]]),
            true,
            'https://m.myoc.art',
            1,
            'public, max-age=31536000, immutable',
            metrics,
        )

        const year = await readJson(bucket, root.years[0]?.key, RecentFeedYearManifestSchema)
        const month = await readJson(bucket, year.months[0]?.key, RecentFeedMonthManifestSchema)
        const day = await readJson(bucket, month.days[0]?.key, RecentFeedDayManifestSchema)

        expect(root).toMatchObject({itemCount: 2, years: [{year: '2026', itemCount: 2}]})
        expect(day.hours[0]?.blocks).toHaveLength(2)
        expect(day.hours[0]?.blocks.every((block) => block.key.startsWith('generations/v1/blocks/n0-u1/'))).toBe(true)
        expect(year.months[0]?.key).toMatch(/^generations\/v1\/manifests\/n0-u1\/months\/2026-08\//)
        expect(month.days[0]?.key).toMatch(/^generations\/v1\/manifests\/n0-u1\/days\/2026-08-25\//)
        expect(metrics.objectsWritten).toBe(5)
        expect(bucket.put).toHaveBeenCalledTimes(5)
        expect(vi.mocked(bucket.put).mock.calls[0]?.[2]).toMatchObject({
            httpMetadata: {
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'application/json; charset=utf-8',
            },
            customMetadata: {schema: '1'},
        })
    })

    it('rewrites only the dirty time branch and keeps unchanged day references', async () => {
        const bucket = createMockR2Bucket()
        const initial = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([
                ['2026-08-25T12', [recentRow('media-1')]],
                ['2026-08-24T12', [recentRow('media-2')]],
            ]),
            true,
            'https://m.myoc.art',
            96,
            'public, max-age=31536000, immutable',
            {objectsWritten: 0, bytesWritten: 0},
        )
        const initialYear = await readJson(bucket, initial.years[0]?.key, RecentFeedYearManifestSchema)
        const initialMonth = await readJson(bucket, initialYear.months[0]?.key, RecentFeedMonthManifestSchema)
        const unchangedDay = initialMonth.days.find((day) => day.day === '2026-08-24')
        const metrics = {objectsWritten: 0, bytesWritten: 0}

        const next = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            initial,
            new Map([['2026-08-25T12', []]]),
            false,
            'https://m.myoc.art',
            96,
            'public, max-age=31536000, immutable',
            metrics,
        )
        const nextYear = await readJson(bucket, next.years[0]?.key, RecentFeedYearManifestSchema)
        const nextMonth = await readJson(bucket, nextYear.months[0]?.key, RecentFeedMonthManifestSchema)

        expect(next.itemCount).toBe(1)
        expect(nextMonth.days).toEqual([unchangedDay])
        expect(metrics.objectsWritten).toBe(2)
    })

    it('resumes an initial build inside one large hour and keeps later dirty revisions', async () => {
        await seedSourceRows(1001)
        const bucket = createMockR2Bucket()
        const env = {
            DB: db,
            MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
            RECENT_FEED_BLOCK_ITEMS: '96',
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_PUBLISH_ENABLED: 'true',
        }

        const first = await publishRecentFeed(env, {now: new Date('2026-08-25T13:00:00.000Z')})
        const buildingState = await readFeedState()

        expect(first).toMatchObject({status: 'building', revision: 1, bootstrapRows: 1000})
        expect(buildingState.bootstrap_cursor_id).toBe('media-0002')
        expect(buildingState.bootstrap_active_key).toMatch(/^generations\/v1\/bootstrap\/r1\/2026-08-25T12\//)
        expect(buildingState.root_key).toBeNull()

        await db.prepare('UPDATE recent_feed_state SET requested_revision = 2 WHERE singleton = 1').run()
        await db
            .prepare(
                `UPDATE recent_feed_dirty_hours
                 SET revision = 2, reason = 'test-later-revision', urgent = 1
                 WHERE dirty_hour = '*'`,
            )
            .run()

        const second = await publishRecentFeed(env, {now: new Date('2026-08-25T13:01:00.000Z')})
        const publishedState = await readFeedState()
        const dirtyRevisions = await queryAll<{revision: number}>('SELECT revision FROM recent_feed_dirty_hours ORDER BY revision')

        expect(second).toMatchObject({status: 'published', revision: 1, bootstrapRows: 1})
        expect(publishedState.published_revision).toBe(1)
        expect(publishedState.requested_revision).toBe(2)
        expect(publishedState.bootstrap_revision).toBeNull()
        expect(publishedState.root_key).toMatch(/^generations\/v1\/roots\//)
        expect(dirtyRevisions).toEqual([{revision: 2}])
        expect(bucket.delete).toHaveBeenCalled()
    })
})

type BootstrapState = {
    requested_revision: number
    published_revision: number
    generation: string | null
    root_key: string | null
    published_at: string | null
    lease_owner: string | null
    lease_expires_at: string | null
    bootstrap_revision: number | null
    bootstrap_cursor_created_at: string | null
    bootstrap_cursor_id: string | null
    bootstrap_variant_roots_json: string | null
    bootstrap_active_key: string | null
    bootstrap_objects_written: number
    bootstrap_bytes_written: number
}

async function readFeedState(): Promise<BootstrapState> {
    const state = await queryOne<BootstrapState>(
        `SELECT requested_revision,
                published_revision,
                generation,
                root_key,
                published_at,
                lease_owner,
                lease_expires_at,
                bootstrap_revision,
                bootstrap_cursor_created_at,
                bootstrap_cursor_id,
                bootstrap_variant_roots_json,
                bootstrap_active_key,
                bootstrap_objects_written,
                bootstrap_bytes_written
         FROM recent_feed_state
         WHERE singleton = 1`,
    )
    if (!state) throw new Error('Recent feed state is missing')
    return state
}

async function seedSourceRows(count: number): Promise<void> {
    await seedUser({id: 'user-1', username: 'demo'})
    await seedCharacter({id: 'character-1', userId: 'user-1', name: 'Quartz Dragon', profileImageKey: 'profile'})

    const statements = Array.from({length: count}, (_, index) => {
        const id = `media-${String(count - index).padStart(4, '0')}`
        return db
            .prepare(
                `INSERT INTO character_media (
                    id, user_id, character_id,
                    sfw_image_key, sfw_width, sfw_height, sfw_byte_size,
                    sfw_review_status, sfw_approved_at, sfw_content_type,
                    sfw_preview_image_key, sfw_preview_width, sfw_preview_height, sfw_preview_byte_size,
                    created_at, updated_at
                 ) VALUES (?, 'user-1', 'character-1', ?, 600, 800, 1024, 'approved', ?, 'image/webp', ?, 600, 800, 512, ?, ?)`,
            )
            .bind(id, `${id}-original`, '2026-08-25 12:30:00', `${id}-preview`, '2026-08-25 12:30:00', '2026-08-25 12:30:00')
    })

    for (let offset = 0; offset < statements.length; offset += 100) {
        await db.batch(statements.slice(offset, offset + 100))
    }

    await db
        .prepare(
            `UPDATE recent_feed_state
             SET requested_revision = 1, published_revision = 0, generation = NULL, root_key = NULL, published_at = NULL
             WHERE singleton = 1`,
        )
        .run()
    await db.prepare('DELETE FROM recent_feed_dirty_hours WHERE revision >= 0').run()
    await db
        .prepare(
            `INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent)
             VALUES ('*', 1, 'initial-build', 1)`,
        )
        .run()
}

async function readJson<T>(bucket: R2Bucket, key: string | undefined, schema: {parse(value: unknown): T}): Promise<T> {
    expect(key).toBeTruthy()
    const object = await bucket.get(key ?? '')
    expect(object).not.toBeNull()
    return schema.parse(await object?.json<unknown>())
}

function recentRow(id: string): RecentMediaRow {
    return {
        id,
        user_id: 'user-1',
        character_id: 'character-1',
        sfw_image_key: `${id}-original`,
        sfw_preview_image_key: `${id}-preview`,
        sfw_content_type: 'image/webp',
        sfw_width: 600,
        sfw_height: 800,
        sfw_preview_width: 600,
        sfw_preview_height: 800,
        sfw_review_status: 'pending',
        sfw_approved_at: null,
        nsfw_image_key: null,
        nsfw_preview_image_key: null,
        nsfw_content_type: null,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_review_status: 'pending',
        nsfw_approved_at: null,
        created_at: '2026-08-25 12:30:00',
        updated_at: '2026-08-25 12:30:00',
        character_name: 'Quartz Dragon',
        character_profile_image_key: 'profile',
        owner_username: 'demo',
        owner_profile_photo_key: null,
    }
}
