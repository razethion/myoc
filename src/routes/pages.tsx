import { Hono, type Context } from 'hono'
import { getCurrentUser } from '../lib/auth/session'
import type {UserSocialLink} from '../lib/socialLinks'
import type { Bindings } from '../types/bindings'
import { AuthPage } from '../views/pages/AuthPage'
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
import {searchAll} from '../lib/search'

export const pageRoutes = new Hono<{ Bindings: Bindings }>()

type PageRouteContext = Context<{ Bindings: Bindings }>

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters[Math.floor(Math.random() * letters.length)]
}

pageRoutes.get('/', async (c) => {
    const [currentUser, stats, discoverCharacters] = await Promise.all([
        getCurrentUser(c),
        getHomePageStats(c.env.DB),
        getDiscoverCharacters(c.env.DB),
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

async function getTableCount(db: D1Database, tableName: 'users' | 'characters' | 'character_media'): Promise<number> {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).first<{count: number | string | null}>()
    const count = Number(row?.count ?? 0)

    return Number.isFinite(count) ? count : 0
}

async function getDiscoverCharacters(db: D1Database): Promise<HomePageDiscoverCharacter[]> {
    const result = await db.prepare(
        `WITH eligible_characters AS (
             SELECT characters.id,
                    characters.user_id,
                    characters.name,
                    characters.profile_image_key,
                    users.username AS owner_username,
                    COUNT(character_media.id) AS image_count
             FROM characters
             INNER JOIN users ON users.id = characters.user_id
             INNER JOIN character_media
                ON character_media.character_id = characters.id
               AND character_media.sfw_image_key IS NOT NULL
             GROUP BY characters.id,
                      characters.user_id,
                      characters.name,
                      characters.profile_image_key,
                      users.username
             HAVING COUNT(character_media.id) >= 5
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
                preview_media.sfw_artist AS preview_artist
         FROM eligible_characters
         INNER JOIN character_media AS preview_media
            ON preview_media.id = (
                SELECT id
                FROM character_media
                WHERE character_id = eligible_characters.id
                  AND sfw_image_key IS NOT NULL
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
        previewArtist: character.preview_artist ?? '',
        imageCount: Number(character.image_count) || 0,
    }))
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
