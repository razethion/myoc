import {z} from 'zod'
import {normalizeRecentMediaLimit, type RecentMediaItem, type RecentMediaOptions, type RecentMediaPage} from '../recentMedia'
import {getRecentFeedConfig, RECENT_FEED_VARIANTS, recentFeedPublicObjectUrl, recentFeedVariant} from './config'
import {type RecentFeedPointer, type RecentFeedRoot, RecentFeedRootSchema, type RecentFeedVariantRoot} from './model'
import {getRecentFeedPointer} from './publisher'
import {readRecentFeedTreeItems} from './tree'

const RecentFeedCursorPayloadSchema = z.object({
    version: z.literal(1),
    generation: z.string().min(1).max(128),
    variant: z.enum(RECENT_FEED_VARIANTS),
    position: z.number().int().nonnegative(),
})

type RecentFeedReaderEnv = {
    DB: D1Database
    RECENT_FEED_BLOCK_ITEMS?: string
    RECENT_FEED_BUCKET: R2Bucket
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
    RECENT_FEED_PUBLISH_ENABLED?: string
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

type RecentFeedReaderRequest = {
    cursor: RecentFeedCursorPayload | null
    generation: string | null
    position: number
    variant: RecentFeedCursorPayload['variant']
}

type LoadedRecentFeed = {
    initialItems: RecentMediaItem[] | undefined
    pointer: RecentFeedPointer
    root: RecentFeedRoot
    variantRoot: RecentFeedVariantRoot
}

type CollectedRecentMedia = {
    consumed: number
    items: RecentMediaItem[]
}

export async function getGeneratedRecentMediaPage(
    env: RecentFeedReaderEnv,
    options: RecentMediaOptions & {generation?: string | null} = {},
): Promise<RecentMediaPage> {
    const config = getRecentFeedConfig(env)

    if (!config.cursorSecret) {
        throw new RecentFeedUnavailableError('Recent feed cursor secret is not configured')
    }

    const request = await resolveRecentFeedRequest(options, config.cursorSecret)
    const loaded = await loadRecentFeed(env, request)
    const limit = normalizeRecentMediaLimit(options.limit)
    const collected = await collectRecentMedia(env, request, loaded, limit)
    const nextPosition = request.position + collected.consumed
    const hasMore = nextPosition < loaded.variantRoot.itemCount
    const nextCursor = hasMore
        ? await encodeRecentFeedCursor(
              {version: 1, generation: loaded.root.generation, variant: request.variant, position: nextPosition},
              config.cursorSecret,
          )
        : null

    return {
        items: collected.items,
        nextCursor,
        generation: loaded.root.generation,
        publishedAt: loaded.root.publishedAt,
        publicRootUrl: recentFeedPublicObjectUrl(config.publicBaseUrl, loaded.pointer.rootKey),
        nextPosition: hasMore ? nextPosition : null,
    }
}

async function resolveRecentFeedRequest(
    options: RecentMediaOptions & {generation?: string | null},
    cursorSecret: string,
): Promise<RecentFeedReaderRequest> {
    const variant = recentFeedVariant(options.showNsfw === true, options.showUnapproved !== false)
    const cursor = options.cursor ? await decodeRecentFeedCursor(options.cursor, cursorSecret) : null

    if (cursor && cursor.variant !== variant) {
        throw new InvalidRecentFeedCursorError()
    }
    if (cursor && options.generation && cursor.generation !== options.generation) {
        throw new InvalidRecentFeedCursorError()
    }

    return {
        cursor,
        generation: cursor?.generation ?? options.generation?.trim() ?? null,
        position: cursor?.position ?? 0,
        variant,
    }
}

async function loadRecentFeed(env: RecentFeedReaderEnv, request: RecentFeedReaderRequest): Promise<LoadedRecentFeed> {
    const pointer = request.generation ? await getGenerationPointer(env.DB, request.generation) : await getRecentFeedPointer(env.DB)
    if (!pointer) throw unavailableGenerationError(request.generation)

    const rootObject = await env.RECENT_FEED_BUCKET.get(pointer.rootKey)
    if (!rootObject) throw unavailableGenerationError(request.generation)

    const root = RecentFeedRootSchema.parse(await rootObject.json<unknown>())
    validateRecentFeedRoot(root, pointer, request.generation)
    const variantRoot = root.variants[request.variant]
    const initialItems = root.initialItems?.[request.variant]
    validateRecentFeedVariant(variantRoot, initialItems, request.position)

    return {initialItems, pointer, root, variantRoot}
}

function unavailableGenerationError(generation: string | null): Error {
    return generation ? new RecentFeedGenerationExpiredError() : new RecentFeedUnavailableError()
}

function validateRecentFeedRoot(root: RecentFeedRoot, pointer: RecentFeedPointer, generation: string | null): void {
    if (
        root.generation !== pointer.generation ||
        root.throughRevision !== pointer.throughRevision ||
        (generation !== null && root.generation !== generation)
    ) {
        throw new RecentFeedGenerationExpiredError()
    }
}

function validateRecentFeedVariant(
    variantRoot: RecentFeedVariantRoot,
    initialItems: RecentMediaItem[] | undefined,
    position: number,
): void {
    if (variantRoot.itemCount !== sumItemCounts(variantRoot.years)) {
        throw new RecentFeedUnavailableError('Recent feed variant does not match its root')
    }
    if (initialItems && initialItems.length > variantRoot.itemCount) {
        throw new RecentFeedUnavailableError('Recent feed initial items do not match its root')
    }
    if (position > variantRoot.itemCount) {
        throw new InvalidRecentFeedCursorError()
    }
}

async function collectRecentMedia(
    env: RecentFeedReaderEnv,
    request: RecentFeedReaderRequest,
    loaded: LoadedRecentFeed,
    limit: number,
): Promise<CollectedRecentMedia> {
    const items: RecentMediaItem[] = []
    const objectCache = new Map<string, unknown>()
    const batchSize = Math.max(limit * 2, 30)
    const scanItemCount =
        loaded.initialItems && request.position < loaded.initialItems.length ? loaded.initialItems.length : loaded.variantRoot.itemCount
    let consumed = 0

    while (items.length < limit && request.position + consumed < scanItemCount) {
        const scannedItems = await scanRecentMediaBatch(env, request, loaded, request.position + consumed, batchSize, objectCache)
        if (scannedItems.length === 0) break

        const revokedIds = await getRevokedMediaIds(
            env.DB,
            scannedItems.map((item) => item.id),
            loaded.root.throughRevision,
        )
        const appended = appendVisibleItems(items, scannedItems, revokedIds, limit)
        consumed += appended
    }

    return {consumed, items}
}

async function scanRecentMediaBatch(
    env: RecentFeedReaderEnv,
    request: RecentFeedReaderRequest,
    loaded: LoadedRecentFeed,
    position: number,
    limit: number,
    objectCache: Map<string, unknown>,
): Promise<RecentMediaItem[]> {
    if (loaded.initialItems && position < loaded.initialItems.length) {
        return loaded.initialItems.slice(position, position + limit)
    }

    return await readRecentFeedTreeItems(env.RECENT_FEED_BUCKET, loaded.variantRoot, request.variant, position, limit, objectCache)
}

function appendVisibleItems(target: RecentMediaItem[], scannedItems: RecentMediaItem[], revokedIds: Set<string>, limit: number): number {
    let consumed = 0

    for (const item of scannedItems) {
        consumed += 1
        if (!revokedIds.has(item.id)) target.push(item)
        if (target.length === limit) break
    }

    return consumed
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

function sumItemCounts(values: Array<{itemCount: number}>): number {
    return values.reduce((total, value) => total + value.itemCount, 0)
}

async function getRevokedMediaIds(db: D1Database, ids: string[], generationRevision: number): Promise<Set<string>> {
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

    return new Set(result.results.map((row) => row.media_id))
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

    let valid: boolean

    try {
        const key = await importCursorKey(secret, ['verify'])
        valid = await crypto.subtle.verify('HMAC', key, fromBase64Url(parts[2]), new TextEncoder().encode(parts[1]))
    } catch {
        throw new InvalidRecentFeedCursorError()
    }

    if (!valid) {
        throw new InvalidRecentFeedCursorError()
    }

    try {
        return RecentFeedCursorPayloadSchema.parse(JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1]))))
    } catch {
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
