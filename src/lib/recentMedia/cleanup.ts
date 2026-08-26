import {getRecentFeedConfig, RECENT_FEED_VARIANTS, type RecentFeedVariant} from './config'
import {
    RecentFeedDayManifestSchema,
    RecentFeedMonthManifestSchema,
    type RecentFeedRoot,
    RecentFeedRootSchema,
    RecentFeedYearManifestSchema,
} from './model'

type RecentFeedCleanupEnv = {
    DB: D1Database
    RECENT_FEED_BLOCK_ITEMS?: string
    RECENT_FEED_BUCKET: R2Bucket
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_PUBLISH_ENABLED?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
    RECENT_FEED_READ_MODE?: string
    RECENT_FEED_RETENTION_DAYS?: string
}

type GenerationRow = {
    generation: string
    root_key: string
}

type RootKeyRow = {
    root_key: string
}

type GenerationCountRow = {
    count: number
}

type LeaseRow = {
    lease_owner: string | null
}

type BootstrapRow = {
    bootstrap_revision: number | null
}

type ManifestReference = {
    key: string
    itemCount: number
    variant: RecentFeedVariant
    value: string
}

type ReachableGraph = {
    keys: Set<string>
    manifestReads: number
}

export type RecentFeedCleanupSummary = {
    retainedGenerations: number
    deletedGenerations: number
    deletedObjects: number
}

const MINIMUM_RETAINED_GENERATIONS = 100
const MAXIMUM_DELETIONS_PER_RUN = 5000
const D1_DELETE_BATCH_SIZE = 100
const R2_DELETE_BATCH_SIZE = 1000
const RETAINED_ROOT_PAGE_SIZE = 500
const MAXIMUM_RETAINED_ROOTS = 2000
const MAXIMUM_MANIFEST_READS = 7000
const MAXIMUM_REACHABLE_KEYS = 100_000
const MAXIMUM_LISTED_OBJECTS = 100_000
const MAXIMUM_MANIFEST_BYTES = 1024 * 1024
const ORPHAN_GRACE_PERIOD_MS = 48 * 60 * 60 * 1000
const LIST_PREFIXES = ['generations/v1/manifests/', 'generations/v1/blocks/', 'generations/v1/bootstrap/'] as const

export async function cleanupRecentFeed(env: RecentFeedCleanupEnv, now = new Date()): Promise<RecentFeedCleanupSummary> {
    const config = getRecentFeedConfig(env)

    if (!config.cleanupEnabled) {
        return {retainedGenerations: 0, deletedGenerations: 0, deletedObjects: 0}
    }

    const leaseOwner = `cleanup:${crypto.randomUUID()}`
    const leaseAcquired = await acquireCleanupLease(env.DB, leaseOwner)

    if (!leaseAcquired) {
        return {
            retainedGenerations: await countGenerations(env.DB),
            deletedGenerations: 0,
            deletedObjects: 0,
        }
    }

    try {
        if (await hasActiveBootstrap(env.DB)) {
            return {
                retainedGenerations: await countGenerations(env.DB),
                deletedGenerations: 0,
                deletedObjects: 0,
            }
        }

        const cutoff = new Date(now.getTime() - config.retentionDays * 24 * 60 * 60 * 1000).toISOString()
        const generationsResult = await env.DB.prepare(
            `SELECT generation, root_key
             FROM recent_feed_generations
             WHERE published_at < ?
               AND generation NOT IN (
                   SELECT generation
                   FROM recent_feed_generations
                   ORDER BY published_at DESC
                   LIMIT ?
               )
               AND generation <> COALESCE((SELECT generation FROM recent_feed_state WHERE singleton = 1), '')
             ORDER BY published_at
             LIMIT ?`,
        )
            .bind(cutoff, MINIMUM_RETAINED_GENERATIONS, MAXIMUM_DELETIONS_PER_RUN)
            .all<GenerationRow>()
        const generations = generationsResult.results
        const expiredRootKeys = generations.map((generation) => generation.root_key)

        for (let offset = 0; offset < generations.length; offset += D1_DELETE_BATCH_SIZE) {
            const generationBatch = generations.slice(offset, offset + D1_DELETE_BATCH_SIZE)
            const placeholders = generationBatch.map(() => '?').join(', ')
            await env.RECENT_FEED_BUCKET.delete(generationBatch.map((generation) => generation.root_key))
            await env.DB.prepare(`DELETE FROM recent_feed_generations WHERE generation IN (${placeholders})`)
                .bind(...generationBatch.map((generation) => generation.generation))
                .run()
        }

        const retainedGenerations = await countGenerations(env.DB)
        const retainedRootKeys = await loadRetainedRootKeys(env.DB)

        if (!retainedRootKeys) {
            logSkippedSweep('too-many-retained-roots')
            return cleanupSummary(retainedGenerations, generations.length, expiredRootKeys.length)
        }

        const graph = await markReachableObjects(env.RECENT_FEED_BUCKET, retainedRootKeys)

        if (!graph) {
            logSkippedSweep('retained-graph-is-invalid-or-too-large')
            return cleanupSummary(retainedGenerations, generations.length, expiredRootKeys.length)
        }

        const orphanCutoff = new Date(now.getTime() - ORPHAN_GRACE_PERIOD_MS)
        const orphanKeys = await findOrphanKeys(env.RECENT_FEED_BUCKET, graph.keys, orphanCutoff)

        if (!orphanKeys) {
            logSkippedSweep('object-list-is-too-large')
            return cleanupSummary(retainedGenerations, generations.length, expiredRootKeys.length)
        }

        if (!(await renewCleanupLease(env.DB, leaseOwner))) {
            logSkippedSweep('cleanup-lease-was-lost')
            return cleanupSummary(retainedGenerations, generations.length, expiredRootKeys.length)
        }

        const keysToDelete = orphanKeys.slice(0, MAXIMUM_DELETIONS_PER_RUN)

        for (let offset = 0; offset < keysToDelete.length; offset += R2_DELETE_BATCH_SIZE) {
            await env.RECENT_FEED_BUCKET.delete(keysToDelete.slice(offset, offset + R2_DELETE_BATCH_SIZE))
        }

        return cleanupSummary(retainedGenerations, generations.length, expiredRootKeys.length + keysToDelete.length)
    } finally {
        await releaseCleanupLease(env.DB, leaseOwner)
    }
}

async function hasActiveBootstrap(db: D1Database): Promise<boolean> {
    const row = await db.prepare('SELECT bootstrap_revision FROM recent_feed_state WHERE singleton = 1').bind().first<BootstrapRow>()

    return row?.bootstrap_revision !== null && row?.bootstrap_revision !== undefined
}

function cleanupSummary(retainedGenerations: number, deletedGenerations: number, deletedObjects: number): RecentFeedCleanupSummary {
    return {retainedGenerations, deletedGenerations, deletedObjects}
}

async function acquireCleanupLease(db: D1Database, owner: string): Promise<boolean> {
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET lease_owner = ?,
                 lease_expires_at = datetime('now', '+15 minutes'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at <= CURRENT_TIMESTAMP)`,
        )
        .bind(owner, owner)
        .run()

    return (await readLeaseOwner(db)) === owner
}

async function renewCleanupLease(db: D1Database, owner: string): Promise<boolean> {
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET lease_expires_at = datetime('now', '+15 minutes'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(owner)
        .run()

    return (await readLeaseOwner(db)) === owner
}

async function releaseCleanupLease(db: D1Database, owner: string): Promise<void> {
    try {
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET lease_owner = NULL,
                     lease_expires_at = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE singleton = 1 AND lease_owner = ?`,
            )
            .bind(owner)
            .run()
    } catch (error) {
        console.warn('Unable to release the recent feed cleanup lease', {error})
    }
}

async function readLeaseOwner(db: D1Database): Promise<string | null> {
    const row = await db.prepare('SELECT lease_owner FROM recent_feed_state WHERE singleton = 1').bind().first<LeaseRow>()

    if (!row) {
        throw new Error('Recent feed migration is not applied')
    }

    return row.lease_owner
}

async function countGenerations(db: D1Database): Promise<number> {
    const row = await db.prepare('SELECT COUNT(*) AS count FROM recent_feed_generations').bind().first<GenerationCountRow>()
    return row?.count ?? 0
}

async function loadRetainedRootKeys(db: D1Database): Promise<string[] | null> {
    const rootKeys: string[] = []
    let cursor = ''

    while (true) {
        const result = await db
            .prepare(
                `SELECT root_key
                 FROM (
                     SELECT root_key
                     FROM recent_feed_generations
                     UNION
                     SELECT root_key
                     FROM recent_feed_state
                     WHERE singleton = 1 AND root_key IS NOT NULL
                 )
                 WHERE root_key > ?
                 ORDER BY root_key
                 LIMIT ?`,
            )
            .bind(cursor, RETAINED_ROOT_PAGE_SIZE)
            .all<RootKeyRow>()
        const rows = result.results

        if (rootKeys.length + rows.length > MAXIMUM_RETAINED_ROOTS) {
            return null
        }

        for (const row of rows) {
            if (!isRootKey(row.root_key)) {
                return null
            }
            rootKeys.push(row.root_key)
        }

        if (rows.length < RETAINED_ROOT_PAGE_SIZE) {
            return rootKeys
        }

        cursor = (rows.at(-1) as RootKeyRow).root_key

        if (rootKeys.length === MAXIMUM_RETAINED_ROOTS) {
            const probe = await db
                .prepare(
                    `SELECT root_key
                     FROM (
                         SELECT root_key
                         FROM recent_feed_generations
                         UNION
                         SELECT root_key
                         FROM recent_feed_state
                         WHERE singleton = 1 AND root_key IS NOT NULL
                     )
                     WHERE root_key > ?
                     ORDER BY root_key
                     LIMIT 1`,
                )
                .bind(cursor)
                .all<RootKeyRow>()
            return probe.results.length === 0 ? rootKeys : null
        }
    }
}

async function markReachableObjects(bucket: R2Bucket, rootKeys: string[]): Promise<ReachableGraph | null> {
    const graph: ReachableGraph = {keys: new Set<string>(), manifestReads: 0}
    const referenceSignatures = new Map<string, string>()
    const years: ManifestReference[] = []
    const months: ManifestReference[] = []
    const days: ManifestReference[] = []

    for (const rootKey of rootKeys) {
        const root = await readJson(bucket, rootKey, RecentFeedRootSchema)

        if (!root || !markRootReferences(root, years, referenceSignatures, graph)) {
            return null
        }
    }

    for (const reference of years) {
        if (++graph.manifestReads > MAXIMUM_MANIFEST_READS) {
            return null
        }
        const manifest = await readJson(bucket, reference.key, RecentFeedYearManifestSchema)

        if (
            !manifest ||
            manifest.variant !== reference.variant ||
            manifest.year !== reference.value ||
            manifest.itemCount !== reference.itemCount ||
            manifest.itemCount !== sumItemCounts(manifest.months)
        ) {
            return null
        }

        for (const month of manifest.months) {
            if (
                !month.month.startsWith(`${manifest.year}-`) ||
                !addReference(
                    months,
                    referenceSignatures,
                    graph,
                    {key: month.key, itemCount: month.itemCount, variant: manifest.variant, value: month.month},
                    'months',
                )
            ) {
                return null
            }
        }
    }

    for (const reference of months) {
        if (++graph.manifestReads > MAXIMUM_MANIFEST_READS) {
            return null
        }
        const manifest = await readJson(bucket, reference.key, RecentFeedMonthManifestSchema)

        if (
            !manifest ||
            manifest.variant !== reference.variant ||
            manifest.month !== reference.value ||
            manifest.itemCount !== reference.itemCount ||
            manifest.itemCount !== sumItemCounts(manifest.days)
        ) {
            return null
        }

        for (const day of manifest.days) {
            if (
                !day.day.startsWith(`${manifest.month}-`) ||
                !addReference(
                    days,
                    referenceSignatures,
                    graph,
                    {key: day.key, itemCount: day.itemCount, variant: manifest.variant, value: day.day},
                    'days',
                )
            ) {
                return null
            }
        }
    }

    for (const reference of days) {
        if (++graph.manifestReads > MAXIMUM_MANIFEST_READS) {
            return null
        }
        const manifest = await readJson(bucket, reference.key, RecentFeedDayManifestSchema)

        if (
            !manifest ||
            manifest.variant !== reference.variant ||
            manifest.day !== reference.value ||
            manifest.itemCount !== reference.itemCount ||
            manifest.itemCount !== sumItemCounts(manifest.hours)
        ) {
            return null
        }

        for (const hour of manifest.hours) {
            if (
                !hour.hour.startsWith(`${manifest.day}T`) ||
                hour.itemCount !== sumItemCounts(hour.blocks) ||
                hour.blocks.some((block) => !isBlockKey(block.key, manifest.variant, hour.hour) || !markKey(graph, block.key))
            ) {
                return null
            }
        }
    }

    return graph
}

function markRootReferences(
    root: RecentFeedRoot,
    years: ManifestReference[],
    signatures: Map<string, string>,
    graph: ReachableGraph,
): boolean {
    for (const variant of RECENT_FEED_VARIANTS) {
        const variantRoot = root.variants[variant]

        if (variantRoot.itemCount !== sumItemCounts(variantRoot.years)) {
            return false
        }

        for (const year of variantRoot.years) {
            if (!addReference(years, signatures, graph, {...year, variant, value: year.year}, 'years')) {
                return false
            }
        }
    }

    return true
}

function addReference(
    queue: ManifestReference[],
    signatures: Map<string, string>,
    graph: ReachableGraph,
    reference: ManifestReference,
    kind: 'years' | 'months' | 'days',
): boolean {
    if (!isManifestKey(reference.key, reference.variant, kind, reference.value)) {
        return false
    }

    const signature = `${kind}:${reference.variant}:${reference.value}:${reference.itemCount}`
    const priorSignature = signatures.get(reference.key)

    if (priorSignature && priorSignature !== signature) {
        return false
    }

    if (priorSignature) {
        return true
    }

    signatures.set(reference.key, signature)
    queue.push(reference)
    return markKey(graph, reference.key)
}

function markKey(graph: ReachableGraph, key: string): boolean {
    graph.keys.add(key)
    return graph.keys.size <= MAXIMUM_REACHABLE_KEYS
}

async function findOrphanKeys(bucket: R2Bucket, reachable: Set<string>, cutoff: Date): Promise<string[] | null> {
    const orphanKeys: string[] = []
    let listedObjects = 0

    for (const prefix of LIST_PREFIXES) {
        let cursor: string | undefined

        do {
            const page = await bucket.list({prefix, cursor, limit: 1000})
            listedObjects += page.objects.length

            if (listedObjects > MAXIMUM_LISTED_OBJECTS) {
                return null
            }

            for (const object of page.objects) {
                if (!reachable.has(object.key) && object.uploaded.getTime() < cutoff.getTime()) {
                    orphanKeys.push(object.key)
                }
            }

            if (page.truncated && !page.cursor) {
                return null
            }
            cursor = page.truncated ? page.cursor : undefined
        } while (cursor)
    }

    return orphanKeys
}

async function readJson<T>(
    bucket: R2Bucket,
    key: string,
    schema: {safeParse(value: unknown): {success: boolean; data?: T}},
): Promise<T | null> {
    try {
        const object = await bucket.get(key)

        if (!object || object.size > MAXIMUM_MANIFEST_BYTES) {
            return null
        }

        const parsed = schema.safeParse(await object.json<unknown>())
        return parsed.success && parsed.data ? parsed.data : null
    } catch {
        return null
    }
}

function sumItemCounts(values: Array<{itemCount: number}>): number {
    return values.reduce((total, value) => total + value.itemCount, 0)
}

function isRootKey(key: string): boolean {
    return /^generations\/v1\/roots\/[A-Za-z0-9-]+\.json$/.test(key)
}

function isManifestKey(key: string, variant: RecentFeedVariant, kind: string, value: string): boolean {
    return key === `generations/v1/manifests/${variant}/${kind}/${value}/${keyDigest(key)}.json` && /^[a-f0-9]{64}$/.test(keyDigest(key))
}

function isBlockKey(key: string, variant: RecentFeedVariant, hour: string): boolean {
    return key === `generations/v1/blocks/${variant}/${hour}/${keyDigest(key)}.json` && /^[a-f0-9]{64}$/.test(keyDigest(key))
}

function keyDigest(key: string): string {
    return key.slice(key.lastIndexOf('/') + 1, -'.json'.length)
}

function logSkippedSweep(reason: string): void {
    console.warn(JSON.stringify({event: 'recent-feed-cleanup-sweep-skipped', reason}))
}
