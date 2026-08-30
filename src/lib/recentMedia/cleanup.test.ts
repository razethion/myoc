import {afterEach, describe, expect, it, vi} from 'vitest'
import {queryOne, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {cleanupRecentFeed} from './cleanup'

const db = useTestDatabase()

afterEach(() => {
    vi.restoreAllMocks()
})

describe('recent feed cleanup', () => {
    it('does nothing until cleanup is enabled', async () => {
        const summary = await cleanupRecentFeed({} as never)

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
    })

    it('does not take the publication lease', async () => {
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET lease_owner = 'publisher', lease_expires_at = '2099-01-01 00:00:00'
                 WHERE singleton = 1`,
            )
            .run()
        await seedGenerations(120)
        const bucket = createMockR2Bucket()

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket))

        expect(summary).toEqual({retainedGenerations: 120, deletedGenerations: 0, deletedObjects: 0})
        expect(bucket.get).not.toHaveBeenCalled()
        expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('keeps partial objects during an active bootstrap', async () => {
        await db.prepare('UPDATE recent_feed_state SET bootstrap_revision = 7 WHERE singleton = 1').run()
        const bucket = createMockR2Bucket()

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket))

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
        expect(bucket.list).not.toHaveBeenCalled()
        expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('deletes an expired root and keeps the newest generations', async () => {
        await seedGenerations(100)
        const oldRoot = 'generations/v1/roots/r-old.json'
        await seedGeneration('r-old', oldRoot, '2026-06-01T00:00:00.000Z')
        const bucket = createMockR2Bucket()
        await bucket.put(oldRoot, '{}')

        const summary = await cleanupRecentFeed(
            {...enabledEnvironment(bucket), RECENT_FEED_RETENTION_DAYS: '30'},
            new Date('2026-08-25T12:00:00.000Z'),
        )

        expect(summary).toEqual({retainedGenerations: 100, deletedGenerations: 1, deletedObjects: 1})
        expect(await bucket.get(oldRoot)).toBeNull()
        expect(
            await queryOne<{generation: string}>('SELECT generation FROM recent_feed_generations WHERE generation = ?', ['r-old']),
        ).toBeNull()
    })

    it('keeps the root object unreferenced when R2 deletion fails', async () => {
        await seedGenerations(100)
        const oldRoot = 'generations/v1/roots/r-old.json'
        await seedGeneration('r-old', oldRoot, '2026-06-01T00:00:00.000Z')
        const bucket = createMockR2Bucket()
        await bucket.put(oldRoot, '{}')
        vi.mocked(bucket.delete).mockRejectedValueOnce(new Error('R2 is unavailable'))

        await expect(cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-08-25T12:00:00.000Z'))).rejects.toThrow(
            'R2 is unavailable',
        )

        expect(await bucket.get(oldRoot)).not.toBeNull()
        expect(
            await queryOne<{generation: string}>('SELECT generation FROM recent_feed_generations WHERE generation = ?', ['r-old']),
        ).toBeNull()
    })

    it('keeps the root object when the generation row cannot be deleted', async () => {
        await seedGenerations(100)
        const oldRoot = 'generations/v1/roots/r-old.json'
        await seedGeneration('r-old', oldRoot, '2026-06-01T00:00:00.000Z')
        const bucket = createMockR2Bucket()
        await bucket.put(oldRoot, '{}')
        await db
            .prepare(`CREATE TRIGGER fail_recent_feed_generation_delete
                      BEFORE DELETE ON recent_feed_generations
                      BEGIN
                          SELECT RAISE(ABORT, 'generation delete failed');
                      END`)
            .run()

        try {
            await expect(cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-08-25T12:00:00.000Z'))).rejects.toThrow()

            expect(await bucket.get(oldRoot)).not.toBeNull()
            expect(
                await queryOne<{generation: string}>('SELECT generation FROM recent_feed_generations WHERE generation = ?', ['r-old']),
            ).toEqual({generation: 'r-old'})
        } finally {
            await db.prepare('DROP TRIGGER fail_recent_feed_generation_delete').run()
        }
    })

    it('keeps reachable objects and deletes old orphan objects', async () => {
        const {rootKey, objects, reachableKeys} = retainedObjectGraph()
        await seedGeneration('r1-valid', rootKey, '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()

        for (const [key, value] of objects) {
            await bucket.put(key, JSON.stringify(value))
        }

        const orphanManifest = `generations/v1/manifests/n0-u0/days/2026-06-09/${'e'.repeat(64)}.json`
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-09T12/${'f'.repeat(64)}.json`
        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanManifest, '{}')
        await bucket.put(orphanBlock, '{}')
        await bucket.put(orphanRoot, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 3})
        expect(await bucket.get(orphanManifest)).toBeNull()
        expect(await bucket.get(orphanBlock)).toBeNull()
        expect(await bucket.get(orphanRoot)).toBeNull()
        for (const key of reachableKeys) {
            expect(await bucket.get(key)).not.toBeNull()
        }
    })

    it('does not sweep child objects when a retained root is invalid', async () => {
        const rootKey = 'generations/v1/roots/r1-invalid.json'
        await seedGeneration('r1-invalid', rootKey, '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-10T12/${'f'.repeat(64)}.json`
        await bucket.put(rootKey, '{}')
        await bucket.put(orphanBlock, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanBlock)).not.toBeNull()
    })

    it('does not sweep objects when a retained root key is invalid', async () => {
        await seedGeneration('r1-invalid-key', 'invalid-root-key', '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()
        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanRoot, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanRoot)).not.toBeNull()
    })

    it('does not sweep objects when R2 cannot read a retained root', async () => {
        const rootKey = 'generations/v1/roots/r1-unavailable.json'
        await seedGeneration('r1-unavailable', rootKey, '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()
        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(rootKey, '{}')
        await bucket.put(orphanRoot, '{}')
        const getObject = vi.mocked(bucket.get).getMockImplementation()
        if (!getObject) throw new Error('The mock R2 get implementation is missing')
        vi.mocked(bucket.get).mockImplementation(async (key, options) => {
            if (key === rootKey) throw new Error('R2 is unavailable')
            return await getObject(key, options)
        })

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanRoot)).not.toBeNull()
    })

    it('does not sweep objects when the retained root limit is exceeded', async () => {
        await seedGenerations(2_001)
        const bucket = createMockR2Bucket()
        const emptyRoot = JSON.stringify({
            schemaVersion: 1,
            generation: 'retained',
            throughRevision: 1,
            publishedAt: '2026-08-25T00:00:00.000Z',
            variants: {
                'n0-u0': {itemCount: 0, years: []},
                'n0-u1': {itemCount: 0, years: []},
                'n1-u0': {itemCount: 0, years: []},
                'n1-u1': {itemCount: 0, years: []},
            },
        })
        for (let index = 0; index < 2_001; index += 1) {
            await bucket.put(`generations/v1/roots/r-new-${index}.json`, emptyRoot)
        }
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-10T12/${'f'.repeat(64)}.json`
        await bucket.put(orphanBlock, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-08-25T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 2_001, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanBlock)).not.toBeNull()
    })

    it('keeps new orphan objects during the grace period', async () => {
        const bucket = createMockR2Bucket()
        const newOrphan = 'generations/v1/roots/r-new-orphan.json'
        await bucket.put(newOrphan, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-12T00:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(newOrphan)).not.toBeNull()
    })

    it('does not delete orphans after its cleanup lease is lost', async () => {
        const bucket = createMockR2Bucket()
        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanRoot, '{}')
        const listObjects = vi.mocked(bucket.list).getMockImplementation()
        if (!listObjects) throw new Error('The mock R2 list implementation is missing')
        vi.mocked(bucket.list).mockImplementationOnce(async (options) => {
            const page = await listObjects(options)
            await db
                .prepare(
                    `UPDATE recent_feed_state
                     SET lease_owner = 'publisher', lease_expires_at = '2099-01-01 00:00:00'
                     WHERE singleton = 1`,
                )
                .run()
            return page
        })

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanRoot)).not.toBeNull()
    })

    it('does not sweep objects when R2 returns an incomplete listing page', async () => {
        const bucket = createMockR2Bucket()
        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanRoot, '{}')
        const incompletePage: R2Objects = {
            objects: [],
            truncated: true,
            cursor: 'cursor-that-will-be-removed',
            delimitedPrefixes: [],
        }
        Reflect.deleteProperty(incompletePage, 'cursor')
        vi.mocked(bucket.list).mockResolvedValueOnce(incompletePage)

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanRoot)).not.toBeNull()
    })

    it.each(invalidRetainedGraphCases)('does not sweep objects when $name', async ({mutate}) => {
        const graph = retainedObjectGraph()
        mutate(graph)
        await seedGeneration('r1-valid', graph.rootKey, '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()

        for (const [key, value] of graph.objects) {
            await bucket.put(key, JSON.stringify(value))
        }

        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanRoot, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanRoot)).not.toBeNull()
    })

    it('accepts duplicate references that describe the same manifest', async () => {
        const graph = retainedObjectGraph()
        const variant = n0u0Variant(graph.root)
        const reference = firstFixtureItem(variant.years, 'year reference')
        variant.itemCount = 2
        variant.years.push({...reference})
        await seedGeneration('r1-valid', graph.rootKey, '2026-06-10T12:00:00.000Z')
        const bucket = createMockR2Bucket()

        for (const [key, value] of graph.objects) {
            await bucket.put(key, JSON.stringify(value))
        }

        const orphanRoot = 'generations/v1/roots/r-orphan.json'
        await bucket.put(orphanRoot, '{}')

        const summary = await cleanupRecentFeed(enabledEnvironment(bucket), new Date('2026-06-13T12:00:00.000Z'))

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 1})
        expect(await bucket.get(orphanRoot)).toBeNull()
        for (const key of graph.reachableKeys) {
            expect(await bucket.get(key)).not.toBeNull()
        }
    })
})

function enabledEnvironment(bucket: R2Bucket) {
    return {
        DB: db,
        RECENT_FEED_BUCKET: bucket,
        RECENT_FEED_CLEANUP_ENABLED: 'true',
    }
}

async function seedGenerations(count: number): Promise<void> {
    const statements = Array.from({length: count}, (_, index) => {
        const generation = `r-new-${index}`
        return db
            .prepare(
                `INSERT INTO recent_feed_generations (
                    generation, through_revision, root_key, item_counts_json, object_count, byte_count, published_at
                 ) VALUES (?, 1, ?, '{}', 0, 0, '2026-08-25T00:00:00.000Z')`,
            )
            .bind(generation, `generations/v1/roots/${generation}.json`)
    })
    await db.batch(statements)
}

async function seedGeneration(generation: string, rootKey: string, publishedAt: string): Promise<void> {
    await db
        .prepare(
            `INSERT INTO recent_feed_generations (
                generation, through_revision, root_key, item_counts_json, object_count, byte_count, published_at
             ) VALUES (?, 1, ?, '{}', 0, 0, ?)`,
        )
        .bind(generation, rootKey, publishedAt)
        .run()
}

function retainedObjectGraph(): {
    rootKey: string
    objects: Map<string, unknown>
    reachableKeys: string[]
    root: {
        variants: Record<string, {itemCount: number; years: Array<{year: string; key: string; itemCount: number}>}>
    }
    year: {
        variant: string
        year: string
        itemCount: number
        months: Array<{month: string; key: string; itemCount: number}>
    }
    month: {
        variant: string
        month: string
        itemCount: number
        days: Array<{day: string; key: string; itemCount: number}>
    }
    day: {
        variant: string
        day: string
        itemCount: number
        hours: Array<{hour: string; itemCount: number; blocks: Array<{key: string; itemCount: number}>}>
    }
} {
    const rootKey = 'generations/v1/roots/r1-valid.json'
    const yearKey = `generations/v1/manifests/n0-u0/years/2026/${'a'.repeat(64)}.json`
    const monthKey = `generations/v1/manifests/n0-u0/months/2026-06/${'b'.repeat(64)}.json`
    const dayKey = `generations/v1/manifests/n0-u0/days/2026-06-10/${'c'.repeat(64)}.json`
    const blockKey = `generations/v1/blocks/n0-u0/2026-06-10T12/${'d'.repeat(64)}.json`
    const emptyVariant = {itemCount: 0, years: []}
    const root = {
        schemaVersion: 1,
        generation: 'r1-valid',
        throughRevision: 1,
        publishedAt: '2026-06-10T12:00:00.000Z',
        variants: {
            'n0-u0': {itemCount: 1, years: [{year: '2026', key: yearKey, itemCount: 1}]},
            'n0-u1': emptyVariant,
            'n1-u0': emptyVariant,
            'n1-u1': emptyVariant,
        },
    }
    const year = {
        schemaVersion: 1,
        variant: 'n0-u0',
        year: '2026',
        itemCount: 1,
        months: [{month: '2026-06', key: monthKey, itemCount: 1}],
    }
    const month = {
        schemaVersion: 1,
        variant: 'n0-u0',
        month: '2026-06',
        itemCount: 1,
        days: [{day: '2026-06-10', key: dayKey, itemCount: 1}],
    }
    const day = {
        schemaVersion: 1,
        variant: 'n0-u0',
        day: '2026-06-10',
        itemCount: 1,
        hours: [{hour: '2026-06-10T12', itemCount: 1, blocks: [{key: blockKey, itemCount: 1}]}],
    }

    return {
        rootKey,
        objects: new Map<string, unknown>([
            [rootKey, root],
            [yearKey, year],
            [monthKey, month],
            [dayKey, day],
            [blockKey, {schemaVersion: 1, variant: 'n0-u0', hour: '2026-06-10T12', items: []}],
        ]),
        reachableKeys: [rootKey, yearKey, monthKey, dayKey, blockKey],
        root,
        year,
        month,
        day,
    }
}

type RetainedObjectGraph = ReturnType<typeof retainedObjectGraph>

function n0u0Variant(root: RetainedObjectGraph['root']): RetainedObjectGraph['root']['variants'][string] {
    const variant = root.variants['n0-u0']
    if (!variant) throw new Error('The retained graph fixture is missing the n0-u0 variant')
    return variant
}

function firstFixtureItem<T>(items: T[], name: string): T {
    const item = items[0]
    if (!item) throw new Error(`The retained graph fixture is missing its ${name}`)
    return item
}

const invalidRetainedGraphCases: Array<{name: string; mutate: (graph: RetainedObjectGraph) => void}> = [
    {
        name: 'a root item count does not match its year references',
        mutate: ({root}) => {
            n0u0Variant(root).itemCount = 2
        },
    },
    {
        name: 'a root uses an invalid year manifest key',
        mutate: ({root}) => {
            firstFixtureItem(n0u0Variant(root).years, 'year reference').key = 'generations/v1/manifests/n0-u0/years/2026/not-a-digest.json'
        },
    },
    {
        name: 'two root references disagree about one manifest',
        mutate: ({root}) => {
            const variant = n0u0Variant(root)
            const reference = firstFixtureItem(variant.years, 'year reference')
            variant.itemCount = 3
            variant.years.push({...reference, itemCount: 2})
        },
    },
    {
        name: 'a year manifest has the wrong variant',
        mutate: ({year}) => {
            year.variant = 'n0-u1'
        },
    },
    {
        name: 'a month falls outside its year manifest',
        mutate: ({year}) => {
            firstFixtureItem(year.months, 'month reference').month = '2025-06'
        },
    },
    {
        name: 'a year manifest uses an invalid month manifest key',
        mutate: ({year}) => {
            firstFixtureItem(year.months, 'month reference').key = 'generations/v1/manifests/n0-u0/months/2026-06/not-a-digest.json'
        },
    },
    {
        name: 'a month manifest has the wrong month',
        mutate: ({month}) => {
            month.month = '2026-07'
        },
    },
    {
        name: 'a day falls outside its month manifest',
        mutate: ({month}) => {
            firstFixtureItem(month.days, 'day reference').day = '2026-07-10'
        },
    },
    {
        name: 'a month manifest uses an invalid day manifest key',
        mutate: ({month}) => {
            firstFixtureItem(month.days, 'day reference').key = 'generations/v1/manifests/n0-u0/days/2026-06-10/not-a-digest.json'
        },
    },
    {
        name: 'a day manifest has the wrong day',
        mutate: ({day}) => {
            day.day = '2026-06-11'
        },
    },
    {
        name: 'an hour falls outside its day manifest',
        mutate: ({day}) => {
            firstFixtureItem(day.hours, 'hour reference').hour = '2026-06-11T12'
        },
    },
    {
        name: 'an hour item count does not match its block references',
        mutate: ({day}) => {
            firstFixtureItem(day.hours, 'hour reference').itemCount = 2
        },
    },
    {
        name: 'a day manifest uses an invalid block key',
        mutate: ({day}) => {
            const hour = firstFixtureItem(day.hours, 'hour reference')
            firstFixtureItem(hour.blocks, 'block reference').key = 'generations/v1/blocks/n0-u0/2026-06-10T12/not-a-digest.json'
        },
    },
]
