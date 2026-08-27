import {afterEach, describe, expect, it, vi} from 'vitest'
import app from '../index'
import {getGeneratedRecentMediaPage} from '../lib/recentMedia/reader'
import {createMockDb} from '../test/mockD1'
import {createWorkerEnv, resetWorkerBindings} from '../test/workerBindings'

vi.mock('../lib/recentMedia/reader', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../lib/recentMedia/reader')>()),
    getGeneratedRecentMediaPage: vi.fn(),
}))

const mockedGetGeneratedRecentMediaPage = vi.mocked(getGeneratedRecentMediaPage)

afterEach(async () => {
    mockedGetGeneratedRecentMediaPage.mockReset()
    await resetWorkerBindings()
})

function page(previewPath: string) {
    return {
        items: [
            {
                id: 'media-newest',
                groupId: '["owner-1","character-1"]',
                alt: 'Quartz Dragon character art',
                width: 900,
                height: 600,
                previewSrc: `https://m.myoc.art/${previewPath}`,
                originalSrc: 'https://m.myoc.art/original.webp',
                character: {
                    name: 'Quartz Dragon',
                    href: '/u/owner/Quartz%20Dragon',
                    avatarUrl: 'https://m.myoc.art/character.webp',
                },
                user: {username: 'owner', href: '/u/owner', avatarUrl: null, initial: 'O'},
            },
        ],
        nextCursor: null,
        nextPosition: null,
        publicRootUrl: 'https://feed.example/generations/v1/roots/r1-demo.json',
        generation: 'r1-demo',
        publishedAt: '2026-08-25T12:05:00.000Z',
    }
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
    it('uses guest-safe defaults for the R2-backed page', async () => {
        mockedGetGeneratedRecentMediaPage.mockResolvedValue(page('sfw-preview.webp'))
        const {db} = createMockDb()

        const response = await app.request('https://example.com/recent', {}, createWorkerEnv({DB: db}))
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('data-show-nsfw="false"')
        expect(html).toContain('data-show-unapproved="true"')
        expect(html).toContain('Show NSFW media</button>')
        expect(html).toContain('Hide unapproved</button>')
        expect(html).toContain('sfw-preview.webp')
        expect(mockedGetGeneratedRecentMediaPage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({showNsfw: false, showUnapproved: true}),
        )
    })

    it('uses signed-in account media preferences for the R2 variant', async () => {
        const viewer = currentUser()
        const {db} = createMockDb({firstResults: [viewer, viewer]})
        mockedGetGeneratedRecentMediaPage.mockResolvedValue(page('nsfw-preview.webp'))

        const response = await app.request(
            'https://example.com/recent',
            {headers: {cookie: 'myoc_session=session-token'}},
            createWorkerEnv({DB: db}),
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('href="/u/viewer"')
        expect(html).toContain('data-show-nsfw="true"')
        expect(html).toContain('data-show-unapproved="false"')
        expect(html).toContain('Hide NSFW media</button>')
        expect(html).toContain('Show unapproved</button>')
        expect(html).toContain('nsfw-preview.webp')
        expect(mockedGetGeneratedRecentMediaPage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({showNsfw: true, showUnapproved: false}),
        )
    })
})
