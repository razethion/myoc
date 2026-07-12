import {afterEach, describe, expect, it, vi} from 'vitest'
import app from '../index'
import {APP_VERSION, RELEASE_NOTES} from '../lib/releases'
import {createWebpDataUrl} from '../test/imageFixtures'
import {createMockKVNamespace} from '../test/mockKV'
import {createMockR2Bucket} from '../test/mockR2'
import {resetWorkerBindings, workerEnv} from '../test/workerBindings'
import {pageRoutes} from './pages'

const mediaPublicBaseUrl = 'https://m.myoc.art'

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetWorkerBindings()
})

type QueryResult = {
    results: unknown[]
}

function createProfilePageDb(
    options: {
        profileUser?: unknown
        currentUser?: unknown
        socialLinks?: unknown[]
        folders?: unknown[]
        characters?: unknown[]
        placements?: unknown[]
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
        uploadedImageCount?: number
        discoverCharacters?: unknown[]
        homeGalleryImages?: unknown[]
        homeHeightChartCharacters?: unknown[]
        activeToyhouseImportJob?: unknown
        activeToyhouseImportItems?: unknown[]
        toyhouseImportItemsError?: Error
        imageApprovalItem?: unknown
        imageApprovalQueue?: unknown[]
        imageApprovalCount?: number
        imageApprovalHistory?: unknown[]
        adminReports?: unknown[]
        adminJobRuns?: unknown[]
        userPasskeys?: unknown[]
    } = {},
): D1Database {
    const firstForSql = async (sql: string) => {
        if (sql.includes('sfw_image_key IS NOT NULL') && sql.includes('nsfw_image_key IS NOT NULL') && sql.includes('AS count')) {
            return {count: options.imageApprovalCount ?? options.imageApprovalQueue?.length ?? 0}
        }

        if (sql.includes('COUNT(*) AS count') && sql.includes('FROM character_media')) {
            return {count: options.mediaCount ?? 0}
        }

        if (sql.includes('uploaded_image_count') && sql.includes('FROM character_media')) {
            return {uploaded_image_count: options.uploadedImageCount ?? options.mediaCount ?? 0}
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
        if (sql.includes('character_media.sfw_homepage_allowed = 1')) {
            return {results: options.homeGalleryImages ?? []}
        }

        if (sql.includes('lower(users.username) = ?') && sql.includes('characters.height_chart_json <>')) {
            return {results: options.homeHeightChartCharacters ?? []}
        }

        if (sql.includes('eligible_characters')) {
            return {results: options.discoverCharacters ?? []}
        }

        if (sql.includes('sfw_reported_by_username')) {
            return {results: options.adminReports ?? []}
        }

        if (sql.includes('FROM admin_job_runs')) {
            return {results: options.adminJobRuns ?? []}
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

        if (sql.includes('FROM user_passkeys')) {
            return {results: options.userPasskeys ?? []}
        }

        if (sql.includes('FROM character_folder_placements')) {
            return {results: options.placements ?? []}
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
    return pageRoutes.request(
        `https://example.com${path}`,
        {},
        {
            CACHE: workerEnv.CACHE,
            DB: db,
            DB_BACKUP_BUCKET: workerEnv.DB_BACKUP_BUCKET,
            MEDIA_BUCKET: workerEnv.MEDIA_BUCKET,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

async function getAppPath(
    path: string,
    db = createProfilePageDb(),
    headers: Record<string, string> = {},
    cache = workerEnv.CACHE,
): Promise<Response> {
    return app.request(
        `https://example.com${path}`,
        {headers},
        {
            CACHE: cache,
            DB: db,
            DB_BACKUP_BUCKET: workerEnv.DB_BACKUP_BUCKET,
            MEDIA_BUCKET: workerEnv.MEDIA_BUCKET,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

function createCurrentUserRecord(username = 'demo', overrides: Record<string, unknown> = {}) {
    return {
        id: 'current-user',
        email: `${username}@example.test`,
        username,
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        passkey_prompt_seen_at: '2026-07-10 00:00:00',
        ...overrides,
    }
}

function expectPatternAllowsReportedCharacterNames(html: string, inputId: string): void {
    const idAttribute = `id="${inputId}"`
    const idIndex = html.indexOf(idAttribute)
    const inputEndIndex = idIndex >= 0 ? html.indexOf('>', idIndex) : -1
    const inputHtml = inputEndIndex >= 0 ? html.slice(idIndex, inputEndIndex) : ''
    const patternAttribute = 'pattern="'
    const patternStartIndex = inputHtml.indexOf(patternAttribute)
    const patternValueStartIndex = patternStartIndex >= 0 ? patternStartIndex + patternAttribute.length : -1
    const patternValueEndIndex = patternValueStartIndex >= 0 ? inputHtml.indexOf('"', patternValueStartIndex) : -1
    const rawPattern = patternValueEndIndex >= 0 ? inputHtml.slice(patternValueStartIndex, patternValueEndIndex) : ''

    expect(rawPattern).toBeTruthy()

    if (!rawPattern) {
        throw new Error(`Pattern attribute was not rendered for ${inputId}`)
    }

    const pattern = rawPattern.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- This test intentionally compiles the rendered HTML pattern attribute to verify browser validation behavior.
    const regex = new RegExp(`^(?:${pattern})$`, 'v')

    expect(regex.test('DRD-5548 "Ivo"')).toBe(true)
    expect(regex.test('"Ivo"')).toBe(true)
    expect(regex.test('---')).toBe(false)
}

describe('public page redirects', () => {
    it('renders home for logged-in users', async () => {
        const response = await getAppPath(
            '/',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                userCount: 24,
                characterCount: 128,
                mediaCount: 4096,
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>MyOC | High-Resolution Character Gallery</title>')
        expect(html).toContain('Easy maintenance. Easy browsing.')
        expect(html).toContain('data-home-gallery-wall')
        expect(html).toContain('home-hero-stats')
        expect(html).toContain('stats stats-vertical')
        expect(html).not.toContain('Character-first archive')
        expect(html).not.toContain('Library flow')
        expect(html).not.toContain('MyOC is source available.')
        expect(html).not.toContain('href="https://github.com/razethion/myoc"')
        expect(html).not.toContain('home-loading-image')
        expect(html).not.toContain('data-gallery-image-loader')
        expect(html).toContain('href="/u/demo"')
        expect(html).toContain('Report issue')
        expect(html).toContain('href="https://github.com/razethion/myoc/issues"')
        expect(html).toContain('Ask a question')
        expect(html).toContain('href="https://github.com/razethion/myoc/discussions"')
        expect(html).toContain('24')
        expect(html).toContain('128')
        expect(html).toContain('4,096')
    })

    it('renders approved homepage gallery thumbnails below the hero', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)

        const db = createProfilePageDb({
            homeGalleryImages: [
                {
                    id: 'media-1',
                    user_id: 'owner-1',
                    character_id: 'character-1',
                    sfw_image_key: 'full-key',
                    sfw_content_type: 'image/png',
                    sfw_preview_image_key: 'preview-thumb-key',
                    sfw_width: 640,
                    sfw_height: 960,
                    sfw_preview_width: 320,
                    sfw_preview_height: 480,
                    sfw_artist: 'Demo Artist',
                    character_name: 'Quartz Dragon',
                    owner_username: 'demo_owner',
                },
                {
                    id: 'media-2',
                    user_id: 'owner-2',
                    character_id: 'character-2',
                    sfw_image_key: 'second-full-key',
                    sfw_content_type: 'image/jpeg',
                    sfw_preview_image_key: 'second-preview-thumb-key',
                    sfw_width: 960,
                    sfw_height: 640,
                    sfw_preview_width: 480,
                    sfw_preview_height: 320,
                    sfw_artist: 'Second Artist',
                    character_name: 'Wide Lynx',
                    owner_username: 'second_owner',
                },
            ],
        })
        const response = await getAppPath('/', db)
        const html = await response.text()
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(html).toContain('Gallery Management')
        expect(html).toContain('data-home-approved-gallery')
        expect(html).toContain('data-gallery-tile')
        expect(html).toContain("document.querySelectorAll('[data-home-approved-gallery]')")
        expect(html).toContain('var imageObserver = new IntersectionObserver(function (entries)')
        expect(html).toContain('imageObserver.observe(tile)')
        expect(html).toContain('imageObserver.unobserve(entry.target)')
        expect(html).toContain("rootMargin: '400px 0px', threshold: 0.01")
        expect(html).toContain('function tileIsNearViewport(tile)')
        expect(html).toContain('var tileQueue = []')
        expect(html).toContain('var tileQueueRunning = false')
        expect(html).toContain('var tileLoadDelay = 65')
        expect(html).toContain('var galleryLoadingStarted = false')
        expect(html).toContain('function enqueueTile(tile)')
        expect(html).toContain('function processTileQueue()')
        expect(html).toContain('function startGalleryLoading()')
        expect(html).toContain('if (galleryLoadingStarted)')
        expect(html).toContain('window.setTimeout(processTileQueue, tileLoadDelay)')
        expect(html).toContain('enqueueTile(entry.target)')
        expect(html).toContain("window.addEventListener('scroll', startGalleryLoading, {once: true, passive: true})")
        expect(html).toContain('if ((window.scrollY || document.documentElement.scrollTop) > 0)')
        expect(html).toContain('var preloadMargin = 400')
        expect(html).not.toContain("gallery.querySelectorAll('[data-gallery-tile]').forEach(function (tile, index)")
        expect(html).not.toContain('}, index * 65)')
        expect(html).not.toContain('function preloadGalleryImages()')
        expect(html).not.toContain("window.addEventListener('load', schedulePreload, {once: true})")
        expect(html).toContain('window.requestAnimationFrame(function ()')
        expect(html).not.toContain("rootMargin: '0px', threshold: 0.01")
        expect(html).toContain('border-color: transparent')
        expect(html).toContain('contain: layout paint')
        expect(html).toContain('content-visibility: auto')
        expect(html).toContain('.home-float {\n                animation: none;')
        expect(html).toContain('@media (min-width: 1024px) {')
        expect(html).toContain('animation: home-float var(--home-float-duration, 7s) ease-in-out infinite;')
        expect(html).not.toContain("rootMargin: '35% 0px 35% 0px'")
        expect(html).toContain('object-contain')
        expect(html).toContain('border border-white bg-black')
        expect(html).not.toContain('bg-black shadow-xl shadow-base-300/35')
        expect(html).not.toContain('shadow-xl')
        expect(html).not.toContain('shadow-2xl')
        expect(html).not.toContain('backdrop-blur')
        expect(html).not.toContain('drop-shadow')
        expect(html).toContain('bg-[#141414]')
        expect(html).toContain('relative -mx-4 mt-8 max-h-[50vh] overflow-hidden sm:-mx-6')
        expect(html).toContain('home-approved-gallery relative -left-8 -top-6 w-[calc(100%+4rem)] max-w-none columns-4 gap-2 lg:absolute')
        expect(html).not.toContain('home-approved-gallery absolute left-0 top-1/2')
        expect(html).not.toContain('columns-2 gap-2 sm:columns-3 lg:absolute')
        expect(html).toContain('home-reveal relative z-20 aspect-4/5 w-full')
        expect(html).not.toContain('home-reveal relative z-20 mb-8 aspect-4/5 w-full')
        expect(html).toContain('home-float absolute inset-0 overflow-visible bg-transparent')
        expect(html).toContain('h-full w-full object-contain object-center')
        expect(html).not.toContain('h-[min(72vh,36rem)]')
        expect(html).not.toContain('max-h-[82vh]')
        expect(html).toContain('px-4 pt-10 pb-8 sm:px-6 sm:pt-14 sm:pb-8')
        expect(html).not.toContain('px-4 pt-10 pb-16')
        expect(html).toContain('relative z-10 mx-auto grid max-w-7xl gap-8 lg:h-full')
        expect(html).not.toContain('relative z-10 mx-auto grid h-full max-w-7xl')
        expect(html).toContain('lg:columns-6')
        expect(html).not.toContain('xl:columns-7')
        expect(html).not.toContain('2xl:columns-8')
        expect(html).not.toContain('relative z-0 mx-auto grid')
        expect(html).not.toContain('data-home-gallery-vignette')
        expect(html).not.toContain('pointer-events-none absolute inset-0 z-10 overflow-hidden')
        expect(html).not.toContain('blur-3xl')
        expect(html).not.toContain('rgba(20, 20, 20')
        expect(html).not.toContain('radial-gradient')
        expect(html).not.toContain('linear-gradient')
        expect(html).not.toContain('bg-linear-to-t')
        expect(html).not.toContain('mask-image')
        expect(html).not.toContain('home-gallery-scan')
        expect(html).toContain('aria-hidden="true" class="absolute inset-0 bg-black"')
        expect(html).not.toContain('skeleton absolute')
        expect(html).toContain('style="aspect-ratio:320 / 480"')
        expect(html).toContain('href="/u/demo_owner/Quartz%20Dragon"')
        expect(html).toContain(
            'data-src="https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview/preview-thumb-key.webp"',
        )
        expect(html).toContain('data-fallback-src="https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/full-key.png"')
        expect(html).toContain('alt="Quartz Dragon gallery art by Demo Artist"')
        expect(html).toContain('href="/u/second_owner/Wide%20Lynx"')
        expect(html).toContain(
            'data-src="https://m.myoc.art/characters/owner-2/character-2/media/media-2/sfw/preview/second-preview-thumb-key.webp"',
        )
        expect(html.indexOf('second-preview-thumb-key.webp')).toBeLessThan(html.indexOf('preview-thumb-key.webp'))
        expect(html).toContain('width="320"')
        expect(html).toContain('height="480"')
        expect(html.match(/data-gallery-tile="true"/g)?.length).toBe(48)
        expect(preparedSql).toContain('users.username AS owner_username')
        expect(preparedSql).toContain('INNER JOIN users ON users.id = characters.user_id')
        expect(preparedSql).toContain("sfw_review_status = 'approved'")
        expect(preparedSql).toContain('sfw_homepage_allowed = 1')
        expect(preparedSql).toContain('sfw_preview_image_key IS NOT NULL')
        expect(preparedSql).toContain('ORDER BY RANDOM()')
        expect(preparedSql).not.toContain('ORDER BY COALESCE(character_media.sfw_approved_at, character_media.created_at) DESC')
    })

    it('caches randomized homepage gallery thumbnails for one day', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)

        const db = createProfilePageDb({
            homeGalleryImages: [
                {
                    id: 'media-1',
                    user_id: 'owner-1',
                    character_id: 'character-1',
                    sfw_image_key: 'full-key',
                    sfw_content_type: 'image/png',
                    sfw_preview_image_key: 'preview-thumb-key',
                    sfw_width: 640,
                    sfw_height: 960,
                    sfw_preview_width: 320,
                    sfw_preview_height: 480,
                    sfw_artist: 'Demo Artist',
                    character_name: 'Quartz Dragon',
                    owner_username: 'demo_owner',
                },
            ],
        })
        const cache = createMockKVNamespace()
        const response = await getAppPath('/', db, {}, cache)
        const cachePutCalls = (cache.put as unknown as {mock: {calls: unknown[][]}}).mock.calls
        const galleryCachePut = cachePutCalls.find(([key]) => key === 'home:gallery:v1')

        expect(response.status).toBe(200)
        expect(galleryCachePut).toBeTruthy()
        expect(galleryCachePut?.[2]).toEqual({expirationTtl: 60 * 60 * 24})
        expect(JSON.parse(galleryCachePut?.[1] as string)).toEqual([
            expect.objectContaining({
                href: '/u/demo_owner/Quartz%20Dragon',
                src: 'https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview/preview-thumb-key.webp',
            }),
        ])
    })

    it('renders the homepage height chart preview from Razeth chart models', async () => {
        const db = createProfilePageDb({
            homeHeightChartCharacters: [
                {
                    id: 'character-ivo',
                    name: 'DRD-5548 "Ivo"',
                    user_id: 'user-razeth',
                    username: 'razeth',
                    height_chart_json: JSON.stringify({
                        version: 1,
                        height: {meters: 1.2},
                        image: {
                            key: 'ivo-chart-key',
                            contentType: 'image/png',
                            naturalWidth: 420,
                            naturalHeight: 980,
                        },
                        calibration: {
                            headYPercent: 8,
                            footYPercent: 96,
                            footIsVirtual: false,
                        },
                    }),
                },
                {
                    id: 'character-luxor',
                    name: 'Luxor',
                    user_id: 'user-razeth',
                    username: 'razeth',
                    height_chart_json: JSON.stringify({
                        version: 1,
                        height: {meters: 3.6},
                        image: {
                            key: 'luxor-chart-key',
                            contentType: 'image/webp',
                            naturalWidth: 760,
                            naturalHeight: 1500,
                        },
                        calibration: {
                            headYPercent: 5,
                            footYPercent: 92,
                            footIsVirtual: false,
                        },
                    }),
                },
            ],
        })
        const response = await getAppPath('/', db)
        const html = await response.text()
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(html).toContain('Height Charts')
        expect(html).toContain('How do you stack up?')
        expect(html).toContain('data-home-chart-x-pct="33"')
        expect(html).toContain('data-home-chart-x-pct="67"')
        expect(html).toContain('/assets/home-height-ivo.webp')
        expect(html).toContain('/assets/home-height-luxor.webp')
        expect(html).toContain('home-size-chart-grid-line')
        expect(html).toContain('home-size-chart-plot.is-visible .home-size-chart-character.is-positioned')
        expect(html).toContain('transition: opacity 480ms ease, transform 680ms cubic-bezier')
        expect(html).toContain('--home-chart-enter-delay:0ms')
        expect(html).toContain('--home-chart-enter-delay:110ms')
        expect(html).toContain('var revealObserver = new IntersectionObserver(function (entries)')
        expect(html).toContain('revealPlot(entry.target)')
        expect(html).not.toContain('2 characters')
        expect(preparedSql).toContain('lower(users.username) = ?')
        expect(preparedSql).toContain('characters.height_chart_json <>')
    })

    it('renders the product vision page', async () => {
        const response = await getAppPath('/product-vision')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Product Vision | MyOC')
        expect(html).toContain('Making character art easy to store and share.')
        expect(html).toContain('What MyOC is')
        expect(html).toContain('What MyOC isn&#39;t')
    })

    it('renders the site policies page', async () => {
        const response = await getAppPath('/site-policies')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Site Policies | MyOC')
        expect(html).toContain('Rules for hosting, sharing, and moderating character media.')
        expect(html).toContain('Content classification and NSFW rules')
        expect(html).toContain('Technical abuse and platform integrity')
    })

    it('renders the size chart content preferences warning', async () => {
        const response = await getAppPath('/size-chart')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Size Chart | MyOC')
        expect(html).toContain('alert alert-warning')
        expect(html).toContain('This feature does not yet support content preferences. You may see NSFW media unexpectedly.')
    })

    it('renders discover galleries worth browsing on the homepage', async () => {
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
                    preview_thumbnail_image_key: 'preview-thumb-key',
                    preview_artist: 'Demo Artist',
                },
            ],
        })
        const response = await getAppPath('/', db)
        const html = await response.text()
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(html).toContain('Easy maintenance. Easy browsing.')
        expect(html).toContain('Galleries worth browsing.')
        expect(html).toContain('Quartz Dragon')
        expect(html).toContain('by @demo_owner')
        expect(html).toContain('7 images')
        expect(html).toContain('href="/u/demo_owner/Quartz%20Dragon"')
        expect(html).toContain('alt="Quartz Dragon gallery preview by Demo Artist"')
        expect(html).toContain('https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview/preview-thumb-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/owner-1/character-1/profile/profile-key.webp')
        expect(preparedSql).toContain('eligible_characters')
        expect(preparedSql).toContain('HAVING COUNT(approved_sfw_media.id) >= 5')
        expect(preparedSql.replace(/\s+/g, ' ')).toContain(
            'SUM(CASE WHEN approved_sfw_media.sfw_homepage_allowed = 1 THEN 1 ELSE 0 END) >= 1',
        )
        expect(preparedSql).toContain('sfw_preview_image_key IS NOT NULL')
        expect(preparedSql).toContain("sfw_review_status = 'approved'")
        expect(preparedSql).toContain('sfw_homepage_allowed = 1')
    })

    it('renders homepage stats from KV cache', async () => {
        const db = createProfilePageDb()
        const cache = createMockKVNamespace({
            values: {
                'home:stats:v1': {
                    users: 12,
                    characters: 34,
                    mediaItems: 56,
                },
                'home:discover:v2': [
                    {
                        id: 'cached-character',
                        userId: 'cached-owner',
                        name: 'Cached Quartz',
                        ownerUsername: 'cached_user',
                        profileImageKey: 'cached-profile-key',
                        previewMediaId: 'cached-media',
                        previewImageKey: 'cached-preview-key',
                        previewThumbnailImageKey: 'cached-preview-thumb-key',
                        previewContentType: 'image/png',
                        previewArtist: 'Cache Artist',
                        imageCount: 42,
                    },
                ],
                'home:gallery:v1': [
                    {
                        id: 'cached-gallery-media',
                        alt: 'Cached gallery art by Cache Artist',
                        fallbackSrc:
                            'https://m.myoc.art/characters/cached-owner/cached-character/media/cached-gallery-media/sfw/cached-full-key.png',
                        height: 320,
                        href: '/u/cached_user/Cached%20Quartz',
                        src: 'https://m.myoc.art/characters/cached-owner/cached-character/media/cached-gallery-media/sfw/preview/cached-gallery-preview-key.webp',
                        width: 480,
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
        expect(html).toContain(
            'https://m.myoc.art/characters/cached-owner/cached-character/media/cached-media/sfw/preview/cached-preview-thumb-key.webp',
        )
        expect(html).toContain('https://m.myoc.art/characters/cached-owner/cached-character/profile/cached-profile-key.webp')
        expect(html).toContain('href="/u/cached_user/Cached%20Quartz"')
        expect(html).toContain(
            'data-src="https://m.myoc.art/characters/cached-owner/cached-character/media/cached-gallery-media/sfw/preview/cached-gallery-preview-key.webp"',
        )
        expect(db.prepare).toHaveBeenCalledTimes(1)
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

    it('redirects logged-in users without passkeys to the one-time passkey prompt', async () => {
        const response = await getAppPath(
            '/search?q=demo',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo', {
                    passkey_prompt_seen_at: null,
                }),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/passkey-setup?returnTo=%2Fsearch%3Fq%3Ddemo')
    })

    it('does not redirect users who already have passkeys', async () => {
        const response = await getAppPath(
            '/search?q=demo',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo', {
                    passkey_prompt_seen_at: null,
                }),
                userPasskeys: [{id: 'passkey-1'}],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Results for &quot;demo&quot;')
    })

    it('renders the passkey setup prompt without marking it seen', async () => {
        const db = createProfilePageDb({
            currentUser: createCurrentUserRecord('demo', {
                passkey_prompt_seen_at: null,
            }),
        })
        const response = await getAppPath('/passkey-setup?returnTo=/search?q=demo', db, {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Set Up A Passkey | MyOC</title>')
        expect(html).toContain('Set up a passkey')
        expect(html).toContain('name="choice" type="submit" value="setup"')
        expect(html).toContain('name="choice" type="submit" value="later"')
        expect(html).toContain('name="returnTo" type="hidden" value="/search?q=demo"')
        expect(preparedSql).not.toContain('UPDATE users')
    })

    it('renders home, login, and register for logged-out users', async () => {
        const homeResponse = await getAppPath('/')
        const loginResponse = await getAppPath('/login')
        const registerResponse = await getAppPath('/register')

        expect(homeResponse.status).toBe(200)
        expect(loginResponse.status).toBe(200)
        expect(registerResponse.status).toBe(200)
    })

    it('ignores obsolete home page variant query parameters', async () => {
        const archiveResponse = await getAppPath('/?home=archive')
        const showcaseResponse = await getAppPath('/?home=showcase')
        const unknownResponse = await getAppPath('/?home=unknown')
        const archiveHtml = await archiveResponse.text()
        const showcaseHtml = await showcaseResponse.text()
        const unknownHtml = await unknownResponse.text()

        expect(archiveResponse.status).toBe(200)
        expect(showcaseResponse.status).toBe(200)
        expect(unknownResponse.status).toBe(200)
        expect(archiveHtml).toContain('Easy maintenance. Easy browsing.')
        expect(showcaseHtml).toContain('Easy maintenance. Easy browsing.')
        expect(showcaseHtml).toContain('razfalling.webp')
        expect(unknownHtml).toContain('Easy maintenance. Easy browsing.')
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
        if (RELEASE_NOTES.some((release) => release.important)) {
            expect(html).toContain('alert alert-warning alert-dash')
            expect(html).toContain('This change requires user interaction')
            expect(html).toContain('badge badge-warning')
            expect(html).toContain('Important!')
        }
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
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')

        expect(response.status).toBe(200)
        expect(preparedSql).toContain('UPDATE users')
        expect(preparedSql).toContain('last_seen_version')
        expect(html).toContain('data-version-notification')
        expect(html).toContain('hidden"')
    })

    it('renders SEO metadata on the home page', async () => {
        const response = await getAppPath(
            '/',
            createProfilePageDb({
                mediaCount: 1234,
            }),
        )
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
        const response = await getAppPath(
            '/search?q=raz',
            createProfilePageDb({
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
            }),
        )
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
        const response = await getAppPath(
            '/settings',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>User Settings | MyOC</title>')
        expect(html).toContain('Migrate from Toyhou.se')
        expect(html).toContain('href="/migrate"')
    })
})

describe('GET /migrate', () => {
    it('renders the Toyhou.se migration form for signed-in users', async () => {
        const response = await getAppPath(
            '/migrate?toyhouseUsername=demo',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
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
        expect(html).toContain('url.pathname = path + &#39;/gallery&#39;')
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
        const response = await getAppPath(
            '/migrate/import',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Waiting for Toyhou.se')
        expect(html).toContain('data-toyhouse-import-receiver-status')
        expect(html).toContain('data-toyhouse-import-receiver-detail')
        expect(html).toContain('data-toyhouse-import-receiver-bar')
        expect(html).toContain("data.type === 'myoc:toyhouse-progress'")
        expect(html).toContain("data.type !== 'myoc:toyhouse-import'")
        expect(html).toContain('myoc:toyhouse-import-received')
        expect(html).toContain("form.method = 'post'")
        expect(html).toContain("input.name = 'toyhousePayload'")
        expect(html).toContain('id="logout-form"')
        expect(html).toContain('href="/settings">Back to Settings</a>')
        expect(html).not.toContain('href="/login">Login</a>')
    })

    it('proxies Toyhou.se images for signed-in users', async () => {
        const fetchMock = vi.fn(
            async () =>
                new Response('image-bytes', {
                    headers: {
                        'content-type': 'image/png',
                    },
                }),
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485')}`,
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
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://example.com/image.png')}`,
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
        const response = await getAppPath(
            '/migrate',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                activeToyhouseImportJob: {
                    id: 'toyhouse-import-job',
                    total_images: 2,
                },
                activeToyhouseImportItems: [{id: 'toyhouse-import-item'}],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/migrate/import/confirm')
    })

    it('redirects the Toyhou.se receiver page to confirm when an import job is active', async () => {
        const response = await getAppPath(
            '/migrate/import',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                activeToyhouseImportJob: {
                    id: 'toyhouse-import-job',
                    total_images: 2,
                },
                activeToyhouseImportItems: [{id: 'toyhouse-import-item'}],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/migrate/import/confirm')
    })

    it('does not redirect the migration start page for an active import job with no remaining items', async () => {
        const response = await getAppPath(
            '/migrate',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                activeToyhouseImportJob: {
                    id: 'toyhouse-import-job',
                    total_images: 2,
                },
                activeToyhouseImportItems: [],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Toyhou.se username')
        expect(html).not.toContain('Uploading Toyhou.se Images')
    })

    it('resumes an active Toyhou.se import job on the confirm page', async () => {
        const response = await getAppPath(
            '/migrate/import/confirm',
            createProfilePageDb({
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
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
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
        const response = await getAppPath(
            '/migrate/import/confirm',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

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
        form.set(
            'toyhousePayload',
            JSON.stringify({
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
            }),
        )

        const response = await app.request(
            'https://example.com/migrate/import',
            {
                body: form,
                headers: {
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: createProfilePageDb({
                    currentUser: createCurrentUserRecord('demo'),
                    characters: [{id: 'existing-brindle', name: 'brindle'}],
                }),
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
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
        expect(html).toContain(
            'Character name may contain only letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses, and must include at least one letter or number.',
        )
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
            characters: [{id: 'existing-brindle', name: 'brindle'}],
        })
        const bucket = createMockR2Bucket()
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: bucket,
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()
        const preparedSql = (
            db.prepare as unknown as {
                mock: {calls: [string][]}
            }
        ).mock.calls
            .map(([sql]) => sql)
            .join('\n')
        const putCalls = (
            bucket.put as unknown as {
                mock: {calls: [string, unknown, {httpMetadata?: {contentType?: string}}?][]}
            }
        ).mock.calls
        const putKeys = putCalls.map(([key]) => key)
        const putContentTypes = putCalls.map(([, , options]) => options?.httpMetadata?.contentType)

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
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const bindSizes = (
            db.prepare as unknown as {
                mock: {results: {value: {bind?: {mock: {calls: unknown[][]}}}}[]}
            }
        ).mock.results
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
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: bucket,
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
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
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: bucket,
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
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
        const response = await getAppPath(
            '/api/search?type=characters&q=character&offset=8',
            createProfilePageDb({
                searchCharacters,
                searchCharacterCount: 9,
            }),
            {
                accept: 'application/json',
            },
        )
        const body = (await response.json()) as {
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
        const response = await getAppPath(
            '/edit/character-1',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                characterSettings: {
                    id: 'character-1',
                    user_id: 'current-user',
                    name: 'RAZETH',
                    profile_image_key: 'profile-image-key',
                    description: 'Character description.',
                },
                characterMedia: [
                    {
                        id: 'media-1',
                        sfw_image_key: 'sfw-image-key',
                        nsfw_image_key: null,
                        sfw_artist: 'Artist',
                        nsfw_artist: '',
                        sfw_width: 640,
                        sfw_height: 480,
                        nsfw_width: null,
                        nsfw_height: null,
                    },
                ],
                galleryTabs: [
                    {
                        id: 'tab-1',
                        name: 'default',
                        sort_order: 0,
                    },
                ],
                galleryRows: [
                    {
                        row_id: 'row-1',
                        tab_id: 'tab-1',
                        row_sort_order: 0,
                        force_full_width: 1,
                        media_id: 'media-1',
                        media_sort_order: 0,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('RAZETH Settings | MyOC')
        expect(html).toContain('Character description.')
        expect(html).toContain('href="/u/demo/RAZETH"')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-1/profile/profile-image-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-1/media/media-1/sfw/sfw-image-key.png')
        expect(html).toContain('Gallery Tabs')
        expect(html).toContain('tabs tabs-border')
        expect(html).toContain('id="move-active-gallery-tab-left"')
        expect(html).toContain('.gallery-layout-tab.tab-active')
        expect(html).toContain('.gallery-layout-tab-action:not(:disabled)')
        expect(html).toContain('.gallery-layout-tab-action:disabled')
        expect(html).toContain('id="rename-active-gallery-tab"')
        expect(html).toContain('btn btn-dash btn-warning btn-sm btn-square')
        expect(html).toContain('btn btn-error btn-sm btn-square')
        expect(html).toContain('Force full width')
        expect(html).toContain('"forceFullWidth":true')
        expect(html).toContain('Used on ')
        expect(html).toContain('not used')
        expect(html).toContain('id="save-character-settings-warning"')
        expect(html).toContain('Place all media on at least one gallery tab before saving.')
        expect(html).not.toContain('id="add-gallery-row"')
        expect(html).toContain('id="gallery-rows"')
        expect(html).toContain('gallery-row-preview')
        expect(html).toContain('gallery-drop-marker')
        expect(html).toContain('data-gallery-draggable')
        expect(html).not.toContain('id="remove-row-modal"')
        expect(html).toContain('const csrfToken =')
        expectPatternAllowsReportedCharacterNames(html, 'character-name')
    })

    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/edit/character-1')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('does not expose the character settings page under the old characters path', async () => {
        const response = await getAppPath(
            '/characters/5f42998f-e37b-4135-9760-c2768ade86e1',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
    })
})

describe('GET /characters', () => {
    it('renders a valid character name pattern for creating characters', async () => {
        const response = await getAppPath(
            '/characters',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
                uploadedImageCount: 12,
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Character Management | MyOC')
        expect(html).toContain('Images Uploaded')
        expect(html).toContain('12 images')
        expectPatternAllowsReportedCharacterNames(html, 'new-character-name')
    })

    it('renders pointer-based drag sorting for mobile character management', async () => {
        const response = await getAppPath(
            '/characters',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('data-drag-handle')
        expect(html).toContain('touch-action: none')
        expect(html).toContain('character-drop-marker')
        expect(html).toContain('placement.dropzone.insertBefore(characterDropMarker, placement.beforeElement)')
        expect(html).toContain('folderList.forEach((placement, index) =>')
        expect(html).toContain('placement.sortOrder = index')
        expect(html).toContain("document.addEventListener('pointerdown', beginPointerDragCandidate)")
        expect(html).toContain("window.addEventListener('pointermove', handlePointerDragMove, { passive: false })")
        expect(html).toContain('document.elementFromPoint(event.clientX, event.clientY)')
        expect(html).toContain('const draggedSource = dragged.source')
        expect(html).toContain("showToast(draggedSource === 'profile' ? 'Character added to folder.' : 'Folder order saved.')")
        expect(html).not.toContain("showToast(dragged.source === 'profile'")
    })
})

describe('GET /admin', () => {
    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/admin')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('returns not found for logged-in users who are not admins', async () => {
        const response = await getAppPath(
            '/admin',
            createProfilePageDb({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).not.toContain('Admin | MyOC')
    })

    it('renders the admin shell for admin users', async () => {
        const response = await getAppPath(
            '/admin',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
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
        expect(html).toContain('href="/admin/admin-options"')
        expect(html).toContain('Admin Options')
        expect(html).toContain('aria-label="Image Approvals content"')
    })

    it('renders admin section routes with the matching section active', async () => {
        const response = await getAppPath(
            '/admin/moderate-users',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Moderate Users | Admin | MyOC</title>')
        expect(html).toContain('aria-current="page"')
        expect(html).toContain('aria-label="Moderate Users content"')
    })

    it('embeds image approval data for the image approvals page', async () => {
        const response = await getAppPath(
            '/admin/image-approvals',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                imageApprovalQueue: [
                    {
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
                    },
                ],
                imageApprovalItem: {
                    id: 'media-1',
                    user_id: 'owner-1',
                    username: 'uploader',
                    email: 'uploader@example.test',
                    character_id: 'character-1',
                    character_name: 'Quartz',
                    sfw_image_key: 'sfw-key',
                    nsfw_image_key: null,
                    sfw_preview_image_key: 'sfw-preview-key',
                    nsfw_preview_image_key: null,
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
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Image Approvals | Admin | MyOC</title>')
        expect(html).toContain('data-image-approvals')
        expect(html).toContain(
            '&quot;imageUrl&quot;:&quot;https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp&quot;',
        )
        expect(html).toContain(
            '&quot;fullImageUrl&quot;:&quot;https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/sfw-key.png&quot;',
        )
        expect(html).toContain('&quot;objectKey&quot;:&quot;characters/owner-1/character-1/media/media-1/sfw/sfw-key.png&quot;')
        expect(html).toContain('&quot;username&quot;:&quot;uploader&quot;')
        expect(html).toContain('&quot;pendingCount&quot;:1')
        expect(html).toContain('&quot;profileUrl&quot;:&quot;/u/uploader&quot;')
        expect(html).toContain('&quot;url&quot;:&quot;/u/uploader/Quartz&quot;')
        expect(html).toContain('admin-approval-image-grid')
        expect(html).toContain('formatPendingCount')
        expect(html).toContain('handleKeyboardShortcuts')
        expect(html).toContain("a: ['sfw', 'approve_sfw_homepage']")
        expect(html).toContain("openVariantInNewTab('nsfw')")
        expect(html).not.toContain('/admin-image-approvals.js')
    })

    it('renders reported images on the reports page', async () => {
        const response = await getAppPath(
            '/admin/reports',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                adminReports: [
                    {
                        id: 'media-1',
                        user_id: 'owner-1',
                        username: 'uploader',
                        character_id: 'character-1',
                        character_name: 'Quartz',
                        sfw_image_key: 'sfw-key',
                        nsfw_image_key: null,
                        sfw_preview_image_key: 'sfw-preview-key',
                        nsfw_preview_image_key: null,
                        sfw_review_status: 'reported',
                        nsfw_review_status: 'pending',
                        sfw_reviewed_at: '2026-06-10 12:00:00',
                        nsfw_reviewed_at: null,
                        sfw_reported_by_username: 'admin_user',
                        nsfw_reported_by_username: null,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
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
        expect(html).toContain('src="https://m.myoc.art/characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp"')
        expect(html).toContain('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })

    it('renders admin options with job controls and history', async () => {
        const response = await getAppPath(
            '/admin/admin-options?status=started&job=d1-backup',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                adminJobRuns: [
                    {
                        id: 'run-1',
                        job_name: 'd1-backup',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: '0 8 * * *',
                        status: 'success',
                        started_at: '2026-07-11 08:00:00',
                        finished_at: '2026-07-11 08:00:02',
                        duration_ms: 2200,
                        summary_json: JSON.stringify({
                            compressedBytes: 2048,
                            databaseName: 'myoc-db',
                            generatedAt: '2026-07-11T08:00:00.000Z',
                            key: 'd1/myoc-db/2026/07/11/myoc-db.sql.gz',
                            rows: 42,
                            schemaObjects: 5,
                            tables: 4,
                        }),
                        error_message: null,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Admin Options | Admin | MyOC</title>')
        expect(html).toContain('D1 Database Backup started. Refresh Job History to check progress.')
        expect(html).toContain('action="/api/admin/jobs/d1-backup/run"')
        expect(html).toContain('Run D1 Database Backup')
        expect(html).toContain('action="/api/admin/jobs/r2-media-cleanup/run"')
        expect(html).toContain('Run R2 Media Cleanup')
        expect(html).toContain('Job History')
        expect(html).toContain('Cron 0 8 * * *')
        expect(html).toContain('d1/myoc-db/2026/07/11/myoc-db.sql.gz')
        expect(html).toContain('42 rows')
        expect(html).toContain('2.0 KB')
    })

    it('returns not found for unknown admin sections', async () => {
        const response = await getAppPath(
            '/admin/unknown-section',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
    })
})

describe('GET /u/:username', () => {
    it('renders a public character page with safe gallery media by default', async () => {
        const response = await getProfilePath(
            '/u/demo/RAZETH',
            createProfilePageDb({
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
                },
                characterMedia: [
                    {
                        id: 'sfw-media',
                        sfw_image_key: 'sfw-only-key',
                        nsfw_image_key: null,
                        sfw_preview_image_key: 'sfw-only-preview-key',
                        nsfw_preview_image_key: null,
                        sfw_artist: 'SFW Artist',
                        nsfw_artist: '',
                        sfw_width: 640,
                        sfw_height: 480,
                        sfw_preview_width: 640,
                        sfw_preview_height: 480,
                        nsfw_width: null,
                        nsfw_height: null,
                        nsfw_preview_width: null,
                        nsfw_preview_height: null,
                    },
                    {
                        id: 'both-media',
                        sfw_image_key: 'both-sfw-key',
                        nsfw_image_key: 'both-nsfw-key',
                        sfw_preview_image_key: 'both-sfw-preview-key',
                        nsfw_preview_image_key: 'both-nsfw-preview-key',
                        nsfw_blur_image_key: 'both-nsfw-blur-key',
                        sfw_artist: 'Both SFW Artist',
                        nsfw_artist: 'Both NSFW Artist',
                        sfw_width: 800,
                        sfw_height: 600,
                        sfw_preview_width: 800,
                        sfw_preview_height: 600,
                        nsfw_width: 900,
                        nsfw_height: 600,
                        nsfw_preview_width: 900,
                        nsfw_preview_height: 600,
                    },
                    {
                        id: 'nsfw-media',
                        sfw_image_key: null,
                        nsfw_image_key: 'nsfw-only-key',
                        sfw_preview_image_key: null,
                        nsfw_preview_image_key: 'nsfw-only-preview-key',
                        nsfw_blur_image_key: 'nsfw-only-blur-key',
                        sfw_artist: '',
                        nsfw_artist: 'NSFW Artist',
                        sfw_width: null,
                        sfw_height: null,
                        sfw_preview_width: null,
                        sfw_preview_height: null,
                        nsfw_width: 1200,
                        nsfw_height: 800,
                        nsfw_preview_width: 1200,
                        nsfw_preview_height: 800,
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
                        force_full_width: 0,
                        media_id: 'sfw-media',
                        media_sort_order: 0,
                    },
                    {
                        row_id: 'row-2',
                        tab_id: 'tab-default',
                        row_sort_order: 1,
                        force_full_width: 0,
                        media_id: 'both-media',
                        media_sort_order: 0,
                    },
                    {
                        row_id: 'row-3',
                        tab_id: 'tab-default',
                        row_sort_order: 2,
                        force_full_width: 1,
                        media_id: 'nsfw-media',
                        media_sort_order: 0,
                    },
                ],
            }),
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('RAZETH | MyOC')
        expect(html).toContain('<meta content="Character page description." name="description"/>')
        expect(html).toContain('<link href="https://example.com/u/demo/RAZETH" rel="canonical"/>')
        expect(html).toContain('<meta content="RAZETH | MyOC" property="og:title"/>')
        expect(html).toContain('<meta content="Character page description." property="og:description"/>')
        expect(html).toContain(
            '<meta content="https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp" property="og:image"/>',
        )
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="RAZETH thumbnail" property="og:image:alt"/>')
        expect(html).toContain('<meta content="summary" name="twitter:card"/>')
        expect(html).toContain(
            '<meta content="https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp" name="twitter:image"/>',
        )
        expect(html).toContain('"@type":"CreativeWork"')
        expect(html).toContain('Character page description.')
        expect(html).toContain('https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp')
        expect(html).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/sfw-media/sfw/preview/sfw-only-preview-key.webp"',
        )
        expect(html).toContain(
            'data-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/sfw-media/sfw/sfw-only-key.png"',
        )
        expect(html).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/preview/both-sfw-preview-key.webp"',
        )
        expect(html).toContain(
            'data-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).toContain('loading="lazy"')
        expect(html).toContain('decoding="async"')
        expect(html).toContain('data-gallery-image-loader')
        expect(html).toContain('left: 0.5rem;')
        expect(html).toContain('top: 0.5rem;')
        expect(html).toContain('gallery-loader-spin')
        expect(html).toContain('gallery-image-loader-spinner')
        expect(html).not.toContain('data-gallery-image-loader-text')
        expect(html).not.toContain('Loading fullres...')
        expect(html).toContain('Load 18+ media')
        expect(html).toContain('data-display-nsfw-media="false"')
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-preview-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/preview/both-nsfw-preview-key.webp"',
        )
        expect(html).toContain('data-nsfw-title="Both NSFW Artist"')
        expect(html.match(/class="justified-row row-force-full-width"/g)).toHaveLength(3)
        expect(html).toContain(
            'data-safe-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).toContain('data-title="SFW Artist"')
        expect(html).toContain('data-title="Both SFW Artist"')
        expect(html).toContain(
            'loading="lazy" src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/blur/nsfw-only-blur-key.webp"',
        )
        expect(html).not.toContain(
            'data-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-preview-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/preview/nsfw-only-preview-key.webp"',
        )
        expect(html).toContain('class="nsfw-media-badge"')
        expect(html).toContain('<span>18+</span>')
        expect(html).toContain('data-nsfw-hidden="true"')
        expect(html).toContain('width="640"')
        expect(html).toContain('height="480"')
        expect(html).toContain('--media-width:640;--media-height:480')
        expect(html).toContain('value="default"')
        expect(html).not.toContain('value="tab-default"')
        expect(html).toContain('references')
    })

    it('redirects profile URLs to the stored username casing', async () => {
        const response = await getProfilePath(
            '/u/DEMO?tab=characters',
            createProfilePageDb({
                profileUser: {
                    id: 'profile-user',
                    username: 'demo',
                    profile_photo_key: null,
                    bio: '',
                },
            }),
        )

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo?tab=characters')
    })

    it('renders stored blur variants as the active source when the current user disabled NSFW media', async () => {
        const response = await getAppPath(
            '/u/demo/RAZETH',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('viewer'),
                    display_nsfw_media: 0,
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
                },
                characterMedia: [
                    {
                        id: 'nsfw-media',
                        sfw_image_key: null,
                        nsfw_image_key: 'nsfw-only-key',
                        sfw_preview_image_key: null,
                        nsfw_preview_image_key: 'nsfw-only-preview-key',
                        nsfw_blur_image_key: 'nsfw-only-blur-key',
                        sfw_artist: '',
                        nsfw_artist: 'NSFW Artist',
                        sfw_width: null,
                        sfw_height: null,
                        sfw_preview_width: null,
                        sfw_preview_height: null,
                        nsfw_width: 1200,
                        nsfw_height: 800,
                        nsfw_preview_width: 1200,
                        nsfw_preview_height: 800,
                    },
                ],
                galleryTabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        sort_order: 0,
                    },
                ],
                galleryRows: [
                    {
                        row_id: 'row-1',
                        tab_id: 'tab-default',
                        row_sort_order: 0,
                        media_id: 'nsfw-media',
                        media_sort_order: 0,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/blur/nsfw-only-blur-key.webp"',
        )
        expect(html).toContain('data-nsfw-hidden="true"')
        expect(html).toContain('Load 18+ media')
        expect(html).toContain('data-display-nsfw-media="false"')
        expect(html).toContain('class="nsfw-media-badge"')
        expect(html).toContain('<span>18+</span>')
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-preview-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/preview/nsfw-only-preview-key.webp"',
        )
        expect(html).not.toContain(
            'data-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
    })

    it('keeps NSFW-only gallery media visible with a local placeholder when no blur variant exists', async () => {
        const response = await getAppPath(
            '/u/demo/RAZETH',
            createProfilePageDb({
                currentUser: {
                    ...createCurrentUserRecord('viewer'),
                    display_nsfw_media: 0,
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
                },
                characterMedia: [
                    {
                        id: 'nsfw-media',
                        sfw_image_key: null,
                        nsfw_image_key: 'nsfw-only-key',
                        sfw_preview_image_key: null,
                        nsfw_preview_image_key: 'nsfw-only-preview-key',
                        nsfw_blur_image_key: null,
                        sfw_artist: '',
                        nsfw_artist: 'NSFW Artist',
                        sfw_width: null,
                        sfw_height: null,
                        sfw_preview_width: null,
                        sfw_preview_height: null,
                        nsfw_width: 1200,
                        nsfw_height: 800,
                        nsfw_preview_width: 600,
                        nsfw_preview_height: 400,
                    },
                ],
                galleryTabs: [
                    {
                        id: 'tab-default',
                        name: 'default',
                        sort_order: 0,
                    },
                ],
                galleryRows: [
                    {
                        row_id: 'row-1',
                        tab_id: 'tab-default',
                        row_sort_order: 0,
                        media_id: 'nsfw-media',
                        media_sort_order: 0,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('class="gallery-media image-loading  rounded nsfw-media"')
        expect(html).toContain('src="data:image/svg+xml,')
        expect(html).toContain('class="nsfw-media-badge"')
        expect(html).toContain('<span>18+</span>')
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).not.toContain('src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"')
        expect(html).not.toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/preview/nsfw-only-preview-key.webp"',
        )
        expect(html).not.toContain('No gallery media has been added')
    })

    it('redirects character URLs to the stored username and character name casing', async () => {
        const response = await getProfilePath(
            '/u/DEMO/razeth?view=gallery',
            createProfilePageDb({
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
                },
            }),
        )

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo/RAZETH?view=gallery')
    })

    it('renders NSFW gallery variants when the current user enabled NSFW media', async () => {
        const response = await getAppPath(
            '/u/demo/RAZETH',
            createProfilePageDb({
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
                        nsfw_blur_image_key: 'nsfw-only-blur-key',
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
                ],
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
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<meta content="Hosting over 987 images" name="description"/>')
        expect(html).toContain('<meta content="Hosting over 987 images" property="og:description"/>')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png')
        expect(html).toContain('data-title="Both NSFW Artist"')
        expect(html).toContain('data-title="NSFW Artist"')
        expect(html).toContain('Hide 18+ media')
        expect(html).toContain('data-display-nsfw-media="true"')
        expect(html).toContain(
            'data-safe-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).not.toContain('src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"')
        expect(html).toContain('https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png')
        expect(html).not.toContain('>Load 18+ media<')
        expect(html).not.toContain('data-nsfw-hidden="true"')
        expect(html).toContain('width="900"')
        expect(html).toContain('height="600"')
    })

    it('renders deferred alternate tab media from the NSFW variant when the current user enabled NSFW media', async () => {
        const response = await getAppPath(
            '/u/demo/RAZETH',
            createProfilePageDb({
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
                },
                characterMedia: [
                    {
                        id: 'sfw-media',
                        sfw_image_key: 'sfw-only-key',
                        nsfw_image_key: null,
                        sfw_preview_image_key: 'sfw-only-preview-key',
                        nsfw_preview_image_key: null,
                        sfw_artist: 'SFW Artist',
                        nsfw_artist: '',
                        sfw_width: 640,
                        sfw_height: 480,
                        sfw_preview_width: 640,
                        sfw_preview_height: 480,
                        nsfw_width: null,
                        nsfw_height: null,
                        nsfw_preview_width: null,
                        nsfw_preview_height: null,
                    },
                    {
                        id: 'both-media',
                        sfw_image_key: 'both-sfw-key',
                        nsfw_image_key: 'both-nsfw-key',
                        sfw_preview_image_key: 'both-sfw-preview-key',
                        nsfw_preview_image_key: 'both-nsfw-preview-key',
                        nsfw_blur_image_key: 'both-nsfw-blur-key',
                        sfw_artist: 'Both SFW Artist',
                        nsfw_artist: 'Both NSFW Artist',
                        sfw_width: 800,
                        sfw_height: 600,
                        sfw_preview_width: 800,
                        sfw_preview_height: 600,
                        nsfw_width: 900,
                        nsfw_height: 600,
                        nsfw_preview_width: 900,
                        nsfw_preview_height: 600,
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
                        row_id: 'row-2',
                        tab_id: 'tab-reference',
                        row_sort_order: 0,
                        media_id: 'both-media',
                        media_sort_order: 0,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('data-display-nsfw-media="true"')
        expect(html).toContain(
            'data-deferred-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/preview/both-nsfw-preview-key.webp"',
        )
        expect(html).toContain(
            'data-deferred-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png"',
        )
        expect(html).toContain(
            'data-safe-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).not.toContain(
            'data-deferred-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/preview/both-sfw-preview-key.webp"',
        )
        expect(html).not.toContain(
            'data-deferred-fullres-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
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
            placements: [
                {
                    folder_id: 'folder-1',
                    character_id: 'character-1',
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
        expect(html).toContain(
            '<meta content="https://m.myoc.art/users/profile-user/profile/profile-photo-key.webp" name="twitter:image"/>',
        )
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
            placements: [
                {
                    folder_id: 'folder-1',
                    character_id: 'character-1',
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
        const response = await getProfilePath(
            '/u/demo/Missing%20Folder',
            createProfilePageDb({
                profileUser: {
                    id: 'profile-user',
                    username: 'demo',
                    profile_photo_key: null,
                    bio: '',
                },
            }),
        )
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
