import {type Context, Hono} from 'hono'
import {z} from 'zod'
import {queueImageReview} from '../../lib/admin/imageApprovals'
import {type AdminJobName, type AdminJobRunResult, isAdminJobName, runAdminJob} from '../../lib/admin/jobs'
import {getAdminReportsData} from '../../lib/admin/reports'
import {requireAdminApiUser} from '../../lib/auth/authorization'
import {toSqlTimestamp} from '../../lib/auth/session'
import {csrfProtection} from '../../lib/http/csrf'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {AdminImageReportSchema, AdminJobRunResultSchema, ErrorResponseSchema, responseSchema} from '../../lib/http/responseSchemas'
import {
    characterMediaImageObjectKey,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaPreviewImageObjectKey,
    characterProfileImageObjectKey,
    profilePhotoObjectKey,
} from '../../lib/media/url'
import type {Bindings} from '../../types/bindings'

type AdminRouteContext = Context<{Bindings: Bindings}>

type ModerationMediaRow = {
    id: string
    user_id: string
    character_id: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
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
    sfw_preview_image_key?: string | null
    sfw_preview_width?: number | null
    sfw_preview_height?: number | null
    sfw_preview_byte_size?: number | null
    nsfw_preview_image_key?: string | null
    nsfw_blur_image_key?: string | null
    nsfw_preview_width?: number | null
    nsfw_preview_height?: number | null
    nsfw_preview_byte_size?: number | null
}

type ReportAction = 'ignore' | 'delete-image' | 'delete-character' | 'ban-user'

type ReportMediaRow = ModerationMediaRow & {
    username: string
    profile_photo_key: string | null
    character_name: string
    profile_image_key: string | null
    sfw_review_status: string
    nsfw_review_status: string
}

type CharacterCleanupRow = {
    id: string
    user_id: string
    profile_image_key: string | null
}

type MediaCleanupRow = {
    id: string
    user_id: string
    character_id: string
    sfw_image_key: string | null
    nsfw_image_key: string | null
    sfw_content_type: string | null
    nsfw_content_type: string | null
    sfw_preview_image_key?: string | null
    nsfw_preview_image_key?: string | null
    nsfw_blur_image_key?: string | null
}

const AdminJobActionResponseSchema = z.union([
    responseSchema({
        ok: z.literal(true),
        run: AdminJobRunResultSchema,
    }),
    ErrorResponseSchema,
])
const AdminReportsDataSchema = responseSchema({
    reports: z.array(AdminImageReportSchema),
})

export const adminPageActionRoutes = new Hono<{Bindings: Bindings}>()

adminPageActionRoutes.use('/admin/admin-options/jobs/:jobName/run', csrfProtection)
adminPageActionRoutes.use('/admin/reports/images/:mediaId/:rating/:action', csrfProtection)

adminPageActionRoutes.post('/admin/admin-options/jobs/:jobName/run', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    const jobName = c.req.param('jobName')

    if (!isAdminJobName(jobName)) {
        return respondToJobAction(c, null, {error: 'Admin job is invalid'}, 400)
    }

    try {
        const run = await runAdminJob(c.env, jobName, {
            triggeredByUserId: authorization.currentUser.id,
            triggerSource: 'manual',
        })

        return respondToJobAction(c, jobName, {
            ok: true,
            run,
        })
    } catch (error) {
        return respondToJobAction(c, jobName, {error: getJobErrorMessage(error)}, 500)
    }
})

adminPageActionRoutes.post('/admin/reports/images/:mediaId/:rating/:action', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    const rating = normalizeReportRating(c.req.param('rating'))
    const action = normalizeReportAction(c.req.param('action'))

    if (!rating || !action) {
        return respondToReportAction(c, {error: 'Report action is invalid'}, 400)
    }

    const media = await getReportMedia(c.env.DB, c.req.param('mediaId'))

    if (!media) {
        return respondToReportAction(c, {error: 'Reported media not found'}, 404)
    }

    if (!reportedImageKey(media, rating)) {
        return respondToReportAction(c, {error: 'Reported image not found'}, 404)
    }

    if (reportedStatus(media, rating) !== 'reported') {
        return respondToReportAction(c, {error: 'Image is not currently reported'}, 400)
    }

    const now = toSqlTimestamp(new Date())

    if (action === 'ignore') {
        await ignoreImageReport(c.env.DB, media.id, rating, authorization.currentUser.id, now)
        await queueImageReview(c.env.DB, media.id)
    } else if (action === 'delete-image') {
        await deleteReportedImage(c.env.DB, c.env.MEDIA_BUCKET, media, rating)
    } else if (action === 'delete-character') {
        await deleteReportedCharacter(c.env.DB, c.env.MEDIA_BUCKET, media)
    } else {
        await banReportedUser(c.env.DB, c.env.MEDIA_BUCKET, media.user_id, authorization.currentUser.id, now)
    }

    return respondToReportAction(c, {ok: true})
})

async function getReportMedia(db: D1Database, mediaId: string): Promise<ReportMediaRow | null> {
    return await db
        .prepare(
            `SELECT character_media.id,
                character_media.user_id,
                character_media.character_id,
                character_media.sfw_image_key,
                character_media.nsfw_image_key,
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
                character_media.sfw_preview_image_key,
                character_media.sfw_preview_width,
                character_media.sfw_preview_height,
                character_media.sfw_preview_byte_size,
                character_media.nsfw_preview_image_key,
                character_media.nsfw_blur_image_key,
                character_media.nsfw_preview_width,
                character_media.nsfw_preview_height,
                character_media.nsfw_preview_byte_size,
                character_media.sfw_review_status,
                character_media.nsfw_review_status,
                users.username,
                users.profile_photo_key,
                characters.name AS character_name,
                characters.profile_image_key
         FROM character_media
         INNER JOIN users ON users.id = character_media.user_id
         INNER JOIN characters ON characters.id = character_media.character_id
         WHERE character_media.id = ?
         LIMIT 1`,
        )
        .bind(mediaId)
        .first<ReportMediaRow>()
}

async function ignoreImageReport(db: D1Database, mediaId: string, rating: 'sfw' | 'nsfw', moderatorId: string, now: string): Promise<void> {
    const statements =
        rating === 'sfw'
            ? [
                  db
                      .prepare(
                          `UPDATE character_media
                 SET sfw_review_status = 'pending',
                     sfw_reviewed_at = NULL,
                     sfw_approved_at = NULL,
                     sfw_homepage_allowed = 0
                 WHERE id = ?`,
                      )
                      .bind(mediaId),
                  createReportEventStatement(db, mediaId, rating, 'ignore_report', moderatorId, now),
              ]
            : [
                  db
                      .prepare(
                          `UPDATE character_media
                 SET nsfw_review_status = 'pending',
                     nsfw_reviewed_at = NULL,
                     nsfw_approved_at = NULL
                 WHERE id = ?`,
                      )
                      .bind(mediaId),
                  createReportEventStatement(db, mediaId, rating, 'ignore_report', moderatorId, now),
              ]

    await db.batch(statements)
}

async function deleteReportedImage(db: D1Database, bucket: R2Bucket, media: ReportMediaRow, rating: 'sfw' | 'nsfw'): Promise<void> {
    const objectKey = reportedImageObjectKey(media, rating)
    const previewObjectKey = reportedPreviewObjectKey(media, rating)
    const blurObjectKey = reportedBlurObjectKey(media, rating)
    const otherImageKey = rating === 'sfw' ? media.nsfw_image_key : media.sfw_image_key

    if (otherImageKey) {
        const statement =
            rating === 'sfw'
                ? db
                      .prepare(
                          `UPDATE character_media
                 SET sfw_image_key = NULL,
                     sfw_content_type = NULL,
                     sfw_artist = '',
                     sfw_width = NULL,
                     sfw_height = NULL,
                     sfw_byte_size = NULL,
                     sfw_preview_image_key = NULL,
                     sfw_preview_width = NULL,
                     sfw_preview_height = NULL,
                     sfw_preview_byte_size = NULL,
                     sfw_review_status = 'pending',
                     sfw_reviewed_at = NULL,
                     sfw_approved_at = NULL,
                     sfw_homepage_allowed = 0
                 WHERE id = ?`,
                      )
                      .bind(media.id)
                : db
                      .prepare(
                          `UPDATE character_media
                 SET nsfw_image_key = NULL,
                     nsfw_content_type = NULL,
                     nsfw_artist = '',
                     nsfw_width = NULL,
                     nsfw_height = NULL,
                     nsfw_byte_size = NULL,
                     nsfw_preview_image_key = NULL,
                     nsfw_blur_image_key    = NULL,
                     nsfw_preview_width     = NULL,
                     nsfw_preview_height = NULL,
                     nsfw_preview_byte_size = NULL,
                     nsfw_review_status = 'pending',
                     nsfw_reviewed_at = NULL,
                     nsfw_approved_at = NULL
                 WHERE id = ?`,
                      )
                      .bind(media.id)

        await statement.run()
    } else {
        await db.batch([
            db.prepare('DELETE FROM character_gallery_row_media WHERE media_id = ?').bind(media.id),
            db.prepare('DELETE FROM character_media_review_events WHERE media_id = ?').bind(media.id),
            db.prepare('DELETE FROM character_media WHERE id = ?').bind(media.id),
        ])
    }

    await deleteR2Objects(
        bucket,
        [objectKey, previewObjectKey, blurObjectKey].filter((key): key is string => Boolean(key)),
    )
}

async function deleteReportedCharacter(db: D1Database, bucket: R2Bucket, media: ReportMediaRow): Promise<void> {
    const mediaRows = await getCharacterMediaForCleanup(db, media.character_id)
    const objectKeys = characterObjectKeys(
        [
            {
                id: media.character_id,
                user_id: media.user_id,
                profile_image_key: media.profile_image_key,
            },
        ],
        mediaRows,
    )

    await db.batch([
        db
            .prepare(
                `DELETE FROM character_media_review_events
             WHERE media_id IN (SELECT id FROM character_media WHERE character_id = ?)`,
            )
            .bind(media.character_id),
        db
            .prepare(
                `DELETE FROM character_gallery_row_media
             WHERE media_id IN (SELECT id FROM character_media WHERE character_id = ?)`,
            )
            .bind(media.character_id),
        db.prepare('DELETE FROM character_gallery_rows WHERE character_id = ?').bind(media.character_id),
        db.prepare('DELETE FROM character_gallery_tabs WHERE character_id = ?').bind(media.character_id),
        db.prepare('DELETE FROM character_media WHERE character_id = ?').bind(media.character_id),
        db.prepare('DELETE FROM characters WHERE id = ?').bind(media.character_id),
    ])

    await deleteR2Objects(bucket, objectKeys)
}

async function banReportedUser(db: D1Database, bucket: R2Bucket, userId: string, moderatorId: string, now: string): Promise<void> {
    const [user, characters, mediaRows] = await Promise.all([
        getUserForCleanup(db, userId),
        getUserCharactersForCleanup(db, userId),
        getUserMediaForCleanup(db, userId),
    ])
    const objectKeys = [
        ...(user?.profile_photo_key ? [profilePhotoObjectKey(userId, user.profile_photo_key)] : []),
        ...characterObjectKeys(characters, mediaRows),
    ]

    await db.batch([
        db
            .prepare(
                `DELETE FROM character_media_review_events
             WHERE media_id IN (SELECT id FROM character_media WHERE user_id = ?)`,
            )
            .bind(userId),
        db
            .prepare(
                `DELETE FROM character_gallery_row_media
             WHERE media_id IN (SELECT id FROM character_media WHERE user_id = ?)`,
            )
            .bind(userId),
        db.prepare('DELETE FROM character_gallery_rows WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM character_gallery_tabs WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM character_media WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM character_folders WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM characters WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM user_social_links WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        db
            .prepare(
                `UPDATE users
             SET banned_at = ?,
                 banned_by_user_id = ?
             WHERE id = ?`,
            )
            .bind(now, moderatorId, userId),
    ])

    await deleteR2Objects(bucket, objectKeys)
}

function normalizeReportRating(value: string): 'sfw' | 'nsfw' | null {
    return value === 'sfw' || value === 'nsfw' ? value : null
}

function normalizeReportAction(value: string): ReportAction | null {
    return value === 'ignore' || value === 'delete-image' || value === 'delete-character' || value === 'ban-user' ? value : null
}

function reportedImageKey(media: ReportMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'sfw' ? media.sfw_image_key : media.nsfw_image_key
}

function mediaVariantContentType(media: ModerationMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'sfw' ? media.sfw_content_type : media.nsfw_content_type
}

function mediaVariantPreviewKey(media: ModerationMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'sfw' ? (media.sfw_preview_image_key ?? null) : (media.nsfw_preview_image_key ?? null)
}

function reportedStatus(media: ReportMediaRow, rating: 'sfw' | 'nsfw'): string {
    return rating === 'sfw' ? media.sfw_review_status : media.nsfw_review_status
}

function reportedImageObjectKey(media: ReportMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    const imageKey = reportedImageKey(media, rating)

    return imageKey
        ? characterMediaImageObjectKey(
              media.user_id,
              media.character_id,
              media.id,
              imageKey,
              rating,
              mediaVariantContentType(media, rating),
          )
        : null
}

function reportedPreviewObjectKey(media: ReportMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    const imageKey = mediaVariantPreviewKey(media, rating)

    return imageKey ? characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, imageKey, rating) : null
}

function reportedBlurObjectKey(media: ReportMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'nsfw' && media.nsfw_blur_image_key
        ? characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_blur_image_key)
        : null
}

function createReportEventStatement(
    db: D1Database,
    mediaId: string,
    rating: 'sfw' | 'nsfw',
    action: string,
    moderatorId: string,
    now: string,
): D1PreparedStatement {
    return db
        .prepare(
            `INSERT INTO character_media_review_events (
             id, media_id, image_rating, action, homepage_allowed, moderator_id, created_at
         )
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(crypto.randomUUID(), mediaId, rating, action, moderatorId, now)
}

async function getCharacterMediaForCleanup(db: D1Database, characterId: string): Promise<MediaCleanupRow[]> {
    const result = await db
        .prepare(
            `SELECT id,
                user_id,
                character_id,
                sfw_image_key,
                nsfw_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_preview_image_key,
                nsfw_blur_image_key,
                nsfw_preview_image_key
         FROM character_media
         WHERE character_id = ?`,
        )
        .bind(characterId)
        .all<MediaCleanupRow>()

    return result.results ?? []
}

async function getUserForCleanup(db: D1Database, userId: string): Promise<{profile_photo_key: string | null} | null> {
    return await db
        .prepare(
            `SELECT profile_photo_key
         FROM users
         WHERE id = ?
         LIMIT 1`,
        )
        .bind(userId)
        .first<{profile_photo_key: string | null}>()
}

async function getUserCharactersForCleanup(db: D1Database, userId: string): Promise<CharacterCleanupRow[]> {
    const result = await db
        .prepare(
            `SELECT id, user_id, profile_image_key
         FROM characters
         WHERE user_id = ?`,
        )
        .bind(userId)
        .all<CharacterCleanupRow>()

    return result.results ?? []
}

async function getUserMediaForCleanup(db: D1Database, userId: string): Promise<MediaCleanupRow[]> {
    const result = await db
        .prepare(
            `SELECT id, user_id, character_id, sfw_image_key, nsfw_image_key, sfw_content_type, nsfw_content_type,
                sfw_preview_image_key,
                nsfw_preview_image_key,
                nsfw_blur_image_key
         FROM character_media
         WHERE user_id = ?`,
        )
        .bind(userId)
        .all<MediaCleanupRow>()

    return result.results ?? []
}

function characterObjectKeys(characters: CharacterCleanupRow[], mediaRows: MediaCleanupRow[]): string[] {
    const objectKeys: string[] = []

    for (const character of characters) {
        if (character.profile_image_key) {
            objectKeys.push(characterProfileImageObjectKey(character.user_id, character.id, character.profile_image_key))
        }
    }

    for (const media of mediaRows) {
        if (media.sfw_image_key) {
            objectKeys.push(
                characterMediaImageObjectKey(
                    media.user_id,
                    media.character_id,
                    media.id,
                    media.sfw_image_key,
                    'sfw',
                    media.sfw_content_type,
                ),
            )
        }

        if (media.sfw_preview_image_key) {
            objectKeys.push(
                characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.sfw_preview_image_key, 'sfw'),
            )
        }

        if (media.nsfw_image_key) {
            objectKeys.push(
                characterMediaImageObjectKey(
                    media.user_id,
                    media.character_id,
                    media.id,
                    media.nsfw_image_key,
                    'nsfw',
                    media.nsfw_content_type,
                ),
            )
        }

        if (media.nsfw_preview_image_key) {
            objectKeys.push(
                characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_preview_image_key, 'nsfw'),
            )
        }

        if (media.nsfw_blur_image_key) {
            objectKeys.push(characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_blur_image_key))
        }
    }

    return objectKeys
}

async function respondToReportAction(
    c: AdminRouteContext,
    body: {ok: true} | {error: string},
    status: 200 | 400 | 404 = 200,
): Promise<Response> {
    if (c.req.header('accept')?.includes('text/html')) {
        return c.redirect('/admin/reports', 303)
    }

    if ('ok' in body) {
        return jsonResponse(c, AdminReportsDataSchema, await getAdminReportsData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL))
    }

    return jsonResponse(c, ErrorResponseSchema, body, status)
}

async function respondToJobAction(
    c: AdminRouteContext,
    jobName: AdminJobName | null,
    body: {ok: true; run: AdminJobRunResult} | {error: string},
    status: 200 | 400 | 500 = 200,
): Promise<Response> {
    if (c.req.header('accept')?.includes('text/html')) {
        const search = new URLSearchParams({
            status: 'ok' in body ? (body.run.status === 'running' ? 'started' : 'success') : 'error',
        })

        if (jobName) {
            search.set('job', jobName)
        }

        return c.redirect(`/admin/admin-options?${search.toString()}`, 303)
    }

    return jsonResponse(c, AdminJobActionResponseSchema, body, status)
}

function getJobErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message
    }

    return 'Admin job failed'
}

async function deleteR2Objects(bucket: R2Bucket, objectKeys: string[]): Promise<void> {
    for (const objectKey of objectKeys) {
        try {
            await bucket.delete(objectKey)
        } catch (error) {
            console.warn('Unable to delete moderation object', error)
        }
    }
}
