import {afterEach, describe, expect, it, vi} from 'vitest'
import app from '../index'
import type {LeaderboardSnapshot} from '../lib/leaderboard'
import {APP_VERSION, RELEASE_NOTES} from '../lib/releases'
import {expectSecurityHeaders} from '../test/assertions'
import {queryOne, seedCharacter, seedFolder, seedMedia, seedPasskey, seedSession, seedUser, useResetTestDatabase} from '../test/d1'
import {createMockKVNamespace} from '../test/mockKV'
import {createMockR2Bucket} from '../test/mockR2'
import {resetWorkerBindings, workerEnv} from '../test/workerBindings'
import {CharacterPage} from '../views/pages/CharacterPage'
import {MigratePage} from '../views/pages/MigratePage'
import {pageRoutes} from './pages'

vi.mock('../lib/recentMedia/reader', () => ({
    getGeneratedRecentMediaPage: vi.fn(async () => ({
        generation: null,
        items: [],
        nextCursor: null,
        nextPosition: null,
        publicRootUrl: null,
        publishedAt: null,
    })),
}))

const mediaPublicBaseUrl = 'https://m.myoc.art'
const NON_HTML_CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'sandbox',
].join('; ')
const LEADERBOARD_CACHE_KEY = 'leaderboard:daily:v1'

afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    await resetWorkerBindings()
})

const db = useResetTestDatabase()

type ProfilePageDbOptions = {
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
    searchCharacters?: unknown[]
    userCount?: number
    characterCount?: number
    mediaCount?: number
    uploadedImageCount?: number
    discoverCharacters?: unknown[]
    homeGalleryImages?: unknown[]
    homeHeightChartCharacters?: unknown[]
    activeToyhouseImportJob?: unknown
    activeToyhouseImportItems?: unknown[]
    imageApprovalItem?: unknown
    imageApprovalQueue?: unknown[]
    imageApprovalHistory?: unknown[]
    adminReports?: unknown[]
    adminJobRuns?: unknown[]
    userPasskeys?: unknown[]
    userSessions?: unknown[]
}

type DatabaseRow = Record<string, unknown>

async function insertRow(table: string, row: DatabaseRow): Promise<void> {
    const entries = Object.entries(row).filter(([, value]) => value !== undefined)
    const columns = entries.map(([column]) => column)
    const placeholders = entries.map(() => '?').join(', ')
    await db
        .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
        .bind(...entries.map(([, value]) => value))
        .run()
}

function databaseRow(value: unknown): DatabaseRow {
    return value as DatabaseRow
}

async function seedUserRow(value: unknown, fallbackId = 'current-user', fallbackUsername = 'demo'): Promise<string> {
    const row = databaseRow(value)
    const id = String(row.id ?? fallbackId)
    const username = String(row.username ?? fallbackUsername)
    const existing = await queryOne<{id: string}>('SELECT id FROM users WHERE id = ?', [id], db)

    if (!existing) {
        await seedUser(
            {
                id,
                email: String(row.email ?? `${username}@example.test`),
                username,
                passwordHash: String(row.password_hash ?? 'test-password-hash'),
                profilePhotoKey: (row.profile_photo_key as string | null | undefined) ?? null,
                bio: String(row.bio ?? ''),
                displayNsfwMedia: Number(row.display_nsfw_media ?? 0) === 1,
                role: (row.role as 'user' | 'moderator' | 'admin' | undefined) ?? 'user',
                createdAt: String(row.created_at ?? '2026-01-01 00:00:00'),
                lastSeenVersion: (row.last_seen_version as string | null | undefined) ?? null,
                recoveryPhraseConfirmedAt: (row.recovery_phrase_confirmed_at as string | null | undefined) ?? null,
                secureAccountRequired: Number(row.secure_account_required ?? 0) === 1,
                passkeyPromptSeenAt: (row.passkey_prompt_seen_at as string | null | undefined) ?? null,
            },
            db,
        )
    }

    return id
}

async function seedCharacterRow(value: unknown, fallbackUserId: string): Promise<string> {
    const row = databaseRow(value)
    const id = String(row.id)
    const existing = await queryOne<{id: string}>('SELECT id FROM characters WHERE id = ?', [id], db)

    if (!existing) {
        await seedCharacter(
            {
                id,
                userId: String(row.user_id ?? fallbackUserId),
                name: String(row.name ?? id),
                profileImageKey: String(row.profile_image_key ?? `${id}-profile`),
                folderId: (row.folder_id as string | null | undefined) ?? null,
                sortOrder: Number(row.sort_order ?? 0),
                description: String(row.description ?? ''),
                heightChartJson: typeof row.height_chart_json === 'string' ? row.height_chart_json : '',
            },
            db,
        )
    }

    return id
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This test helper maps optional media fixture fields to D1 columns.
async function seedMediaRow(value: unknown, fallbackUserId: string, fallbackCharacterId: string): Promise<string> {
    const row = databaseRow(value)
    const id = String(row.id)
    const existing = await queryOne<{id: string}>('SELECT id FROM character_media WHERE id = ?', [id], db)

    if (!existing) {
        await seedMedia(
            {
                id,
                userId: String(row.user_id ?? fallbackUserId),
                characterId: String(row.character_id ?? fallbackCharacterId),
                sfwImageKey: (row.sfw_image_key as string | null | undefined) ?? null,
                nsfwImageKey: (row.nsfw_image_key as string | null | undefined) ?? null,
                sfwArtist: String(row.sfw_artist ?? ''),
                nsfwArtist: String(row.nsfw_artist ?? ''),
                sfwWidth: (row.sfw_width as number | null | undefined) ?? null,
                sfwHeight: (row.sfw_height as number | null | undefined) ?? null,
                sfwByteSize: (row.sfw_byte_size as number | null | undefined) ?? undefined,
                nsfwWidth: (row.nsfw_width as number | null | undefined) ?? null,
                nsfwHeight: (row.nsfw_height as number | null | undefined) ?? null,
                nsfwByteSize: (row.nsfw_byte_size as number | null | undefined) ?? undefined,
                sfwReviewStatus: (row.sfw_review_status as 'pending' | 'approved' | 'reported' | undefined) ?? 'pending',
                sfwReviewedAt: (row.sfw_reviewed_at as string | null | undefined) ?? null,
                sfwApprovedAt: (row.sfw_approved_at as string | null | undefined) ?? null,
                sfwHomepageAllowed: Number(row.sfw_homepage_allowed ?? 0) === 1,
                nsfwReviewStatus: (row.nsfw_review_status as 'pending' | 'approved' | 'reported' | undefined) ?? 'pending',
                nsfwReviewedAt: (row.nsfw_reviewed_at as string | null | undefined) ?? null,
                nsfwApprovedAt: (row.nsfw_approved_at as string | null | undefined) ?? null,
                sfwContentType: (row.sfw_content_type as string | null | undefined) ?? undefined,
                nsfwContentType: (row.nsfw_content_type as string | null | undefined) ?? undefined,
                sfwPreviewImageKey: (row.sfw_preview_image_key as string | null | undefined) ?? null,
                sfwPreviewContentType: (row.sfw_preview_content_type as 'image/webp' | 'image/avif' | undefined) ?? 'image/webp',
                sfwPreviewWidth: (row.sfw_preview_width as number | null | undefined) ?? null,
                sfwPreviewHeight: (row.sfw_preview_height as number | null | undefined) ?? null,
                nsfwPreviewImageKey: (row.nsfw_preview_image_key as string | null | undefined) ?? null,
                nsfwPreviewContentType: (row.nsfw_preview_content_type as 'image/webp' | 'image/avif' | undefined) ?? 'image/webp',
                nsfwPreviewWidth: (row.nsfw_preview_width as number | null | undefined) ?? null,
                nsfwPreviewHeight: (row.nsfw_preview_height as number | null | undefined) ?? null,
                nsfwBlurImageKey: (row.nsfw_blur_image_key as string | null | undefined) ?? null,
                nsfwBlurContentType: (row.nsfw_blur_content_type as 'image/webp' | 'image/avif' | undefined) ?? 'image/webp',
                createdAt: String(row.created_at ?? '2026-01-01 00:00:00'),
                updatedAt: String(row.updated_at ?? '2026-01-01 00:00:00'),
            },
            db,
        )
    }

    return id
}

async function runStatements(statements: D1PreparedStatement[]): Promise<void> {
    for (let index = 0; index < statements.length; index += 100) {
        await db.batch(statements.slice(index, index + 100))
    }
}

async function seedTotalUsers(total: number): Promise<void> {
    const existing = Number((await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM users', [], db))?.count ?? 0)
    const statement = db.prepare(
        `INSERT INTO users (id, email, username, password_hash, passkey_prompt_seen_at)
         VALUES (?, ?, ?, 'test-password-hash', '2026-01-01 00:00:00')`,
    )
    const statements: D1PreparedStatement[] = []
    for (let index = existing; index < total; index += 1) {
        statements.push(statement.bind(`count-user-${index}`, `count-${index}@example.test`, `count_user_${index}`))
    }
    await runStatements(statements)
}

async function seedTotalCharacters(total: number, userId: string): Promise<string> {
    const existing = Number((await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM characters', [], db))?.count ?? 0)
    const statement = db.prepare(
        `INSERT INTO characters (id, size_chart_id, user_id, name, profile_image_key)
         VALUES (?, ?, ?, ?, ?)`,
    )
    const statements: D1PreparedStatement[] = []
    for (let index = existing; index < total; index += 1) {
        const id = `count-character-${index}`
        const sizeChartId = new Uint8Array([0, 0, 0, (index >> 16) & 255, (index >> 8) & 255, index & 255])
        statements.push(statement.bind(id, sizeChartId, userId, `Count Character ${index}`, `${id}-profile`))
    }
    await runStatements(statements)
    return (await queryOne<{id: string}>('SELECT id FROM characters ORDER BY id LIMIT 1', [], db))?.id ?? ''
}

async function seedTotalMedia(total: number, userId: string, characterId: string): Promise<void> {
    const existing = Number((await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM character_media', [], db))?.count ?? 0)
    const statement = db.prepare(
        `INSERT INTO character_media (
            id, user_id, character_id, sfw_image_key, sfw_width, sfw_height, sfw_byte_size, sfw_content_type
        ) VALUES (?, ?, ?, ?, 1, 1, 1, 'image/png')`,
    )
    const statements: D1PreparedStatement[] = []
    for (let index = existing; index < total; index += 1) {
        statements.push(statement.bind(`count-media-${index}`, userId, characterId, `count-media-key-${index}`))
    }
    await runStatements(statements)
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This test helper seeds each optional page fixture group in dependency order.
async function seedPageDatabase(options: ProfilePageDbOptions = {}): Promise<D1Database> {
    const currentUserId = options.currentUser ? await seedUserRow(options.currentUser) : 'current-user'
    const profileUserId = options.profileUser ? await seedUserRow(options.profileUser, 'profile-user', 'demo') : currentUserId

    if (options.currentUser) {
        const current = databaseRow(options.currentUser)
        const sessionId = String(current.session_id ?? 'current-user-session')
        if (!(await queryOne('SELECT id FROM sessions WHERE id = ?', [sessionId], db))) {
            await seedSession(
                {
                    id: sessionId,
                    userId: currentUserId,
                    token: 'session-token',
                },
                db,
            )
        }
    }

    for (const value of options.searchUsers ?? []) {
        const userId = await seedUserRow(value, String(databaseRow(value).id), String(databaseRow(value).username))
        const count = Number(databaseRow(value).character_count ?? 0)
        for (let index = 0; index < count; index += 1) {
            await seedCharacterRow({id: `${userId}-character-${index}`, name: `Razeth ${index}`, user_id: userId}, userId)
        }
    }

    for (const value of options.homeHeightChartCharacters ?? []) {
        const row = databaseRow(value)
        const userId = await seedUserRow({id: row.user_id, username: row.username}, String(row.user_id), String(row.username))
        await seedCharacterRow(row, userId)
    }

    for (const value of options.homeGalleryImages ?? []) {
        const row = databaseRow(value)
        const userId = await seedUserRow({id: row.user_id, username: row.owner_username}, String(row.user_id), String(row.owner_username))
        const characterId = await seedCharacterRow({id: row.character_id, name: row.character_name, user_id: userId}, userId)
        await seedMediaRow(
            {
                ...row,
                character_id: characterId,
                sfw_approved_at: '2026-01-02 00:00:00',
                sfw_homepage_allowed: 1,
                sfw_review_status: 'approved',
                updated_at: '2026-01-01 00:00:00',
            },
            userId,
            characterId,
        )
    }

    for (const value of options.discoverCharacters ?? []) {
        const row = databaseRow(value)
        const userId = await seedUserRow({id: row.user_id, username: row.owner_username}, String(row.user_id), String(row.owner_username))
        const discoverCharacterId = await seedCharacterRow(row, userId)
        const imageCount = Number(row.image_count ?? 5)
        for (let index = 0; index < imageCount; index += 1) {
            const mediaId = index === 0 ? String(row.preview_media_id) : `${discoverCharacterId}-media-${index}`
            await seedMediaRow(
                {
                    id: mediaId,
                    user_id: userId,
                    character_id: discoverCharacterId,
                    sfw_image_key: index === 0 ? row.preview_image_key : `${mediaId}-key`,
                    sfw_preview_image_key: index === 0 ? row.preview_thumbnail_image_key : null,
                    sfw_artist: index === 0 ? row.preview_artist : '',
                    sfw_review_status: 'approved',
                    sfw_approved_at: '2026-01-02 00:00:00',
                    sfw_homepage_allowed: index === 0 ? 1 : 0,
                    updated_at: '2026-01-01 00:00:00',
                },
                userId,
                discoverCharacterId,
            )
        }
    }

    for (const value of options.folders ?? []) {
        const row = databaseRow(value)
        await seedFolder(
            {
                id: String(row.id),
                userId: profileUserId,
                name: String(row.name),
                parentFolderId: (row.parent_folder_id as string | null | undefined) ?? null,
                sortOrder: Number(row.sort_order ?? 0),
                folderImageKey: (row.folder_image_key as string | null | undefined) ?? null,
            },
            db,
        )
    }

    const characterValues = [
        ...(options.characters ?? []),
        ...(options.searchCharacters ?? []),
        ...(options.characterSettings ? [options.characterSettings] : []),
    ]
    for (const value of characterValues) {
        const row = databaseRow(value)
        const userId = String(row.user_id ?? profileUserId)
        if (!(await queryOne('SELECT id FROM users WHERE id = ?', [userId], db))) {
            await seedUserRow({id: userId, username: row.username ?? `user_${userId}`}, userId, String(row.username ?? `user_${userId}`))
        }
        await seedCharacterRow(row, userId)
    }

    const characterId = options.characterSettings
        ? String(databaseRow(options.characterSettings).id)
        : options.characters?.[0]
          ? String(databaseRow(options.characters[0]).id)
          : 'test-character'
    const characterOwnerId = options.characterSettings
        ? String(databaseRow(options.characterSettings).user_id ?? profileUserId)
        : profileUserId

    if (options.activeToyhouseImportJob) {
        const job = databaseRow(options.activeToyhouseImportJob)
        await insertRow('toyhouse_import_jobs', {
            id: job.id,
            user_id: currentUserId,
            status: job.status ?? 'running',
            total_images: job.total_images ?? options.activeToyhouseImportItems?.length ?? 0,
        })
        for (const [index, value] of (options.activeToyhouseImportItems ?? []).entries()) {
            const item = databaseRow(value)
            const itemCharacterId = String(item.character_id ?? 'toyhouse-import-character')
            await seedCharacterRow(
                {
                    id: itemCharacterId,
                    name: item.name ?? `Import Character ${index}`,
                    user_id: currentUserId,
                },
                currentUserId,
            )
            if (item.media_id) {
                await seedMediaRow(
                    {
                        id: item.media_id,
                        user_id: currentUserId,
                        character_id: itemCharacterId,
                        sfw_image_key: `${item.media_id}-key`,
                    },
                    currentUserId,
                    itemCharacterId,
                )
            }
            await insertRow('toyhouse_import_items', {
                id: item.id,
                job_id: job.id,
                user_id: currentUserId,
                character_id: itemCharacterId,
                toyhouse_character_id: item.toyhouse_character_id ?? '9430171',
                toyhouse_image_url: item.toyhouse_image_url ?? `https://f2.toyhou.se/file/f2-toyhou-se/images/${index}.png`,
                import_mode: item.import_mode ?? 'existing',
                rating: item.rating ?? 'sfw',
                status: item.status ?? 'pending',
                media_id: item.media_id ?? null,
                sort_order: index,
            })
        }
    }

    for (const value of options.characterMedia ?? []) {
        await seedMediaRow(value, characterOwnerId, characterId)
    }

    for (const value of options.galleryTabs ?? []) {
        const row = databaseRow(value)
        await insertRow('character_gallery_tabs', {
            id: row.id,
            user_id: characterOwnerId,
            character_id: characterId,
            name: row.name,
            sort_order: row.sort_order ?? 0,
        })
    }

    const seededRows = new Set<string>()
    for (const value of options.galleryRows ?? []) {
        const row = databaseRow(value)
        const rowId = String(row.row_id)
        if (!seededRows.has(rowId)) {
            await insertRow('character_gallery_rows', {
                id: rowId,
                user_id: characterOwnerId,
                character_id: characterId,
                tab_id: row.tab_id,
                sort_order: row.row_sort_order ?? 0,
                force_full_width: row.force_full_width ?? 0,
            })
            seededRows.add(rowId)
        }
        if (row.media_id) {
            await insertRow('character_gallery_row_media', {
                row_id: rowId,
                media_id: row.media_id,
                sort_order: row.media_sort_order ?? 0,
            })
        }
    }

    for (const value of options.socialLinks ?? []) {
        await insertRow('user_social_links', {user_id: profileUserId, ...databaseRow(value)})
    }

    for (const value of options.placements ?? []) {
        await insertRow('character_folder_placements', {
            user_id: profileUserId,
            ...databaseRow(value),
        })
    }

    for (const value of options.userPasskeys ?? []) {
        const row = databaseRow(value)
        await seedPasskey(
            {
                id: String(row.id),
                userId: currentUserId,
                name: row.name as string | null | undefined,
                deviceType: row.device_type as string | undefined,
                backedUp: Number(row.backed_up ?? 0) === 1,
                transports: row.transports as string | null | undefined,
                createdAt: row.created_at as string | undefined,
                lastUsedAt: row.last_used_at as string | null | undefined,
            },
            db,
        )
    }

    for (const value of options.userSessions ?? []) {
        const row = databaseRow(value)
        const id = String(row.id)
        if (await queryOne('SELECT id FROM sessions WHERE id = ?', [id], db)) {
            await db
                .prepare('UPDATE sessions SET created_at = ?, expires_at = ? WHERE id = ?')
                .bind(row.created_at, row.expires_at, id)
                .run()
        } else {
            await seedSession(
                {
                    id,
                    userId: currentUserId,
                    token: `${id}-token`,
                    createdAt: String(row.created_at),
                    expiresAt: String(row.expires_at),
                },
                db,
            )
        }
    }

    const approvalSource = options.imageApprovalItem ?? options.imageApprovalQueue?.[0]
    if (approvalSource) {
        const row = databaseRow(approvalSource)
        const ownerId = String(row.user_id ?? 'owner-1')
        await seedUserRow(
            {id: ownerId, username: row.username ?? 'uploader', email: row.email ?? 'uploader@example.test'},
            ownerId,
            String(row.username ?? 'uploader'),
        )
        const approvalCharacterId = String(row.character_id ?? 'character-1')
        await seedCharacterRow({id: approvalCharacterId, name: row.character_name ?? 'Quartz', user_id: ownerId}, ownerId)
        await seedMediaRow(
            {
                ...row,
                id: row.id ?? 'media-1',
                user_id: ownerId,
                character_id: approvalCharacterId,
                sfw_image_key: row.sfw_image_key ?? 'sfw-key',
            },
            ownerId,
            approvalCharacterId,
        )
    }

    for (const value of options.imageApprovalHistory ?? []) {
        const row = databaseRow(value)
        const ownerId = 'approval-history-owner'
        await seedUserRow({id: ownerId, username: row.owner_username ?? 'uploader'}, ownerId, String(row.owner_username ?? 'uploader'))
        const historyCharacterId = 'approval-history-character'
        await seedCharacterRow({id: historyCharacterId, name: row.character_name ?? 'Quartz', user_id: ownerId}, ownerId)
        await seedMediaRow(
            {id: row.media_id, user_id: ownerId, character_id: historyCharacterId, sfw_image_key: 'history-image-key'},
            ownerId,
            historyCharacterId,
        )
        await insertRow('character_media_review_events', {
            id: row.id,
            media_id: row.media_id,
            image_rating: row.image_rating,
            action: row.action,
            homepage_allowed: row.homepage_allowed ?? 0,
            moderator_id: currentUserId,
            created_at: row.created_at,
        })
    }

    for (const value of options.adminReports ?? []) {
        const row = databaseRow(value)
        const ownerId = String(row.user_id)
        await seedUserRow({id: ownerId, username: row.username}, ownerId, String(row.username))
        const reportCharacterId = String(row.character_id)
        await seedCharacterRow({id: reportCharacterId, name: row.character_name, user_id: ownerId}, ownerId)
        await seedMediaRow(row, ownerId, reportCharacterId)
        const reportRating = row.sfw_review_status === 'reported' ? 'sfw' : row.nsfw_review_status === 'reported' ? 'nsfw' : null
        const reporterUsername = reportRating === 'sfw' ? row.sfw_reported_by_username : row.nsfw_reported_by_username
        if (reportRating && reporterUsername) {
            await insertRow('character_media_review_events', {
                id: `${row.id}-${reportRating}-report`,
                media_id: row.id,
                image_rating: reportRating,
                action: `report_${reportRating}`,
                homepage_allowed: 0,
                moderator_id: currentUserId,
                created_at: reportRating === 'sfw' ? row.sfw_reviewed_at : row.nsfw_reviewed_at,
            })
        }
    }

    for (const value of options.adminJobRuns ?? []) {
        const row = databaseRow(value)
        await insertRow('admin_job_runs', {
            id: row.id,
            job_name: row.job_name,
            trigger_source: row.trigger_source,
            triggered_by_user_id: row.triggered_by_user_id ? currentUserId : null,
            cron: row.cron,
            status: row.status,
            started_at: row.started_at,
            finished_at: row.finished_at,
            duration_ms: row.duration_ms,
            summary_json: row.summary_json,
            error_message: row.error_message,
        })
    }

    if (options.userCount !== undefined) {
        await seedTotalUsers(options.userCount)
    }

    let countOwnerId = (await queryOne<{id: string}>('SELECT id FROM users ORDER BY id LIMIT 1', [], db))?.id
    if ((options.characterCount !== undefined || options.mediaCount !== undefined) && !countOwnerId) {
        countOwnerId = await seedUserRow({id: 'count-owner', username: 'count_owner'}, 'count-owner', 'count_owner')
    }

    let countCharacterId = (await queryOne<{id: string}>('SELECT id FROM characters ORDER BY id LIMIT 1', [], db))?.id
    if (options.characterCount !== undefined && countOwnerId) {
        countCharacterId = await seedTotalCharacters(options.characterCount, countOwnerId)
    }
    if (options.mediaCount !== undefined && countOwnerId) {
        if (!countCharacterId) {
            countCharacterId = await seedTotalCharacters(1, countOwnerId)
        }
        await seedTotalMedia(options.mediaCount, countOwnerId, countCharacterId)
    }

    if (options.uploadedImageCount !== undefined && options.currentUser) {
        const uploadCharacterId =
            (await queryOne<{id: string}>('SELECT id FROM characters WHERE user_id = ? LIMIT 1', [currentUserId], db))?.id ??
            (await seedCharacterRow({id: 'upload-character', name: 'Upload Character', user_id: currentUserId}, currentUserId))
        let remaining = options.uploadedImageCount
        let index = 0
        while (remaining > 0) {
            const hasNsfw = remaining > 1
            await seedMediaRow(
                {
                    id: `upload-media-${index}`,
                    user_id: currentUserId,
                    character_id: uploadCharacterId,
                    sfw_image_key: `upload-sfw-${index}`,
                    nsfw_image_key: hasNsfw ? `upload-nsfw-${index}` : null,
                },
                currentUserId,
                uploadCharacterId,
            )
            remaining -= hasNsfw ? 2 : 1
            index += 1
        }
    }

    return db
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

async function getAppPath(path: string, database = db, headers: Record<string, string> = {}, cache = workerEnv.CACHE): Promise<Response> {
    return app.request(
        `https://example.com${path}`,
        {headers},
        {
            CACHE: cache,
            DB: database,
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

function createToyhouseSelectionTestPayload() {
    return {
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
                thumbnailUrl: null,
                url: 'https://toyhou.se/9430171.absinthe',
            },
        ],
    }
}

async function postToyhouseSelection(selection: unknown, options: {includeSelection?: boolean; payload?: unknown} = {}) {
    const form = new FormData()
    form.set('toyhousePayload', JSON.stringify(options.payload ?? createToyhouseSelectionTestPayload()))

    if (options.includeSelection !== false) {
        form.set('toyhouseSelection', typeof selection === 'string' ? selection : JSON.stringify(selection))
    }

    const db = await seedPageDatabase({
        currentUser: createCurrentUserRecord('demo'),
        characters: [{id: 'existing-absinthe', name: 'Absinthe'}],
    })
    const response = await app.request(
        'https://example.com/migrate/import/confirm',
        {body: form, headers: {cookie: 'myoc_session=session-token'}, method: 'POST'},
        {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: createMockR2Bucket(),
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )

    return {db, response, html: await response.text()}
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

function getContentSecurityPolicyDirective(contentSecurityPolicy: string, directiveName: string): string {
    return (
        contentSecurityPolicy
            .split(';')
            .map((directive) => directive.trim())
            .find((directive) => directive.startsWith(`${directiveName} `)) ?? ''
    )
}

function getNonceFromDirective(directive: string): string {
    const match = directive.match(/'nonce-([^']+)'/)

    expect(match).not.toBeNull()
    expect(match?.[1]).toMatch(/^[A-Za-z0-9+/]{22}==$/)

    return match?.[1] ?? ''
}

describe('security headers', () => {
    it('adds an enforcing nonce-based content security policy to HTML responses', async () => {
        const response = await getAppPath('/')
        const html = await response.text()
        const contentSecurityPolicy = expectSecurityHeaders(response)
        const scriptDirective = getContentSecurityPolicyDirective(contentSecurityPolicy, 'script-src')
        const nonce = getNonceFromDirective(scriptDirective)
        const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []
        const structuredDataScriptTags = scriptTags.filter((tag) => tag.includes('type="application/ld+json"'))
        const executableScriptTags = scriptTags.filter((tag) => !tag.includes('type="application/ld+json"'))

        expect(scriptDirective).toBe(`script-src 'self' 'nonce-${nonce}'`)
        expect(scriptDirective).not.toContain("'unsafe-inline'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'default-src')).toBe("default-src 'self'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'base-uri')).toBe("base-uri 'self'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'object-src')).toBe("object-src 'none'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'script-src-attr')).toBe("script-src-attr 'none'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'style-src-elem')).toBe("style-src-elem 'self' 'unsafe-inline'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'img-src')).toBe("img-src 'self' data: blob: https://m.myoc.art")
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'media-src')).toBe("media-src 'self' https://m.myoc.art")
        expect(contentSecurityPolicy).not.toContain(' https:;')
        expect(contentSecurityPolicy).toContain('upgrade-insecure-requests')
        expect(executableScriptTags.length).toBeGreaterThan(0)
        expect(executableScriptTags.every((tag) => tag.includes(`nonce="${nonce}"`))).toBe(true)
        expect(structuredDataScriptTags.length).toBeGreaterThan(0)
        expect(structuredDataScriptTags.every((tag) => !tag.includes('nonce='))).toBe(true)
    })

    it('allows direct Toyhou.se image previews only on migration pages', async () => {
        const response = await getAppPath(
            '/migrate',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const contentSecurityPolicy = expectSecurityHeaders(response)

        expect(response.status).toBe(200)
        expect(getContentSecurityPolicyDirective(contentSecurityPolicy, 'img-src')).toBe(
            "img-src 'self' data: blob: https://m.myoc.art https://file.toyhou.se https://f2.toyhou.se",
        )
    })

    it('adds a locked-down content security policy to API responses', async () => {
        const response = await getAppPath('/api/missing', await seedPageDatabase(), {
            accept: 'application/json',
        })
        const contentSecurityPolicy = expectSecurityHeaders(response)

        expect(response.status).toBe(404)
        expect(response.headers.get('content-type')).toContain('application/json')
        expect(contentSecurityPolicy).toBe(NON_HTML_CONTENT_SECURITY_POLICY)
    })
})

describe('public page redirects', () => {
    it('redirects logged-in users from home to recent uploads', async () => {
        const response = await getAppPath(
            '/',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/recent')
    })

    it('renders home for guests', async () => {
        const response = await getAppPath(
            '/',
            await seedPageDatabase({
                userCount: 24,
                characterCount: 128,
                mediaCount: 4096,
            }),
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
        expect(html).not.toContain('MyOC is open-source.')
        expect(html).not.toContain('href="https://github.com/razethion/myoc"')
        expect(html).not.toContain('home-loading-image')
        expect(html).not.toContain('data-gallery-image-loader')
        expect(html).toContain('href="/login"')
        expect(html).toContain('href="/recent"')
        expect(html).toContain('24')
        expect(html).toContain('128')
        expect(html).toContain('4,096')
    })

    it('renders recent uploads for guests', async () => {
        const response = await getAppPath('/recent')
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Recently uploaded media | MyOC</title>')
        expect(html).toContain('data-recent-feed')
        expect(html).toContain('data-persist-unapproved="false"')
        expect(html).toContain('Show unapproved')
    })

    it('renders the latest leaderboard snapshot from KV', async () => {
        const snapshot = {
            version: 1,
            generatedAt: '2026-07-12T10:00:00.000Z',
            costPerGbMonthUsd: 0.015,
            totalManagedBytes: 5 * 1024 * 1024 * 1024,
            totalUsers: 987,
            totalCharacters: 1234,
            totalImages: 5678,
            topUsers: [
                {
                    rank: 1,
                    userId: 'user-1',
                    username: 'alice',
                    profilePhotoKey: null,
                    characterCount: 12,
                    imageCount: 128,
                    bytes: 1024 * 1024 * 1024,
                    monthlyStorageCostUsd: 0.015,
                },
            ],
            usersByCharacters: [
                {
                    rank: 1,
                    userId: 'user-1',
                    username: 'alice',
                    profilePhotoKey: null,
                    characterCount: 12,
                },
            ],
            usersByImages: [
                {
                    rank: 1,
                    userId: 'user-2',
                    username: 'bob',
                    profilePhotoKey: 'bob-photo',
                    imageCount: 345,
                },
            ],
            usersByData: [
                {
                    rank: 1,
                    userId: 'user-2',
                    username: 'bob',
                    profilePhotoKey: 'bob-photo',
                    bytes: 2 * 1024 * 1024 * 1024,
                    monthlyStorageCostUsd: 0.03,
                },
            ],
            charactersByData: [
                {
                    rank: 1,
                    characterId: 'char-2',
                    userId: 'user-2',
                    name: 'Beryl',
                    ownerUsername: 'bob',
                    profileImageKey: 'beryl-profile',
                    bytes: 3 * 1024 * 1024 * 1024,
                    monthlyStorageCostUsd: 0.045,
                },
            ],
        } satisfies LeaderboardSnapshot
        const cache = createMockKVNamespace({
            values: {
                [LEADERBOARD_CACHE_KEY]: snapshot,
            },
        })
        const response = await getAppPath('/leaderboard', await seedPageDatabase(), {}, cache)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Leaderboard | MyOC</title>')
        expect(html).toContain('Daily rankings')
        expect(html).toContain('Total data stored')
        expect(html).toContain('Total characters')
        expect(html).toContain('Total users')
        expect(html).toContain('Total images')
        expect(html).toContain('Users with the most characters')
        expect(html).toContain('Users with the most images')
        expect(html).toContain('Users consuming the most data')
        expect(html).toContain('Characters with the most data uploaded')
        expect(html).toContain('987')
        expect(html).toContain('1,234')
        expect(html).toContain('5,678')
        expect(html).toContain('alice')
        expect(html).toContain('bob')
        expect(html).toContain('Beryl')
        expect(html).toContain('12')
        expect(html).toContain('345')
        expect(html).toContain('5.00 GB')
        expect(html).toContain('3.00 GB')
        expect(html).toContain('$0.0450/mo')
        expect(html).toContain('href="/u/bob/Beryl"')
        expect(html).toContain('https://m.myoc.art/characters/user-2/char-2/profile/beryl-profile.webp')
    })

    it('renders approved homepage gallery media with accessible links', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)

        const db = await seedPageDatabase({
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
        expect(response.status).toBe(200)
        expect(html).toContain('Gallery Management')
        expect(html).toContain('data-home-approved-gallery')
        expect(html).toContain('data-gallery-tile')
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
    })

    it('reuses cached homepage gallery thumbnails when source rows are unavailable', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(0)

        const db = await seedPageDatabase({
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

        expect(response.status).toBe(200)
        const firstHtml = await response.text()
        expect(firstHtml).toContain('/u/demo_owner/Quartz%20Dragon')
        expect(firstHtml).toContain('preview-thumb-key.webp')

        await db.batch([
            db.prepare('DELETE FROM character_media WHERE id = ?').bind('media-1'),
            db.prepare('DELETE FROM characters WHERE id = ?').bind('character-1'),
            db.prepare('DELETE FROM users WHERE id = ?').bind('owner-1'),
        ])
        const cachedResponse = await getAppPath('/', db, {}, cache)
        const cachedHtml = await cachedResponse.text()

        expect(cachedResponse.status).toBe(200)
        expect(cachedHtml).toContain('/u/demo_owner/Quartz%20Dragon')
        expect(cachedHtml).toContain('preview-thumb-key.webp')
    })

    it('renders the homepage height chart preview from Razeth chart models', async () => {
        const db = await seedPageDatabase({
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

        expect(response.status).toBe(200)
        expect(html).toContain('Height Charts')
        expect(html).toContain('How do you stack up?')
        expect(html).toContain('/assets/home-height-ivo.webp')
        expect(html).toContain('/assets/home-height-luxor.webp')
        expect(html).toContain('href="/size-chart">Open size chart</a>')
        expect(html).not.toContain('2 characters')
    })

    it('ignores malformed homepage height chart data', async () => {
        const response = await getAppPath(
            '/',
            await seedPageDatabase({
                homeHeightChartCharacters: [
                    {
                        height_chart_json: JSON.stringify({
                            calibration: {footIsVirtual: false, footYPercent: 90, headYPercent: 10},
                            height: {meters: 1.8},
                            image: null,
                            version: 1,
                        }),
                        id: 'invalid-height-chart',
                        name: 'Ivo',
                        user_id: 'user-razeth',
                        username: 'razeth',
                    },
                ],
            }),
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).not.toContain('invalid-height-chart')
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
        const db = await seedPageDatabase({
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
    })

    it('renders homepage stats from KV cache', async () => {
        const db = await seedPageDatabase()
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
    })

    it('redirects logged-in users away from login and register', async () => {
        const db = await seedPageDatabase({
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo', {
                passkey_prompt_seen_at: null,
            }),
        })
        const response = await getAppPath('/passkey-setup?returnTo=/search?q=demo', db, {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()
        const storedUser = await queryOne<{passkey_prompt_seen_at: string | null}>(
            'SELECT passkey_prompt_seen_at FROM users WHERE id = ?',
            ['current-user'],
            db,
        )

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Set Up A Passkey | MyOC</title>')
        expect(html).toContain('Set up a passkey')
        expect(html).toContain('name="choice" type="submit" value="setup"')
        expect(html).toContain('name="choice" type="submit" value="later"')
        expect(html).toContain('name="returnTo" type="hidden" value="/search?q=demo"')
        expect(storedUser?.passkey_prompt_seen_at).toBeNull()
    })

    it.each([
        ['a protocol-relative URL', '%2F%2Fevil.example'],
        ['a backslash authority URL', '%2F%5Cevil.example'],
        ['a double-backslash authority URL', '%2F%5C%5Cevil.example'],
        ['a double-encoded authority URL', '%252F%252Fevil.example'],
        ['an encoded API path', '%2F%2561pi%2Fsearch'],
        ['an encoded passkey path', '%2F%2570asskey-setup'],
        ['an authority URL with a tab', '%2F%09%2Fevil.example'],
        ['a malformed encoded path', '%2F%25E0%25A4%25A'],
    ])('rejects %s as a passkey return path', async (_name, returnTo) => {
        const response = await getAppPath(
            `/passkey-setup?returnTo=${returnTo}`,
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo', {passkey_prompt_seen_at: null}),
                userPasskeys: [{id: 'passkey-1'}],
            }),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/u/demo')
    })

    it('keeps a valid local passkey return path', async () => {
        const response = await getAppPath(
            '/passkey-setup?returnTo=%2Fsearch%3Fq%3Ddemo',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo', {passkey_prompt_seen_at: null}),
                userPasskeys: [{id: 'passkey-1'}],
            }),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/search?q=demo')
    })

    it('renders home, login, and register for logged-out users', async () => {
        const homeResponse = await getAppPath('/')
        const loginResponse = await getAppPath('/login')
        const registerResponse = await getAppPath('/register')

        expect(homeResponse.status).toBe(200)
        expect(loginResponse.status).toBe(200)
        expect(registerResponse.status).toBe(200)
    })

    it('server-renders the password login form for password-manager autofill', async () => {
        const response = await getAppPath('/login?method=password')
        const html = await response.text()
        const passwordPanel = html.match(/<div[^>]*data-login-panel="password"[^>]*>/)?.[0]
        const passkeyPanel = html.match(/<div[^>]*data-login-panel="passkey"[^>]*>/)?.[0]

        expect(response.status).toBe(200)
        expect(passwordPanel).toBeDefined()
        expect(passwordPanel).not.toContain('hidden')
        expect(passkeyPanel).toContain('hidden')
        expect(html).toContain('action="/login"')
        expect(html).toContain('autocomplete="on"')
        expect(html).toContain('autocomplete="username"')
        expect(html).toContain('id="login-username"')
        expect(html).toContain('autocomplete="current-password"')
        expect(html).toContain('name="csrfToken"')
        expect(html).toContain('data-pre-auth-csrf-token')
        expect(html).toContain('href="/login?method=password"')
        expect(html).not.toContain('data-login-mode')
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(response.headers.get('set-cookie')).toContain('myoc_pre_auth_csrf=')
    })

    it('reuses a valid pre-authentication CSRF cookie', async () => {
        const csrfToken = '0123456789abcdef0123456789abcdef'
        const response = await getAppPath('/login', db, {
            cookie: `myoc_pre_auth_csrf=${csrfToken}`,
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('set-cookie')).toContain(`myoc_pre_auth_csrf=${csrfToken}`)
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
        if (RELEASE_NOTES.some((release) => release.important)) {
            expect(html).toContain('This change requires user interaction')
            expect(html).toContain('Important!')
        }
        expect(html).toContain('href="/whats-new"')
    })

    it('marks the current version seen when logged-in users visit the what is new page', async () => {
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
        })
        const response = await getAppPath('/whats-new', db, {
            cookie: 'myoc_session=session-token',
        })
        const html = await response.text()
        const storedUser = await queryOne<{last_seen_version: string | null}>(
            'SELECT last_seen_version FROM users WHERE id = ?',
            ['current-user'],
            db,
        )

        expect(response.status).toBe(200)
        expect(storedUser?.last_seen_version).toBe(APP_VERSION)
        expect(html).toContain('data-version-notification')
        expect(html).toContain('hidden"')
    })

    it('renders SEO metadata on the home page', async () => {
        const response = await getAppPath(
            '/',
            await seedPageDatabase({
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
        expect(html).toContain('type="application/ld+json"')
        expect(html).toContain('"@type":"WebSite"')
        expect(html).toContain('"description":"Hosting over 1,234 images"')
        expect(html).toContain('"target":"https://example.com/search?q={search_term_string}"')
    })
})

describe('GET /search', () => {
    it('renders matching users and characters from live search data', async () => {
        const response = await getAppPath(
            '/search?q=raz',
            await seedPageDatabase({
                searchUsers: [
                    {
                        id: 'profile-user',
                        username: 'razeth',
                        bio: 'Character artist.',
                        profile_photo_key: 'profile-photo-key',
                        character_count: 2,
                    },
                ],
                searchCharacters: [
                    {
                        id: 'character-1',
                        name: 'RAZETH',
                        profile_image_key: 'character-image-key',
                        user_id: 'profile-user',
                        username: 'razeth',
                    },
                ],
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
            await seedPageDatabase({
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

    it('renders passkeys, sessions, profile photos, and secure-account state', async () => {
        const response = await getAppPath(
            '/settings',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo', {
                    profile_photo_key: 'profile-key',
                    recovery_phrase_confirmed_at: '2026-07-01 00:00:00',
                    secure_account_required: 1,
                    session_id: 'session-current',
                }),
                userPasskeys: [
                    {
                        id: 'passkey-1',
                        name: 'Laptop passkey',
                        device_type: 'multiDevice',
                        backed_up: 1,
                        transports: 'internal,hybrid,usb,nfc,ble',
                        created_at: '2026-07-01 12:00:00',
                        last_used_at: '2026-07-02 12:00:00',
                    },
                    {
                        id: 'passkey-2',
                        name: null,
                        device_type: 'singleDevice',
                        backed_up: 0,
                        transports: null,
                        created_at: 'not-a-date',
                        last_used_at: null,
                    },
                ],
                userSessions: [
                    {
                        id: 'session-current',
                        created_at: '2026-07-01 10:00:00',
                        expires_at: '2099-08-01 10:00:00',
                    },
                    {
                        id: 'session-other',
                        created_at: 'not-a-date',
                        expires_at: '2099-08-02 10:00:00',
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('https://m.myoc.art/users/current-user/profile/profile-key.webp')
        expect(html).toContain('data-force-passkey-setup="true"')
        expect(html).toContain('Secure your account')
        expect(html).toContain('Complete Security Review')
        expect(html).toContain('<span data-passkey-count-text="true">2</span> registered')
        expect(html).toContain('Laptop passkey')
        expect(html).toContain('This device, Phone or tablet, USB key, NFC key, ble')
        expect(html).toContain('Synced')
        expect(html).toContain('Security key')
        expect(html).toContain('not-a-date')
        expect(html).toContain('Never')
        expect(html).toContain('Status: Confirmed')
        expect(html).toContain('2 active')
        expect(html).toContain('This session')
        expect(html).toContain('data-session-id="session-other"')
    })
})

describe('GET /migrate', () => {
    it('renders the Toyhou.se migration form for signed-in users', async () => {
        const response = await getAppPath(
            '/migrate?toyhouseUsername=demo',
            await seedPageDatabase({
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
        expect(html).toContain('Verification failed')
        expect(html).toContain('Start Import')
        expect(html).toContain('data-toyhouse-import-dialog')
        expect(html).toContain('Save the import bookmarklet')
        expect(html).toContain('href="javascript:')
        expect(html).toContain('I Bookmarked It')
        expect(html).toContain('Drag the Import to MyOC button to your bookmarks bar')
        expect(html).toContain('/migrate/import')
    })

    it('renders the logged-in Toyhou.se import receiver page', async () => {
        const response = await getAppPath(
            '/migrate/import',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Waiting for Toyhou.se')
        expect(html).toContain('Keep this tab open. The bookmarklet will send your Toyhou.se import here automatically.')
        expect(html).toContain('Waiting for the bookmarklet to start.')
        expect(html).toContain('id="logout-form"')
        expect(html).toContain('href="/settings">Back to Settings</a>')
        expect(html).not.toContain('href="/login">Login</a>')
    })

    it('proxies Toyhou.se images for signed-in users', async () => {
        const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        const fetchMock = vi.fn(
            async () =>
                new Response(imageBytes, {
                    headers: {
                        'content-type': 'image/png',
                    },
                }),
        )
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485')}`,
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        expect(response.headers.get('content-disposition')).toBe('attachment')
        expect(response.headers.get('cache-control')).toBe('private, no-store')
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
        expect(fetchMock).toHaveBeenCalledWith(
            'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171?1609806485',
            expect.objectContaining({
                redirect: 'manual',
                signal: expect.anything(),
            }),
        )
    })

    it('normalizes the PNG32 type returned for Toyhou.se profile images', async () => {
        const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(imageBytes, {headers: {'content-type': 'PNG32'}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/f2-toyhou-se/characters/13181023?1767837533')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('image/png')
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
    })

    it.each(['https://file.toyhou.se/characters/1821629?1767837342', 'https://file.toyhou.se/images/12345882_qpgFr51uXTKJzkw.png'])(
        'proxies a legacy Toyhou.se image URL: %s',
        async (imageUrl) => {
            const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
            const fetchMock = vi.fn(async () => new Response(imageBytes, {headers: {'content-type': 'png32'}}))
            vi.stubGlobal('fetch', fetchMock)

            const response = await getAppPath(
                `/migrate/toyhouse-image?url=${encodeURIComponent(imageUrl)}`,
                await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
                {cookie: 'myoc_session=session-token'},
            )

            expect(response.status).toBe(200)
            expect(response.headers.get('content-type')).toBe('image/png')
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
            expect(fetchMock).toHaveBeenCalledWith(imageUrl, expect.objectContaining({redirect: 'manual'}))
        },
    )

    it.each([
        {
            name: 'JPEG',
            contentType: 'image/jpeg',
            bytes: new Uint8Array([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        },
        {
            name: 'GIF87a',
            contentType: 'image/gif',
            bytes: new TextEncoder().encode('GIF87a000000'),
        },
        {
            name: 'GIF89a',
            contentType: 'image/gif',
            bytes: new TextEncoder().encode('GIF89a000000'),
        },
        {
            name: 'WebP',
            contentType: 'image/webp',
            bytes: new TextEncoder().encode('RIFF0000WEBP'),
        },
        {
            name: 'AVIF',
            contentType: 'image/avif',
            bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66, ...new Array(20).fill(0)]),
        },
        {
            name: 'AVIS',
            contentType: 'image/avif',
            bytes: new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x73, ...new Array(20).fill(0)]),
        },
    ])('proxies a valid $name signature', async ({bytes, contentType}) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(bytes, {headers: {'content-type': `${contentType}; charset=binary`}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe(contentType)
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes)
    })

    it.each(['not-a-number', String(Number.MAX_SAFE_INTEGER + 1)])(
        'ignores an invalid image content length of %s',
        async (contentLength) => {
            const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
            vi.stubGlobal(
                'fetch',
                vi.fn(
                    async () =>
                        new Response(imageBytes, {
                            headers: {'content-length': contentLength, 'content-type': 'image/png'},
                        }),
                ),
            )

            const response = await getAppPath(
                `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
                await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
                {cookie: 'myoc_session=session-token'},
            )

            expect(response.status).toBe(200)
            expect(new Uint8Array(await response.arrayBuffer())).toEqual(imageBytes)
        },
    )

    it('rejects Toyhou.se image proxy requests for untrusted URLs', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://example.com/image.png')}`,
            await seedPageDatabase({
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

    it.each([
        ['a malformed URL', 'not a URL'],
        ['a non-HTTPS URL', 'http://f2.toyhou.se/file/image.png'],
        ['a username', 'https://user@f2.toyhou.se/file/image.png'],
        ['a password', 'https://:secret@f2.toyhou.se/file/image.png'],
        ['a wildcard Toyhou.se host', 'https://cdn.toyhou.se/file/image.png'],
        ['a non-file path', 'https://f2.toyhou.se/profile/demo'],
        ['a legacy non-image path', 'https://file.toyhou.se/profile/demo'],
        ['a custom port', 'https://f2.toyhou.se:8443/file/image.png'],
        ['an oversized URL', `https://f2.toyhou.se/file/${'a'.repeat(2_100)}`],
    ])('rejects %s in the Toyhou.se image proxy', async (_name, url) => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent(url)}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(400)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it.each([
        {name: 'a failed request', aborted: false, status: 502, error: 'Toyhou.se image request failed'},
        {name: 'a timed-out request', aborted: true, status: 504, error: 'Toyhou.se image request timed out'},
    ])('reports $name to the Toyhou.se image origin', async ({aborted, status, error}) => {
        if (aborted) {
            vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort())
        }
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                throw new Error('upstream request failed')
            }),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(status)
        await expect(response.json()).resolves.toEqual({error})
    })

    it.each([
        {name: 'an upstream error', upstream: new Response('not found', {status: 404}), status: 404},
        {name: 'an empty response', upstream: new Response(null, {status: 204}), status: 204},
    ])('rejects $name from the Toyhou.se image origin', async ({upstream, status}) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => upstream),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(502)
        await expect(response.json()).resolves.toEqual({error: `Toyhou.se returned ${status} for image URL`})
    })

    it.each([
        {
            name: 'HTML',
            response: new Response('<script>globalThis.attackerCode = true</script>', {
                headers: {'content-type': 'text/html'},
            }),
            error: 'Toyhou.se returned an unsupported image type',
        },
        {
            name: 'a missing content type',
            response: new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
            error: 'Toyhou.se returned an unsupported image type',
        },
        {
            name: 'a redirect',
            response: new Response(null, {
                headers: {location: 'https://evil.example/payload'},
                status: 302,
            }),
            error: 'Toyhou.se image redirects are not allowed',
        },
        {
            name: 'an oversized image',
            response: new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
                headers: {'content-length': String(200 * 1024 * 1024 + 1), 'content-type': 'image/png'},
            }),
            error: 'Toyhou.se image is too large',
        },
        {
            name: 'HTML mislabeled as an image',
            response: new Response('<html lang="en">not an image</html>', {
                headers: {'content-type': 'image/png'},
            }),
            error: 'Toyhou.se returned invalid image data',
        },
    ])('rejects $name from the Toyhou.se image origin', async ({response: upstream, error}) => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => upstream),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(502)
        expect(await response.json()).toEqual({error})
        expect(response.headers.get('content-security-policy')).toBe(NON_HTML_CONTENT_SECURITY_POLICY)
    })

    it('rejects a truncated image signature', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8]), {headers: {'content-type': 'image/jpeg'}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.jpg')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(502)
        await expect(response.json()).resolves.toEqual({error: 'Toyhou.se returned invalid image data'})
    })

    it('streams image chunks after validating the signature', async () => {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        const remainingBytes = new Uint8Array([1, 2, 3])
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(signature)
                controller.enqueue(remainingBytes)
                controller.close()
            },
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body, {headers: {'content-type': 'image/png'}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(200)
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([...signature, ...remainingBytes]))
    })

    it('rejects an initial image chunk that exceeds the declared length', async () => {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(signature, {
                        headers: {'content-length': '8', 'content-type': 'image/png'},
                    }),
            ),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(502)
        await expect(response.json()).resolves.toEqual({error: 'Toyhou.se returned invalid image data'})
    })

    it('stops a streamed image when later data exceeds the declared length', async () => {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(signature)
                controller.enqueue(new Uint8Array([1]))
                controller.close()
            },
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(
                async () =>
                    new Response(body, {
                        headers: {'content-length': String(signature.byteLength), 'content-type': 'image/png'},
                    }),
            ),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(200)
        await expect(response.arrayBuffer()).rejects.toThrow('Image is too large')
    })

    it('forwards an upstream stream failure to the response reader', async () => {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        let pullCount = 0
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pullCount === 0) {
                    pullCount += 1
                    controller.enqueue(signature)
                    return
                }

                controller.error(new Error('upstream stream failed'))
            },
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body, {headers: {'content-type': 'image/png'}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.status).toBe(200)
        await expect(response.arrayBuffer()).rejects.toThrow('upstream stream failed')
    })

    it('cancels the upstream image reader when the client cancels', async () => {
        const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
        const cancel = vi.fn()
        let pullCount = 0
        const body = new ReadableStream<Uint8Array>({
            cancel,
            async pull(controller) {
                if (pullCount === 0) {
                    pullCount += 1
                    controller.enqueue(signature)
                    return
                }

                await new Promise(() => undefined)
            },
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(body, {headers: {'content-type': 'image/png'}})),
        )

        const response = await getAppPath(
            `/migrate/toyhouse-image?url=${encodeURIComponent('https://f2.toyhou.se/file/image.png')}`,
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {cookie: 'myoc_session=session-token'},
        )

        expect(response.body).not.toBeNull()
        await response.body?.cancel('client stopped')

        expect(cancel).toHaveBeenCalledWith('client stopped')
    })

    it('redirects the migration start page to confirm when an import job is active', async () => {
        const response = await getAppPath(
            '/migrate',
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
                DB: await seedPageDatabase({
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
        expect(html).toContain('MyOC is importing your images')
        expect(html).toContain('MyOC is preparing the selected images. Keep this page open during large imports.')
        expect(html).toContain('checked="" class="checkbox checkbox-primary')
        expect(html).toContain('name="toyhouseSelection"')
        expect(html).toContain('NSFW')
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

    it('reuses the accepted Toyhou.se payload when review data would exceed the payload limit', async () => {
        const targetLength = 4_999_950
        const character = {
            id: '9430171',
            images: [],
            imageCount: 0,
            name: 'Absinthe',
            thumbnailUrl: null,
            url: 'https://toyhou.se/9430171.absinthe',
        }
        const payload = {
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [character],
        }
        const baseLength = JSON.stringify(payload).length
        character.url += 'a'.repeat(targetLength - baseLength)
        const serializedPayload = JSON.stringify(payload)
        const requestBody = new URLSearchParams({
            toyhousePayload: serializedPayload,
            toyhouseSelection: JSON.stringify({characters: [], createdCharacters: []}),
        }).toString()
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
        })
        const bindings = {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: createMockR2Bucket(),
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        }

        expect(serializedPayload).toHaveLength(targetLength)

        const reviewResponse = await app.request(
            'https://example.com/migrate/import',
            {
                body: requestBody,
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            bindings,
        )
        const reviewHtml = await reviewResponse.text()

        expect(reviewResponse.status).toBe(200)
        expect(reviewHtml).toContain('Review Characters for Import')
        expect(reviewHtml).not.toContain('Toyhou.se returned too much data')

        const confirmResponse = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: requestBody,
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            bindings,
        )
        const confirmHtml = await confirmResponse.text()

        expect(confirmResponse.status).toBe(200)
        expect(confirmHtml).toContain('Select at least one character to import.')
        expect(confirmHtml).not.toContain('Toyhou.se returned too much data')
    })

    it('rejects a Toyhou.se payload when URL normalization makes the accepted data too large', async () => {
        const payload = JSON.stringify({
            myocUserId: 'current-user',
            profileUrl: 'https://toyhou.se/demo',
            folderUrl: 'https://toyhou.se/demo/characters/folder:all',
            pagesFetched: 1,
            characters: [
                {
                    id: '9430171',
                    images: [],
                    imageCount: 0,
                    name: 'Absinthe',
                    thumbnailUrl: null,
                    url: `https://toyhou.se/9430171.${'é'.repeat(850_000)}`,
                },
            ],
        })
        const response = await app.request(
            'https://example.com/migrate/import',
            {
                body: new URLSearchParams({toyhousePayload: payload}).toString(),
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: await seedPageDatabase({
                    currentUser: createCurrentUserRecord('demo'),
                }),
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()

        expect(payload.length).toBeLessThan(5_000_000)
        expect(response.status).toBe(200)
        expect(html).toContain('Toyhou.se returned too much data')
        expect(html).not.toContain('Review Characters for Import')
    })

    it('rejects a Toyhou.se payload above the accepted character limit', async () => {
        const form = new FormData()
        form.set('toyhousePayload', 'x'.repeat(5_000_001))
        const response = await app.request(
            'https://example.com/migrate/import',
            {
                body: form,
                headers: {cookie: 'myoc_session=session-token'},
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Toyhou.se returned too much data')
    })

    it('reports malformed and oversized Toyhou.se form bodies', async () => {
        const db = await seedPageDatabase({currentUser: createCurrentUserRecord('demo')})
        const bindings = {
            CACHE: createMockKVNamespace(),
            DB: db,
            MEDIA_BUCKET: createMockR2Bucket(),
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        }
        const malformedResponse = await app.request(
            'https://example.com/migrate/import',
            {
                body: '--missing\r\ninvalid',
                headers: {
                    'content-type': 'multipart/form-data; boundary=missing',
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            bindings,
        )
        const oversizedResponse = await app.request(
            'https://example.com/migrate/import',
            {
                body: 'toyhousePayload=%7B%7D',
                headers: {
                    'content-length': String(16 * 1024 * 1024 + 1),
                    'content-type': 'application/x-www-form-urlencoded',
                    cookie: 'myoc_session=session-token',
                },
                method: 'POST',
            },
            bindings,
        )

        expect(malformedResponse.status).toBe(200)
        expect(await malformedResponse.text()).toContain('Toyhou.se data was not in the expected format')
        expect(oversizedResponse.status).toBe(200)
        expect(await oversizedResponse.text()).toContain('Toyhou.se returned too much data')
    })

    it('rejects a Toyhou.se payload verified for another account', async () => {
        const payload = createToyhouseSelectionTestPayload()
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify({...payload, myocUserId: 'other-user'}))
        const response = await app.request(
            'https://example.com/migrate/import',
            {body: form, headers: {cookie: 'myoc_session=session-token'}, method: 'POST'},
            {
                CACHE: createMockKVNamespace(),
                DB: await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )

        expect(response.status).toBe(200)
        expect(await response.text()).toContain('verified for a different MyOC account')
    })

    it('omits a Toyhou.se character with an invalid ID', async () => {
        const payload = createToyhouseSelectionTestPayload()
        const form = new FormData()
        form.set(
            'toyhousePayload',
            JSON.stringify({...payload, characters: payload.characters.map((character) => ({...character, id: 'invalid'}))}),
        )
        const response = await app.request(
            'https://example.com/migrate/import',
            {body: form, headers: {cookie: 'myoc_session=session-token'}, method: 'POST'},
            {
                CACHE: createMockKVNamespace(),
                DB: await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Found 0 characters across 1 page')
        expect(html).toContain('No public characters were found for this profile')
    })

    it.each([
        {
            expected: 'Toyhou.se import selection was missing',
            includeSelection: false,
            name: 'a missing selection',
            selection: null,
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'malformed JSON',
            selection: '{bad',
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'an invalid selection shape',
            selection: {characters: {}, createdCharacters: []},
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'a duplicate character',
            selection: {
                characters: [
                    {id: '9430171', imageIndexes: [0], nsfwImageIndexes: []},
                    {id: '9430171', imageIndexes: [0], nsfwImageIndexes: []},
                ],
                createdCharacters: [],
            },
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'a created target for an unselected character',
            selection: {
                characters: [{id: '9430171', imageIndexes: [0], nsfwImageIndexes: []}],
                createdCharacters: [{id: '2222222', targetCharacterId: 'new-character'}],
            },
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'an invalid character ID',
            selection: {
                characters: [{id: 'invalid', imageIndexes: [0], nsfwImageIndexes: []}],
                createdCharacters: [],
            },
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'an invalid created target',
            selection: {
                characters: [{id: '9430171', imageIndexes: [0], nsfwImageIndexes: []}],
                createdCharacters: [{id: '9430171', targetCharacterId: 'invalid target'}],
            },
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'a non-array image selection',
            selection: {
                characters: [{id: '9430171', imageIndexes: null, nsfwImageIndexes: []}],
                createdCharacters: [],
            },
        },
        {
            expected: 'Toyhou.se import selection was invalid',
            name: 'duplicate image indexes',
            selection: {
                characters: [{id: '9430171', imageIndexes: [0, 0], nsfwImageIndexes: []}],
                createdCharacters: [],
            },
        },
    ])('rejects $name in a Toyhou.se import confirmation', async ({expected, includeSelection, selection}) => {
        const {db, html, response} = await postToyhouseSelection(selection, {includeSelection})
        const importItemCount = await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM toyhouse_import_items', [], db)

        expect(response.status).toBe(200)
        expect(html).toContain(expected)
        expect(importItemCount?.count).toBe(0)
    })

    it('requires every NSFW image to be selected for import', async () => {
        const {db, html, response} = await postToyhouseSelection({
            characters: [{id: '9430171', imageIndexes: [], nsfwImageIndexes: [0]}],
            createdCharacters: [],
        })
        const importItemCount = await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM toyhouse_import_items', [], db)

        expect(response.status).toBe(200)
        expect(html).toContain('NSFW selections must also be selected for import')
        expect(importItemCount?.count).toBe(0)
    })

    it('requires at least one selected Toyhou.se image', async () => {
        const {db, html, response} = await postToyhouseSelection({
            characters: [{id: '9430171', imageIndexes: [], nsfwImageIndexes: []}],
            createdCharacters: [],
        })
        const importItemCount = await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM toyhouse_import_items', [], db)

        expect(response.status).toBe(200)
        expect(html).toContain('Select at least one image to import')
        expect(importItemCount?.count).toBe(0)
    })

    it('rejects a missing Toyhou.se image proxy URL', async () => {
        const response = await getAppPath(
            '/migrate/toyhouse-image',
            await seedPageDatabase({currentUser: createCurrentUserRecord('demo')}),
            {
                accept: 'application/json',
                cookie: 'myoc_session=session-token',
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Toyhou.se image URL is invalid'})
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
        form.set(
            'toyhouseSelection',
            JSON.stringify({
                characters: [
                    {id: '9430171', imageIndexes: [0, 1, 2, 3], nsfwImageIndexes: []},
                    {id: '2222222', imageIndexes: [0, 1], nsfwImageIndexes: [1]},
                ],
                createdCharacters: [{id: '9430171', targetCharacterId: 'created-absinthe'}],
            }),
        )
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
            characters: [
                {id: 'created-absinthe', name: 'Absinthe'},
                {id: 'existing-brindle', name: 'brindle'},
            ],
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
        expect(html).toContain('upload each image in chunks and retry temporary failures')
        expect(html).toContain('"mediaId":null')
        expect(bucket.put).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a Toyhou.se image index that is outside the accepted source payload', async () => {
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
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171.png',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.set(
            'toyhouseSelection',
            JSON.stringify({
                characters: [{id: '9430171', imageIndexes: [1], nsfwImageIndexes: []}],
                createdCharacters: [],
            }),
        )
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
            characters: [{id: 'existing-absinthe', name: 'Absinthe'}],
        })
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {cookie: 'myoc_session=session-token'},
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()
        const importItemCount = await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM toyhouse_import_items', [], db)

        expect(response.status).toBe(200)
        expect(html).toContain('Selected Toyhou.se image is no longer available. Review the import and try again.')
        expect(importItemCount?.count).toBe(0)
    })

    it('rejects a new-character target that does not match the current MyOC character', async () => {
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
                    thumbnailUrl: 'https://f2.toyhou.se/file/f2-toyhou-se/characters/9430171.png',
                    url: 'https://toyhou.se/9430171.absinthe',
                },
            ],
        }
        const form = new FormData()
        form.set('toyhousePayload', JSON.stringify(payload))
        form.set(
            'toyhouseSelection',
            JSON.stringify({
                characters: [{id: '9430171', imageIndexes: [0], nsfwImageIndexes: []}],
                createdCharacters: [{id: '9430171', targetCharacterId: 'stale-character'}],
            }),
        )
        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
            characters: [{id: 'existing-absinthe', name: 'Absinthe'}],
        })
        const response = await app.request(
            'https://example.com/migrate/import/confirm',
            {
                body: form,
                headers: {cookie: 'myoc_session=session-token'},
                method: 'POST',
            },
            {
                CACHE: createMockKVNamespace(),
                DB: db,
                MEDIA_BUCKET: createMockR2Bucket(),
                MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
            },
        )
        const html = await response.text()
        const importItemCount = await queryOne<{count: number}>('SELECT COUNT(*) AS count FROM toyhouse_import_items', [], db)

        expect(response.status).toBe(200)
        expect(html).toContain('A selected MyOC character changed. Review the import and try again.')
        expect(importItemCount?.count).toBe(0)
    })

    it('writes and looks up large Toyhou.se import item sets in D1', async () => {
        const imageUrls = Array.from(
            {length: 501},
            (_, index) => `https://f2.toyhou.se/file/f2-toyhou-se/images/9430171_${index}_${'a'.repeat(1800)}.png`,
        )
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
        form.set(
            'toyhouseSelection',
            JSON.stringify({
                characters: [{id: '9430171', imageIndexes: imageUrls.map((_, index) => index), nsfwImageIndexes: []}],
                createdCharacters: [],
            }),
        )

        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
            characters: [{id: 'existing-absinthe', name: 'Absinthe'}],
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
        const html = await response.text()
        const storedItems = await db
            .prepare('SELECT toyhouse_image_url FROM toyhouse_import_items ORDER BY sort_order')
            .all<{toyhouse_image_url: string}>()

        expect(response.status).toBe(200)
        expect(html).toContain('Uploading Toyhou.se Images')
        expect(html).toContain(imageUrls.at(-1) as string)
        expect(storedItems.results).toHaveLength(501)
        expect(storedItems.results.at(-1)?.toyhouse_image_url).toBe(imageUrls.at(-1))
        expect(storedItems.results.every((item) => new TextEncoder().encode(item.toyhouse_image_url).byteLength < 2_000_000)).toBe(true)
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
        form.set(
            'toyhouseSelection',
            JSON.stringify({
                characters: [{id: '9430171', imageIndexes: [0, 1], nsfwImageIndexes: []}],
                createdCharacters: [],
            }),
        )

        const db = await seedPageDatabase({
            currentUser: createCurrentUserRecord('demo'),
            characters: [{id: 'existing-absinthe', name: 'Absinthe'}],
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
        const importItems = await db
            .prepare('SELECT toyhouse_image_url, status FROM toyhouse_import_items ORDER BY sort_order')
            .all<{toyhouse_image_url: string; status: string}>()

        expect(response.status).toBe(200)
        expect(html).toContain('Uploading Toyhou.se Images')
        expect(html).toContain('https://f2.toyhou.se/file/f2-toyhou-se/images/broken.png')
        expect(html).toContain('Downloading Toyhou.se image')
        expect(importItems.results).toHaveLength(2)
        expect(importItems.results.every((item) => item.status === 'pending')).toBe(true)
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/migrate')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })
})

describe('MigratePage', () => {
    it('renders import results and an empty review for a guest', () => {
        const html = MigratePage({
            currentUser: null,
            importResult: {
                createdCharacters: 1,
                importedImages: 1,
                skippedImages: 2,
                updatedCharacters: 2,
            },
            mediaBaseUrl: mediaPublicBaseUrl,
            migrationResult: {
                characters: [],
                folderUrl: 'https://toyhou.se/demo/characters/folder:all',
                myocUserId: '',
                pagesFetched: 1,
                profileUrl: 'https://toyhou.se/demo',
            },
            showSetupForm: false,
            siteUrl: 'https://example.com',
        }).toString()

        expect(html).toContain('Sign in')
        expect(html).not.toContain('Verify Toyhou.se Ownership')
        expect(html).toContain('Import complete')
        expect(html).toContain('Created 1 character, updated 2 existing characters, and imported 1 image.')
        expect(html).toContain('2 images could not be imported')
        expect(html).toContain('No public characters were found for this profile')
    })

    it('uses safe defaults for optional Toyhou.se character review data', () => {
        const csrfAttack = '</script><script data-migrate-xss>globalThis.migrateXss = true</script>'
        const html = MigratePage({
            currentUser: {
                bio: '',
                csrfToken: csrfAttack,
                displayNsfwMedia: false,
                showUnapprovedMedia: true,
                email: 'demo@example.test',
                id: 'current-user',
                lastSeenVersion: null,
                profilePhotoKey: null,
                role: 'user',
                username: 'demo',
            },
            importResult: {
                createdCharacters: 0,
                importedImages: 0,
                skippedImages: 0,
                updatedCharacters: 0,
            },
            mediaBaseUrl: mediaPublicBaseUrl,
            migrationPayload: '{}',
            migrationResult: {
                characters: [
                    {
                        id: '9430171',
                        imageCount: null,
                        images: [],
                        name: 'Absinthe',
                        thumbnailUrl: null,
                        url: 'https://toyhou.se/9430171.absinthe',
                    },
                ],
                folderUrl: 'https://toyhou.se/demo/characters/folder:all',
                myocUserId: 'current-user',
                pagesFetched: 1,
                profileUrl: 'https://toyhou.se/demo',
            },
            showSetupForm: false,
            siteUrl: 'https://example.com',
        }).toString()
        const reviewHtml = html.slice(html.indexOf('data-toyhouse-import-review'))

        expect(html).toContain('Create new character')
        expect(html).toContain('0 images found')
        expect(html).not.toContain('(null listed)')
        expect(reviewHtml).toContain(
            'const csrfToken = "\\u003c/script\\u003e\\u003cscript data-migrate-xss\\u003eglobalThis.migrateXss = true\\u003c/script\\u003e"',
        )
        expect(reviewHtml).not.toContain(csrfAttack)
    })
})

describe('CharacterPage', () => {
    it('renders a default gallery and omits stored media that has no usable image', () => {
        const html = CharacterPage({
            character: {
                description: '',
                hasHeightChart: false,
                id: 'character-1',
                name: 'RAZETH',
                profileImageKey: 'character-profile-key',
                userId: 'profile-user',
            },
            currentUser: null,
            galleryTabs: [],
            media: [
                {
                    id: 'empty-media',
                    nsfwArtist: '',
                    nsfwBlurImageKey: null,
                    nsfwBlurContentType: 'image/webp',
                    nsfwContentType: null,
                    nsfwHeight: null,
                    nsfwImageKey: null,
                    nsfwPreviewHeight: null,
                    nsfwPreviewImageKey: null,
                    nsfwPreviewContentType: 'image/webp',
                    nsfwPreviewWidth: null,
                    nsfwWidth: null,
                    sfwArtist: '',
                    sfwContentType: null,
                    sfwHeight: null,
                    sfwImageKey: null,
                    sfwPreviewHeight: null,
                    sfwPreviewImageKey: null,
                    sfwPreviewContentType: 'image/webp',
                    sfwPreviewWidth: null,
                    sfwWidth: null,
                },
            ],
            mediaBaseUrl: mediaPublicBaseUrl,
            metaDescriptionFallback: 'An original-character gallery.',
            profileUser: {
                bio: '',
                id: 'profile-user',
                profilePhotoKey: null,
                username: 'demo',
            },
            siteUrl: 'https://example.com',
        }).toString()

        expect(html).toContain('id="gallery-heading"')
        expect(html).not.toContain('/media/empty-media/')
    })

    it('uses safe fallbacks for an NSFW-only image with missing metadata', () => {
        const props: Parameters<typeof CharacterPage>[0] = {
            character: {
                description: '',
                hasHeightChart: false,
                id: 'character-1',
                name: 'RAZETH',
                profileImageKey: 'character-profile-key',
                userId: 'profile-user',
            },
            galleryTabs: [],
            media: [
                {
                    id: 'nsfw-without-metadata',
                    nsfwArtist: '',
                    nsfwBlurImageKey: null,
                    nsfwBlurContentType: 'image/webp',
                    nsfwContentType: 'image/png',
                    nsfwHeight: 0,
                    nsfwImageKey: 'nsfw-key',
                    nsfwPreviewHeight: 0,
                    nsfwPreviewImageKey: null,
                    nsfwPreviewContentType: 'image/webp',
                    nsfwPreviewWidth: 0,
                    nsfwWidth: 0,
                    sfwArtist: '',
                    sfwContentType: null,
                    sfwHeight: null,
                    sfwImageKey: null,
                    sfwPreviewHeight: null,
                    sfwPreviewImageKey: null,
                    sfwPreviewContentType: 'image/webp',
                    sfwPreviewWidth: null,
                    sfwWidth: null,
                },
            ],
            mediaBaseUrl: mediaPublicBaseUrl,
            metaDescriptionFallback: 'An original-character gallery.',
            profileUser: {
                bio: '',
                id: 'profile-user',
                profilePhotoKey: null,
                username: 'demo',
            },
            siteUrl: 'https://example.com',
        }
        const guestHtml = CharacterPage({...props, currentUser: null}).toString()
        const ownerHtml = CharacterPage({
            ...props,
            currentUser: {
                bio: '',
                csrfToken: 'csrf-token',
                displayNsfwMedia: true,
                showUnapprovedMedia: true,
                email: 'demo@example.test',
                id: 'profile-user',
                lastSeenVersion: null,
                profilePhotoKey: null,
                role: 'user',
                username: 'demo',
            },
        }).toString()

        expect(guestHtml).toContain('Character media by an unknown artist')
        expect(guestHtml).toContain('src="data:image/svg+xml,')
        expect(guestHtml).toContain('<span>18+</span>')
        expect(guestHtml).not.toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-without-metadata/nsfw/nsfw-key.png"',
        )
        expect(guestHtml).not.toContain('NaN')
        expect(guestHtml).not.toContain('Infinity')
        expect(ownerHtml).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-without-metadata/nsfw/nsfw-key.png"',
        )
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
            await seedPageDatabase({
                searchCharacters,
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
        expect(body.items).toHaveLength(1)
        expect(body.total).toBe(9)
        expect(body.nextOffset).toBeNull()
        expect(body.hasMore).toBe(false)
    })

    it('rejects unknown search result types', async () => {
        const response = await getAppPath('/api/search?type=folders&q=raz', await seedPageDatabase(), {
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
            await seedPageDatabase({
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
                    {
                        id: 'media-2',
                        sfw_image_key: 'imported-image-key',
                        nsfw_image_key: null,
                        sfw_artist: 'Imported Artist',
                        nsfw_artist: '',
                        sfw_width: 800,
                        sfw_height: 600,
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
        expect(html).toContain('"mediaIds":["media-2"]')
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
        expect(html).toContain('const galleryChunkSize = 5242880;')
        expect(html).toContain('function uploadChunkWithXhr')
        expect(html).toContain('xhr.timeout = 120000')
        expect(html).toContain('xhr.upload.onprogress')
        expect(html).toContain('Chunk upload network failure')
        expect(html).toContain('[1500, 5000, 10000]')
        expectPatternAllowsReportedCharacterNames(html, 'character-name')
    })

    it('renders the height chart editor with saved chart data', async () => {
        const response = await getAppPath(
            '/edit/character-1/height-chart',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
                characterSettings: {
                    id: 'character-1',
                    user_id: 'current-user',
                    name: 'Raz "Lux"',
                    height_chart_json: JSON.stringify({
                        version: 1,
                        height: {
                            meters: 1.8288,
                        },
                        image: {
                            key: 'height-key',
                            contentType: 'image/png',
                            naturalWidth: 320,
                            naturalHeight: 640,
                        },
                        calibration: {
                            headYPercent: 4.5,
                            footYPercent: 118,
                            footIsVirtual: true,
                            nameTagXPercent: 52,
                        },
                    }),
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('Height Chart Editor')
        expect(html).toContain('Raz &quot;Lux&quot;')
        expect(html).toContain('href="/edit/character-1"')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-1/height-chart/height-key.png')
        expect(html).toContain('Raz \\"Lux\\"')
        expect(html).toContain('"footIsVirtual":true')
    })

    it('renders saved height chart data without an image', async () => {
        const response = await getAppPath(
            '/edit/character-1/height-chart',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
                characterSettings: {
                    height_chart_json: JSON.stringify({
                        calibration: {footIsVirtual: false, footYPercent: 95, headYPercent: 5},
                        height: {meters: 1.7},
                        image: null,
                        version: 1,
                    }),
                    id: 'character-1',
                    name: 'RAZETH',
                    user_id: 'current-user',
                },
            }),
            {cookie: 'myoc_session=session-token'},
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).not.toContain('/height-chart/height-key')
    })

    it('renders the height chart editor without saved chart data', async () => {
        const response = await getAppPath(
            '/edit/character-1/height-chart',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
                characterSettings: {
                    id: 'character-1',
                    user_id: 'current-user',
                    name: 'RAZETH',
                    height_chart_json: null,
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('No height data')
        expect(html).toContain('const character = {"id":"character-1","userId":"current-user","name":"RAZETH","heightChart":null};')
    })

    it('redirects logged-out users to login', async () => {
        const response = await getAppPath('/edit/character-1')

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/login')
    })

    it('does not expose the character settings page under the old characters path', async () => {
        const response = await getAppPath(
            '/characters/5f42998f-e37b-4135-9760-c2768ade86e1',
            await seedPageDatabase({
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
            await seedPageDatabase({
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

    it('renders sorted folders, folder images, and sorted characters', async () => {
        const response = await getAppPath(
            '/characters',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('demo'),
                uploadedImageCount: 1,
                folders: [
                    {
                        id: 'folder-beta',
                        name: 'Beta Folder',
                        parent_folder_id: null,
                        folder_image_key: null,
                        sort_order: 0,
                    },
                    {
                        id: 'folder-alpha',
                        name: 'Alpha Folder',
                        parent_folder_id: null,
                        folder_image_key: 'folder-alpha-image',
                        sort_order: 0,
                    },
                    {
                        id: 'folder-child',
                        name: 'Child Folder',
                        parent_folder_id: 'folder-beta',
                        folder_image_key: null,
                        sort_order: 0,
                    },
                ],
                characters: [
                    {
                        id: 'character-zed',
                        name: 'Zed',
                        profile_image_key: 'zed-profile',
                        folder_id: null,
                        sort_order: 0,
                    },
                    {
                        id: 'character-alpha',
                        name: 'Alpha',
                        profile_image_key: 'alpha-profile',
                        folder_id: 'folder-alpha',
                        sort_order: 0,
                    },
                ],
                placements: [
                    {
                        folder_id: 'folder-alpha',
                        character_id: 'character-alpha',
                        sort_order: 0,
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('1 image')
        expect(html).toContain('Alpha Folder')
        expect(html).toContain('Beta Folder')
        expect(html).toContain('Alpha')
        expect(html).toContain('Zed')
        expect(html).toContain('Child Folder')
        expect(html).not.toContain('No folders yet.')
        expect(html).toContain('https://m.myoc.art/characters/current-user/folders/folder-alpha/image/folder-alpha-image.webp')
        expect(html).toContain('https://m.myoc.art/characters/current-user/character-alpha/profile/alpha-profile.webp')
        expect(html).toContain('"folderId":"folder-alpha","characterId":"character-alpha","sortOrder":0')
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
        expect(html).toContain('href="/admin/image-approval-log"')
        expect(html).toContain('Image Approval Log')
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

    it('renders only image approvals navigation for moderator users', async () => {
        const response = await getAppPath(
            '/admin/image-approvals',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('mod_user', {
                    role: 'moderator',
                }),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Image Approvals | Admin | MyOC</title>')
        expect(html).toContain('href="/admin"')
        expect(html).toContain('href="/admin/image-approvals"')
        expect(html).toContain('Image Approvals')
        expect(html).not.toContain('href="/admin/moderate-images"')
        expect(html).not.toContain('href="/admin/image-approval-log"')
        expect(html).not.toContain('href="/admin/moderate-characters"')
        expect(html).not.toContain('href="/admin/moderate-users"')
        expect(html).not.toContain('href="/admin/reports"')
        expect(html).not.toContain('href="/admin/admin-options"')
    })

    it('returns not found for moderator users on other admin sections', async () => {
        const response = await getAppPath(
            '/admin/reports',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('mod_user', {
                    role: 'moderator',
                }),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).not.toContain('Reports | Admin | MyOC')
    })

    it('renders admin section routes with the matching section active', async () => {
        const response = await getAppPath(
            '/admin/moderate-users',
            await seedPageDatabase({
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
            await seedPageDatabase({
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
        expect(html).toMatch(/&quot;leaseExpiresAt&quot;:&quot;[^&]+&quot;/)
        expect(html).toContain('&quot;profileUrl&quot;:&quot;/u/uploader&quot;')
        expect(html).toContain('&quot;url&quot;:&quot;/u/uploader/Quartz&quot;')
        expect(html).toContain('grid h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden')
        expect(html).toContain('flex h-full min-h-0 min-w-0 flex-col overflow-hidden')
        expect(html).toContain('<kbd class="kbd kbd-xs">A</kbd>')
        expect(html).toContain('<kbd class="kbd kbd-xs">Enter</kbd>')
        expect(html).toContain('admin-approval-image-grid')
        expect(html).toContain('admin-approval-media-frame')
        expect(html).toContain('<script src="/admin-image-approvals.js"')
        expect(html).not.toContain('tooltip')
        expect(html).not.toContain('data-approval-sidebar')
    })

    it('renders image approval audit logs for admin users', async () => {
        const response = await getAppPath(
            '/admin/image-approval-log',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                imageApprovalHistory: [
                    {
                        id: 'event-1',
                        media_id: 'media-1',
                        image_rating: 'sfw',
                        action: 'approve_sfw_no_homepage',
                        homepage_allowed: 0,
                        moderator_username: 'admin_user',
                        owner_username: 'uploader',
                        character_name: 'Quartz',
                        created_at: '2026-06-11 12:00:00',
                    },
                ],
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<title>Image Approval Log | Admin | MyOC</title>')
        expect(html).toContain('Image Approval Log')
        expect(html).toContain('Approve Sfw No Homepage')
        expect(html).toContain('@admin_user')
        expect(html).toContain('@uploader')
        expect(html).toContain('Quartz')
    })

    it('returns not found for moderators on the image approval audit log', async () => {
        const response = await getAppPath(
            '/admin/image-approval-log',
            await seedPageDatabase({
                currentUser: createCurrentUserRecord('mod_user', {
                    role: 'moderator',
                }),
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).not.toContain('Image Approval Log | Admin | MyOC')
    })

    it('renders reported images on the reports page', async () => {
        const response = await getAppPath(
            '/admin/reports',
            await seedPageDatabase({
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

    it('renders report empty state and full-image fallback reports', async () => {
        const emptyResponse = await getAppPath(
            '/admin/reports',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const emptyHtml = await emptyResponse.text()

        expect(emptyResponse.status).toBe(200)
        expect(emptyHtml).toContain('No reports')

        const response = await getAppPath(
            '/admin/reports',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                adminReports: [
                    {
                        id: 'media-2',
                        user_id: 'owner-2',
                        username: 'uploader',
                        character_id: 'character-2',
                        character_name: 'Quartz',
                        sfw_image_key: null,
                        nsfw_image_key: 'nsfw-key',
                        sfw_preview_image_key: null,
                        nsfw_preview_image_key: null,
                        sfw_content_type: null,
                        nsfw_content_type: 'image/gif',
                        sfw_review_status: 'pending',
                        nsfw_review_status: 'reported',
                        sfw_reviewed_at: null,
                        nsfw_reviewed_at: '2026-06-11 12:00:00',
                        sfw_reported_by_username: null,
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
        expect(html).toContain('NSFW image report')
        expect(html).toContain('Reported by an admin in Image Approvals.')
        expect(html).toContain('src="https://m.myoc.art/characters/owner-2/character-2/media/media-2/nsfw/nsfw-key.gif"')
    })

    it('renders admin options with job controls and history', async () => {
        const response = await getAppPath(
            '/admin/admin-options?status=started&job=d1-backup',
            await seedPageDatabase({
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
        expect(html).toContain('action="/admin/admin-options/jobs/d1-backup/run"')
        expect(html).toContain('Run D1 Database Backup')
        expect(html).toContain('action="/admin/admin-options/jobs/r2-media-cleanup/run"')
        expect(html).toContain('Run R2 Media Cleanup')
        expect(html).toContain('action="/admin/admin-options/jobs/leaderboard-refresh/run"')
        expect(html).toContain('Run Leaderboard Refresh')
        expect(html).toContain('Job History')
        expect(html).toContain('Cron 0 8 * * *')
        expect(html).toContain('d1/myoc-db/2026/07/11/myoc-db.sql.gz')
        expect(html).toContain('42 rows')
        expect(html).toContain('2.0 KB')
    })

    it('renders admin options success and error feedback states', async () => {
        const successResponse = await getAppPath(
            '/admin/admin-options?status=success&job=r2-media-cleanup',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const successHtml = await successResponse.text()

        expect(successResponse.status).toBe(200)
        expect(successHtml).toContain('R2 Media Cleanup finished.')

        const errorResponse = await getAppPath(
            '/admin/admin-options?status=error&job=unknown-job',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
            }),
            {
                cookie: 'myoc_session=session-token',
            },
        )
        const errorHtml = await errorResponse.text()

        expect(errorResponse.status).toBe(200)
        expect(errorHtml).toContain('Admin job failed. Check Job History for details.')
        expect(errorHtml).toContain('No job runs')
    })

    it('renders admin job run status, source, duration, and summary variants', async () => {
        const response = await getAppPath(
            '/admin/admin-options',
            await seedPageDatabase({
                currentUser: {
                    ...createCurrentUserRecord('admin_user'),
                    role: 'admin',
                },
                adminJobRuns: [
                    {
                        id: 'run-running',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'manual',
                        triggered_by_user_id: 'admin-user',
                        triggered_by_username: 'admin_user',
                        cron: null,
                        status: 'running',
                        started_at: '2026-07-11 09:00:00',
                        finished_at: null,
                        duration_ms: null,
                        summary_json: null,
                        error_message: null,
                    },
                    {
                        id: 'run-error',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'manual',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'error',
                        started_at: '2026-07-11 09:01:00',
                        finished_at: '2026-07-11 09:01:00',
                        duration_ms: 125,
                        summary_json: null,
                        error_message: 'cleanup failed',
                    },
                    {
                        id: 'run-r2-limit',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:02:00',
                        finished_at: '2026-07-11 09:02:01',
                        duration_ms: 1000,
                        summary_json: JSON.stringify({
                            deleted: 2,
                            errors: 1,
                            keptReferenced: 7,
                            recognized: 10,
                            scanned: 10,
                            skippedRecent: 0,
                            skippedUnknown: 0,
                            stoppedAtDeleteLimit: true,
                            stoppedAtScanLimit: true,
                        }),
                        error_message: null,
                    },
                    {
                        id: 'run-r2-complete',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:02:01',
                        finished_at: '2026-07-11 09:02:02',
                        duration_ms: 1000,
                        summary_json: JSON.stringify({
                            deleted: 0,
                            errors: 0,
                            keptReferenced: 2,
                            recognized: 2,
                            scanned: 2,
                            skippedRecent: 0,
                            skippedUnknown: 0,
                            stoppedAtDeleteLimit: false,
                            stoppedAtScanLimit: false,
                        }),
                        error_message: null,
                    },
                    {
                        id: 'run-d1-json',
                        job_name: 'd1-backup',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:03:00',
                        finished_at: '2026-07-11 09:03:02',
                        duration_ms: 2048,
                        summary_json: JSON.stringify({note: 'missing key'}),
                        error_message: null,
                    },
                    {
                        id: 'run-leaderboard',
                        job_name: 'leaderboard-refresh',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:04:00',
                        finished_at: '2026-07-11 09:04:02',
                        duration_ms: 2048,
                        summary_json: JSON.stringify({
                            generatedAt: '2026-07-11T10:00:00.000Z',
                            key: LEADERBOARD_CACHE_KEY,
                            rankedCharactersByData: 3,
                            rankedTopUsers: 3,
                            rankedUsersByCharacters: 3,
                            rankedUsersByData: 3,
                            rankedUsersByImages: 3,
                            recognizedObjects: 8,
                            scannedObjects: 8,
                            skippedUnknownObjects: 0,
                            totalManagedBytes: 4096,
                            totalMonthlyStorageCostUsd: 0.000000057,
                        }),
                        error_message: null,
                    },
                    {
                        id: 'run-r2-json',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'manual',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:04:00',
                        finished_at: '2026-07-11 09:04:02',
                        duration_ms: 2048,
                        summary_json: JSON.stringify({note: 'custom summary'}),
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
        expect(html).toContain('@admin_user')
        expect(html).toContain('Manual')
        expect(html).toContain('Cron')
        expect(html).toContain('badge-info')
        expect(html).toContain('badge-error')
        expect(html).toContain('Pending')
        expect(html).toContain('cleanup failed')
        expect(html).toContain('125 ms')
        expect(html).toContain('1.0 s')
        expect(html).toContain('10 scanned')
        expect(html).toContain('2 deleted')
        expect(html).toContain('1 errors')
        expect(html).toContain('delete limit reached')
        expect(html).toContain('scan limit reached')
        expect(html).toContain('missing key')
        expect(html).toContain('8 objects')
        expect(html).toContain('4.0 KB')
        expect(html).toContain('$0.0000/mo')
        expect(html).toContain('3 users ranked')
        expect(html).toContain('3 characters ranked')
        expect(html).toContain('custom summary')
    })

    it('returns not found for unknown admin sections', async () => {
        const response = await getAppPath(
            '/admin/unknown-section',
            await seedPageDatabase({
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
    it('keeps a hostile character description inside structured data', async () => {
        const attack = '</script><script data-json-ld-xss>globalThis.jsonLdXss = true</script>'
        const response = await getProfilePath(
            '/u/demo/RAZETH',
            await seedPageDatabase({
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
                    description: attack,
                },
            }),
        )
        const html = await response.text()
        const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []

        expect(response.status).toBe(200)
        expect(scriptTags.some((tag) => tag.includes('data-json-ld-xss'))).toBe(false)
        expect(html).not.toContain('<script data-json-ld-xss>')
        expect(html).toContain('\\u003c/script\\u003e\\u003cscript data-json-ld-xss\\u003e')
        expect(html).toContain(
            '<meta content="https://m.myoc.art/characters/profile-user/character-1/profile/character-profile-key.webp" property="og:image"/>',
        )
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).not.toContain('<meta content="data:image/svg+xml')
    })

    it('renders a public character page with safe gallery media by default', async () => {
        const response = await getProfilePath(
            '/u/demo/RAZETH',
            await seedPageDatabase({
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
                        nsfw_blur_content_type: 'image/avif',
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
            'data-original-url="https://m.myoc.art/characters/profile-user/character-1/media/sfw-media/sfw/sfw-only-key.png"',
        )
        expect(html).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/preview/both-sfw-preview-key.webp"',
        )
        expect(html).toContain(
            'data-original-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).toContain('loading="lazy"')
        expect(html).toContain('decoding="async"')
        expect(html).toContain('id="gallery-heading"')
        expect(html).toContain('role="tablist"')
        expect(html).toContain('Load 18+ media')
        expect(html).toContain('data-display-nsfw-media="false"')
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-preview-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/preview/both-nsfw-preview-key.webp"',
        )
        expect(html).toContain('data-nsfw-title="Both NSFW Artist"')
        expect(html).toContain(
            'data-safe-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).toContain('data-title="SFW Artist"')
        expect(html).toContain('data-title="Both SFW Artist"')
        expect(html).toContain(
            'src="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/blur/nsfw-only-blur-key.avif"',
        )
        expect(html).not.toContain(
            'data-original-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
        expect(html).toContain(
            'data-nsfw-preview-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/preview/nsfw-only-preview-key.webp"',
        )
        expect(html).toContain('<span>18+</span>')
        expect(html).toContain('data-nsfw-hidden="true"')
        expect(html).toContain('width="640"')
        expect(html).toContain('height="480"')
        expect(html).toContain('--media-width:640;--media-height:480')
        expect(html).toContain('value="default"')
        expect(html).not.toContain('value="tab-default"')
        expect(html).toContain('references')
    })

    it('uses the stored height-chart presence flag on a character page', async () => {
        const db = await seedPageDatabase({
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
                has_height_chart: 1,
                height_chart_json: 'not-read-by-this-page',
            },
        })
        const response = await getProfilePath('/u/demo/RAZETH', db)
        const html = await response.text()
        expect(response.status).toBe(200)
        expect(html).toContain('View in Size Chart')
    })

    it('redirects profile URLs to the stored username casing', async () => {
        const response = await getProfilePath(
            '/u/DEMO?tab=characters',
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            'data-original-url="https://m.myoc.art/characters/profile-user/character-1/media/nsfw-media/nsfw/nsfw-only-key.png"',
        )
    })

    it('keeps NSFW-only gallery media visible with a local placeholder when no blur variant exists', async () => {
        const response = await getAppPath(
            '/u/demo/RAZETH',
            await seedPageDatabase({
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
        expect(html).toContain('class="gallery-media image-loading rounded nsfw-media"')
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            await seedPageDatabase({
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
            'data-deferred-original-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/nsfw/both-nsfw-key.png"',
        )
        expect(html).toContain(
            'data-safe-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
        expect(html).not.toContain(
            'data-deferred-src="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/preview/both-sfw-preview-key.webp"',
        )
        expect(html).not.toContain(
            'data-deferred-original-url="https://m.myoc.art/characters/profile-user/character-1/media/both-media/sfw/both-sfw-key.png"',
        )
    })

    it('renders a profile from live user, social link, folder, and character data', async () => {
        const db = await seedPageDatabase({
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

    it('keeps a hostile profile bio inside structured data', async () => {
        const attack = '</script><script data-json-ld-xss>globalThis.jsonLdXss = true</script>'
        const response = await getProfile(
            'demo',
            await seedPageDatabase({
                profileUser: {
                    id: 'profile-user',
                    username: 'demo',
                    profile_photo_key: null,
                    bio: attack,
                },
            }),
        )
        const html = await response.text()
        const scriptTags = html.match(/<script\b[^>]*>/gi) ?? []

        expect(response.status).toBe(200)
        expect(scriptTags.some((tag) => tag.includes('data-json-ld-xss'))).toBe(false)
        expect(html).not.toContain('<script data-json-ld-xss>')
        expect(html).toContain('\\u003c/script\\u003e\\u003cscript data-json-ld-xss\\u003e')
    })

    it('uses a fetchable social image when the profile has no uploaded photo', async () => {
        const response = await getProfile(
            'demo',
            await seedPageDatabase({
                profileUser: {
                    id: 'profile-user',
                    username: 'demo',
                    profile_photo_key: null,
                    bio: '',
                },
            }),
        )
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<meta content="https://example.com/assets/myocbanner.webp" property="og:image"/>')
        expect(html).toContain('<meta content="1200" property="og:image:width"/>')
        expect(html).toContain('<meta content="630" property="og:image:height"/>')
        expect(html).toContain('<meta content="image/webp" property="og:image:type"/>')
        expect(html).toContain('<meta content="summary_large_image" name="twitter:card"/>')
        expect(html).toContain('<meta content="https://example.com/assets/myocbanner.webp" name="twitter:image"/>')
        expect(html).toContain('"image":"https://example.com/assets/myocbanner.webp"')
        expect(html).toContain('"mainEntity":{"@type":"Person","name":"demo","url":"https://example.com/u/demo"}')
        expect(html).not.toContain('<meta content="data:image/svg+xml')
        expect(html).not.toContain('"image":"data:image/svg+xml')
        expect(html).toContain('src="data:image/svg+xml;charset=utf-8,')
    })

    it('renders a folder page from folder name path segments', async () => {
        const db = await seedPageDatabase({
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
        const response = await getProfile('missing', await seedPageDatabase())
        const html = await response.text()

        expect(response.status).toBe(404)
        expect(html).toContain('404')
        expect(html).toContain('That profile does not exist or is no longer available.')
    })

    it('returns 404 when a folder path does not exist', async () => {
        const response = await getProfilePath(
            '/u/demo/Missing%20Folder',
            await seedPageDatabase({
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
        const response = await getProfilePath('/users/demo', await seedPageDatabase())

        expect(response.status).toBe(301)
        expect(response.headers.get('location')).toBe('/u/demo')
    })

    it('redirects the old profile route to the user route', async () => {
        const response = await getProfilePath('/profile/demo/Main%20Characters', await seedPageDatabase())

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
        const response = await getAppPath('/api/missing', await seedPageDatabase(), {
            accept: 'application/json',
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Not found',
        })
    })
})
