import {describe, expect, it} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaItem} from '../recentMedia'
import type {RecentFeedBlock, RecentFeedDayManifest, RecentFeedMonthManifest, RecentFeedVariantRoot, RecentFeedYearManifest} from './model'
import {readRecentFeedTreeItems} from './tree'

const variant = 'n0-u0'
const keys = {
    year: 'tree/year.json',
    month: 'tree/month.json',
    day: 'tree/day.json',
    firstBlock: 'tree/first-block.json',
    secondBlock: 'tree/second-block.json',
}

describe('recent media tree reader', () => {
    it('skips empty branches and reads the requested item range', async () => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        addEmptyReferences(tree)
        await putTree(bucket, tree)

        const first = await readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)
        const second = await readRecentFeedTreeItems(bucket, tree.root, variant, 1, 1)

        expect(first.map((item) => item.id)).toEqual(['media-1'])
        expect(second.map((item) => item.id)).toEqual(['media-2'])
    })

    it('reuses validated objects from a shared cache', async () => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        await putTree(bucket, tree)
        const cache = new Map<string, unknown>()

        const first = await readRecentFeedTreeItems(bucket, tree.root, variant, 0, 3, cache)
        await bucket.delete(Object.values(keys))
        const second = await readRecentFeedTreeItems(bucket, tree.root, variant, 1, 1, cache)

        expect(first.map((item) => item.id)).toEqual(['media-1', 'media-2'])
        expect(second.map((item) => item.id)).toEqual(['media-2'])
    })

    it('reports a missing tree object', async () => {
        const bucket = createMockR2Bucket()
        const tree = createTree()

        await expect(readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)).rejects.toThrow(
            `Recent feed object is missing: ${keys.year}`,
        )
    })

    it.each([
        ['year manifest', (tree: TreeFixture) => (tree.year.variant = 'n0-u1')],
        ['year item count', (tree: TreeFixture) => (tree.year.itemCount = 3)],
        ['year child count', (tree: TreeFixture) => (only(tree.year.months).itemCount = 1)],
        ['year child date', (tree: TreeFixture) => (only(tree.year.months).month = '2025-08')],
    ])('rejects an invalid %s link', async (_name, change) => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        change(tree)
        await putTree(bucket, tree)

        await expect(readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)).rejects.toThrow(
            'Recent feed year manifest does not match its reference',
        )
    })

    it.each([
        ['month manifest', (tree: TreeFixture) => (tree.month.variant = 'n0-u1')],
        ['month date', (tree: TreeFixture) => (tree.month.month = '2026-07')],
        ['month item count', (tree: TreeFixture) => (tree.month.itemCount = 3)],
        ['month child count', (tree: TreeFixture) => (only(tree.month.days).itemCount = 1)],
        ['month child date', (tree: TreeFixture) => (only(tree.month.days).day = '2026-07-30')],
    ])('rejects an invalid %s link', async (_name, change) => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        change(tree)
        await putTree(bucket, tree)

        await expect(readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)).rejects.toThrow(
            'Recent feed month manifest does not match its reference',
        )
    })

    it.each([
        ['day manifest', (tree: TreeFixture) => (tree.day.variant = 'n0-u1')],
        ['day date', (tree: TreeFixture) => (tree.day.day = '2026-08-29')],
        ['day item count', (tree: TreeFixture) => (tree.day.itemCount = 3)],
        ['day child count', (tree: TreeFixture) => (only(tree.day.hours).itemCount = 1)],
        ['day child date', (tree: TreeFixture) => (only(tree.day.hours).hour = '2026-08-29T12')],
        ['day block count', (tree: TreeFixture) => (only(only(tree.day.hours).blocks).itemCount = 2)],
    ])('rejects an invalid %s link', async (_name, change) => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        change(tree)
        await putTree(bucket, tree)

        await expect(readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)).rejects.toThrow(
            'Recent feed day manifest does not match its reference',
        )
    })

    it.each([
        ['block manifest', (tree: TreeFixture) => (tree.firstBlock.variant = 'n0-u1')],
        ['block hour', (tree: TreeFixture) => (tree.firstBlock.hour = '2026-08-30T13')],
        ['block item count', (tree: TreeFixture) => tree.firstBlock.items.push(recentItem('extra'))],
    ])('rejects an invalid %s link', async (_name, change) => {
        const bucket = createMockR2Bucket()
        const tree = createTree()
        change(tree)
        await putTree(bucket, tree)

        await expect(readRecentFeedTreeItems(bucket, tree.root, variant, 0, 1)).rejects.toThrow(
            'Recent feed block does not match its reference',
        )
    })
})

type TreeFixture = {
    root: RecentFeedVariantRoot
    year: RecentFeedYearManifest
    month: RecentFeedMonthManifest
    day: RecentFeedDayManifest
    firstBlock: RecentFeedBlock
    secondBlock: RecentFeedBlock
}

function createTree(): TreeFixture {
    return {
        root: {itemCount: 2, years: [{year: '2026', key: keys.year, itemCount: 2}]},
        year: {
            schemaVersion: 1,
            variant,
            year: '2026',
            itemCount: 2,
            months: [{month: '2026-08', key: keys.month, itemCount: 2}],
        },
        month: {
            schemaVersion: 1,
            variant,
            month: '2026-08',
            itemCount: 2,
            days: [{day: '2026-08-30', key: keys.day, itemCount: 2}],
        },
        day: {
            schemaVersion: 1,
            variant,
            day: '2026-08-30',
            itemCount: 2,
            hours: [
                {
                    hour: '2026-08-30T12',
                    itemCount: 2,
                    blocks: [
                        {key: keys.firstBlock, itemCount: 1},
                        {key: keys.secondBlock, itemCount: 1},
                    ],
                },
            ],
        },
        firstBlock: {schemaVersion: 1, variant, hour: '2026-08-30T12', items: [recentItem('media-1')]},
        secondBlock: {schemaVersion: 1, variant, hour: '2026-08-30T12', items: [recentItem('media-2')]},
    }
}

function addEmptyReferences(tree: TreeFixture): void {
    tree.root.years.unshift({year: '2025', key: 'tree/empty.json', itemCount: 0})
    tree.year.months.unshift({month: '2026-07', key: 'tree/empty.json', itemCount: 0})
    tree.month.days.unshift({day: '2026-08-29', key: 'tree/empty.json', itemCount: 0})
    tree.day.hours.unshift({hour: '2026-08-30T11', itemCount: 0, blocks: []})
    const populatedHour = tree.day.hours[1]
    if (!populatedHour) throw new Error('Expected a populated hour')
    populatedHour.blocks.unshift({key: 'tree/empty.json', itemCount: 0})
}

function only<T>(values: T[]): T {
    const value = values[0]
    if (!value) throw new Error('Expected one fixture value')
    return value
}

async function putTree(bucket: R2Bucket, tree: TreeFixture): Promise<void> {
    await Promise.all([
        bucket.put(keys.year, JSON.stringify(tree.year)),
        bucket.put(keys.month, JSON.stringify(tree.month)),
        bucket.put(keys.day, JSON.stringify(tree.day)),
        bucket.put(keys.firstBlock, JSON.stringify(tree.firstBlock)),
        bucket.put(keys.secondBlock, JSON.stringify(tree.secondBlock)),
    ])
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
