import {z} from 'zod'
import {
    queryRecentMediaSourceRows,
    queryRecentMediaSourceRowsPage,
    type RecentMediaItem,
    RecentMediaItemSchema,
    type RecentMediaRow,
    recentMediaHour,
    recentMediaItemsFromRows,
} from '../recentMedia'
import {
    getRecentFeedConfig,
    RECENT_FEED_INITIAL_ITEMS,
    RECENT_FEED_SCHEMA_VERSION,
    RECENT_FEED_VARIANTS,
    type RecentFeedConfig,
    type RecentFeedVariant,
    recentFeedVariantOptions,
} from './config'
import {
    type RecentFeedBlock,
    type RecentFeedBlockReference,
    RecentFeedBlockReferenceSchema,
    type RecentFeedDayManifest,
    RecentFeedDayManifestSchema,
    type RecentFeedDayReference,
    type RecentFeedHourReference,
    type RecentFeedMonthManifest,
    RecentFeedMonthManifestSchema,
    type RecentFeedMonthReference,
    type RecentFeedPointer,
    type RecentFeedRoot,
    RecentFeedRootSchema,
    type RecentFeedVariantRoot,
    RecentFeedVariantRootSchema,
    type RecentFeedYearManifest,
    RecentFeedYearManifestSchema,
    type RecentFeedYearReference,
} from './model'
import {readRecentFeedTreeItems} from './tree'

const RECENT_FEED_BOOTSTRAP_ROW_BUDGET = 1000
const RECENT_FEED_BOOTSTRAP_HOUR_BUDGET = 24
const RECENT_FEED_MAX_BLOCKS_PER_HOUR = 4096
const RECENT_FEED_BOOTSTRAP_MAX_ROOTS_BYTES = 1024 * 1024
const RECENT_FEED_BOOTSTRAP_IMMEDIATE_DELETE_LIMIT = 1000

type RecentFeedPublisherEnv = {
    DB: D1Database
    MEDIA_PUBLIC_BASE_URL: string
    RECENT_FEED_BLOCK_ITEMS?: string
    RECENT_FEED_BUCKET: R2Bucket
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_PUBLISH_ENABLED?: string
    RECENT_FEED_RETENTION_DAYS?: string
}

type RecentFeedStateRow = {
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

type RecentFeedDirtyHourRow = {
    dirty_hour: string
    revision: number
    urgent: number
}

export type RecentFeedPublishSummary = {
    status: 'disabled' | 'current' | 'busy' | 'building' | 'published'
    generation?: string
    revision?: number
    dirtyHours?: number
    itemCounts?: Record<RecentFeedVariant, number>
    objectsWritten?: number
    bytesWritten?: number
    bootstrapRows?: number
}

type WriteMetrics = {
    objectsWritten: number
    bytesWritten: number
}

type BootstrapVariantHour = {
    itemCount: number
    blockCount: number
    blocks: RecentFeedBlockReference[]
    pendingItems: RecentMediaItem[]
}

type BootstrapActiveHour = {
    hour: string
    previousKey: string | null
    sourceRowCount: number
    variants: Record<RecentFeedVariant, BootstrapVariantHour>
}

const BootstrapVariantHourSchema = z.object({
    itemCount: z.number().int().nonnegative(),
    blockCount: z.number().int().nonnegative(),
    blocks: z.array(RecentFeedBlockReferenceSchema),
    pendingItems: z.array(RecentMediaItemSchema),
})

const BootstrapActiveSegmentSchema = z.object({
    schemaVersion: z.literal(RECENT_FEED_SCHEMA_VERSION),
    hour: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}$/),
    previousKey: z.string().min(1).max(1024).nullable(),
    sourceRowCount: z.number().int().nonnegative(),
    variants: z.object({
        'n0-u0': BootstrapVariantHourSchema,
        'n0-u1': BootstrapVariantHourSchema,
        'n1-u0': BootstrapVariantHourSchema,
        'n1-u1': BootstrapVariantHourSchema,
    }),
})

const BootstrapVariantRootsSchema = z.object({
    'n0-u0': RecentFeedVariantRootSchema,
    'n0-u1': RecentFeedVariantRootSchema,
    'n1-u0': RecentFeedVariantRootSchema,
    'n1-u1': RecentFeedVariantRootSchema,
})

class RecentFeedChangedDuringPublishError extends Error {
    constructor() {
        super('Recent feed changed during publication')
    }
}

export async function publishRecentFeed(
    env: RecentFeedPublisherEnv,
    options: {force?: boolean; now?: Date} = {},
): Promise<RecentFeedPublishSummary> {
    const config = getRecentFeedConfig(env)

    if (!config.publishEnabled && options.force !== true) {
        return {status: 'disabled'}
    }

    const leaseOwner = crypto.randomUUID()
    const leaseAcquired = await acquirePublicationLease(env.DB, leaseOwner)

    if (!leaseAcquired) {
        return {status: 'busy'}
    }

    const startedAt = Date.now()

    try {
        const state = await getRecentFeedState(env.DB)
        let previousRoot: RecentFeedRoot | null = null

        if (!state.root_key || state.bootstrap_revision !== null) {
            return await continueRecentFeedBootstrap(env, config, state, leaseOwner, startedAt, options.now ?? new Date())
        }

        if (state.requested_revision <= state.published_revision) {
            previousRoot = await readJson(env.RECENT_FEED_BUCKET, state.root_key, RecentFeedRootSchema)

            if (previousRoot.initialItems) {
                return {status: 'current', generation: state.generation ?? undefined, revision: state.published_revision}
            }
        }

        const targetRevision = state.requested_revision
        const dirtyRows = await getDirtyHours(env.DB, targetRevision)
        const fullBuild = !state.root_key || dirtyRows.some((row) => row.dirty_hour === '*')
        const dirtyHours = fullBuild ? [] : dirtyRows.map((row) => row.dirty_hour)
        await renewPublicationLease(env.DB, leaseOwner)
        const sourceRowsByHour = await loadSourceRowsByHour(env.DB, dirtyHours, fullBuild)
        await renewPublicationLease(env.DB, leaseOwner)
        previousRoot ??= fullBuild || !state.root_key ? null : await readJson(env.RECENT_FEED_BUCKET, state.root_key, RecentFeedRootSchema)
        const metrics: WriteMetrics = {objectsWritten: 0, bytesWritten: 0}
        const variantRoots = {} as RecentFeedRoot['variants']

        for (const variant of RECENT_FEED_VARIANTS) {
            await renewPublicationLease(env.DB, leaseOwner)
            const nextVariantRoot = await buildRecentFeedVariantTree(
                env.RECENT_FEED_BUCKET,
                variant,
                previousRoot?.variants[variant] ?? emptyVariantRoot(),
                sourceRowsByHour,
                fullBuild,
                env.MEDIA_PUBLIC_BASE_URL,
                config.blockItems,
                config.immutableCacheControl,
                metrics,
                () => renewPublicationLease(env.DB, leaseOwner),
            )
            variantRoots[variant] = nextVariantRoot
            await renewPublicationLease(env.DB, leaseOwner)
        }

        const initialItems = await buildRecentFeedInitialItems(env.RECENT_FEED_BUCKET, variantRoots)
        await renewPublicationLease(env.DB, leaseOwner)
        const publishedAt = (options.now ?? new Date()).toISOString()
        const generationDigest = await sha256Hex(
            JSON.stringify({throughRevision: targetRevision, publishedAt, variants: variantRoots, initialItems}),
        )
        const generation = `r${targetRevision}-${generationDigest.slice(0, 16)}`
        const rootKey = `generations/v1/roots/${generation}-${generationDigest.slice(16, 48)}.json`
        const existingRoot = await env.RECENT_FEED_BUCKET.get(rootKey)
        const root = existingRoot
            ? RecentFeedRootSchema.parse(await existingRoot.json<unknown>())
            : {
                  schemaVersion: RECENT_FEED_SCHEMA_VERSION,
                  generation,
                  throughRevision: targetRevision,
                  publishedAt,
                  variants: variantRoots,
                  initialItems,
              }

        if (!existingRoot) {
            await putJsonIfMissing(env.RECENT_FEED_BUCKET, rootKey, JSON.stringify(root), config.immutableCacheControl, metrics)
        }

        const pointer: RecentFeedPointer = {
            generation,
            rootKey,
            publishedAt: root.publishedAt,
            throughRevision: targetRevision,
        }

        await checkpointPublication(env.DB, leaseOwner, targetRevision, pointer, variantRoots, metrics)

        const itemCounts = Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, variantRoots[variant].itemCount])) as Record<
            RecentFeedVariant,
            number
        >

        console.log(
            JSON.stringify({
                event: 'recent-feed-published',
                generation,
                revision: targetRevision,
                dirtyHours: sourceRowsByHour.size,
                itemCounts,
                objectsWritten: metrics.objectsWritten,
                bytesWritten: metrics.bytesWritten,
                durationMs: Date.now() - startedAt,
            }),
        )

        return {
            status: 'published',
            generation,
            revision: targetRevision,
            dirtyHours: sourceRowsByHour.size,
            itemCounts,
            objectsWritten: metrics.objectsWritten,
            bytesWritten: metrics.bytesWritten,
        }
    } catch (error) {
        await recordPublicationError(env.DB, leaseOwner, error)
        throw error
    } finally {
        await releasePublicationLease(env.DB, leaseOwner)
    }
}

export async function getRecentFeedPointer(db: D1Database): Promise<RecentFeedPointer | null> {
    const state = await getRecentFeedState(db)

    return state.generation && state.root_key && state.published_at
        ? {
              generation: state.generation,
              rootKey: state.root_key,
              publishedAt: state.published_at,
              throughRevision: state.published_revision,
          }
        : null
}

async function buildRecentFeedInitialItems(
    bucket: R2Bucket,
    variants: RecentFeedRoot['variants'],
): Promise<NonNullable<RecentFeedRoot['initialItems']>> {
    const entries = await Promise.all(
        RECENT_FEED_VARIANTS.map(async (variant) => {
            const root = variants[variant]
            const items = await readRecentFeedTreeItems(bucket, root, variant, 0, Math.min(root.itemCount, RECENT_FEED_INITIAL_ITEMS))

            if (items.length !== Math.min(root.itemCount, RECENT_FEED_INITIAL_ITEMS)) {
                throw new Error(`Recent feed initial items do not match the ${variant} root`)
            }

            return [variant, items] as const
        }),
    )

    return Object.fromEntries(entries) as NonNullable<RecentFeedRoot['initialItems']>
}

async function acquirePublicationLease(db: D1Database, owner: string): Promise<boolean> {
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET lease_owner = ?,
                 lease_expires_at = datetime('now', '+5 minutes'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND (lease_owner IS NULL OR lease_owner = ? OR lease_expires_at <= CURRENT_TIMESTAMP)`,
        )
        .bind(owner, owner)
        .run()

    const state = await getRecentFeedState(db)
    return state.lease_owner === owner
}

async function releasePublicationLease(db: D1Database, owner: string): Promise<void> {
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
        console.warn('Unable to release recent feed publication lease', {error})
    }
}

async function renewPublicationLease(db: D1Database, owner: string): Promise<void> {
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET lease_expires_at = datetime('now', '+5 minutes'),
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(owner)
        .run()

    const state = await getRecentFeedState(db)

    if (state.lease_owner !== owner || !state.lease_expires_at) {
        throw new Error('Recent feed publication lease was lost')
    }
}

async function recordPublicationError(db: D1Database, owner: string, error: unknown): Promise<void> {
    try {
        const message = error instanceof Error ? error.message : 'Unknown recent feed publication error'
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET last_error = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE singleton = 1 AND lease_owner = ?`,
            )
            .bind(message.slice(0, 1000), owner)
            .run()
    } catch {
        // Preserve the original publication error.
    }
}

async function getRecentFeedState(db: D1Database): Promise<RecentFeedStateRow> {
    const row = await db
        .prepare(
            `SELECT requested_revision,
                    published_revision,
                    generation,
                    root_key,
                    published_at,
                    lease_owner,
                    lease_expires_at,
                    bootstrap_revision,
                    bootstrap_cursor_created_at,
                    bootstrap_cursor_id,
                    bootstrap_variant_roots_json,
                    bootstrap_active_key,
                    bootstrap_objects_written,
                    bootstrap_bytes_written
             FROM recent_feed_state
             WHERE singleton = 1`,
        )
        .bind()
        .first<RecentFeedStateRow>()

    if (!row) {
        throw new Error('Recent feed migration is not applied')
    }

    return row
}

async function getDirtyHours(db: D1Database, targetRevision: number): Promise<RecentFeedDirtyHourRow[]> {
    const result = await db
        .prepare(
            `SELECT dirty_hour, revision, urgent
             FROM recent_feed_dirty_hours
             WHERE revision <= ?
             ORDER BY dirty_hour`,
        )
        .bind(targetRevision)
        .all<RecentFeedDirtyHourRow>()

    return result.results ?? []
}

async function initializeRecentFeedBootstrap(db: D1Database, leaseOwner: string, targetRevision: number): Promise<void> {
    const roots = Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, emptyVariantRoot()])) as RecentFeedRoot['variants']

    await db
        .prepare(
            `UPDATE recent_feed_state
             SET bootstrap_revision = ?,
                 bootstrap_cursor_created_at = NULL,
                 bootstrap_cursor_id = NULL,
                 bootstrap_variant_roots_json = ?,
                 bootstrap_active_key = NULL,
                 bootstrap_objects_written = 0,
                 bootstrap_bytes_written = 0,
                 bootstrap_started_at = CURRENT_TIMESTAMP,
                 last_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND root_key IS NULL
               AND bootstrap_revision IS NULL
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(targetRevision, serializeBootstrapVariantRoots(roots), leaseOwner)
        .run()

    const state = await getRecentFeedState(db)

    if (state.bootstrap_revision !== targetRevision || state.lease_owner !== leaseOwner) {
        throw new Error('Recent feed bootstrap could not start')
    }
}

function parseBootstrapVariantRoots(value: string | null): RecentFeedRoot['variants'] {
    if (!value) {
        throw new Error('Recent feed bootstrap roots are missing')
    }

    return BootstrapVariantRootsSchema.parse(JSON.parse(value))
}

function serializeBootstrapVariantRoots(roots: RecentFeedRoot['variants']): string {
    const value = JSON.stringify(roots)

    if (new TextEncoder().encode(value).byteLength > RECENT_FEED_BOOTSTRAP_MAX_ROOTS_BYTES) {
        throw new Error('Recent feed bootstrap roots exceed the 1 MiB D1 checkpoint limit')
    }

    return value
}

function bootstrapCursor(state: RecentFeedStateRow): {createdAt: string; id: string} | null {
    if (state.bootstrap_cursor_created_at === null && state.bootstrap_cursor_id === null) {
        return null
    }

    if (!state.bootstrap_cursor_created_at || !state.bootstrap_cursor_id) {
        throw new Error('Recent feed bootstrap cursor is invalid')
    }

    return {createdAt: state.bootstrap_cursor_created_at, id: state.bootstrap_cursor_id}
}

async function checkpointRecentFeedBootstrap(
    db: D1Database,
    leaseOwner: string,
    revision: number,
    cursor: {createdAt: string; id: string},
    roots: RecentFeedRoot['variants'],
    activeKey: string | null,
    metrics: WriteMetrics,
): Promise<void> {
    const rootsJson = serializeBootstrapVariantRoots(roots)

    await db
        .prepare(
            `UPDATE recent_feed_state
             SET bootstrap_cursor_created_at = ?,
                 bootstrap_cursor_id = ?,
                 bootstrap_variant_roots_json = ?,
                 bootstrap_active_key = ?,
                 bootstrap_objects_written = ?,
                 bootstrap_bytes_written = ?,
                 last_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND bootstrap_revision = ?
               AND root_key IS NULL
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(cursor.createdAt, cursor.id, rootsJson, activeKey, metrics.objectsWritten, metrics.bytesWritten, revision, leaseOwner)
        .run()

    const state = await getRecentFeedState(db)

    if (
        state.bootstrap_revision !== revision ||
        state.lease_owner !== leaseOwner ||
        state.bootstrap_cursor_created_at !== cursor.createdAt ||
        state.bootstrap_cursor_id !== cursor.id ||
        state.bootstrap_active_key !== activeKey
    ) {
        throw new Error('Recent feed bootstrap checkpoint was rejected')
    }
}

function emptyBootstrapActiveHour(hour: string): BootstrapActiveHour {
    const emptyVariant = (): BootstrapVariantHour => ({itemCount: 0, blockCount: 0, blocks: [], pendingItems: []})
    const variants: Record<RecentFeedVariant, BootstrapVariantHour> = {
        'n0-u0': emptyVariant(),
        'n0-u1': emptyVariant(),
        'n1-u0': emptyVariant(),
        'n1-u1': emptyVariant(),
    }

    return {hour, previousKey: null, sourceRowCount: 0, variants}
}

async function loadBootstrapActiveHour(bucket: R2Bucket, key: string, blockItems: number): Promise<BootstrapActiveHour> {
    const segment = await readJson(bucket, key, BootstrapActiveSegmentSchema)

    for (const variant of RECENT_FEED_VARIANTS) {
        const variantState = segment.variants[variant]

        if (
            variantState.pendingItems.length >= blockItems ||
            variantState.blocks.length > variantState.blockCount ||
            variantState.itemCount < variantState.pendingItems.length
        ) {
            throw new Error('Recent feed bootstrap active-hour checkpoint is invalid')
        }
    }

    return {
        hour: segment.hour,
        previousKey: key,
        sourceRowCount: segment.sourceRowCount,
        variants: {
            'n0-u0': resumedBootstrapVariant(segment.variants['n0-u0']),
            'n0-u1': resumedBootstrapVariant(segment.variants['n0-u1']),
            'n1-u0': resumedBootstrapVariant(segment.variants['n1-u0']),
            'n1-u1': resumedBootstrapVariant(segment.variants['n1-u1']),
        },
    }
}

function resumedBootstrapVariant(value: BootstrapVariantHour): BootstrapVariantHour {
    return {
        itemCount: value.itemCount,
        blockCount: value.blockCount,
        blocks: [],
        pendingItems: value.pendingItems,
    }
}

async function addBootstrapRow(
    bucket: R2Bucket,
    active: BootstrapActiveHour,
    row: RecentMediaRow,
    mediaBaseUrl: string,
    blockItems: number,
    cacheControl: string,
    metrics: WriteMetrics,
): Promise<void> {
    active.sourceRowCount += 1

    for (const variant of RECENT_FEED_VARIANTS) {
        const options = recentFeedVariantOptions(variant)
        const item = recentMediaItemsFromRows([row], mediaBaseUrl, options.showNsfw, options.showUnapproved)[0]

        if (!item) {
            continue
        }

        const variantState = active.variants[variant]
        variantState.itemCount += 1
        variantState.pendingItems.push(item)

        if (variantState.pendingItems.length === blockItems) {
            await appendBootstrapBlock(bucket, active, variant, cacheControl, metrics)
        }
    }
}

async function appendBootstrapBlock(
    bucket: R2Bucket,
    active: BootstrapActiveHour,
    variant: RecentFeedVariant,
    cacheControl: string,
    metrics: WriteMetrics,
): Promise<void> {
    const variantState = active.variants[variant]

    if (variantState.pendingItems.length === 0) {
        return
    }

    if (variantState.blockCount >= RECENT_FEED_MAX_BLOCKS_PER_HOUR) {
        throw new Error(`Recent feed bootstrap hour ${active.hour} exceeds the ${RECENT_FEED_MAX_BLOCKS_PER_HOUR}-block format limit`)
    }

    variantState.blocks.push(await writeRecentFeedBlock(bucket, variant, active.hour, variantState.pendingItems, cacheControl, metrics))
    variantState.blockCount += 1
    variantState.pendingItems = []
}

async function writeBootstrapActiveSegment(bucket: R2Bucket, revision: number, active: BootstrapActiveHour): Promise<string> {
    const segment = BootstrapActiveSegmentSchema.parse({
        schemaVersion: RECENT_FEED_SCHEMA_VERSION,
        hour: active.hour,
        previousKey: active.previousKey,
        sourceRowCount: active.sourceRowCount,
        variants: active.variants,
    })
    const json = JSON.stringify(segment)
    const digest = await sha256Hex(json)
    const key = `generations/v1/bootstrap/r${revision}/${active.hour}/${digest}.json`

    if (!(await bucket.head(key))) {
        await bucket.put(key, json, {
            httpMetadata: {cacheControl: 'no-store', contentType: 'application/json; charset=utf-8'},
            customMetadata: {schema: String(RECENT_FEED_SCHEMA_VERSION), type: 'bootstrap-checkpoint'},
        })
    }

    return key
}

async function finalizeBootstrapHour(
    bucket: R2Bucket,
    active: BootstrapActiveHour,
    cacheControl: string,
    metrics: WriteMetrics,
): Promise<{
    hour: string
    references: Record<RecentFeedVariant, RecentFeedHourReference | null>
    checkpointKeys: string[]
}> {
    for (const variant of RECENT_FEED_VARIANTS) {
        await appendBootstrapBlock(bucket, active, variant, cacheControl, metrics)
    }

    const blockSegments: Record<RecentFeedVariant, RecentFeedBlockReference[][]> = {
        'n0-u0': [],
        'n0-u1': [],
        'n1-u0': [],
        'n1-u1': [],
    }
    const checkpointKeys: string[] = []
    const seenKeys = new Set<string>()
    let key = active.previousKey

    while (key) {
        if (seenKeys.has(key)) {
            throw new Error('Recent feed bootstrap active-hour checkpoint chain is invalid')
        }

        seenKeys.add(key)
        checkpointKeys.push(key)
        const segment = await readJson(bucket, key, BootstrapActiveSegmentSchema)

        if (segment.hour !== active.hour) {
            throw new Error('Recent feed bootstrap active-hour checkpoint does not match its hour')
        }

        for (const variant of RECENT_FEED_VARIANTS) {
            if (segment.variants[variant].blocks.length > 0) {
                blockSegments[variant].push(segment.variants[variant].blocks)
            }
        }

        key = segment.previousKey
    }

    const references = {} as Record<RecentFeedVariant, RecentFeedHourReference | null>

    for (const variant of RECENT_FEED_VARIANTS) {
        const variantState = active.variants[variant]
        const blocks = [...blockSegments[variant].reverse().flat(), ...variantState.blocks]

        if (blocks.length !== variantState.blockCount || sumItemCounts(blocks) !== variantState.itemCount) {
            throw new Error('Recent feed bootstrap active-hour block counts are invalid')
        }

        references[variant] = variantState.itemCount === 0 ? null : {hour: active.hour, itemCount: variantState.itemCount, blocks}
    }

    return {
        hour: active.hour,
        references,
        checkpointKeys: checkpointKeys.slice(0, RECENT_FEED_BOOTSTRAP_IMMEDIATE_DELETE_LIMIT),
    }
}

function addCompletedHourReferences(
    target: Record<RecentFeedVariant, Map<string, RecentFeedHourReference | null>>,
    hour: string,
    references: Record<RecentFeedVariant, RecentFeedHourReference | null>,
): void {
    for (const variant of RECENT_FEED_VARIANTS) {
        target[variant].set(hour, references[variant])
    }
}

async function deleteBootstrapCheckpointKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
    try {
        for (let offset = 0; offset < keys.length; offset += 1000) {
            await bucket.delete(keys.slice(offset, offset + 1000))
        }
    } catch (error) {
        console.warn('Unable to delete recent feed bootstrap checkpoints', {error})
    }
}

async function loadSourceRowsByHour(db: D1Database, dirtyHours: string[], fullBuild: boolean): Promise<Map<string, RecentMediaRow[]>> {
    if (fullBuild) {
        const rows = await queryRecentMediaSourceRows(db)
        const byHour = new Map<string, RecentMediaRow[]>()

        for (const row of rows) {
            const hour = recentMediaHour(row)
            const hourRows = byHour.get(hour) ?? []
            hourRows.push(row)
            byHour.set(hour, hourRows)
        }

        return byHour
    }

    const byHour = new Map<string, RecentMediaRow[]>()

    for (const hour of dirtyHours) {
        byHour.set(hour, await queryRecentMediaSourceRows(db, hour))
    }

    return byHour
}

/** @internal */
export async function buildRecentFeedVariantTree(
    bucket: R2Bucket,
    variant: RecentFeedVariant,
    previous: RecentFeedVariantRoot,
    sourceRowsByHour: Map<string, RecentMediaRow[]>,
    fullBuild: boolean,
    mediaBaseUrl: string,
    blockItems: number,
    cacheControl: string,
    metrics: WriteMetrics,
    onProgress?: () => Promise<void>,
): Promise<RecentFeedVariantRoot> {
    const options = recentFeedVariantOptions(variant)
    const hourReferences = new Map<string, RecentFeedHourReference | null>()

    for (const [hour, rows] of sourceRowsByHour) {
        const items = recentMediaItemsFromRows(rows, mediaBaseUrl, options.showNsfw, options.showUnapproved)

        if (items.length === 0) {
            hourReferences.set(hour, null)
            continue
        }

        const blocks: RecentFeedBlockReference[] = []

        for (let offset = 0; offset < items.length; offset += blockItems) {
            if (blocks.length >= RECENT_FEED_MAX_BLOCKS_PER_HOUR) {
                throw new Error(`Recent feed hour ${hour} exceeds the ${RECENT_FEED_MAX_BLOCKS_PER_HOUR}-block format limit`)
            }

            const itemSlice = items.slice(offset, offset + blockItems)
            blocks.push(await writeRecentFeedBlock(bucket, variant, hour, itemSlice, cacheControl, metrics))
        }

        hourReferences.set(hour, {hour, itemCount: items.length, blocks})
    }

    return applyRecentFeedVariantHours(bucket, variant, previous, hourReferences, fullBuild, cacheControl, metrics, onProgress)
}

async function applyRecentFeedVariantHours(
    bucket: R2Bucket,
    variant: RecentFeedVariant,
    previous: RecentFeedVariantRoot,
    hourReferences: Map<string, RecentFeedHourReference | null>,
    fullBuild: boolean,
    cacheControl: string,
    metrics: WriteMetrics,
    onProgress?: () => Promise<void>,
): Promise<RecentFeedVariantRoot> {
    if (previous.itemCount !== sumItemCounts(previous.years)) {
        throw new Error('Recent feed variant root count is invalid')
    }

    const yearMap = fullBuild
        ? new Map<string, RecentFeedYearReference>()
        : new Map(previous.years.map((reference) => [reference.year, reference]))
    const dirtyHierarchy = groupHoursByDate(hourReferences.keys())

    for (const [year, dirtyMonths] of dirtyHierarchy) {
        const previousYearReference = yearMap.get(year)
        const previousYear =
            !fullBuild && previousYearReference
                ? await readJson(bucket, previousYearReference.key, RecentFeedYearManifestSchema)
                : emptyYearManifest(variant, year)
        assertYearManifest(previousYear, previousYearReference, variant, year)
        const monthMap = new Map(previousYear.months.map((reference) => [reference.month, reference]))

        for (const [month, dirtyDays] of dirtyMonths) {
            const previousMonthReference = monthMap.get(month)
            const previousMonth =
                !fullBuild && previousMonthReference
                    ? await readJson(bucket, previousMonthReference.key, RecentFeedMonthManifestSchema)
                    : emptyMonthManifest(variant, month)
            assertMonthManifest(previousMonth, previousMonthReference, variant, month)
            const dayMap = new Map(previousMonth.days.map((reference) => [reference.day, reference]))

            for (const [day, dirtyHours] of dirtyDays) {
                const previousDayReference = dayMap.get(day)
                const previousDay =
                    !fullBuild && previousDayReference
                        ? await readJson(bucket, previousDayReference.key, RecentFeedDayManifestSchema)
                        : emptyDayManifest(variant, day)
                assertDayManifest(previousDay, previousDayReference, variant, day)
                const hourMap = new Map(previousDay.hours.map((reference) => [reference.hour, reference]))

                for (const hour of dirtyHours) {
                    const reference = hourReferences.get(hour)

                    if (!reference) {
                        hourMap.delete(hour)
                    } else {
                        hourMap.set(hour, reference)
                    }
                }

                const hours = [...hourMap.values()].sort((left, right) => right.hour.localeCompare(left.hour))

                if (hours.length === 0) {
                    dayMap.delete(day)
                } else {
                    const manifest: RecentFeedDayManifest = {
                        schemaVersion: RECENT_FEED_SCHEMA_VERSION,
                        variant,
                        day,
                        itemCount: sumItemCounts(hours),
                        hours,
                    }
                    const key = await putContentAddressedManifest(
                        bucket,
                        `generations/v1/manifests/${variant}/days/${day}`,
                        manifest,
                        cacheControl,
                        metrics,
                    )
                    dayMap.set(day, {day, key, itemCount: manifest.itemCount})
                }
            }

            const days = [...dayMap.values()].sort((left, right) => right.day.localeCompare(left.day))

            if (days.length === 0) {
                monthMap.delete(month)
            } else {
                const manifest: RecentFeedMonthManifest = {
                    schemaVersion: RECENT_FEED_SCHEMA_VERSION,
                    variant,
                    month,
                    itemCount: sumItemCounts(days),
                    days,
                }
                const key = await putContentAddressedManifest(
                    bucket,
                    `generations/v1/manifests/${variant}/months/${month}`,
                    manifest,
                    cacheControl,
                    metrics,
                )
                monthMap.set(month, {month, key, itemCount: manifest.itemCount})
            }

            await onProgress?.()
        }

        const months = [...monthMap.values()].sort((left, right) => right.month.localeCompare(left.month))

        if (months.length === 0) {
            yearMap.delete(year)
        } else {
            const manifest: RecentFeedYearManifest = {
                schemaVersion: RECENT_FEED_SCHEMA_VERSION,
                variant,
                year,
                itemCount: sumItemCounts(months),
                months,
            }
            const key = await putContentAddressedManifest(
                bucket,
                `generations/v1/manifests/${variant}/years/${year}`,
                manifest,
                cacheControl,
                metrics,
            )
            yearMap.set(year, {year, key, itemCount: manifest.itemCount})
        }

        await onProgress?.()
    }

    const years = [...yearMap.values()].sort((left, right) => right.year.localeCompare(left.year))

    return {
        itemCount: sumItemCounts(years),
        years,
    }
}

async function continueRecentFeedBootstrap(
    env: RecentFeedPublisherEnv,
    config: RecentFeedConfig,
    initialState: RecentFeedStateRow,
    leaseOwner: string,
    startedAt: number,
    now: Date,
): Promise<RecentFeedPublishSummary> {
    let state = initialState

    if (state.bootstrap_revision === null) {
        await initializeRecentFeedBootstrap(env.DB, leaseOwner, state.requested_revision)
        state = await getRecentFeedState(env.DB)
    }

    const targetRevision = state.bootstrap_revision

    if (targetRevision === null || state.root_key) {
        throw new Error('Recent feed bootstrap state is invalid')
    }

    const variantRoots = parseBootstrapVariantRoots(state.bootstrap_variant_roots_json)
    let activeHour = state.bootstrap_active_key
        ? await loadBootstrapActiveHour(env.RECENT_FEED_BUCKET, state.bootstrap_active_key, config.blockItems)
        : null
    const cursor = bootstrapCursor(state)
    const sourceRows = await queryRecentMediaSourceRowsPage(env.DB, cursor, RECENT_FEED_BOOTSTRAP_ROW_BUDGET + 1)
    const metrics: WriteMetrics = {objectsWritten: 0, bytesWritten: 0}
    const completedReferences = Object.fromEntries(
        RECENT_FEED_VARIANTS.map((variant) => [variant, new Map<string, RecentFeedHourReference | null>()]),
    ) as Record<RecentFeedVariant, Map<string, RecentFeedHourReference | null>>
    const checkpointKeysToDelete: string[] = []
    let completedHours = 0
    let processedRows = 0
    let nextCursor = cursor

    await renewPublicationLease(env.DB, leaseOwner)

    while (processedRows < RECENT_FEED_BOOTSTRAP_ROW_BUDGET && processedRows < sourceRows.length) {
        const row = sourceRows[processedRows]

        if (!row) {
            break
        }

        const hour = recentMediaHour(row)

        if (activeHour && activeHour.hour !== hour) {
            const finalized = await finalizeBootstrapHour(env.RECENT_FEED_BUCKET, activeHour, config.immutableCacheControl, metrics)
            addCompletedHourReferences(completedReferences, finalized.hour, finalized.references)
            checkpointKeysToDelete.push(...finalized.checkpointKeys)
            activeHour = null
            completedHours += 1

            if (completedHours >= RECENT_FEED_BOOTSTRAP_HOUR_BUDGET) {
                break
            }
        }

        activeHour ??= emptyBootstrapActiveHour(hour)
        await addBootstrapRow(
            env.RECENT_FEED_BUCKET,
            activeHour,
            row,
            env.MEDIA_PUBLIC_BASE_URL,
            config.blockItems,
            config.immutableCacheControl,
            metrics,
        )
        nextCursor = {createdAt: row.created_at, id: row.id}
        processedRows += 1
    }

    const nextUnprocessedRow = sourceRows[processedRows]

    if (activeHour && (!nextUnprocessedRow || recentMediaHour(nextUnprocessedRow) !== activeHour.hour)) {
        const finalized = await finalizeBootstrapHour(env.RECENT_FEED_BUCKET, activeHour, config.immutableCacheControl, metrics)
        addCompletedHourReferences(completedReferences, finalized.hour, finalized.references)
        checkpointKeysToDelete.push(...finalized.checkpointKeys)
        activeHour = null
        completedHours += 1
    }

    for (const variant of RECENT_FEED_VARIANTS) {
        if (completedReferences[variant].size === 0) {
            continue
        }

        variantRoots[variant] = await applyRecentFeedVariantHours(
            env.RECENT_FEED_BUCKET,
            variant,
            variantRoots[variant],
            completedReferences[variant],
            false,
            config.immutableCacheControl,
            metrics,
            () => renewPublicationLease(env.DB, leaseOwner),
        )
    }

    const sourceComplete = !nextUnprocessedRow && activeHour === null
    const totalMetrics = {
        objectsWritten: state.bootstrap_objects_written + metrics.objectsWritten,
        bytesWritten: state.bootstrap_bytes_written + metrics.bytesWritten,
    }

    if (!sourceComplete) {
        const activeKey = activeHour ? await writeBootstrapActiveSegment(env.RECENT_FEED_BUCKET, targetRevision, activeHour) : null
        await checkpointRecentFeedBootstrap(
            env.DB,
            leaseOwner,
            targetRevision,
            nextCursor as {createdAt: string; id: string},
            variantRoots,
            activeKey,
            totalMetrics,
        )
        await deleteBootstrapCheckpointKeys(env.RECENT_FEED_BUCKET, checkpointKeysToDelete)

        console.log(
            JSON.stringify({
                event: 'recent-feed-bootstrap-progress',
                revision: targetRevision,
                rows: processedRows,
                completedHours,
                objectsWritten: totalMetrics.objectsWritten,
                bytesWritten: totalMetrics.bytesWritten,
                durationMs: Date.now() - startedAt,
            }),
        )

        return {
            status: 'building',
            revision: targetRevision,
            dirtyHours: completedHours,
            objectsWritten: totalMetrics.objectsWritten,
            bytesWritten: totalMetrics.bytesWritten,
            bootstrapRows: processedRows,
        }
    }

    const initialItems = await buildRecentFeedInitialItems(env.RECENT_FEED_BUCKET, variantRoots)
    await renewPublicationLease(env.DB, leaseOwner)
    const publishedAt = now.toISOString()
    const generationDigest = await sha256Hex(
        JSON.stringify({throughRevision: targetRevision, publishedAt, variants: variantRoots, initialItems}),
    )
    const generation = `r${targetRevision}-${generationDigest.slice(0, 16)}`
    const rootKey = `generations/v1/roots/${generation}-${generationDigest.slice(16, 48)}.json`
    const root: RecentFeedRoot = {
        schemaVersion: RECENT_FEED_SCHEMA_VERSION,
        generation,
        throughRevision: targetRevision,
        publishedAt,
        variants: variantRoots,
        initialItems,
    }

    await putJsonIfMissing(env.RECENT_FEED_BUCKET, rootKey, JSON.stringify(root), config.immutableCacheControl, metrics)
    totalMetrics.objectsWritten = state.bootstrap_objects_written + metrics.objectsWritten
    totalMetrics.bytesWritten = state.bootstrap_bytes_written + metrics.bytesWritten

    const pointer: RecentFeedPointer = {generation, rootKey, publishedAt, throughRevision: targetRevision}
    await checkpointInitialPublication(env.DB, leaseOwner, pointer, variantRoots, totalMetrics)
    await deleteBootstrapCheckpointKeys(env.RECENT_FEED_BUCKET, checkpointKeysToDelete)

    const itemCounts = Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, variantRoots[variant].itemCount])) as Record<
        RecentFeedVariant,
        number
    >

    console.log(
        JSON.stringify({
            event: 'recent-feed-published',
            bootstrap: true,
            generation,
            revision: targetRevision,
            dirtyHours: completedHours,
            itemCounts,
            objectsWritten: totalMetrics.objectsWritten,
            bytesWritten: totalMetrics.bytesWritten,
            durationMs: Date.now() - startedAt,
        }),
    )

    return {
        status: 'published',
        generation,
        revision: targetRevision,
        dirtyHours: completedHours,
        itemCounts,
        objectsWritten: totalMetrics.objectsWritten,
        bytesWritten: totalMetrics.bytesWritten,
        bootstrapRows: processedRows,
    }
}

async function writeRecentFeedBlock(
    bucket: R2Bucket,
    variant: RecentFeedVariant,
    hour: string,
    items: RecentMediaItem[],
    cacheControl: string,
    metrics: WriteMetrics,
): Promise<RecentFeedBlockReference> {
    const block: RecentFeedBlock = {
        schemaVersion: RECENT_FEED_SCHEMA_VERSION,
        variant,
        hour,
        items,
    }
    const json = JSON.stringify(block)
    const digest = await sha256Hex(json)
    const key = `generations/v1/blocks/${variant}/${hour}/${digest}.json`

    await putJsonIfMissing(bucket, key, json, cacheControl, metrics)
    return {key, itemCount: items.length}
}

function emptyVariantRoot(): RecentFeedVariantRoot {
    return {itemCount: 0, years: []}
}

function emptyYearManifest(variant: RecentFeedVariant, year: string): RecentFeedYearManifest {
    return {schemaVersion: RECENT_FEED_SCHEMA_VERSION, variant, year, itemCount: 0, months: []}
}

function emptyMonthManifest(variant: RecentFeedVariant, month: string): RecentFeedMonthManifest {
    return {schemaVersion: RECENT_FEED_SCHEMA_VERSION, variant, month, itemCount: 0, days: []}
}

function emptyDayManifest(variant: RecentFeedVariant, day: string): RecentFeedDayManifest {
    return {schemaVersion: RECENT_FEED_SCHEMA_VERSION, variant, day, itemCount: 0, hours: []}
}

function groupHoursByDate(hours: Iterable<string>): Map<string, Map<string, Map<string, string[]>>> {
    const hierarchy = new Map<string, Map<string, Map<string, string[]>>>()

    for (const hour of hours) {
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(hour)) {
            throw new Error('Recent feed dirty hour is invalid')
        }

        const year = hour.slice(0, 4)
        const month = hour.slice(0, 7)
        const day = hour.slice(0, 10)
        const months = hierarchy.get(year) ?? new Map<string, Map<string, string[]>>()
        const days = months.get(month) ?? new Map<string, string[]>()
        const dayHours = days.get(day) ?? []
        dayHours.push(hour)
        days.set(day, dayHours)
        months.set(month, days)
        hierarchy.set(year, months)
    }

    return hierarchy
}

function assertYearManifest(
    manifest: RecentFeedYearManifest,
    reference: RecentFeedYearReference | undefined,
    variant: RecentFeedVariant,
    year: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.year !== year ||
        manifest.itemCount !== sumItemCounts(manifest.months) ||
        (reference && manifest.itemCount !== reference.itemCount)
    ) {
        throw new Error('Recent feed year manifest does not match its reference')
    }
}

function assertMonthManifest(
    manifest: RecentFeedMonthManifest,
    reference: RecentFeedMonthReference | undefined,
    variant: RecentFeedVariant,
    month: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.month !== month ||
        manifest.itemCount !== sumItemCounts(manifest.days) ||
        (reference && manifest.itemCount !== reference.itemCount)
    ) {
        throw new Error('Recent feed month manifest does not match its reference')
    }
}

function assertDayManifest(
    manifest: RecentFeedDayManifest,
    reference: RecentFeedDayReference | undefined,
    variant: RecentFeedVariant,
    day: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.day !== day ||
        manifest.itemCount !== sumItemCounts(manifest.hours) ||
        manifest.hours.some((hour) => hour.itemCount !== sumItemCounts(hour.blocks)) ||
        (reference && manifest.itemCount !== reference.itemCount)
    ) {
        throw new Error('Recent feed day manifest does not match its reference')
    }
}

async function putContentAddressedManifest(
    bucket: R2Bucket,
    prefix: string,
    manifest: RecentFeedDayManifest | RecentFeedMonthManifest | RecentFeedYearManifest,
    cacheControl: string,
    metrics: WriteMetrics,
): Promise<string> {
    const json = JSON.stringify(manifest)
    const digest = await sha256Hex(json)
    const key = `${prefix}/${digest}.json`
    await putJsonIfMissing(bucket, key, json, cacheControl, metrics)
    return key
}

function sumItemCounts(values: Array<{itemCount: number}>): number {
    return values.reduce((total, value) => total + value.itemCount, 0)
}

async function putJsonIfMissing(bucket: R2Bucket, key: string, json: string, cacheControl: string, metrics: WriteMetrics): Promise<void> {
    if (await bucket.head(key)) {
        return
    }

    await bucket.put(key, json, {
        httpMetadata: {
            cacheControl,
            contentType: 'application/json; charset=utf-8',
        },
        customMetadata: {
            schema: String(RECENT_FEED_SCHEMA_VERSION),
        },
    })
    metrics.objectsWritten += 1
    metrics.bytesWritten += new TextEncoder().encode(json).byteLength
}

async function readJson<T>(bucket: R2Bucket, key: string, schema: {parse(value: unknown): T}): Promise<T> {
    const object = await bucket.get(key)

    if (!object) {
        throw new Error(`Recent feed object is missing: ${key}`)
    }

    return schema.parse(await object.json<unknown>())
}

async function checkpointPublication(
    db: D1Database,
    leaseOwner: string,
    revision: number,
    pointer: RecentFeedPointer,
    variantRoots: RecentFeedRoot['variants'],
    metrics: WriteMetrics,
): Promise<void> {
    const itemCounts = Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, variantRoots[variant].itemCount]))
    const insertGeneration = db
        .prepare(
            `INSERT INTO recent_feed_generations (
                generation, through_revision, root_key, item_counts_json, object_count, byte_count, published_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
                 SELECT 1
                 FROM recent_feed_state
                 WHERE singleton = 1
                   AND published_revision = ?
                   AND generation = ?
                   AND root_key = ?
                   AND lease_owner = ?
             )
             ON CONFLICT(generation) DO NOTHING`,
        )
        .bind(
            pointer.generation,
            revision,
            pointer.rootKey,
            JSON.stringify(itemCounts),
            metrics.objectsWritten,
            metrics.bytesWritten,
            pointer.publishedAt,
            revision,
            pointer.generation,
            pointer.rootKey,
            leaseOwner,
        )
    const updateState = db
        .prepare(
            `UPDATE recent_feed_state
             SET published_revision = ?,
                 generation = ?,
                 root_key = ?,
                 published_at = ?,
                 last_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND published_revision <= ?
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(revision, pointer.generation, pointer.rootKey, pointer.publishedAt, revision, leaseOwner)
    const clearDirty = db
        .prepare(
            `DELETE FROM recent_feed_dirty_hours
             WHERE revision <= ?
               AND (SELECT published_revision FROM recent_feed_state WHERE singleton = 1) = ?`,
        )
        .bind(revision, revision)

    await db.batch([updateState, insertGeneration, clearDirty])

    const state = await getRecentFeedState(db)

    if (state.published_revision !== revision || state.generation !== pointer.generation) {
        throw new RecentFeedChangedDuringPublishError()
    }
}

async function checkpointInitialPublication(
    db: D1Database,
    leaseOwner: string,
    pointer: RecentFeedPointer,
    variantRoots: RecentFeedRoot['variants'],
    metrics: WriteMetrics,
): Promise<void> {
    const itemCounts = Object.fromEntries(RECENT_FEED_VARIANTS.map((variant) => [variant, variantRoots[variant].itemCount]))
    const updateState = db
        .prepare(
            `UPDATE recent_feed_state
             SET published_revision = ?,
                 generation = ?,
                 root_key = ?,
                 published_at = ?,
                 bootstrap_revision = NULL,
                 bootstrap_cursor_created_at = NULL,
                 bootstrap_cursor_id = NULL,
                 bootstrap_variant_roots_json = NULL,
                 bootstrap_active_key = NULL,
                 bootstrap_objects_written = 0,
                 bootstrap_bytes_written = 0,
                 bootstrap_started_at = NULL,
                 last_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1
               AND root_key IS NULL
               AND published_revision = 0
               AND bootstrap_revision = ?
               AND lease_owner = ?
               AND lease_expires_at > CURRENT_TIMESTAMP`,
        )
        .bind(pointer.throughRevision, pointer.generation, pointer.rootKey, pointer.publishedAt, pointer.throughRevision, leaseOwner)
    const insertGeneration = db
        .prepare(
            `INSERT INTO recent_feed_generations (
                generation, through_revision, root_key, item_counts_json, object_count, byte_count, published_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE EXISTS (
                 SELECT 1
                 FROM recent_feed_state
                 WHERE singleton = 1
                   AND published_revision = ?
                   AND generation = ?
                   AND root_key = ?
                   AND lease_owner = ?
             )
             ON CONFLICT(generation) DO NOTHING`,
        )
        .bind(
            pointer.generation,
            pointer.throughRevision,
            pointer.rootKey,
            JSON.stringify(itemCounts),
            metrics.objectsWritten,
            metrics.bytesWritten,
            pointer.publishedAt,
            pointer.throughRevision,
            pointer.generation,
            pointer.rootKey,
            leaseOwner,
        )
    const clearDirty = db
        .prepare(
            `DELETE FROM recent_feed_dirty_hours
             WHERE revision <= ?
               AND (SELECT published_revision FROM recent_feed_state WHERE singleton = 1) = ?`,
        )
        .bind(pointer.throughRevision, pointer.throughRevision)

    await db.batch([updateState, insertGeneration, clearDirty])

    const state = await getRecentFeedState(db)

    if (
        state.published_revision !== pointer.throughRevision ||
        state.generation !== pointer.generation ||
        state.bootstrap_revision !== null
    ) {
        throw new RecentFeedChangedDuringPublishError()
    }
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))

    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
