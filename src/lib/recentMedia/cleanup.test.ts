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
    }
}
