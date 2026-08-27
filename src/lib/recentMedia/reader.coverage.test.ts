import {afterEach, describe, expect, it, vi} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaItem} from '../recentMedia'
import {getGeneratedRecentMediaPage, InvalidRecentFeedCursorError, RecentFeedGenerationExpiredError} from './reader'

const secret = 'test-secret-with-at-least-thirty-two-characters'
const keys = {
    block: 'generations/v1/blocks/n0-u1/2026-08-25T12/block.json',
    day: 'generations/v1/manifests/n0-u1/days/2026-08-25/day.json',
    month: 'generations/v1/manifests/n0-u1/months/2026-08/month.json',
    root: 'generations/v1/roots/r7-demo.json',
    year: 'generations/v1/manifests/n0-u1/years/2026/year.json',
}
const pointer = {generation: 'r7-demo', rootKey: keys.root, publishedAt: '2026-08-25T12:05:00.000Z', throughRevision: 7}

afterEach(() => {
    vi.doUnmock('./model')
    vi.resetModules()
})

describe('generated recent media reader coverage', () => {
    it('rejects unavailable feeds, invalid generations, and absent roots', async () => {
        const bucket = createMockR2Bucket()
        const db = createMockDb().db

        await expect(getGeneratedRecentMediaPage({...environment(bucket, db), RECENT_FEED_CURSOR_SECRET: undefined})).rejects.toThrow(
            'cursor secret is not configured',
        )
        await expect(getGeneratedRecentMediaPage(environment(bucket, db), {generation: 'missing'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
        await expect(getGeneratedRecentMediaPage(environment(bucket, db), {generation: 'bad/generation'})).rejects.toBeInstanceOf(
            InvalidRecentFeedCursorError,
        )

        const rootDb = createMockDb({firstResults: [pointer]}).db
        await expect(getGeneratedRecentMediaPage(environment(bucket, rootDb), {generation: pointer.generation})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
        await expect(getGeneratedRecentMediaPage(environment(bucket, createMockDb({firstResults: [state()]}).db))).rejects.toThrow(
            'generated recent media feed is unavailable',
        )
    })

    it('rejects a current feed that has no pointer', async () => {
        const {bucket} = await seedFeed()
        await expect(
            getGeneratedRecentMediaPage(
                environment(bucket, createMockDb({firstResults: [state({generation: null, root_key: null, published_at: null})]}).db),
            ),
        ).rejects.toThrow('generated recent media feed is unavailable')
    })

    it('rejects cursor variant and generation conflicts', async () => {
        const {bucket} = await seedFeed([item('one'), item('two')])
        const db = createMockDb({firstResults: [state(), state(), state()]}).db
        const first = await getGeneratedRecentMediaPage(environment(bucket, db), {limit: 1, showUnapproved: true})

        await expect(
            getGeneratedRecentMediaPage(environment(bucket, db), {cursor: first.nextCursor, showNsfw: true, showUnapproved: true}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        await expect(
            getGeneratedRecentMediaPage(environment(bucket, db), {
                cursor: first.nextCursor,
                generation: 'other-generation',
                showUnapproved: true,
            }),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it.each([
        ['generation', (objects: FeedObjects) => ((objects[keys.root] as Root).generation = 'other')],
        ['revision', (objects: FeedObjects) => ((objects[keys.root] as Root).throughRevision = 8)],
        ['requested generation', (objects: FeedObjects) => ((objects[keys.root] as Root).generation = 'other')],
    ])('rejects a root with a mismatched %s', async (_name, change) => {
        const {bucket, objects} = await seedFeed()
        change(objects)
        await put(bucket, keys.root, objects[keys.root])
        const db = createMockDb({firstResults: [_name === 'requested generation' ? pointer : state()]}).db
        const options = _name === 'requested generation' ? {generation: pointer.generation} : {}

        await expect(getGeneratedRecentMediaPage(environment(bucket, db), options)).rejects.toBeInstanceOf(RecentFeedGenerationExpiredError)
    })

    it('rejects inconsistent roots, manifests, blocks, and missing objects', async () => {
        const cases: Array<[string, (objects: FeedObjects) => void]> = [
            ['root', (objects) => ((objects[keys.root] as Root).variants['n0-u1'].itemCount = 2)],
            ['year', (objects) => ((objects[keys.year] as Year).year = '2025')],
            ['month', (objects) => ((objects[keys.month] as Month).month = '2025-08')],
            ['day', (objects) => ((objects[keys.day] as Day).day = '2026-08-24')],
            ['block', (objects) => ((objects[keys.block] as Block).hour = '2026-08-25T11')],
            ['missing object', (objects) => (firstItem((objects[keys.root] as Root).variants['n0-u1'].years).key = 'missing.json')],
        ]

        for (const [_name, change] of cases) {
            const {bucket, objects} = await seedFeed()
            change(objects)
            await putAll(bucket, objects)
            await expect(getGeneratedRecentMediaPage(environment(bucket, createMockDb({firstResults: [state()]}).db))).rejects.toThrow()
        }
    })

    it('rejects a cursor past the immutable feed end', async () => {
        const {bucket, objects} = await seedFeed([item('one'), item('two')])
        const db = createMockDb({firstResults: [state(), pointer]}).db
        const first = await getGeneratedRecentMediaPage(environment(bucket, db), {limit: 1, showUnapproved: true})
        ;(objects[keys.root] as Root).variants['n0-u1'] = {itemCount: 0, years: []}
        await put(bucket, keys.root, objects[keys.root])

        await expect(
            getGeneratedRecentMediaPage(environment(bucket, db), {cursor: first.nextCursor, showUnapproved: true}),
        ).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it.each(['year', 'month', 'day', 'hour', 'block'] as const)('skips earlier %s references during pagination', async (level) => {
        const {bucket, rootKey} = await seedOffsetFeed(level)
        const db = createMockDb({firstResults: [state({root_key: rootKey}), {...pointer, rootKey}]}).db
        const first = await getGeneratedRecentMediaPage(environment(bucket, db), {limit: 1, showUnapproved: true})
        const second = await getGeneratedRecentMediaPage(environment(bucket, db), {
            cursor: first.nextCursor,
            limit: 1,
            showUnapproved: true,
        })

        expect(second.items).toHaveLength(1)
    })

    it('fills a page from a full generated block', async () => {
        const {bucket} = await seedFeed(Array.from({length: 30}, (_, index) => item(`item-${index}`)))
        const page = await getGeneratedRecentMediaPage(environment(bucket, createMockDb({firstResults: [state()]}).db), {
            limit: 15,
            showUnapproved: true,
        })

        expect(page.items).toHaveLength(15)
    })

    it('continues after revoked media and reads cached manifests', async () => {
        const items = Array.from({length: 31}, (_, index) => item(`item-${index}`))
        const {bucket} = await seedFeed(items)
        const db = createMockDb({
            firstResults: [state()],
            allResults: [items.slice(0, 30).map(({id}) => ({media_id: id})), []],
        }).db

        await expect(getGeneratedRecentMediaPage(environment(bucket, db), {limit: 1, showUnapproved: true})).resolves.toMatchObject({
            items: [expect.objectContaining({id: 'item-30'})],
        })
    })

    it('handles empty revocation inputs and empty D1 result arrays', async () => {
        const {bucket} = await seedFeed()
        const map = vi.spyOn(Array.prototype, 'map').mockImplementationOnce(() => [])
        try {
            await expect(
                getGeneratedRecentMediaPage(environment(bucket, createMockDb({firstResults: [state()]}).db)),
            ).resolves.toMatchObject({
                items: [expect.objectContaining({id: 'one'})],
            })
        } finally {
            map.mockRestore()
        }

        await expect(getGeneratedRecentMediaPage(environment(bucket, missingResultsDb()))).resolves.toMatchObject({
            items: [expect.objectContaining({id: 'one'})],
        })
    })

    it('rejects malformed cursor forms and signed invalid payloads', async () => {
        const {bucket} = await seedFeed()
        const db = createMockDb({firstResults: [pointer, pointer, pointer, pointer]}).db
        const env = environment(bucket, db)
        const invalidPayload = await signedCursor('{}')
        const invalidBase64 = await signedCursor('a')
        const wrongSignature = await signedCursor('different')

        await expect(getGeneratedRecentMediaPage(env, {cursor: 'x'.repeat(513)})).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        await expect(getGeneratedRecentMediaPage(env, {cursor: 'r1.only'})).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        await expect(getGeneratedRecentMediaPage(env, {cursor: `r1.a.${wrongSignature.split('.')[2]}`})).rejects.toBeInstanceOf(
            InvalidRecentFeedCursorError,
        )
        await expect(getGeneratedRecentMediaPage(env, {cursor: 'r1.a.*'})).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        await expect(getGeneratedRecentMediaPage(env, {cursor: invalidPayload})).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
        await expect(getGeneratedRecentMediaPage(env, {cursor: invalidBase64})).rejects.toBeInstanceOf(InvalidRecentFeedCursorError)
    })

    it('handles a defensive empty scan and empty revocation request', async () => {
        vi.doMock('./model', async (importOriginal) => {
            const original = await importOriginal<typeof import('./model')>()
            let itemCountReads = 0
            return {
                ...original,
                RecentFeedRootSchema: {parse: () => emptyScanRoot()},
                RecentFeedYearManifestSchema: {
                    parse: () => ({
                        variant: 'n0-u1',
                        year: '2026',
                        get itemCount() {
                            itemCountReads += 1
                            return itemCountReads === 1 ? 1 : 0
                        },
                        months: [],
                    }),
                },
            }
        })
        const {getGeneratedRecentMediaPage: read} = await import('./reader')
        const bucket = createMockR2Bucket()
        await put(bucket, keys.root, {})
        await put(bucket, keys.year, {})

        await expect(read(environment(bucket, createMockDb({firstResults: [state()]}).db))).resolves.toMatchObject({
            items: [],
            nextPosition: 0,
        })
    })
})

type Block = {variant: string; hour: string; items: RecentMediaItem[]}
type Day = {
    variant: string
    day: string
    itemCount: number
    hours: Array<{hour: string; itemCount: number; blocks: Array<{key: string; itemCount: number}>}>
}
type Month = {variant: string; month: string; itemCount: number; days: Array<{day: string; key: string; itemCount: number}>}
type Year = {variant: string; year: string; itemCount: number; months: Array<{month: string; key: string; itemCount: number}>}
type Root = {
    generation: string
    throughRevision: number
    variants: {
        'n0-u1': {itemCount: number; years: Array<{year: string; key: string; itemCount: number}>}
        [variant: string]: {itemCount: number; years: Array<{year: string; key: string; itemCount: number}>}
    }
}
type FeedObjects = Record<string, unknown>

function environment(bucket: R2Bucket, db: D1Database) {
    return {DB: db, RECENT_FEED_BUCKET: bucket, RECENT_FEED_CURSOR_SECRET: secret}
}

function state(overrides: Record<string, unknown> = {}) {
    return {
        requested_revision: pointer.throughRevision,
        published_revision: pointer.throughRevision,
        generation: pointer.generation,
        root_key: pointer.rootKey,
        published_at: pointer.publishedAt,
        lease_owner: null,
        lease_expires_at: null,
        bootstrap_revision: null,
        bootstrap_cursor_created_at: null,
        bootstrap_cursor_id: null,
        bootstrap_variant_roots_json: null,
        bootstrap_active_key: null,
        bootstrap_objects_written: 0,
        bootstrap_bytes_written: 0,
        ...overrides,
    }
}

function missingResultsDb(): D1Database {
    return {
        prepare: vi.fn(() => ({
            bind: vi.fn(() => ({
                all: vi.fn(async () => ({})),
                first: vi.fn(async () => state()),
            })),
        })),
    } as unknown as D1Database
}

async function seedFeed(items: RecentMediaItem[] = [item('one')]): Promise<{bucket: R2Bucket; objects: FeedObjects}> {
    const objects: FeedObjects = {
        [keys.root]: {
            schemaVersion: 1,
            generation: pointer.generation,
            throughRevision: pointer.throughRevision,
            publishedAt: pointer.publishedAt,
            variants: {
                'n0-u0': {itemCount: 0, years: []},
                'n0-u1': {itemCount: items.length, years: [{year: '2026', key: keys.year, itemCount: items.length}]},
                'n1-u0': {itemCount: 0, years: []},
                'n1-u1': {itemCount: 0, years: []},
            },
        },
        [keys.year]: {
            schemaVersion: 1,
            variant: 'n0-u1',
            year: '2026',
            itemCount: items.length,
            months: [{month: '2026-08', key: keys.month, itemCount: items.length}],
        },
        [keys.month]: {
            schemaVersion: 1,
            variant: 'n0-u1',
            month: '2026-08',
            itemCount: items.length,
            days: [{day: '2026-08-25', key: keys.day, itemCount: items.length}],
        },
        [keys.day]: {
            schemaVersion: 1,
            variant: 'n0-u1',
            day: '2026-08-25',
            itemCount: items.length,
            hours: [{hour: '2026-08-25T12', itemCount: items.length, blocks: [{key: keys.block, itemCount: items.length}]}],
        },
        [keys.block]: {schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-25T12', items},
    }
    const bucket = createMockR2Bucket()
    await putAll(bucket, objects)
    return {bucket, objects}
}

async function seedOffsetFeed(level: 'year' | 'month' | 'day' | 'hour' | 'block'): Promise<{bucket: R2Bucket; rootKey: string}> {
    const first = item('first')
    const second = item('second')
    const {bucket, objects} = await seedFeed([first, second])
    const extra = (name: string) => `generations/v1/${level}/${name}.json`

    if (level === 'year') {
        const firstYear = extra('year-first')
        const secondYear = extra('year-second')
        ;(objects[keys.root] as Root).variants['n0-u1'].years = [
            {year: '2025', key: firstYear, itemCount: 1},
            {year: '2026', key: secondYear, itemCount: 1},
        ]
        objects[firstYear] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            year: '2025',
            itemCount: 1,
            months: [{month: '2025-08', key: extra('month-first'), itemCount: 1}],
        }
        objects[extra('month-first')] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            month: '2025-08',
            itemCount: 1,
            days: [{day: '2025-08-25', key: extra('day-first'), itemCount: 1}],
        }
        objects[extra('day-first')] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            day: '2025-08-25',
            itemCount: 1,
            hours: [{hour: '2025-08-25T12', itemCount: 1, blocks: [{key: extra('block-first'), itemCount: 1}]}],
        }
        objects[extra('block-first')] = {schemaVersion: 1, variant: 'n0-u1', hour: '2025-08-25T12', items: [first]}
        objects[secondYear] = objects[keys.year]
        ;(objects[keys.year] as Year).itemCount = 1
        firstItem((objects[keys.year] as Year).months).itemCount = 1
        ;(objects[keys.month] as Month).itemCount = 1
        firstItem((objects[keys.month] as Month).days).itemCount = 1
        ;(objects[keys.day] as Day).itemCount = 1
        firstItem((objects[keys.day] as Day).hours).itemCount = 1
        firstItem(firstItem((objects[keys.day] as Day).hours).blocks).itemCount = 1
        ;(objects[keys.block] as Block).items = [second]
    } else if (level === 'month') {
        ;(objects[keys.year] as Year).months = [
            {month: '2026-07', key: extra('month-first'), itemCount: 1},
            {month: '2026-08', key: keys.month, itemCount: 1},
        ]
        objects[extra('month-first')] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            month: '2026-07',
            itemCount: 1,
            days: [{day: '2026-07-25', key: extra('day-first'), itemCount: 1}],
        }
        objects[extra('day-first')] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            day: '2026-07-25',
            itemCount: 1,
            hours: [{hour: '2026-07-25T12', itemCount: 1, blocks: [{key: extra('block-first'), itemCount: 1}]}],
        }
        objects[extra('block-first')] = {schemaVersion: 1, variant: 'n0-u1', hour: '2026-07-25T12', items: [first]}
        ;(objects[keys.month] as Month).itemCount = 1
        firstItem((objects[keys.month] as Month).days).itemCount = 1
        ;(objects[keys.day] as Day).itemCount = 1
        firstItem((objects[keys.day] as Day).hours).itemCount = 1
        firstItem(firstItem((objects[keys.day] as Day).hours).blocks).itemCount = 1
        ;(objects[keys.block] as Block).items = [second]
    } else if (level === 'day') {
        ;(objects[keys.month] as Month).days = [
            {day: '2026-08-24', key: extra('day-first'), itemCount: 1},
            {day: '2026-08-25', key: keys.day, itemCount: 1},
        ]
        objects[extra('day-first')] = {
            schemaVersion: 1,
            variant: 'n0-u1',
            day: '2026-08-24',
            itemCount: 1,
            hours: [{hour: '2026-08-24T12', itemCount: 1, blocks: [{key: extra('block-first'), itemCount: 1}]}],
        }
        objects[extra('block-first')] = {schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-24T12', items: [first]}
        ;(objects[keys.day] as Day).itemCount = 1
        firstItem((objects[keys.day] as Day).hours).itemCount = 1
        firstItem(firstItem((objects[keys.day] as Day).hours).blocks).itemCount = 1
        ;(objects[keys.block] as Block).items = [second]
    } else if (level === 'hour') {
        ;(objects[keys.day] as Day).hours = [
            {hour: '2026-08-25T11', itemCount: 1, blocks: [{key: extra('block-first'), itemCount: 1}]},
            {hour: '2026-08-25T12', itemCount: 1, blocks: [{key: keys.block, itemCount: 1}]},
        ]
        objects[extra('block-first')] = {schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-25T11', items: [first]}
        ;(objects[keys.block] as Block).items = [second]
    } else {
        firstItem((objects[keys.day] as Day).hours).blocks = [
            {key: extra('block-first'), itemCount: 1},
            {key: keys.block, itemCount: 1},
        ]
        objects[extra('block-first')] = {schemaVersion: 1, variant: 'n0-u1', hour: '2026-08-25T12', items: [first]}
        ;(objects[keys.block] as Block).items = [second]
    }

    await putAll(bucket, objects)
    return {bucket, rootKey: keys.root}
}

function emptyScanRoot() {
    return {
        generation: pointer.generation,
        throughRevision: pointer.throughRevision,
        publishedAt: pointer.publishedAt,
        variants: {
            'n0-u0': {itemCount: 0, years: []},
            'n0-u1': {itemCount: 1, years: [{year: '2026', key: keys.year, itemCount: 1}]},
            'n1-u0': {itemCount: 0, years: []},
            'n1-u1': {itemCount: 0, years: []},
        },
    }
}

async function putAll(bucket: R2Bucket, objects: FeedObjects): Promise<void> {
    await Promise.all(Object.entries(objects).map(([key, value]) => put(bucket, key, value)))
}

async function put(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
    await bucket.put(key, JSON.stringify(value))
}

function item(id: string): RecentMediaItem {
    return {
        id,
        groupId: '["user-1","character-1"]',
        alt: 'Quartz Dragon character art',
        width: 600,
        height: 800,
        previewSrc: `https://m.myoc.art/${id}-preview.webp`,
        originalSrc: `https://m.myoc.art/${id}.webp`,
        character: {name: 'Quartz Dragon', href: '/u/demo/Quartz%20Dragon', avatarUrl: 'https://m.myoc.art/character.webp'},
        user: {username: 'demo', href: '/u/demo', avatarUrl: null, initial: 'D'},
    }
}

async function signedCursor(payload: string): Promise<string> {
    const encoded = bytesToBase64Url(new TextEncoder().encode(payload))
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'])
    const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(encoded))
    return `r1.${encoded}.${bytesToBase64Url(signature)}`
}

function bytesToBase64Url(value: Uint8Array | ArrayBuffer): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function firstItem<T>(values: T[]): T {
    const value = values[0]
    if (value === undefined) {
        throw new Error('Expected a feed reference')
    }

    return value
}
