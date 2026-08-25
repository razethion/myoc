import {afterEach, describe, expect, it} from 'vitest'
import app from '../index'
import {createCsrfToken} from '../lib/auth/session'
import {createMockDb} from '../test/mockD1'
import {createMockKVNamespace} from '../test/mockKV'
import {createWorkerEnv, resetWorkerBindings} from '../test/workerBindings'

afterEach(async () => {
    await resetWorkerBindings()
})

const RECENT_MEDIA_CACHE_TTL_SECONDS = 2 * 60

const row = {
    id: 'media-newest',
    user_id: 'user-1',
    character_id: 'character-1',
    sfw_image_key: 'original-key',
    sfw_preview_image_key: 'preview-key',
    sfw_content_type: 'image/webp',
    sfw_artist: 'Demo Artist',
    sfw_width: 1200,
    sfw_height: 800,
    sfw_preview_width: 900,
    sfw_preview_height: 600,
    sfw_review_status: 'pending',
    sfw_approved_at: null,
    nsfw_image_key: null,
    nsfw_preview_image_key: null,
    nsfw_content_type: null,
    nsfw_width: null,
    nsfw_height: null,
    nsfw_preview_width: null,
    nsfw_preview_height: null,
    nsfw_review_status: 'pending',
    nsfw_approved_at: null,
    created_at: '2026-08-23 12:59:00',
    updated_at: '2026-08-23 12:59:00',
    character_name: 'Quartz Dragon',
    character_profile_image_key: 'character-profile',
    owner_username: 'demo_owner',
    owner_profile_photo_key: null,
}

describe('recent media routes', () => {
    it('renders a full-width desktop grid and a one-card mobile feed', async () => {
        const {db, boundStatements} = createMockDb({allResults: [[row]]})
        const cache = createMockKVNamespace()
        const response = await app.request(
            'https://example.com/recent',
            {},
            createWorkerEnv({CACHE: cache, DB: db, MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art'}),
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Recently uploaded media | MyOC</title>')
        expect(html).toContain('Recently uploaded')
        expect(html).not.toContain('The latest approved character art')
        expect(html).toContain('Show NSFW media</button>')
        expect(html).toContain('Hide unapproved</button>')
        expect(html).toContain('data-show-nsfw="false"')
        expect(html).toContain('data-show-unapproved="true"')
        expect(html).toContain('recent-media-row contents md:flex')
        expect(html).toContain('recent-media-tile card card-border')
        expect(html).toContain('card-body p-3 md:hidden')
        expect(html.indexOf('data-recent-media-image')).toBeLessThan(html.indexOf('data-mobile-credits'))
        expect(html).toContain('data-desktop-credits')
        expect(html).toContain('bg-linear-to-t from-neutral/90 via-neutral/50 to-transparent')
        expect(html).toContain('md:group-hover:opacity-100')
        expect(html).toContain('Character</span>')
        expect(html).toContain('Uploader</span>')
        expect(html).toContain('Quartz Dragon')
        expect(html).toContain('demo_owner')
        expect(html).not.toContain('Art by')
        expect(html).not.toContain('<time')
        expect(html).not.toContain('Demo Artist')
        expect(html).toContain('@container (max-width: 15rem)')
        expect(html).toContain('recent-media-owner-credit')
        expect(html).toContain('href="/u/demo_owner/Quartz%20Dragon"')
        expect(html).toContain('src="https://m.myoc.art/characters/user-1/character-1/media/media-newest/sfw/preview/preview-key.webp"')
        expect(html).toContain('data-recent-sentinel')
        expect(boundStatements[0]?.sql).not.toContain("character_media.sfw_review_status = 'approved'")
        expect(cache.put).toHaveBeenCalledWith('recent-media:v3:24:n0:u1:first', expect.any(String), {
            expirationTtl: RECENT_MEDIA_CACHE_TTL_SECONDS,
        })
    })

    it('uses account defaults for NSFW and unapproved media', async () => {
        const sessionToken = 'session-token'
        const currentUser = {
            id: 'viewer-1',
            session_id: 'session-1',
            email: 'viewer@example.com',
            username: 'viewer',
            role: 'user',
            profile_photo_key: null,
            bio: '',
            display_nsfw_media: 1,
            show_unapproved_media: 0,
            last_seen_version: null,
            recovery_phrase_confirmed_at: null,
            secure_account_required: 0,
            passkey_prompt_seen_at: '2026-08-01 00:00:00',
        }
        const nsfwRow = {
            ...row,
            sfw_review_status: 'approved',
            sfw_approved_at: '2026-08-23 13:00:00',
            nsfw_image_key: 'nsfw-original',
            nsfw_preview_image_key: 'nsfw-preview',
            nsfw_content_type: 'image/webp',
            nsfw_width: 700,
            nsfw_height: 1000,
            nsfw_preview_width: 490,
            nsfw_preview_height: 700,
            nsfw_review_status: 'approved',
            nsfw_approved_at: '2026-08-23 13:00:00',
        }
        const {db, boundStatements} = createMockDb({firstResults: [currentUser, currentUser], allResults: [[nsfwRow]]})
        const cache = createMockKVNamespace()
        const response = await app.request(
            'https://example.com/recent',
            {headers: {cookie: `myoc_session=${sessionToken}`}},
            createWorkerEnv({CACHE: cache, DB: db, MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art'}),
        )
        const html = await response.text()
        const mediaQuery = boundStatements.find((statement) => statement.sql.includes('FROM character_media'))

        expect(response.status).toBe(200)
        expect(html).toContain('Hide NSFW media</button>')
        expect(html).toContain('Show unapproved</button>')
        expect(html).toContain('/nsfw/preview/nsfw-preview.webp')
        expect(mediaQuery?.sql).toContain("character_media.nsfw_review_status = 'approved'")
        expect(cache.put).toHaveBeenCalledWith('recent-media:v3:24:n1:u0:first', expect.any(String), {
            expirationTtl: RECENT_MEDIA_CACHE_TTL_SECONDS,
        })
    })

    it('stores the unapproved media preference for the signed-in account', async () => {
        const sessionToken = 'session-token'
        const currentUser = {
            id: 'viewer-1',
            session_id: 'session-1',
            email: 'viewer@example.com',
            username: 'viewer',
            role: 'user',
            profile_photo_key: null,
            bio: '',
            display_nsfw_media: 0,
            show_unapproved_media: 1,
            last_seen_version: null,
            recovery_phrase_confirmed_at: null,
            secure_account_required: 0,
            passkey_prompt_seen_at: null,
        }
        const {db, boundStatements} = createMockDb({firstResults: [currentUser]})
        const response = await app.request(
            'https://example.com/api/users/me/recent-media-preference',
            {
                method: 'POST',
                body: JSON.stringify({showUnapproved: false}),
                headers: {
                    'content-type': 'application/json',
                    cookie: `myoc_session=${sessionToken}`,
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            createWorkerEnv({DB: db}),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true, showUnapproved: false})
        expect(boundStatements[1]?.sql).toContain('SET show_unapproved_media = ?')
        expect(boundStatements[1]?.binds).toEqual([0, 'viewer-1'])
    })

    it('returns a client-safe error for malformed API cursors', async () => {
        const {db} = createMockDb()
        const response = await app.request(
            'https://example.com/api/recent-media?cursor=not%2Ba%2Bcursor',
            {headers: {accept: 'application/json'}},
            createWorkerEnv({CACHE: createMockKVNamespace(), DB: db, MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art'}),
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Recent media cursor is invalid'})
        expect(db.prepare).not.toHaveBeenCalled()
    })
})
