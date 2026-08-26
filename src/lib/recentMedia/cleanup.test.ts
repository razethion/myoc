import {afterEach, describe, expect, it, vi} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import {resetWorkerBindings} from '../../test/workerBindings'
import {cleanupRecentFeed} from './cleanup'

const CLEANUP_OWNER = 'cleanup:00000000-0000-4000-8000-000000000000'

afterEach(async () => {
    vi.restoreAllMocks()
    await resetWorkerBindings()
})

describe('recent feed cleanup', () => {
    it('does nothing until the cleanup switch is enabled', async () => {
        const summary = await cleanupRecentFeed({} as never)

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
    })

    it('stops when publication owns the lease', async () => {
        mockCleanupOwner()
        const {db} = createMockDb({firstResults: [{lease_owner: 'publisher'}, {count: 120}]})
        const bucket = createMockR2Bucket()

        const summary = await cleanupRecentFeed({
            DB: db,
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_CLEANUP_ENABLED: 'true',
        })

        expect(summary).toEqual({retainedGenerations: 120, deletedGenerations: 0, deletedObjects: 0})
        expect(bucket.get).not.toHaveBeenCalled()
        expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('keeps partial objects while a bootstrap is active', async () => {
        mockCleanupOwner()
        const {db} = createMockDb({
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: 7}, {count: 0}],
        })
        const bucket = createMockR2Bucket()

        const summary = await cleanupRecentFeed({
            DB: db,
            RECENT_FEED_BUCKET: bucket,
            RECENT_FEED_CLEANUP_ENABLED: 'true',
        })

        expect(summary).toEqual({retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0})
        expect(bucket.list).not.toHaveBeenCalled()
        expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('deletes expired roots and scans all shared object prefixes', async () => {
        mockCleanupOwner()
        const {db, boundStatements} = createMockDb({
            allResults: [[{generation: 'r1-old', root_key: 'generations/v1/roots/r1-old-secret.json'}], []],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}, {count: 100}, {lease_owner: CLEANUP_OWNER}],
        })
        const bucket = createMockR2Bucket()
        await bucket.put('generations/v1/roots/r1-old-secret.json', '{}')
        const now = new Date('2026-08-25T12:00:00.000Z')

        const summary = await cleanupRecentFeed(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CLEANUP_ENABLED: 'true',
                RECENT_FEED_RETENTION_DAYS: '30',
            },
            now,
        )

        expect(summary).toEqual({retainedGenerations: 100, deletedGenerations: 1, deletedObjects: 1})
        expect(bucket.delete).toHaveBeenCalledWith(['generations/v1/roots/r1-old-secret.json'])
        expect(boundStatements.find((statement) => statement.sql.includes('published_at < ?'))?.binds).toEqual([
            '2026-07-26T12:00:00.000Z',
            100,
            5000,
        ])
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM recent_feed_generations'))).toBe(true)
        expect(vi.mocked(bucket.list).mock.calls.map(([options]) => options?.prefix)).toEqual([
            'generations/v1/manifests/',
            'generations/v1/blocks/',
            'generations/v1/bootstrap/',
        ])
    })

    it('keeps the D1 row when an expired root cannot be deleted', async () => {
        mockCleanupOwner()
        const {db, boundStatements} = createMockDb({
            allResults: [[{generation: 'r1-old', root_key: 'generations/v1/roots/r1-old-secret.json'}]],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}],
        })
        const bucket = createMockR2Bucket()
        vi.mocked(bucket.delete).mockRejectedValueOnce(new Error('R2 is unavailable'))

        await expect(
            cleanupRecentFeed(
                {
                    DB: db,
                    RECENT_FEED_BUCKET: bucket,
                    RECENT_FEED_CLEANUP_ENABLED: 'true',
                },
                new Date('2026-08-25T12:00:00.000Z'),
            ),
        ).rejects.toThrow('R2 is unavailable')

        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM recent_feed_generations'))).toBe(false)
    })

    it('keeps reachable objects and deletes old orphan objects', async () => {
        mockCleanupOwner()
        const {rootKey, objects, reachableKeys} = retainedObjectGraph()
        const {db} = createMockDb({
            allResults: [[], [{root_key: rootKey}]],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}, {count: 1}, {lease_owner: CLEANUP_OWNER}],
        })
        const bucket = createMockR2Bucket()

        for (const [key, value] of objects) {
            await bucket.put(key, JSON.stringify(value))
        }

        const orphanManifest = `generations/v1/manifests/n0-u0/days/2026-06-09/${'e'.repeat(64)}.json`
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-09T12/${'f'.repeat(64)}.json`
        await bucket.put(orphanManifest, '{}')
        await bucket.put(orphanBlock, '{}')

        const summary = await cleanupRecentFeed(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CLEANUP_ENABLED: 'true',
            },
            new Date('2026-06-13T12:00:00.000Z'),
        )

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 2})
        expect(await bucket.get(orphanManifest)).toBeNull()
        expect(await bucket.get(orphanBlock)).toBeNull()

        for (const key of reachableKeys) {
            expect(await bucket.get(key)).not.toBeNull()
        }
    })

    it('keeps fresh orphan objects inside the grace period', async () => {
        mockCleanupOwner()
        const {db} = createMockDb({
            allResults: [[], []],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}, {count: 0}, {lease_owner: CLEANUP_OWNER}],
        })
        const bucket = createMockR2Bucket()
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-10T12/${'f'.repeat(64)}.json`
        await bucket.put(orphanBlock, '{}')

        const summary = await cleanupRecentFeed(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CLEANUP_ENABLED: 'true',
            },
            new Date('2026-06-11T12:00:00.000Z'),
        )

        expect(summary.deletedObjects).toBe(0)
        expect(await bucket.get(orphanBlock)).not.toBeNull()
    })

    it('does not sweep child objects when a retained root is invalid', async () => {
        mockCleanupOwner()
        const rootKey = 'generations/v1/roots/r1-invalid.json'
        const {db} = createMockDb({
            allResults: [[], [{root_key: rootKey}]],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}, {count: 1}],
        })
        const bucket = createMockR2Bucket()
        const orphanBlock = `generations/v1/blocks/n0-u0/2026-06-10T12/${'f'.repeat(64)}.json`
        await bucket.put(rootKey, '{}')
        await bucket.put(orphanBlock, '{}')

        const summary = await cleanupRecentFeed(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CLEANUP_ENABLED: 'true',
            },
            new Date('2026-06-13T12:00:00.000Z'),
        )

        expect(summary).toEqual({retainedGenerations: 1, deletedGenerations: 0, deletedObjects: 0})
        expect(await bucket.get(orphanBlock)).not.toBeNull()
        expect(bucket.list).not.toHaveBeenCalled()
    })

    it('keeps D1 deletion batches within the parameter limit', async () => {
        mockCleanupOwner()
        const generations = Array.from({length: 101}, (_, index) => ({
            generation: `r${index}-old`,
            root_key: `generations/v1/roots/r${index}-old-secret.json`,
        }))
        const {db, boundStatements} = createMockDb({
            allResults: [generations, []],
            firstResults: [{lease_owner: CLEANUP_OWNER}, {bootstrap_revision: null}, {count: 100}, {lease_owner: CLEANUP_OWNER}],
        })
        const bucket = createMockR2Bucket()

        await cleanupRecentFeed(
            {
                DB: db,
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CLEANUP_ENABLED: 'true',
            },
            new Date('2026-08-25T12:00:00.000Z'),
        )

        const deleteStatements = boundStatements.filter((statement) => statement.sql.includes('DELETE FROM recent_feed_generations'))
        expect(deleteStatements.map((statement) => statement.binds.length)).toEqual([100, 1])
        expect(bucket.delete).toHaveBeenCalledTimes(2)
    })
})

function mockCleanupOwner(): void {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000')
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
        reachableKeys: [yearKey, monthKey, dayKey, blockKey],
    }
}
