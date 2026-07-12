import {type Context, Hono} from 'hono'
import {getImageApprovalData, type ImageApprovalAction, isValidImageApprovalAction} from '../../lib/admin/imageApprovals'
import {getAdminReportsData} from '../../lib/admin/reports'
import {requireAdminApiUser} from '../../lib/auth/authorization'
import {toSqlTimestamp} from '../../lib/auth/session'
import {
    characterMediaImageObjectKey,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaPreviewImageObjectKey,
    characterProfileImageObjectKey,
    profilePhotoObjectKey,
} from '../../lib/media/url'
import type {Bindings} from '../../types/bindings'

export const adminRoutes = new Hono<{Bindings: Bindings}>()

const GALLERY_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const GALLERY_PREVIEW_CONTENT_TYPE = 'image/webp'
const GALLERY_NSFW_BLUR_MAX_WIDTH = 960
const GALLERY_NSFW_BLUR_AMOUNT = 250
const GALLERY_NSFW_BLUR_QUALITY = 85

type AdminRouteContext = Context<{Bindings: Bindings}>

type ImageApprovalRequest = {
    sfwAction?: unknown
    nsfwAction?: unknown
}

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

type MediaVariantMove = {
    sourceObjectKey: string
    targetObjectKey: string
    contentType: string | null
}

type MediaBlurGeneration = {
    sourceObjectKey: string
    targetObjectKey: string
}

type MediaReviewUpdate = {
    sql: string
    binds: unknown[]
    moves: MediaVariantMove[]
    blurGeneration: MediaBlurGeneration | null
    deletedObjectKeys: string[]
    events: Array<{
        rating: 'sfw' | 'nsfw'
        action: ImageApprovalAction
        homepageAllowed: boolean
    }>
}

adminRoutes.get('/', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    return c.json({ok: true})
})

adminRoutes.get('/image-approvals', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    return c.json(await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, c.req.query('mediaId')))
})

adminRoutes.post('/image-approvals/:mediaId', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    let body: ImageApprovalRequest

    try {
        body = await c.req.json<ImageApprovalRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const sfwAction = body.sfwAction === undefined ? null : body.sfwAction
    const nsfwAction = body.nsfwAction === undefined ? null : body.nsfwAction

    if (sfwAction !== null && !isValidImageApprovalAction(sfwAction)) {
        return c.json({error: 'SFW action is invalid'}, 400)
    }

    if (nsfwAction !== null && !isValidImageApprovalAction(nsfwAction)) {
        return c.json({error: 'NSFW action is invalid'}, 400)
    }

    if (sfwAction && !isSfwAction(sfwAction)) {
        return c.json({error: 'SFW action is invalid'}, 400)
    }

    if (nsfwAction && !isNsfwAction(nsfwAction)) {
        return c.json({error: 'NSFW action is invalid'}, 400)
    }

    if (!sfwAction && !nsfwAction) {
        return c.json({error: 'At least one approval action is required'}, 400)
    }

    const media = await getModerationMedia(c.env.DB, c.req.param('mediaId'))

    if (!media) {
        return c.json({error: 'Media not found'}, 404)
    }

    const now = toSqlTimestamp(new Date())
    const update = buildMediaReviewUpdate(media, sfwAction, nsfwAction, now)

    if ('error' in update) {
        return c.json({error: update.error}, 400)
    }

    const copiedObjectKeys: string[] = []

    try {
        for (const move of update.moves) {
            await copyR2Object(c.env.MEDIA_BUCKET, move.sourceObjectKey, move.targetObjectKey, move.contentType)
            copiedObjectKeys.push(move.targetObjectKey)
        }

        if (update.blurGeneration) {
            await putNsfwBlurImage(
                c.env.IMAGES,
                c.env.MEDIA_BUCKET,
                update.blurGeneration.sourceObjectKey,
                update.blurGeneration.targetObjectKey,
            )
            copiedObjectKeys.push(update.blurGeneration.targetObjectKey)
        }

        await c.env.DB.batch([
            c.env.DB.prepare(update.sql).bind(...update.binds),
            ...update.events.map((event) =>
                c.env.DB.prepare(
                    `INSERT INTO character_media_review_events (id, media_id, image_rating, action, homepage_allowed,
                                                            moderator_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                ).bind(
                    crypto.randomUUID(),
                    media.id,
                    event.rating,
                    event.action,
                    event.homepageAllowed ? 1 : 0,
                    authorization.currentUser.id,
                    now,
                ),
            ),
        ])
    } catch (error) {
        await deleteR2Objects(c.env.MEDIA_BUCKET, copiedObjectKeys)
        throw error
    }

    for (const move of update.moves) {
        try {
            await c.env.MEDIA_BUCKET.delete(move.sourceObjectKey)
        } catch (error) {
            console.warn('Unable to delete moved moderation object', error)
        }
    }

    await deleteR2Objects(c.env.MEDIA_BUCKET, update.deletedObjectKeys)

    return c.json(await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL))
})

adminRoutes.post('/reports/images/:mediaId/:rating/:action', async (c) => {
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
    } else if (action === 'delete-image') {
        await deleteReportedImage(c.env.DB, c.env.MEDIA_BUCKET, media, rating)
    } else if (action === 'delete-character') {
        await deleteReportedCharacter(c.env.DB, c.env.MEDIA_BUCKET, media)
    } else {
        await banReportedUser(c.env.DB, c.env.MEDIA_BUCKET, media.user_id, authorization.currentUser.id, now)
    }

    return respondToReportAction(c, {ok: true})
})

async function getModerationMedia(db: D1Database, mediaId: string): Promise<ModerationMediaRow | null> {
    return await db
        .prepare(
            `SELECT id,
                user_id,
                character_id,
                sfw_image_key,
                nsfw_image_key,
                sfw_content_type,
                nsfw_content_type,
                sfw_artist,
                nsfw_artist,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                nsfw_width,
                nsfw_height,
                nsfw_byte_size,
                sfw_preview_image_key,
                sfw_preview_width,
                sfw_preview_height,
                sfw_preview_byte_size,
                nsfw_preview_image_key,
                nsfw_blur_image_key,
                nsfw_preview_width,
                nsfw_preview_height,
                nsfw_preview_byte_size
         FROM character_media
         WHERE id = ?
         LIMIT 1`,
        )
        .bind(mediaId)
        .first<ModerationMediaRow>()
}

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
        db.prepare('DELETE FROM characters WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM character_folders WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM user_social_links WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        db
            .prepare(
                `UPDATE users
             SET banned_at = ?,
                 banned_by_user_id = ?,
                 profile_photo_key = NULL
             WHERE id = ?`,
            )
            .bind(now, moderatorId, userId),
    ])

    await deleteR2Objects(bucket, objectKeys)
}

function buildMediaReviewUpdate(
    media: ModerationMediaRow,
    sfwAction: ImageApprovalAction | null,
    nsfwAction: ImageApprovalAction | null,
    now: string,
): MediaReviewUpdate | {error: string} {
    if (sfwAction && !media.sfw_image_key) {
        return {error: 'This media row does not have an SFW image'}
    }

    if (nsfwAction && !media.nsfw_image_key) {
        return {error: 'This media row does not have an NSFW image'}
    }

    if (sfwAction === 'mark_nsfw' && media.nsfw_image_key) {
        return {error: 'Cannot mark SFW as NSFW when the media row already has an NSFW image'}
    }

    if ((nsfwAction === 'mark_sfw_homepage' || nsfwAction === 'mark_sfw_no_homepage') && media.sfw_image_key) {
        return {error: 'Cannot mark NSFW as SFW when the media row already has an SFW image'}
    }

    const events: MediaReviewUpdate['events'] = []
    const moves: MediaVariantMove[] = []
    let blurGeneration: MediaBlurGeneration | null = null
    const deletedObjectKeys: string[] = []

    let sfwImageKey = media.sfw_image_key
    let nsfwImageKey = media.nsfw_image_key
    let sfwContentType = media.sfw_content_type
    let nsfwContentType = media.nsfw_content_type
    let sfwArtist = media.sfw_artist
    let nsfwArtist = media.nsfw_artist
    let sfwWidth = media.sfw_width
    let sfwHeight = media.sfw_height
    let sfwByteSize = media.sfw_byte_size
    let sfwPreviewImageKey = media.sfw_preview_image_key ?? null
    let sfwPreviewWidth = media.sfw_preview_width ?? null
    let sfwPreviewHeight = media.sfw_preview_height ?? null
    let sfwPreviewByteSize = media.sfw_preview_byte_size ?? null
    let nsfwWidth = media.nsfw_width
    let nsfwHeight = media.nsfw_height
    let nsfwByteSize = media.nsfw_byte_size
    let nsfwPreviewImageKey = media.nsfw_preview_image_key ?? null
    let nsfwBlurImageKey = media.nsfw_blur_image_key ?? null
    let nsfwPreviewWidth = media.nsfw_preview_width ?? null
    let nsfwPreviewHeight = media.nsfw_preview_height ?? null
    let nsfwPreviewByteSize = media.nsfw_preview_byte_size ?? null
    let sfwReviewStatus = 'pending'
    let sfwReviewedAt: string | null = null
    let sfwApprovedAt: string | null = null
    let sfwHomepageAllowed = 0
    let nsfwReviewStatus = 'pending'
    let nsfwReviewedAt: string | null = null
    let nsfwApprovedAt: string | null = null

    if (sfwAction === 'approve_sfw_homepage' || sfwAction === 'approve_sfw_no_homepage') {
        sfwReviewStatus = 'approved'
        sfwReviewedAt = now
        sfwApprovedAt = now
        sfwHomepageAllowed = sfwAction === 'approve_sfw_homepage' ? 1 : 0
        events.push({rating: 'sfw', action: sfwAction, homepageAllowed: Boolean(sfwHomepageAllowed)})
    } else if (sfwAction === 'report_sfw') {
        sfwReviewStatus = 'reported'
        sfwReviewedAt = now
        events.push({rating: 'sfw', action: sfwAction, homepageAllowed: false})
    } else if (sfwAction === 'mark_nsfw') {
        if (!media.sfw_image_key) {
            return {error: 'This media row does not have an SFW image'}
        }

        const move = createMove(media, media.sfw_image_key, 'sfw', 'nsfw')
        moves.push(move)
        const previewMove = createPreviewMove(media, 'sfw', 'nsfw')
        if (previewMove) {
            moves.push(previewMove)
            nsfwBlurImageKey = crypto.randomUUID()
            blurGeneration = {
                sourceObjectKey: previewMove.targetObjectKey,
                targetObjectKey: characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, nsfwBlurImageKey),
            }
        }
        nsfwImageKey = media.sfw_image_key
        nsfwContentType = media.sfw_content_type
        nsfwArtist = media.sfw_artist
        nsfwWidth = media.sfw_width
        nsfwHeight = media.sfw_height
        nsfwByteSize = media.sfw_byte_size
        nsfwPreviewImageKey = media.sfw_preview_image_key ?? null
        nsfwPreviewWidth = media.sfw_preview_width ?? null
        nsfwPreviewHeight = media.sfw_preview_height ?? null
        nsfwPreviewByteSize = media.sfw_preview_byte_size ?? null
        nsfwReviewStatus = 'approved'
        nsfwReviewedAt = now
        nsfwApprovedAt = now
        sfwImageKey = null
        sfwContentType = null
        sfwArtist = ''
        sfwWidth = null
        sfwHeight = null
        sfwByteSize = null
        sfwPreviewImageKey = null
        sfwPreviewWidth = null
        sfwPreviewHeight = null
        sfwPreviewByteSize = null
        events.push({rating: 'sfw', action: sfwAction, homepageAllowed: false})
    }

    if (nsfwAction === 'approve_nsfw') {
        nsfwReviewStatus = 'approved'
        nsfwReviewedAt = now
        nsfwApprovedAt = now
        events.push({rating: 'nsfw', action: nsfwAction, homepageAllowed: false})
    } else if (nsfwAction === 'report_nsfw') {
        nsfwReviewStatus = 'reported'
        nsfwReviewedAt = now
        events.push({rating: 'nsfw', action: nsfwAction, homepageAllowed: false})
    } else if (nsfwAction === 'mark_sfw_homepage' || nsfwAction === 'mark_sfw_no_homepage') {
        if (!media.nsfw_image_key) {
            return {error: 'This media row does not have an NSFW image'}
        }

        const move = createMove(media, media.nsfw_image_key, 'nsfw', 'sfw')
        const homepageAllowed = nsfwAction === 'mark_sfw_homepage'
        moves.push(move)
        const previewMove = createPreviewMove(media, 'nsfw', 'sfw')
        if (previewMove) {
            moves.push(previewMove)
        }
        sfwImageKey = media.nsfw_image_key
        sfwContentType = media.nsfw_content_type
        sfwArtist = media.nsfw_artist
        sfwWidth = media.nsfw_width
        sfwHeight = media.nsfw_height
        sfwByteSize = media.nsfw_byte_size
        sfwPreviewImageKey = media.nsfw_preview_image_key ?? null
        sfwPreviewWidth = media.nsfw_preview_width ?? null
        sfwPreviewHeight = media.nsfw_preview_height ?? null
        sfwPreviewByteSize = media.nsfw_preview_byte_size ?? null
        if (media.nsfw_blur_image_key) {
            deletedObjectKeys.push(
                characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, media.nsfw_blur_image_key),
            )
        }
        sfwReviewStatus = 'approved'
        sfwReviewedAt = now
        sfwApprovedAt = now
        sfwHomepageAllowed = homepageAllowed ? 1 : 0
        nsfwImageKey = null
        nsfwContentType = null
        nsfwArtist = ''
        nsfwWidth = null
        nsfwHeight = null
        nsfwByteSize = null
        nsfwPreviewImageKey = null
        nsfwBlurImageKey = null
        nsfwPreviewWidth = null
        nsfwPreviewHeight = null
        nsfwPreviewByteSize = null
        events.push({rating: 'nsfw', action: nsfwAction, homepageAllowed})
    }

    const sql = `UPDATE character_media
                 SET sfw_image_key        = ?,
                     nsfw_image_key       = ?,
                     sfw_content_type     = ?,
                     nsfw_content_type    = ?,
                     sfw_artist           = ?,
                     nsfw_artist          = ?,
                     sfw_width            = ?,
                     sfw_height           = ?,
                     sfw_byte_size        = ?,
                     sfw_preview_image_key = ?,
                     sfw_preview_width     = ?,
                     sfw_preview_height    = ?,
                     sfw_preview_byte_size = ?,
                     nsfw_width           = ?,
                     nsfw_height          = ?,
                     nsfw_byte_size       = ?,
                     nsfw_preview_image_key = ?,
                     nsfw_preview_width     = ?,
                     nsfw_preview_height    = ?,
                     nsfw_preview_byte_size = ?,
                     sfw_review_status      = CASE WHEN ? THEN ? ELSE sfw_review_status END,
                     sfw_reviewed_at      = CASE WHEN ? THEN ? ELSE sfw_reviewed_at END,
                     sfw_approved_at      = CASE WHEN ? THEN ? ELSE sfw_approved_at END,
                     sfw_homepage_allowed = CASE WHEN ? THEN ? ELSE sfw_homepage_allowed END,
                     nsfw_review_status     = CASE WHEN ? THEN ? ELSE nsfw_review_status END,
                     nsfw_reviewed_at       = CASE WHEN ? THEN ? ELSE nsfw_reviewed_at END,
                     nsfw_approved_at       = CASE WHEN ? THEN ? ELSE nsfw_approved_at END,
                     nsfw_blur_image_key    = ?
                 WHERE id = ?`
    const updateSfw = Boolean(sfwAction) || nsfwAction === 'mark_sfw_homepage' || nsfwAction === 'mark_sfw_no_homepage'
    const updateNsfw = Boolean(nsfwAction) || sfwAction === 'mark_nsfw'
    const binds = [
        sfwImageKey,
        nsfwImageKey,
        sfwContentType,
        nsfwContentType,
        sfwArtist,
        nsfwArtist,
        sfwWidth,
        sfwHeight,
        sfwByteSize,
        sfwPreviewImageKey,
        sfwPreviewWidth,
        sfwPreviewHeight,
        sfwPreviewByteSize,
        nsfwWidth,
        nsfwHeight,
        nsfwByteSize,
        nsfwPreviewImageKey,
        nsfwPreviewWidth,
        nsfwPreviewHeight,
        nsfwPreviewByteSize,
        updateSfw ? 1 : 0,
        sfwReviewStatus,
        updateSfw ? 1 : 0,
        sfwReviewedAt,
        updateSfw ? 1 : 0,
        sfwApprovedAt,
        updateSfw ? 1 : 0,
        sfwHomepageAllowed,
        updateNsfw ? 1 : 0,
        nsfwReviewStatus,
        updateNsfw ? 1 : 0,
        nsfwReviewedAt,
        updateNsfw ? 1 : 0,
        nsfwApprovedAt,
        nsfwBlurImageKey,
        media.id,
    ]

    return {sql, binds, moves, blurGeneration, deletedObjectKeys, events}
}

function isSfwAction(action: ImageApprovalAction): boolean {
    return action === 'approve_sfw_homepage' || action === 'approve_sfw_no_homepage' || action === 'mark_nsfw' || action === 'report_sfw'
}

function isNsfwAction(action: ImageApprovalAction): boolean {
    return action === 'approve_nsfw' || action === 'mark_sfw_homepage' || action === 'mark_sfw_no_homepage' || action === 'report_nsfw'
}

function createMove(
    media: ModerationMediaRow,
    imageKey: string,
    sourceRating: 'sfw' | 'nsfw',
    targetRating: 'sfw' | 'nsfw',
): MediaVariantMove {
    const contentType = mediaVariantContentType(media, sourceRating)

    return {
        sourceObjectKey: characterMediaImageObjectKey(media.user_id, media.character_id, media.id, imageKey, sourceRating, contentType),
        targetObjectKey: characterMediaImageObjectKey(media.user_id, media.character_id, media.id, imageKey, targetRating, contentType),
        contentType,
    }
}

function createPreviewMove(media: ModerationMediaRow, sourceRating: 'sfw' | 'nsfw', targetRating: 'sfw' | 'nsfw'): MediaVariantMove | null {
    const imageKey = mediaVariantPreviewKey(media, sourceRating)

    if (!imageKey) {
        return null
    }

    return {
        sourceObjectKey: characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, imageKey, sourceRating),
        targetObjectKey: characterMediaPreviewImageObjectKey(media.user_id, media.character_id, media.id, imageKey, targetRating),
        contentType: 'image/webp',
    }
}

async function putNsfwBlurImage(images: ImagesBinding, bucket: R2Bucket, sourceObjectKey: string, targetObjectKey: string): Promise<void> {
    const source = await bucket.get(sourceObjectKey)

    if (!source?.body) {
        throw new Error(`Unable to generate NSFW blur image because preview object is missing: ${sourceObjectKey}`)
    }

    const result = await images
        .input(source.body)
        .transform({width: GALLERY_NSFW_BLUR_MAX_WIDTH, fit: 'scale-down'})
        .transform({blur: GALLERY_NSFW_BLUR_AMOUNT})
        .output({format: GALLERY_PREVIEW_CONTENT_TYPE, quality: GALLERY_NSFW_BLUR_QUALITY})
    const response = result.response()
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? GALLERY_PREVIEW_CONTENT_TYPE

    await bucket.put(targetObjectKey, bytes, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType,
        },
    })
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
        return c.redirect('/admin/reports', status === 200 ? 303 : 303)
    }

    if ('ok' in body) {
        return c.json(await getAdminReportsData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL))
    }

    return c.json(body, status)
}

async function copyR2Object(bucket: R2Bucket, sourceObjectKey: string, targetObjectKey: string, contentType: string | null): Promise<void> {
    const object = await bucket.get(sourceObjectKey)

    if (!object) {
        throw new Error('Media object was not found in storage')
    }

    await bucket.put(targetObjectKey, await object.arrayBuffer(), {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: contentType ?? 'image/png',
        },
    })
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
