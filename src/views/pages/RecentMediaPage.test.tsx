import {describe, expect, it} from 'vitest'
import type {CurrentUser} from '../../lib/auth/session'
import type {RecentMediaItem, RecentMediaPage as RecentMediaPageData} from '../../lib/recentMedia'
import {RecentMediaPage} from './RecentMediaPage'

const currentUser: CurrentUser = {
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
}

function mediaItem(id: string, groupId = `group-${id}`, overrides: Partial<RecentMediaItem> = {}): RecentMediaItem {
    return {
        id,
        groupId,
        alt: `${id} character art`,
        height: 900,
        originalSrc: `https://m.example.com/media/${id}/original.webp`,
        previewSrc: `https://m.example.com/media/${id}/preview.webp`,
        width: 1200,
        character: {
            avatarUrl: `https://m.example.com/characters/${id}/avatar.webp`,
            href: `/u/artist/${id}`,
            name: `Character ${id}`,
        },
        user: {
            avatarUrl: `https://m.example.com/users/${id}/avatar.webp`,
            href: `/u/artist-${id}`,
            initial: 'A',
            username: `artist-${id}`,
        },
        ...overrides,
    }
}

function recentPage(overrides: Partial<RecentMediaPageData> = {}): RecentMediaPageData {
    return {
        generation: null,
        items: [],
        nextCursor: null,
        nextPosition: null,
        publicRootUrl: null,
        publishedAt: null,
        ...overrides,
    }
}

function renderRecentMediaPage({
    page = recentPage(),
    showNsfw = false,
    showUnapproved = true,
    user = null,
}: {
    page?: RecentMediaPageData
    showNsfw?: boolean
    showUnapproved?: boolean
    user?: CurrentUser | null
} = {}): string {
    return RecentMediaPage({
        currentUser: user,
        guestInitial: 'G',
        mediaBaseUrl: 'https://m.example.com',
        page,
        showNsfw,
        showUnapproved,
    }).toString()
}

describe('RecentMediaPage', () => {
    it('shows an empty feed and disabled filter states to a guest', () => {
        const html = renderRecentMediaPage({showUnapproved: false})

        expect(html).toContain('<title>Recently uploaded media | MyOC</title>')
        expect(html).toMatch(/<button(?=[^>]*aria-pressed="false")[^>]*>Show NSFW media<\/button>/)
        expect(html).toMatch(/<button(?=[^>]*aria-pressed="false")[^>]*>Show unapproved<\/button>/)
        expect(html).toContain('Show NSFW media')
        expect(html).toContain('Show unapproved')
        expect(html).toContain('No uploads found')
        expect(html).toContain('No character media matches these filters.')
    })

    it('renders active saved media controls and paging data for a signed-in user', () => {
        const html = renderRecentMediaPage({
            page: recentPage({
                generation: 'generation-7',
                nextPosition: 24,
                publicRootUrl: 'https://feeds.example.com/generations/v1/roots/generation-7.json',
            }),
            showNsfw: true,
            user: currentUser,
        })

        expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")[^>]*>Hide NSFW media<\/button>/)
        expect(html).toMatch(/<button(?=[^>]*aria-pressed="true")[^>]*>Hide unapproved<\/button>/)
        expect(html).toContain('Hide NSFW media')
        expect(html).toContain('Hide unapproved')
        expect(html).toContain('Load more')
    })

    it('renders media links, dimensions, and image and fallback credit avatars', () => {
        const item = mediaItem('solo', undefined, {
            height: 600,
            width: 900,
            user: {
                avatarUrl: null,
                href: '/u/example-artist',
                initial: 'E',
                username: 'example-artist',
            },
        })
        const html = renderRecentMediaPage({page: recentPage({items: [item]})})

        expect(html).toContain('aria-label="View Character solo&#39;s character page"')
        expect(html).toContain('alt="solo character art"')
        expect(html).toContain('height="600"')
        expect(html).toContain('src="https://m.example.com/media/solo/preview.webp"')
        expect(html).toContain('width="900"')
        expect(html).toContain('alt="Character solo avatar"')
        expect(html).toContain('src="https://m.example.com/characters/solo/avatar.webp"')
        expect(html).not.toContain('alt="example-artist avatar"')
        expect(html).toContain('>E</span>')
        expect(html).toContain('You’re all caught up.')
    })

    it('stacks sequential uploads and safely embeds the remaining item data', () => {
        const scriptInjection = ['</scr', 'ipt><scr', 'ipt>alert(1)</scr', 'ipt>'].join('')
        const unsafeText = `${scriptInjection}&`
        const items = [
            mediaItem('stack-1', 'shared-group'),
            mediaItem('stack-2', 'shared-group', {alt: unsafeText}),
            mediaItem('stack-3', 'shared-group'),
        ]
        const html = renderRecentMediaPage({page: recentPage({items})})

        expect(html).toContain('aria-label="Show 2 more uploads for Character stack-1 by artist-stack-1"')
        expect(html).toContain('Show 2 more uploads')
        const payload = html.match(/data-recent-stack-items="([^"]*)"/)?.[1]
        const decodedPayload = payload?.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&amp;', '&')
        const remainingItems = JSON.parse(decodedPayload ?? '[]') as RecentMediaItem[]
        expect(remainingItems.map((item) => item.alt)).toEqual([unsafeText, 'stack-3 character art'])
        expect(html).not.toContain('type="application/json"')
        expect(html).not.toContain(scriptInjection.slice('</script>'.length))
    })

    it('uses a singular upload label for a two-item stack', () => {
        const html = renderRecentMediaPage({
            page: recentPage({items: [mediaItem('pair-1', 'pair'), mediaItem('pair-2', 'pair')]}),
        })

        expect(html).toContain('aria-label="Show 1 more upload for Character pair-1 by artist-pair-1"')
        expect(html).toContain('Show 1 more upload')
    })

    it('keeps nonsequential uploads as separate cards', () => {
        const items = Array.from({length: 9}, (_, index) => mediaItem(`balanced-${index}`))
        items[0] = mediaItem('first', 'repeated-group')
        items[2] = mediaItem('repeat', 'repeated-group')
        const html = renderRecentMediaPage({page: recentPage({items})})

        expect(html.match(/aria-label="View [^"]+&#39;s character page"/g)).toHaveLength(9)
        expect(html).not.toContain('Show 1 more upload')
    })

    it('renders every item when the final row is short', () => {
        const items = Array.from({length: 6}, (_, index) => mediaItem(`uneven-${index}`))
        const html = renderRecentMediaPage({page: recentPage({items})})

        expect(html.match(/aria-label="View [^"]+&#39;s character page"/g)).toHaveLength(6)
    })
})
