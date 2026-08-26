import {afterEach, describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {resetWorkerBindings} from '../../test/workerBindings'
import type {RecentMediaRow} from '../recentMedia'
import {RecentFeedDayManifestSchema, RecentFeedMonthManifestSchema, RecentFeedYearManifestSchema} from './model'
import {buildRecentFeedVariantTree, publishRecentFeed} from './publisher'

afterEach(async () => {
    await resetWorkerBindings()
})

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
        const rows = Array.from({length: 1001}, (_, index) => recentRow(`media-${String(1001 - index).padStart(4, '0')}`))
        const harness = createBootstrapDb(rows)
        const bucket = createMockR2Bucket()
        const env = {
            DB: harness.db,
            MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
            RECENT_FEED_BLOCK_ITEMS: '96',
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_PUBLISH_ENABLED: 'true',
        }

        const first = await publishRecentFeed(env, {now: new Date('2026-08-25T13:00:00.000Z')})

        expect(first).toMatchObject({status: 'building', revision: 1, bootstrapRows: 1000})
        expect(harness.state.bootstrap_cursor_id).toBe('media-0002')
        expect(harness.state.bootstrap_active_key).toMatch(/^generations\/v1\/bootstrap\/r1\/2026-08-25T12\//)
        expect(harness.state.root_key).toBeNull()

        harness.state.requested_revision = 2
        harness.dirtyRevisions.push(2)

        const second = await publishRecentFeed(env, {now: new Date('2026-08-25T13:01:00.000Z')})

        expect(second).toMatchObject({status: 'published', revision: 1, bootstrapRows: 1})
        expect(harness.state.published_revision).toBe(1)
        expect(harness.state.requested_revision).toBe(2)
        expect(harness.state.bootstrap_revision).toBeNull()
        expect(harness.state.root_key).toMatch(/^generations\/v1\/roots\//)
        expect(harness.dirtyRevisions).toEqual([2])
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

function createBootstrapDb(rows: RecentMediaRow[]): {db: D1Database; state: BootstrapState; dirtyRevisions: number[]} {
    const state: BootstrapState = {
        requested_revision: 1,
        published_revision: 0,
        generation: null,
        root_key: null,
        published_at: null,
        lease_owner: null,
        lease_expires_at: null,
        bootstrap_revision: null,
        bootstrap_cursor_created_at: null,
        bootstrap_cursor_id: null,
        bootstrap_variant_roots_json: null,
        bootstrap_active_key: null,
        bootstrap_objects_written: 0,
        bootstrap_bytes_written: 0,
    }
    const dirtyRevisions = [1]

    type BoundStatement = {
        all: () => Promise<{results: RecentMediaRow[]}>
        first: () => Promise<BootstrapState>
        run: () => Promise<{success: boolean}>
    }

    const execute = (sql: string, binds: unknown[]): void => {
        if (sql.includes('SET published_revision = ?')) {
            state.published_revision = Number(binds[0])
            state.generation = String(binds[1])
            state.root_key = String(binds[2])
            state.published_at = String(binds[3])
            state.bootstrap_revision = null
            state.bootstrap_cursor_created_at = null
            state.bootstrap_cursor_id = null
            state.bootstrap_variant_roots_json = null
            state.bootstrap_active_key = null
            state.bootstrap_objects_written = 0
            state.bootstrap_bytes_written = 0
            return
        }

        if (sql.includes('SET bootstrap_cursor_created_at = ?')) {
            state.bootstrap_cursor_created_at = binds[0] as string | null
            state.bootstrap_cursor_id = binds[1] as string | null
            state.bootstrap_variant_roots_json = String(binds[2])
            state.bootstrap_active_key = binds[3] as string | null
            state.bootstrap_objects_written = Number(binds[4])
            state.bootstrap_bytes_written = Number(binds[5])
            return
        }

        if (sql.includes('SET bootstrap_revision = ?')) {
            state.bootstrap_revision = Number(binds[0])
            state.bootstrap_variant_roots_json = String(binds[1])
            return
        }

        if (sql.includes('SET lease_owner = ?')) {
            state.lease_owner = String(binds[0])
            state.lease_expires_at = '2099-01-01 00:00:00'
            return
        }

        if (sql.includes('SET lease_owner = NULL')) {
            state.lease_owner = null
            state.lease_expires_at = null
            return
        }

        if (sql.includes('SET lease_expires_at = ')) {
            state.lease_expires_at = '2099-01-01 00:00:00'
            return
        }

        if (sql.includes('DELETE FROM recent_feed_dirty_hours')) {
            const throughRevision = Number(binds[0])
            dirtyRevisions.splice(0, dirtyRevisions.length, ...dirtyRevisions.filter((revision) => revision > throughRevision))
        }
    }

    const prepare = (sql: string) => ({
        bind: (...binds: unknown[]): BoundStatement => ({
            all: async () => {
                if (!sql.includes('FROM character_media')) {
                    return {results: []}
                }

                const hasCursor = binds.length === 4
                const limit = Number(binds.at(-1))
                const filtered = hasCursor
                    ? rows.filter((row) => {
                          const createdAt = String(binds[0])
                          const id = String(binds[2])
                          return row.created_at < createdAt || (row.created_at === createdAt && row.id < id)
                      })
                    : rows

                return {results: filtered.slice(0, limit)}
            },
            first: async () => ({...state}),
            run: async () => {
                execute(sql, binds)
                return {success: true}
            },
        }),
    })
    const db = {
        prepare,
        batch: async (statements: BoundStatement[]) => {
            for (const statement of statements) {
                await statement.run()
            }
            return []
        },
    }

    return {db: db as unknown as D1Database, state, dirtyRevisions}
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
