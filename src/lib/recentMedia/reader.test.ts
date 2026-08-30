import {describe, expect, it} from 'vitest'
import {useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaItem} from '../recentMedia'
import {getGeneratedRecentMediaPage, InvalidRecentFeedCursorError, RecentFeedGenerationExpiredError} from './reader'

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
const cursorSecret = 'test-secret-with-at-least-thirty-two-characters'

type FeedRootOptions = {
    generation?: string
    initialItems?: RecentMediaItem[]
    initialItemsByVariant?: Record<'n0-u0' | 'n0-u1' | 'n1-u0' | 'n1-u1', RecentMediaItem>
    throughRevision?: number
    variantItemCount?: number
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

    it('reads embedded initial items', async () => {
        const bucket = createMockR2Bucket()
        const items = Array.from({length: 60}, (_, index) => recentItem(`media-${index}`))
        await seedFeed(bucket, items, {initialItems: true})
        await seedPointer()

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 30, showUnapproved: false})

        expect(page.items.map((item) => item.id)).toEqual(items.slice(0, 30).map((item) => item.id))
        expect(page.nextPosition).toBe(30)
        expect(page.nextCursor).not.toBeNull()
    })

    it('consumes revoked embedded items when it advances the cursor', async () => {
        const bucket = createMockR2Bucket()
        const items = Array.from({length: 60}, (_, index) => recentItem(`media-${index}`))
        await seedFeed(bucket, items, {initialItems: true})
        await seedPointer()
        await seedRevocations(items.slice(0, 35).map((item) => item.id))

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 24, showUnapproved: false})

        expect(page.items.map((item) => item.id)).toEqual(items.slice(35, 59).map((item) => item.id))
        expect(page.nextPosition).toBe(59)
    })

    it('requires a cursor secret before it reads the feed', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1')])
        await seedPointer()

        await expect(getGeneratedRecentMediaPage({...readerEnvironment(bucket), RECENT_FEED_CURSOR_SECRET: undefined})).rejects.toThrow(
            'Recent feed cursor secret is not configured',
        )
    })

    it('reports an unavailable feed when no generation was published', async () => {
        await expect(getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()))).rejects.toThrow(
            'The generated recent media feed is unavailable',
        )
    })

    it('reports an expired feed when a requested generation is not retained', async () => {
        await expect(
            getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()), {generation: 'removed-generation'}),
        ).rejects.toBeInstanceOf(RecentFeedGenerationExpiredError)
    })

    it('rejects an invalid generation identifier', async () => {
        await expect(
            getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()), {generation: '../private-root'}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it('reports an expired feed when a retained root object is missing', async () => {
        await seedPointer()

        await expect(
            getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()), {generation: pointer.generation}),
        ).rejects.toBeInstanceOf(RecentFeedGenerationExpiredError)
    })

    it('reports an unavailable feed when the current root object is missing', async () => {
        await seedPointer()

        await expect(getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()))).rejects.toThrow(
            'The generated recent media feed is unavailable',
        )
    })

    it.each([
        {name: 'generation', changes: {generation: 'different-generation'}},
        {name: 'revision', changes: {throughRevision: pointer.throughRevision + 1}},
    ])('rejects a root whose $name does not match its pointer', async ({changes}) => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1')])
        await putFeedRoot(bucket, [recentItem('media-1')], changes)
        await seedPointer()

        await expect(getGeneratedRecentMediaPage(readerEnvironment(bucket), {showUnapproved: false})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
    })

    it('rejects a variant whose item total does not match its year references', async () => {
        const bucket = createMockR2Bucket()
        const item = recentItem('media-1')
        await seedFeed(bucket, [item])
        await putFeedRoot(bucket, [item], {variantItemCount: 2})
        await seedPointer()

        await expect(getGeneratedRecentMediaPage(readerEnvironment(bucket), {showUnapproved: false})).rejects.toThrow(
            'Recent feed variant does not match its root',
        )
    })

    it('rejects embedded items that exceed the variant item total', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [])
        await putFeedRoot(bucket, [], {initialItems: [recentItem('unexpected-media')]})
        await seedPointer()

        await expect(getGeneratedRecentMediaPage(readerEnvironment(bucket), {showUnapproved: false})).rejects.toThrow(
            'Recent feed initial items do not match its root',
        )
    })

    it('rejects a cursor past the end of its retained generation', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1'), recentItem('media-2')])
        await seedPointer()
        const first = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 1, showUnapproved: false})
        await putFeedRoot(bucket, [])

        await expect(
            getGeneratedRecentMediaPage(readerEnvironment(bucket), {cursor: first.nextCursor, showUnapproved: false}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it('rejects a cursor when the requested filters select a different feed variant', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1'), recentItem('media-2')])
        await seedPointer()
        const first = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 1, showUnapproved: false})

        await expect(getGeneratedRecentMediaPage(readerEnvironment(bucket), {cursor: first.nextCursor})).rejects.toBeInstanceOf(
            InvalidRecentFeedCursorError,
        )
    })

    it('rejects a cursor paired with a different generation', async () => {
        const bucket = createMockR2Bucket()
        await seedFeed(bucket, [recentItem('media-1'), recentItem('media-2')])
        await seedPointer()
        const first = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {limit: 1, showUnapproved: false})

        await expect(
            getGeneratedRecentMediaPage(readerEnvironment(bucket), {
                cursor: first.nextCursor,
                generation: 'different-generation',
                showUnapproved: false,
            }),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it.each(['x'.repeat(513), 'r2.payload.signature', 'r1.payload.invalid!', 'r1.payload.a'])(
        'rejects a malformed cursor',
        async (cursor) => {
            await expect(
                getGeneratedRecentMediaPage(readerEnvironment(createMockR2Bucket()), {cursor, showUnapproved: false}),
            ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        },
    )

    it('selects the generated variant that matches the media filters', async () => {
        const bucket = createMockR2Bucket()
        const items = {
            'n0-u0': recentItem('safe-approved'),
            'n0-u1': recentItem('safe-all'),
            'n1-u0': recentItem('nsfw-approved'),
            'n1-u1': recentItem('nsfw-all'),
        }
        await seedFeed(bucket, [items['n0-u0']], {initialItems: true})
        await putFeedRoot(bucket, [items['n0-u0']], {initialItemsByVariant: items})
        await seedPointer()
        const env = readerEnvironment(bucket)

        const safeApproved = await getGeneratedRecentMediaPage(env, {showUnapproved: false})
        const safeAll = await getGeneratedRecentMediaPage(env)
        const nsfwApproved = await getGeneratedRecentMediaPage(env, {showNsfw: true, showUnapproved: false})
        const nsfwAll = await getGeneratedRecentMediaPage(env, {showNsfw: true})

        expect(safeApproved.items.map((item) => item.id)).toEqual(['safe-approved'])
        expect(safeAll.items.map((item) => item.id)).toEqual(['safe-all'])
        expect(nsfwApproved.items.map((item) => item.id)).toEqual(['nsfw-approved'])
        expect(nsfwAll.items.map((item) => item.id)).toEqual(['nsfw-all'])
    })

    it('keeps media that was visible when the generation was published', async () => {
        const bucket = createMockR2Bucket()
        const item = recentItem('media-visible-then')
        await seedFeed(bucket, [item])
        await seedPointer()
        await db
            .prepare(
                `INSERT INTO recent_feed_revocations (media_id, visible_from_revision, reason)
                 VALUES (?, ?, 'test')`,
            )
            .bind(item.id, pointer.throughRevision)
            .run()

        const page = await getGeneratedRecentMediaPage(readerEnvironment(bucket), {showUnapproved: false})

        expect(page.items.map((media) => media.id)).toEqual([item.id])
    })
})

function readerEnvironment(bucket: R2Bucket, includePublicBaseUrl = false) {
    return {
        DB: db,
        RECENT_FEED_BUCKET: bucket,
        RECENT_FEED_CURSOR_SECRET: cursorSecret,
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

async function putFeedRoot(bucket: R2Bucket, items: RecentMediaItem[], options: FeedRootOptions = {}): Promise<void> {
    const variantRoot = {
        itemCount: options.variantItemCount ?? items.length,
        years: [{year: '2026', key: yearKey, itemCount: items.length}],
    }
    const initialItems = options.initialItemsByVariant
        ? {
              'n0-u0': [options.initialItemsByVariant['n0-u0']],
              'n0-u1': [options.initialItemsByVariant['n0-u1']],
              'n1-u0': [options.initialItemsByVariant['n1-u0']],
              'n1-u1': [options.initialItemsByVariant['n1-u1']],
          }
        : options.initialItems
          ? {
                'n0-u0': options.initialItems,
                'n0-u1': options.initialItems,
                'n1-u0': options.initialItems,
                'n1-u1': options.initialItems,
            }
          : undefined

    await bucket.put(
        rootKey,
        JSON.stringify({
            schemaVersion: 1,
            generation: options.generation ?? pointer.generation,
            throughRevision: options.throughRevision ?? pointer.throughRevision,
            publishedAt: pointer.publishedAt,
            variants: {
                'n0-u0': variantRoot,
                'n0-u1': variantRoot,
                'n1-u0': variantRoot,
                'n1-u1': variantRoot,
            },
            ...(initialItems ? {initialItems} : {}),
        }),
    )
}

async function seedFeed(bucket: R2Bucket, items: RecentMediaItem[], options: {initialItems?: boolean} = {}): Promise<void> {
    const currentItems = items.slice(0, 1)
    const previousItems = items.slice(1)
    const days = [
        {day: '2026-08-25', key: dayKey, itemCount: currentItems.length},
        ...(previousItems.length > 0 ? [{day: '2026-08-24', key: previousDayKey, itemCount: previousItems.length}] : []),
    ]
    await putFeedRoot(bucket, items, options.initialItems ? {initialItems: items} : {})
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
