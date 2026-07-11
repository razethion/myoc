import {characterMediaImageObjectKey, characterMediaImageUrl, characterMediaPreviewImageUrl} from '../media/url'

export type ImageApprovalAction =
    | 'approve_sfw_homepage'
    | 'approve_sfw_no_homepage'
    | 'mark_nsfw'
    | 'report_sfw'
    | 'approve_nsfw'
    | 'mark_sfw_homepage'
    | 'mark_sfw_no_homepage'
    | 'report_nsfw'

export type ImageApprovalVariant = {
    rating: 'sfw' | 'nsfw'
    imageKey: string
    contentType: string
    imageUrl: string
    fullImageUrl: string
    previewImageUrl: string | null
    objectKey: string
    artist: string
    width: number | null
    height: number | null
    byteSize: number | null
    reviewStatus: string
    reviewedAt: string | null
    approvedAt: string | null
    homepageAllowed: boolean
    needsReview: boolean
}

export type ImageApprovalItem = {
    id: string
    createdAt: string
    updatedAt: string
    user: {
        id: string
        username: string
        email: string
        profileUrl: string
    }
    character: {
        id: string
        name: string
        url: string
    }
    sfw: ImageApprovalVariant | null
    nsfw: ImageApprovalVariant | null
}

export type ImageApprovalQueueItem = {
    id: string
    createdAt: string
    username: string
    characterName: string
    pendingSfw: boolean
    pendingNsfw: boolean
}

export type ImageApprovalHistoryItem = {
    id: string
    mediaId: string
    imageRating: 'sfw' | 'nsfw'
    action: string
    homepageAllowed: boolean
    moderatorUsername: string
    ownerUsername: string
    characterName: string
    createdAt: string
}

export type ImageApprovalData = {
    current: ImageApprovalItem | null
    pending: ImageApprovalQueueItem[]
    pendingCount: number
    history: ImageApprovalHistoryItem[]
}

type ImageApprovalRow = {
    id: string
    user_id: string
    username: string
    email: string
    character_id: string
    character_name: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_preview_image_key: string | null
    nsfw_preview_image_key: string | null
    sfw_content_type: string | null
    nsfw_content_type: string | null
    sfw_artist: string
    nsfw_artist: string
    sfw_width: number | null
    sfw_height: number | null
    sfw_byte_size: number | null
    nsfw_width: number | null
    nsfw_height: number | null
    nsfw_byte_size: number | null
    sfw_review_status: string
    sfw_reviewed_at: string | null
    sfw_approved_at: string | null
    sfw_homepage_allowed: number
    nsfw_review_status: string
    nsfw_reviewed_at: string | null
    nsfw_approved_at: string | null
    created_at: string
    updated_at: string
}

type QueueRow = {
    id: string
    username: string
    character_name: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_review_status: string
    sfw_reviewed_at: string | null
    nsfw_review_status: string
    nsfw_reviewed_at: string | null
    created_at: string
    updated_at: string
}

type HistoryRow = {
    id: string
    media_id: string
    image_rating: 'sfw' | 'nsfw'
    action: string
    homepage_allowed: number
    moderator_username: string
    owner_username: string
    character_name: string
    created_at: string
}

const QUEUE_LIMIT = 50
const HISTORY_LIMIT = 50

export async function getImageApprovalData(
    db: D1Database,
    mediaBaseUrl: string,
    selectedMediaId?: string | null,
): Promise<ImageApprovalData> {
    const [pending, pendingCount, history] = await Promise.all([
        getImageApprovalQueue(db),
        getImageApprovalCount(db),
        getImageApprovalHistory(db),
    ])
    let current = selectedMediaId ? await getImageApprovalItem(db, mediaBaseUrl, selectedMediaId) : null

    if (!current && pending[0]) {
        current = await getImageApprovalItem(db, mediaBaseUrl, pending[0].id)
    }

    return {
        current,
        pending,
        pendingCount,
        history,
    }
}

export async function getImageApprovalItem(db: D1Database, mediaBaseUrl: string, mediaId: string): Promise<ImageApprovalItem | null> {
    const row = await db
        .prepare(
            `SELECT character_media.id,
                character_media.user_id,
                users.username,
                users.email,
                character_media.character_id,
                characters.name AS character_name,
                character_media.sfw_image_key,
                character_media.nsfw_image_key,
                character_media.sfw_preview_image_key,
                character_media.nsfw_preview_image_key,
                character_media.sfw_content_type,
                character_media.nsfw_content_type,
                character_media.sfw_artist,
                character_media.nsfw_artist,
                character_media.sfw_width,
                character_media.sfw_height,
                character_media.sfw_byte_size,
                character_media.nsfw_width,
                character_media.nsfw_height,
                character_media.nsfw_byte_size,
                character_media.sfw_review_status,
                character_media.sfw_reviewed_at,
                character_media.sfw_approved_at,
                character_media.sfw_homepage_allowed,
                character_media.nsfw_review_status,
                character_media.nsfw_reviewed_at,
                character_media.nsfw_approved_at,
                character_media.created_at,
                character_media.updated_at
         FROM character_media
                  INNER JOIN users ON users.id = character_media.user_id
                  INNER JOIN characters ON characters.id = character_media.character_id
         WHERE character_media.id = ?
         LIMIT 1`,
        )
        .bind(mediaId)
        .first<ImageApprovalRow>()

    return row ? toImageApprovalItem(row, mediaBaseUrl) : null
}

export function isValidImageApprovalAction(value: unknown): value is ImageApprovalAction {
    return (
        typeof value === 'string' &&
        [
            'approve_sfw_homepage',
            'approve_sfw_no_homepage',
            'mark_nsfw',
            'report_sfw',
            'approve_nsfw',
            'mark_sfw_homepage',
            'mark_sfw_no_homepage',
            'report_nsfw',
        ].includes(value)
    )
}

async function getImageApprovalQueue(db: D1Database): Promise<ImageApprovalQueueItem[]> {
    const result = await db
        .prepare(
            `SELECT character_media.id,
                users.username,
                characters.name AS character_name,
                character_media.sfw_image_key,
                character_media.nsfw_image_key,
                character_media.sfw_review_status,
                character_media.sfw_reviewed_at,
                character_media.nsfw_review_status,
                character_media.nsfw_reviewed_at,
                character_media.created_at,
                character_media.updated_at
         FROM character_media
                  INNER JOIN users ON users.id = character_media.user_id
                  INNER JOIN characters ON characters.id = character_media.character_id
         WHERE (
             character_media.sfw_image_key IS NOT NULL
                 AND (
                 character_media.sfw_review_status = 'pending'
                     OR character_media.sfw_reviewed_at IS NULL
                     OR character_media.updated_at > character_media.sfw_reviewed_at
                 )
             )
            OR (
             character_media.nsfw_image_key IS NOT NULL
                 AND (
                 character_media.nsfw_review_status = 'pending'
                     OR character_media.nsfw_reviewed_at IS NULL
                     OR character_media.updated_at > character_media.nsfw_reviewed_at
                 )
             )
         ORDER BY character_media.created_at, character_media.id
         LIMIT ?`,
        )
        .bind(QUEUE_LIMIT)
        .all<QueueRow>()

    return (result.results ?? []).map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        username: row.username,
        characterName: row.character_name,
        pendingSfw: Boolean(row.sfw_image_key) && variantNeedsReview(row.sfw_review_status, row.sfw_reviewed_at, row.updated_at),
        pendingNsfw: Boolean(row.nsfw_image_key) && variantNeedsReview(row.nsfw_review_status, row.nsfw_reviewed_at, row.updated_at),
    }))
}

async function getImageApprovalCount(db: D1Database): Promise<number> {
    const row = await db
        .prepare(
            `SELECT (
             SELECT COUNT(*)
             FROM character_media
             WHERE sfw_image_key IS NOT NULL
               AND (
                   sfw_review_status = 'pending'
                   OR sfw_reviewed_at IS NULL
                   OR updated_at > sfw_reviewed_at
               )
         ) + (
             SELECT COUNT(*)
             FROM character_media
             WHERE nsfw_image_key IS NOT NULL
               AND (
                   nsfw_review_status = 'pending'
                   OR nsfw_reviewed_at IS NULL
                   OR updated_at > nsfw_reviewed_at
               )
         ) AS count`,
        )
        .bind()
        .first<{count: number}>()

    return row?.count ?? 0
}

async function getImageApprovalHistory(db: D1Database): Promise<ImageApprovalHistoryItem[]> {
    const result = await db
        .prepare(
            `SELECT character_media_review_events.id,
                character_media_review_events.media_id,
                character_media_review_events.image_rating,
                character_media_review_events.action,
                character_media_review_events.homepage_allowed,
                moderators.username AS moderator_username,
                owners.username     AS owner_username,
                characters.name     AS character_name,
                character_media_review_events.created_at
         FROM character_media_review_events
                  INNER JOIN users AS moderators ON moderators.id = character_media_review_events.moderator_id
                  INNER JOIN character_media ON character_media.id = character_media_review_events.media_id
                  INNER JOIN users AS owners ON owners.id = character_media.user_id
                  INNER JOIN characters ON characters.id = character_media.character_id
         ORDER BY character_media_review_events.created_at DESC,
                  character_media_review_events.id DESC
         LIMIT ?`,
        )
        .bind(HISTORY_LIMIT)
        .all<HistoryRow>()

    return (result.results ?? []).map((row) => ({
        id: row.id,
        mediaId: row.media_id,
        imageRating: row.image_rating,
        action: row.action,
        homepageAllowed: Boolean(row.homepage_allowed),
        moderatorUsername: row.moderator_username,
        ownerUsername: row.owner_username,
        characterName: row.character_name,
        createdAt: row.created_at,
    }))
}

function toImageApprovalItem(row: ImageApprovalRow, mediaBaseUrl: string): ImageApprovalItem {
    const sfwFullImageUrl = row.sfw_image_key
        ? characterMediaImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, row.sfw_image_key, 'sfw', row.sfw_content_type)
        : null
    const sfwPreviewImageUrl = row.sfw_preview_image_key
        ? characterMediaPreviewImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, row.sfw_preview_image_key, 'sfw')
        : null
    const nsfwFullImageUrl = row.nsfw_image_key
        ? characterMediaImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, row.nsfw_image_key, 'nsfw', row.nsfw_content_type)
        : null
    const nsfwPreviewImageUrl = row.nsfw_preview_image_key
        ? characterMediaPreviewImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, row.nsfw_preview_image_key, 'nsfw')
        : null

    return {
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        user: {
            id: row.user_id,
            username: row.username,
            email: row.email,
            profileUrl: `/u/${encodeURIComponent(row.username)}`,
        },
        character: {
            id: row.character_id,
            name: row.character_name,
            url: `/u/${encodeURIComponent(row.username)}/${encodeURIComponent(row.character_name)}`,
        },
        sfw: row.sfw_image_key
            ? {
                  rating: 'sfw',
                  imageKey: row.sfw_image_key,
                  contentType: row.sfw_content_type ?? 'image/png',
                  imageUrl: sfwPreviewImageUrl ?? sfwFullImageUrl ?? '',
                  fullImageUrl: sfwFullImageUrl ?? '',
                  previewImageUrl: sfwPreviewImageUrl,
                  objectKey: characterMediaImageObjectKey(
                      row.user_id,
                      row.character_id,
                      row.id,
                      row.sfw_image_key,
                      'sfw',
                      row.sfw_content_type,
                  ),
                  artist: row.sfw_artist,
                  width: row.sfw_width,
                  height: row.sfw_height,
                  byteSize: row.sfw_byte_size,
                  reviewStatus: row.sfw_review_status,
                  reviewedAt: row.sfw_reviewed_at,
                  approvedAt: row.sfw_approved_at,
                  homepageAllowed: Boolean(row.sfw_homepage_allowed),
                  needsReview: variantNeedsReview(row.sfw_review_status, row.sfw_reviewed_at, row.updated_at),
              }
            : null,
        nsfw: row.nsfw_image_key
            ? {
                  rating: 'nsfw',
                  imageKey: row.nsfw_image_key,
                  contentType: row.nsfw_content_type ?? 'image/png',
                  imageUrl: nsfwPreviewImageUrl ?? nsfwFullImageUrl ?? '',
                  fullImageUrl: nsfwFullImageUrl ?? '',
                  previewImageUrl: nsfwPreviewImageUrl,
                  objectKey: characterMediaImageObjectKey(
                      row.user_id,
                      row.character_id,
                      row.id,
                      row.nsfw_image_key,
                      'nsfw',
                      row.nsfw_content_type,
                  ),
                  artist: row.nsfw_artist,
                  width: row.nsfw_width,
                  height: row.nsfw_height,
                  byteSize: row.nsfw_byte_size,
                  reviewStatus: row.nsfw_review_status,
                  reviewedAt: row.nsfw_reviewed_at,
                  approvedAt: row.nsfw_approved_at,
                  homepageAllowed: false,
                  needsReview: variantNeedsReview(row.nsfw_review_status, row.nsfw_reviewed_at, row.updated_at),
              }
            : null,
    }
}

function variantNeedsReview(reviewStatus: string, reviewedAt: string | null, updatedAt: string): boolean {
    return reviewStatus === 'pending' || !reviewedAt || updatedAt > reviewedAt
}
