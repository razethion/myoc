import { Hono, type Context } from 'hono'
import {getCurrentUser, isAdminUser} from '../lib/auth/session'
import {getImageApprovalData} from '../lib/admin/imageApprovals'
import {getAdminReportsData} from '../lib/admin/reports'
import type {UserSocialLink} from '../lib/socialLinks'
import type { Bindings } from '../types/bindings'
import { AuthPage } from '../views/pages/AuthPage'
import {AdminPage, isAdminSection, type AdminSection} from '../views/pages/AdminPage'
import {AdminImageApprovalsPage} from '../views/pages/AdminImageApprovalsPage'
import {AdminReportsPage} from '../views/pages/AdminReportsPage'
import {
    CharacterPage,
    type CharacterPageCharacter,
} from '../views/pages/CharacterPage'
import {
    CharacterSettingsPage,
    type CharacterSettingsCharacter,
    type CharacterSettingsGalleryTab,
    type CharacterSettingsMedia,
} from '../views/pages/CharacterSettingsPage'
import {
    CharacterManagementPage,
    type CharacterManagementCharacter,
    type CharacterManagementFolder,
} from '../views/pages/CharacterManagementPage'
import {HomePage, type HomePageDiscoverCharacter, type HomePageStats} from '../views/pages/HomePage'
import {NotFoundPage} from '../views/pages/NotFoundPage'
import {ProfilePage, type ProfilePageUser} from '../views/pages/ProfilePage'
import {SearchPage} from '../views/pages/SearchPage'
import {UserSettingsPage} from '../views/pages/UserSettingsPage'
import {WhatsNewPage} from '../views/pages/WhatsNewPage'
import {searchAll} from '../lib/search'
import {APP_VERSION, RELEASE_NOTES} from '../lib/releases'

export const pageRoutes = new Hono<{ Bindings: Bindings }>()

type PageRouteContext = Context<{ Bindings: Bindings }>

const HOME_PAGE_STATS_CACHE_KEY = 'home:stats:v1'
const HOME_PAGE_DISCOVER_CACHE_KEY = 'home:discover:v1'
const HOME_PAGE_CACHE_TTL_SECONDS = 600

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters[Math.floor(Math.random() * letters.length)]
}

pageRoutes.get('/', async (c) => {
    const [currentUser, stats, discoverCharacters] = await Promise.all([
        getCurrentUser(c),
        getCachedHomePageStats(c.env.CACHE, c.env.DB),
        getCachedDiscoverCharacters(c.env.CACHE, c.env.DB),
    ])

    return c.html(
        <HomePage
            currentUser={currentUser}
            discoverCharacters={discoverCharacters}
            guestInitial={getRandomLetter()}
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
        <AuthPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            mode="login"
        />,
    )
})

pageRoutes.get('/register', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (currentUser) {
        return c.redirect(userProfileUrl(currentUser.username))
    }

    return c.html(
        <AuthPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            mode="register"
        />,
    )
})

pageRoutes.get('/settings', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const socialLinks = await getUserSocialLinks(c.env.DB, currentUser.id)

    return c.html(
        <UserSettingsPage
            currentUser={currentUser}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            socialLinks={socialLinks}
        />,
    )
})

pageRoutes.get('/characters', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const [folders, characters] = await Promise.all([
        getCharacterFolders(c.env.DB, currentUser.id),
        getCharacters(c.env.DB, currentUser.id),
    ])

    return c.html(
        <CharacterManagementPage
            characters={characters}
            currentUser={currentUser}
            folders={folders}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
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

    if (!isAdminUser(currentUser)) {
        return renderNotFoundPage(c)
    }

    const content = activeSection === 'image-approvals'
        ? (
            <AdminImageApprovalsPage
                csrfToken={currentUser.csrfToken}
                data={await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, c.req.query('mediaId'))}
            />
        )
        : activeSection === 'reports'
            ? (
                <AdminReportsPage
                    csrfToken={currentUser.csrfToken}
                    data={await getAdminReportsData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL)}
                />
            )
            : null

    return c.html(
        <AdminPage
            activeSection={activeSection}
            currentUser={currentUser}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        >
            {content}
        </AdminPage>,
    )
}

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
    await db.prepare(
        `UPDATE users
         SET last_seen_version = ?
         WHERE id = ?`,
    )
        .bind(APP_VERSION, userId)
        .run()
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

export async function renderNotFoundPage(
    c: PageRouteContext,
    message?: string,
): Promise<Response> {
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

    return suffix
        ? `${userProfileUrl(username)}/${suffix}`
        : userProfileUrl(username)
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

async function getTableCount(db: D1Database, tableName: 'users' | 'characters' | 'character_media'): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{count: number | string | null}>()
    const count = Number(row?.count ?? 0)

    return Number.isFinite(count) ? count : 0
}

async function getCachedDiscoverCharacters(cache: KVNamespace | undefined, db: D1Database): Promise<HomePageDiscoverCharacter[]> {
    const cached = await getCachedJson<HomePageDiscoverCharacter[]>(cache, HOME_PAGE_DISCOVER_CACHE_KEY)

    if (Array.isArray(cached) && cached.every(isHomePageDiscoverCharacter)) {
        return cached
    }

    const characters = await getDiscoverCharacters(db)
    await putCachedJson(cache, HOME_PAGE_DISCOVER_CACHE_KEY, characters)

    return characters
}

async function getDiscoverCharacters(db: D1Database): Promise<HomePageDiscoverCharacter[]> {
    const result = await db.prepare(
        `WITH approved_sfw_media AS (SELECT id,
              character_id,
              sfw_image_key,
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
              eligible_characters AS (
             SELECT characters.id,
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
                AND SUM(CASE WHEN approved_sfw_media.sfw_homepage_allowed = 1 THEN 1 ELSE 0 END) >= 1
             ORDER BY RANDOM()
             LIMIT 6
         )
         SELECT eligible_characters.id,
                eligible_characters.user_id,
                eligible_characters.name,
                eligible_characters.profile_image_key,
                eligible_characters.owner_username,
                eligible_characters.image_count,
                preview_media.id AS preview_media_id,
                preview_media.sfw_image_key AS preview_image_key,
                preview_media.sfw_content_type AS preview_content_type,
                preview_media.sfw_artist AS preview_artist
         FROM eligible_characters
                  INNER JOIN approved_sfw_media AS preview_media
            ON preview_media.id = (
                SELECT id
                FROM approved_sfw_media
                WHERE character_id = eligible_characters.id
                  AND sfw_homepage_allowed = 1
                ORDER BY RANDOM()
                LIMIT 1
            )`,
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
        previewContentType: character.preview_content_type ?? 'image/png',
        previewArtist: character.preview_artist ?? '',
        imageCount: Number(character.image_count) || 0,
    }))
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

async function putCachedJson(cache: KVNamespace | undefined, key: string, value: unknown): Promise<void> {
    if (!cache) {
        return
    }

    try {
        await cache.put(key, JSON.stringify(value), {expirationTtl: HOME_PAGE_CACHE_TTL_SECONDS})
    } catch {
        // Homepage cache misses should not block rendering.
    }
}

function isHomePageStats(value: unknown): value is HomePageStats {
    if (!value || typeof value !== 'object') {
        return false
    }

    const stats = value as Record<string, unknown>

    return Number.isFinite(stats.users)
        && Number.isFinite(stats.characters)
        && Number.isFinite(stats.mediaItems)
}

function isHomePageDiscoverCharacter(value: unknown): value is HomePageDiscoverCharacter {
    if (!value || typeof value !== 'object') {
        return false
    }

    const character = value as Record<string, unknown>

    return typeof character.id === 'string'
        && typeof character.userId === 'string'
        && typeof character.name === 'string'
        && typeof character.ownerUsername === 'string'
        && typeof character.profileImageKey === 'string'
        && typeof character.previewMediaId === 'string'
        && typeof character.previewImageKey === 'string'
        && typeof character.previewArtist === 'string'
        && Number.isFinite(character.imageCount)
}

function userProfileUrl(username: string): string {
    return `/u/${encodeURIComponent(username)}`
}

async function renderProfilePage(c: PageRouteContext, username: string, rawPath = ''): Promise<Response> {
    const currentUser = await getCurrentUser(c)
    const profileUser = await getProfileUser(c.env.DB, username)

    if (!profileUser) {
        return renderNotFoundPage(c, 'That profile does not exist or is no longer available.')
    }

    const pathSegments = getProfilePathSegments(rawPath)

    if (pathSegments.length === 1) {
        const character = await getCharacterPageCharacter(c.env.DB, profileUser.id, pathSegments[0])

        if (character) {
            const [media, galleryTabs] = await Promise.all([
                getCharacterSettingsMedia(c.env.DB, profileUser.id, character.id),
                getCharacterGalleryTabs(c.env.DB, profileUser.id, character.id),
            ])

            return c.html(
                <CharacterPage
                    character={character}
                    currentUser={currentUser}
                    galleryTabs={galleryTabs.length > 0 ? galleryTabs : createDefaultGalleryTabs(media)}
                    media={media}
                    mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
                    profileUser={profileUser}
                />,
            )
        }
    }

    const [socialLinks, folders, characters] = await Promise.all([
        getUserSocialLinks(c.env.DB, profileUser.id),
        getCharacterFolders(c.env.DB, profileUser.id),
        getCharacters(c.env.DB, profileUser.id),
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
            profileUser={profileUser}
            socialLinks={socialLinks}
        />,
    )
}

function getProfilePathSegments(rawPath: string): string[] {
    return rawPath
        .split('/')
        .filter(Boolean)
        .map(decodePathSegment)
}

function decodePathSegment(segment: string): string {
    try {
        return decodeURIComponent(segment)
    } catch {
        return segment
    }
}

async function getCharacterPageCharacter(
    db: D1Database,
    userId: string,
    characterName: string,
): Promise<CharacterPageCharacter | null> {
    const character = await db.prepare(
        `SELECT id,
                user_id,
                name,
                profile_image_key,
                description,
                gallery_fullsize_last_row
         FROM characters
         WHERE user_id = ?
           AND name = ?
         LIMIT 1`,
    )
        .bind(userId, characterName)
        .first<{
            id: string
            user_id: string
            name: string
            profile_image_key: string
            description: string | null
            gallery_fullsize_last_row: number | null
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
        galleryFullsizeLastRow: Boolean(character.gallery_fullsize_last_row),
    }
}

function findFolderPath(
    folders: CharacterManagementFolder[],
    pathSegments: string[],
): CharacterManagementFolder[] {
    const folderPath: CharacterManagementFolder[] = []
    let parentFolderId: string | null = null

    for (const segment of pathSegments) {
        const folder = folders.find((candidate) => (
            candidate.parentFolderId === parentFolderId
            && candidate.name === segment
        ))

        if (!folder) {
            return folderPath
        }

        folderPath.push(folder)
        parentFolderId = folder.id
    }

    return folderPath
}

async function getProfileUser(db: D1Database, username: string): Promise<ProfilePageUser | null> {
    const user = await db.prepare(
        `SELECT id, username, profile_photo_key, bio
         FROM users
         WHERE username = ?
         LIMIT 1`,
    )
        .bind(username)
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
    const result = await db.prepare(
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
    const result = await db.prepare(
        `SELECT id, name, parent_folder_id, sort_order
         FROM character_folders
         WHERE user_id = ?
         ORDER BY parent_folder_id, sort_order, name`,
    )
        .bind(userId)
        .all<{
            id: string
            name: string
            parent_folder_id: string | null
            sort_order: number
        }>()

    return (result.results ?? []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentFolderId: folder.parent_folder_id,
        sortOrder: folder.sort_order,
    }))
}

async function getCharacters(
    db: D1Database,
    userId: string,
): Promise<CharacterManagementCharacter[]> {
    const result = await db.prepare(
        `SELECT id, name, profile_image_key, folder_id, sort_order
         FROM characters
         WHERE user_id = ?
         ORDER BY folder_id, sort_order, name`,
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

async function getCharacterSettingsCharacter(
    db: D1Database,
    userId: string,
    characterId: string,
): Promise<CharacterSettingsCharacter | null> {
    const character = await db.prepare(
        `SELECT id,
                user_id,
                name,
                profile_image_key,
                description,
                gallery_fullsize_last_row
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
            gallery_fullsize_last_row: number | null
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
        galleryFullsizeLastRow: Boolean(character.gallery_fullsize_last_row),
    }
}

async function getCharacterSettingsMedia(
    db: D1Database,
    userId: string,
    characterId: string,
): Promise<CharacterSettingsMedia[]> {
    const result = await db.prepare(
        `SELECT id,
                sfw_image_key,
                nsfw_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                nsfw_width,
                nsfw_height
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
            sfw_content_type: string | null
            nsfw_content_type: string | null
            sfw_artist: string
            nsfw_artist: string
            sfw_width: number | null
            sfw_height: number | null
            nsfw_width: number | null
            nsfw_height: number | null
        }>()

    return (result.results ?? []).map((media) => ({
        id: media.id,
        sfwImageKey: media.sfw_image_key,
        nsfwImageKey: media.nsfw_image_key,
        sfwContentType: media.sfw_content_type ?? (media.sfw_image_key ? 'image/png' : null),
        nsfwContentType: media.nsfw_content_type ?? (media.nsfw_image_key ? 'image/png' : null),
        sfwArtist: media.sfw_artist,
        nsfwArtist: media.nsfw_artist,
        sfwWidth: media.sfw_width,
        sfwHeight: media.sfw_height,
        nsfwWidth: media.nsfw_width,
        nsfwHeight: media.nsfw_height,
    }))
}

async function getCharacterGalleryTabs(
    db: D1Database,
    userId: string,
    characterId: string,
): Promise<CharacterSettingsGalleryTab[]> {
    const [tabResult, rowResult] = await Promise.all([
        db.prepare(
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
        db.prepare(
            `SELECT character_gallery_rows.id AS row_id,
                    character_gallery_rows.tab_id AS tab_id,
                    character_gallery_rows.sort_order AS row_sort_order,
                    character_gallery_row_media.media_id AS media_id,
                    character_gallery_row_media.sort_order AS media_sort_order
             FROM character_gallery_rows
             LEFT JOIN character_gallery_row_media ON character_gallery_row_media.row_id = character_gallery_rows.id
             WHERE character_gallery_rows.character_id = ?
               AND character_gallery_rows.user_id = ?
             ORDER BY character_gallery_rows.sort_order, character_gallery_row_media.sort_order`,
        )
            .bind(characterId, userId)
            .all<{
                row_id: string
                tab_id: string
                row_sort_order: number
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
        rows: rowsByTab.get(tab.id) ?? [],
    }))
}

function createDefaultGalleryTabs(media: CharacterSettingsMedia[]): CharacterSettingsGalleryTab[] {
    return [{
        id: crypto.randomUUID(),
        name: 'default',
        rows: [{
            id: crypto.randomUUID(),
            mediaIds: media.map((item) => item.id),
        }],
    }]
}
