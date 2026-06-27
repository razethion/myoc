import {afterEach, describe, expect, it, vi} from 'vitest'
import {pageRoutes} from './pages'
import app from '../index'
import {APP_VERSION, RELEASE_NOTES} from '../lib/releases'
import {createMockKVNamespace} from '../test/mockKV'
import {createMockR2Bucket} from '../test/mockR2'
import {createWebpDataUrl} from '../test/imageFixtures'

const mediaPublicBaseUrl = 'https://m.myoc.art'

afterEach(() => {
    vi.unstubAllGlobals()
})

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
    userCount?: number
    characterCount?: number
    mediaCount?: number
    discoverCharacters?: unknown[]
    activeToyhouseImportJob?: unknown
    activeToyhouseImportItems?: unknown[]
    toyhouseImportItemsError?: Error
    imageApprovalItem?: unknown
    imageApprovalQueue?: unknown[]
    imageApprovalHistory?: unknown[]
    adminReports?: unknown[]
} = {}): D1Database {
    const firstForSql = async (sql: string) => {
        if (sql.includes('COUNT(*) AS count') && sql.includes('FROM character_media')) {
            return {count: options.mediaCount ?? 0}
        }

        if (sql.includes('COUNT(*) AS count') && sql.includes('FROM users')) {
            return {count: options.userCount ?? options.searchUserCount ?? options.searchUsers?.length ?? 0}
        }

        if (sql.includes('COUNT(*) AS count') && sql.includes('FROM characters')) {
            return {count: options.characterCount ?? options.searchCharacterCount ?? options.searchCharacters?.length ?? 0}
        }

        if (sql.includes('FROM sessions')) {
            return options.currentUser ?? null
        }

        if (sql.includes('FROM toyhouse_import_jobs')) {
            if (sql.includes('EXISTS') && options.activeToyhouseImportItems?.length === 0) {
                return null
            }

            return options.activeToyhouseImportJob ?? null
        }

        if (sql.includes('FROM character_media') && sql.includes('INNER JOIN users')) {
            return options.imageApprovalItem ?? null
        }

        if (sql.includes('FROM characters')) {
            return options.characterSettings ?? null
        }

        return options.profileUser ?? null
    }
    const allForSql = async (sql: string): Promise<QueryResult> => {
        if (sql.includes('eligible_characters')) {
            return {results: options.discoverCharacters ?? []}
        }

        if (sql.includes('sfw_reported_by_username')) {
            return {results: options.adminReports ?? []}
        }

        if (sql.includes('FROM character_media_review_events')) {
            return {results: options.imageApprovalHistory ?? []}
        }

        if (sql.includes('FROM toyhouse_import_items')) {
            if (options.toyhouseImportItemsError) {
                throw options.toyhouseImportItemsError
            }

            return {results: options.activeToyhouseImportItems ?? []}
        }

        if (sql.includes('FROM character_media') && sql.includes('sfw_review_status')) {
            return {results: options.imageApprovalQueue ?? []}
        }

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
    }

    return {
        prepare: vi.fn((sql: string) => ({
            first: vi.fn(() => firstForSql(sql)),
            all: vi.fn(() => allForSql(sql)),
            bind: vi.fn(() => ({
                first: vi.fn(() => firstForSql(sql)),
                all: vi.fn(() => allForSql(sql)),
                run: vi.fn(async () => ({success: true})),
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
        CACHE: createMockKVNamespace(),
        DB: db,
        MEDIA_BUCKET: createMockR2Bucket(),
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

async function getAppPath(
    path: string,
    db = createProfilePageDb(),
    headers: Record<string, string> = {},
    cache = createMockKVNamespace(),
): Promise<Response> {
    return app.request(`https://example.com${path}`, {headers}, {
        CACHE: cache,
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
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
    }
}

function expectPatternAllowsReportedCharacterNames(html: string, inputId: string): void {
    const match = new RegExp(`id="${inputId}"[^>]*pattern="([^"]+)"`).exec(html)
    const pattern = match?.[1]
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")

    expect(pattern).toBeTruthy()

    if (!pattern) {
        throw new Error(`Pattern attribute was not rendered for ${inputId}`)
    }

    const regex = new RegExp(`^(?:${pattern})$`, 'v')

    expect(regex.test('DRD-5548 "Ivo"')).toBe(true)
    expect(regex.test('"Ivo"')).toBe(true)
    expect(regex.test('---')).toBe(false)
}

describe('public page redirects', () => {
    it('renders home for logged-in users', async () => {
        const response = await getAppPath('/', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            userCount: 24,
            characterCount: 128,
            mediaCount: 4096,
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>MyOC | High-Resolution Character Gallery</title>')
        expect(html).toContain('MyOC is source available.')
        expect(html).toContain('href="https://github.com/razethion/myoc"')
        expect(html).toContain('home-loading-image')
        expect(html).toContain('data-gallery-image-loader')
        expect(html).toContain('href="/u/demo"')
        expect(html).toContain('24')
        expect(html).toContain('128')
        expect(html).toContain('4,096')
    })

    it('renders discover characters with at least five approved SFW images and a homepage-approved preview', async () => {
        const db = createProfilePageDb({
            discoverCharacters: [
                {
                    id: 'character-1',
                    user_id: 'owner-1',
                    name: 'Quartz Dragon',
                    profile_image_key: 'profile-key',
                    owner_username: 'demo_owner',
                    image_count: 7,
                    preview_media_id: 'media-1',
                    preview_image_key: 'preview-key',
                    preview_artist: 'Demo Artist',
                },
            ],
        })
        const response = await getAppPath('/', db)
        const html = await response.text()
        const preparedSql = (db.prepare as unknown as { mock: { calls: [string][] } }).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(html).toContain('Characters with galleries worth browsing.')
        expect(html).toContain('Quartz Dragon')
        expect(html).toContain('by @demo_owner')
        expect(html).toContain('7 images')
        expect(html).toContain('href="/u/demo_owner/Quartz%20Dragon"')
        expect(html).toContain('home-loading-media image-loading aspect-4/3 bg-base-300')
        expect(html).toContain('home-loading-media image-loading h-14 w-14 shrink-0')
        expect(html).toContain('loading loading-spinner loading-lg text-base-content')
        expect(html).toContain('loading loading-spinner loading-sm text-base-content')
        expect(html).toContain('https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview-key.png')
        expect(html).toContain('https://m.myoc.art/characters/owner-1/character-1/profile/profile-key.webp')
        expect(preparedSql).toContain("sfw_review_status = 'approved'")
        expect(preparedSql).toContain('character_image_counts.image_count')
        expect(preparedSql).toContain('CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END')
        expect(preparedSql).toContain('HAVING COUNT(approved_sfw_media.id) >= 5')
        expect(preparedSql).toContain('SUM(CASE WHEN approved_sfw_media.sfw_homepage_allowed = 1 THEN 1 ELSE 0 END) >= 1')
        expect(preparedSql).toContain('AND sfw_homepage_allowed = 1')
        expect(preparedSql).toContain('sfw_approved_at >= updated_at')
    })

    it('renders homepage stats and discover characters from KV cache', async () => {
        const db = createProfilePageDb()
        const cache = createMockKVNamespace({
            values: {
                'home:stats:v1': {
                    users: 12,
                    characters: 34,
                    mediaItems: 56,
                },
                'home:discover:v1': [
                    {
                        id: 'cached-character',
                        userId: 'cached-owner',
                        name: 'Cached Quartz',
                        ownerUsername: 'cached_user',
                        profileImageKey: 'cached-profile-key',
                        previewMediaId: 'cached-media',
                        previewImageKey: 'cached-preview-key',
                        previewArtist: 'Cached Artist',
                        imageCount: 42,
                    },
                ],
            },
        })
        const response = await getAppPath('/', db, {}, cache)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('12')
        expect(html).toContain('34')
        expect(html).toContain('56')
        expect(html).toContain('Cached Quartz')
        expect(html).toContain('42 images')
        expect(html).toContain('https://m.myoc.art/characters/cached-owner/cached-character/media/cached-media/sfw/cached-preview-key.png')
        expect(db.prepare).not.toHaveBeenCalled()
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

    it('renders the what is new page with sequential version entries', async () => {
        const response = await getAppPath('/whats-new')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>What&#39;s New | MyOC</title>')
        expect(html).toContain('What&#39;s new')
        expect(html).toContain(`data-app-version="${APP_VERSION}"`)
        for (const release of RELEASE_NOTES) {
            expect(html).toContain(`v${release.version}`)
            expect(html).toContain(release.title.replace(/'/g, '&#39;'))
        }
        expect(html).toContain('Current version')
        expect(html).toContain('Release Notes')
        expect(html).toContain('badge badge-primary')
        expect(html).toContain('badge badge-outline')
        expect(html).toContain('href="/whats-new"')
    })

    it('marks the current version seen when logged-in users visit the what is new page', async () => {
        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        })
        const response = await getAppPath('/whats-new', db, {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()
        const preparedSql = (db.prepare as unknown as { mock: { calls: [string][] } }).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(preparedSql).toContain('UPDATE users')
        expect(preparedSql).toContain('last_seen_version')
        expect(html).toContain('data-version-notification')
        expect(html).toContain('hidden"')
    })

    it('renders SEO metadata on the home page', async () => {
        const response = await getAppPath('/', createProfilePageDb({
            mediaCount: 1234,
        }))
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>MyOC | High-Resolution Character Gallery</title>')
        expect(html).toContain('<meta content="Hosting over 1,234 images" name="description"/>')
        expect(html).toContain('<link href="https://example.com/" rel="canonical"/>')
        expect(html).toContain('<meta content="MyOC | High-Resolution Character Gallery" property="og:title"/>')
        expect(html).toContain('<meta content="Hosting over 1,234 images" property="og:description"/>')
        expect(html).toContain('<meta content="https://example.com/assets/myocbanner.webp" property="og:image"/>')
        expect(html).toContain('<meta content="1200" property="og:image:width"/>')
        expect(html).toContain('<meta content="630" property="og:image:height"/>')
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="summary_large_image" name="twitter:card"/>')
        expect(html).toContain('<meta content="Hosting over 1,234 images" name="twitter:description"/>')
        expect(html).toContain('<script type="application/ld+json">')
        expect(html).toContain('"@type":"WebSite"')
        expect(html).toContain('"description":"Hosting over 1,234 images"')
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

describe('GET /settings', () => {
    it('links to the Toyhou.se migration page for signed-in users', async () => {
        const response = await getAppPath('/settings', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>User Settings | MyOC</title>')
        expect(html).toContain('Migrate from Toyhou.se')
        expect(html).toContain('href="/migrate"')
    })
})

describe('GET /migrate', () => {
    it('renders the Toyhou.se migration form for signed-in users', async () => {
        const response = await getAppPath('/migrate?toyhouseUsername=demo', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Migrate from Toyhou.se | MyOC</title>')
        expect(html).toContain('Please ensure you are logged into toyhouse before starting.')
        expect(html).toContain('Toyhou.se username')
        expect(html).toContain('href="/settings">Back to Settings</a>')
        expect(html).toContain('id="logout-form"')
        expect(html).toContain('href="/u/demo"')
        expect(html).not.toContain('href="/login">Login</a>')
        expect(html).not.toContain('href="/register">Create account</a>')
        expect(html).toContain('name="toyhouseUsername"')
        expect(html).toContain('value="demo"')
        expect(html).toContain('type="submit">Submit</button>')
        expect(html).toContain('href="https://toyhou.se/demo/characters/folder:all"')
        expect(html).toContain('Verify Toyhou.se Ownership')
        expect(html).toContain('value="current-user"')
        expect(html).toContain('expectedMyocUserId = &quot;current-user&quot;')
        expect(html).toContain('verifyProfileOwner')
        expect(html).toContain('.profile-section.profile-content-section.user-content.fr-view')
        expect(html).toContain('Verification failed')
        expect(html).toContain('Start Import')
        expect(html).toContain('data-toyhouse-import-dialog')
        expect(html).toContain('Save the import bookmarklet')
        expect(html).toContain('href="javascript:')
        expect(html).toContain('toyhou\\.se')
        expect(html).toContain('I Bookmarked It')
        expect(html).toContain('Drag the Import to MyOC button to your bookmarks bar')
        expect(html).toContain('/migrate/import')
        expect(html).toContain('window.open(target')
        expect(html).toContain('postMessage')
        expect(html).toContain('myoc:toyhouse-import')
        expect(html).toContain('myoc:toyhouse-progress')
        expect(html).toContain('myoc:toyhouse-import-received')
        expect(html).toContain('window.close()')
        expect(html).toContain('collectImages')
        expect(html).toContain('discoverGalleryUrls')
        expect(html).toContain('imageLinks')
        expect(html).toContain('.sidebar-tab a[href]')
        expect(html).toContain("url.pathname = path + &#39;/gallery&#39;")
        expect(html).toContain('myoc-migration-progress')
        expect(html).toContain('closeSetupDialog')
        expect(html).toContain('[data-toyhouse-import-dialog][open]')
        expect(html).toContain('MyOC Toyhou.se import')
        expect(html).toContain('Import failed')
        expect(html).toContain('MyOC user ID was not found')
        expect(html).toContain('} catch (error) { fail(error); }')
        expect(html).not.toContain('.catch(fail)')
        expect(html).toContain('Loading galleries')
        expect(html).toContain('Sending to MyOC')
        expect(html).toContain('/~account/warnings/accept')
        expect(html).toContain('Accepting warning')
        expect(html).toContain('content warning')
        expect(html).not.toContain('window.name')
        expect(html).not.toContain('Toyhou.se returned 403')
    })

    it('renders the logged-in Toyhou.se import receiver page', async () => {
        const response = await getAppPath('/migrate/import', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Waiting for Toyhou.se')
        expect(html).toContain('data-toyhouse-import-receiver-status')
        expect(html).toContain('data-toyhouse-import-receiver-detail')
        expect(html).toContain('data-toyhouse-import-receiver-bar')
        expect(html).toContain("data.type === 'myoc:toyhouse-progress'")
        expect(html).toContain("data.type !== 'myoc:toyhouse-import'")
        expect(html).toContain("myoc:toyhouse-import-received")
        expect(html).toContain("form.method = 'post'")
        expect(html).toContain("input.name = 'toyhousePayload'")
        expect(html).toContain('id="logout-form"')
        expect(html).toContain('href="/settings">Back to Settings</a>')
        expect(html).not.toContain('href="/login">Login</a>')
    })

    it('proxies Toyhou.se images for signed-in users', async () => {
        const fetchMock = vi.fn(async () => new Response('image-bytes', {
            headers: {
                'content-type': 'image/png',
            },
        }))
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            '/migrate/toyhouse-image?url=' + encodeURIComponent('https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485'),
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        expect(await response.text()).toBe('image-bytes')
        expect(fetchMock).toHaveBeenCalledWith('https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485', {
            redirect: 'follow',
        })
    })

    it('rejects Toyhou.se image proxy requests for untrusted URLs', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            '/migrate/toyhouse-image?url=' + encodeURIComponent('https://example.com/image.png'),
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
                accept: 'application/json',
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Toyhou.se image URL is invalid',
        })
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('redirects the migration start page to confirm when an import job is active', async () => {
        const response = await getAppPath('/migrate', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            activeToyhouseImportJob: {
                id: 'toyhouse-import-job',
                total_images: 2,
            },
            activeToyhouseImportItems: [{id: 'toyhouse-import-item'}],
        }), {
            cookie: 'myoc_session=session-token',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/migrate/import/confirm')
    })

    it('redirects the Toyhou.se receiver page to confirm when an import job is active', async () => {
        const response = await getAppPath('/migrate/import', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            activeToyhouseImportJob: {
                id: 'toyhouse-import-job',
                total_images: 2,
            },
            activeToyhouseImportItems: [{id: 'toyhouse-import-item'}],
        }), {
            cookie: 'myoc_session=session-token',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/migrate/import/confirm')
    })

    it('does not redirect the migration start page for an active import job with no remaining items', async () => {
        const response = await getAppPath('/migrate', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            activeToyhouseImportJob: {
                id: 'toyhouse-import-job',
                total_images: 2,
            },
            activeToyhouseImportItems: [],
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Toyhou.se username')
        expect(html).not.toContain('Uploading Toyhou.se Images')
    })

    it('resumes an active Toyhou.se import job on the confirm page', async () => {
        const response = await getAppPath('/migrate/import/confirm', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            activeToyhouseImportJob: {
                id: 'toyhouse-import-job',
                total_images: 2,
            },
            activeToyhouseImportItems: [
                {
                    id: 'toyhouse-import-item-one',
                    character_id: 'new-character',
                    toyhouse_character_id: '9430171',
                    toyhouse_image_url: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png',
                    import_mode: 'create',
                    rating: 'sfw',
                    status: 'pending',
                    media_id: null,
                    name: 'Absinthe',
                },
                {
                    id: 'toyhouse-import-item-two',
                    character_id: 'existing-character',
                    toyhouse_character_id: '2222222',
                    toyhouse_image_url: 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_full.png',
                    import_mode: 'existing',
                    rating: 'nsfw',
                    status: 'imported',
                    media_id: 'existing-media',
                    name: 'Brindle',
                },
            ],
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Uploading Toyhou.se Images')
        expect(html).toContain('toyhouse-import-job')
        expect(html).toContain('toyhouse-import-item-one')
        expect(html).toContain('toyhouse-import-item-two')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png')
        expect(html).toContain('existing-media')
        expect(html).toContain('"createdCharacters":1')
        expect(html).toContain('"updatedCharacters":1')
        expect(html).not.toContain('Waiting for Toyhou.se')
        expect(html).not.toContain('Toyhou.se username')
    })

    it('redirects the confirm page back to migrate when there is no active import job', async () => {
        const response = await getAppPath('/migrate/import/confirm', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/migrate')
    })

    it('redirects logged-out users away from the Toyhou.se import receiver page', async () => {
        const response = await getAppPath('/migrate/import')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('renders posted Toyhou.se bookmarklet results for the signed-in user', async () => {
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify({
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 2,
            characters: [
                {
                    id: '9430171',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_thumb.png',
                        },
                    ],
                    imageCount: 2,
                    name: 'Absinthe',
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
                {
                    id: '2222222',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/2222222_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/2222222_alt_thumb.png',
                        },
                    ],
                    imageCount: 7,
                    name: 'Brindle',
                    thumbnailUrl: null,
                    url: 'https://toyhou.se/2222222.brindle',
                },
                {
                    id: '3333333',
                    images: [],
                    imageCount: 0,
                    name: 'Bad/Name',
                    thumbnailUrl: null,
                    url: 'https://toyhou.se/3333333.bad-name',
                },
                {
                    id: '4444444',
                    images: [],
                    imageCount: 0,
                    name: '"Ivo"',
                    thumbnailUrl: null,
                    url: 'https://toyhou.se/4444444.ivo',
                },
            ],
        }))

        const response = await app.request('https://example.com/migrate/import', {
            body: form,
            headers: {
                cookie: 'myoc_session=session-token',
            },
            method: 'POST',
        }, {
            CACHE: createMockKVNamespace(),
            DB: createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                characters: [
                    {id: 'existing-brindle', name: 'brindle'},
                ],
            }),
            MEDIA_BUCKET: createMockR2Bucket(),
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Found 4 characters across 2 pages.')
        expect(html).toContain('id="logout-form"')
        expect(html).toContain('href="/settings">Back to Settings</a>')
        expect(html).not.toContain('href="/login">Login</a>')
        expect(html).not.toContain('href="/register">Create account</a>')
        expect(html).not.toContain('href="/login">Sign in</a>')
        expect(html).not.toContain('name="toyhouseUsername"')
        expect(html).not.toContain('Toyhou.se username')
        expect(html).toContain('Review Characters for Import')
        expect(html).toContain('3 ready to import, 1 blocked')
        expect(html).toContain('data-toyhouse-final-import-progress')
        expect(html).toContain('data-toyhouse-final-import-bar')
        expect(html).toContain('MyOC is importing your images')
        expect(html).toContain('The server is downloading Toyhou.se images, uploading them to MyOC storage, and saving the character data.')
        expect(html).toContain('name="characterIds" type="checkbox" value="9430171"')
        expect(html).toContain('checked="" class="checkbox checkbox-primary')
        expect(html).toContain('data-toyhouse-import-review')
        expect(html).toContain('name="imageUrls:9430171"')
        expect(html).toContain('name="nsfwImageUrls:9430171"')
        expect(html).toContain('name="importMode:2222222" type="hidden" value="existing"')
        expect(html).toContain('name="targetCharacterId:2222222" type="hidden" value="existing-brindle"')
        expect(html).toContain('NSFW')
        expect(html).toContain('data-toyhouse-image-select')
        expect(html).toContain('data-toyhouse-image-nsfw')
        expect(html).toContain('syncImageNsfw')
        expect(html).toContain('Absinthe')
        expect(html).toContain('Brindle')
        expect(html).toContain('Bad/Name')
        expect(html).toContain('&quot;Ivo&quot;')
        expect(html).toContain('Blocked')
        expect(html).toContain('Create new character')
        expect(html).toContain('A new character named Absinthe will be created with the selected images.')
        expect(html).toContain('A new character named &quot;Ivo&quot; will be created with the selected images.')
        expect(html).toContain('Add images to existing')
        expect(html).toContain('A character named Brindle already exists. Selected images will be added to that character.')
        expect(html).not.toContain('Character name already exists on this account.')
        expect(html).toContain('Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must include at least one letter or number.')
        expect(html).toContain('1 image found (2 listed)')
        expect(html).toContain('2 images found (7 listed)')
        expect(html).toContain('https://toyhou.se/demo/characters/folder:all')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png')
        expect(html).toContain('src="https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png"')
        expect(html).not.toContain('src="https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_thumb.png"')
        expect(html).not.toContain('Full size 1')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png')
    })

    it('prepares selected Toyhou.se characters for client-side chunked image upload', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const payload = {
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [
                {
                    id: '9430171',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_second.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_second_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_third.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_third_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_fourth.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_fourth_thumb.png',
                        },
                    ],
                    imageCount: 4,
                    name: 'Absinthe',
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
                {
                    id: '2222222',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/2222222_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/2222222_alt_thumb.png',
                        },
                    ],
                    imageCount: 2,
                    name: 'Brindle',
                    thumbnailUrl: null,
                    url: 'https://toyhou.se/2222222.brindle',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.append('characterIds', '9430171')
        form.append('characterIds', '2222222')
        form.set('profileImageDataUrl:9430171', createWebpDataUrl())
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png')
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_second.png')
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_third.png')
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_fourth.png')
        form.append('imageUrls:2222222', 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_full.png')
        form.append('imageUrls:2222222', 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png')
        form.append('nsfwImageUrls:2222222', 'https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png')

        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            characters: [
                {id: 'existing-brindle', name: 'brindle'},
            ],
        })
        const bucket = createMockR2Bucket()
        const response = await app.request('https://example.com/migrate/import/confirm', {
            body: form,
            headers: {
                cookie: 'myoc_session=session-token',
            },
            method: 'POST',
        }, {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: bucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        })
        const html = await response.text()
        const preparedSql = (db.prepare as unknown as { mock: { calls: [string][] } }).mock.calls
            .map(([sql]) => sql)
            .join('\n')
        const putCalls = (bucket.put as unknown as {
            mock: { calls: [string, unknown, { httpMetadata?: { contentType?: string } }?][] }
        }).mock.calls
        const putKeys = putCalls
            .map(([key]) => key)
        const putContentTypes = putCalls
            .map(([, , options]) => options?.httpMetadata?.contentType)

        expect(response.status).toBe(200)
        expect(html).toContain('Uploading Toyhou.se Images')
        expect(html).toContain('upload each image in chunks and retry temporary failures')
        expect(html).toContain('/migrate/toyhouse-image?url=')
        expect(html).toContain('/media/chunked/init')
        expect(html).toContain('/api/characters/toyhouse-import-items/')
        expect(html).toContain('/complete')
        expect(html).toContain('/fail')
        expect(html).toContain("method: 'DELETE'")
        expect(html).toContain('importItemId')
        expect(html).toContain('withRetry')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_fourth.png')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/2222222_alt.png')
        expect(preparedSql).toContain(['INSERT INTO', 'characters'].join(' '))
        expect(preparedSql).not.toContain(['INSERT INTO', 'character_media'].join(' '))
        expect(preparedSql).not.toContain(['INSERT INTO', 'character_gallery_tabs'].join(' '))
        expect(preparedSql).not.toContain(['INSERT INTO', 'character_gallery_rows'].join(' '))
        expect(putKeys).toHaveLength(1)
        expect(putKeys.some((key) => key.includes('/profile/') && key.endsWith('.webp'))).toBe(true)
        expect(putKeys.some((key) => key.includes('/media/'))).toBe(false)
        expect(putContentTypes).toContain('image/webp')
        expect(putContentTypes).not.toContain('PNG32')
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('looks up large Toyhou.se import item sets in bounded D1 queries', async () => {
        const imageUrls = Array.from({length: 120}, (_, index) => `https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_${index}.png`)
        const payload = {
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [
                {
                    id: '9430171',
                    images: imageUrls.map((fullsizeUrl, index) => ({
                        fullsizeUrl,
                        thumbnailUrl: `https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_${index}.png`,
                    })),
                    imageCount: imageUrls.length,
                    name: 'Absinthe',
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.append('characterIds', '9430171')
        form.set('profileImageDataUrl:9430171', createWebpDataUrl())
        for (const imageUrl of imageUrls) {
            form.append('imageUrls:9430171', imageUrl)
        }

        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        })
        const response = await app.request('https://example.com/migrate/import/confirm', {
            body: form,
            headers: {
                cookie: 'myoc_session=session-token',
            },
            method: 'POST',
        }, {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: createMockR2Bucket(),
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        })
        const bindSizes = (db.prepare as unknown as {
            mock: { results: { value: { bind?: { mock: { calls: unknown[][] } } } }[] }
        }).mock.results
            .flatMap((result) => result.value.bind?.mock.calls ?? [])
            .map((binds) => binds.length)

        expect(response.status).toBe(200)
        expect(Math.max(...bindSizes)).toBeLessThanOrEqual(90)
    })

    it('keeps staged Toyhou.se profile images when import item readback fails after DB commit', async () => {
        const payload = {
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [
                {
                    id: '9430171',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_thumb.png',
                        },
                    ],
                    imageCount: 1,
                    name: 'Absinthe',
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.append('characterIds', '9430171')
        form.set('profileImageDataUrl:9430171', createWebpDataUrl())
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png')

        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
            toyhouseImportItemsError: new Error('simulated import item lookup failure'),
        })
        const bucket = createMockR2Bucket()
        const response = await app.request('https://example.com/migrate/import/confirm', {
            body: form,
            headers: {
                cookie: 'myoc_session=session-token',
            },
            method: 'POST',
        }, {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: bucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('simulated import item lookup failure')
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(bucket.put).toHaveBeenCalledTimes(1)
        expect(bucket.delete).not.toHaveBeenCalled()
    })

    it('leaves Toyhou.se gallery image failures to the client-side chunked uploader', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        const payload = {
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [
                {
                    id: '9430171',
                    images: [
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/9430171_thumb.png',
                        },
                        {
                            fullsizeUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/images/broken.png',
                            thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/thumbnails/broken.png',
                        },
                    ],
                    imageCount: 2,
                    name: 'Absinthe',
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.append('characterIds', '9430171')
        form.set('profileImageDataUrl:9430171', createWebpDataUrl())
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_full.png')
        form.append('imageUrls:9430171', 'https://f2.toyhou.se/file/f2-toyhou-se/images/broken.png')

        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        })
        const bucket = createMockR2Bucket()
        const response = await app.request('https://example.com/migrate/import/confirm', {
            body: form,
            headers: {
                cookie: 'myoc_session=session-token',
            },
            method: 'POST',
        }, {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: bucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Uploading Toyhou.se Images')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/broken.png')
        expect(html).toContain('Downloading Toyhou.se image')
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/migrate')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
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
        expectPatternAllowsReportedCharacterNames(html, 'character-name')
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

describe('GET /characters', () => {
    it('renders a valid character name pattern for creating characters', async () => {
        const response = await getAppPath('/characters', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Character Management | MyOC')
        expectPatternAllowsReportedCharacterNames(html, 'new-character-name')
    })
})

describe('GET /admin', () => {
    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/admin')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('returns not found for logged-in users who are not admins', async () => {
        const response = await getAppPath('/admin', createProfilePageDb({
            currentUser: createCurrentUserRecord('demo'),
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).not.toContain('Admin | MyOC')
    })

    it('renders the admin shell for admin users', async () => {
        const response = await getAppPath('/admin', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('admin_user'),
                role: 'admin',
            },
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Image Approvals | Admin | MyOC</title>')
        expect(html).toContain('href="/admin"')
        expect(html).toContain('aria-label="Admin sections"')
        expect(html).toContain('href="/admin/image-approvals"')
        expect(html).toContain('Image Approvals')
        expect(html).toContain('href="/admin/moderate-images"')
        expect(html).toContain('Moderate Images')
        expect(html).toContain('href="/admin/moderate-characters"')
        expect(html).toContain('Moderate Characters')
        expect(html).toContain('href="/admin/moderate-users"')
        expect(html).toContain('Moderate Users')
        expect(html).toContain('href="/admin/reports"')
        expect(html).toContain('Reports')
        expect(html).toContain('aria-label="Image Approvals content"')
    })

    it('renders admin section routes with the matching section active', async () => {
        const response = await getAppPath('/admin/moderate-users', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('admin_user'),
                role: 'admin',
            },
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Moderate Users | Admin | MyOC</title>')
        expect(html).toContain('aria-current="page"')
        expect(html).toContain('aria-label="Moderate Users content"')
    })

    it('embeds image approval data for the image approvals page', async () => {
        const response = await getAppPath('/admin/image-approvals', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('admin_user'),
                role: 'admin',
            },
            imageApprovalQueue: [{
                id: 'media-1',
                username: 'uploader',
                character_name: 'Quartz',
                sfw_image_key: 'sfw-key',
                nsfw_image_key: null,
                sfw_review_status: 'pending',
                sfw_reviewed_at: null,
                nsfw_review_status: 'pending',
                nsfw_reviewed_at: null,
                created_at: '2026-06-10 12:00:00',
                updated_at: '2026-06-10 12:00:00',
            }],
            imageApprovalItem: {
                id: 'media-1',
                user_id: 'owner-1',
                username: 'uploader',
                email: 'uploader@example.test',
                character_id: 'character-1',
                character_name: 'Quartz',
                sfw_image_key: 'sfw-key',
                nsfw_image_key: null,
                sfw_artist: 'Artist',
                nsfw_artist: '',
                sfw_width: 1200,
                sfw_height: 900,
                sfw_byte_size: 1024,
                nsfw_width: null,
                nsfw_height: null,
                nsfw_byte_size: null,
                sfw_review_status: 'pending',
                sfw_reviewed_at: null,
                sfw_approved_at: null,
                sfw_homepage_allowed: 0,
                nsfw_review_status: 'pending',
                nsfw_reviewed_at: null,
                nsfw_approved_at: null,
                created_at: '2026-06-10 12:00:00',
                updated_at: '2026-06-10 12:00:00',
            },
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Image Approvals | Admin | MyOC</title>')
        expect(html).toContain('data-image-approvals')
        expect(html).toContain('"objectKey":"characters/owner-1/character-1/media/media-1/sfw/sfw-key.png"')
        expect(html).toContain('"username":"uploader"')
        expect(html).toContain('"profileUrl":"/u/uploader"')
        expect(html).toContain('"url":"/u/uploader/Quartz"')
        expect(html).toContain('admin-approval-image-grid')
        expect(html).toContain('handleKeyboardShortcuts')
        expect(html).toContain("a: ['sfw', 'approve_sfw_homepage']")
        expect(html).toContain("openVariantInNewTab('nsfw')")
        expect(html).not.toContain('/admin-image-approvals.js')
    })

    it('renders reported images on the reports page', async () => {
        const response = await getAppPath('/admin/reports', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('admin_user'),
                role: 'admin',
            },
            adminReports: [{
                id: 'media-1',
                user_id: 'owner-1',
                username: 'uploader',
                character_id: 'character-1',
                character_name: 'Quartz',
                sfw_image_key: 'sfw-key',
                nsfw_image_key: null,
                sfw_review_status: 'reported',
                nsfw_review_status: 'pending',
                sfw_reviewed_at: '2026-06-10 12:00:00',
                nsfw_reviewed_at: null,
                sfw_reported_by_username: 'admin_user',
                nsfw_reported_by_username: null,
            }],
        }), {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Reports | Admin | MyOC</title>')
        expect(html).toContain('SFW image report')
        expect(html).toContain('Reported by @admin_user in Image Approvals.')
        expect(html).toContain('href="/u/uploader/Quartz"')
        expect(html).toContain('href="/u/uploader"')
        expect(html).toContain('Resubmit for Approval')
        expect(html).toContain('Delete Image')
        expect(html).toContain('Ban User')
        expect(html).toContain('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })

    it('returns not found for unknown admin sections', async () => {
        const response = await getAppPath('/admin/unknown-section', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('admin_user'),
                role: 'admin',
            },
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
        expect(html).toContain('<meta content="Character page description." name="description"/>')
        expect(html).toContain('<link href="https://example.com/u/demo/RAZETH" rel="canonical"/>')
        expect(html).toContain('<meta content="RAZETH | MyOC" property="og:title"/>')
        expect(html).toContain('<meta content="Character page description." property="og:description"/>')
        expect(html).toContain('<meta content="https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp" property="og:image"/>')
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="RAZETH thumbnail" property="og:image:alt"/>')
        expect(html).toContain('<meta content="summary" name="twitter:card"/>')
        expect(html).toContain('<meta content="https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp" name="twitter:image"/>')
        expect(html).toContain('"@type":"CreativeWork"')
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

    it('redirects profile URLs to the stored username casing', async () => {
        const response = await getProfilePath('/u/DEMO?tab=characters', createProfilePageDb({
            profileUser: {
                id: 'profile-user',
                username: 'demo',
                profile_photo_key: null,
                bio: '',
            },
        }))

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo?tab=characters')
    })

    it('redirects character URLs to the stored username and character name casing', async () => {
        const response = await getProfilePath('/u/DEMO/razeth?view=gallery', createProfilePageDb({
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
        }))

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo/RAZETH?view=gallery')
    })

    it('renders NSFW gallery variants when the current user enabled NSFW media', async () => {
        const response = await getAppPath('/u/demo/RAZETH', createProfilePageDb({
            currentUser: {
                ...createCurrentUserRecord('viewer'),
                display_nsfw_media: 1,
            },
            mediaCount: 987,
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
        expect(html).toContain('<meta content="Hosting over 987 images" name="description"/>')
        expect(html).toContain('<meta content="Hosting over 987 images" property="og:description"/>')
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
            mediaCount: 987,
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
        expect(html).toContain('<meta content="Live profile bio." name="description"/>')
        expect(html).toContain('<link href="https://example.com/u/demo" rel="canonical"/>')
        expect(html).toContain('<meta content="demo | MyOC" property="og:title"/>')
        expect(html).toContain('<meta content="Live profile bio." property="og:description"/>')
        expect(html).toContain('<meta content="profile" property="og:type"/>')
        expect(html).toContain('<meta content="https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp" property="og:image"/>')
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="demo profile photo" property="og:image:alt"/>')
        expect(html).toContain('<meta content="summary" name="twitter:card"/>')
        expect(html).toContain('<meta content="https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp" name="twitter:image"/>')
        expect(html).toContain('"@type":"ProfilePage"')
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
            mediaCount: 987,
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
        expect(html).toContain('<meta content="Hosting over 987 images" name="description"/>')
        expect(html).toContain('<meta content="Hosting over 987 images" property="og:description"/>')
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
