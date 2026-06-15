import {Hono} from 'hono'
import {requireAdminApiUser} from '../../lib/auth/authorization'
import {
    getImageApprovalData,
    isValidImageApprovalAction,
    type ImageApprovalAction,
} from '../../lib/admin/imageApprovals'
import {toSqlTimestamp} from '../../lib/auth/session'
import {characterMediaImageObjectKey} from '../../lib/media/url'
import type {Bindings} from '../../types/bindings'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

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
    sfw_artist: string
    nsfw_artist: string
    sfw_width: number | null
    sfw_height: number | null
    sfw_byte_size: number | null
    nsfw_width: number | null
    nsfw_height: number | null
    nsfw_byte_size: number | null
}

type MediaVariantMove = {
    sourceObjectKey: string
    targetObjectKey: string
}

type MediaReviewUpdate = {
    sql: string
    binds: unknown[]
    moves: MediaVariantMove[]
    events: Array<{
        rating: 'sfw' | 'nsfw'
        action: ImageApprovalAction
        homepageAllowed: boolean
    }>
}

const GALLERY_PNG_HTTP_METADATA = {
    cacheControl: 'public, max-age=31536000, immutable',
    contentType: 'image/png',
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
            await copyR2Object(c.env.MEDIA_BUCKET, move.sourceObjectKey, move.targetObjectKey)
            copiedObjectKeys.push(move.targetObjectKey)
        }

        await c.env.DB.batch([
            c.env.DB.prepare(update.sql).bind(...update.binds),
            ...update.events.map((event) => c.env.DB.prepare(
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
            )),
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

    return c.json(await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL))
})

async function getModerationMedia(db: D1Database, mediaId: string): Promise<ModerationMediaRow | null> {
    return await db.prepare(
        `SELECT id,
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
                nsfw_byte_size
         FROM character_media
         WHERE id = ?
         LIMIT 1`,
    )
        .bind(mediaId)
        .first<ModerationMediaRow>()
}

function buildMediaReviewUpdate(
    media: ModerationMediaRow,
    sfwAction: ImageApprovalAction | null,
    nsfwAction: ImageApprovalAction | null,
    now: string,
): MediaReviewUpdate | { error: string } {
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

    let sfwImageKey = media.sfw_image_key
    let nsfwImageKey = media.nsfw_image_key
    let sfwArtist = media.sfw_artist
    let nsfwArtist = media.nsfw_artist
    let sfwWidth = media.sfw_width
    let sfwHeight = media.sfw_height
    let sfwByteSize = media.sfw_byte_size
    let nsfwWidth = media.nsfw_width
    let nsfwHeight = media.nsfw_height
    let nsfwByteSize = media.nsfw_byte_size
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
        nsfwImageKey = media.sfw_image_key
        nsfwArtist = media.sfw_artist
        nsfwWidth = media.sfw_width
        nsfwHeight = media.sfw_height
        nsfwByteSize = media.sfw_byte_size
        nsfwReviewStatus = 'approved'
        nsfwReviewedAt = now
        nsfwApprovedAt = now
        sfwImageKey = null
        sfwArtist = ''
        sfwWidth = null
        sfwHeight = null
        sfwByteSize = null
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
        sfwImageKey = media.nsfw_image_key
        sfwArtist = media.nsfw_artist
        sfwWidth = media.nsfw_width
        sfwHeight = media.nsfw_height
        sfwByteSize = media.nsfw_byte_size
        sfwReviewStatus = 'approved'
        sfwReviewedAt = now
        sfwApprovedAt = now
        sfwHomepageAllowed = homepageAllowed ? 1 : 0
        nsfwImageKey = null
        nsfwArtist = ''
        nsfwWidth = null
        nsfwHeight = null
        nsfwByteSize = null
        events.push({rating: 'nsfw', action: nsfwAction, homepageAllowed})
    }

    const sql = `UPDATE character_media
                 SET sfw_image_key        = ?,
                     nsfw_image_key       = ?,
                     sfw_artist           = ?,
                     nsfw_artist          = ?,
                     sfw_width            = ?,
                     sfw_height           = ?,
                     sfw_byte_size        = ?,
                     nsfw_width           = ?,
                     nsfw_height          = ?,
                     nsfw_byte_size       = ?,
                     sfw_review_status    = CASE WHEN ? THEN ? ELSE sfw_review_status END,
                     sfw_reviewed_at      = CASE WHEN ? THEN ? ELSE sfw_reviewed_at END,
                     sfw_approved_at      = CASE WHEN ? THEN ? ELSE sfw_approved_at END,
                     sfw_homepage_allowed = CASE WHEN ? THEN ? ELSE sfw_homepage_allowed END,
                     nsfw_review_status   = CASE WHEN ? THEN ? ELSE nsfw_review_status END,
                     nsfw_reviewed_at     = CASE WHEN ? THEN ? ELSE nsfw_reviewed_at END,
                     nsfw_approved_at     = CASE WHEN ? THEN ? ELSE nsfw_approved_at END
                 WHERE id = ?`
    const updateSfw = Boolean(sfwAction) || nsfwAction === 'mark_sfw_homepage' || nsfwAction === 'mark_sfw_no_homepage'
    const updateNsfw = Boolean(nsfwAction) || sfwAction === 'mark_nsfw'
    const binds = [
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
        media.id,
    ]

    return {sql, binds, moves, events}
}

function isSfwAction(action: ImageApprovalAction): boolean {
    return action === 'approve_sfw_homepage'
        || action === 'approve_sfw_no_homepage'
        || action === 'mark_nsfw'
        || action === 'report_sfw'
}

function isNsfwAction(action: ImageApprovalAction): boolean {
    return action === 'approve_nsfw'
        || action === 'mark_sfw_homepage'
        || action === 'mark_sfw_no_homepage'
        || action === 'report_nsfw'
}

function createMove(
    media: ModerationMediaRow,
    imageKey: string,
    sourceRating: 'sfw' | 'nsfw',
    targetRating: 'sfw' | 'nsfw',
): MediaVariantMove {
    return {
        sourceObjectKey: characterMediaImageObjectKey(media.user_id, media.character_id, media.id, imageKey, sourceRating),
        targetObjectKey: characterMediaImageObjectKey(media.user_id, media.character_id, media.id, imageKey, targetRating),
    }
}

async function copyR2Object(bucket: R2Bucket, sourceObjectKey: string, targetObjectKey: string): Promise<void> {
    const object = await bucket.get(sourceObjectKey)

    if (!object) {
        throw new Error('Media object was not found in storage')
    }

    await bucket.put(targetObjectKey, await object.arrayBuffer(), {
        httpMetadata: GALLERY_PNG_HTTP_METADATA,
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
