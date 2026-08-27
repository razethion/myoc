import {describe, expect, it} from 'vitest'
import {getRecentFeedConfig, type RecentFeedVariant, recentFeedPublicObjectUrl, recentFeedVariant, recentFeedVariantOptions} from './config'

describe('recent feed config coverage', () => {
    it('uses defaults and normalizes boolean settings', () => {
        expect(getRecentFeedConfig({})).toEqual({
            blockItems: 96,
            cleanupEnabled: false,
            cursorSecret: null,
            immutableCacheControl: 'public, max-age=2592000, immutable',
            publishEnabled: false,
            publicBaseUrl: null,
            retentionDays: 30,
        })
        expect(
            getRecentFeedConfig({
                RECENT_FEED_CLEANUP_ENABLED: 'true',
                RECENT_FEED_PUBLISH_ENABLED: 'true',
            }),
        ).toMatchObject({cleanupEnabled: true, publishEnabled: true})
    })

    it('clamps integer settings and uses fallback values for non-integers', () => {
        expect(
            getRecentFeedConfig({
                RECENT_FEED_BLOCK_ITEMS: '24',
                RECENT_FEED_RETENTION_DAYS: '7',
            }),
        ).toMatchObject({blockItems: 24, retentionDays: 7})
        expect(
            getRecentFeedConfig({
                RECENT_FEED_BLOCK_ITEMS: '240.5',
                RECENT_FEED_RETENTION_DAYS: '365.5',
            }),
        ).toMatchObject({blockItems: 96, retentionDays: 30})
        expect(
            getRecentFeedConfig({
                RECENT_FEED_BLOCK_ITEMS: '1',
                RECENT_FEED_RETENTION_DAYS: '999',
            }),
        ).toMatchObject({blockItems: 24, retentionDays: 365})
        expect(getRecentFeedConfig({RECENT_FEED_BLOCK_ITEMS: '999', RECENT_FEED_RETENTION_DAYS: '1'})).toMatchObject({
            blockItems: 240,
            retentionDays: 7,
        })
    })

    it('validates cursor secrets by trimmed UTF-8 length', () => {
        expect(getRecentFeedConfig({RECENT_FEED_CURSOR_SECRET: '  short  '}).cursorSecret).toBeNull()
        expect(getRecentFeedConfig({RECENT_FEED_CURSOR_SECRET: ' '.repeat(32)}).cursorSecret).toBeNull()
        const secret = `  ${'a'.repeat(32)}  `
        expect(getRecentFeedConfig({RECENT_FEED_CURSOR_SECRET: secret}).cursorSecret).toBe('a'.repeat(32))
        expect(getRecentFeedConfig({RECENT_FEED_CURSOR_SECRET: 'é'.repeat(16)}).cursorSecret).toBe('é'.repeat(16))
    })

    it('accepts only safe HTTPS origins', () => {
        expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: ' https://feed.example.test/ '}).publicBaseUrl).toBe(
            'https://feed.example.test',
        )
        for (const value of [
            undefined,
            'not a URL',
            'http://feed.example.test',
            'https://user@feed.example.test',
            'https://:pass@feed.example.test',
            'https://feed.example.test/path',
            'https://feed.example.test/?query=1',
            'https://feed.example.test/#fragment',
        ]) {
            expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: value}).publicBaseUrl).toBeNull()
        }
    })

    it('maps all variant flags', () => {
        expect(recentFeedVariant(false, false)).toBe('n0-u0')
        expect(recentFeedVariant(false, true)).toBe('n0-u1')
        expect(recentFeedVariant(true, false)).toBe('n1-u0')
        expect(recentFeedVariant(true, true)).toBe('n1-u1')
        for (const [variant, options] of Object.entries({
            'n0-u0': {showNsfw: false, showUnapproved: false},
            'n0-u1': {showNsfw: false, showUnapproved: true},
            'n1-u0': {showNsfw: true, showUnapproved: false},
            'n1-u1': {showNsfw: true, showUnapproved: true},
        })) {
            expect(recentFeedVariantOptions(variant as RecentFeedVariant)).toEqual(options)
        }
    })

    it('builds safe public object URLs only for generation JSON keys', () => {
        const baseUrl = 'https://feed.example.test'
        expect(recentFeedPublicObjectUrl(baseUrl, 'generations/v1/a/b-c_1.json')).toBe(
            'https://feed.example.test/generations/v1/a/b-c_1.json',
        )
        expect(recentFeedPublicObjectUrl(null, 'generations/v1/item.json')).toBeNull()
        expect(recentFeedPublicObjectUrl(baseUrl, 'private/item.json')).toBeNull()
        expect(recentFeedPublicObjectUrl(baseUrl, 'generations/v1/../item.json')).toBeNull()
    })
})
