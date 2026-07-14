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

export type ImageApprovalHistoryPage = {
    items: ImageApprovalHistoryItem[]
    page: number
    pageSize: number
    hasPrevious: boolean
    hasNext: boolean
}

export type ImageApprovalData = {
    current: ImageApprovalItem | null
    pendingCount: number
    leaseExpiresAt: string | null
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

const HISTORY_LIMIT = 50
const REVIEW_LEASE_MINUTES = 30

export async function getImageApprovalData(db: D1Database, mediaBaseUrl: string, reviewerId: string): Promise<ImageApprovalData> {
    const now = new Date()
    await syncPendingImageReviewQueue(db, now)

    const lease = await acquireImageApprovalLease(db, reviewerId, now)
    const pendingCount = await getImageApprovalCount(db)
    const current = lease ? await getImageApprovalItem(db, mediaBaseUrl, lease.mediaId) : null

    if (!current && lease) {
        await releaseImageApprovalLease(db, lease.mediaId, reviewerId)
    }

    return {
        current,
        pendingCount,
        leaseExpiresAt: current ? (lease?.leaseExpiresAt ?? null) : null,
    }
}

type LeaseRow = {
    media_id: string
    lease_expires_at: string
}

export async function queueImageReview(db: D1Database, mediaId: string): Promise<void> {
    const now = toSqlTimestamp(new Date())
    await db
        .prepare(
            `INSERT OR IGNORE INTO admin_image_review_queue (media_id, created_at, queued_at)
             SELECT id, created_at, ?
             FROM character_media
             WHERE id = ?
               AND (
                   (
                       sfw_image_key IS NOT NULL
                       AND (
                           sfw_review_status = 'pending'
                           OR sfw_reviewed_at IS NULL
                           OR updated_at > sfw_reviewed_at
                       )
                   )
                   OR (
                       nsfw_image_key IS NOT NULL
                       AND (
                           nsfw_review_status = 'pending'
                           OR nsfw_reviewed_at IS NULL
                           OR updated_at > nsfw_reviewed_at
                       )
                   )
               )`,
        )
        .bind(now, mediaId)
        .run()
}

export async function completeImageApprovalLease(db: D1Database, mediaId: string, reviewerId: string): Promise<void> {
    await db
        .prepare(
            `DELETE FROM admin_image_review_queue
             WHERE media_id = ?
               AND leased_by_user_id = ?`,
        )
        .bind(mediaId, reviewerId)
        .run()
}

export async function hasActiveImageApprovalLease(
    db: D1Database,
    mediaId: string,
    reviewerId: string,
    date = new Date(),
): Promise<boolean> {
    const row = await db
        .prepare(
            `SELECT media_id
             FROM admin_image_review_queue
             WHERE media_id = ?
               AND leased_by_user_id = ?
               AND lease_expires_at > ?
             LIMIT 1`,
        )
        .bind(mediaId, reviewerId, toSqlTimestamp(date))
        .first<{media_id: string}>()

    return Boolean(row)
}

export async function getImageApprovalPendingCount(db: D1Database): Promise<number> {
    await syncPendingImageReviewQueue(db, new Date())
    return await getImageApprovalCount(db)
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

async function syncPendingImageReviewQueue(db: D1Database, date: Date): Promise<void> {
    const now = toSqlTimestamp(date)

    await db
        .prepare(
            `INSERT OR IGNORE INTO admin_image_review_queue (media_id, created_at, queued_at)
             SELECT id, created_at, ?
             FROM character_media
             WHERE (
                 sfw_image_key IS NOT NULL
                     AND (
                     sfw_review_status = 'pending'
                         OR sfw_reviewed_at IS NULL
                         OR updated_at > sfw_reviewed_at
                     )
                 )
                OR (
                 nsfw_image_key IS NOT NULL
                     AND (
                     nsfw_review_status = 'pending'
                         OR nsfw_reviewed_at IS NULL
                         OR updated_at > nsfw_reviewed_at
                     )
                 )`,
        )
        .bind(now)
        .run()

    await db
        .prepare(
            `DELETE FROM admin_image_review_queue
             WHERE media_id NOT IN (
                 SELECT id
                 FROM character_media
                 WHERE (
                     sfw_image_key IS NOT NULL
                         AND (
                         sfw_review_status = 'pending'
                             OR sfw_reviewed_at IS NULL
                             OR updated_at > sfw_reviewed_at
                         )
                     )
                    OR (
                     nsfw_image_key IS NOT NULL
                         AND (
                         nsfw_review_status = 'pending'
                             OR nsfw_reviewed_at IS NULL
                             OR updated_at > nsfw_reviewed_at
                         )
                     )
             )`,
        )
        .bind()
        .run()
}

async function acquireImageApprovalLease(
    db: D1Database,
    reviewerId: string,
    date: Date,
): Promise<{mediaId: string; leaseExpiresAt: string} | null> {
    const now = toSqlTimestamp(date)
    const leaseExpiresAt = toSqlTimestamp(new Date(date.getTime() + REVIEW_LEASE_MINUTES * 60 * 1000))
    const existingLease = await db
        .prepare(
            `SELECT media_id, lease_expires_at
             FROM admin_image_review_queue
             WHERE leased_by_user_id = ?
               AND lease_expires_at > ?
             ORDER BY leased_at DESC,
                      media_id
             LIMIT 1`,
        )
        .bind(reviewerId, now)
        .first<LeaseRow>()

    if (existingLease) {
        return {
            mediaId: existingLease.media_id,
            leaseExpiresAt: existingLease.lease_expires_at,
        }
    }

    const lease = await db
        .prepare(
            `UPDATE admin_image_review_queue
             SET lease_id = ?,
                 leased_by_user_id = ?,
                 leased_at = ?,
                 lease_expires_at = ?
             WHERE media_id = (
                 SELECT admin_image_review_queue.media_id
                 FROM admin_image_review_queue
                 INNER JOIN character_media ON character_media.id = admin_image_review_queue.media_id
                 WHERE (
                     admin_image_review_queue.lease_expires_at IS NULL
                     OR admin_image_review_queue.lease_expires_at <= ?
                 )
                   AND (
                       (
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
                   )
                 ORDER BY admin_image_review_queue.created_at,
                          admin_image_review_queue.media_id
                 LIMIT 1
             )
             RETURNING media_id, lease_expires_at`,
        )
        .bind(crypto.randomUUID(), reviewerId, now, leaseExpiresAt, now)
        .first<LeaseRow>()

    return lease
        ? {
              mediaId: lease.media_id,
              leaseExpiresAt: lease.lease_expires_at,
          }
        : null
}

async function releaseImageApprovalLease(db: D1Database, mediaId: string, reviewerId: string): Promise<void> {
    await db
        .prepare(
            `UPDATE admin_image_review_queue
             SET lease_id = NULL,
                 leased_by_user_id = NULL,
                 leased_at = NULL,
                 lease_expires_at = NULL
             WHERE media_id = ?
               AND leased_by_user_id = ?`,
        )
        .bind(mediaId, reviewerId)
        .run()
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

export async function getImageApprovalHistory(db: D1Database, page = 1): Promise<ImageApprovalHistoryPage> {
    const pageNumber = Math.max(1, Math.trunc(page))
    const offset = (pageNumber - 1) * HISTORY_LIMIT
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
         LIMIT ?
         OFFSET ?`,
        )
        .bind(HISTORY_LIMIT + 1, offset)
        .all<HistoryRow>()

    const rows = result.results ?? []

    return {
        items: rows.slice(0, HISTORY_LIMIT).map((row) => ({
            id: row.id,
            mediaId: row.media_id,
            imageRating: row.image_rating,
            action: row.action,
            homepageAllowed: Boolean(row.homepage_allowed),
            moderatorUsername: row.moderator_username,
            ownerUsername: row.owner_username,
            characterName: row.character_name,
            createdAt: row.created_at,
        })),
        page: pageNumber,
        pageSize: HISTORY_LIMIT,
        hasPrevious: pageNumber > 1,
        hasNext: rows.length > HISTORY_LIMIT,
    }
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

function toSqlTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19)
}
