import {applyD1Migrations, type D1Migration, reset} from 'cloudflare:test'
import {env} from 'cloudflare:workers'
import {beforeAll, beforeEach} from 'vitest'

type TestEnvironment = typeof env & {
    TEST_MIGRATIONS: D1Migration[]
}

type UserSeed = {
    id: string
    email?: string
    username?: string
    passwordHash?: string
    profilePhotoKey?: string | null
    bio?: string
    displayNsfwMedia?: boolean
    showUnapprovedMedia?: boolean
    role?: 'user' | 'moderator' | 'admin'
    createdAt?: string
    lastSeenVersion?: string | null
    bannedAt?: string | null
    bannedByUserId?: string | null
    webauthnUserId?: string | null
    recoveryPhraseHash?: string | null
    recoveryPhraseSetAt?: string | null
    recoveryPhraseConfirmedAt?: string | null
    secureAccountRequired?: boolean
    secureAccountRequiredAt?: string | null
    secureAccountRequiredPasskeyId?: string | null
    passkeyPromptSeenAt?: string | null
}

type SessionSeed = {
    id?: string
    userId: string
    token: string
    createdAt?: string
    expiresAt?: string
}

type FolderSeed = {
    id: string
    userId: string
    name?: string
    parentFolderId?: string | null
    sortOrder?: number
    folderImageKey?: string | null
    createdAt?: string
    updatedAt?: string
}

type CharacterSeed = {
    id: string
    userId: string
    sizeChartId?: Uint8Array
    name?: string
    profileImageKey?: string
    folderId?: string | null
    sortOrder?: number
    description?: string
    heightChartJson?: string
    createdAt?: string
    updatedAt?: string
}

type MediaSeed = {
    id: string
    userId: string
    characterId: string
    sfwImageKey?: string | null
    nsfwImageKey?: string | null
    sfwArtist?: string
    nsfwArtist?: string
    sfwWidth?: number | null
    sfwHeight?: number | null
    sfwByteSize?: number | null
    nsfwWidth?: number | null
    nsfwHeight?: number | null
    nsfwByteSize?: number | null
    sfwReviewStatus?: 'pending' | 'approved' | 'reported'
    sfwReviewedAt?: string | null
    sfwApprovedAt?: string | null
    sfwHomepageAllowed?: boolean
    nsfwReviewStatus?: 'pending' | 'approved' | 'reported'
    nsfwReviewedAt?: string | null
    nsfwApprovedAt?: string | null
    sfwContentType?: string | null
    nsfwContentType?: string | null
    sfwPreviewImageKey?: string | null
    sfwPreviewContentType?: 'image/webp' | 'image/avif'
    sfwPreviewWidth?: number | null
    sfwPreviewHeight?: number | null
    sfwPreviewByteSize?: number | null
    nsfwPreviewImageKey?: string | null
    nsfwPreviewContentType?: 'image/webp' | 'image/avif'
    nsfwPreviewWidth?: number | null
    nsfwPreviewHeight?: number | null
    nsfwPreviewByteSize?: number | null
    nsfwBlurImageKey?: string | null
    createdAt?: string
    updatedAt?: string
}

type PasskeySeed = {
    id: string
    userId: string
    credentialId?: string
    publicKey?: string
    webauthnUserId?: string
    counter?: number
    deviceType?: string
    backedUp?: boolean
    transports?: string | null
    name?: string | null
    createdAt?: string
    lastUsedAt?: string | null
}

type ChallengeSeed = {
    id: string
    userId?: string | null
    email?: string | null
    username?: string | null
    webauthnUserId?: string | null
    ceremony: 'registration' | 'authentication'
    challenge?: string
    expiresAt?: string
    createdAt?: string
}

const TEST_DATA_TABLES = [
    'character_gallery_row_media',
    'character_gallery_rows',
    'character_gallery_tabs',
    'character_media_review_events',
    'admin_image_review_queue',
    'toyhouse_import_items',
    'toyhouse_import_jobs',
    'character_folder_placements',
    'user_social_links',
    'sessions',
    'user_passkeys',
    'webauthn_challenges',
    'character_media',
    'recent_feed_dirty_hours',
    'recent_feed_generations',
    'recent_feed_revocations',
    'characters',
    'character_folders',
    'admin_job_runs',
    'users',
] as const

const DEFAULT_TIMESTAMP = '2026-01-01 00:00:00'
const DEFAULT_FUTURE_TIMESTAMP = '2099-01-01 00:00:00'

const testDb = env.DB

export function useTestDatabase(): D1Database {
    beforeAll(async () => {
        await applyD1Migrations(testDb, (env as TestEnvironment).TEST_MIGRATIONS)
    })

    beforeEach(async () => {
        await clearTestDatabase(testDb)
    })

    return testDb
}

export function useResetTestDatabase(): D1Database {
    beforeEach(resetTestDatabase)
    return testDb
}

async function resetTestDatabase(): Promise<void> {
    await reset()
    await applyD1Migrations(testDb, (env as TestEnvironment).TEST_MIGRATIONS)
}

async function clearTestDatabase(db: D1Database = testDb): Promise<void> {
    await db.batch(
        TEST_DATA_TABLES.map((table) =>
            // nosemgrep: myoc.sql.no-delete-without-where -- This helper clears the isolated test database before each test.
            db.prepare(`DELETE FROM ${table}`),
        ),
    )
    await db
        .prepare(
            `UPDATE recent_feed_state
             SET requested_revision = 1,
                 published_revision = 0,
                 generation = NULL,
                 root_key = NULL,
                 published_at = NULL,
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 bootstrap_revision = NULL,
                 bootstrap_cursor_created_at = NULL,
                 bootstrap_cursor_id = NULL,
                 bootstrap_variant_roots_json = NULL,
                 bootstrap_active_key = NULL,
                 bootstrap_objects_written = 0,
                 bootstrap_bytes_written = 0,
                 bootstrap_started_at = NULL,
                 last_error = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE singleton = 1`,
        )
        .run()
    await db
        .prepare(
            `INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent)
             VALUES ('*', 1, 'initial-build', 1)`,
        )
        .run()
}

export async function seedUser(seed: UserSeed, db: D1Database = testDb): Promise<void> {
    const {
        id,
        email = `${id}@example.test`,
        username = validUsername(id),
        passwordHash = 'test-password-hash',
        profilePhotoKey = null,
        bio = '',
        displayNsfwMedia = false,
        showUnapprovedMedia = true,
        role = 'user',
        createdAt = DEFAULT_TIMESTAMP,
        lastSeenVersion = null,
        bannedAt = null,
        bannedByUserId = null,
        webauthnUserId = null,
        recoveryPhraseHash = null,
        recoveryPhraseSetAt = null,
        recoveryPhraseConfirmedAt = null,
        secureAccountRequired = false,
        secureAccountRequiredAt = null,
        secureAccountRequiredPasskeyId = null,
        passkeyPromptSeenAt = null,
    } = seed
    await db
        .prepare(
            `INSERT INTO users (
                id,
                email,
                username,
                password_hash,
                profile_photo_key,
                bio,
                display_nsfw_media,
                show_unapproved_media,
                role,
                created_at,
                last_seen_version,
                banned_at,
                banned_by_user_id,
                webauthn_user_id,
                recovery_phrase_hash,
                recovery_phrase_set_at,
                recovery_phrase_confirmed_at,
                secure_account_required,
                secure_account_required_at,
                secure_account_required_passkey_id,
                passkey_prompt_seen_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            email,
            username,
            passwordHash,
            profilePhotoKey,
            bio,
            Number(displayNsfwMedia),
            Number(showUnapprovedMedia),
            role,
            createdAt,
            lastSeenVersion,
            bannedAt,
            bannedByUserId,
            webauthnUserId,
            recoveryPhraseHash,
            recoveryPhraseSetAt,
            recoveryPhraseConfirmedAt,
            Number(secureAccountRequired),
            secureAccountRequiredAt,
            secureAccountRequiredPasskeyId,
            passkeyPromptSeenAt,
        )
        .run()
}

export async function seedSession(seed: SessionSeed, db: D1Database = testDb): Promise<void> {
    await db
        .prepare('INSERT INTO sessions (id, user_id, session_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(
            seed.id ?? `${seed.userId}-session`,
            seed.userId,
            await sha256Hex(seed.token),
            seed.createdAt ?? DEFAULT_TIMESTAMP,
            seed.expiresAt ?? DEFAULT_FUTURE_TIMESTAMP,
        )
        .run()
}

export async function seedAuthenticatedUser(seed: UserSeed, sessionToken = 'session-token', db: D1Database = testDb): Promise<void> {
    await seedUser(seed, db)
    await seedSession({userId: seed.id, token: sessionToken}, db)
}

export async function seedFolder(seed: FolderSeed, db: D1Database = testDb): Promise<void> {
    await db
        .prepare(
            `INSERT INTO character_folders (
                id, user_id, name, parent_folder_id, sort_order, folder_image_key, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            seed.id,
            seed.userId,
            seed.name ?? humanName(seed.id),
            seed.parentFolderId ?? null,
            seed.sortOrder ?? 0,
            seed.folderImageKey ?? null,
            seed.createdAt ?? DEFAULT_TIMESTAMP,
            seed.updatedAt ?? DEFAULT_TIMESTAMP,
        )
        .run()
}

export async function seedCharacter(seed: CharacterSeed, db: D1Database = testDb): Promise<void> {
    await db
        .prepare(
            `INSERT INTO characters (
                id,
                size_chart_id,
                user_id,
                name,
                profile_image_key,
                folder_id,
                sort_order,
                description,
                height_chart_json,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            seed.id,
            seed.sizeChartId ?? (await stableSizeChartId(seed.id)),
            seed.userId,
            seed.name ?? humanName(seed.id),
            seed.profileImageKey ?? `${seed.id}-profile`,
            seed.folderId ?? null,
            seed.sortOrder ?? 0,
            seed.description ?? '',
            seed.heightChartJson ?? '',
            seed.createdAt ?? DEFAULT_TIMESTAMP,
            seed.updatedAt ?? DEFAULT_TIMESTAMP,
        )
        .run()
}

export async function seedMedia(seed: MediaSeed, db: D1Database = testDb): Promise<void> {
    const {
        id,
        userId,
        characterId,
        sfwImageKey = `${id}-sfw`,
        nsfwImageKey = null,
        sfwArtist = '',
        nsfwArtist = '',
        sfwWidth = sfwImageKey ? 800 : null,
        sfwHeight = sfwImageKey ? 600 : null,
        sfwByteSize = sfwImageKey ? 1024 : null,
        nsfwWidth = nsfwImageKey ? 800 : null,
        nsfwHeight = nsfwImageKey ? 600 : null,
        nsfwByteSize = nsfwImageKey ? 1024 : null,
        sfwReviewStatus = 'pending',
        sfwReviewedAt = null,
        sfwApprovedAt = null,
        sfwHomepageAllowed = false,
        nsfwReviewStatus = 'pending',
        nsfwReviewedAt = null,
        nsfwApprovedAt = null,
        sfwContentType = sfwImageKey ? 'image/png' : null,
        nsfwContentType = nsfwImageKey ? 'image/png' : null,
        sfwPreviewImageKey = null,
        sfwPreviewContentType = 'image/webp',
        sfwPreviewWidth = null,
        sfwPreviewHeight = null,
        sfwPreviewByteSize = null,
        nsfwPreviewImageKey = null,
        nsfwPreviewContentType = 'image/webp',
        nsfwPreviewWidth = null,
        nsfwPreviewHeight = null,
        nsfwPreviewByteSize = null,
        nsfwBlurImageKey = null,
        createdAt = DEFAULT_TIMESTAMP,
        updatedAt = DEFAULT_TIMESTAMP,
    } = seed
    if (!sfwImageKey && !nsfwImageKey) {
        throw new Error('Test media requires an SFW or NSFW image key')
    }

    await db
        .prepare(
            `INSERT INTO character_media (
                id,
                user_id,
                character_id,
                sfw_image_key,
                nsfw_image_key,
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                nsfw_width,
                nsfw_height,
                nsfw_byte_size,
                sfw_review_status,
                sfw_reviewed_at,
                sfw_approved_at,
                sfw_homepage_allowed,
                nsfw_review_status,
                nsfw_reviewed_at,
                nsfw_approved_at,
                sfw_content_type,
                nsfw_content_type,
                sfw_preview_image_key,
                sfw_preview_content_type,
                sfw_preview_width,
                sfw_preview_height,
                sfw_preview_byte_size,
                nsfw_preview_image_key,
                nsfw_preview_content_type,
                nsfw_preview_width,
                nsfw_preview_height,
                nsfw_preview_byte_size,
                nsfw_blur_image_key,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            id,
            userId,
            characterId,
            sfwImageKey,
            nsfwImageKey,
            sfwArtist,
            nsfwArtist,
            sfwWidth,
            sfwHeight,
            sfwByteSize,
            nsfwWidth,
            nsfwHeight,
            nsfwByteSize,
            sfwReviewStatus,
            sfwReviewedAt,
            sfwApprovedAt,
            Number(sfwHomepageAllowed),
            nsfwReviewStatus,
            nsfwReviewedAt,
            nsfwApprovedAt,
            sfwContentType,
            nsfwContentType,
            sfwPreviewImageKey,
            sfwPreviewContentType,
            sfwPreviewWidth,
            sfwPreviewHeight,
            sfwPreviewByteSize,
            nsfwPreviewImageKey,
            nsfwPreviewContentType,
            nsfwPreviewWidth,
            nsfwPreviewHeight,
            nsfwPreviewByteSize,
            nsfwBlurImageKey,
            createdAt,
            updatedAt,
        )
        .run()
}

export async function seedPasskey(seed: PasskeySeed, db: D1Database = testDb): Promise<void> {
    await db
        .prepare(
            `INSERT INTO user_passkeys (
                id,
                user_id,
                credential_id,
                public_key,
                webauthn_user_id,
                counter,
                device_type,
                backed_up,
                transports,
                name,
                created_at,
                last_used_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            seed.id,
            seed.userId,
            seed.credentialId ?? `${seed.id}-credential`,
            seed.publicKey ?? 'AQID',
            seed.webauthnUserId ?? `${seed.userId}-webauthn`,
            seed.counter ?? 0,
            seed.deviceType ?? 'singleDevice',
            Number(seed.backedUp ?? false),
            seed.transports ?? null,
            seed.name ?? null,
            seed.createdAt ?? DEFAULT_TIMESTAMP,
            seed.lastUsedAt ?? null,
        )
        .run()
}

export async function seedChallenge(seed: ChallengeSeed, db: D1Database = testDb): Promise<void> {
    await db
        .prepare(
            `INSERT INTO webauthn_challenges (
                id, user_id, email, username, webauthn_user_id, ceremony, challenge, expires_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
            seed.id,
            seed.userId ?? null,
            seed.email ?? null,
            seed.username ?? null,
            seed.webauthnUserId ?? null,
            seed.ceremony,
            seed.challenge ?? 'test-challenge',
            seed.expiresAt ?? DEFAULT_FUTURE_TIMESTAMP,
            seed.createdAt ?? DEFAULT_TIMESTAMP,
        )
        .run()
}

export async function queryOne<T extends Record<string, unknown>>(
    sql: string,
    binds: unknown[] = [],
    db: D1Database = testDb,
): Promise<T | null> {
    return await db
        .prepare(sql)
        .bind(...binds)
        .first<T>()
}

export async function queryAll<T extends Record<string, unknown>>(
    sql: string,
    binds: unknown[] = [],
    db: D1Database = testDb,
): Promise<T[]> {
    const result = await db
        .prepare(sql)
        .bind(...binds)
        .all<T>()
    return result.results
}

export async function countRows(table: (typeof TEST_DATA_TABLES)[number], db: D1Database = testDb): Promise<number> {
    const result = await queryOne<{count: number}>(`SELECT COUNT(*) AS count FROM ${table}`, [], db)
    return result?.count ?? 0
}

export async function withFailingTrigger<T>(
    input: {
        name: string
        timing?: 'BEFORE' | 'AFTER'
        operation: 'INSERT' | 'UPDATE' | 'DELETE'
        table: (typeof TEST_DATA_TABLES)[number]
        columns?: string[]
        when?: string
        message?: string
    },
    callback: () => T | Promise<T>,
    db: D1Database = testDb,
): Promise<T> {
    const triggerName = safeIdentifier(`test_${input.name}`)
    const columns = input.columns?.length ? ` OF ${input.columns.map(safeIdentifier).join(', ')}` : ''
    const when = input.when ? ` WHEN ${input.when}` : ''
    const message = (input.message ?? 'Test D1 failure').replaceAll("'", "''")
    await db.exec(
        `CREATE TRIGGER ${triggerName} ${input.timing ?? 'BEFORE'} ${input.operation}${columns} ON ${input.table}${when} BEGIN SELECT RAISE(ABORT, '${message}'); END`,
    )

    try {
        return await callback()
    } finally {
        await db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`)
    }
}

export async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function stableSizeChartId(value: string): Promise<Uint8Array> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return new Uint8Array(digest).slice(0, 6)
}

function validUsername(value: string): string {
    const normalized = value.replaceAll(/[^A-Za-z0-9_]/g, '_').slice(0, 32)
    return normalized.length >= 3 ? normalized : `usr_${normalized}`
}

function humanName(value: string): string {
    const normalized = value.replaceAll(/[^A-Za-z0-9 _'"().-]/g, ' ').trim()
    return normalized.length > 0 ? normalized.slice(0, 80) : 'Test record'
}

function safeIdentifier(value: string): string {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Invalid test D1 identifier: ${value}`)
    }
    return value
}
