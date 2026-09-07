import {createHash} from 'node:crypto'

export const DEVELOPMENT_CLONE_USERNAMES = ['Razeth', 'NU_M00N', 'Sorebae', 'FINESTSUSHIROLL']

export const CLONE_TABLE_QUERIES = [
    {
        table: 'users',
        sql: `SELECT id, username, profile_photo_key, bio, display_nsfw_media, created_at,
                     profile_photo_content_type
              FROM users
              WHERE lower(username) IN (?, ?, ?, ?)
              ORDER BY id`,
        identity: 'username',
    },
    {
        table: 'user_social_links',
        sql: `SELECT user_social_links.*
              FROM user_social_links
              INNER JOIN users ON users.id = user_social_links.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY user_social_links.user_id, user_social_links.platform`,
    },
    {
        table: 'character_folders',
        sql: `SELECT character_folders.*
              FROM character_folders
              INNER JOIN users ON users.id = character_folders.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_folders.user_id, character_folders.id`,
    },
    {
        table: 'characters',
        sql: `SELECT characters.id, hex(characters.size_chart_id) AS __size_chart_id_hex,
                     characters.user_id, characters.name, characters.profile_image_key, characters.folder_id,
                     characters.created_at, characters.updated_at, characters.sort_order, characters.description,
                     characters.height_chart_json, characters.profile_image_content_type
              FROM characters
              INNER JOIN users ON users.id = characters.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY characters.user_id, characters.id`,
    },
    {
        table: 'character_folder_placements',
        sql: `SELECT character_folder_placements.*
              FROM character_folder_placements
              INNER JOIN users ON users.id = character_folder_placements.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_folder_placements.user_id, character_folder_placements.folder_id,
                       character_folder_placements.character_id`,
    },
    {
        table: 'character_media',
        sql: `SELECT character_media.*
              FROM character_media
              INNER JOIN users ON users.id = character_media.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_media.user_id, character_media.id`,
    },
    {
        table: 'character_gallery_tabs',
        sql: `SELECT character_gallery_tabs.*
              FROM character_gallery_tabs
              INNER JOIN users ON users.id = character_gallery_tabs.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_gallery_tabs.user_id, character_gallery_tabs.id`,
    },
    {
        table: 'character_gallery_rows',
        sql: `SELECT character_gallery_rows.*
              FROM character_gallery_rows
              INNER JOIN users ON users.id = character_gallery_rows.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_gallery_rows.user_id, character_gallery_rows.id`,
    },
    {
        table: 'character_gallery_row_media',
        sql: `SELECT character_gallery_row_media.*
              FROM character_gallery_row_media
              INNER JOIN character_gallery_rows ON character_gallery_rows.id = character_gallery_row_media.row_id
              INNER JOIN users ON users.id = character_gallery_rows.user_id
              WHERE lower(users.username) IN (?, ?, ?, ?)
              ORDER BY character_gallery_row_media.row_id, character_gallery_row_media.media_id`,
    },
]

export const CLEAR_TABLE_ORDER = [
    'admin_error_logs',
    'media_preview_regeneration_items',
    'media_preview_regeneration_runs',
    'image_processing_attempts',
    'image_queue_outbox',
    'image_cleanup_tasks',
    'image_upload_parts',
    'image_processing_tasks',
    'image_upload_sources',
    'image_upload_jobs',
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
]

const DISABLED_PASSWORD_HASH = 'passkey-only:development-clone'

export function assertD1DatabaseIdentity(database, expectedId, expectedName) {
    const actualId = typeof database?.uuid === 'string' ? database.uuid.toLowerCase() : ''
    const actualName = typeof database?.name === 'string' ? database.name : ''
    if (actualId !== expectedId.toLowerCase() || actualName !== expectedName) {
        throw new Error(`Refusing to seed because D1 target ${expectedId} is not the database named ${expectedName}.`)
    }
}

export function prepareCloneData(tables, approvalSeed, now = new Date()) {
    const cloned = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, rows.map((row) => ({...row}))]))
    cloned.users = cloned.users.map(scrubUser)
    cloned.character_media = randomizeMediaApprovals(cloned.character_media, approvalSeed, now)
    return cloned
}

export function scrubUser(user) {
    return {
        ...user,
        email: `clone-${createHash('sha256').update(String(user.id)).digest('hex')}@users.invalid`,
        password_hash: DISABLED_PASSWORD_HASH,
        role: 'user',
        last_seen_version: null,
        banned_at: null,
        banned_by_user_id: null,
        webauthn_user_id: null,
        recovery_phrase_hash: null,
        recovery_phrase_set_at: null,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 0,
        secure_account_required_at: null,
        secure_account_required_passkey_id: null,
        passkey_prompt_seen_at: null,
        show_unapproved_media: 1,
    }
}

export function randomizeMediaApprovals(rows, seed, now = new Date()) {
    const variants = collectApprovalVariants(rows, seed)
    variants.sort((left, right) => left.score.localeCompare(right.score))
    const reviewedAt = now.toISOString().replace('T', ' ').slice(0, 19)

    for (const [index, variant] of variants.entries()) {
        const approved = variants.length === 1 ? variant.score.charCodeAt(0) % 2 === 0 : index % 2 === 0
        applyApproval(variant, approved, reviewedAt)
    }

    return rows
}

export function collectMediaObjectKeys(tables) {
    const keys = new Set()
    collectUserObjectKeys(keys, tables.users ?? [])
    collectFolderObjectKeys(keys, tables.character_folders ?? [])
    collectCharacterObjectKeys(keys, tables.characters ?? [])
    collectGalleryObjectKeys(keys, tables.character_media ?? [])
    return [...keys].sort()
}

function collectApprovalVariants(rows, seed) {
    return rows.flatMap((row) =>
        ['sfw', 'nsfw']
            .filter((rating) => row[`${rating}_image_key`])
            .map((rating) => ({row, rating, score: approvalScore(seed, row.id, rating)})),
    )
}

function applyApproval(variant, approved, reviewedAt) {
    variant.row[`${variant.rating}_review_status`] = approved ? 'approved' : 'pending'
    variant.row[`${variant.rating}_reviewed_at`] = approved ? reviewedAt : null
    variant.row[`${variant.rating}_approved_at`] = approved ? reviewedAt : null
    if (variant.rating === 'sfw') {
        variant.row.sfw_homepage_allowed = approved && variant.score.charCodeAt(1) % 2 === 0 ? 1 : 0
    }
}

function collectUserObjectKeys(keys, users) {
    for (const user of users) {
        if (user.profile_photo_key) keys.add(profilePhotoObjectKey(user.id, user.profile_photo_key))
    }
}

function collectFolderObjectKeys(keys, folders) {
    for (const folder of folders) {
        if (folder.folder_image_key) keys.add(characterFolderImageObjectKey(folder.user_id, folder.id, folder.folder_image_key))
    }
}

function collectCharacterObjectKeys(keys, characters) {
    for (const character of characters) {
        if (character.profile_image_key)
            keys.add(characterProfileImageObjectKey(character.user_id, character.id, character.profile_image_key))
        const image = parseHeightChartImage(character.height_chart_json)
        if (image) keys.add(characterHeightChartImageObjectKey(character.user_id, character.id, image.key, image.contentType))
    }
}

function collectGalleryObjectKeys(keys, mediaRows) {
    for (const media of mediaRows) {
        collectMediaVariantKeys(keys, media, 'sfw')
        collectMediaVariantKeys(keys, media, 'nsfw')
        if (media.nsfw_blur_image_key) {
            keys.add(
                `characters/${media.user_id}/${media.character_id}/media/${media.id}/nsfw/blur/${media.nsfw_blur_image_key}.${extensionForImageContentType(media.nsfw_blur_content_type ?? 'image/webp')}`,
            )
        }
    }
}

export function insertStatement(table, row) {
    assertIdentifier(table)
    const entries = Object.entries(row)
    const columns = []
    const values = []
    const params = []

    for (const [name, value] of entries) {
        if (name === '__size_chart_id_hex') {
            if (typeof value !== 'string' || !/^[0-9a-f]{12}$/i.test(value)) throw new Error('A size chart ID must be 6 bytes.')
            columns.push('size_chart_id')
            values.push('unhex(?)')
            params.push(value)
            continue
        }
        assertIdentifier(name)
        columns.push(name)
        values.push('?')
        params.push(value)
    }

    return {
        sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
        params,
    }
}

function collectMediaVariantKeys(keys, media, rating) {
    const imageKey = media[`${rating}_image_key`]
    const contentType = media[`${rating}_content_type`] ?? 'image/png'
    if (imageKey) {
        keys.add(
            `characters/${media.user_id}/${media.character_id}/media/${media.id}/${rating}/${imageKey}.${extensionForImageContentType(contentType)}`,
        )
    }
    const previewKey = media[`${rating}_preview_image_key`]
    const previewContentType = media[`${rating}_preview_content_type`] ?? 'image/webp'
    if (previewKey) {
        keys.add(
            `characters/${media.user_id}/${media.character_id}/media/${media.id}/${rating}/preview/${previewKey}.${extensionForImageContentType(previewContentType)}`,
        )
    }
}

function profilePhotoObjectKey(userId, imageKey) {
    return `users/${userId}/profile/${generatedImageFileName(imageKey)}`
}

function characterProfileImageObjectKey(userId, characterId, imageKey) {
    return `characters/${userId}/${characterId}/profile/${generatedImageFileName(imageKey)}`
}

function characterFolderImageObjectKey(userId, folderId, imageKey) {
    return `characters/${userId}/folders/${folderId}/image/${generatedImageFileName(imageKey)}`
}

function characterHeightChartImageObjectKey(userId, characterId, imageKey, contentType) {
    return `characters/${userId}/${characterId}/height-chart/${imageKey}.${extensionForImageContentType(contentType)}`
}

function generatedImageFileName(key) {
    return key.startsWith('avif-') ? `${key}.avif` : `${key}.webp`
}

function extensionForImageContentType(contentType) {
    switch (String(contentType ?? 'image/png').toLowerCase()) {
        case 'image/jpeg':
            return 'jpg'
        case 'image/gif':
            return 'gif'
        case 'image/webp':
            return 'webp'
        case 'image/avif':
            return 'avif'
        default:
            return 'png'
    }
}

function parseHeightChartImage(value) {
    if (!value) return null
    try {
        const image = JSON.parse(value)?.image
        return image && typeof image.key === 'string' && image.key ? {key: image.key, contentType: image.contentType ?? 'image/png'} : null
    } catch {
        return null
    }
}

function approvalScore(seed, mediaId, rating) {
    return createHash('sha256').update(`${seed}\0${mediaId}\0${rating}`).digest('hex')
}

function assertIdentifier(value) {
    if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`)
}
