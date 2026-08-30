import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaRow} from '../recentMedia'
import {RecentFeedDayManifestSchema, RecentFeedMonthManifestSchema, RecentFeedRootSchema, RecentFeedYearManifestSchema} from './model'
import {buildRecentFeedVariantTree, getRecentFeedPointer, publishRecentFeed} from './publisher'

const db = useTestDatabase()

describe('recent feed publisher', () => {
    it('stays disabled unless forced and reports an active publisher as busy', async () => {
        const bucket = createMockR2Bucket()
        const env = publisherEnv(bucket)

        await expect(publishRecentFeed(env)).resolves.toEqual({status: 'disabled'})
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET lease_owner = 'other-publisher', lease_expires_at = '2099-01-01 00:00:00'
                 WHERE singleton = 1`,
            )
            .run()

        await expect(publishRecentFeed({...env, RECENT_FEED_PUBLISH_ENABLED: 'true'})).resolves.toEqual({status: 'busy'})
        expect(await queryOne<{lease_owner: string}>('SELECT lease_owner FROM recent_feed_state WHERE singleton = 1')).toEqual({
            lease_owner: 'other-publisher',
        })
    })

    it('publishes an empty feed when forced and returns the current pointer on the next run', async () => {
        const bucket = createMockR2Bucket()
        const env = publisherEnv(bucket)

        await expect(getRecentFeedPointer(db)).resolves.toBeNull()
        const published = await publishRecentFeed(env, {force: true, now: new Date('2026-08-25T13:00:00.000Z')})
        const pointer = await getRecentFeedPointer(db)

        expect(published).toMatchObject({
            status: 'published',
            revision: 1,
            dirtyHours: 0,
            itemCounts: {'n0-u0': 0, 'n0-u1': 0, 'n1-u0': 0, 'n1-u1': 0},
            objectsWritten: 1,
            bootstrapRows: 0,
        })
        expect(pointer).toMatchObject({
            generation: published.generation,
            publishedAt: '2026-08-25T13:00:00.000Z',
            throughRevision: 1,
        })

        await expect(publishRecentFeed({...env, RECENT_FEED_PUBLISH_ENABLED: 'true'})).resolves.toEqual({
            status: 'current',
            generation: published.generation,
            revision: 1,
        })
    })

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

        const repeatedMetrics = {objectsWritten: 0, bytesWritten: 0}
        const repeatedRoot = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([['2026-08-25T12', [recentRow('media-1'), recentRow('media-2')]]]),
            true,
            'https://m.myoc.art',
            1,
            'public, max-age=31536000, immutable',
            repeatedMetrics,
        )

        expect(repeatedRoot).toEqual(root)
        expect(repeatedMetrics).toEqual({objectsWritten: 0, bytesWritten: 0})
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

    it('orders new time branches from newest to oldest', async () => {
        const bucket = createMockR2Bucket()

        const root = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([
                ['2025-12-31T23', [recentRow('media-1')]],
                ['2026-07-01T09', [recentRow('media-2')]],
                ['2026-08-01T08', [recentRow('media-3')]],
                ['2026-08-01T10', [recentRow('media-4')]],
            ]),
            true,
            'https://m.myoc.art',
            96,
            'immutable',
            {objectsWritten: 0, bytesWritten: 0},
        )
        const year = await readJson(bucket, root.years[0]?.key, RecentFeedYearManifestSchema)
        const month = await readJson(bucket, year.months[0]?.key, RecentFeedMonthManifestSchema)
        const day = await readJson(bucket, month.days[0]?.key, RecentFeedDayManifestSchema)

        expect(root.years.map(({year: value}) => value)).toEqual(['2026', '2025'])
        expect(year.months.map(({month: value}) => value)).toEqual(['2026-08', '2026-07'])
        expect(day.hours.map(({hour}) => hour)).toEqual(['2026-08-01T10', '2026-08-01T08'])
    })

    it('resumes an initial build and keeps later dirty revisions', async () => {
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
        expect(first).toMatchObject({status: 'building', revision: 1})

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

        expect(second).toMatchObject({
            status: 'published',
            revision: 1,
            itemCounts: {'n0-u0': 1001, 'n0-u1': 1001, 'n1-u0': 1001, 'n1-u1': 1001},
        })
        expect(publishedState.published_revision).toBe(1)
        expect(publishedState.requested_revision).toBe(2)
        expect(publishedState.bootstrap_revision).toBeNull()
        expect(publishedState.root_key).toMatch(/^generations\/v1\/roots\//)
        expect(dirtyRevisions).toEqual([{revision: 2}])
    })

    it('publishes an incremental addition and removal after bootstrap', async () => {
        const bucket = createMockR2Bucket()
        const env = {...publisherEnv(bucket), RECENT_FEED_PUBLISH_ENABLED: 'true'}
        const initial = await publishRecentFeed(env, {now: new Date('2026-08-25T10:00:00.000Z')})
        await seedUser({id: 'user-1', username: 'demo'})
        await seedCharacter({id: 'character-1', userId: 'user-1', name: 'Quartz Dragon'})
        await seedMedia({
            id: 'media-1',
            userId: 'user-1',
            characterId: 'character-1',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:30:00',
            sfwPreviewImageKey: 'media-1-preview',
            sfwPreviewWidth: 600,
            sfwPreviewHeight: 800,
            sfwPreviewByteSize: 512,
            createdAt: '2026-08-25 12:30:00',
        })
        await db.prepare('DELETE FROM recent_feed_dirty_hours WHERE revision <= 2').run()
        await db
            .prepare(
                `INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent)
                 VALUES ('*', 2, 'test-full-build', 1)`,
            )
            .run()

        const added = await publishRecentFeed(env, {now: new Date('2026-08-25T13:00:00.000Z')})
        const addedPointer = await getRecentFeedPointer(db)
        const rootObject = await bucket.get(addedPointer?.rootKey ?? '')
        const root = RecentFeedRootSchema.parse(await rootObject?.json<unknown>())

        expect(added).toMatchObject({
            status: 'published',
            revision: 2,
            dirtyHours: 1,
            itemCounts: {'n0-u0': 1, 'n0-u1': 1, 'n1-u0': 1, 'n1-u1': 1},
        })
        expect(added.generation).not.toBe(initial.generation)
        expect(root.initialItems?.['n0-u0'][0]).toMatchObject({id: 'media-1'})

        await db.prepare("DELETE FROM character_media WHERE id = 'media-1'").run()
        const removed = await publishRecentFeed(env, {now: new Date('2026-08-25T14:00:00.000Z')})

        expect(removed).toMatchObject({
            status: 'published',
            revision: 3,
            dirtyHours: 1,
            itemCounts: {'n0-u0': 0, 'n0-u1': 0, 'n1-u0': 0, 'n1-u1': 0},
        })
    })

    it('records an R2 publication failure, releases the lease, and permits a retry', async () => {
        const bucket = createMockR2Bucket()
        const env = {...publisherEnv(bucket), RECENT_FEED_PUBLISH_ENABLED: 'true'}
        vi.mocked(bucket.put).mockRejectedValueOnce(new Error('R2 is unavailable'))

        await expect(publishRecentFeed(env)).rejects.toThrow('R2 is unavailable')
        expect(
            await queryOne<{last_error: string; lease_owner: string | null}>(
                'SELECT last_error, lease_owner FROM recent_feed_state WHERE singleton = 1',
            ),
        ).toEqual({last_error: 'R2 is unavailable', lease_owner: null})

        await expect(publishRecentFeed(env)).resolves.toMatchObject({status: 'published', revision: 1})
    })

    it('rejects malformed dirty hours and invalid root counts', async () => {
        const bucket = createMockR2Bucket()

        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u1',
                {itemCount: 0, years: []},
                new Map([['not-an-hour', [recentRow('media-1')]]]),
                true,
                'https://m.myoc.art',
                96,
                'immutable',
                {objectsWritten: 0, bytesWritten: 0},
            ),
        ).rejects.toThrow('Recent feed dirty hour is invalid')
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u1',
                {itemCount: 1, years: []},
                new Map(),
                false,
                'https://m.myoc.art',
                96,
                'immutable',
                {objectsWritten: 0, bytesWritten: 0},
            ),
        ).rejects.toThrow('Recent feed variant root count is invalid')
    })

    it.each(['year', 'month', 'day'] as const)('rejects a corrupt %s manifest during an incremental update', async (level) => {
        const bucket = createMockR2Bucket()
        const initial = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([['2026-08-25T12', [recentRow('media-1')]]]),
            true,
            'https://m.myoc.art',
            96,
            'immutable',
            {objectsWritten: 0, bytesWritten: 0},
        )
        const yearReference = initial.years[0]
        const year = await readJson(bucket, yearReference?.key, RecentFeedYearManifestSchema)
        const monthReference = year.months[0]
        const month = await readJson(bucket, monthReference?.key, RecentFeedMonthManifestSchema)
        const dayReference = month.days[0]
        const day = await readJson(bucket, dayReference?.key, RecentFeedDayManifestSchema)
        const corrupt = {
            year: {key: yearReference?.key, value: {...year, itemCount: year.itemCount + 1}},
            month: {key: monthReference?.key, value: {...month, itemCount: month.itemCount + 1}},
            day: {key: dayReference?.key, value: {...day, itemCount: day.itemCount + 1}},
        }[level]
        await bucket.put(corrupt.key ?? '', JSON.stringify(corrupt.value))

        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u1',
                initial,
                new Map([['2026-08-25T12', [recentRow('media-2')]]]),
                false,
                'https://m.myoc.art',
                96,
                'immutable',
                {objectsWritten: 0, bytesWritten: 0},
            ),
        ).rejects.toThrow(`Recent feed ${level} manifest does not match its reference`)
    })

    it('rejects an incremental update when a referenced manifest is missing', async () => {
        const bucket = createMockR2Bucket()
        const initial = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([['2026-08-25T12', [recentRow('media-1')]]]),
            true,
            'https://m.myoc.art',
            96,
            'immutable',
            {objectsWritten: 0, bytesWritten: 0},
        )
        const yearKey = initial.years[0]?.key ?? ''
        await bucket.delete(yearKey)

        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u1',
                initial,
                new Map([['2026-08-25T12', [recentRow('media-2')]]]),
                false,
                'https://m.myoc.art',
                96,
                'immutable',
                {objectsWritten: 0, bytesWritten: 0},
            ),
        ).rejects.toThrow(`Recent feed object is missing: ${yearKey}`)
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

function publisherEnv(bucket: R2Bucket) {
    return {
        DB: db,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        RECENT_FEED_BUCKET: bucket,
    }
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
