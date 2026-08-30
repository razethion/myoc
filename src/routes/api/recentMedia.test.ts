import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import type {RecentMediaItem} from '../../lib/recentMedia'
import {useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {recentMediaRoutes} from './recentMedia'

const app = new Hono<{Bindings: Bindings}>().route('/api/recent-media', recentMediaRoutes)
const db = useTestDatabase()

describe('recent media API', () => {
    it('returns the unapproved feed variant when the user requests it', async () => {
        const bucket = createMockR2Bucket()
        const rootKey = 'generations/v1/roots/r7-unapproved.json'
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
                RECENT_FEED_BUCKET: bucket,
                RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
                RECENT_FEED_PUBLIC_BASE_URL: 'https://feed-data.myoc.art',
            }),
        )

        expect(response.status).toBe(200)
        expect((await response.json<{items: RecentMediaItem[]}>()).items.map((item) => item.id)).toEqual(['pending-media'])
    })
})

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
