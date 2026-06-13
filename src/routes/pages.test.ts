import {describe, expect, it, vi} from 'vitest'
import {pageRoutes} from './pages'
import app from '../index'
import {createMockR2Bucket} from '../test/mockR2'

const mediaPublicBaseUrl = 'https://m.myoc.art'

type QueryResult = {
    results: unknown[]
}

function createProfilePageDb(options: {
    profileUser?: unknown
    currentUser?: unknown
    socialLinks?: unknown[]
    folders?: unknown[]
    characters?: unknown[]
    characterSettings?: unknown
    characterMedia?: unknown[]
    galleryTabs?: unknown[]
    galleryRows?: unknown[]
    searchUsers?: unknown[]
    searchUserCount?: number
    searchCharacters?: unknown[]
    searchCharacterCount?: number
} = {}): D1Database {
    return {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn(() => ({
                first: vi.fn(async () => {
                    if (sql.includes('COUNT(*) AS count') && sql.includes('FROM users')) {
                        return {count: options.searchUserCount ?? options.searchUsers?.length ?? 0}
                    }

                    if (sql.includes('COUNT(*) AS count') && sql.includes('FROM characters')) {
                        return {count: options.searchCharacterCount ?? options.searchCharacters?.length ?? 0}
                    }

                    if (sql.includes('FROM sessions')) {
                        return options.currentUser ?? null
                    }

                    if (sql.includes('FROM characters')) {
                        return options.characterSettings ?? null
                    }

                    return options.profileUser ?? null
                }),
                all: vi.fn(async (): Promise<QueryResult> => {
                    if (sql.includes('FROM users') && sql.includes('LEFT JOIN characters')) {
                        return {results: options.searchUsers ?? []}
                    }

                    if (sql.includes('FROM characters') && sql.includes('INNER JOIN users')) {
                        return {results: options.searchCharacters ?? []}
                    }

                    if (sql.includes('FROM user_social_links')) {
                        return {results: options.socialLinks ?? []}
                    }

                    if (sql.includes('FROM character_folders')) {
                        return {results: options.folders ?? []}
                    }

                    if (sql.includes('FROM character_media')) {
                        return {results: options.characterMedia ?? []}
                    }

                    if (sql.includes('FROM character_gallery_tabs')) {
                        return {results: options.galleryTabs ?? []}
                    }

                    if (sql.includes('FROM character_gallery_rows')) {
                        return {results: options.galleryRows ?? []}
                    }

                    if (sql.includes('FROM characters')) {
                        return {results: options.characters ?? []}
                    }

                    return {results: []}
                }),
            })),
        })),
        batch: vi.fn(async () => []),
    } as unknown as D1Database
}

async function getProfile(username: string, db: D1Database): Promise<Response> {
    return await getProfilePath(`/u/${username}`, db)
}

async function getProfilePath(path: string, db: D1Database): Promise<Response> {
    return pageRoutes.request(`https://example.com${path}`, {}, {
        DB: db,
        MEDIA_BUCKET: createMockR2Bucket(),
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

async function getAppPath(path: string, db = createProfilePageDb(), headers: Record<string, string> = {}): Promise<Response> {
    return app.request(`https://example.com${path}`, {headers}, {
        DB: db,
        MEDIA_BUCKET: createMockR2Bucket(),
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

function createCurrentUserRecord(username = 'demo') {
    return {
        id: 'current-user',
        email: `${username}@example.test`,
        username,
        profile_photo_key: null,
        bio: '',
    }
}

describe('public page redirects', () => {
    it('redirects logged-in users from home to their profile', async () => {
        const response = await getAppPath('/', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/u/demo')
    })

    it('redirects logged-in users away from login and register', async () => {
        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo_user'),
        })
        const headers = {
            cookie: 'myoc_session=session-token',
        }

        const loginResponse = await getAppPath('/login', db, headers)
        const registerResponse = await getAppPath('/register', db, headers)

        expect(loginResponse.status).toBe(302)
        expect(loginResponse.headers.get('location')).toBe('/u/demo_user')
        expect(registerResponse.status).toBe(302)
        expect(registerResponse.headers.get('location')).toBe('/u/demo_user')
    })

    it('renders home, login, and register for logged-out users', async () => {
        const homeResponse = await getAppPath('/')
        const loginResponse = await getAppPath('/login')
        const registerResponse = await getAppPath('/register')

        expect(homeResponse.status).toBe(200)
        expect(loginResponse.status).toBe(200)
        expect(registerResponse.status).toBe(200)
    })

    it('renders SEO metadata on the home page', async () => {
        const response = await getAppPath('/')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>MyOC | High-Resolution Character Gallery</title>')
        expect(html).toContain('<meta content="Easily share character art without losing quality.')
        expect(html).toContain('<link href="https://example.com/" rel="canonical"/>')
        expect(html).toContain('<meta content="MyOC | High-Resolution Character Gallery" property="og:title"/>')
        expect(html).toContain('<meta content="https://example.com/assets/myocbanner.webp" property="og:image"/>')
        expect(html).toContain('<meta content="1200" property="og:image:width"/>')
        expect(html).toContain('<meta content="630" property="og:image:height"/>')
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="summary_large_image" name="twitter:card"/>')
        expect(html).toContain('<script type="application/ld+json">')
        expect(html).toContain('"@type":"WebSite"')
        expect(html).toContain('"target":"https://example.com/search?q={search_term_string}"')
    })
})

describe('GET /search', () => {
    it('renders matching users and characters from live search data', async () => {
        const response = await getAppPath('/search?q=raz', createProfilePageDb({
            searchUsers: [
                {
                    id: 'profile-user',
                    username: 'razeth',
                    bio: 'Character artist.',
                    profile_photo_key: 'profile-photo-key',
                    character_count: 2,
                },
            ],
            searchUserCount: 1,
            searchCharacters: [
                {
                    id: 'character-1',
                    name: 'RAZETH',
                    profile_image_key: 'character-image-key',
                    user_id: 'profile-user',
                    username: 'razeth',
                },
            ],
            searchCharacterCount: 1,
        }))
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Results for &quot;raz&quot;')
        expect(html).toContain('1 user')
        expect(html).toContain('1 character')
        expect(html).toContain('razeth')
        expect(html).toContain('Character artist.')
        expect(html).toContain('/u/razeth')
        expect(html).toContain('RAZETH')
        expect(html).toContain('/u/razeth/RAZETH')
        expect(html).toContain('https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/profile/character-image-key.webp')
    })

    it('renders an empty search prompt when no query is provided', async () => {
        const response = await getAppPath('/search')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Search MyOC')
        expect(html).toContain('Enter a username or character name to start searching.')
    })

    it('safely embeds hostile-looking search query text', async () => {
        const response = await getAppPath('/search?q=%3C%2Fscript%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;')
        expect(html).toContain('const searchQuery = "\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"')
        expect(html).not.toContain('const searchQuery = "</script>')
    })
})

describe('GET /api/search', () => {
    it('returns paginated character results for load-more requests', async () => {
        const searchCharacters = Array.from({length: 9}, (_, index) => ({
            id: `character-${index}`,
            name: `Character ${index}`,
            profile_image_key: `character-image-key-${index}`,
            user_id: 'profile-user',
            username: 'razeth',
        }))
        const response = await getAppPath('/api/search?type=characters&q=character&offset=8', createProfilePageDb({
            searchCharacters,
            searchCharacterCount: 9,
        }), {
            accept: 'application/json',
        })
        const body = await response.json() as {
            type: string
            query: string
            items: unknown[]
            total: number
            nextOffset: number | null
            hasMore: boolean
        }

        expect(response.status).toBe(200)
        expect(body.type).toBe('characters')
        expect(body.query).toBe('character')
        expect(body.items).toHaveLength(8)
        expect(body.total).toBe(9)
        expect(body.nextOffset).toBe(16)
        expect(body.hasMore).toBe(true)
    })

    it('rejects unknown search result types', async () => {
        const response = await getAppPath('/api/search?type=folders&q=raz', createProfilePageDb(), {
            accept: 'application/json',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Search type must be users or characters',
        })
    })
})

describe('GET /edit/:characterId', () => {
    it('renders the character settings page from live character gallery data', async () => {
        const response = await getAppPath('/edit/character-1', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            characterSettings: {
                id: 'character-1',
                user_id: 'current-user',
                name: 'RAZETH',
                profile_image_key: 'profile-image-key',
                description: 'Character description.',
                gallery_fullsize_last_row: 1,
            },
            characterMedia: [{
                id: 'media-1',
                sfw_image_key: 'sfw-image-key',
                nsfw_image_key: null,
                sfw_artist: 'Artist',
                nsfw_artist: '',
                sfw_width: 640,
                sfw_height: 480,
                nsfw_width: null,
                nsfw_height: null,
            }],
            galleryTabs: [{
                id: 'tab-1',
                name: 'default',
                sort_order: 0,
            }],
            galleryRows: [{
                row_id: 'row-1',
                tab_id: 'tab-1',
                row_sort_order: 0,
                media_id: 'media-1',
                media_sort_order: 0,
            }],
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('RAZETH Settings | MyOC')
        expect(html).toContain('Character description.')
        expect(html).toContain('href="/u/demo/RAZETH"')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-1/profile/profile-image-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-1/media/media-1/sfw/sfw-image-key.png')
        expect(html).toContain('Gallery Sorting')
        expect(html).toContain('const csrfToken =')
    })

    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/edit/character-1')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('does not expose the character settings page under the old characters path', async () => {
        const response = await getAppPath('/characters/5f42998f-e37b-4135-9760-c2768ade86e1', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
    })
})

describe('GET /u/:username', () => {
    it('renders a public character page with safe gallery media by default', async () => {
        const response = await getProfilePath('/u/demo/RAZETH', createProfilePageDb({
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: 'profile-photo-key',
                bio: 'Live profile bio.',
            },
            characterSettings: {
                id: 'character-1',
                user_id: 'profile-user',
                name: 'RAZETH',
                profile_image_key: 'character-profile-key',
                description: 'Character page description.',
                gallery_fullsize_last_row: 1,
            },
            characterMedia: [
                {
                    id: 'sfw-media',
                    sfw_image_key: 'sfw-only-key',
                    nsfw_image_key: null,
                    sfw_artist: 'SFW Artist',
                    nsfw_artist: '',
                    sfw_width: 640,
                    sfw_height: 480,
                    nsfw_width: null,
                    nsfw_height: null,
                },
                {
                    id: 'both-media',
                    sfw_image_key: 'both-sfw-key',
                    nsfw_image_key: 'both-nsfw-key',
                    sfw_artist: 'Both SFW Artist',
                    nsfw_artist: 'Both NSFW Artist',
                    sfw_width: 800,
                    sfw_height: 600,
                    nsfw_width: 900,
                    nsfw_height: 600,
                },
                {
                    id: 'nsfw-media',
                    sfw_image_key: null,
                    nsfw_image_key: 'nsfw-only-key',
                    sfw_artist: '',
                    nsfw_artist: 'NSFW Artist',
                    sfw_width: null,
                    sfw_height: null,
                    nsfw_width: 1200,
                    nsfw_height: 800,
                },
            ],
            galleryTabs: [
                {
                    id: 'tab-default',
                    name: 'default',
                    sort_order: 0,
                },
                {
                    id: 'tab-reference',
                    name: 'references',
                    sort_order: 1,
                },
            ],
            galleryRows: [
                {
                    row_id: 'row-1',
                    tab_id: 'tab-default',
                    row_sort_order: 0,
                    media_id: 'sfw-media',
                    media_sort_order: 0,
                },
                {
                    row_id: 'row-1',
                    tab_id: 'tab-default',
                    row_sort_order: 0,
                    media_id: 'both-media',
                    media_sort_order: 1,
                },
                {
                    row_id: 'row-2',
                    tab_id: 'tab-default',
                    row_sort_order: 1,
                    media_id: 'nsfw-media',
                    media_sort_order: 0,
                },
            ],
        }))
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('RAZETH | MyOC')
        expect(html).toContain('Character page description.')
        expect(html).toContain('https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/sfw-media/sfw/sfw-only-key.png')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png')
        expect(html).toContain('loading="lazy"')
        expect(html).toContain('decoding="async"')
        expect(html).toContain('data-gallery-image-loader')
        expect(html).toContain('Display 18+ media')
        expect(html).toContain('data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png"')
        expect(html).toContain('data-nsfw-title="Both NSFW Artist"')
        expect(html).toContain('data-title="SFW Artist"')
        expect(html).toContain('data-title="Both SFW Artist"')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png')
        expect(html).toContain('Use the 18+ media button to display this media.')
        expect(html).toContain('data-nsfw-hidden="true"')
        expect(html).toContain('width="640"')
        expect(html).toContain('height="480"')
        expect(html).toContain('--media-width:640;--media-height:480')
        expect(html).toContain('value="default"')
        expect(html).not.toContain('value="tab-default"')
        expect(html).toContain('references')
    })

    it('renders NSFW gallery variants when the current user enabled NSFW media', async () => {
        const response = await getAppPath('/u/demo/RAZETH', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('viewer'),
                display_nsfw_media: 1,
            },
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: null,
                bio: '',
            },
            characterSettings: {
                id: 'character-1',
                user_id: 'profile-user',
                name: 'RAZETH',
                profile_image_key: 'character-profile-key',
                description: '',
                gallery_fullsize_last_row: 0,
            },
            characterMedia: [
                {
                    id: 'both-media',
                    sfw_image_key: 'both-sfw-key',
                    nsfw_image_key: 'both-nsfw-key',
                    sfw_artist: 'Both SFW Artist',
                    nsfw_artist: 'Both NSFW Artist',
                    sfw_width: 800,
                    sfw_height: 600,
                    nsfw_width: 900,
                    nsfw_height: 600,
                },
                {
                    id: 'nsfw-media',
                    sfw_image_key: null,
                    nsfw_image_key: 'nsfw-only-key',
                    sfw_artist: '',
                    nsfw_artist: 'NSFW Artist',
                    sfw_width: null,
                    sfw_height: null,
                    nsfw_width: 1200,
                    nsfw_height: 800,
                },
            ],
            galleryTabs: [{
                id: 'tab-default',
                name: 'default',
                sort_order: 0,
            }],
            galleryRows: [
                {
                    row_id: 'row-1',
                    tab_id: 'tab-default',
                    row_sort_order: 0,
                    media_id: 'both-media',
                    media_sort_order: 0,
                },
                {
                    row_id: 'row-1',
                    tab_id: 'tab-default',
                    row_sort_order: 0,
                    media_id: 'nsfw-media',
                    media_sort_order: 1,
                },
            ],
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png')
        expect(html).toContain('data-title="Both NSFW Artist"')
        expect(html).toContain('data-title="NSFW Artist"')
        expect(html).not.toContain('both-media/sfw/both-sfw-key.png')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png')
        expect(html).not.toContain('>Display 18+ media<')
        expect(html).not.toContain('Change your account settings to display this media.')
        expect(html).not.toContain('data-nsfw-hidden="true"')
        expect(html).toContain('width="900"')
        expect(html).toContain('height="600"')
    })

    it('renders a profile from live user, social link, folder, and character data', async () => {
        const db = createProfilePageDb({
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: 'profile-photo-key',
                bio: 'Live profile bio.',
            },
            socialLinks: [
                {
                    platform: 'bluesky',
                    label: null,
                    url: 'https://bsky.app/profile/demo.test',
                },
                {
                    platform: 'custom',
                    label: 'Portfolio',
                    url: 'https://example.test/demo',
                },
            ],
            folders: [
                {
                    id: 'folder-1',
                    name: 'Main Characters',
                    parent_folder_id: null,
                    sort_order: 0,
                },
                {
                    id: 'nested-folder',
                    name: 'Nested Folder',
                    parent_folder_id: 'folder-1',
                    sort_order: 0,
                },
            ],
            characters: [
                {
                    id: 'character-1',
                    name: 'RAZETH',
                    profile_image_key: 'character-image-key',
                    folder_id: 'folder-1',
                    sort_order: 0,
                },
            ],
        })

        const response = await getProfile('demo', db)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('DEMO')
        expect(html).toContain('Live profile bio.')
        expect(html).toContain('https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp')
        expect(html).toContain('https://bsky.app/profile/demo.test')
        expect(html).toContain('Portfolio')
        expect(html).toContain('Main Characters')
        expect(html).not.toContain('Nested Folder')
        expect(html).toContain('RAZETH')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/profile/character-image-key.webp')
        expect(html).toContain('/u/demo/Main%20Characters')
        expect(html).toContain('/u/demo/RAZETH')
        expect(html).not.toContain('Some text goes here')
    })

    it('renders a folder page from folder name path segments', async () => {
        const db = createProfilePageDb({
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: null,
                bio: '',
            },
            folders: [
                {
                    id: 'folder-1',
                    name: 'Main Characters',
                    parent_folder_id: null,
                    sort_order: 0,
                },
                {
                    id: 'nested-folder',
                    name: 'Nested Folder',
                    parent_folder_id: 'folder-1',
                    sort_order: 0,
                },
            ],
            characters: [
                {
                    id: 'character-1',
                    name: 'RAZETH',
                    profile_image_key: 'character-image-key',
                    folder_id: 'folder-1',
                    sort_order: 0,
                },
                {
                    id: 'root-character',
                    name: 'ROOT',
                    profile_image_key: 'root-character-image-key',
                    folder_id: null,
                    sort_order: 0,
                },
            ],
        })

        const response = await getProfilePath('/u/demo/Main%20Characters', db)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Folder')
        expect(html).toContain('Main Characters')
        expect(html).toContain('Nested Folder')
        expect(html).toContain('/u/demo/Main%20Characters/Nested%20Folder')
        expect(html).toContain('RAZETH')
        expect(html).not.toContain('ROOT')
    })

    it('returns 404 when the profile username does not exist', async () => {
        const response = await getProfile('missing', createProfilePageDb())
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).toContain('That profile does not exist or is no longer available.')
    })

    it('returns 404 when a folder path does not exist', async () => {
        const response = await getProfilePath('/u/demo/Missing%20Folder', createProfilePageDb({
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: null,
                bio: '',
            },
        }))
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).toContain('That folder path does not exist on this profile.')
    })

    it('redirects the old users profile route to the profile route', async () => {
        const response = await getProfilePath('/users/demo', createProfilePageDb())

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo')
    })

    it('redirects the old profile route to the user route', async () => {
        const response = await getProfilePath('/profile/demo/Main%20Characters', createProfilePageDb())

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo/Main%20Characters')
    })

    it('renders the themed 404 page for unknown page routes', async () => {
        const response = await getAppPath('/missing-page')
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).toContain('The page you are looking for does not exist or has been moved.')
        expect(html).toContain('Go Home')
    })

    it('returns JSON for unknown API routes', async () => {
        const response = await getAppPath('/api/missing', createProfilePageDb(), {
            accept: 'application/json',
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Not found',
        })
    })
})
