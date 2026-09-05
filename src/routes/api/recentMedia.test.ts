import {Hono} from 'hono'
import {describe, expect, it, vi} from 'vitest'
import type {RecentMediaItem} from '../../lib/recentMedia'
import {seedAuthenticatedUser, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {apiRoutes} from '../api'

const app = new Hono<{Bindings: Bindings}>().route('/api', apiRoutes)
const db = useTestDatabase()
const cursorSecret = 'test-secret-with-at-least-thirty-two-characters'
const publicBaseUrl = 'https://m.myoc.art'

describe('recent media API', () => {
    it('returns the unapproved feed variant when the user requests it', async () => {
        const bucket = createMockR2Bucket()
        const rootKey = 'recent-feed/generations/v1/roots/r7-unapproved.json'
        const pendingItem = recentItem('pending-media')
        const emptyRoot = {itemCount: 0, years: []}
        const unapprovedRoot = {
            itemCount: 1,
            years: [{year: '2026', key: 'unused-year.json', itemCount: 1}],
        }
        await bucket.put(
            rootKey,
            JSON.stringify({
                schemaVersion: 1,
                generation: 'r7-unapproved',
                throughRevision: 7,
                publishedAt: '2026-08-25T12:05:00.000Z',
                variants: {
                    'n0-u0': emptyRoot,
                    'n0-u1': unapprovedRoot,
                    'n1-u0': emptyRoot,
                    'n1-u1': unapprovedRoot,
                },
                initialItems: {
                    'n0-u0': [],
                    'n0-u1': [pendingItem],
                    'n1-u0': [],
                    'n1-u1': [pendingItem],
                },
            }),
        )
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET requested_revision = 7,
                     published_revision = 7,
                     generation = 'r7-unapproved',
                     root_key = ?,
                     published_at = '2026-08-25T12:05:00.000Z'
                 WHERE singleton = 1`,
            )
            .bind(rootKey)
            .run()

        const response = await app.request(
            'https://example.com/api/recent-media?nsfw=false&unapproved=true',
            {},
            createWorkerEnv({
                DB: db,
                MEDIA_BUCKET: bucket,
                RECENT_FEED_CURSOR_SECRET: cursorSecret,
                RECENT_FEED_PUBLIC_BASE_URL: publicBaseUrl,
            }),
        )

        expect(response.status).toBe(200)
        expect((await response.json<{items: RecentMediaItem[]}>()).items.map((item) => item.id)).toEqual(['pending-media'])
    })

    it('uses the signed-in user media settings when query settings are absent', async () => {
        await seedAuthenticatedUser(
            {
                id: 'settings-user',
                username: 'settings_user',
                displayNsfwMedia: true,
                showUnapprovedMedia: false,
            },
            'settings-session',
            db,
        )
        const bucket = createMockR2Bucket()
        await publishTestRoot(bucket, {
            'n0-u0': recentItem('safe-approved'),
            'n0-u1': recentItem('safe-unapproved'),
            'n1-u0': recentItem('account-default'),
            'n1-u1': recentItem('all-media'),
        })

        const response = await requestRecentMedia(bucket, '', {
            headers: {Cookie: 'myoc_session=settings-session'},
        })

        expect(response.status).toBe(200)
        expect((await response.json<{items: RecentMediaItem[]}>()).items.map((item) => item.id)).toEqual(['account-default'])
    })

    it('uses public media defaults when there is no signed-in user', async () => {
        const bucket = createMockR2Bucket()
        await publishTestRoot(bucket, {
            'n0-u0': recentItem('safe-approved'),
            'n0-u1': recentItem('public-default'),
            'n1-u0': recentItem('nsfw-approved'),
            'n1-u1': recentItem('all-media'),
        })

        const response = await requestRecentMedia(bucket)

        expect(response.status).toBe(200)
        expect((await response.json<{items: RecentMediaItem[]}>()).items.map((item) => item.id)).toEqual(['public-default'])
    })

    it.each([
        ['an invalid limit', '?limit=0'],
        ['an invalid media setting', '?nsfw=yes'],
        ['a cursor that is too long', `?cursor=${'x'.repeat(513)}`],
    ])('rejects %s', async (_description, query) => {
        const response = await requestRecentMedia(createMockR2Bucket(), query)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media query is invalid'})
    })

    it('rejects an invalid cursor', async () => {
        const response = await requestRecentMedia(createMockR2Bucket(), '?cursor=not-a-signed-cursor')

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media cursor is invalid'})
    })

    it('reports an expired generation', async () => {
        const response = await requestRecentMedia(createMockR2Bucket(), '?generation=missing-generation')

        expect(response.status).toBe(410)
        await expect(response.json()).resolves.toEqual({
            code: 'recent-generation-expired',
            error: 'This recent media list has expired',
        })
    })

    it('returns a D1 first page while no generated feed is published', async () => {
        await seedUser({id: 'fallback-user'})
        await seedCharacter({id: 'fallback-character', userId: 'fallback-user'})
        await seedMedia({
            id: 'fallback-media',
            userId: 'fallback-user',
            characterId: 'fallback-character',
            sfwPreviewImageKey: 'fallback-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:00:00',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })

        const response = await app.request(
            'https://example.com/api/recent-media?nsfw=false&unapproved=false',
            {},
            createWorkerEnv({
                DB: db,
                MEDIA_BUCKET: createMockR2Bucket(),
                RECENT_FEED_CURSOR_SECRET: cursorSecret,
            }),
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({
            items: [{id: 'fallback-media'}],
            generation: null,
            nextCursor: null,
            nextPosition: null,
            publicRootUrl: null,
            publishedAt: null,
        })
    })

    it('returns a server error when R2 fails', async () => {
        const bucket = createMockR2Bucket()
        vi.spyOn(bucket, 'get').mockRejectedValue(new Error('R2 is unavailable'))
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET requested_revision = 7,
                     published_revision = 7,
                     generation = 'r7-unavailable',
                     root_key = 'recent-feed/generations/v1/roots/r7-unavailable.json',
                     published_at = '2026-08-25T12:05:00.000Z'
                 WHERE singleton = 1`,
            )
            .run()

        const response = await app.request(
            'https://example.com/api/recent-media',
            {},
            createWorkerEnv({DB: db, MEDIA_BUCKET: bucket, RECENT_FEED_CURSOR_SECRET: cursorSecret}),
        )

        expect(response.status).toBe(500)
    })

    it('reports that there is no published feed state', async () => {
        const response = await app.request(
            'https://example.com/api/recent-media/state',
            {},
            createWorkerEnv({DB: db, RECENT_FEED_PUBLIC_BASE_URL: publicBaseUrl}),
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('Cache-Control')).toBe('public, max-age=5, must-revalidate')
        await expect(response.json()).resolves.toEqual({
            generation: null,
            publicRootUrl: null,
            publishedAt: null,
            unsafePending: false,
        })
    })

    it('reports the current feed state and pending unsafe changes', async () => {
        await db
            .prepare(
                `UPDATE recent_feed_state
                 SET requested_revision = 8,
                     published_revision = 7,
                     generation = 'r7-state',
                     root_key = 'recent-feed/generations/v1/roots/r7-state.json',
                     published_at = '2026-08-25T12:05:00.000Z'
                 WHERE singleton = 1`,
            )
            .run()
        await db
            .prepare(
                `UPDATE recent_feed_dirty_hours
                 SET revision = 8,
                     urgent = 1
                 WHERE dirty_hour = '*'`,
            )
            .run()

        const response = await app.request(
            'https://example.com/api/recent-media/state',
            {},
            createWorkerEnv({DB: db, RECENT_FEED_PUBLIC_BASE_URL: publicBaseUrl}),
        )

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({
            generation: 'r7-state',
            publicRootUrl: `${publicBaseUrl}/recent-feed/generations/v1/roots/r7-state.json`,
            publishedAt: '2026-08-25T12:05:00.000Z',
            unsafePending: true,
        })
    })
})

async function publishTestRoot(bucket: R2Bucket, items: Record<'n0-u0' | 'n0-u1' | 'n1-u0' | 'n1-u1', RecentMediaItem>): Promise<void> {
    const rootKey = 'recent-feed/generations/v1/roots/r7-settings.json'
    const variants = Object.fromEntries(
        Object.keys(items).map((variant) => [variant, {itemCount: 1, years: [{year: '2026', key: 'unused-year.json', itemCount: 1}]}]),
    )
    const initialItems = Object.fromEntries(Object.entries(items).map(([variant, item]) => [variant, [item]]))

    await bucket.put(
        rootKey,
        JSON.stringify({
            schemaVersion: 1,
            generation: 'r7-settings',
            throughRevision: 7,
            publishedAt: '2026-08-25T12:05:00.000Z',
            variants,
            initialItems,
        }),
    )
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET requested_revision = 7,
                 published_revision = 7,
                 generation = 'r7-settings',
                 root_key = ?,
                 published_at = '2026-08-25T12:05:00.000Z'
             WHERE singleton = 1`,
        )
        .bind(rootKey)
        .run()
}

async function requestRecentMedia(bucket: R2Bucket, query = '', init: RequestInit = {}): Promise<Response> {
    return app.request(
        `https://example.com/api/recent-media${query}`,
        init,
        createWorkerEnv({
            DB: db,
            MEDIA_BUCKET: bucket,
            RECENT_FEED_CURSOR_SECRET: cursorSecret,
            RECENT_FEED_PUBLIC_BASE_URL: publicBaseUrl,
        }),
    )
}

function recentItem(id: string): RecentMediaItem {
    return {
        id,
        groupId: '["user-1","character-1"]',
        alt: 'Pending character art',
        width: 800,
        height: 600,
        previewSrc: `https://m.example.com/${id}-preview.webp`,
        originalSrc: `https://m.example.com/${id}.png`,
        character: {
            name: 'Pending Character',
            href: '/u/demo/pending-character',
            avatarUrl: 'https://m.example.com/character.webp',
        },
        user: {
            username: 'demo',
            href: '/u/demo',
            avatarUrl: null,
            initial: 'D',
        },
    }
}
