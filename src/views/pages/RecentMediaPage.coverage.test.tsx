import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import type {CurrentUser} from '../../lib/auth/session'
import type {RecentMediaItem, RecentMediaPage as RecentMediaPageData} from '../../lib/recentMedia'
import {RecentMediaPage} from './RecentMediaPage'

type RecentMediaPageProps = Parameters<typeof RecentMediaPage>[0]

const currentUser: CurrentUser = {
    id: 'viewer-1',
    email: 'viewer@example.com',
    username: 'viewer',
    role: 'user',
    profilePhotoKey: 'viewer-avatar',
    bio: '',
    displayNsfwMedia: true,
    showUnapprovedMedia: true,
    lastSeenVersion: null,
    csrfToken: 'csrf-token',
}

function recentItem(id: string, groupId: string, userAvatarUrl: string | null = null): RecentMediaItem {
    return {
        id,
        groupId,
        alt: `Character ${id} art`,
        width: 1200,
        height: 800,
        previewSrc: `https://media.example/${id}/preview.webp`,
        originalSrc: `https://media.example/${id}/original.webp`,
        character: {
            name: `Character ${id}`,
            href: `/characters/${id}`,
            avatarUrl: `https://media.example/${id}/character.webp`,
        },
        user: {
            username: `artist-${id}`,
            href: `/users/${id}`,
            avatarUrl: userAvatarUrl,
            initial: 'A',
        },
    }
}

function recentPage(overrides: Partial<RecentMediaPageData> = {}): RecentMediaPageData {
    return {
        items: [],
        nextCursor: null,
        nextPosition: null,
        publicRootUrl: null,
        generation: null,
        publishedAt: null,
        ...overrides,
    }
}

async function renderRecentMediaPage(props: RecentMediaPageProps): Promise<string> {
    const app = new Hono()
    app.get('/', (context) => context.html(<RecentMediaPage {...props} />))

    return (await app.request('https://example.test/')).text()
}

describe('RecentMediaPage coverage', () => {
    it('renders grouped media with signed-in direct-feed data and active filters', async () => {
        const html = await renderRecentMediaPage({
            currentUser,
            guestInitial: 'G',
            mediaBaseUrl: 'https://media.example',
            page: recentPage({
                items: [
                    recentItem('first', 'group-a'),
                    recentItem('second', 'group-a'),
                    recentItem('third', 'group-b', 'https://media.example/third/user.webp'),
                ],
                nextCursor: 'next-cursor',
                publicRootUrl: 'https://feed.example/generations/root.json',
                generation: 'generation-1',
            }),
            showNsfw: true,
            showUnapproved: true,
        })

        expect(html).toContain('data-has-more="true"')
        expect(html).toContain('data-generation="generation-1"')
        expect(html).toContain('data-next-cursor="next-cursor"')
        expect(html).toContain('data-public-root-url="https://feed.example/generations/root.json"')
        expect(html).toContain('data-csrf-token="csrf-token"')
        expect(html).toContain('data-persist-unapproved="true"')
        expect(html).toContain('Hide NSFW media</button>')
        expect(html).toContain('Hide unapproved</button>')
        expect(html).toContain('data-recent-stack="true"')
        expect(html).toContain('Show all 2 uploads')
        expect(html).toContain('<span class="text-sm font-bold">A</span>')
        expect(html).toContain('artist-third avatar')
        expect(html).toContain('data-recent-stack-items="true"')
        expect(html).toContain('[12][0-9]')
        expect(html).toContain('[01][0-9]')
    })

    it('renders a direct-feed position for a guest with inactive filters', async () => {
        const html = await renderRecentMediaPage({
            currentUser: null,
            guestInitial: 'G',
            mediaBaseUrl: 'https://media.example',
            page: recentPage({
                items: [recentItem('position', 'group-position')],
                nextPosition: 24,
            }),
            showNsfw: false,
            showUnapproved: false,
        })

        expect(html).toContain('data-has-more="true"')
        expect(html).toContain('data-next-position="24"')
        expect(html).toContain('data-csrf-token=""')
        expect(html).toContain('data-persist-unapproved="false"')
        expect(html).toContain('Show NSFW media</button>')
        expect(html).toContain('Show unapproved</button>')
    })

    it('renders the empty and completed-feed states', async () => {
        const emptyHtml = await renderRecentMediaPage({
            currentUser: null,
            guestInitial: 'G',
            mediaBaseUrl: 'https://media.example',
            page: recentPage(),
            showNsfw: false,
            showUnapproved: false,
        })
        const completedHtml = await renderRecentMediaPage({
            currentUser: null,
            guestInitial: 'G',
            mediaBaseUrl: 'https://media.example',
            page: recentPage({items: [recentItem('completed', 'group-completed')]}),
            showNsfw: false,
            showUnapproved: false,
        })

        expect(emptyHtml).toContain('data-has-more="false"')
        expect(emptyHtml).toContain('data-recent-empty="true"')
        expect(emptyHtml).toContain('text-base-content/60 hidden" data-recent-end="true"')
        expect(completedHtml).toContain('data-has-more="false"')
        expect(completedHtml).toContain('card card-border mx-auto mt-10 hidden max-w-lg bg-base-200 text-center" data-recent-empty="true"')
        expect(completedHtml).toContain('text-base-content/60 " data-recent-end="true"')
    })
})
