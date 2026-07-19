import {type Context, Hono} from 'hono'
import type {Child} from 'hono/jsx'
import {getImageApprovalData, getImageApprovalHistory, getImageApprovalPendingCount} from '../lib/admin/imageApprovals'
import {getAdminJobLabel, getAdminOptionsData, parseAdminJobName} from '../lib/admin/jobs'
import {getAdminReportsData} from '../lib/admin/reports'
import {listUserPasskeys, listUserSessions, toPasskeySummary} from '../lib/auth/passkeys'
import {type CurrentUser, canModerateImages, getCurrentUser, isAdminUser, toSqlTimestamp} from '../lib/auth/session'
import {chunkGalleryItems, shouldForceGalleryRowFullWidth} from '../lib/gallery'
import {getLeaderboardSnapshot} from '../lib/leaderboard'
import {normalizeProfileImagePayload, PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR} from '../lib/media/profileImage'
import {
    characterHeightChartImageUrl,
    characterMediaImageUrl,
    characterMediaPreviewImageUrl,
    characterProfileImageObjectKey,
} from '../lib/media/url'
import {APP_VERSION, RELEASE_NOTES} from '../lib/releases'
import {searchAll} from '../lib/search'
import type {UserSocialLink} from '../lib/socialLinks'
import type {Bindings} from '../types/bindings'
import {AdminImageApprovalLogPage} from '../views/pages/AdminImageApprovalLogPage'
import {AdminImageApprovalsPage} from '../views/pages/AdminImageApprovalsPage'
import {type AdminOptionsFeedback, AdminOptionsPage} from '../views/pages/AdminOptionsPage'
import {AdminPage, type AdminSection, isAdminSection} from '../views/pages/AdminPage'
import {AdminReportsPage} from '../views/pages/AdminReportsPage'
import {AuthPage} from '../views/pages/AuthPage'
import {
    type CharacterHeightChartEditorCharacter,
    type CharacterHeightChartEditorData,
    CharacterHeightChartEditorPage,
} from '../views/pages/CharacterHeightChartEditorPage'
import {
    type CharacterFolderPlacement,
    type CharacterManagementCharacter,
    type CharacterManagementFolder,
    CharacterManagementPage,
} from '../views/pages/CharacterManagementPage'
import {CharacterPage, type CharacterPageCharacter} from '../views/pages/CharacterPage'
import {
    type CharacterSettingsCharacter,
    type CharacterSettingsGalleryTab,
    type CharacterSettingsMedia,
    CharacterSettingsPage,
} from '../views/pages/CharacterSettingsPage'
import {
    HomePage,
    type HomePageDiscoverCharacter,
    type HomePageGalleryImage,
    type HomePageHeightChartCharacter,
    type HomePageStats,
    homePageDescription,
} from '../views/pages/HomePage'
import {LeaderboardPage} from '../views/pages/LeaderboardPage'
import {
    MigratePage,
    type ToyhouseClientImportPlan,
    type ToyhouseImportResult,
    type ToyhouseMigrationResult,
} from '../views/pages/MigratePage'
import {NotFoundPage} from '../views/pages/NotFoundPage'
import {PasskeyPromptPage} from '../views/pages/PasskeyPromptPage'
import {ProductVisionPage} from '../views/pages/ProductVisionPage'
import {ProfilePage, type ProfilePageUser} from '../views/pages/ProfilePage'
import {SearchPage} from '../views/pages/SearchPage'
import {SitePoliciesPage} from '../views/pages/SitePoliciesPage'
import {SizeChartViewerPage} from '../views/pages/SizeChartViewerPage'
import {UserSettingsPage} from '../views/pages/UserSettingsPage'
import {WhatsNewPage} from '../views/pages/WhatsNewPage'
import {adminPageActionRoutes} from './page-actions/admin'
import {authPageActionRoutes} from './page-actions/auth'
import {settingsPageActionRoutes} from './page-actions/settings'

export const pageRoutes = new Hono<{Bindings: Bindings}>()

type PageRouteContext = Context<{Bindings: Bindings}>

const CHARACTER_NAME_MAX_LENGTH = 80
const CHARACTER_NAME_ALLOWED_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 _'".()-]+$/
const CHARACTER_NAME_RULES = 'letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses'
const GALLERY_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

const HOME_PAGE_STATS_CACHE_KEY = 'home:stats:v1'
const HOME_PAGE_DISCOVER_CACHE_KEY = 'home:discover:v2'
const HOME_PAGE_GALLERY_CACHE_KEY = 'home:gallery:v1'
const HOME_PAGE_CACHE_TTL_SECONDS = 600
const HOME_PAGE_GALLERY_CACHE_TTL_SECONDS = 60 * 60 * 24
const PASSKEY_PROMPT_PATH = '/passkey-setup'
const HOME_PAGE_HEIGHT_CHART_TARGETS = [
    {
        name: 'ivo',
        image: {
            naturalHeight: 720,
            naturalWidth: 357,
            url: '/assets/home-height-ivo.webp',
        },
    },
    {
        name: 'luxor',
        image: {
            naturalHeight: 720,
            naturalWidth: 387,
            url: '/assets/home-height-luxor.webp',
        },
    },
] as const
const D1_SAFE_VARIABLES_PER_QUERY = 90

pageRoutes.use('*', async (c, next) => {
    if (c.req.method !== 'GET') {
        return await next()
    }

    const url = new URL(c.req.url)

    if (!shouldCheckPasskeyPrompt(url.pathname)) {
        return await next()
    }

    const currentUser = await getCurrentUser(c)

    if (!(await shouldRedirectToPasskeyPrompt(c.env.DB, currentUser))) {
        return await next()
    }

    return c.redirect(`${PASSKEY_PROMPT_PATH}?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`)
})

pageRoutes.route('/', authPageActionRoutes)
pageRoutes.route('/', settingsPageActionRoutes)
pageRoutes.route('/', adminPageActionRoutes)

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters.charAt(Math.floor(Math.random() * letters.length))
}

pageRoutes.get('/', async (c) => {
    const [currentUser, stats, discoverCharacters, galleryImages, heightChartCharacters] = await Promise.all([
        getCurrentUser(c),
        getCachedHomePageStats(c.env.CACHE, c.env.DB),
        getCachedHomePageDiscoverCharacters(c.env.CACHE, c.env.DB),
        getCachedHomePageGalleryImages(c.env.CACHE, c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL),
        getHomePageHeightChartCharacters(c.env.DB),
    ])

    return c.html(
        <HomePage
            currentUser={currentUser}
            discoverCharacters={discoverCharacters}
            galleryImages={galleryImages}
            guestInitial={getRandomLetter()}
            heightChartCharacters={heightChartCharacters}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            siteUrl={new URL(c.req.url).origin}
            stats={stats}
        />,
    )
})

pageRoutes.get('/login', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (currentUser) {
        return c.redirect(userProfileUrl(currentUser.username))
    }

    return c.html(
        <AuthPage currentUser={currentUser} guestInitial={getRandomLetter()} mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL} mode="login" />,
    )
})

pageRoutes.get('/register', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (currentUser) {
        return c.redirect(userProfileUrl(currentUser.username))
    }

    return c.html(
        <AuthPage currentUser={currentUser} guestInitial={getRandomLetter()} mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL} mode="register" />,
    )
})

pageRoutes.get(PASSKEY_PROMPT_PATH, async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const returnTo = safePromptReturnTo(c.req.query('returnTo'), currentUser.username)

    if (!(await shouldRedirectToPasskeyPrompt(c.env.DB, currentUser))) {
        return c.redirect(returnTo)
    }

    return c.html(<PasskeyPromptPage currentUser={currentUser} mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL} returnTo={returnTo} />)
})

pageRoutes.get('/settings', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const [socialLinks, passkeys, sessions] = await Promise.all([
        getUserSocialLinks(c.env.DB, currentUser.id),
        listUserPasskeys(c.env.DB, currentUser.id),
        listUserSessions(c.env.DB, currentUser),
    ])

    return c.html(
        <UserSettingsPage
            currentUser={currentUser}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            passkeys={passkeys.map(toPasskeySummary)}
            sessions={sessions}
            socialLinks={socialLinks}
        />,
    )
})

pageRoutes.get('/migrate', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    if (await hasActiveToyhouseImportJob(c.env.DB, currentUser.id)) {
        return c.redirect('/migrate/import/confirm')
    }

    const toyhouseUsername = getToyhouseUsernameQuery(c.req.query('toyhouseUsername') ?? c.req.query('toyhouseUrl') ?? '')

    return c.html(
        <MigratePage
            currentUser={currentUser}
            guestInitial={currentUser.username.charAt(0).toUpperCase()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            siteUrl={new URL(c.req.url).origin}
            toyhouseUsername={toyhouseUsername}
        />,
    )
})

pageRoutes.get('/migrate/toyhouse-image', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const imageUrl = parseToyhouseImageProxyUrl(c.req.query('url'))

    if (!imageUrl) {
        return c.json({error: 'Toyhou.se image URL is invalid'}, 400)
    }

    const upstream = await fetch(imageUrl, {
        redirect: 'follow',
    })

    if (!upstream.ok || !upstream.body) {
        return c.json({error: `Toyhou.se returned ${upstream.status} for image URL`}, 502)
    }

    // Toyhou.se import needs an authenticated same-origin image proxy for CORS.
    // nosemgrep: myoc.routes.no-image-body-proxy
    return new Response(upstream.body, {
        headers: {
            'cache-control': 'private, no-store',
            'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        },
    })
})

pageRoutes.get('/migrate/import', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    if (await hasActiveToyhouseImportJob(c.env.DB, currentUser.id)) {
        return c.redirect('/migrate/import/confirm')
    }

    return c.html(
        <MigratePage
            currentUser={currentUser}
            guestInitial={currentUser.username.charAt(0).toUpperCase()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            receiveToyhouseImport
            showSetupForm={false}
            siteUrl={new URL(c.req.url).origin}
        />,
    )
})

pageRoutes.get('/migrate/import/confirm', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const clientImportPlan = await getActiveToyhouseClientImportPlan(c.env.DB, currentUser.id)

    if (!clientImportPlan) {
        return c.redirect('/migrate')
    }

    return c.html(
        <MigratePage
            clientImportPlan={clientImportPlan}
            currentUser={currentUser}
            guestInitial={currentUser.username.charAt(0).toUpperCase()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            showSetupForm={false}
            siteUrl={new URL(c.req.url).origin}
        />,
    )
})

pageRoutes.post('/migrate/import', async (c) => {
    const currentUser = await getCurrentUser(c)
    let migrationResult: ToyhouseMigrationResult | null = null
    let migrationError = ''

    if (!currentUser) {
        migrationError = 'Sign in to MyOC, then run the Toyhou.se import bookmarklet again.'
    } else {
        try {
            const formData = await c.req.formData()
            const payload = formData.get('toyhousePayload')

            if (typeof payload !== 'string') {
                migrationError = 'Toyhou.se data was missing. Run the bookmarklet again from the Toyhou.se character page.'
            } else {
                migrationResult = parseToyhouseMigrationPayload(payload)

                if (migrationResult.myocUserId && migrationResult.myocUserId !== currentUser.id) {
                    migrationError =
                        'Toyhou.se import was verified for a different MyOC account. Sign in to that account or create a fresh bookmarklet.'
                    migrationResult = null
                } else {
                    migrationResult = await buildToyhouseMigrationReview(c.env.DB, migrationResult, currentUser.id)
                }
            }
        } catch (error) {
            migrationError = error instanceof Error ? error.message : 'Toyhou.se data could not be read.'
        }
    }

    return c.html(
        <MigratePage
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            migrationError={migrationError}
            migrationResult={migrationResult}
            showSetupForm={false}
            siteUrl={new URL(c.req.url).origin}
        />,
    )
})

pageRoutes.post('/migrate/import/confirm', async (c) => {
    const currentUser = await getCurrentUser(c)
    let clientImportPlan: ToyhouseClientImportPlan | null = null
    const importResult: ToyhouseImportResult | null = null
    let migrationError = ''

    if (!currentUser) {
        migrationError = 'Sign in to MyOC, then submit the Toyhou.se import again.'
    } else {
        try {
            const formData = await c.req.formData()
            const payload = formData.get('toyhousePayload')

            if (typeof payload !== 'string') {
                migrationError = 'Toyhou.se data was missing. Run the bookmarklet again from the Toyhou.se character page.'
            } else {
                const migrationResult = parseToyhouseMigrationPayload(payload)

                if (migrationResult.myocUserId && migrationResult.myocUserId !== currentUser.id) {
                    migrationError =
                        'Toyhou.se import was verified for a different MyOC account. Sign in to that account or create a fresh bookmarklet.'
                } else {
                    const reviewed = await buildToyhouseMigrationReview(c.env.DB, migrationResult, currentUser.id)
                    const selection = parseToyhouseImportSelection(formData, reviewed)
                    clientImportPlan = await prepareToyhouseClientImportPlan(
                        c.env.DB,
                        c.env.MEDIA_BUCKET,
                        c.env.IMAGES,
                        currentUser.id,
                        reviewed,
                        selection,
                    )
                }
            }
        } catch (error) {
            migrationError = error instanceof Error ? error.message : 'Toyhou.se import could not be completed.'
        }
    }

    return c.html(
        <MigratePage
            clientImportPlan={clientImportPlan}
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            importResult={importResult}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            migrationError={migrationError}
            showSetupForm={false}
            siteUrl={new URL(c.req.url).origin}
        />,
    )
})

pageRoutes.get('/characters', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const [folders, characters, placements, uploadedImageCount] = await Promise.all([
        getCharacterFolders(c.env.DB, currentUser.id),
        getCharacters(c.env.DB, currentUser.id),
        getCharacterFolderPlacements(c.env.DB, currentUser.id),
        getUploadedImageCount(c.env.DB, currentUser.id),
    ])

    return c.html(
        <CharacterManagementPage
            characters={characters}
            currentUser={currentUser}
            folders={folders}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            placements={placements}
            uploadedImageCount={uploadedImageCount}
        />,
    )
})

pageRoutes.get('/admin', async (c) => {
    return renderAdminPage(c, 'image-approvals')
})

pageRoutes.get('/admin/:adminSection', async (c) => {
    const adminSection = c.req.param('adminSection')

    if (!isAdminSection(adminSection)) {
        return renderNotFoundPage(c)
    }

    return renderAdminPage(c, adminSection)
})

async function renderAdminPage(c: PageRouteContext, activeSection: AdminSection): Promise<Response> {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    if (!canModerateImages(currentUser)) {
        return renderNotFoundPage(c)
    }

    if (!canAccessAdminSection(currentUser, activeSection)) {
        return renderNotFoundPage(c)
    }

    let imageApprovalPendingCount: number
    let content: Child

    if (activeSection === 'image-approvals') {
        const data = await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id)
        imageApprovalPendingCount = data.pendingCount
        content = <AdminImageApprovalsPage csrfToken={currentUser.csrfToken} data={data} />
    } else {
        imageApprovalPendingCount = await getImageApprovalPendingCount(c.env.DB)
        content =
            activeSection === 'image-approval-log' ? (
                <AdminImageApprovalLogPage history={await getImageApprovalHistory(c.env.DB, getImageApprovalLogPage(c))} />
            ) : activeSection === 'reports' ? (
                <AdminReportsPage
                    csrfToken={currentUser.csrfToken}
                    data={await getAdminReportsData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL)}
                />
            ) : activeSection === 'admin-options' ? (
                <AdminOptionsPage
                    csrfToken={currentUser.csrfToken}
                    data={await getAdminOptionsData(c.env.DB)}
                    feedback={getAdminOptionsFeedback(c)}
                />
            ) : null
    }

    return c.html(
        <AdminPage
            activeSection={activeSection}
            currentUser={currentUser}
            imageApprovalPendingCount={imageApprovalPendingCount}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        >
            {content}
        </AdminPage>,
    )
}

function getImageApprovalLogPage(c: PageRouteContext): number {
    const value = Number(c.req.query('page') ?? 1)

    return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : 1
}

function canAccessAdminSection(currentUser: CurrentUser, activeSection: AdminSection): boolean {
    return activeSection === 'image-approvals' || isAdminUser(currentUser)
}

function getAdminOptionsFeedback(c: PageRouteContext): AdminOptionsFeedback | null {
    const status = c.req.query('status')

    if (status !== 'success' && status !== 'error' && status !== 'started') {
        return null
    }

    const jobName = parseAdminJobName(c.req.query('job') ?? '')

    return {
        jobLabel: jobName ? getAdminJobLabel(jobName) : null,
        status,
    }
}

pageRoutes.get('/edit/:characterId/height-chart', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const character = await getCharacterHeightChartEditorCharacter(
        c.env.DB,
        currentUser.id,
        c.req.param('characterId'),
        c.env.MEDIA_PUBLIC_BASE_URL,
    )

    if (!character) {
        return renderNotFoundPage(c, 'That character does not exist or you do not have access to edit it.')
    }

    return c.html(
        <CharacterHeightChartEditorPage character={character} currentUser={currentUser} mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL} />,
    )
})

pageRoutes.get('/edit/:characterId', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const character = await getCharacterSettingsCharacter(c.env.DB, currentUser.id, c.req.param('characterId'))

    if (!character) {
        return renderNotFoundPage(c, 'That character does not exist or you do not have access to edit it.')
    }

    const [media, galleryTabs] = await Promise.all([
        getCharacterSettingsMedia(c.env.DB, currentUser.id, character.id),
        getCharacterGalleryTabs(c.env.DB, currentUser.id, character.id),
    ])

    return c.html(
        <CharacterSettingsPage
            character={character}
            currentUser={currentUser}
            galleryTabs={galleryTabs.length > 0 ? galleryTabs : createDefaultGalleryTabs(media)}
            media={media}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        />,
    )
})

pageRoutes.get('/search', async (c) => {
    const currentUser = await getCurrentUser(c)
    const results = await searchAll(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, c.req.query('q'))

    return c.html(
        <SearchPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            results={results}
        />,
    )
})

pageRoutes.get('/leaderboard', async (c) => {
    const [currentUser, snapshot] = await Promise.all([getCurrentUser(c), getLeaderboardSnapshot(c.env.CACHE)])

    return c.html(
        <LeaderboardPage
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            snapshot={snapshot}
        />,
    )
})

pageRoutes.get('/size-chart', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <SizeChartViewerPage
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        />,
    )
})

pageRoutes.get('/product-vision', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <ProductVisionPage
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        />,
    )
})

pageRoutes.get('/site-policies', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <SitePoliciesPage
            currentUser={currentUser}
            guestInitial={currentUser?.username.charAt(0).toUpperCase() ?? getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        />,
    )
})

pageRoutes.get('/whats-new', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (currentUser && currentUser.lastSeenVersion !== APP_VERSION) {
        await markCurrentVersionSeen(c.env.DB, currentUser.id)
        currentUser.lastSeenVersion = APP_VERSION
    }

    return c.html(
        <WhatsNewPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            releases={RELEASE_NOTES}
        />,
    )
})

async function markCurrentVersionSeen(db: D1Database, userId: string): Promise<void> {
    await db
        .prepare(
            `UPDATE users
         SET last_seen_version = ?
         WHERE id = ?`,
        )
        .bind(APP_VERSION, userId)
        .run()
}

function shouldCheckPasskeyPrompt(pathname: string): boolean {
    if (pathname === PASSKEY_PROMPT_PATH) {
        return false
    }

    if (pathname.startsWith('/assets/') || pathname.startsWith('/vendor/')) {
        return false
    }

    return !/\.[A-Za-z0-9]+$/.test(pathname)
}

async function shouldRedirectToPasskeyPrompt(db: D1Database, currentUser: Awaited<ReturnType<typeof getCurrentUser>>): Promise<boolean> {
    if (!currentUser || currentUser.passkeyPromptSeen || currentUser.secureAccountRequired) {
        return false
    }

    return (await listUserPasskeys(db, currentUser.id)).length === 0
}

function safePromptReturnTo(value: string | undefined, username: string): string {
    if (!value?.startsWith('/') || value.startsWith('//') || value === PASSKEY_PROMPT_PATH || value.startsWith('/api/')) {
        return userProfileUrl(username)
    }

    return value
}

pageRoutes.get('/u/:username/:profilePath{.+}', async (c) => {
    return renderProfilePage(c, c.req.param('username'), c.req.param('profilePath'))
})

pageRoutes.get('/u/:username', async (c) => {
    return renderProfilePage(c, c.req.param('username'))
})

pageRoutes.get('/profile/:username/:profilePath{.+}', (c) => {
    return c.redirect(profileRedirectUrl(c.req.param('username'), c.req.param('profilePath')), 301)
})

pageRoutes.get('/profile/:username', (c) => {
    return c.redirect(profileRedirectUrl(c.req.param('username')), 301)
})

pageRoutes.get('/users/:username', (c) => {
    return c.redirect(profileRedirectUrl(c.req.param('username')), 301)
})

pageRoutes.notFound(async (c) => {
    return renderNotFoundPage(c)
})

export async function renderNotFoundPage(c: PageRouteContext, message?: string): Promise<Response> {
    if (prefersJson(c) || new URL(c.req.url).pathname.startsWith('/api/')) {
        return c.json({error: 'Not found'}, 404)
    }

    const currentUser = await getCurrentUser(c)

    return c.html(
        <NotFoundPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            message={message}
        />,
        404,
    )
}

function prefersJson(c: PageRouteContext): boolean {
    const accept = c.req.header('accept') ?? ''
    return accept.includes('application/json') && !accept.includes('text/html')
}

function profileRedirectUrl(username: string, rawPath = ''): string {
    const suffix = rawPath
        .split('/')
        .filter(Boolean)
        .map((segment) => encodeURIComponent(decodePathSegment(segment)))
        .join('/')

    return suffix ? `${userProfileUrl(username)}/${suffix}` : userProfileUrl(username)
}

function getToyhouseUsernameQuery(value: string): string {
    const trimmed = value.trim()

    if (!trimmed) {
        return ''
    }

    try {
        const url = new URL(trimmed)

        if (url.protocol === 'https:' && ['toyhou.se', 'www.toyhou.se'].includes(url.hostname.toLowerCase())) {
            return decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '')
        }
    } catch {
        // Plain Toyhou.se usernames are expected.
    }

    return trimmed
}

function parseToyhouseMigrationPayload(payload: string): ToyhouseMigrationResult {
    if (payload.length > 5_000_000) {
        throw new Error('Toyhou.se returned too much data. Try importing a smaller profile or folder.')
    }

    const parsed = JSON.parse(payload) as unknown

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Toyhou.se data was not in the expected format.')
    }

    const data = parsed as Record<string, unknown>
    const myocUserId = sanitizeMyocUserId(data.myocUserId)
    const profileUrl = sanitizeToyhouseUrl(data.profileUrl)
    const folderUrl = sanitizeToyhouseUrl(data.folderUrl)

    if (!profileUrl || !folderUrl) {
        throw new Error('Toyhou.se data did not include a valid profile URL.')
    }

    const pagesFetched = Math.max(1, Math.min(1000, Number(data.pagesFetched) || 1))
    const rawCharacters = Array.isArray(data.characters) ? data.characters : []
    const characters = rawCharacters
        .slice(0, 5000)
        .map(parseToyhouseCharacterPayload)
        .filter((character): character is ToyhouseMigrationResult['characters'][number] => Boolean(character))

    return {
        profileUrl,
        folderUrl,
        pagesFetched,
        myocUserId,
        characters,
    }
}

async function buildToyhouseMigrationReview(
    db: D1Database,
    migrationResult: ToyhouseMigrationResult,
    myocUserId: string,
): Promise<ToyhouseMigrationResult> {
    const existingCharactersByName = myocUserId
        ? await getExistingCharactersByName(db, myocUserId)
        : new Map<string, ExistingCharacterName>()
    const importNameCounts = new Map<string, number>()

    for (const character of migrationResult.characters) {
        const nameKey = normalizeCharacterNameKey(character.name)
        importNameCounts.set(nameKey, (importNameCounts.get(nameKey) ?? 0) + 1)
    }

    return {
        ...migrationResult,
        myocUserId,
        characters: migrationResult.characters.map((character) => {
            const nameKey = normalizeCharacterNameKey(character.name)
            const existingCharacter = existingCharactersByName.get(nameKey) ?? null
            const importIssues = getToyhouseCharacterImportIssues(character.name, {
                canVerifyExistingCharacters: Boolean(myocUserId),
                existsInMyoc: Boolean(existingCharacter),
                nameKey,
                importNameCounts,
            })

            return {
                ...character,
                canImport: importIssues.length === 0,
                importMode: existingCharacter ? 'existing' : 'create',
                importIssues,
                targetCharacterId: existingCharacter?.id ?? null,
            }
        }),
    }
}

type ExistingCharacterName = {
    id: string
    name: string
}

async function getExistingCharactersByName(db: D1Database, userId: string): Promise<Map<string, ExistingCharacterName>> {
    const result = await db
        .prepare(
            `SELECT id, name
         FROM characters
         WHERE user_id = ?`,
        )
        .bind(userId)
        .all<ExistingCharacterName>()

    return new Map(
        (result.results ?? [])
            .filter((row) => typeof row.id === 'string' && typeof row.name === 'string')
            .map((row) => [normalizeCharacterNameKey(row.name), row]),
    )
}

function normalizeCharacterNameKey(name: string): string {
    return name.trim().toLocaleLowerCase()
}

function getToyhouseCharacterImportIssues(
    name: string,
    review: {
        canVerifyExistingCharacters: boolean
        existsInMyoc: boolean
        nameKey: string
        importNameCounts: Map<string, number>
    },
): string[] {
    const issues: string[] = []

    if (!review.canVerifyExistingCharacters) {
        issues.push('Could not verify your MyOC account. Create a fresh bookmarklet while signed in and run it again.')
    }

    if (name.length > CHARACTER_NAME_MAX_LENGTH) {
        issues.push('Character name must be 80 characters or fewer.')
    }

    if (!CHARACTER_NAME_ALLOWED_PATTERN.test(name)) {
        issues.push(`Character name may contain only ${CHARACTER_NAME_RULES}, and must include at least one letter or number.`)
    }

    if (!review.existsInMyoc && (review.importNameCounts.get(review.nameKey) ?? 0) > 1) {
        issues.push('Another Toyhou.se character in this import has the same name.')
    }

    return issues
}

type ToyhouseImportSelection = {
    characterIds: string[]
    imagesByCharacterId: Map<string, Set<string>>
    nsfwImagesByCharacterId: Map<string, Set<string>>
    profileImagesByCharacterId: Map<string, string>
}

type StagedToyhouseImport = {
    statements: D1PreparedStatement[]
    uploadedKeys: string[]
    createdCharacters: number
    updatedCharacterIds: Set<string>
    importedImages: number
}

type StagedToyhouseCharacter = {
    id: string
    isNew: boolean
}

type ToyhouseImportItemRecord = {
    id: string
    status: 'pending' | 'uploading' | 'imported' | 'failed'
    media_id: string | null
}

type ToyhouseImportJobRecord = {
    id: string
    total_images: number
}

type ToyhouseActiveImportItemRecord = ToyhouseImportItemRecord & {
    character_id: string
    import_mode: 'create' | 'existing'
    name: string
    rating: 'sfw' | 'nsfw'
    toyhouse_character_id: string
    toyhouse_image_url: string
}

function parseToyhouseImportSelection(formData: FormData, migrationResult: ToyhouseMigrationResult): ToyhouseImportSelection {
    const charactersById = new Map(migrationResult.characters.map((character) => [character.id, character]))
    const characterIds = formData
        .getAll('characterIds')
        .filter((value): value is string => typeof value === 'string')
        .filter((characterId, index, values) => values.indexOf(characterId) === index)

    if (characterIds.length === 0) {
        throw new Error('Select at least one character to import.')
    }

    const imagesByCharacterId = new Map<string, Set<string>>()
    const nsfwImagesByCharacterId = new Map<string, Set<string>>()
    const profileImagesByCharacterId = new Map<string, string>()

    for (const characterId of characterIds) {
        const character = charactersById.get(characterId)

        if (!character || character.canImport === false) {
            throw new Error('Selected Toyhou.se character is no longer importable. Review the import again.')
        }

        const allowedImageUrls = new Set(character.images.map((image) => image.fullsizeUrl))
        const selectedImages = new Set(
            formData
                .getAll(`imageUrls:${characterId}`)
                .filter((value): value is string => typeof value === 'string' && allowedImageUrls.has(value)),
        )
        const selectedNsfwImages = new Set(
            formData
                .getAll(`nsfwImageUrls:${characterId}`)
                .filter((value): value is string => typeof value === 'string' && selectedImages.has(value)),
        )

        imagesByCharacterId.set(characterId, selectedImages)
        nsfwImagesByCharacterId.set(characterId, selectedNsfwImages)

        if (character.importMode !== 'existing') {
            const profileImageDataUrl = formData.get(`profileImageDataUrl:${characterId}`)
            if (typeof profileImageDataUrl !== 'string' || !profileImageDataUrl) {
                throw new Error(`Profile image for ${character.name} was not prepared. Review the import and try again.`)
            }
            profileImagesByCharacterId.set(characterId, profileImageDataUrl)
        }
    }

    return {
        characterIds,
        imagesByCharacterId,
        nsfwImagesByCharacterId,
        profileImagesByCharacterId,
    }
}

async function prepareToyhouseClientImportPlan(
    db: D1Database,
    bucket: R2Bucket,
    images: ImagesBinding | undefined,
    userId: string,
    migrationResult: ToyhouseMigrationResult,
    selection: ToyhouseImportSelection,
): Promise<ToyhouseClientImportPlan> {
    const staged: StagedToyhouseImport = {
        createdCharacters: 0,
        importedImages: 0,
        statements: [],
        updatedCharacterIds: new Set(),
        uploadedKeys: [],
    }
    const charactersById = new Map(migrationResult.characters.map((character) => [character.id, character]))
    const planCharacters: (Omit<ToyhouseClientImportPlan['characters'][number], 'images'> & {
        images: (ToyhouseClientImportPlan['characters'][number]['images'][number] & {
            status: 'pending'
            mediaId: null
        })[]
    })[] = []
    const itemIds: string[] = []
    const importJobId = crypto.randomUUID()
    const now = toSqlTimestamp(new Date())
    let clientImportPlan: ToyhouseClientImportPlan | null = null
    let databaseBatchCommitted = false
    let stagingError: Error | null = null
    let unexpectedError: unknown = null

    try {
        staged.statements.push(
            db
                .prepare(
                    `INSERT INTO toyhouse_import_jobs (id, user_id, status, total_images, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
                )
                .bind(importJobId, userId, 'running', 0, now, now),
        )

        for (const characterId of selection.characterIds) {
            const character = charactersById.get(characterId)
            if (!character || character.canImport === false) {
                continue
            }

            const selectedImages = [...(selection.imagesByCharacterId.get(characterId) ?? new Set<string>())]
            if (selectedImages.length === 0) {
                continue
            }

            const nsfwImages = selection.nsfwImagesByCharacterId.get(characterId) ?? new Set<string>()
            const targetCharacter =
                character.importMode === 'existing'
                    ? {id: character.targetCharacterId ?? '', isNew: false}
                    : await stageToyhouseImportedCharacter(
                          db,
                          bucket,
                          images,
                          userId,
                          character,
                          selection.profileImagesByCharacterId.get(characterId) ?? '',
                          staged,
                      )

            if (!targetCharacter.id) {
                stagingError = new Error(`Could not resolve import target for ${character.name}.`)
                break
            }

            if (!targetCharacter.isNew) {
                staged.updatedCharacterIds.add(targetCharacter.id)
            }

            planCharacters.push({
                importMode: targetCharacter.isNew ? 'create' : 'existing',
                images: await Promise.all(
                    selectedImages.map(async (fullsizeUrl, imageIndex) => {
                        const importItemId = await toyhouseImportItemId(userId, targetCharacter.id, fullsizeUrl)
                        const rating = nsfwImages.has(fullsizeUrl) ? 'nsfw' : 'sfw'

                        itemIds.push(importItemId)
                        staged.statements.push(
                            db
                                .prepare(
                                    `INSERT OR IGNORE INTO toyhouse_import_items (id, job_id, user_id, character_id,
                                                                      toyhouse_character_id, toyhouse_image_url,
                                                                      import_mode, rating, status, media_id, error,
                                                                      sort_order, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                )
                                .bind(
                                    importItemId,
                                    importJobId,
                                    userId,
                                    targetCharacter.id,
                                    character.id,
                                    fullsizeUrl,
                                    targetCharacter.isNew ? 'create' : 'existing',
                                    rating,
                                    'pending',
                                    null,
                                    '',
                                    imageIndex,
                                    now,
                                    now,
                                ),
                        )

                        return {
                            fullsizeUrl,
                            importItemId,
                            mediaId: null,
                            rating,
                            status: 'pending',
                        }
                    }),
                ),
                myocCharacterId: targetCharacter.id,
                name: character.name,
                toyhouseId: character.id,
            })
        }

        if (!stagingError) {
            const totalImages = planCharacters.reduce((total, character) => total + character.images.length, 0)
            if (totalImages === 0) {
                stagingError = new Error('Select at least one image to import.')
            } else {
                staged.statements.push(
                    db
                        .prepare(
                            `UPDATE toyhouse_import_jobs
                     SET total_images = ?,
                         updated_at   = ?
                     WHERE id = ?
                       AND user_id = ?`,
                        )
                        .bind(totalImages, now, importJobId, userId),
                )

                if (staged.statements.length > 0) {
                    await db.batch(staged.statements)
                    databaseBatchCommitted = true
                }

                const itemStates = await getToyhouseImportItemsByIds(db, userId, itemIds)

                clientImportPlan = {
                    characters: planCharacters.map((character) => ({
                        ...character,
                        images: character.images.map((image) => {
                            const itemState = itemStates.get(image.importItemId)

                            return itemState
                                ? {
                                      ...image,
                                      mediaId: itemState.media_id,
                                      status: itemState.status,
                                  }
                                : image
                        }),
                    })),
                    createdCharacters: staged.createdCharacters,
                    importJobId,
                    totalImages,
                    updatedCharacters: staged.updatedCharacterIds.size,
                }
            }
        }
    } catch (error) {
        unexpectedError = error
    }

    if (unexpectedError || stagingError) {
        if (!databaseBatchCommitted) {
            await deleteR2Objects(bucket, staged.uploadedKeys)
        }

        if (unexpectedError) {
            throw unexpectedError
        }

        throw stagingError
    }

    if (!clientImportPlan) {
        throw new Error('Toyhou.se import plan was not created.')
    }

    return clientImportPlan
}

async function hasActiveToyhouseImportJob(db: D1Database, userId: string): Promise<boolean> {
    const job = await getActiveToyhouseImportJob(db, userId)

    return job !== null
}

async function getActiveToyhouseClientImportPlan(db: D1Database, userId: string): Promise<ToyhouseClientImportPlan | null> {
    const job = await getActiveToyhouseImportJob(db, userId)

    if (!job) {
        return null
    }

    const result = await db
        .prepare(
            `SELECT item.id,
                item.character_id,
                item.toyhouse_character_id,
                item.toyhouse_image_url,
                item.import_mode,
                item.rating,
                item.status,
                item.media_id,
                character.name
         FROM toyhouse_import_items item
                  INNER JOIN characters character
                             ON character.id = item.character_id
                                 AND character.user_id = item.user_id
         WHERE item.job_id = ?
           AND item.user_id = ?
         ORDER BY character.name COLLATE NOCASE, item.sort_order, item.created_at`,
        )
        .bind(job.id, userId)
        .all<ToyhouseActiveImportItemRecord>()
    const items = result.results ?? []

    if (items.length === 0) {
        return null
    }

    const characters = new Map<string, ToyhouseClientImportPlan['characters'][number]>()

    for (const item of items) {
        const importMode = item.import_mode === 'create' ? 'create' : 'existing'
        const existing = characters.get(item.character_id)

        if (existing) {
            existing.images.push({
                fullsizeUrl: item.toyhouse_image_url,
                importItemId: item.id,
                mediaId: item.media_id,
                rating: item.rating,
                status: item.status,
            })
            continue
        }

        characters.set(item.character_id, {
            importMode,
            images: [
                {
                    fullsizeUrl: item.toyhouse_image_url,
                    importItemId: item.id,
                    mediaId: item.media_id,
                    rating: item.rating,
                    status: item.status,
                },
            ],
            myocCharacterId: item.character_id,
            name: item.name,
            toyhouseId: item.toyhouse_character_id,
        })
    }

    const characterPlans = [...characters.values()]

    return {
        characters: characterPlans,
        createdCharacters: characterPlans.filter((character) => character.importMode === 'create').length,
        importJobId: job.id,
        totalImages: items.length,
        updatedCharacters: characterPlans.filter((character) => character.importMode === 'existing').length,
    }
}

async function getActiveToyhouseImportJob(db: D1Database, userId: string): Promise<ToyhouseImportJobRecord | null> {
    return await db
        .prepare(
            `SELECT import_job.id, import_job.total_images
         FROM toyhouse_import_jobs import_job
         WHERE import_job.user_id = ?
           AND import_job.status <> 'complete'
           AND EXISTS (SELECT 1
                       FROM toyhouse_import_items item
                       WHERE item.job_id = import_job.id
                         AND item.user_id = import_job.user_id)
         ORDER BY import_job.updated_at DESC
         LIMIT 1`,
        )
        .bind(userId)
        .first<ToyhouseImportJobRecord>()
}

async function toyhouseImportItemId(userId: string, characterId: string, imageUrl: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${userId}\n${characterId}\n${imageUrl}`)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

    return `toyhouse-${hex.slice(0, 48)}`
}

async function getToyhouseImportItemsByIds(
    db: D1Database,
    userId: string,
    itemIds: string[],
): Promise<Map<string, ToyhouseImportItemRecord>> {
    if (itemIds.length === 0) {
        return new Map()
    }

    const itemsById = new Map<string, ToyhouseImportItemRecord>()
    const itemIdsPerQuery = D1_SAFE_VARIABLES_PER_QUERY - 1

    for (let index = 0; index < itemIds.length; index += itemIdsPerQuery) {
        const itemIdChunk = itemIds.slice(index, index + itemIdsPerQuery)
        const placeholders = itemIdChunk.map(() => '?').join(', ')
        const result = await db
            .prepare(
                `SELECT id, status, media_id
             FROM toyhouse_import_items
             WHERE user_id = ?
               AND id IN (${placeholders})`,
            )
            .bind(userId, ...itemIdChunk)
            .all<ToyhouseImportItemRecord>()

        for (const item of result.results ?? []) {
            itemsById.set(item.id, item)
        }
    }

    return itemsById
}

async function stageToyhouseImportedCharacter(
    db: D1Database,
    bucket: R2Bucket,
    images: ImagesBinding | undefined,
    userId: string,
    character: ToyhouseMigrationResult['characters'][number],
    profileImageDataUrl: string,
    staged: StagedToyhouseImport,
): Promise<StagedToyhouseCharacter> {
    const profileImage = readProfileImageDataUrl(profileImageDataUrl)
    if ('error' in profileImage) {
        throw new Error(profileImage.error)
    }

    const normalizedProfileImage = await normalizeProfileImagePayload(profileImage, `${character.name} profile image`, images)
    if ('error' in normalizedProfileImage) {
        throw new Error(normalizedProfileImage.error)
    }

    const now = toSqlTimestamp(new Date())
    const characterId = crypto.randomUUID()
    const profileImageKey = crypto.randomUUID()
    const profileObjectKey = characterProfileImageObjectKey(userId, characterId, profileImageKey)

    await bucket.put(profileObjectKey, normalizedProfileImage.bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: normalizedProfileImage.contentType,
        },
    })
    staged.uploadedKeys.push(profileObjectKey)

    staged.statements.push(
        db
            .prepare(
                `INSERT INTO characters (id, size_chart_id, user_id, name, profile_image_key, folder_id, sort_order, created_at,
                                 updated_at)
         VALUES (?, randomblob(6), ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(characterId, userId, character.name, profileImageKey, null, 0, now, now),
    )
    staged.createdCharacters += 1

    return {id: characterId, isNew: true}
}

function readProfileImageDataUrl(value: string): {contentType: string; bytes: Uint8Array} | {error: string} {
    const match = /^data:(image\/(?:webp|png|jpeg));base64,(.+)$/i.exec(value)

    if (!match) {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR}
    }

    const [, contentType, encodedBytes] = match

    if (!contentType || !encodedBytes) {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR}
    }

    try {
        const binary = atob(encodedBytes)
        const bytes = new Uint8Array(binary.length)

        for (let index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index)
        }

        return {
            bytes,
            contentType: contentType.toLowerCase(),
        }
    } catch {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR}
    }
}

async function deleteR2Objects(bucket: R2Bucket, objectKeys: string[]): Promise<void> {
    for (const objectKey of objectKeys) {
        try {
            await bucket.delete(objectKey)
        } catch (error) {
            console.warn('Unable to delete imported media object', error)
        }
    }
}

function parseToyhouseCharacterPayload(value: unknown): ToyhouseMigrationResult['characters'][number] | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    const character = value as Record<string, unknown>
    const id = typeof character.id === 'string' && /^\d+$/.test(character.id) ? character.id : ''
    const name = typeof character.name === 'string' ? character.name.trim().slice(0, 120) : ''
    const url = sanitizeToyhouseUrl(character.url)
    const thumbnailUrl = sanitizeHttpsUrl(character.thumbnailUrl)
    const images = Array.isArray(character.images)
        ? character.images
              .slice(0, 1000)
              .map(parseToyhouseImagePayload)
              .filter((image): image is ToyhouseMigrationResult['characters'][number]['images'][number] => Boolean(image))
        : []
    const imageCountValue = Number(character.imageCount)
    const imageCount = Number.isFinite(imageCountValue) && imageCountValue >= 0 ? Math.floor(imageCountValue) : null

    if (!id || !name || !url) {
        return null
    }

    return {
        id,
        images,
        imageCount,
        name,
        thumbnailUrl,
        url,
    }
}

function parseToyhouseImagePayload(value: unknown): ToyhouseMigrationResult['characters'][number]['images'][number] | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    const image = value as Record<string, unknown>
    const fullsizeUrl = sanitizeHttpsUrl(image.fullsizeUrl)
    const thumbnailUrl = sanitizeHttpsUrl(image.thumbnailUrl)

    if (!fullsizeUrl || !thumbnailUrl) {
        return null
    }

    return {
        fullsizeUrl,
        thumbnailUrl,
    }
}

function sanitizeMyocUserId(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }

    const userId = value.trim()

    return userId.length > 0 && userId.length <= 128 && /^[A-Za-z0-9_-]+$/.test(userId) ? userId : ''
}

function sanitizeToyhouseUrl(value: unknown): string {
    if (typeof value !== 'string') {
        return ''
    }

    try {
        const url = new URL(value)
        const host = url.hostname.toLowerCase()

        return url.protocol === 'https:' && (host === 'toyhou.se' || host === 'www.toyhou.se') ? url.toString() : ''
    } catch {
        return ''
    }
}

function sanitizeHttpsUrl(value: unknown): string | null {
    if (typeof value !== 'string' || !value) {
        return null
    }

    try {
        const url = new URL(value)

        return url.protocol === 'https:' ? url.toString() : null
    } catch {
        return null
    }
}

function parseToyhouseImageProxyUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048) {
        return null
    }

    try {
        const url = new URL(value)
        const host = url.hostname.toLowerCase()

        if (url.protocol !== 'https:') {
            return null
        }

        if (host !== 'toyhou.se' && !host.endsWith('.toyhou.se')) {
            return null
        }

        return url.toString()
    } catch {
        return null
    }
}

async function getHomePageStats(db: D1Database): Promise<HomePageStats> {
    const [users, characters, mediaItems] = await Promise.all([
        getTableCount(db, 'users'),
        getTableCount(db, 'characters'),
        getTableCount(db, 'character_media'),
    ])

    return {users, characters, mediaItems}
}

async function getCachedHomePageStats(cache: KVNamespace | undefined, db: D1Database): Promise<HomePageStats> {
    const cached = await getCachedJson<HomePageStats>(cache, HOME_PAGE_STATS_CACHE_KEY)

    if (isHomePageStats(cached)) {
        return cached
    }

    const stats = await getHomePageStats(db)
    await putCachedJson(cache, HOME_PAGE_STATS_CACHE_KEY, stats)

    return stats
}

async function getCachedHomePageDiscoverCharacters(cache: KVNamespace | undefined, db: D1Database): Promise<HomePageDiscoverCharacter[]> {
    const cached = await getCachedJson<HomePageDiscoverCharacter[]>(cache, HOME_PAGE_DISCOVER_CACHE_KEY)

    if (Array.isArray(cached) && cached.every(isHomePageDiscoverCharacter)) {
        return cached
    }

    const characters = await getDiscoverCharacters(db)
    await putCachedJson(cache, HOME_PAGE_DISCOVER_CACHE_KEY, characters)

    return characters
}

async function getCachedHomePageGalleryImages(
    cache: KVNamespace | undefined,
    db: D1Database,
    mediaBaseUrl: string,
): Promise<HomePageGalleryImage[]> {
    const cached = await getCachedJson<HomePageGalleryImage[]>(cache, HOME_PAGE_GALLERY_CACHE_KEY)

    if (Array.isArray(cached) && cached.every(isHomePageGalleryImage)) {
        return cached
    }

    const images = await getHomePageGalleryImages(db, mediaBaseUrl)
    await putCachedJson(cache, HOME_PAGE_GALLERY_CACHE_KEY, images, HOME_PAGE_GALLERY_CACHE_TTL_SECONDS)

    return images
}

async function getDiscoverCharacters(db: D1Database): Promise<HomePageDiscoverCharacter[]> {
    const result = await db
        .prepare(
            `WITH approved_sfw_media AS (SELECT id,
                                            character_id,
                                            sfw_image_key,
                                            sfw_preview_image_key,
                                            sfw_content_type,
                                            sfw_artist,
                                            sfw_homepage_allowed
                                     FROM character_media
                                     WHERE sfw_image_key IS NOT NULL
                                       AND sfw_review_status = 'approved'
                                       AND sfw_approved_at IS NOT NULL
                                       AND sfw_approved_at >= updated_at),
              character_image_counts AS (SELECT character_id,
                                                SUM(
                                                        CASE WHEN sfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                                                            + CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                                                ) AS image_count
                                         FROM character_media
                                         WHERE sfw_image_key IS NOT NULL
                                            OR nsfw_image_key IS NOT NULL
                                         GROUP BY character_id),
              eligible_characters AS (SELECT characters.id,
                                             characters.user_id,
                                             characters.name,
                                             characters.profile_image_key,
                                             users.username AS owner_username,
                                             character_image_counts.image_count
                                      FROM characters
                                               INNER JOIN users ON users.id = characters.user_id
                                               INNER JOIN character_image_counts
                                                          ON character_image_counts.character_id = characters.id
                                               INNER JOIN approved_sfw_media
                                                          ON approved_sfw_media.character_id = characters.id
                                      GROUP BY characters.id,
                                               characters.user_id,
                                               characters.name,
                                               characters.profile_image_key,
                                               users.username,
                                               character_image_counts.image_count
                                      HAVING COUNT(approved_sfw_media.id) >= 5
                                         AND
                                          SUM(CASE WHEN approved_sfw_media.sfw_homepage_allowed = 1 THEN 1 ELSE 0 END) >=
                                          1
                                      ORDER BY RANDOM()
                                      LIMIT 6)
         SELECT eligible_characters.id,
                eligible_characters.user_id,
                eligible_characters.name,
                eligible_characters.profile_image_key,
                eligible_characters.owner_username,
                eligible_characters.image_count,
                preview_media.id                    AS preview_media_id,
                preview_media.sfw_image_key         AS preview_image_key,
                preview_media.sfw_preview_image_key AS preview_thumbnail_image_key,
                preview_media.sfw_content_type      AS preview_content_type,
                preview_media.sfw_artist            AS preview_artist
         FROM eligible_characters
                  INNER JOIN approved_sfw_media AS preview_media
                             ON preview_media.id = (SELECT id
                                                    FROM approved_sfw_media
                                                    WHERE character_id = eligible_characters.id
                                                      AND sfw_homepage_allowed = 1
                                                    ORDER BY RANDOM()
                                                    LIMIT 1)`,
        )
        .all<{
            id: string
            user_id: string
            name: string
            profile_image_key: string
            owner_username: string
            image_count: number | string
            preview_media_id: string
            preview_image_key: string
            preview_thumbnail_image_key: string | null
            preview_content_type: string | null
            preview_artist: string | null
        }>()

    return (result.results ?? []).map((character) => ({
        id: character.id,
        userId: character.user_id,
        name: character.name,
        ownerUsername: character.owner_username,
        profileImageKey: character.profile_image_key,
        previewMediaId: character.preview_media_id,
        previewImageKey: character.preview_image_key,
        previewThumbnailImageKey: character.preview_thumbnail_image_key ?? null,
        previewContentType: character.preview_content_type ?? 'image/png',
        previewArtist: character.preview_artist ?? '',
        imageCount: Number(character.image_count) || 0,
    }))
}

async function getHomePageGalleryImages(db: D1Database, mediaBaseUrl: string): Promise<HomePageGalleryImage[]> {
    const result = await db
        .prepare(
            `SELECT character_media.id,
                character_media.user_id,
                character_media.character_id,
                character_media.sfw_image_key,
                character_media.sfw_preview_image_key,
                character_media.sfw_content_type,
                character_media.sfw_width,
                character_media.sfw_height,
                character_media.sfw_preview_width,
                character_media.sfw_preview_height,
                character_media.sfw_artist,
                characters.name AS character_name,
                users.username  AS owner_username
         FROM character_media
                  INNER JOIN characters ON characters.id = character_media.character_id
                  INNER JOIN users ON users.id = characters.user_id
         WHERE character_media.sfw_review_status = 'approved'
           AND character_media.sfw_homepage_allowed = 1
           AND character_media.sfw_preview_image_key IS NOT NULL
         ORDER BY RANDOM()
         LIMIT 90`,
        )
        .all<{
            id: string
            user_id: string
            character_id: string
            sfw_image_key: string | null
            sfw_preview_image_key: string | null
            sfw_content_type: string | null
            sfw_width: number | null
            sfw_height: number | null
            sfw_preview_width: number | null
            sfw_preview_height: number | null
            sfw_artist: string | null
            character_name: string | null
            owner_username: string | null
        }>()

    const images = (result.results ?? [])
        .filter(
            (
                image,
            ): image is typeof image & {
                sfw_preview_image_key: string
            } => Boolean(image.sfw_preview_image_key),
        )
        .map((image) => {
            const artist = image.sfw_artist?.trim() || 'an unknown artist'
            const characterName = image.character_name?.trim() || 'character'
            const ownerUsername = image.owner_username?.trim() || 'unknown'
            const width = image.sfw_preview_width ?? image.sfw_width ?? 512
            const height = image.sfw_preview_height ?? image.sfw_height ?? 512

            return {
                id: image.id,
                alt: `${characterName} gallery art by ${artist}`,
                fallbackSrc: image.sfw_image_key
                    ? characterMediaImageUrl(
                          mediaBaseUrl,
                          image.user_id,
                          image.character_id,
                          image.id,
                          image.sfw_image_key,
                          'sfw',
                          image.sfw_content_type,
                      )
                    : null,
                height,
                href: characterProfileUrl(ownerUsername, characterName),
                src: characterMediaPreviewImageUrl(
                    mediaBaseUrl,
                    image.user_id,
                    image.character_id,
                    image.id,
                    image.sfw_preview_image_key,
                    'sfw',
                ),
                width,
            }
        })

    return shuffleHomePageGalleryImages(selectHomePageGalleryImageMix(images))
}

type HomePageHeightChartRow = {
    id: string
    name: string
    user_id: string
    username: string
    height_chart_json: string
}

type HomePageHeightChartJson = {
    version: 1
    height: {
        meters: number
    }
    image: {
        key: string
        contentType: string
        naturalWidth: number
        naturalHeight: number
    } | null
    calibration: {
        headYPercent: number
        footYPercent: number
        footIsVirtual: boolean
        nameTagXPercent: number
    }
}

async function getHomePageHeightChartCharacters(db: D1Database): Promise<HomePageHeightChartCharacter[]> {
    const result = await db
        .prepare(
            `SELECT characters.id,
                characters.name,
                characters.user_id,
                characters.height_chart_json,
                users.username
         FROM characters
                  INNER JOIN users ON users.id = characters.user_id
         WHERE lower(users.username) = ?
           AND characters.height_chart_json <> ''
           AND (
             lower(characters.name) LIKE ? ESCAPE '\\'
                 OR lower(characters.name) LIKE ? ESCAPE '\\'
             )
         ORDER BY lower(characters.name)
         LIMIT 12`,
        )
        .bind('razeth', '%ivo%', '%luxor%')
        .all<HomePageHeightChartRow>()

    const rows = result.results ?? []
    const selected: HomePageHeightChartCharacter[] = []
    const selectedIds = new Set<string>()

    for (const target of HOME_PAGE_HEIGHT_CHART_TARGETS) {
        const candidate = rows
            .map((row) => ({
                row,
                score: targetNameScore(row.name, target.name),
                chart: parseHomePageHeightChartJson(row.height_chart_json),
            }))
            .filter(
                (
                    item,
                ): item is typeof item & {
                    chart: HomePageHeightChartJson & {image: NonNullable<HomePageHeightChartJson['image']>}
                    score: number
                } => item.score !== null && Boolean(item.chart?.image) && !selectedIds.has(item.row.id),
            )
            .sort((a, b) => a.score - b.score || a.row.name.localeCompare(b.row.name))
            .at(0)

        if (!candidate) {
            continue
        }

        selectedIds.add(candidate.row.id)
        selected.push({
            id: candidate.row.id,
            name: candidate.row.name,
            ownerUsername: candidate.row.username,
            heightMeters: candidate.chart.height.meters,
            image: target.image,
            calibration: candidate.chart.calibration,
        })
    }

    return selected
}

function targetNameScore(characterName: string, targetName: string): number | null {
    const normalizedName = characterName.trim().toLowerCase()
    const tokens = normalizedName.split(/[^a-z0-9]+/).filter(Boolean)

    if (normalizedName === targetName) {
        return 0
    }

    if (tokens.includes(targetName)) {
        return 1
    }

    return normalizedName.includes(targetName) ? 2 : null
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
    if (!value) {
        return null
    }

    try {
        const parsed = JSON.parse(value) as unknown

        if (!parsed || typeof parsed !== 'object') {
            return null
        }

        return parsed as Record<string, unknown>
    } catch {
        return null
    }
}

function recordValue(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const value = source[key]

    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function parseHeightChartParts(value: string | null | undefined): {
    calibration: Record<string, unknown> | null
    height: Record<string, unknown> | null
    image: Record<string, unknown> | null
} | null {
    const chart = parseJsonRecord(value)

    if (!chart) {
        return null
    }

    return {
        calibration: recordValue(chart, 'calibration'),
        height: recordValue(chart, 'height'),
        image: recordValue(chart, 'image'),
    }
}

function parseHomePageHeightChartJson(value: string | null | undefined): HomePageHeightChartJson | null {
    const parts = parseHeightChartParts(value)

    if (!parts?.height || !parts.calibration || !parts.image) {
        return null
    }

    const {calibration, height, image} = parts

    const meters = Number(height.meters)
    const headYPercent = Number(calibration.headYPercent)
    const footYPercent = Number(calibration.footYPercent)
    const nameTagXPercent = Number(calibration.nameTagXPercent ?? 50)
    const naturalWidth = Number(image.naturalWidth)
    const naturalHeight = Number(image.naturalHeight)
    const key = typeof image.key === 'string' ? image.key : ''

    if (
        !key ||
        !Number.isFinite(meters) ||
        meters <= 0 ||
        !Number.isFinite(headYPercent) ||
        !Number.isFinite(footYPercent) ||
        !Number.isFinite(nameTagXPercent) ||
        !Number.isFinite(naturalWidth) ||
        naturalWidth <= 0 ||
        !Number.isFinite(naturalHeight) ||
        naturalHeight <= 0 ||
        footYPercent <= headYPercent
    ) {
        return null
    }

    return {
        version: 1,
        height: {
            meters,
        },
        image: {
            key,
            contentType: typeof image.contentType === 'string' ? image.contentType : 'image/png',
            naturalWidth,
            naturalHeight,
        },
        calibration: {
            headYPercent,
            footYPercent,
            footIsVirtual: Boolean(calibration.footIsVirtual),
            nameTagXPercent,
        },
    }
}

function selectHomePageGalleryImageMix(images: HomePageGalleryImage[]): HomePageGalleryImage[] {
    const unused = new Set(images.map((image) => image.id))
    const groups = {
        tall: images.filter((image) => image.height / Math.max(1, image.width) >= 1.2),
        wide: images.filter((image) => image.width / Math.max(1, image.height) >= 1.2),
        square: images.filter((image) => {
            const ratio = image.width / Math.max(1, image.height)

            return ratio > 0.8 && ratio < 1.2
        }),
    }
    const pattern: Array<keyof typeof groups> = [
        'tall',
        'wide',
        'tall',
        'square',
        'wide',
        'tall',
        'wide',
        'square',
        'tall',
        'wide',
        'tall',
        'square',
        'wide',
        'tall',
        'wide',
        'tall',
        'square',
        'wide',
        'tall',
        'wide',
        'square',
    ]
    const selected: HomePageGalleryImage[] = []

    for (const groupName of pattern) {
        const candidate = groups[groupName].find((image) => unused.has(image.id)) ?? images.find((image) => unused.has(image.id))

        if (!candidate) {
            break
        }

        unused.delete(candidate.id)
        selected.push(candidate)
    }

    return selected
}

function shuffleHomePageGalleryImages(images: HomePageGalleryImage[]): HomePageGalleryImage[] {
    const shuffled = images.slice()

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1))
        const current = shuffled[index]
        const swap = shuffled[swapIndex]

        if (!current || !swap) {
            continue
        }

        shuffled[index] = swap
        shuffled[swapIndex] = current
    }

    return shuffled
}

async function getTableCount(db: D1Database, tableName: 'users' | 'characters' | 'character_media'): Promise<number> {
    const row = await db
        .prepare(`SELECT COUNT(*) AS count
                                  FROM ${tableName}`)
        .first<{count: number | string | null}>()
    const count = Number(row?.count ?? 0)

    return Number.isFinite(count) ? count : 0
}

async function getCachedJson<T>(cache: KVNamespace | undefined, key: string): Promise<T | null> {
    if (!cache) {
        return null
    }

    try {
        return await cache.get<T>(key, 'json')
    } catch {
        return null
    }
}

async function putCachedJson(
    cache: KVNamespace | undefined,
    key: string,
    value: unknown,
    expirationTtl = HOME_PAGE_CACHE_TTL_SECONDS,
): Promise<void> {
    if (!cache) {
        return
    }

    try {
        await cache.put(key, JSON.stringify(value), {expirationTtl})
    } catch {
        // Homepage cache misses should not block rendering.
    }
}

function isHomePageStats(value: unknown): value is HomePageStats {
    if (!value || typeof value !== 'object') {
        return false
    }

    const stats = value as Record<string, unknown>

    return Number.isFinite(stats.users) && Number.isFinite(stats.characters) && Number.isFinite(stats.mediaItems)
}

function isHomePageDiscoverCharacter(value: unknown): value is HomePageDiscoverCharacter {
    if (!value || typeof value !== 'object') {
        return false
    }

    const character = value as Record<string, unknown>

    return (
        typeof character.id === 'string' &&
        typeof character.userId === 'string' &&
        typeof character.name === 'string' &&
        typeof character.ownerUsername === 'string' &&
        typeof character.profileImageKey === 'string' &&
        typeof character.previewMediaId === 'string' &&
        typeof character.previewImageKey === 'string' &&
        (typeof character.previewThumbnailImageKey === 'string' || character.previewThumbnailImageKey === null) &&
        (typeof character.previewContentType === 'string' || character.previewContentType === null) &&
        typeof character.previewArtist === 'string' &&
        Number.isFinite(character.imageCount)
    )
}

function isHomePageGalleryImage(value: unknown): value is HomePageGalleryImage {
    if (!value || typeof value !== 'object') {
        return false
    }

    const image = value as Record<string, unknown>

    return (
        typeof image.id === 'string' &&
        typeof image.alt === 'string' &&
        (typeof image.fallbackSrc === 'string' || image.fallbackSrc === null || image.fallbackSrc === undefined) &&
        typeof image.height === 'number' &&
        Number.isFinite(image.height) &&
        typeof image.href === 'string' &&
        typeof image.src === 'string' &&
        typeof image.width === 'number' &&
        Number.isFinite(image.width)
    )
}

function userProfileUrl(username: string): string {
    return `/u/${encodeURIComponent(username)}`
}

function characterProfileUrl(username: string, characterName: string): string {
    return `${userProfileUrl(username)}/${encodeURIComponent(characterName)}`
}

async function renderProfilePage(c: PageRouteContext, username: string, rawPath = ''): Promise<Response> {
    const currentUser = await getCurrentUser(c)
    const profileUser = await getProfileUser(c.env.DB, username)

    if (!profileUser) {
        return renderNotFoundPage(c, 'That profile does not exist or is no longer available.')
    }

    const pathSegments = getProfilePathSegments(rawPath)

    if (pathSegments.length === 1) {
        const characterPath = pathSegments[0]

        if (!characterPath) {
            return renderNotFoundPage(c, 'That profile does not exist or is no longer available.')
        }

        const character = await getCharacterPageCharacter(c.env.DB, profileUser.id, characterPath)

        if (character) {
            if (username !== profileUser.username || characterPath !== character.name) {
                const requestUrl = new URL(c.req.url)
                return c.redirect(`${userProfileUrl(profileUser.username)}/${encodeURIComponent(character.name)}${requestUrl.search}`, 301)
            }

            const [media, galleryTabs, homeStats] = await Promise.all([
                getCharacterSettingsMedia(c.env.DB, profileUser.id, character.id),
                getCharacterGalleryTabs(c.env.DB, profileUser.id, character.id),
                getCachedHomePageStats(c.env.CACHE, c.env.DB),
            ])

            return c.html(
                <CharacterPage
                    character={character}
                    currentUser={currentUser}
                    galleryTabs={galleryTabs.length > 0 ? galleryTabs : createDefaultGalleryTabs(media)}
                    media={media}
                    mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
                    metaDescriptionFallback={homePageDescription(homeStats)}
                    profileUser={profileUser}
                    siteUrl={new URL(c.req.url).origin}
                />,
            )
        }
    }

    if (username !== profileUser.username) {
        const requestUrl = new URL(c.req.url)
        const canonicalPath = [userProfileUrl(profileUser.username), ...pathSegments.map((segment) => encodeURIComponent(segment))].join(
            '/',
        )

        return c.redirect(`${canonicalPath}${requestUrl.search}`, 301)
    }

    const [socialLinks, folders, characters, placements, homeStats] = await Promise.all([
        getUserSocialLinks(c.env.DB, profileUser.id),
        getCharacterFolders(c.env.DB, profileUser.id),
        getCharacters(c.env.DB, profileUser.id),
        getCharacterFolderPlacements(c.env.DB, profileUser.id),
        getCachedHomePageStats(c.env.CACHE, c.env.DB),
    ])
    const folderPath = pathSegments.length > 0 ? findFolderPath(folders, pathSegments) : []

    if (pathSegments.length > 0 && folderPath.length !== pathSegments.length) {
        return renderNotFoundPage(c, 'That folder path does not exist on this profile.')
    }

    const currentFolder = folderPath.at(-1) ?? null

    return c.html(
        <ProfilePage
            characters={characters}
            currentUser={currentUser}
            currentFolder={currentFolder}
            folderPath={folderPath}
            folders={folders}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            metaDescriptionFallback={homePageDescription(homeStats)}
            placements={placements}
            profileUser={profileUser}
            siteUrl={new URL(c.req.url).origin}
            socialLinks={socialLinks}
        />,
    )
}

function getProfilePathSegments(rawPath: string): string[] {
    return rawPath.split('/').filter(Boolean).map(decodePathSegment)
}

function decodePathSegment(segment: string): string {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

async function getCharacterPageCharacter(db: D1Database, userId: string, characterName: string): Promise<CharacterPageCharacter | null> {
    const character = await db
        .prepare(
            `SELECT id,
                user_id,
                name,
                profile_image_key,
                description,
                height_chart_json
         FROM characters
         WHERE user_id = ?
           AND name = ? COLLATE NOCASE
         ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, name
         LIMIT 1`,
        )
        .bind(userId, characterName, characterName)
        .first<{
            id: string
            user_id: string
            name: string
            profile_image_key: string
            description: string | null
            height_chart_json: string
        }>()

    if (!character) {
        return null
    }

    return {
        id: character.id,
        userId: character.user_id,
        name: character.name,
        profileImageKey: character.profile_image_key,
        description: character.description ?? '',
        hasHeightChart: hasUsableHeightChart(character.height_chart_json),
    }
}

function hasUsableHeightChart(value: string | null | undefined): boolean {
    const parts = parseHeightChartParts(value)

    return Boolean(
        parts?.image &&
            typeof parts.image.key === 'string' &&
            parts.image.key &&
            Number.isFinite(Number(parts.image.naturalWidth)) &&
            Number.isFinite(Number(parts.image.naturalHeight)) &&
            parts.height &&
            Number.isFinite(Number(parts.height.meters)) &&
            parts.calibration &&
            Number.isFinite(Number(parts.calibration.headYPercent)) &&
            Number.isFinite(Number(parts.calibration.footYPercent)),
    )
}

function findFolderPath(folders: CharacterManagementFolder[], pathSegments: string[]): CharacterManagementFolder[] {
    const folderPath: CharacterManagementFolder[] = []
    let parentFolderId: string | null = null

    for (const segment of pathSegments) {
        const folder = folders.find((candidate) => candidate.parentFolderId === parentFolderId && candidate.name === segment)

        if (!folder) {
            return folderPath
        }

        folderPath.push(folder)
        parentFolderId = folder.id
    }

    return folderPath
}

async function getProfileUser(db: D1Database, username: string): Promise<ProfilePageUser | null> {
    const user = await db
        .prepare(
            `SELECT id, username, profile_photo_key, bio
         FROM users
         WHERE username = ? COLLATE NOCASE
         ORDER BY CASE WHEN username = ? THEN 0 ELSE 1 END, username
         LIMIT 1`,
        )
        .bind(username, username)
        .first<{
            id: string
            username: string
            profile_photo_key: string | null
            bio: string
        }>()

    if (!user) {
        return null
    }

    return {
        id: user.id,
        username: user.username,
        profilePhotoKey: user.profile_photo_key,
        bio: user.bio,
    }
}

async function getUserSocialLinks(db: D1Database, userId: string): Promise<UserSocialLink[]> {
    const result = await db
        .prepare(
            `SELECT platform, label, url
         FROM user_social_links
         WHERE user_id = ?
         ORDER BY platform`,
        )
        .bind(userId)
        .all<UserSocialLink>()

    return result.results ?? []
}

async function getCharacterFolders(db: D1Database, userId: string): Promise<CharacterManagementFolder[]> {
    const result = await db
        .prepare(
            `SELECT id, name, parent_folder_id, folder_image_key, sort_order
         FROM character_folders
         WHERE user_id = ?
         ORDER BY parent_folder_id, sort_order, name`,
        )
        .bind(userId)
        .all<{
            id: string
            name: string
            parent_folder_id: string | null
            folder_image_key: string | null
            sort_order: number
        }>()

    return (result.results ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        folderImageKey: folder.folder_image_key,
        folderImageUrl: null,
        sortOrder: folder.sort_order,
    }))
}

async function getCharacters(db: D1Database, userId: string): Promise<CharacterManagementCharacter[]> {
    const result = await db
        .prepare(
            `SELECT id, name, profile_image_key, folder_id, sort_order
         FROM characters
         WHERE user_id = ?
         ORDER BY sort_order, name`,
        )
        .bind(userId)
        .all<{
            id: string
            name: string
            profile_image_key: string
            folder_id: string | null
            sort_order: number
        }>()

    return (result.results ?? []).map((character) => ({
        id: character.id,
        name: character.name,
        profileImageKey: character.profile_image_key,
        profileImageUrl: '',
        folderId: character.folder_id,
        sortOrder: character.sort_order,
    }))
}

async function getCharacterFolderPlacements(db: D1Database, userId: string): Promise<CharacterFolderPlacement[]> {
    const result = await db
        .prepare(
            `SELECT placement.folder_id,
                placement.character_id,
                placement.sort_order
         FROM character_folder_placements placement
                  INNER JOIN character_folders folder
                             ON folder.id = placement.folder_id
                                 AND folder.user_id = placement.user_id
                  INNER JOIN characters character
                             ON character.id = placement.character_id
                                 AND character.user_id = placement.user_id
         WHERE placement.user_id = ?
         ORDER BY placement.folder_id, placement.sort_order, character.name`,
        )
        .bind(userId)
        .all<{
            folder_id: string
            character_id: string
            sort_order: number
        }>()

    return (result.results ?? []).map((placement) => ({
        folderId: placement.folder_id,
        characterId: placement.character_id,
        sortOrder: placement.sort_order,
    }))
}

async function getUploadedImageCount(db: D1Database, userId: string): Promise<number> {
    const row = await db
        .prepare(
            `SELECT COALESCE(SUM(
                                 CASE WHEN sfw_image_key IS NOT NULL THEN 1 ELSE 0 END +
                                 CASE WHEN nsfw_image_key IS NOT NULL THEN 1 ELSE 0 END
                         ), 0) AS uploaded_image_count
         FROM character_media
         WHERE user_id = ?`,
        )
        .bind(userId)
        .first<{uploaded_image_count: number | null}>()

    return Number(row?.uploaded_image_count ?? 0)
}

async function getCharacterSettingsCharacter(
    db: D1Database,
    userId: string,
    characterId: string,
): Promise<CharacterSettingsCharacter | null> {
    const character = await db
        .prepare(
            `SELECT id,
                user_id,
                name,
                profile_image_key,
                description
         FROM characters
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(characterId, userId)
        .first<{
            id: string
            user_id: string
            name: string
            profile_image_key: string
            description: string | null
        }>()

    if (!character) {
        return null
    }

    return {
        id: character.id,
        userId: character.user_id,
        name: character.name,
        profileImageKey: character.profile_image_key,
        description: character.description ?? '',
    }
}

async function getCharacterHeightChartEditorCharacter(
    db: D1Database,
    userId: string,
    characterId: string,
    mediaBaseUrl: string,
): Promise<CharacterHeightChartEditorCharacter | null> {
    const character = await db
        .prepare(
            `SELECT id,
                user_id,
                name,
                height_chart_json
         FROM characters
         WHERE id = ?
           AND user_id = ?
         LIMIT 1`,
        )
        .bind(characterId, userId)
        .first<{
            id: string
            user_id: string
            name: string
            height_chart_json: string
        }>()

    if (!character) {
        return null
    }

    return {
        id: character.id,
        userId: character.user_id,
        name: character.name,
        heightChart: parseCharacterHeightChartEditorData(character.height_chart_json, mediaBaseUrl, character.user_id, character.id),
    }
}

function parseCharacterHeightChartEditorData(
    value: string | null | undefined,
    mediaBaseUrl: string,
    userId: string,
    characterId: string,
): CharacterHeightChartEditorData | null {
    const parts = parseHeightChartParts(value)

    if (!parts?.height || !parts.calibration) {
        return null
    }

    const {calibration, height, image} = parts

    const meters = Number(height.meters)
    const headYPercent = Number(calibration.headYPercent)
    const footYPercent = Number(calibration.footYPercent)
    const nameTagXPercent = Number(calibration.nameTagXPercent ?? 50)

    if (!Number.isFinite(meters) || !Number.isFinite(headYPercent) || !Number.isFinite(footYPercent) || !Number.isFinite(nameTagXPercent)) {
        return null
    }

    const imageKey = typeof image?.key === 'string' ? image.key : ''
    const contentType = typeof image?.contentType === 'string' ? image.contentType : 'image/png'
    const naturalWidth = Number(image?.naturalWidth)
    const naturalHeight = Number(image?.naturalHeight)

    return {
        version: 1,
        height: {
            meters,
        },
        image:
            imageKey && Number.isFinite(naturalWidth) && Number.isFinite(naturalHeight)
                ? {
                      key: imageKey,
                      contentType,
                      naturalWidth,
                      naturalHeight,
                      url: characterHeightChartImageUrl(mediaBaseUrl, userId, characterId, imageKey, contentType),
                  }
                : null,
        calibration: {
            headYPercent,
            footYPercent,
            footIsVirtual: Boolean(calibration.footIsVirtual),
            nameTagXPercent,
        },
    }
}

async function getCharacterSettingsMedia(db: D1Database, userId: string, characterId: string): Promise<CharacterSettingsMedia[]> {
    const result = await db
        .prepare(
            `SELECT id,
                sfw_image_key,
                nsfw_image_key,
                sfw_preview_image_key,
                nsfw_preview_image_key,
                nsfw_blur_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_preview_width,
                sfw_preview_height,
                nsfw_width,
                nsfw_height,
                nsfw_preview_width,
                nsfw_preview_height
         FROM character_media
         WHERE character_id = ?
           AND user_id = ?
         ORDER BY created_at, id`,
        )
        .bind(characterId, userId)
        .all<{
            id: string
            sfw_image_key: string | null
            nsfw_image_key: string | null
            sfw_preview_image_key: string | null
            nsfw_preview_image_key: string | null
            nsfw_blur_image_key: string | null
            sfw_content_type: string | null
            nsfw_content_type: string | null
            sfw_artist: string
            nsfw_artist: string
            sfw_width: number | null
            sfw_height: number | null
            sfw_preview_width: number | null
            sfw_preview_height: number | null
            nsfw_width: number | null
            nsfw_height: number | null
            nsfw_preview_width: number | null
            nsfw_preview_height: number | null
        }>()

    return (result.results ?? []).map((media) => ({
        id: media.id,
        sfwImageKey: media.sfw_image_key,
        nsfwImageKey: media.nsfw_image_key,
        sfwPreviewImageKey: media.sfw_preview_image_key ?? null,
        nsfwPreviewImageKey: media.nsfw_preview_image_key ?? null,
        nsfwBlurImageKey: media.nsfw_blur_image_key ?? null,
        sfwContentType: media.sfw_content_type ?? (media.sfw_image_key ? 'image/png' : null),
        nsfwContentType: media.nsfw_content_type ?? (media.nsfw_image_key ? 'image/png' : null),
        sfwArtist: media.sfw_artist,
        nsfwArtist: media.nsfw_artist,
        sfwWidth: media.sfw_width,
        sfwHeight: media.sfw_height,
        sfwPreviewWidth: media.sfw_preview_width ?? null,
        sfwPreviewHeight: media.sfw_preview_height ?? null,
        nsfwWidth: media.nsfw_width,
        nsfwHeight: media.nsfw_height,
        nsfwPreviewWidth: media.nsfw_preview_width ?? null,
        nsfwPreviewHeight: media.nsfw_preview_height ?? null,
    }))
}

async function getCharacterGalleryTabs(db: D1Database, userId: string, characterId: string): Promise<CharacterSettingsGalleryTab[]> {
    const [tabResult, rowResult] = await Promise.all([
        db
            .prepare(
                `SELECT id, name, sort_order
             FROM character_gallery_tabs
             WHERE character_id = ?
               AND user_id = ?
             ORDER BY sort_order, name`,
            )
            .bind(characterId, userId)
            .all<{
                id: string
                name: string
                sort_order: number
            }>(),
        db
            .prepare(
                `SELECT character_gallery_rows.id            AS row_id,
                    character_gallery_rows.tab_id        AS tab_id,
                    character_gallery_rows.sort_order    AS row_sort_order,
                    character_gallery_rows.force_full_width AS force_full_width,
                    character_gallery_row_media.media_id AS media_id,
                    character_gallery_row_media.sort_order AS media_sort_order
             FROM character_gallery_rows
                      LEFT JOIN character_gallery_row_media
                                ON character_gallery_row_media.row_id = character_gallery_rows.id
             WHERE character_gallery_rows.character_id = ?
               AND character_gallery_rows.user_id = ?
             ORDER BY character_gallery_rows.sort_order, character_gallery_row_media.sort_order`,
            )
            .bind(characterId, userId)
            .all<{
                row_id: string
                tab_id: string
                row_sort_order: number
                force_full_width: number | null
                media_id: string | null
                media_sort_order: number | null
            }>(),
    ])

    const rowsByTab = new Map<string, CharacterSettingsGalleryTab['rows']>()

    for (const row of rowResult.results ?? []) {
        const tabRows = rowsByTab.get(row.tab_id) ?? []
        let tabRow = tabRows.find((candidate) => candidate.id === row.row_id)

        if (!tabRow) {
            tabRow = {
                id: row.row_id,
                mediaIds: [],
                forceFullWidth: Boolean(row.force_full_width),
            }
            tabRows.push(tabRow)
            rowsByTab.set(row.tab_id, tabRows)
        }

        if (row.media_id) {
            tabRow.mediaIds.push(row.media_id)
        }
    }

    return (tabResult.results ?? []).map((tab) => ({
        id: tab.id,
        name: tab.name,
        rows: normalizeGalleryRowFullWidths(splitOversizedGalleryRows(rowsByTab.get(tab.id) ?? [])),
    }))
}

function createDefaultGalleryTabs(media: CharacterSettingsMedia[]): CharacterSettingsGalleryTab[] {
    const mediaIdChunks = chunkGalleryItems(media.map((item) => item.id))

    return [
        {
            id: crypto.randomUUID(),
            name: 'default',
            rows: mediaIdChunks.map((mediaIds) => ({
                id: crypto.randomUUID(),
                mediaIds,
                forceFullWidth: false,
            })),
        },
    ]
}

function splitOversizedGalleryRows(rows: CharacterSettingsGalleryTab['rows']): CharacterSettingsGalleryTab['rows'] {
    return rows.flatMap((row) => {
        const mediaIdChunks = chunkGalleryItems(row.mediaIds)
        const canForceFullWidth = row.forceFullWidth && row.mediaIds.length === 1

        if (mediaIdChunks.length === 0) {
            return [
                {
                    ...row,
                    forceFullWidth: false,
                },
            ]
        }

        return mediaIdChunks.map((mediaIds, index) => ({
            id: index === 0 ? row.id : crypto.randomUUID(),
            mediaIds,
            forceFullWidth: canForceFullWidth && mediaIds.length === 1,
        }))
    })
}

function normalizeGalleryRowFullWidths(rows: CharacterSettingsGalleryTab['rows']): CharacterSettingsGalleryTab['rows'] {
    return rows.map((row, index) => ({
        ...row,
        forceFullWidth: shouldForceGalleryRowFullWidth(row, index, rows.length),
    }))
}
