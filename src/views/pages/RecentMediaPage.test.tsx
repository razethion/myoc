import {describe, expect, it} from 'vitest'
import {RecentMediaPage} from './RecentMediaPage'

describe('RecentMediaPage', () => {
    it('renders the saved unapproved media control for a signed-in user', () => {
        const html = RecentMediaPage({
            currentUser: {
                bio: '',
                csrfToken: 'csrf-token',
                displayNsfwMedia: false,
                showUnapprovedMedia: true,
                email: 'demo@example.test',
                id: 'user-1',
                lastSeenVersion: null,
                profilePhotoKey: null,
                role: 'user',
                username: 'demo',
            },
            guestInitial: 'G',
            mediaBaseUrl: 'https://m.example.com',
            page: {
                items: [],
                nextCursor: null,
                nextPosition: null,
                publicRootUrl: null,
                generation: null,
                publishedAt: null,
            },
            showNsfw: false,
            showUnapproved: true,
        }).toString()

        expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*data-recent-filter-unapproved/)
        expect(html).toContain('Hide unapproved')
        expect(html).toContain('data-persist-unapproved="true"')
    })
})
