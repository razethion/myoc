import {
    characterMediaImageObjectKey,
    characterMediaImageUrl,
} from '../media/url'

export type AdminImageReport = {
    type: 'image'
    id: string
    mediaId: string
    rating: 'sfw' | 'nsfw'
    imageUrl: string
    objectKey: string
    reviewStatus: string
    reportedAt: string
    reportedByUsername: string | null
    user: {
        id: string
        username: string
        profileUrl: string
    }
    character: {
        id: string
        name: string
        url: string
    }
}

export type AdminReportsData = {
    reports: AdminImageReport[]
}

type ReportedMediaRow = {
    id: string
    user_id: string
    username: string
    character_id: string
    character_name: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_review_status: string
    nsfw_review_status: string
    sfw_reviewed_at: string | null
    nsfw_reviewed_at: string | null
    sfw_reported_by_username: string | null
    nsfw_reported_by_username: string | null
}

const REPORT_LIMIT = 100

export async function getAdminReportsData(db: D1Database, mediaBaseUrl: string): Promise<AdminReportsData> {
    const result = await db.prepare(
        `SELECT character_media.id,
                character_media.user_id,
                users.username,
                character_media.character_id,
                characters.name AS character_name,
                character_media.sfw_image_key,
                character_media.nsfw_image_key,
                character_media.sfw_review_status,
                character_media.nsfw_review_status,
                character_media.sfw_reviewed_at,
                character_media.nsfw_reviewed_at,
                (
                    SELECT moderators.username
                    FROM character_media_review_events
                    INNER JOIN users AS moderators ON moderators.id = character_media_review_events.moderator_id
                    WHERE character_media_review_events.media_id = character_media.id
                      AND character_media_review_events.image_rating = 'sfw'
                      AND character_media_review_events.action = 'report_sfw'
                    ORDER BY character_media_review_events.created_at DESC,
                             character_media_review_events.id DESC
                    LIMIT 1
                ) AS sfw_reported_by_username,
                (
                    SELECT moderators.username
                    FROM character_media_review_events
                    INNER JOIN users AS moderators ON moderators.id = character_media_review_events.moderator_id
                    WHERE character_media_review_events.media_id = character_media.id
                      AND character_media_review_events.image_rating = 'nsfw'
                      AND character_media_review_events.action = 'report_nsfw'
                    ORDER BY character_media_review_events.created_at DESC,
                             character_media_review_events.id DESC
                    LIMIT 1
                ) AS nsfw_reported_by_username
         FROM character_media
         INNER JOIN users ON users.id = character_media.user_id
         INNER JOIN characters ON characters.id = character_media.character_id
         WHERE (character_media.sfw_image_key IS NOT NULL AND character_media.sfw_review_status = 'reported')
            OR (character_media.nsfw_image_key IS NOT NULL AND character_media.nsfw_review_status = 'reported')
         ORDER BY COALESCE(character_media.sfw_reviewed_at, character_media.nsfw_reviewed_at, character_media.created_at),
                  character_media.id
         LIMIT ?`,
    )
        .bind(REPORT_LIMIT)
        .all<ReportedMediaRow>()

    const reports = (result.results ?? []).flatMap((row) => toImageReports(row, mediaBaseUrl))
    reports.sort((left, right) => (
        left.reportedAt.localeCompare(right.reportedAt)
        || left.mediaId.localeCompare(right.mediaId)
        || left.rating.localeCompare(right.rating)
    ))

    return {
        reports: reports.slice(0, REPORT_LIMIT),
    }
}

function toImageReports(row: ReportedMediaRow, mediaBaseUrl: string): AdminImageReport[] {
    const reports: AdminImageReport[] = []

    if (row.sfw_image_key && row.sfw_review_status === 'reported') {
        reports.push(toImageReport(row, mediaBaseUrl, 'sfw', row.sfw_image_key, row.sfw_reviewed_at, row.sfw_reported_by_username))
    }

    if (row.nsfw_image_key && row.nsfw_review_status === 'reported') {
        reports.push(toImageReport(row, mediaBaseUrl, 'nsfw', row.nsfw_image_key, row.nsfw_reviewed_at, row.nsfw_reported_by_username))
    }

    return reports
}

function toImageReport(
    row: ReportedMediaRow,
    mediaBaseUrl: string,
    rating: 'sfw' | 'nsfw',
    imageKey: string,
    reportedAt: string | null,
    reportedByUsername: string | null,
): AdminImageReport {
    return {
        type: 'image',
        id: `${row.id}:${rating}`,
        mediaId: row.id,
        rating,
        imageUrl: characterMediaImageUrl(mediaBaseUrl, row.user_id, row.character_id, row.id, imageKey, rating),
        objectKey: characterMediaImageObjectKey(row.user_id, row.character_id, row.id, imageKey, rating),
        reviewStatus: 'reported',
        reportedAt: reportedAt ?? '',
        reportedByUsername,
        user: {
            id: row.user_id,
            username: row.username,
            profileUrl: `/u/${encodeURIComponent(row.username)}`,
        },
        character: {
            id: row.character_id,
            name: row.character_name,
            url: `/u/${encodeURIComponent(row.username)}/${encodeURIComponent(row.character_name)}`,
        },
    }
}
