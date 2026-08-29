import {Hono} from 'hono'
import {
    completeImageApprovalLease,
    getImageApprovalData,
    hasActiveImageApprovalLease,
    type ImageApprovalAction,
    isValidImageApprovalAction,
} from '../../lib/admin/imageApprovals'
import {requireImageModeratorApiUser} from '../../lib/auth/authorization'
import {toSqlTimestamp} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {ErrorResponseSchema, ImageApprovalDataSchema} from '../../lib/http/responseSchemas'
import {deleteR2Objects} from '../../lib/media/r2Delete'
import {characterMediaImageObjectKey, characterMediaNsfwBlurImageObjectKey, characterMediaPreviewImageObjectKey} from '../../lib/media/url'
import type {Bindings} from '../../types/bindings'

export const adminRoutes = new Hono<{Bindings: Bindings}>()

const GALLERY_IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'
const GALLERY_PREVIEW_CONTENT_TYPE = 'image/webp'
const GALLERY_NSFW_BLUR_MAX_WIDTH = 960
const GALLERY_NSFW_BLUR_AMOUNT = 250
const GALLERY_NSFW_BLUR_QUALITY = 85

type ImageApprovalRequest = {
    sfwAction?: unknown
    nsfwAction?: unknown
}

type SfwImageApprovalAction = Extract<ImageApprovalAction, 'approve_sfw_homepage' | 'approve_sfw_no_homepage' | 'mark_nsfw' | 'report_sfw'>
type NsfwImageApprovalAction = Exclude<ImageApprovalAction, SfwImageApprovalAction>

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

type ParsedImageApprovalActions = {
    sfwAction: SfwImageApprovalAction | null
    nsfwAction: NsfwImageApprovalAction | null
}

type MediaVariantState = {
    imageKey: string | null
    contentType: string | null
    artist: string
    width: number | null
    height: number | null
    byteSize: number | null
    previewImageKey: string | null
    previewWidth: number | null
    previewHeight: number | null
    previewByteSize: number | null
}

type MediaVariantReviewState = {
    status: 'pending' | 'approved' | 'reported'
    reviewedAt: string | null
    approvedAt: string | null
    homepageAllowed: number
}

type MediaReviewPlan = {
    sfw: MediaVariantState
    nsfw: MediaVariantState
    sfwReview: MediaVariantReviewState
    nsfwReview: MediaVariantReviewState
    nsfwBlurImageKey: string | null
    moves: MediaVariantMove[]
    blurGeneration: MediaBlurGeneration | null
    deletedObjectKeys: string[]
    events: MediaReviewUpdate['events']
}

const MEDIA_REVIEW_UPDATE_SQL = `UPDATE character_media
                                 SET sfw_image_key          = ?,
                                     nsfw_image_key         = ?,
                                     sfw_content_type       = ?,
                                     nsfw_content_type      = ?,
                                     sfw_artist             = ?,
                                     nsfw_artist            = ?,
                                     sfw_width              = ?,
                                     sfw_height             = ?,
                                     sfw_byte_size          = ?,
                                     sfw_preview_image_key  = ?,
                                     sfw_preview_width      = ?,
                                     sfw_preview_height     = ?,
                                     sfw_preview_byte_size  = ?,
                                     nsfw_width             = ?,
                                     nsfw_height            = ?,
                                     nsfw_byte_size         = ?,
                                     nsfw_preview_image_key = ?,
                                     nsfw_preview_width     = ?,
                                     nsfw_preview_height    = ?,
                                     nsfw_preview_byte_size = ?,
                                     sfw_review_status      = CASE WHEN ? THEN ? ELSE sfw_review_status END,
                                     sfw_reviewed_at        = CASE WHEN ? THEN ? ELSE sfw_reviewed_at END,
                                     sfw_approved_at        = CASE WHEN ? THEN ? ELSE sfw_approved_at END,
                                     sfw_homepage_allowed   = CASE WHEN ? THEN ? ELSE sfw_homepage_allowed END,
                                     nsfw_review_status     = CASE WHEN ? THEN ? ELSE nsfw_review_status END,
                                     nsfw_reviewed_at       = CASE WHEN ? THEN ? ELSE nsfw_reviewed_at END,
                                     nsfw_approved_at       = CASE WHEN ? THEN ? ELSE nsfw_approved_at END,
                                     nsfw_blur_image_key    = ?
                                 WHERE id = ?`

adminRoutes.post('/image-approvals/:mediaId', async (c) => {
    const authorization = await requireImageModeratorApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    const actions = await parseImageApprovalActions(c.req.raw)

    if ('error' in actions) {
        return jsonResponse(c, ErrorResponseSchema, {error: actions.error}, 400)
    }

    const mediaId = c.req.param('mediaId')

    if (!(await hasActiveImageApprovalLease(c.env.DB, mediaId, authorization.currentUser.id))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Image review lease is no longer active'}, 409)
    }

    const media = await getModerationMedia(c.env.DB, mediaId)

    if (!media) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Media not found'}, 404)
    }

    const now = toSqlTimestamp(new Date())
    const update = buildMediaReviewUpdate(media, actions.sfwAction, actions.nsfwAction, now)

    if ('error' in update) {
        return jsonResponse(c, ErrorResponseSchema, {error: update.error}, 400)
    }

    await applyMediaReview(c.env, media, update, authorization.currentUser.id, now)

    return jsonResponse(
        c,
        ImageApprovalDataSchema,
        await getImageApprovalData(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, authorization.currentUser.id),
    )
})

async function parseImageApprovalActions(request: Request): Promise<ParsedImageApprovalActions | {error: string}> {
    let body: ImageApprovalRequest

    try {
        const value = (await request.json()) as unknown

        if (!isRecord(value)) {
            return {error: 'Invalid JSON body'}
        }

        body = value
    } catch {
        return {error: 'Invalid JSON body'}
    }

    const actions = {
        sfwAction: body.sfwAction === undefined ? null : body.sfwAction,
        nsfwAction: body.nsfwAction === undefined ? null : body.nsfwAction,
    }

    return validateImageApprovalActions(actions)
}

function validateImageApprovalActions(actions: {sfwAction: unknown; nsfwAction: unknown}): ParsedImageApprovalActions | {error: string} {
    const {sfwAction, nsfwAction} = actions

    if (sfwAction !== null && (!isValidImageApprovalAction(sfwAction) || !isSfwAction(sfwAction))) {
        return {error: 'SFW action is invalid'}
    }

    if (nsfwAction !== null && (!isValidImageApprovalAction(nsfwAction) || !isNsfwAction(nsfwAction))) {
        return {error: 'NSFW action is invalid'}
    }

    if (!sfwAction && !nsfwAction) {
        return {error: 'At least one approval action is required'}
    }

    return {sfwAction, nsfwAction}
}

async function applyMediaReview(
    env: Bindings,
    media: ModerationMediaRow,
    update: MediaReviewUpdate,
    moderatorId: string,
    now: string,
): Promise<void> {
    const copiedObjectKeys = await copyReviewObjects(env, update)

    try {
        await env.DB.batch([
            env.DB.prepare(update.sql).bind(...update.binds),
            ...createReviewEventStatements(env.DB, media.id, update.events, moderatorId, now),
        ])
    } catch (error) {
        await deleteR2Objects(env.MEDIA_BUCKET, copiedObjectKeys, 'image-moderation-rollback')
        throw error
    }

    await completeImageApprovalLease(env.DB, media.id, moderatorId)
    await deleteMovedSourceObjects(env.MEDIA_BUCKET, update.moves)
    await deleteR2Objects(env.MEDIA_BUCKET, update.deletedObjectKeys, 'image-moderation-cleanup')
}

async function copyReviewObjects(env: Bindings, update: MediaReviewUpdate): Promise<string[]> {
    const copiedObjectKeys: string[] = []

    try {
        for (const move of update.moves) {
            await copyR2Object(env.MEDIA_BUCKET, move.sourceObjectKey, move.targetObjectKey, move.contentType)
            copiedObjectKeys.push(move.targetObjectKey)
        }

        if (update.blurGeneration) {
            await putNsfwBlurImage(
                env.IMAGES,
                env.MEDIA_BUCKET,
                update.blurGeneration.sourceObjectKey,
                update.blurGeneration.targetObjectKey,
            )
            copiedObjectKeys.push(update.blurGeneration.targetObjectKey)
        }

        return copiedObjectKeys
    } catch (error) {
        await deleteR2Objects(env.MEDIA_BUCKET, copiedObjectKeys, 'image-moderation-rollback')
        throw error
    }
}

function createReviewEventStatements(
    db: D1Database,
    mediaId: string,
    events: MediaReviewUpdate['events'],
    moderatorId: string,
    now: string,
): D1PreparedStatement[] {
    return events.map((event) =>
        db
            .prepare(
                `INSERT INTO character_media_review_events (id, media_id, image_rating, action, homepage_allowed,
                                                            moderator_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(crypto.randomUUID(), mediaId, event.rating, event.action, event.homepageAllowed ? 1 : 0, moderatorId, now),
    )
}

async function deleteMovedSourceObjects(bucket: R2Bucket, moves: MediaVariantMove[]): Promise<void> {
    await deleteR2Objects(
        bucket,
        moves.map((move) => move.sourceObjectKey),
        'image-moderation-source-cleanup',
    )
}

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

function buildMediaReviewUpdate(
    media: ModerationMediaRow,
    sfwAction: SfwImageApprovalAction | null,
    nsfwAction: NsfwImageApprovalAction | null,
    now: string,
): MediaReviewUpdate | {error: string} {
    const validationError = mediaReviewValidationError(media, sfwAction, nsfwAction)

    if (validationError) {
        return {error: validationError}
    }

    const plan = createMediaReviewPlan(media)

    if (sfwAction) {
        applySfwReviewAction(plan, media, sfwAction, now)
    }

    if (nsfwAction) {
        applyNsfwReviewAction(plan, media, nsfwAction, now)
    }

    return {
        sql: MEDIA_REVIEW_UPDATE_SQL,
        binds: createMediaReviewBinds(plan, media.id, sfwAction, nsfwAction),
        moves: plan.moves,
        blurGeneration: plan.blurGeneration,
        deletedObjectKeys: plan.deletedObjectKeys,
        events: plan.events,
    }
}

function mediaReviewValidationError(
    media: ModerationMediaRow,
    sfwAction: SfwImageApprovalAction | null,
    nsfwAction: NsfwImageApprovalAction | null,
): string | null {
    if (sfwAction && !media.sfw_image_key) {
        return 'This media row does not have an SFW image'
    }

    if (nsfwAction && !media.nsfw_image_key) {
        return 'This media row does not have an NSFW image'
    }

    if (sfwAction === 'mark_nsfw' && media.nsfw_image_key) {
        return 'Cannot mark SFW as NSFW when the media row already has an NSFW image'
    }

    if (isNsfwToSfwAction(nsfwAction) && media.sfw_image_key) {
        return 'Cannot mark NSFW as SFW when the media row already has an SFW image'
    }

    return null
}

function createMediaReviewPlan(media: ModerationMediaRow): MediaReviewPlan {
    return {
        sfw: mediaVariantState(media, 'sfw'),
        nsfw: mediaVariantState(media, 'nsfw'),
        sfwReview: pendingReviewState(),
        nsfwReview: pendingReviewState(),
        nsfwBlurImageKey: media.nsfw_blur_image_key ?? null,
        moves: [],
        blurGeneration: null,
        deletedObjectKeys: [],
        events: [],
    }
}

function mediaVariantState(media: ModerationMediaRow, rating: 'sfw' | 'nsfw'): MediaVariantState {
    if (rating === 'sfw') {
        return {
            imageKey: media.sfw_image_key,
            contentType: media.sfw_content_type,
            artist: media.sfw_artist,
            width: media.sfw_width,
            height: media.sfw_height,
            byteSize: media.sfw_byte_size,
            previewImageKey: media.sfw_preview_image_key ?? null,
            previewWidth: media.sfw_preview_width ?? null,
            previewHeight: media.sfw_preview_height ?? null,
            previewByteSize: media.sfw_preview_byte_size ?? null,
        }
    }

    return {
        imageKey: media.nsfw_image_key,
        contentType: media.nsfw_content_type,
        artist: media.nsfw_artist,
        width: media.nsfw_width,
        height: media.nsfw_height,
        byteSize: media.nsfw_byte_size,
        previewImageKey: media.nsfw_preview_image_key ?? null,
        previewWidth: media.nsfw_preview_width ?? null,
        previewHeight: media.nsfw_preview_height ?? null,
        previewByteSize: media.nsfw_preview_byte_size ?? null,
    }
}

function emptyMediaVariantState(): MediaVariantState {
    return {
        imageKey: null,
        contentType: null,
        artist: '',
        width: null,
        height: null,
        byteSize: null,
        previewImageKey: null,
        previewWidth: null,
        previewHeight: null,
        previewByteSize: null,
    }
}

function pendingReviewState(): MediaVariantReviewState {
    return {
        status: 'pending',
        reviewedAt: null,
        approvedAt: null,
        homepageAllowed: 0,
    }
}

function approvedReviewState(now: string, homepageAllowed = false): MediaVariantReviewState {
    return {
        status: 'approved',
        reviewedAt: now,
        approvedAt: now,
        homepageAllowed: homepageAllowed ? 1 : 0,
    }
}

function reportedReviewState(now: string): MediaVariantReviewState {
    return {
        status: 'reported',
        reviewedAt: now,
        approvedAt: null,
        homepageAllowed: 0,
    }
}

function applySfwReviewAction(plan: MediaReviewPlan, media: ModerationMediaRow, action: SfwImageApprovalAction, now: string): void {
    switch (action) {
        case 'approve_sfw_homepage':
        case 'approve_sfw_no_homepage':
            plan.sfwReview = approvedReviewState(now, action === 'approve_sfw_homepage')
            plan.events.push({rating: 'sfw', action, homepageAllowed: plan.sfwReview.homepageAllowed === 1})
            return
        case 'report_sfw':
            plan.sfwReview = reportedReviewState(now)
            plan.events.push({rating: 'sfw', action, homepageAllowed: false})
            return
        case 'mark_nsfw':
            moveSfwVariantToNsfw(plan, media, action, now)
    }
}

function moveSfwVariantToNsfw(plan: MediaReviewPlan, media: ModerationMediaRow, action: SfwImageApprovalAction, now: string): void {
    const imageKey = plan.sfw.imageKey as string

    plan.moves.push(createMove(media, imageKey, 'sfw', 'nsfw'))
    const previewMove = createPreviewMove(media, 'sfw', 'nsfw')

    if (previewMove) {
        plan.moves.push(previewMove)
        plan.nsfwBlurImageKey = crypto.randomUUID()
        plan.blurGeneration = {
            sourceObjectKey: previewMove.targetObjectKey,
            targetObjectKey: characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, plan.nsfwBlurImageKey),
        }
    }

    plan.nsfw = {...plan.sfw}
    plan.sfw = emptyMediaVariantState()
    plan.nsfwReview = approvedReviewState(now)
    plan.events.push({rating: 'sfw', action, homepageAllowed: false})
}

function applyNsfwReviewAction(plan: MediaReviewPlan, media: ModerationMediaRow, action: NsfwImageApprovalAction, now: string): void {
    switch (action) {
        case 'approve_nsfw':
            plan.nsfwReview = approvedReviewState(now)
            plan.events.push({rating: 'nsfw', action, homepageAllowed: false})
            return
        case 'report_nsfw':
            plan.nsfwReview = reportedReviewState(now)
            plan.events.push({rating: 'nsfw', action, homepageAllowed: false})
            return
        case 'mark_sfw_homepage':
        case 'mark_sfw_no_homepage':
            moveNsfwVariantToSfw(plan, media, action, now)
    }
}

function moveNsfwVariantToSfw(plan: MediaReviewPlan, media: ModerationMediaRow, action: NsfwImageApprovalAction, now: string): void {
    const imageKey = plan.nsfw.imageKey as string

    plan.moves.push(createMove(media, imageKey, 'nsfw', 'sfw'))
    const previewMove = createPreviewMove(media, 'nsfw', 'sfw')

    if (previewMove) {
        plan.moves.push(previewMove)
    }

    if (plan.nsfwBlurImageKey) {
        plan.deletedObjectKeys.push(
            characterMediaNsfwBlurImageObjectKey(media.user_id, media.character_id, media.id, plan.nsfwBlurImageKey),
        )
    }

    const homepageAllowed = action === 'mark_sfw_homepage'
    plan.sfw = {...plan.nsfw}
    plan.nsfw = emptyMediaVariantState()
    plan.sfwReview = approvedReviewState(now, homepageAllowed)
    plan.nsfwBlurImageKey = null
    plan.events.push({rating: 'nsfw', action, homepageAllowed})
}

function createMediaReviewBinds(
    plan: MediaReviewPlan,
    mediaId: string,
    sfwAction: SfwImageApprovalAction | null,
    nsfwAction: NsfwImageApprovalAction | null,
): unknown[] {
    const updateSfw = Boolean(sfwAction) || isNsfwToSfwAction(nsfwAction)
    const updateNsfw = Boolean(nsfwAction) || sfwAction === 'mark_nsfw'
    const updateSfwFlag = Number(updateSfw)
    const updateNsfwFlag = Number(updateNsfw)

    return [
        plan.sfw.imageKey,
        plan.nsfw.imageKey,
        plan.sfw.contentType,
        plan.nsfw.contentType,
        plan.sfw.artist,
        plan.nsfw.artist,
        plan.sfw.width,
        plan.sfw.height,
        plan.sfw.byteSize,
        plan.sfw.previewImageKey,
        plan.sfw.previewWidth,
        plan.sfw.previewHeight,
        plan.sfw.previewByteSize,
        plan.nsfw.width,
        plan.nsfw.height,
        plan.nsfw.byteSize,
        plan.nsfw.previewImageKey,
        plan.nsfw.previewWidth,
        plan.nsfw.previewHeight,
        plan.nsfw.previewByteSize,
        updateSfwFlag,
        plan.sfwReview.status,
        updateSfwFlag,
        plan.sfwReview.reviewedAt,
        updateSfwFlag,
        plan.sfwReview.approvedAt,
        updateSfwFlag,
        plan.sfwReview.homepageAllowed,
        updateNsfwFlag,
        plan.nsfwReview.status,
        updateNsfwFlag,
        plan.nsfwReview.reviewedAt,
        updateNsfwFlag,
        plan.nsfwReview.approvedAt,
        plan.nsfwBlurImageKey,
        mediaId,
    ]
}

function isNsfwToSfwAction(action: NsfwImageApprovalAction | null): boolean {
    return action === 'mark_sfw_homepage' || action === 'mark_sfw_no_homepage'
}
function isSfwAction(action: ImageApprovalAction): action is SfwImageApprovalAction {
    return action === 'approve_sfw_homepage' || action === 'approve_sfw_no_homepage' || action === 'mark_nsfw' || action === 'report_sfw'
}

function isNsfwAction(action: ImageApprovalAction): action is NsfwImageApprovalAction {
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

function mediaVariantContentType(media: ModerationMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'sfw' ? media.sfw_content_type : media.nsfw_content_type
}

function mediaVariantPreviewKey(media: ModerationMediaRow, rating: 'sfw' | 'nsfw'): string | null {
    return rating === 'sfw' ? (media.sfw_preview_image_key ?? null) : (media.nsfw_preview_image_key ?? null)
}

async function copyR2Object(bucket: R2Bucket, sourceObjectKey: string, targetObjectKey: string, contentType: string | null): Promise<void> {
    const object = await bucket.get(sourceObjectKey)

    if (!object?.body) {
        throw new Error('Media object was not found in storage')
    }

    const body = object.body.pipeThrough(new FixedLengthStream(object.size))

    await bucket.put(targetObjectKey, body, {
        httpMetadata: {
            cacheControl: GALLERY_IMAGE_CACHE_CONTROL,
            contentType: contentType ?? 'image/png',
        },
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
