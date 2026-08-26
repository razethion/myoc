import {afterEach, describe, expect, it} from 'vitest'
import app from '../index'
import {createMockDb} from '../test/mockD1'
import {createMockKVNamespace} from '../test/mockKV'
import {createWorkerEnv, resetWorkerBindings} from '../test/workerBindings'

afterEach(async () => {
    await resetWorkerBindings()
})

const mediaRow = {
    id: 'media-newest',
    user_id: 'owner-1',
    character_id: 'character-1',
    sfw_image_key: 'safe-image',
    sfw_preview_image_key: 'safe-preview',
    sfw_content_type: 'image/webp',
    sfw_width: 1200,
    sfw_height: 800,
    sfw_preview_width: 900,
    sfw_preview_height: 600,
    sfw_review_status: 'pending',
    sfw_approved_at: null,
    nsfw_image_key: 'nsfw-image',
    nsfw_preview_image_key: 'nsfw-preview',
    nsfw_content_type: 'image/webp',
    nsfw_width: 800,
    nsfw_height: 1200,
    nsfw_preview_width: 600,
    nsfw_preview_height: 900,
    nsfw_review_status: 'approved',
    nsfw_approved_at: '2026-08-25 12:00:00',
    created_at: '2026-08-25 12:00:00',
    updated_at: '2026-08-25 12:00:00',
    character_name: 'Quartz Dragon',
    character_profile_image_key: 'character-profile',
    owner_username: 'owner',
    owner_profile_photo_key: null,
}

function currentUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 'viewer-1',
        session_id: 'session-1',
        email: 'viewer@example.test',
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
        ...overrides,
    }
}

describe('GET /recent page route coverage', () => {
    it('uses guest-safe defaults for the rendered recent media page', async () => {
        const {db, boundStatements} = createMockDb({allResults: [[mediaRow]]})
        const cache = createMockKVNamespace()
        const response = await app.request(
            'https://example.com/recent',
            {},
            createWorkerEnv({
                CACHE: cache,
                DB: db,
                MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
            }),
        )
        const html = await response.text()
        const mediaQuery = boundStatements.find((statement) => statement.sql.includes('FROM character_media'))

        expect(response.status).toBe(200)
        expect(html).toContain('data-show-nsfw="false"')
        expect(html).toContain('data-show-unapproved="true"')
        expect(html).toContain('Show NSFW media</button>')
        expect(html).toContain('Hide unapproved</button>')
        expect(html).toContain('/sfw/preview/safe-preview.webp')
        expect(mediaQuery?.sql).not.toContain("character_media.nsfw_review_status = 'approved'")
        expect(cache.put).toHaveBeenCalledWith('recent-media:v4:24:n0:u1:first', expect.any(String), {
            expirationTtl: 120,
        })
    })

    it('uses the signed-in account media preferences', async () => {
        const viewer = currentUser()
        const {db, boundStatements} = createMockDb({firstResults: [viewer, viewer], allResults: [[mediaRow]]})
        const cache = createMockKVNamespace()
        const response = await app.request(
            'https://example.com/recent',
            {headers: {cookie: 'myoc_session=session-token'}},
            createWorkerEnv({
                CACHE: cache,
                DB: db,
                MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
            }),
        )
        const html = await response.text()
        const mediaQuery = boundStatements.find((statement) => statement.sql.includes('FROM character_media'))

        expect(response.status).toBe(200)
        expect(html).toContain('href="/u/viewer"')
        expect(html).toContain('data-show-nsfw="true"')
        expect(html).toContain('data-show-unapproved="false"')
        expect(html).toContain('Hide NSFW media</button>')
        expect(html).toContain('Show unapproved</button>')
        expect(html).toContain('/nsfw/preview/nsfw-preview.webp')
        expect(mediaQuery?.sql).toContain("character_media.nsfw_review_status = 'approved'")
        expect(cache.put).toHaveBeenCalledWith('recent-media:v4:24:n1:u0:first', expect.any(String), {
            expirationTtl: 120,
        })
    })
})
