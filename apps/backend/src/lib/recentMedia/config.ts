export const RECENT_FEED_SCHEMA_VERSION = 1
export const RECENT_FEED_VARIANTS = ['n0-u0', 'n0-u1', 'n1-u0', 'n1-u1'] as const
export const RECENT_FEED_INITIAL_ITEMS = 60

export type RecentFeedVariant = (typeof RECENT_FEED_VARIANTS)[number]

export type RecentFeedConfig = {
    blockItems: number
    cleanupEnabled: boolean
    cursorSecret: string | null
    immutableCacheControl: string
    publishEnabled: boolean
    publicBaseUrl: string | null
    retentionDays: number
}

type RecentFeedConfigEnv = {
    RECENT_FEED_BLOCK_ITEMS?: string
    RECENT_FEED_CLEANUP_ENABLED?: string
    RECENT_FEED_CURSOR_SECRET?: string
    RECENT_FEED_PUBLISH_ENABLED?: string
    RECENT_FEED_PUBLIC_BASE_URL?: string
    RECENT_FEED_RETENTION_DAYS?: string
}

export function getRecentFeedConfig(env: RecentFeedConfigEnv): RecentFeedConfig {
    const retentionDays = integerSetting(env.RECENT_FEED_RETENTION_DAYS, 30, 7, 365)

    return {
        blockItems: integerSetting(env.RECENT_FEED_BLOCK_ITEMS, 96, 24, 240),
        cleanupEnabled: env.RECENT_FEED_CLEANUP_ENABLED === 'true',
        cursorSecret: cursorSecret(env.RECENT_FEED_CURSOR_SECRET),
        immutableCacheControl: `public, max-age=${retentionDays * 24 * 60 * 60}, immutable`,
        publishEnabled: env.RECENT_FEED_PUBLISH_ENABLED === 'true',
        publicBaseUrl: publicBaseUrl(env.RECENT_FEED_PUBLIC_BASE_URL),
        retentionDays,
    }
}

function publicBaseUrl(value: string | undefined): string | null {
    try {
        const url = new URL(value?.trim() ?? '')

        return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
            ? url.origin
            : null
    } catch {
        return null
    }
}

export function recentFeedVariant(showNsfw: boolean, showUnapproved: boolean): RecentFeedVariant {
    return `n${showNsfw ? 1 : 0}-u${showUnapproved ? 1 : 0}`
}

export function recentFeedVariantOptions(variant: RecentFeedVariant): {showNsfw: boolean; showUnapproved: boolean} {
    return {
        showNsfw: variant.startsWith('n1'),
        showUnapproved: variant.endsWith('u1'),
    }
}

export function recentFeedPublicObjectUrl(baseUrl: string | null, key: string): string | null {
    if (!baseUrl || !/^generations\/v1\/[A-Za-z0-9/_-]+\.json$/.test(key) || key.includes('..')) {
        return null
    }

    return `${baseUrl}/${key}`
}

function integerSetting(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
    const parsed = Number(value)

    return Number.isInteger(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback
}

function cursorSecret(value: string | undefined): string | null {
    const normalized = value?.trim()

    return normalized && new TextEncoder().encode(normalized).byteLength >= 32 ? normalized : null
}
