import {afterEach, describe, expect, it, vi} from 'vitest'
import {cleanupRecentFeed} from './cleanup'

const OWNER = 'cleanup:00000000-0000-4000-8000-000000000000'
const NOW = new Date('2026-08-25T12:00:00.000Z')

afterEach(() => {
    vi.restoreAllMocks()
})

describe('recent feed cleanup coverage guards', () => {
    it('handles lease and retained-root safeguards', async () => {
        mockOwner()
        await expect(cleanupRecentFeed(environment(database([], []).db, bucket()), NOW)).rejects.toThrow(
            'Recent feed migration is not applied',
        )

        const releaseWarning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const releaseDb = database([OWNER, null, 0, OWNER], [[], []], (sql) => sql.includes('SET lease_owner = NULL'))
        await expect(cleanupRecentFeed(environment(releaseDb.db, bucket()), NOW)).resolves.toEqual({
            retainedGenerations: 0,
            deletedGenerations: 0,
            deletedObjects: 0,
        })
        expect(releaseDb.db.prepare).toHaveBeenCalled()
        expect(releaseDb.db.prepare).toHaveBeenCalledTimes(9)
        expect(vi.mocked(releaseDb.db.prepare).mock.calls.some(([sql]) => String(sql).includes('SET lease_owner = NULL'))).toBe(true)
        expect(releaseWarning).toHaveBeenCalledWith('Unable to release the recent feed cleanup lease', {error: expect.any(Error)})

        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const invalidRoot = database([OWNER, null, 1], [[], [{root_key: 'not-a-root'}]])
        await expect(cleanupRecentFeed(environment(invalidRoot.db, bucket()), NOW)).resolves.toEqual({
            retainedGenerations: 1,
            deletedGenerations: 0,
            deletedObjects: 0,
        })

        const tooMany = Array.from({length: 2001}, (_, index) => ({root_key: rootKeyFor(index)}))
        const cappedRoots = database([OWNER, null, 2001], [[], tooMany])
        await cleanupRecentFeed(environment(cappedRoots.db, bucket()), NOW)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('too-many-retained-roots'))

        const pages = Array.from({length: 4}, (_, pageIndex) =>
            Array.from({length: 500}, (_, index) => ({root_key: rootKeyFor(pageIndex * 500 + index)})),
        )
        const exactPage = database([OWNER, null, 2000], [[], ...pages, []])
        await cleanupRecentFeed(environment(exactPage.db, bucket()), NOW)
        const extraPage = database([OWNER, null, 2000], [[], ...pages, [{root_key: rootKeyFor(2001)}]])
        await cleanupRecentFeed(environment(extraPage.db, bucket()), NOW)
    })

    it('stops a sweep for list and lease failures', async () => {
        mockOwner()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const tooLargeList = bucket({
            list: vi.fn(async () => page(Array.from({length: 100_001}, (_, index) => `generations/v1/blocks/n0-u0/a${index}`))) as never,
        })
        await cleanupRecentFeed(environment(database([OWNER, null, 0], [[], []]).db, tooLargeList), NOW)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('object-list-is-too-large'))

        const noCursor = bucket({list: vi.fn(async () => ({objects: [], truncated: true})) as never})
        await cleanupRecentFeed(environment(database([OWNER, null, 0], [[], []]).db, noCursor), NOW)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('object-list-is-too-large'))

        const lostLease = database([OWNER, null, 0, 'other-owner'], [[], []])
        await cleanupRecentFeed(environment(lostLease.db, bucket()), NOW)
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('cleanup-lease-was-lost'))

        let firstManifestPage = true
        const paginatedBucket = bucket({
            list: vi.fn(async (options?: R2ListOptions) => {
                if (firstManifestPage && !options?.cursor) {
                    firstManifestPage = false
                    return {objects: [], delimitedPrefixes: [], truncated: true as const, cursor: 'next-page'}
                }
                return {objects: [], delimitedPrefixes: [], truncated: false as const}
            }),
        })
        await cleanupRecentFeed(environment(database([OWNER, null, 0, OWNER], [[], []]).db, paginatedBucket), NOW)
        expect(paginatedBucket.list).toHaveBeenCalledWith(expect.objectContaining({cursor: 'next-page'}))

        await expect(cleanupRecentFeed(environment(database([{lease_owner: 'other-owner'}, null], []).db, bucket()), NOW)).resolves.toEqual(
            {
                retainedGenerations: 0,
                deletedGenerations: 0,
                deletedObjects: 0,
            },
        )
    })

    it('rejects invalid graph data at every manifest level', async () => {
        mockOwner()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const fixtures = validGraph()
        const cases: Array<(graph: Graph) => void> = [
            (graph) => {
                graph.values.set(graph.rootKey, {})
            },
            (graph) => {
                ;(graph.values.get(graph.rootKey) as Data).variants['n0-u0'].itemCount = 2
            },
            (graph) => {
                ;(graph.values.get(graph.rootKey) as Data).variants['n0-u0'].years[0].key = 'bad'
            },
            (graph) => {
                const root = graph.values.get(graph.rootKey) as Data
                root.variants['n0-u0'].years.push({...root.variants['n0-u0'].years[0], itemCount: 0})
            },
            (graph) => {
                graph.values.set(graph.yearKey, {})
            },
            (graph) => {
                ;(graph.values.get(graph.yearKey) as Data).variant = 'n0-u1'
            },
            (graph) => {
                ;(graph.values.get(graph.yearKey) as Data).months[0].key = 'bad'
            },
            (graph) => {
                graph.values.set(graph.monthKey, {})
            },
            (graph) => {
                ;(graph.values.get(graph.monthKey) as Data).month = '2026-07'
            },
            (graph) => {
                ;(graph.values.get(graph.monthKey) as Data).days[0].key = 'bad'
            },
            (graph) => {
                graph.values.set(graph.dayKey, {})
            },
            (graph) => {
                ;(graph.values.get(graph.dayKey) as Data).day = '2026-06-11'
            },
            (graph) => {
                ;(graph.values.get(graph.dayKey) as Data).hours[0].hour = '2026-06-09T12'
            },
            (graph) => {
                ;(graph.values.get(graph.dayKey) as Data).hours[0].blocks[0].key = 'bad'
            },
        ]

        for (const change of cases) {
            const graph = cloneGraph(fixtures)
            change(graph)
            await cleanupRecentFeed(
                environment(database([OWNER, null, 1], [[], [{root_key: graph.rootKey}]]).db, valueBucket(graph.values)),
                NOW,
            )
        }
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('retained-graph-is-invalid-or-too-large'))
    })

    it('covers graph read limits and safe JSON reads', async () => {
        mockOwner()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const missing = validGraph()
        const missingBucket = valueBucket(missing.values)
        vi.mocked(missingBucket.get).mockResolvedValueOnce(null)
        await cleanupRecentFeed(environment(database([OWNER, null, 1], [[], [{root_key: missing.rootKey}]]).db, missingBucket), NOW)

        const oversized = validGraph()
        const oversizedBucket = valueBucket(oversized.values)
        vi.mocked(oversizedBucket.get).mockResolvedValueOnce({size: 1024 * 1024 + 1} as R2ObjectBody)
        await cleanupRecentFeed(environment(database([OWNER, null, 1], [[], [{root_key: oversized.rootKey}]]).db, oversizedBucket), NOW)

        const failing = validGraph()
        const failingBucket = valueBucket(failing.values)
        vi.mocked(failingBucket.get).mockRejectedValueOnce(new Error('R2 read failed'))
        await cleanupRecentFeed(environment(database([OWNER, null, 1], [[], [{root_key: failing.rootKey}]]).db, failingBucket), NOW)

        await cleanupRecentFeed(
            environment(database([OWNER, null, 1, OWNER], [[], [{root_key: hugeRootKey()}]]).db, limitBucket('years')),
            NOW,
        )
        await cleanupRecentFeed(
            environment(database([OWNER, null, 1, OWNER], [[], [{root_key: hugeRootKey()}]]).db, limitBucket('months')),
            NOW,
        )
        await cleanupRecentFeed(
            environment(database([OWNER, null, 1, OWNER], [[], [{root_key: hugeRootKey()}]]).db, limitBucket('days')),
            NOW,
        )
        await cleanupRecentFeed(
            environment(database([OWNER, null, 1, OWNER, OWNER, OWNER], [[], [{root_key: hugeRootKey()}]]).db, reachableLimitBucket()),
            NOW,
        )
        expect(warning).toHaveBeenCalledWith(expect.stringContaining('retained-graph-is-invalid-or-too-large'))
    }, 120_000)

    it('deduplicates identical manifest references from retained roots', async () => {
        mockOwner()
        const graph = validGraph()
        const duplicateRoot = rootKeyFor(2)
        const duplicateValue = structuredClone(graph.values.get(graph.rootKey) as Data)
        duplicateValue.generation = 'r2'
        graph.values.set(duplicateRoot, duplicateValue)
        await expect(
            cleanupRecentFeed(
                environment(
                    database([OWNER, null, 2, OWNER], [[], [{root_key: graph.rootKey}, {root_key: duplicateRoot}]]).db,
                    valueBucket(graph.values),
                ),
                NOW,
            ),
        ).resolves.toEqual({retainedGenerations: 2, deletedGenerations: 0, deletedObjects: 0})
    })
})

// biome-ignore lint/suspicious/noExplicitAny: Malformed JSON fixtures need a mutable, intentionally loose shape.
type Data = Record<string, any>
type Graph = {rootKey: string; yearKey: string; monthKey: string; dayKey: string; values: Map<string, Data>}

function mockOwner(): void {
    vi.stubGlobal('crypto', {randomUUID: () => '00000000-0000-4000-8000-000000000000'})
}

function environment(DB: D1Database, RECENT_FEED_BUCKET: R2Bucket) {
    return {DB, RECENT_FEED_BUCKET, RECENT_FEED_CLEANUP_ENABLED: 'true'}
}

function database(first: unknown[], all: unknown[][], failRun?: (sql: string) => boolean) {
    const firstResults = [...first]
    const allResults = [...all]
    let activeOwner: unknown = null
    const db = {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn((...binds: unknown[]) => {
                if (binds.length) activeOwner = binds[0]
                return {
                    first: vi.fn(async () => {
                        const value = firstResults.shift() ?? null
                        if (value === OWNER) return {lease_owner: activeOwner}
                        return typeof value === 'number' ? {count: value} : value
                    }),
                    all: vi.fn(async () => ({results: allResults.shift() ?? []})),
                    run: vi.fn(async () => {
                        if (failRun?.(sql)) throw new Error('D1 write failed')
                        return {success: true}
                    }),
                }
            }),
        })),
    } as unknown as D1Database
    return {db}
}

function bucket(overrides: Partial<R2Bucket> = {}): R2Bucket {
    return {
        get: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
        list: vi.fn(async () => page([])),
        ...overrides,
    } as unknown as R2Bucket
}

function page(keys: string[]) {
    return {objects: keys.map((key) => ({key, uploaded: new Date('2026-06-01T00:00:00.000Z')})), truncated: false, cursor: undefined}
}

function valueBucket(values: Map<string, Data>): R2Bucket {
    return bucket({
        get: vi.fn(async (key: string) => {
            const value = values.get(key)
            return value === undefined ? null : ({size: 1, json: vi.fn(async () => value)} as unknown as R2ObjectBody)
        }),
    })
}

function rootKeyFor(index: number): string {
    return `generations/v1/roots/r${index}.json`
}

function digest(index: number): string {
    return index.toString(16).padStart(64, '0')
}

function hugeRootKey(): string {
    return rootKeyFor(99_999)
}

function validGraph(): Graph {
    const rootKey = rootKeyFor(1)
    const yearKey = `generations/v1/manifests/n0-u0/years/2026/${digest(1)}.json`
    const monthKey = `generations/v1/manifests/n0-u0/months/2026-06/${digest(2)}.json`
    const dayKey = `generations/v1/manifests/n0-u0/days/2026-06-10/${digest(3)}.json`
    const blockKey = `generations/v1/blocks/n0-u0/2026-06-10T12/${digest(4)}.json`
    const empty = {itemCount: 0, years: []}
    const values = new Map<string, Data>([
        [
            rootKey,
            {
                schemaVersion: 1,
                generation: 'r1',
                throughRevision: 1,
                publishedAt: 'now',
                variants: {
                    'n0-u0': {itemCount: 1, years: [{year: '2026', key: yearKey, itemCount: 1}]},
                    'n0-u1': empty,
                    'n1-u0': empty,
                    'n1-u1': empty,
                },
            },
        ],
        [
            yearKey,
            {schemaVersion: 1, variant: 'n0-u0', year: '2026', itemCount: 1, months: [{month: '2026-06', key: monthKey, itemCount: 1}]},
        ],
        [
            monthKey,
            {schemaVersion: 1, variant: 'n0-u0', month: '2026-06', itemCount: 1, days: [{day: '2026-06-10', key: dayKey, itemCount: 1}]},
        ],
        [
            dayKey,
            {
                schemaVersion: 1,
                variant: 'n0-u0',
                day: '2026-06-10',
                itemCount: 1,
                hours: [{hour: '2026-06-10T12', itemCount: 1, blocks: [{key: blockKey, itemCount: 1}]}],
            },
        ],
    ])
    return {rootKey, yearKey, monthKey, dayKey, values}
}

function cloneGraph(graph: Graph): Graph {
    return {
        rootKey: graph.rootKey,
        yearKey: graph.yearKey,
        monthKey: graph.monthKey,
        dayKey: graph.dayKey,
        values: new Map([...graph.values].map(([key, value]) => [key, structuredClone(value)])),
    }
}

function limitBucket(level: 'years' | 'months' | 'days'): R2Bucket {
    const keys = Array.from({length: 7001}, (_, index) => `${digest(index + 10)}.json`)
    const years =
        level === 'years'
            ? keys.map((key) => ({year: '2026', key: `generations/v1/manifests/n0-u0/years/2026/${key}`, itemCount: 0}))
            : [{year: '2026', key: `generations/v1/manifests/n0-u0/years/2026/${digest(9)}.json`, itemCount: 0}]
    const root = {
        schemaVersion: 1,
        generation: 'limit',
        throughRevision: 1,
        publishedAt: 'now',
        variants: {
            'n0-u0': {itemCount: 0, years},
            'n0-u1': {itemCount: 0, years: []},
            'n1-u0': {itemCount: 0, years: []},
            'n1-u1': {itemCount: 0, years: []},
        },
    }
    const year = {
        schemaVersion: 1,
        variant: 'n0-u0',
        year: '2026',
        itemCount: 0,
        months:
            level === 'months'
                ? keys.map((key) => ({month: '2026-06', key: `generations/v1/manifests/n0-u0/months/2026-06/${key}`, itemCount: 0}))
                : level === 'days'
                  ? [{month: '2026-06', key: `generations/v1/manifests/n0-u0/months/2026-06/${digest(8)}.json`, itemCount: 0}]
                  : [],
    }
    const month = {
        schemaVersion: 1,
        variant: 'n0-u0',
        month: '2026-06',
        itemCount: 0,
        days:
            level === 'days'
                ? keys.map((key) => ({day: '2026-06-10', key: `generations/v1/manifests/n0-u0/days/2026-06-10/${key}`, itemCount: 0}))
                : [],
    }
    const day = {schemaVersion: 1, variant: 'n0-u0', day: '2026-06-10', itemCount: 0, hours: []}
    return bucket({
        get: vi.fn(
            async (key: string) =>
                ({
                    size: 1,
                    json: vi.fn(async () =>
                        key === hugeRootKey() ? root : key.includes('/years/') ? year : key.includes('/months/') ? month : day,
                    ),
                }) as unknown as R2ObjectBody,
        ),
    })
}

function reachableLimitBucket(): R2Bucket {
    const blocks = Array.from({length: 4096}, (_, index) => ({
        key: `generations/v1/blocks/n0-u0/2026-06-10T12/${digest(index)}.json`,
        itemCount: 0,
    }))
    const hours = Array.from({length: 25}, (_, index) => ({
        hour: `2026-06-10T${String(index).padStart(2, '0')}`,
        itemCount: 0,
        blocks: blocks.map((block, blockIndex) => ({
            ...block,
            key: block.key
                .replace('T12', `T${String(index).padStart(2, '0')}`)
                .replace(digest(blockIndex), digest(index * 4096 + blockIndex)),
        })),
    }))
    const graph = validGraph()
    ;(graph.values.get(graph.dayKey) as Data).hours = hours
    ;(graph.values.get(graph.dayKey) as Data).itemCount = 0
    return valueBucket(new Map([...graph.values, [hugeRootKey(), graph.values.get(graph.rootKey) as Data]]))
}
