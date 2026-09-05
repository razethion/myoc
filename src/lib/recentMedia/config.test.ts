import {describe, expect, it} from 'vitest'
import {getRecentFeedConfig, recentFeedPublicObjectUrl, recentFeedVariant, recentFeedVariantOptions} from './config'

describe('recent feed configuration', () => {
    it('uses safe defaults when settings are absent', () => {
        expect(getRecentFeedConfig({})).toEqual({
            blockItems: 96,
            cleanupEnabled: false,
            cursorSecret: null,
            immutableCacheControl: 'public, max-age=2592000, immutable',
            publishEnabled: false,
            publicBaseUrl: null,
            retentionDays: 30,
        })
    })

    it('accepts enabled settings and limits numeric settings to safe bounds', () => {
        const cursorSecret = 'a'.repeat(32)

        expect(
            getRecentFeedConfig({
                RECENT_FEED_BLOCK_ITEMS: '8',
                RECENT_FEED_CLEANUP_ENABLED: 'true',
                RECENT_FEED_CURSOR_SECRET: `  ${cursorSecret}  `,
                RECENT_FEED_PUBLISH_ENABLED: 'true',
                RECENT_FEED_PUBLIC_BASE_URL: ' https://m.myoc.art ',
                RECENT_FEED_RETENTION_DAYS: '500',
            }),
        ).toEqual({
            blockItems: 24,
            cleanupEnabled: true,
            cursorSecret,
            immutableCacheControl: 'public, max-age=31536000, immutable',
            publishEnabled: true,
            publicBaseUrl: 'https://m.myoc.art',
            retentionDays: 365,
        })
    })

    it('uses numeric defaults and rejects short cursor secrets', () => {
        const config = getRecentFeedConfig({
            RECENT_FEED_BLOCK_ITEMS: '48.5',
            RECENT_FEED_CURSOR_SECRET: 'too-short',
            RECENT_FEED_RETENTION_DAYS: 'not-a-number',
        })

        expect(config.blockItems).toBe(96)
        expect(config.cursorSecret).toBeNull()
        expect(config.retentionDays).toBe(30)
    })

    it('accepts an HTTPS public origin', () => {
        const config = getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'https://m.myoc.art'})

        expect(config.publicBaseUrl).toBe('https://m.myoc.art')
        expect(recentFeedPublicObjectUrl(config.publicBaseUrl, 'recent-feed/generations/v1/roots/r1-demo.json')).toBe(
            'https://m.myoc.art/recent-feed/generations/v1/roots/r1-demo.json',
        )
    })

    it('rejects unsafe public origins and object keys', () => {
        // noinspection HttpUrlsUsage -- This test requires an insecure URL.
        expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'http://feed-data.myoc.art'}).publicBaseUrl).toBeNull()
        expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'https://user:pass@feed-data.myoc.art'}).publicBaseUrl).toBeNull()
        expect(recentFeedPublicObjectUrl('https://m.myoc.art', '../private.json')).toBeNull()
        expect(recentFeedPublicObjectUrl('https://m.myoc.art', 'recent-feed/generations/v1/../../private.json')).toBeNull()
    })

    it.each([
        {showNsfw: false, showUnapproved: false, variant: 'n0-u0' as const},
        {showNsfw: false, showUnapproved: true, variant: 'n0-u1' as const},
        {showNsfw: true, showUnapproved: false, variant: 'n1-u0' as const},
        {showNsfw: true, showUnapproved: true, variant: 'n1-u1' as const},
    ])('round-trips the $variant feed variant', ({showNsfw, showUnapproved, variant}) => {
        expect(recentFeedVariant(showNsfw, showUnapproved)).toBe(variant)
        expect(recentFeedVariantOptions(variant)).toEqual({showNsfw, showUnapproved})
    })
})
