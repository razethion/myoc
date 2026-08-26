import {afterEach, describe, expect, it} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import {resetWorkerBindings} from '../../test/workerBindings'
import type {RecentMediaItem} from '../recentMedia'
import {getGeneratedRecentMediaPage, InvalidRecentFeedCursorError} from './reader'

const rootKey = 'generations/v1/roots/r7-demo.json'
const yearKey = 'generations/v1/manifests/n0-u1/years/2026/year.json'
const monthKey = 'generations/v1/manifests/n0-u1/months/2026-08/month.json'
const dayKey = 'generations/v1/manifests/n0-u1/days/2026-08-25/day.json'
const previousDayKey = 'generations/v1/manifests/n0-u1/days/2026-08-24/day.json'
const blockKey = 'generations/v1/blocks/n0-u1/2026-08-25T12/block.json'
const previousBlockKey = 'generations/v1/blocks/n0-u1/2026-08-24T12/block.json'
const pointer = {
    generation: 'r7-demo',
    rootKey,
    publishedAt: '2026-08-25T12:05:00.000Z',
    throughRevision: 7,
}

afterEach(async () => {
    await resetWorkerBindings()
})

describe('generated recent media reader', () => {
    it('pins pagination to one generation and reads its immutable manifest tree', async () => {
        const bucket = createMockR2Bucket()
        const items = [recentItem('media-1'), recentItem('media-2')]
        await seedFeed(bucket, items)
        const stateRow = {
            requested_revision: 7,
            published_revision: 7,
            generation: pointer.generation,
            root_key: pointer.rootKey,
            published_at: pointer.publishedAt,
            lease_owner: null,
        }
        const db = createMockDb({firstResults: [stateRow, pointer], allResults: [[], []]}).db
        const env = {
            DB: db,
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
            RECENT_FEED_PUBLIC_BASE_URL: 'https://feed-data.myoc.art',
        }

        const first = await getGeneratedRecentMediaPage(env, {limit: 1, showUnapproved: true})
        const second = await getGeneratedRecentMediaPage(env, {
            cursor: first.nextCursor,
            generation: first.generation,
            limit: 1,
            showUnapproved: true,
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
        const stateRow = {
            requested_revision: 7,
            published_revision: 7,
            generation: pointer.generation,
            root_key: pointer.rootKey,
            published_at: pointer.publishedAt,
            lease_owner: null,
        }
        const db = createMockDb({firstResults: [stateRow], allResults: [[]]}).db
        const env = {
            DB: db,
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
        }
        const first = await getGeneratedRecentMediaPage(env, {limit: 1, showUnapproved: true})
        const cursor = first.nextCursor ?? ''
        const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`

        await expect(
            getGeneratedRecentMediaPage(env, {cursor: tampered, generation: first.generation, showUnapproved: true}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it('counts revoked media in the direct continuation position', async () => {
        const bucket = createMockR2Bucket()
        const revokedItems = Array.from({length: 35}, (_, index) => recentItem(`revoked-${index}`))
        await seedFeed(bucket, [...revokedItems, recentItem('media-live'), recentItem('media-next')])
        const stateRow = {
            requested_revision: 7,
            published_revision: 7,
            generation: pointer.generation,
            root_key: pointer.rootKey,
            published_at: pointer.publishedAt,
            lease_owner: null,
        }
        const firstRevocations = revokedItems.slice(0, 30).map((item) => ({media_id: item.id}))
        const laterRevocations = revokedItems.slice(30).map((item) => ({media_id: item.id}))
        const db = createMockDb({firstResults: [stateRow], allResults: [firstRevocations, laterRevocations]}).db

        const page = await getGeneratedRecentMediaPage(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
            },
            {limit: 1, showUnapproved: true},
        )

        expect(page.items.map((item) => item.id)).toEqual(['media-live'])
        expect(page.nextPosition).toBe(36)
        expect(page.nextCursor).not.toBeNull()
    })
})

async function seedFeed(bucket: R2Bucket, items: RecentMediaItem[]): Promise<void> {
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
        }),
    )
    await bucket.put(
        yearKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u1',
            year: '2026',
            itemCount: items.length,
            months: [{month: '2026-08', key: monthKey, itemCount: items.length}],
        }),
    )
    await bucket.put(
        monthKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u1',
            month: '2026-08',
            itemCount: items.length,
            days,
        }),
    )
    await bucket.put(
        dayKey,
        JSON.stringify({
            schemaVersion: 1,
            variant: 'n0-u1',
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
    await bucket.put(blockKey, JSON.stringify({schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-25T12', items: currentItems}))

    if (previousItems.length > 0) {
        await bucket.put(
            previousDayKey,
            JSON.stringify({
                schemaVersion: 1,
                variant: 'n0-u1',
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
            JSON.stringify({schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-24T12', items: previousItems}),
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
