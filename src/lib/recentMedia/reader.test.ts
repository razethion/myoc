import {describe, expect, it} from 'vitest'
import {useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaItem} from '../recentMedia'
import {getGeneratedRecentMediaPage, InvalidRecentFeedCursorError} from './reader'

const db = useTestDatabase()
const rootKey = 'generations/v1/roots/r7-demo.json'
const yearKey = 'generations/v1/manifests/n0-u0/years/2026/year.json'
const monthKey = 'generations/v1/manifests/n0-u0/months/2026-08/month.json'
const dayKey = 'generations/v1/manifests/n0-u0/days/2026-08-25/day.json'
const previousDayKey = 'generations/v1/manifests/n0-u0/days/2026-08-24/day.json'
const blockKey = 'generations/v1/blocks/n0-u0/2026-08-25T12/block.json'
const previousBlockKey = 'generations/v1/blocks/n0-u0/2026-08-24T12/block.json'
const pointer = {
    generation: 'r7-demo',
    rootKey,
    publishedAt: '2026-08-25T12:05:00.000Z',
    throughRevision: 7,
}

describe('generated recent media reader', () => {
    it('pins pagination to one generation and reads its immutable manifest tree', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1'), recentItem('media-2')])
        await seedPointer()
        const env = readerEnvironment(bucket, true)

        const first = await getGeneratedRecentMediaPage(env, {limit: 1, showUnapproved: false})
        const second = await getGeneratedRecentMediaPage(env, {
            cursor: first.nextCursor,
            generation: first.generation,
            limit: 1,
            showUnapproved: false,
        })

        expect(first.items.map((item) => item.id)).toEqual(['media-1'])
        expect(second.items.map((item) => item.id)).toEqual(['media-2'])
        expect(first).toMatchObject({
            generation: 'r7-demo',
            publicRootUrl: 'https://feed-data.myoc.art/generations/v1/roots/r7-demo.json',
            nextPosition: 1,
        })
        expect(second).toMatchObject({generation: 'r7-demo', nextPosition: null, nextCursor: null})
    })

    it('rejects a cursor that was changed by the client', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1'), recentItem('media-2')])
        await seedPointer()
        const env = readerEnvironment(bucket)
        const first = await getGeneratedRecentMediaPage(env, {limit: 1, showUnapproved: false})
        const cursor = first.nextCursor ?? ''
        const parts = cursor.split('.')
        const signature = parts[2] ?? ''
        const tampered = `${parts[0]}.${parts[1]}.${signature.startsWith('a') ? 'b' : 'a'}${signature.slice(1)}`

        await expect(
            getGeneratedRecentMediaPage(env, {cursor: tampered, generation: first.generation, showUnapproved: false}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it('counts revoked media in the continuation position', async () => {
        const bucket = createMockR2Bucket()
        const revokedItems = Array.from({length: 35}, (_, index) => recentItem(`revoked-${index}`))
        await seedFeed(bucket, [...revokedItems, recentItem('media-live'), recentItem('media-next')])
        await seedPointer()
        await seedRevocations(revokedItems.map((item) => item.id))

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 1, showUnapproved: false})

        expect(page.items.map((item) => item.id)).toEqual(['media-live'])
        expect(page.nextPosition).toBe(36)
        expect(page.nextCursor).not.toBeNull()
    })

    it('reads embedded initial items with one R2 request', async () => {
        const bucket = createMockR2Bucket()
        const items = Array.from({length: 60}, (_, index) => recentItem(`media-${index}`))
        await seedFeed(bucket, items, {initialItems: true})
        await seedPointer()

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 30, showUnapproved: false})

        expect(page.items.map((item) => item.id)).toEqual(items.slice(0, 30).map((item) => item.id))
        expect(page.nextPosition).toBe(30)
        expect(page.nextCursor).not.toBeNull()
        expect(bucket.get).toHaveBeenCalledTimes(1)
        expect(bucket.get).toHaveBeenCalledWith(rootKey)
    })

    it('consumes revoked embedded items without extra R2 requests', async () => {
        const bucket = createMockR2Bucket()
        const items = Array.from({length: 60}, (_, index) => recentItem(`media-${index}`))
        await seedFeed(bucket, items, {initialItems: true})
        await seedPointer()
        await seedRevocations(items.slice(0, 35).map((item) => item.id))

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 24, showUnapproved: false})

        expect(page.items.map((item) => item.id)).toEqual(items.slice(35, 59).map((item) => item.id))
        expect(page.nextPosition).toBe(59)
        expect(bucket.get).toHaveBeenCalledTimes(1)
    })
})

function readerEnvironment(bucket: R2Bucket, includePublicBaseUrl = false) {
    return {
        DB: db,
        RECENT_FEED_BUCKET: bucket,
        RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
        ...(includePublicBaseUrl ? {RECENT_FEED_PUBLIC_BASE_URL: 'https://feed-data.myoc.art'} : {}),
    }
}

async function seedPointer(): Promise<void> {
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET requested_revision = ?, published_revision = ?, generation = ?, root_key = ?, published_at = ?
             WHERE singleton = 1`,
        )
        .bind(pointer.throughRevision, pointer.throughRevision, pointer.generation, pointer.rootKey, pointer.publishedAt)
        .run()
    await db
        .prepare(
            `INSERT INTO recent_feed_generations (
                generation, through_revision, root_key, item_counts_json, object_count, byte_count, published_at
             ) VALUES (?, ?, ?, '{}', 0, 0, ?)`,
        )
        .bind(pointer.generation, pointer.throughRevision, pointer.rootKey, pointer.publishedAt)
        .run()
}

async function seedRevocations(mediaIds: string[]): Promise<void> {
    await db.batch(
        mediaIds.map((mediaId) =>
            db
                .prepare(
                    `INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
                     VALUES (?, 8, 'test')`,
                )
                .bind(mediaId),
        ),
    )
}

async function seedFeed(bucket: R2Bucket, items: RecentMediaItem[], options: {initialItems?: boolean} = {}): Promise<void> {
    const variantRoot = {itemCount: items.length, years: [{year: '2026', key: yearKey, itemCount: items.length}]}
    const currentItems = items.slice(0, 1)
    const previousItems = items.slice(1)
    const days = [
        {day: '2026-08-25', key: dayKey, itemCount: currentItems.length},
        ...(previousItems.length > 0 ? [{day: '2026-08-24', key: previousDayKey, itemCount: previousItems.length}] : []),
    ]
    await bucket.put(
        rootKey,
        JSON.stringify({
            schemaVersion: 1,
            generation: pointer.generation,
            throughRevision: pointer.throughRevision,
            publishedAt: pointer.publishedAt,
            variants: {
                'n0-u0': variantRoot,
                'n0-u1': variantRoot,
                'n1-u0': variantRoot,
                'n1-u1': variantRoot,
            },
            ...(options.initialItems
                ? {
                      initialItems: {
                          'n0-u0': items,
                          'n0-u1': items,
                          'n1-u0': items,
                          'n1-u1': items,
                      },
                  }
                : {}),
        }),
    )
    await bucket.put(
        yearKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u0',
            year: '2026',
            itemCount: items.length,
            months: [{month: '2026-08', key: monthKey, itemCount: items.length}],
        }),
    )
    await bucket.put(
        monthKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u0',
            month: '2026-08',
            itemCount: items.length,
            days,
        }),
    )
    await bucket.put(
        dayKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u0',
            day: '2026-08-25',
            itemCount: currentItems.length,
            hours: [
                {
                    hour: '2026-08-25T12',
                    itemCount: currentItems.length,
                    blocks: [{key: blockKey, itemCount: currentItems.length}],
                },
            ],
        }),
    )
    await bucket.put(blockKey, JSON.stringify({schemaVersion: 1, variant: 'n0-u0', hour: '2026-08-25T12', items: currentItems}))

    if (previousItems.length > 0) {
        await bucket.put(
            previousDayKey,
            JSON.stringify({
                schemaVersion: 1,
                variant: 'n0-u0',
                day: '2026-08-24',
                itemCount: previousItems.length,
                hours: [
                    {
                        hour: '2026-08-24T12',
                        itemCount: previousItems.length,
                        blocks: [{key: previousBlockKey, itemCount: previousItems.length}],
                    },
                ],
            }),
        )
        await bucket.put(
            previousBlockKey,
            JSON.stringify({schemaVersion: 1, variant: 'n0-u0', hour: '2026-08-24T12', items: previousItems}),
        )
    }
}

function recentItem(id: string): RecentMediaItem {
    return {
        id,
        groupId: '["user-1","character-1"]',
        alt: 'Quartz Dragon character art',
        width: 600,
        height: 800,
        previewSrc: `https://m.myoc.art/${id}-preview.webp`,
        originalSrc: `https://m.myoc.art/${id}.webp`,
        character: {
            name: 'Quartz Dragon',
            href: '/u/demo/Quartz%20Dragon',
            avatarUrl: 'https://m.myoc.art/character.webp',
        },
        user: {
            username: 'demo',
            href: '/u/demo',
            avatarUrl: null,
            initial: 'D',
        },
    }
}
