import {z} from 'zod'
import {
    normalizeRecentMediaLimit,
    type RecentMediaOptions,
    type RecentMediaPage,
    type RecentMediaRow,
    type RecentMediaSourceCursor,
    type RecentMediaState,
    recentMediaItemsFromRows,
} from '../recentMedia'

const RECENT_FEED_VARIANTS = ['n0-u0', 'n0-u1', 'n1-u0', 'n1-u1'] as const
type RecentFeedVariant = (typeof RECENT_FEED_VARIANTS)[number]

const RECENT_MEDIA_SELECT_COLUMNS = `character_media.id,
                character_media.user_id,
                character_media.character_id,
                character_media.sfw_image_key,
                character_media.sfw_preview_image_key,
                character_media.sfw_preview_content_type,
                character_media.sfw_content_type,
                character_media.sfw_width,
                character_media.sfw_height,
                character_media.sfw_preview_width,
                character_media.sfw_preview_height,
                character_media.sfw_review_status,
                character_media.sfw_approved_at,
                character_media.nsfw_image_key,
                character_media.nsfw_preview_image_key,
                character_media.nsfw_preview_content_type,
                character_media.nsfw_content_type,
                character_media.nsfw_width,
                character_media.nsfw_height,
                character_media.nsfw_preview_width,
                character_media.nsfw_preview_height,
                character_media.nsfw_review_status,
                character_media.nsfw_approved_at,
                character_media.created_at,
                character_media.updated_at,
                characters.name              AS character_name,
                characters.profile_image_key AS character_profile_image_key,
                users.username               AS owner_username,
                users.profile_photo_key      AS owner_profile_photo_key`

const RECENT_MEDIA_FROM_CLAUSE = `FROM character_media
         INNER JOIN characters ON characters.id = character_media.character_id
         INNER JOIN users ON users.id = characters.user_id`

const RECENT_FEED_HEAD_CACHE_TTL_MS = 20_000

const RecentFeedCursorPayloadSchema = z.object({
    version: z.literal(2),
    variant: z.enum(RECENT_FEED_VARIANTS),
    createdAt: z.string().min(1).max(64),
    id: z.string().min(1).max(128),
})

type RecentFeedCursorPayload = z.infer<typeof RecentFeedCursorPayloadSchema>

export class InvalidRecentFeedCursorError extends Error {
    constructor() {
        super('Recent media cursor is invalid')
    }
}

export type RecentFeedQueryEnv = {
    DB: D1Database
    MEDIA_PUBLIC_BASE_URL: string
    RECENT_FEED_CURSOR_SECRET?: string
}

type RecentFeedQueryRequest = {
    cursor: RecentMediaSourceCursor | null
    limit: number
    showNsfw: boolean
    showUnapproved: boolean
    variant: RecentFeedVariant
}

const headCache = new Map<RecentFeedVariant, {expiresAt: number; head: string | null}>()

function recentFeedVariantKey(showNsfw: boolean, showUnapproved: boolean): RecentFeedVariant {
    return `n${showNsfw ? 1 : 0}-u${showUnapproved ? 1 : 0}`
}

/** @internal The head cache is per isolate; tests reset it between database clears. */
export function resetRecentFeedHeadCache(): void {
    headCache.clear()
}

export async function getRecentMediaPage(env: RecentFeedQueryEnv, options: RecentMediaOptions = {}): Promise<RecentMediaPage> {
    const request = await toRecentFeedQueryRequest(env, options)
    const rows = await queryRecentMediaFeedPage(env.DB, request)
    const hasMore = rows.length > request.limit
    const pageRows = hasMore ? rows.slice(0, request.limit) : rows
    const items = recentMediaItemsFromRows(pageRows, env.MEDIA_PUBLIC_BASE_URL, request.showNsfw, request.showUnapproved)
    const lastRow = pageRows.at(-1)
    const nextCursor =
        hasMore && lastRow
            ? await encodeRecentFeedCursor(
                  {version: 2, variant: request.variant, createdAt: lastRow.created_at, id: lastRow.id},
                  requireCursorSecret(env),
              )
            : null

    return {
        items,
        nextCursor,
        head: await getRecentFeedHead(env, request.variant),
    }
}

export async function getRecentMediaState(
    env: RecentFeedQueryEnv,
    options: RecentMediaOptions & {cursor?: string | null} = {},
): Promise<RecentMediaState> {
    const request = await toRecentFeedQueryRequest(env, options)
    const head = await getRecentFeedHead(env, request.variant)
    let newCount = 0

    if (request.cursor) {
        const row = await env.DB.prepare(
            `SELECT COUNT(*) AS count
             ${RECENT_MEDIA_FROM_CLAUSE}
             WHERE ${recentFeedVariantFilterSql(request.showNsfw, request.showUnapproved)}
               AND (character_media.created_at > ?
                    OR (character_media.created_at = ? AND character_media.id > ?))`,
        )
            .bind(request.cursor.createdAt, request.cursor.createdAt, request.cursor.id)
            .first<{count: number | string}>()

        newCount = Number(row?.count ?? 0)

        if (!Number.isSafeInteger(newCount) || newCount < 0) {
            newCount = 0
        }
    }

    return {head, newCount}
}

async function toRecentFeedQueryRequest(
    env: RecentFeedQueryEnv,
    options: RecentMediaOptions & {cursor?: string | null},
): Promise<RecentFeedQueryRequest> {
    const showNsfw = options.showNsfw === true
    const showUnapproved = options.showUnapproved !== false
    const variant = recentFeedVariantKey(showNsfw, showUnapproved)
    const cursorSecret = requireCursorSecret(env)
    let cursor: RecentMediaSourceCursor | null = null

    if (options.cursor) {
        const payload = await decodeRecentFeedCursor(options.cursor, cursorSecret)

        if (payload.variant !== variant) {
            throw new InvalidRecentFeedCursorError()
        }

        cursor = {createdAt: payload.createdAt, id: payload.id}
    }

    return {cursor, limit: normalizeRecentMediaLimit(options.limit), showNsfw, showUnapproved, variant}
}

function requireCursorSecret(env: RecentFeedQueryEnv): string {
    const secret = env.RECENT_FEED_CURSOR_SECRET?.trim()

    if (!secret || new TextEncoder().encode(secret).byteLength < 32) {
        throw new Error('Recent feed cursor secret is not configured')
    }

    return secret
}

async function queryRecentMediaFeedPage(db: D1Database, request: RecentFeedQueryRequest): Promise<RecentMediaRow[]> {
    const filter = recentFeedVariantFilterSql(request.showNsfw, request.showUnapproved)
    const cursorClause = request.cursor
        ? `AND (character_media.created_at < ?
                OR (character_media.created_at = ? AND character_media.id < ?))`
        : ''
    const statement = db.prepare(
        `SELECT ${RECENT_MEDIA_SELECT_COLUMNS}
         ${RECENT_MEDIA_FROM_CLAUSE}
         WHERE ${filter}
         ${cursorClause}
         ORDER BY character_media.created_at DESC, character_media.id DESC
         LIMIT ?`,
    )
    const result = request.cursor
        ? await statement
              .bind(request.cursor.createdAt, request.cursor.createdAt, request.cursor.id, request.limit + 1)
              .all<RecentMediaRow>()
        : await statement.bind(request.limit + 1).all<RecentMediaRow>()

    return result.results
}

async function getRecentFeedHead(env: RecentFeedQueryEnv, variant: RecentFeedVariant): Promise<string | null> {
    const now = Date.now()
    const cached = headCache.get(variant)

    if (cached && cached.expiresAt > now) {
        return cached.head
    }

    const cursorSecret = requireCursorSecret(env)
    const showNsfw = variant.startsWith('n1')
    const showUnapproved = variant.endsWith('u1')
    const row = await env.DB.prepare(
        `SELECT character_media.id, character_media.created_at
         ${RECENT_MEDIA_FROM_CLAUSE}
         WHERE ${recentFeedVariantFilterSql(showNsfw, showUnapproved)}
         ORDER BY character_media.created_at DESC, character_media.id DESC
         LIMIT 1`,
    )
        .bind()
        .first<{id: string; created_at: string}>()
    const head = row ? await encodeRecentFeedCursor({version: 2, variant, createdAt: row.created_at, id: row.id}, cursorSecret) : null

    headCache.set(variant, {expiresAt: now + RECENT_FEED_HEAD_CACHE_TTL_MS, head})

    return head
}

function recentFeedVariantFilterSql(showNsfw: boolean, showUnapproved: boolean): string {
    const sfwFilter = recentFeedRatingFilterSql('sfw', showUnapproved)
    const nsfwFilter = recentFeedRatingFilterSql('nsfw', showUnapproved)

    return showNsfw ? `((${nsfwFilter}) OR (${sfwFilter}))` : `(${sfwFilter})`
}

function recentFeedRatingFilterSql(rating: 'sfw' | 'nsfw', showUnapproved: boolean): string {
    const approvalFilter = showUnapproved
        ? ''
        : ` AND character_media.${rating}_review_status = 'approved'
           AND character_media.${rating}_approved_at IS NOT NULL
           AND character_media.${rating}_approved_at >= character_media.updated_at`

    return `character_media.${rating}_image_key IS NOT NULL
            AND character_media.${rating}_preview_image_key IS NOT NULL${approvalFilter}`
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
