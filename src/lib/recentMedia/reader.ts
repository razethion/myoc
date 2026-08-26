import {z} from 'zod'
import {normalizeRecentMediaLimit, type RecentMediaItem, type RecentMediaOptions, type RecentMediaPage} from '../recentMedia'
import {getRecentFeedConfig, RECENT_FEED_VARIANTS, type RecentFeedVariant, recentFeedPublicObjectUrl, recentFeedVariant} from './config'
import {
    RecentFeedBlockSchema,
    type RecentFeedDayManifest,
    RecentFeedDayManifestSchema,
    type RecentFeedDayReference,
    type RecentFeedHourReference,
    type RecentFeedMonthManifest,
    RecentFeedMonthManifestSchema,
    type RecentFeedMonthReference,
    type RecentFeedPointer,
    RecentFeedRootSchema,
    type RecentFeedVariantRoot,
    type RecentFeedYearManifest,
    RecentFeedYearManifestSchema,
    type RecentFeedYearReference,
} from './model'
import {getRecentFeedPointer} from './publisher'

const RecentFeedCursorPayloadSchema = z.object({
    version: z.literal(1),
    generation: z.string().min(1).max(128),
    variant: z.enum(RECENT_FEED_VARIANTS),
    position: z.number().int().nonnegative(),
})

type RecentFeedReaderEnv = {
    CACHE?: KVNamespace
    DB: D1Database
    RECENT_FEED_BLOCK_ITEMS?: string
    RECENT_FEED_BUCKET: R2Bucket
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
    RECENT_FEED_PUBLISH_ENABLED?: string
    RECENT_FEED_READ_MODE?: string
    RECENT_FEED_RETENTION_DAYS?: string
}

type RecentFeedCursorPayload = z.infer<typeof RecentFeedCursorPayloadSchema>

export class InvalidRecentFeedCursorError extends Error {
    constructor() {
        super('Recent media cursor is invalid')
    }
}

export class RecentFeedGenerationExpiredError extends Error {
    constructor() {
        super('This recent media list has expired')
    }
}

class RecentFeedUnavailableError extends Error {
    constructor(message = 'The generated recent media feed is unavailable') {
        super(message)
    }
}

export function isRecentFeedCursor(value: string | null | undefined): boolean {
    return value?.startsWith('r1.') === true
}

export async function getGeneratedRecentMediaPage(
    env: RecentFeedReaderEnv,
    options: RecentMediaOptions & {generation?: string | null} = {},
): Promise<RecentMediaPage> {
    const config = getRecentFeedConfig(env)

    if (!config.cursorSecret) {
        throw new RecentFeedUnavailableError('Recent feed cursor secret is not configured')
    }

    const showNsfw = options.showNsfw === true
    const showUnapproved = options.showUnapproved !== false
    const requestedVariant = recentFeedVariant(showNsfw, showUnapproved)
    const cursor = options.cursor ? await decodeRecentFeedCursor(options.cursor, config.cursorSecret) : null

    if (cursor && cursor.variant !== requestedVariant) {
        throw new InvalidRecentFeedCursorError()
    }

    if (cursor && options.generation && cursor.generation !== options.generation) {
        throw new InvalidRecentFeedCursorError()
    }

    const generation = cursor?.generation ?? options.generation?.trim() ?? null
    const pointer = generation ? await getGenerationPointer(env.DB, generation) : await getRecentFeedPointer(env.DB, env.CACHE)

    if (!pointer) {
        throw generation ? new RecentFeedGenerationExpiredError() : new RecentFeedUnavailableError()
    }

    const rootObject = await env.RECENT_FEED_BUCKET.get(pointer.rootKey)

    if (!rootObject) {
        throw generation ? new RecentFeedGenerationExpiredError() : new RecentFeedUnavailableError()
    }

    const root = RecentFeedRootSchema.parse(await rootObject.json<unknown>())

    if (
        root.generation !== pointer.generation ||
        root.throughRevision !== pointer.throughRevision ||
        (generation && root.generation !== generation)
    ) {
        throw new RecentFeedGenerationExpiredError()
    }

    const variantRoot = root.variants[requestedVariant]
    if (variantRoot.itemCount !== sumItemCounts(variantRoot.years)) {
        throw new RecentFeedUnavailableError('Recent feed variant does not match its root')
    }
    const position = cursor?.position ?? 0

    if (position > variantRoot.itemCount) {
        throw new InvalidRecentFeedCursorError()
    }

    const limit = normalizeRecentMediaLimit(options.limit)
    const items: RecentMediaItem[] = []
    const objectCache = new Map<string, unknown>()
    let consumed = 0

    while (items.length < limit && position + consumed < variantRoot.itemCount) {
        const scanned = await readGeneratedItems(
            env.RECENT_FEED_BUCKET,
            variantRoot,
            requestedVariant,
            position + consumed,
            Math.max(limit * 2, 30),
            objectCache,
        )

        if (scanned.items.length === 0) {
            break
        }

        const revokedIds = await getRevokedMediaIds(
            env.DB,
            scanned.items.map((item) => item.id),
            root.throughRevision,
        )

        for (const item of scanned.items) {
            consumed += 1

            if (!revokedIds.has(item.id)) {
                items.push(item)
            }

            if (items.length === limit) {
                break
            }
        }
    }

    const nextPosition = position + consumed
    const nextCursor =
        nextPosition < variantRoot.itemCount
            ? await encodeRecentFeedCursor(
                  {version: 1, generation: root.generation, variant: requestedVariant, position: nextPosition},
                  config.cursorSecret,
              )
            : null

    return {
        items,
        nextCursor,
        generation: root.generation,
        publishedAt: root.publishedAt,
        publicRootUrl: recentFeedPublicObjectUrl(config.publicBaseUrl, pointer.rootKey),
        nextPosition: nextPosition < variantRoot.itemCount ? nextPosition : null,
    }
}

async function getGenerationPointer(db: D1Database, generation: string): Promise<RecentFeedPointer | null> {
    if (!/^[A-Za-z0-9-]{1,128}$/.test(generation)) {
        throw new InvalidRecentFeedCursorError()
    }

    return await db
        .prepare(
            `SELECT generation,
                    root_key AS rootKey,
                    published_at AS publishedAt,
                    through_revision AS throughRevision
             FROM recent_feed_generations
             WHERE generation = ?`,
        )
        .bind(generation)
        .first<RecentFeedPointer>()
}

async function readGeneratedItems(
    bucket: R2Bucket,
    root: RecentFeedVariantRoot,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    objectCache: Map<string, unknown>,
): Promise<{items: RecentMediaItem[]}> {
    const items: RecentMediaItem[] = []
    let remainingPosition = position

    for (const reference of root.years) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }

        const manifest = await readCachedJson(bucket, reference.key, RecentFeedYearManifestSchema, objectCache)
        assertYearManifest(manifest, reference, variant)
        await readYearItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0

        if (items.length >= maximum) {
            break
        }
    }

    return {items}
}

async function readYearItems(
    bucket: R2Bucket,
    year: RecentFeedYearManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position

    for (const reference of year.months) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }

        const manifest = await readCachedJson(bucket, reference.key, RecentFeedMonthManifestSchema, objectCache)
        assertMonthManifest(manifest, reference, variant, year.year)
        await readMonthItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0

        if (items.length >= maximum) {
            return
        }
    }
}

async function readMonthItems(
    bucket: R2Bucket,
    month: RecentFeedMonthManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position

    for (const reference of month.days) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }

        const manifest = await readCachedJson(bucket, reference.key, RecentFeedDayManifestSchema, objectCache)
        assertDayManifest(manifest, reference, variant, month.month)
        await readDayItems(bucket, manifest, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0

        if (items.length >= maximum) {
            return
        }
    }
}

async function readDayItems(
    bucket: R2Bucket,
    day: RecentFeedDayManifest,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position

    for (const hour of day.hours) {
        if (remainingPosition >= hour.itemCount) {
            remainingPosition -= hour.itemCount
            continue
        }

        await readHourItems(bucket, hour, variant, remainingPosition, maximum, items, objectCache)
        remainingPosition = 0

        if (items.length >= maximum) {
            return
        }
    }
}

async function readHourItems(
    bucket: R2Bucket,
    hour: RecentFeedHourReference,
    variant: RecentFeedVariant,
    position: number,
    maximum: number,
    items: RecentMediaItem[],
    objectCache: Map<string, unknown>,
): Promise<void> {
    let remainingPosition = position

    for (const reference of hour.blocks) {
        if (remainingPosition >= reference.itemCount) {
            remainingPosition -= reference.itemCount
            continue
        }

        const block = await readCachedJson(bucket, reference.key, RecentFeedBlockSchema, objectCache)

        if (block.variant !== variant || block.hour !== hour.hour || block.items.length !== reference.itemCount) {
            throw new RecentFeedUnavailableError('Recent feed block does not match its reference')
        }

        items.push(...block.items.slice(remainingPosition, remainingPosition + (maximum - items.length)))
        remainingPosition = 0

        if (items.length >= maximum) {
            return
        }
    }
}

function assertYearManifest(manifest: RecentFeedYearManifest, reference: RecentFeedYearReference, variant: RecentFeedVariant): void {
    if (
        manifest.variant !== variant ||
        manifest.year !== reference.year ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.months) ||
        manifest.months.some((month) => !month.month.startsWith(`${manifest.year}-`))
    ) {
        throw new RecentFeedUnavailableError('Recent feed year manifest does not match its reference')
    }
}

function assertMonthManifest(
    manifest: RecentFeedMonthManifest,
    reference: RecentFeedMonthReference,
    variant: RecentFeedVariant,
    year: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.month !== reference.month ||
        !manifest.month.startsWith(`${year}-`) ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.days) ||
        manifest.days.some((day) => !day.day.startsWith(`${manifest.month}-`))
    ) {
        throw new RecentFeedUnavailableError('Recent feed month manifest does not match its reference')
    }
}

function assertDayManifest(
    manifest: RecentFeedDayManifest,
    reference: RecentFeedDayReference,
    variant: RecentFeedVariant,
    month: string,
): void {
    if (
        manifest.variant !== variant ||
        manifest.day !== reference.day ||
        !manifest.day.startsWith(`${month}-`) ||
        manifest.itemCount !== reference.itemCount ||
        manifest.itemCount !== sumItemCounts(manifest.hours) ||
        manifest.hours.some((hour) => !hour.hour.startsWith(`${manifest.day}T`) || hour.itemCount !== sumItemCounts(hour.blocks))
    ) {
        throw new RecentFeedUnavailableError('Recent feed day manifest does not match its reference')
    }
}

async function readCachedJson<T>(bucket: R2Bucket, key: string, schema: z.ZodType<T>, objectCache: Map<string, unknown>): Promise<T> {
    const cached = objectCache.get(key)

    if (cached !== undefined) {
        return schema.parse(cached)
    }

    const object = await bucket.get(key)

    if (!object) {
        throw new RecentFeedUnavailableError(`Recent feed object is missing: ${key}`)
    }

    const value: unknown = await object.json<unknown>()
    const parsed = schema.parse(value)
    objectCache.set(key, parsed)
    return parsed
}

function sumItemCounts(values: Array<{itemCount: number}>): number {
    return values.reduce((total, value) => total + value.itemCount, 0)
}

async function getRevokedMediaIds(db: D1Database, ids: string[], generationRevision: number): Promise<Set<string>> {
    if (ids.length === 0) {
        return new Set()
    }

    const placeholders = ids.map(() => '?').join(', ')
    const result = await db
        .prepare(
            `SELECT media_id
             FROM recent_feed_revocations
             WHERE media_id IN (${placeholders})
               AND (visible_from_revision IS NULL OR ? < visible_from_revision)`,
        )
        .bind(...ids, generationRevision)
        .all<{media_id: string}>()

    return new Set((result.results ?? []).map((row) => row.media_id))
}

async function encodeRecentFeedCursor(payload: RecentFeedCursorPayload, secret: string): Promise<string> {
    const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))
    const signature = await signCursor(encodedPayload, secret)

    return `r1.${encodedPayload}.${toBase64Url(signature)}`
}

async function decodeRecentFeedCursor(value: string, secret: string): Promise<RecentFeedCursorPayload> {
    if (value.length > 512) {
        throw new InvalidRecentFeedCursorError()
    }

    const parts = value.split('.')

    if (parts.length !== 3 || parts[0] !== 'r1' || !parts[1] || !parts[2]) {
        throw new InvalidRecentFeedCursorError()
    }

    try {
        const key = await importCursorKey(secret, ['verify'])
        const valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(parts[2]), new TextEncoder().encode(parts[1]))

        if (!valid) {
            throw new InvalidRecentFeedCursorError()
        }

        return RecentFeedCursorPayloadSchema.parse(JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))))
    } catch (error) {
        if (error instanceof InvalidRecentFeedCursorError) {
            throw error
        }

        throw new InvalidRecentFeedCursorError()
    }
}

async function signCursor(payload: string, secret: string): Promise<ArrayBuffer> {
    const key = await importCursorKey(secret, ['sign'])
    return await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
}

async function importCursorKey(secret: string, usages: Array<'sign' | 'verify'>): Promise<CryptoKey> {
    return await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, usages)
}

function toBase64Url(bytes: Uint8Array | ArrayBuffer): string {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
    let binary = ''

    for (const byte of view) {
        binary += String.fromCharCode(byte)
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string): Uint8Array {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new InvalidRecentFeedCursorError()
    }

    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(`${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`)

    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
