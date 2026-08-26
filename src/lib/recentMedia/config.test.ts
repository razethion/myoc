import {describe, expect, it} from 'vitest'
import {getRecentFeedConfig, recentFeedPublicObjectUrl} from './config'

describe('recent feed configuration', () => {
    it('accepts an HTTPS public origin', () => {
        const config = getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'https://feed-data.myoc.art'})

        expect(config.publicBaseUrl).toBe('https://feed-data.myoc.art')
        expect(recentFeedPublicObjectUrl(config.publicBaseUrl, 'generations/v1/roots/r1-demo.json')).toBe(
            'https://feed-data.myoc.art/generations/v1/roots/r1-demo.json',
        )
    })

    it('rejects unsafe public origins and object keys', () => {
        expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'http://feed-data.myoc.art'}).publicBaseUrl).toBeNull()
        expect(getRecentFeedConfig({RECENT_FEED_PUBLIC_BASE_URL: 'https://user:pass@feed-data.myoc.art'}).publicBaseUrl).toBeNull()
        expect(recentFeedPublicObjectUrl('https://feed-data.myoc.art', '../private.json')).toBeNull()
        expect(recentFeedPublicObjectUrl('https://feed-data.myoc.art', 'generations/v1/../../private.json')).toBeNull()
    })
})
