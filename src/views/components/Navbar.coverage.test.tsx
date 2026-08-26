import {renderToString} from 'hono/jsx/dom/server'
import {describe, expect, it} from 'vitest'
import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from './Navbar'

const mediaBaseUrl = 'https://media.example.test'

function renderNavbar(currentUser?: CurrentUser | null): string {
    return renderToString(<Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl} />)
}

describe('Navbar recent uploads links', () => {
    it('includes recent uploads in the signed-in library menu', () => {
        const html = renderNavbar({
            id: 'user-1',
            email: 'user@example.test',
            username: 'reader',
            role: 'user',
            profilePhotoKey: null,
            bio: '',
            displayNsfwMedia: false,
            showUnapprovedMedia: false,
            lastSeenVersion: null,
            csrfToken: 'csrf-token',
        })

        expect(html).toContain('<span>Library</span>')
        expect(html).toContain('<a href="/recent">Recent uploads</a>')
    })

    it('includes recent uploads in the signed-out explore menu', () => {
        const html = renderNavbar(null)

        expect(html).toContain('<span>Explore</span>')
        expect(html).toContain('<a href="/recent">Recent uploads</a>')
    })
})
