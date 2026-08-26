import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import type {RecentMediaRow} from '../recentMedia'
import {RECENT_FEED_SCHEMA_VERSION, RECENT_FEED_VARIANTS} from './config'
import {buildRecentFeedVariantTree, getRecentFeedPointer, publishRecentFeed} from './publisher'

type State = {
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

type BootstrapSegment = {
    hour: string
    previousKey: string | null
    variants: Record<(typeof RECENT_FEED_VARIANTS)[number], {blockCount: number; blocks: {itemCount: number}[]; pendingItems: unknown[]}>
}

describe('recent feed publisher coverage', () => {
    it('returns disabled before it uses D1 and reports a busy publisher', async () => {
        await expect(publishRecentFeed({RECENT_FEED_PUBLISH_ENABLED: 'false'} as never)).resolves.toEqual({status: 'disabled'})

        const harness = createDb({lease_owner: 'other', lease_expires_at: '2099-01-01 00:00:00'})
        const result = await publishRecentFeed(envFor(harness), {force: true})

        expect(result).toEqual({status: 'busy'})
    })

    it('returns the current generation and reads validated cache pointers before D1', async () => {
        const harness = createDb({
            generation: 'r4-old',
            root_key: 'roots/old.json',
            published_at: '2026-08-25T12:00:00.000Z',
            published_revision: 4,
        })
        await expect(publishRecentFeed(envFor(harness))).resolves.toEqual({status: 'current', generation: 'r4-old', revision: 4})

        const pointer = {generation: 'r4-old', rootKey: 'roots/old.json', publishedAt: '2026-08-25T12:00:00.000Z', throughRevision: 4}
        const cache = {get: vi.fn(async () => pointer)}
        await expect(getRecentFeedPointer(harness.db, cache as never)).resolves.toEqual(pointer)
        expect(cache.get).toHaveBeenCalledOnce()
    })

    it('falls back from bad and unavailable cache values to the D1 pointer', async () => {
        const harness = createDb({
            generation: 'r2-live',
            root_key: 'roots/live.json',
            published_at: '2026-08-25T12:00:00.000Z',
            published_revision: 2,
        })
        const invalid = {get: vi.fn(async () => ({generation: 2}))}
        const unavailable = {get: vi.fn(async () => Promise.reject(new Error('KV unavailable')))}
        const expected = {generation: 'r2-live', rootKey: 'roots/live.json', publishedAt: '2026-08-25T12:00:00.000Z', throughRevision: 2}

        await expect(getRecentFeedPointer(harness.db, invalid as never)).resolves.toEqual(expected)
        await expect(getRecentFeedPointer(harness.db, unavailable as never)).resolves.toEqual(expected)

        const empty = createDb({generation: null, root_key: null, published_at: null})
        await expect(getRecentFeedPointer(empty.db)).resolves.toBeNull()
    })

    it('publishes a full normal revision and tolerates an unavailable pointer cache', async () => {
        const harness = createDb(
            {requested_revision: 2, published_revision: 1},
            [{dirty_hour: '*', revision: 2, urgent: 0}],
            [recentRow('media-1')],
        )
        const cache = {put: vi.fn(async () => Promise.reject(new Error('KV unavailable')))}
        const result = await publishRecentFeed({...envFor(harness), CACHE: cache as never}, {now: new Date('2026-08-25T13:00:00.000Z')})

        expect(result).toMatchObject({status: 'published', revision: 2, dirtyHours: 1})
        expect(harness.state.published_revision).toBe(2)
        expect(harness.state.generation).toMatch(/^r2-/)
        expect(harness.dirtyRows).toEqual([])
        expect(cache.put).toHaveBeenCalledOnce()
        expect(harness.state.lease_owner).toBeNull()
    })

    it('reuses an already written normal root on a safe retry', async () => {
        const harness = createDb(
            {requested_revision: 2, published_revision: 1},
            [{dirty_hour: '*', revision: 2, urgent: 0}],
            [recentRow('retry')],
        )
        const bucket = createMockR2Bucket()
        const now = new Date('2026-08-25T13:00:00.000Z')
        await expect(publishRecentFeed({...envFor(harness), RECENT_FEED_BUCKET: bucket}, {now})).resolves.toMatchObject({
            status: 'published',
        })

        harness.state.published_revision = 1
        await expect(publishRecentFeed({...envFor(harness), RECENT_FEED_BUCKET: bucket}, {now})).resolves.toMatchObject({
            status: 'published',
        })
    })

    it('publishes only a dirty normal branch from a previous root', async () => {
        const bucket = createMockR2Bucket()
        const oldRow = recentRow('old')
        const newRow = recentRow('new')
        const variants = {} as Record<(typeof RECENT_FEED_VARIANTS)[number], {itemCount: number; years: unknown[]}>
        for (const variant of RECENT_FEED_VARIANTS) {
            variants[variant] = await buildRecentFeedVariantTree(
                bucket,
                variant,
                {itemCount: 0, years: []},
                new Map([['2026-08-24T12', [oldRow]]]),
                true,
                'https://m.myoc.art',
                24,
                'public, max-age=60, immutable',
                {objectsWritten: 0, bytesWritten: 0},
            )
        }
        const oldRoot = {
            schemaVersion: RECENT_FEED_SCHEMA_VERSION,
            generation: 'r1-old',
            throughRevision: 1,
            publishedAt: '2026-08-24T13:00:00.000Z',
            variants,
        }
        await bucket.put('roots/old.json', JSON.stringify(oldRoot))
        const harness = createDb(
            {
                requested_revision: 2,
                published_revision: 1,
                generation: 'r1-old',
                root_key: 'roots/old.json',
                published_at: oldRoot.publishedAt,
            },
            [{dirty_hour: '2026-08-25T12', revision: 2, urgent: 0}],
            [newRow],
        )
        const result = await publishRecentFeed(
            {...envFor(harness), RECENT_FEED_BUCKET: bucket},
            {now: new Date('2026-08-25T13:00:00.000Z')},
        )

        expect(result).toMatchObject({status: 'published', revision: 2, dirtyHours: 1})
        expect(result.itemCounts?.['n0-u1']).toBe(1)
    })

    it('records the publication error and releases its lease', async () => {
        const harness = createDb({requested_revision: 2, published_revision: 1}, [{dirty_hour: '*', revision: 2, urgent: 0}], [], {
            sourceError: new Error('source failed'),
        })

        await expect(publishRecentFeed(envFor(harness))).rejects.toThrow('source failed')
        expect(harness.lastError).toBe('source failed')
        expect(harness.state.lease_owner).toBeNull()
    })

    it('rejects missing, inconsistent, and lost bootstrap state', async () => {
        const roots = JSON.stringify({
            'n0-u0': {itemCount: 0, years: []},
            'n0-u1': {itemCount: 0, years: []},
            'n1-u0': {itemCount: 0, years: []},
            'n1-u1': {itemCount: 0, years: []},
        })
        const missing = createDb({}, [], [], {missingState: true})
        await expect(getRecentFeedPointer(missing.db)).rejects.toThrow('migration is not applied')

        const missingRoots = createDb({root_key: null, bootstrap_revision: 1, bootstrap_variant_roots_json: null})
        await expect(publishRecentFeed(envFor(missingRoots))).rejects.toThrow('roots are missing')

        const invalidCursor = createDb({
            root_key: null,
            bootstrap_revision: 1,
            bootstrap_variant_roots_json: roots,
            bootstrap_cursor_created_at: '2026-08-25 12:00:00',
        })
        await expect(publishRecentFeed(envFor(invalidCursor))).rejects.toThrow('cursor is invalid')

        const invalidState = createDb({root_key: 'roots/old.json', bootstrap_revision: 1, bootstrap_variant_roots_json: roots})
        await expect(publishRecentFeed(envFor(invalidState))).rejects.toThrow('bootstrap state is invalid')

        const lostLease = createDb(
            {requested_revision: 2, published_revision: 1},
            [{dirty_hour: '*', revision: 2, urgent: 0}],
            [recentRow('lost')],
            {lostLease: true},
        )
        await expect(publishRecentFeed(envFor(lostLease))).rejects.toThrow('lease was lost')
    })

    it('rejects invalid tree inputs and stale tree references', async () => {
        const bucket = createMockR2Bucket()
        const metrics = {objectsWritten: 0, bytesWritten: 0}

        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 1, years: []},
                new Map(),
                false,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('root count is invalid')
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 0, years: []},
                new Map([['bad', []]]),
                true,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('dirty hour is invalid')
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 0, years: [{year: '2026', key: 'missing.json', itemCount: 0}]},
                new Map([['2026-08-25T12', [recentRow('media')]]]),
                false,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('object is missing')
    })

    it('rejects a publisher checkpoint that D1 did not accept', async () => {
        const harness = createDb(
            {requested_revision: 2, published_revision: 1},
            [{dirty_hour: '*', revision: 2, urgent: 0}],
            [recentRow('changed')],
            {checkpointRejected: true},
        )

        await expect(publishRecentFeed(envFor(harness))).rejects.toThrow('changed during publication')
        expect(harness.lastError).toBe('Recent feed changed during publication')
    })

    it('rejects a bootstrap start that D1 did not accept', async () => {
        const harness = createDb({root_key: null, generation: null, published_at: null, published_revision: 0}, [], [], {
            bootstrapStartRejected: true,
        })

        await expect(publishRecentFeed(envFor(harness))).rejects.toThrow('bootstrap could not start')
    })

    it('finalizes bootstrap hours and publishes the initial root', async () => {
        const older = {...recentRow('older'), created_at: '2026-08-25 11:30:00', updated_at: '2026-08-25 11:30:00'}
        const harness = createDb(
            {root_key: null, generation: null, published_at: null, published_revision: 0},
            [],
            [recentRow('newer'), older],
        )
        const cache = {put: vi.fn(async () => Promise.reject(new Error('cache unavailable')))}

        const result = await publishRecentFeed({...envFor(harness), CACHE: cache as never}, {now: new Date('2026-08-25T13:00:00.000Z')})

        expect(result).toMatchObject({status: 'published', revision: 1, dirtyHours: 2, bootstrapRows: 2})
        expect(harness.state.bootstrap_revision).toBeNull()
        expect(cache.put).toHaveBeenCalledOnce()
    })

    it('reports initial checkpoint conflicts and release failures without hiding the publication error', async () => {
        const conflicting = createDb(
            {root_key: null, generation: null, published_at: null, published_revision: 0},
            [],
            [recentRow('initial')],
            {checkpointRejected: true, releaseError: true},
        )

        await expect(publishRecentFeed(envFor(conflicting))).rejects.toThrow('changed during publication')
        expect(conflicting.lastError).toBe('Recent feed changed during publication')
    })

    it('enforces the per-hour block format limit', async () => {
        const rows = Array.from({length: 4097}, (_, index) => recentRow(`limit-${index}`))

        await expect(
            buildRecentFeedVariantTree(
                createMockR2Bucket(),
                'n0-u1',
                {itemCount: 0, years: []},
                new Map([['2026-08-25T12', rows]]),
                true,
                'https://m.myoc.art',
                1,
                'cache',
                {objectsWritten: 0, bytesWritten: 0},
            ),
        ).rejects.toThrow('4096-block format limit')
    })

    it('rejects invalid bootstrap checkpoint contents and chains', async () => {
        const invalid = await bootstrapProgress(1001)
        const invalidSegment = await checkpointSegment(invalid.bucket, invalid.harness.state.bootstrap_active_key)
        invalidSegment.variants['n0-u0'].pendingItems = Array.from({length: 24}, () => invalidSegment.variants['n0-u0'].pendingItems[0])
        await invalid.bucket.put('bootstrap-invalid.json', JSON.stringify(invalidSegment))
        invalid.harness.state.bootstrap_active_key = 'bootstrap-invalid.json'
        await expect(publishRecentFeed({...envFor(invalid.harness), RECENT_FEED_BUCKET: invalid.bucket})).rejects.toThrow(
            'checkpoint is invalid',
        )

        const cycle = await bootstrapProgress(1001)
        const cycleSegment = await checkpointSegment(cycle.bucket, cycle.harness.state.bootstrap_active_key)
        cycleSegment.previousKey = 'bootstrap-cycle.json'
        await cycle.bucket.put('bootstrap-cycle.json', JSON.stringify(cycleSegment))
        cycle.harness.state.bootstrap_active_key = 'bootstrap-cycle.json'
        await expect(publishRecentFeed({...envFor(cycle.harness), RECENT_FEED_BUCKET: cycle.bucket})).rejects.toThrow(
            'checkpoint chain is invalid',
        )

        const wrongHour = await bootstrapProgress(1001)
        const wrongHourSegment = await checkpointSegment(wrongHour.bucket, wrongHour.harness.state.bootstrap_active_key)
        const prior = {...wrongHourSegment, previousKey: null}
        await wrongHour.bucket.put('bootstrap-other-hour.json', JSON.stringify(prior))
        wrongHourSegment.hour = '2026-08-25T11'
        wrongHourSegment.previousKey = 'bootstrap-other-hour.json'
        await wrongHour.bucket.put('bootstrap-wrong-hour.json', JSON.stringify(wrongHourSegment))
        wrongHour.harness.state.bootstrap_active_key = 'bootstrap-wrong-hour.json'
        await expect(publishRecentFeed({...envFor(wrongHour.harness), RECENT_FEED_BUCKET: wrongHour.bucket})).rejects.toThrow(
            'does not match its hour',
        )
    })

    it('rejects bootstrap block count conflicts and its block limit', async () => {
        const invalidCounts = await bootstrapProgress(1001)
        const countSegment = await checkpointSegment(invalidCounts.bucket, invalidCounts.harness.state.bootstrap_active_key)
        const firstBlock = countSegment.variants['n0-u0'].blocks[0]
        if (!firstBlock) throw new Error('Bootstrap checkpoint has no blocks')
        firstBlock.itemCount = 0
        await invalidCounts.bucket.put('bootstrap-counts.json', JSON.stringify(countSegment))
        invalidCounts.harness.state.bootstrap_active_key = 'bootstrap-counts.json'
        await expect(publishRecentFeed({...envFor(invalidCounts.harness), RECENT_FEED_BUCKET: invalidCounts.bucket})).rejects.toThrow(
            'block counts are invalid',
        )

        const limit = await bootstrapProgress(1008)
        const limitSegment = await checkpointSegment(limit.bucket, limit.harness.state.bootstrap_active_key)
        for (const variant of RECENT_FEED_VARIANTS) limitSegment.variants[variant].blockCount = 4096
        await limit.bucket.put('bootstrap-limit.json', JSON.stringify(limitSegment))
        limit.harness.state.bootstrap_active_key = 'bootstrap-limit.json'
        await expect(publishRecentFeed({...envFor(limit.harness), RECENT_FEED_BUCKET: limit.bucket})).rejects.toThrow(
            '4096-block format limit',
        )
    })

    it('covers bootstrap limits, checkpoint rejection, and checkpoint cleanup failure', async () => {
        const rejected = createDb({root_key: null, generation: null, published_at: null, published_revision: 0}, [], checkpointRows(1001), {
            bootstrapCheckpointRejected: true,
        })
        await expect(publishRecentFeed(envFor(rejected))).rejects.toThrow('checkpoint was rejected')

        const cleanup = await bootstrapProgress(1001)
        cleanup.bucket.delete = vi.fn(async () => Promise.reject(new Error('delete failed')))
        await expect(publishRecentFeed({...envFor(cleanup.harness), RECENT_FEED_BUCKET: cleanup.bucket})).resolves.toMatchObject({
            status: 'published',
        })

        const manyHours = Array.from({length: 25}, (_, index) => {
            const day = index === 24 ? '2026-08-24' : '2026-08-25'
            const hour = index === 24 ? 23 : 23 - index
            return {...recentRow(`hour-${index}`), created_at: `${day} ${String(hour).padStart(2, '0')}:30:00`}
        })
        const limited = createDb({root_key: null, generation: null, published_at: null, published_revision: 0}, [], manyHours)
        await expect(publishRecentFeed(envFor(limited))).resolves.toMatchObject({status: 'building', dirtyHours: 24})
    })

    it('rejects bootstrap roots that exceed the D1 checkpoint size', async () => {
        const years = Array.from({length: 8000}, (_, index) => ({year: '2026', key: `roots/${index}.json`, itemCount: 0}))
        const roots = JSON.stringify(Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, {itemCount: 0, years}])))
        const harness = createDb({root_key: null, bootstrap_revision: 1, bootstrap_variant_roots_json: roots}, [], checkpointRows(1001))

        await expect(publishRecentFeed(envFor(harness))).rejects.toThrow('exceed the 1 MiB D1 checkpoint limit')
    })

    it('rejects invalid existing year, month, and day manifests', async () => {
        const bucket = createMockR2Bucket()
        const metrics = {objectsWritten: 0, bytesWritten: 0}
        await bucket.put('year.json', JSON.stringify({schemaVersion: 1, variant: 'n0-u1', year: '2026', itemCount: 0, months: []}))
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 0, years: [{year: '2026', key: 'year.json', itemCount: 0}]},
                new Map([['2026-08-25T12', []]]),
                false,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('year manifest does not match')

        await bucket.put(
            'year-month.json',
            JSON.stringify({
                schemaVersion: 1,
                variant: 'n0-u0',
                year: '2026',
                itemCount: 0,
                months: [{month: '2026-08', key: 'month.json', itemCount: 0}],
            }),
        )
        await bucket.put('month.json', JSON.stringify({schemaVersion: 1, variant: 'n0-u1', month: '2026-08', itemCount: 0, days: []}))
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 0, years: [{year: '2026', key: 'year-month.json', itemCount: 0}]},
                new Map([['2026-08-25T12', []]]),
                false,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('month manifest does not match')

        await bucket.put(
            'year-day.json',
            JSON.stringify({
                schemaVersion: 1,
                variant: 'n0-u0',
                year: '2026',
                itemCount: 0,
                months: [{month: '2026-08', key: 'month-day.json', itemCount: 0}],
            }),
        )
        await bucket.put(
            'month-day.json',
            JSON.stringify({
                schemaVersion: 1,
                variant: 'n0-u0',
                month: '2026-08',
                itemCount: 0,
                days: [{day: '2026-08-25', key: 'day.json', itemCount: 0}],
            }),
        )
        await bucket.put('day.json', JSON.stringify({schemaVersion: 1, variant: 'n0-u1', day: '2026-08-25', itemCount: 0, hours: []}))
        await expect(
            buildRecentFeedVariantTree(
                bucket,
                'n0-u0',
                {itemCount: 0, years: [{year: '2026', key: 'year-day.json', itemCount: 0}]},
                new Map([['2026-08-25T12', []]]),
                false,
                'https://m.myoc.art',
                24,
                'cache',
                metrics,
            ),
        ).rejects.toThrow('day manifest does not match')
    })

    it('handles an empty source page entry defensively', async () => {
        const roots = JSON.stringify(Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, {itemCount: 0, years: []}])))
        const harness = createDb({root_key: null, bootstrap_revision: 1, bootstrap_variant_roots_json: roots}, [], [
            undefined,
        ] as unknown as RecentMediaRow[])
        await expect(publishRecentFeed(envFor(harness))).resolves.toMatchObject({status: 'published', bootstrapRows: 0})
    })

    it('uses empty D1 result sets and preserves non-Error failures', async () => {
        const noDirtyResult = createDb({requested_revision: 2, published_revision: 1}, [], [], {nullDirtyResult: true})
        await expect(publishRecentFeed(envFor(noDirtyResult))).rejects.toThrow('object is missing')

        const stringFailure = createDb({requested_revision: 2, published_revision: 1}, [{dirty_hour: '*', revision: 2, urgent: 0}], [], {
            sourceError: 'database failed',
        })
        await expect(publishRecentFeed(envFor(stringFailure))).rejects.toBe('database failed')
        expect(stringFailure.lastError).toBe('Unknown recent feed publication error')
    })

    it('does not overwrite a bootstrap checkpoint that already exists', async () => {
        const harness = createDb({root_key: null, generation: null, published_at: null, published_revision: 0}, [], checkpointRows(1001))
        const bucket = createMockR2Bucket()
        bucket.head = vi.fn(async () => ({key: 'existing'}) as unknown as R2Object)

        await expect(publishRecentFeed({...envFor(harness), RECENT_FEED_BUCKET: bucket})).resolves.toMatchObject({status: 'building'})
    })

    it('sorts multiple manifest months and years', async () => {
        const bucket = createMockR2Bucket()
        const root = await buildRecentFeedVariantTree(
            bucket,
            'n0-u1',
            {itemCount: 0, years: []},
            new Map([
                ['2026-08-25T12', [recentRow('august')]],
                ['2026-07-25T12', [recentRow('july')]],
                ['2025-12-25T12', [recentRow('prior-year')]],
            ]),
            true,
            'https://m.myoc.art',
            24,
            'cache',
            {objectsWritten: 0, bytesWritten: 0},
        )

        expect(root.years.map((year) => year.year)).toEqual(['2026', '2025'])
    })

    it('covers null cache entries and null current generations', async () => {
        const current = createDb({generation: null, requested_revision: 1, published_revision: 1})
        await expect(publishRecentFeed(envFor(current))).resolves.toEqual({status: 'current', revision: 1})
        await expect(getRecentFeedPointer(current.db, {get: vi.fn(async () => null)} as never)).resolves.toBeNull()
    })
})

async function bootstrapProgress(count: number) {
    const rows = checkpointRows(count)
    const harness = createDb({root_key: null, generation: null, published_at: null, published_revision: 0}, [], rows)
    const bucket = createMockR2Bucket()
    await expect(publishRecentFeed({...envFor(harness), RECENT_FEED_BUCKET: bucket})).resolves.toMatchObject({status: 'building'})
    return {bucket, harness}
}

function checkpointRows(count: number): RecentMediaRow[] {
    return Array.from({length: count}, (_, index) => recentRow(`checkpoint-${String(count - index).padStart(4, '0')}`))
}

async function checkpointSegment(bucket: R2Bucket, key: string | null): Promise<BootstrapSegment> {
    expect(key).toBeTruthy()
    const object = await bucket.get(key ?? '')
    expect(object).not.toBeNull()
    if (!object) throw new Error('Bootstrap checkpoint is missing')
    return await object.json<BootstrapSegment>()
}

function envFor(harness: ReturnType<typeof createDb>) {
    return {
        DB: harness.db,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        RECENT_FEED_BLOCK_ITEMS: '24',
        RECENT_FEED_BUCKET: createMockR2Bucket(),
        RECENT_FEED_PUBLISH_ENABLED: 'true',
    }
}

function createDb(
    changes: Partial<State> = {},
    dirtyRows: {dirty_hour: string; revision: number; urgent: number}[] = [],
    rows: RecentMediaRow[] = [],
    options: {
        bootstrapStartRejected?: boolean
        bootstrapCheckpointRejected?: boolean
        checkpointRejected?: boolean
        lostLease?: boolean
        missingState?: boolean
        nullDirtyResult?: boolean
        releaseError?: boolean
        sourceError?: unknown
    } = {},
) {
    const state: State = {
        requested_revision: 1,
        published_revision: 1,
        generation: 'r1-old',
        root_key: 'roots/old.json',
        published_at: '2026-08-24T13:00:00.000Z',
        lease_owner: null,
        lease_expires_at: null,
        bootstrap_revision: null,
        bootstrap_cursor_created_at: null,
        bootstrap_cursor_id: null,
        bootstrap_variant_roots_json: null,
        bootstrap_active_key: null,
        bootstrap_objects_written: 0,
        bootstrap_bytes_written: 0,
        ...changes,
    }
    let lastError: string | null = null

    const execute = (sql: string, binds: unknown[]) => {
        if (sql.includes('SET lease_owner = NULL')) {
            state.lease_owner = null
            state.lease_expires_at = null
        } else if (sql.includes('SET lease_owner = ?')) {
            if (!state.lease_owner || state.lease_owner === binds[0]) {
                state.lease_owner = String(binds[0])
                state.lease_expires_at = '2099-01-01 00:00:00'
            }
        } else if (sql.includes('SET lease_expires_at =')) {
            state.lease_expires_at = options.lostLease ? null : '2099-01-01 00:00:00'
        } else if (sql.includes('SET last_error = ?')) {
            lastError = String(binds[0])
        } else if (sql.includes('SET bootstrap_revision = ?')) {
            if (!options.bootstrapStartRejected) {
                state.bootstrap_revision = Number(binds[0])
                state.bootstrap_variant_roots_json = String(binds[1])
            }
        } else if (sql.includes('SET bootstrap_cursor_created_at = ?')) {
            if (!options.bootstrapCheckpointRejected) {
                state.bootstrap_cursor_created_at = binds[0] as string | null
                state.bootstrap_cursor_id = binds[1] as string | null
                state.bootstrap_variant_roots_json = String(binds[2])
                state.bootstrap_active_key = binds[3] as string | null
                state.bootstrap_objects_written = Number(binds[4])
                state.bootstrap_bytes_written = Number(binds[5])
            }
        } else if (sql.includes('SET published_revision = ?')) {
            if (options.checkpointRejected) return
            state.published_revision = Number(binds[0])
            state.generation = String(binds[1])
            state.root_key = String(binds[2])
            state.published_at = String(binds[3])
            state.bootstrap_revision = null
            state.bootstrap_cursor_created_at = null
            state.bootstrap_cursor_id = null
            state.bootstrap_variant_roots_json = null
            state.bootstrap_active_key = null
        } else if (sql.includes('DELETE FROM recent_feed_dirty_hours')) {
            const revision = Number(binds[0])
            dirtyRows.splice(0, dirtyRows.length, ...dirtyRows.filter((row) => row.revision > revision))
        }
    }
    const prepare = (sql: string) => ({
        bind: (...binds: unknown[]) => ({
            all: async () => {
                if (sql.includes('recent_feed_dirty_hours')) return {results: options.nullDirtyResult ? undefined : dirtyRows}
                if (!sql.includes('FROM character_media')) return {results: []}
                if (options.sourceError) throw options.sourceError
                if (sql.includes('LIMIT ?')) {
                    const limit = Number(binds.at(-1))
                    if (binds.length === 4) {
                        const createdAt = String(binds[0])
                        const id = String(binds[2])
                        return {
                            results: rows
                                .filter((row) => row.created_at < createdAt || (row.created_at === createdAt && row.id < id))
                                .slice(0, limit),
                        }
                    }
                    return {results: rows.slice(0, limit)}
                }
                if (binds.length === 2) {
                    const hour = String(binds[0]).slice(0, 13)
                    return {results: rows.filter((row) => row.created_at.replace(' ', 'T').startsWith(hour))}
                }
                return {results: rows}
            },
            first: async () => (options.missingState ? null : {...state}),
            run: async () => {
                if (options.releaseError && sql.includes('SET lease_owner = NULL')) throw new Error('release failed')
                execute(sql, binds)
                return {success: true}
            },
        }),
    })
    const db = {
        prepare,
        batch: async (statements: {run: () => Promise<unknown>}[]) => Promise.all(statements.map((statement) => statement.run())),
    } as unknown as D1Database
    return {
        db,
        state,
        dirtyRows,
        get lastError() {
            return lastError
        },
    }
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
        sfw_review_status: 'approved',
        sfw_approved_at: '2026-08-25 12:30:00',
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
