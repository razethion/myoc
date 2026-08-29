import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {
    queryAll,
    queryOne,
    seedAuthenticatedUser,
    seedCharacter,
    seedMedia,
    seedUser,
    useTestDatabase,
    withFailingTrigger,
} from '../../test/d1'
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockKVNamespace} from '../../test/mockKV'
import {createMockR2Bucket} from '../../test/mockR2'
import {apiRoutes} from '../api'
import {adminPageActionRoutes} from '../page-actions/admin'

const db = useTestDatabase()
const mediaPublicBaseUrl = 'https://m.myoc.art'
const currentUserId = 'current-user'
const ownerId = 'owner-1'
const characterId = 'character-1'
const mediaId = 'media-1'
const reportedCharacterMediaR2Keys = [
    'characters/owner-1/character-1/profile/character-profile-key.webp',
    'characters/owner-1/character-1/media/media-1/sfw/sfw-key.png',
    'characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp',
    'characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png',
    'characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp',
    'characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp',
] as const

function requestEnv(mediaBucket = createMockR2Bucket(), imagesBinding = createMockImagesBinding()) {
    return {
        CACHE: createMockKVNamespace(),
        DB: db,
        DB_BACKUP_BUCKET: createMockR2Bucket(),
        MEDIA_BUCKET: mediaBucket,
        IMAGES: imagesBinding,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    }
}

function expectNsfwBlurTransform(imagesBinding: ImagesBinding): void {
    const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
    expect(imageTransformer.transform).toHaveBeenCalledWith({width: 960, fit: 'scale-down'})
    expect(imageTransformer.transform).toHaveBeenCalledWith({blur: 250})
    expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 85})
}

function expectBucketDeletes(mediaBucket: R2Bucket, keys: readonly string[]): void {
    for (const key of keys) expect(mediaBucket.delete).toHaveBeenCalledWith(key)
}

async function seedCurrentUser(role: 'user' | 'moderator' | 'admin' = 'admin', sessionToken = 'session-token'): Promise<void> {
    await seedAuthenticatedUser({id: currentUserId, email: 'current@example.test', username: 'current_user', role}, sessionToken)
}

type MediaOverrides = Parameters<typeof seedMedia>[0]

async function seedModerationMedia(overrides: MediaOverrides = {id: mediaId, userId: ownerId, characterId}): Promise<void> {
    await seedUser({id: ownerId, email: 'owner@example.test', username: 'owner_user'})
    await seedCharacter({id: characterId, userId: ownerId, name: 'Quartz', profileImageKey: 'character-profile-key'})
    await seedMedia({
        sfwImageKey: 'sfw-key',
        sfwArtist: 'Artist',
        sfwWidth: 1200,
        sfwHeight: 900,
        sfwByteSize: 1024,
        sfwPreviewImageKey: 'sfw-preview-key',
        sfwPreviewWidth: 800,
        sfwPreviewHeight: 600,
        sfwPreviewByteSize: 512,
        ...overrides,
    })
}

async function seedActiveLease(): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_image_review_queue (media_id, leased_by_user_id, leased_at, lease_expires_at)
             VALUES (?, ?, '2026-01-01 00:00:00', '2099-01-01 00:00:00')`,
        )
        .bind(mediaId, currentUserId)
        .run()
}

async function seedApprovalMedia(
    overrides: MediaOverrides = {id: mediaId, userId: ownerId, characterId},
    role: 'moderator' | 'admin' = 'admin',
) {
    await seedCurrentUser(role)
    await seedModerationMedia(overrides)
    await seedActiveLease()
}

async function postImageApproval(
    id: string,
    body: unknown,
    mediaBucket: R2Bucket,
    imagesBinding = createMockImagesBinding(),
    sessionToken = 'session-token',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/admin/image-approvals/${id}`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
            },
        },
        requestEnv(mediaBucket, imagesBinding),
    )
}

async function postReportAction(
    id: string,
    rating: string,
    action: string,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
    accept = 'application/json',
): Promise<Response> {
    return adminPageActionRoutes.request(
        `https://example.com/admin/reports/images/${id}/${rating}/${action}`,
        {
            method: 'POST',
            body: JSON.stringify({}),
            headers: {
                'content-type': 'application/json',
                accept,
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
            },
        },
        requestEnv(mediaBucket),
    )
}

async function postAdminJobRun(
    jobName: string,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
    accept = 'application/json',
): Promise<Response> {
    return adminPageActionRoutes.request(
        `https://example.com/admin/admin-options/jobs/${jobName}/run`,
        {
            method: 'POST',
            body: JSON.stringify({}),
            headers: {
                accept,
                'content-type': 'application/json',
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
            },
        },
        requestEnv(mediaBucket),
    )
}

describe('POST /admin/admin-options/jobs/:jobName/run', () => {
    it('rejects invalid job names', async () => {
        await seedCurrentUser()
        const response = await postAdminJobRun('unknown-job', createMockR2Bucket())
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Admin job is invalid'})
    })

    it('runs R2 media cleanup and records a successful job result', async () => {
        await seedCurrentUser()
        const response = await postAdminJobRun('r2-media-cleanup', createMockR2Bucket())
        const body = (await response.json()) as {ok: true; run: {runId: string; jobName: string; status: string; summary: unknown}}
        const run = await queryOne<{
            job_name: string
            trigger_source: string
            triggered_by_user_id: string | null
            status: string
            summary_json: string | null
        }>('SELECT job_name, trigger_source, triggered_by_user_id, status, summary_json FROM admin_job_runs WHERE id = ?', [body.run.runId])
        expect(response.status).toBe(200)
        expect(body.run).toMatchObject({jobName: 'r2-media-cleanup', status: 'success', summary: {scanned: 0, deleted: 0}})
        expect(run).toMatchObject({
            job_name: 'r2-media-cleanup',
            trigger_source: 'manual',
            triggered_by_user_id: currentUserId,
            status: 'success',
        })
        expect(JSON.parse(run?.summary_json ?? '{}')).toMatchObject({scanned: 0, deleted: 0})
    })

    it('redirects HTML job run requests back to admin options', async () => {
        await seedCurrentUser()
        const response = await postAdminJobRun('r2-media-cleanup', createMockR2Bucket(), 'session-token', 'text/html')
        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe('/admin/admin-options?status=success&job=r2-media-cleanup')
    })
})

describe('POST /admin/image-approvals/:mediaId', () => {
    it('returns 401 when posting an approval without a session', async () => {
        const response = await apiRoutes.request(
            'https://example.com/admin/image-approvals/media-1',
            {method: 'POST', body: JSON.stringify({sfwAction: 'approve_sfw_homepage'}), headers: {'content-type': 'application/json'}},
            requestEnv(createMockR2Bucket()),
        )
        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({error: 'Authentication required'})
    })

    it('returns 400 for invalid JSON bodies', async () => {
        await seedCurrentUser('moderator')
        const sessionToken = 'session-token'
        const response = await apiRoutes.request(
            'https://example.com/admin/image-approvals/media-1',
            {
                method: 'POST',
                body: '{bad json',
                headers: {
                    'content-type': 'application/json',
                    cookie: `myoc_session=${sessionToken}`,
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            requestEnv(createMockR2Bucket()),
        )
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Invalid JSON body'})
    })

    it('returns 400 for a JSON body that is not an object', async () => {
        await seedCurrentUser('moderator')
        const response = await postImageApproval(mediaId, [], createMockR2Bucket())
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Invalid JSON body'})
    })

    it.each([
        [{sfwAction: 'bogus'}, 'SFW action is invalid'],
        [{nsfwAction: 'bogus'}, 'NSFW action is invalid'],
        [{sfwAction: 'approve_nsfw'}, 'SFW action is invalid'],
        [{nsfwAction: 'approve_sfw_homepage'}, 'NSFW action is invalid'],
        [{}, 'At least one approval action is required'],
    ])('returns 400 when approval validation fails', async (body, error) => {
        await seedCurrentUser()
        const response = await postImageApproval(mediaId, body, createMockR2Bucket())
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error})
    })

    it('returns 409 when the review lease is no longer active', async () => {
        await seedCurrentUser()
        await seedModerationMedia()
        const response = await postImageApproval(mediaId, {sfwAction: 'approve_sfw_homepage'}, createMockR2Bucket())
        expect(response.status).toBe(409)
        await expect(response.json()).resolves.toEqual({error: 'Image review lease is no longer active'})
    })

    it.each([
        [{sfwImageKey: null, nsfwImageKey: 'nsfw-key'}, {sfwAction: 'approve_sfw_homepage'}, 'This media row does not have an SFW image'],
        [{nsfwImageKey: null}, {nsfwAction: 'approve_nsfw'}, 'This media row does not have an NSFW image'],
        [{nsfwImageKey: 'nsfw-key'}, {sfwAction: 'mark_nsfw'}, 'Cannot mark SFW as NSFW when the media row already has an NSFW image'],
        [
            {nsfwImageKey: 'nsfw-key'},
            {nsfwAction: 'mark_sfw_homepage'},
            'Cannot mark NSFW as SFW when the media row already has an SFW image',
        ],
    ])('returns 400 when the media shape cannot support the requested action', async (media, body, error) => {
        await seedApprovalMedia({id: mediaId, userId: ownerId, characterId, ...media})
        const response = await postImageApproval(mediaId, body, createMockR2Bucket())
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error})
    })

    it('approves an SFW image for homepage display', async () => {
        await seedApprovalMedia()
        const response = await postImageApproval(mediaId, {sfwAction: 'approve_sfw_homepage'}, createMockR2Bucket())
        const media = await queryOne<{sfw_review_status: string; sfw_homepage_allowed: number; sfw_approved_at: string | null}>(
            'SELECT sfw_review_status, sfw_homepage_allowed, sfw_approved_at FROM character_media WHERE id = ?',
            [mediaId],
        )
        const events = await queryAll<{image_rating: string; action: string; homepage_allowed: number; moderator_id: string}>(
            'SELECT image_rating, action, homepage_allowed, moderator_id FROM character_media_review_events WHERE media_id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toMatchObject({sfw_review_status: 'approved', sfw_homepage_allowed: 1})
        expect(media?.sfw_approved_at).toEqual(expect.any(String))
        expect(events).toEqual([{image_rating: 'sfw', action: 'approve_sfw_homepage', homepage_allowed: 1, moderator_id: currentUserId}])
    })

    it('records reported SFW and approved NSFW review actions together', async () => {
        await seedApprovalMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            nsfwImageKey: 'nsfw-key',
            nsfwPreviewImageKey: 'nsfw-preview-key',
        })
        const response = await postImageApproval(mediaId, {sfwAction: 'report_sfw', nsfwAction: 'approve_nsfw'}, createMockR2Bucket())
        const media = await queryOne<{sfw_review_status: string; nsfw_review_status: string}>(
            'SELECT sfw_review_status, nsfw_review_status FROM character_media WHERE id = ?',
            [mediaId],
        )
        const events = await queryAll<{image_rating: string; action: string}>(
            'SELECT image_rating, action FROM character_media_review_events WHERE media_id = ? ORDER BY image_rating',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({sfw_review_status: 'reported', nsfw_review_status: 'approved'})
        expect(events).toEqual([
            {image_rating: 'nsfw', action: 'approve_nsfw'},
            {image_rating: 'sfw', action: 'report_sfw'},
        ])
    })

    it('reports an NSFW image without changing saved SFW review state', async () => {
        await seedApprovalMedia(
            {
                id: mediaId,
                userId: ownerId,
                characterId,
                sfwImageKey: null,
                nsfwImageKey: 'nsfw-key',
                sfwReviewStatus: 'approved',
                sfwReviewedAt: '2026-01-02 00:00:00',
                sfwApprovedAt: '2026-01-02 00:00:00',
                sfwHomepageAllowed: true,
            },
            'moderator',
        )
        const response = await postImageApproval(mediaId, {nsfwAction: 'report_nsfw'}, createMockR2Bucket())
        const media = await queryOne<{
            sfw_review_status: string
            sfw_reviewed_at: string | null
            sfw_approved_at: string | null
            sfw_homepage_allowed: number
            nsfw_review_status: string
            nsfw_approved_at: string | null
        }>(
            `SELECT sfw_review_status, sfw_reviewed_at, sfw_approved_at, sfw_homepage_allowed, nsfw_review_status, nsfw_approved_at
             FROM character_media WHERE id = ?`,
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({
            sfw_review_status: 'approved',
            sfw_reviewed_at: '2026-01-02 00:00:00',
            sfw_approved_at: '2026-01-02 00:00:00',
            sfw_homepage_allowed: 1,
            nsfw_review_status: 'reported',
            nsfw_approved_at: null,
        })
    })

    it('moves an SFW image to the NSFW path when marked NSFW', async () => {
        await seedApprovalMedia()
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp', new Uint8Array([4, 5, 6]))
        const response = await postImageApproval(mediaId, {sfwAction: 'mark_nsfw'}, mediaBucket, imagesBinding)
        const media = await queryOne<{sfw_image_key: string | null; nsfw_image_key: string | null; nsfw_blur_image_key: string | null}>(
            'SELECT sfw_image_key, nsfw_image_key, nsfw_blur_image_key FROM character_media WHERE id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        await expectStoredBytes(mediaBucket, 'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        await expectStoredBytes(
            mediaBucket,
            'characters/owner-1/character-1/media/media-1/nsfw/preview/sfw-preview-key.webp',
            new Uint8Array([4, 5, 6]),
        )
        expectNsfwBlurTransform(imagesBinding)
        expect(media).toMatchObject({sfw_image_key: null, nsfw_image_key: 'sfw-key'})
        expect(media?.nsfw_blur_image_key).toEqual(expect.any(String))
    })

    it('moves an SFW image to NSFW without preview objects when no preview key exists', async () => {
        await seedApprovalMedia({id: mediaId, userId: ownerId, characterId, sfwPreviewImageKey: null})
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        const response = await postImageApproval(mediaId, {sfwAction: 'mark_nsfw'}, mediaBucket)
        expect(response.status).toBe(200)
        await expectStoredBytes(mediaBucket, 'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        expect(await mediaBucket.get('characters/owner-1/character-1/media/media-1/nsfw/preview/sfw-preview-key.webp')).toBeNull()
    })

    it('moves an NSFW image to SFW and deletes the old blur image', async () => {
        await seedApprovalMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            sfwImageKey: null,
            sfwPreviewImageKey: null,
            nsfwImageKey: 'nsfw-key',
            nsfwArtist: 'NSFW Artist',
            nsfwPreviewImageKey: 'nsfw-preview-key',
            nsfwBlurImageKey: 'nsfw-blur-key',
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png', new Uint8Array([1, 2, 3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp', new Uint8Array([4, 5, 6]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp', new Uint8Array([7, 8, 9]))
        const response = await postImageApproval(mediaId, {nsfwAction: 'mark_sfw_homepage'}, mediaBucket)
        const media = await queryOne<{sfw_image_key: string | null; nsfw_image_key: string | null; sfw_homepage_allowed: number}>(
            'SELECT sfw_image_key, nsfw_image_key, sfw_homepage_allowed FROM character_media WHERE id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        await expectStoredBytes(mediaBucket, 'characters/owner-1/character-1/media/media-1/sfw/nsfw-key.png', new Uint8Array([1, 2, 3]))
        expect(await mediaBucket.get('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png')).toBeNull()
        expect(await mediaBucket.get('characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp')).toBeNull()
        expect(media).toEqual({sfw_image_key: 'nsfw-key', nsfw_image_key: null, sfw_homepage_allowed: 1})
    })

    it('moves an NSFW image without optional media objects or a stored content type', async () => {
        await seedApprovalMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            sfwImageKey: null,
            sfwContentType: null,
            sfwPreviewImageKey: null,
            nsfwImageKey: 'nsfw-key',
            nsfwContentType: null,
            nsfwPreviewImageKey: null,
            nsfwBlurImageKey: null,
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png', new Uint8Array([1, 2, 3]))

        const response = await postImageApproval(mediaId, {nsfwAction: 'mark_sfw_no_homepage'}, mediaBucket)
        const media = await queryOne<{
            sfw_image_key: string | null
            sfw_content_type: string | null
            nsfw_image_key: string | null
            nsfw_preview_image_key: string | null
        }>('SELECT sfw_image_key, sfw_content_type, nsfw_image_key, nsfw_preview_image_key FROM character_media WHERE id = ?', [mediaId])

        expect(response.status).toBe(200)
        await expectStoredBytes(mediaBucket, 'characters/owner-1/character-1/media/media-1/sfw/nsfw-key.png', new Uint8Array([1, 2, 3]))
        expect(media).toEqual({sfw_image_key: 'nsfw-key', sfw_content_type: null, nsfw_image_key: null, nsfw_preview_image_key: null})
        const optionalObjects = await mediaBucket.list({prefix: 'characters/owner-1/character-1/media/media-1/nsfw/'})
        expect(optionalObjects.objects).toEqual([])
    })

    it('keeps a successful moderation move when its source cleanup fails', async () => {
        await seedApprovalMedia()
        const mediaBucket = createMockR2Bucket()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const sourceKey = 'characters/owner-1/character-1/media/media-1/sfw/sfw-key.png'
        const targetKey = 'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png'
        await mediaBucket.put(sourceKey, new Uint8Array([1, 2, 3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp', new Uint8Array([4, 5, 6]))
        vi.mocked(mediaBucket.delete).mockRejectedValueOnce(new Error('delete failed'))
        try {
            const response = await postImageApproval(mediaId, {sfwAction: 'mark_nsfw'}, mediaBucket)
            expect(response.status).toBe(200)
            await expectStoredBytes(mediaBucket, sourceKey, new Uint8Array([1, 2, 3]))
            await expectStoredBytes(mediaBucket, targetKey, new Uint8Array([1, 2, 3]))
        } finally {
            warning.mockRestore()
        }
    })

    it('removes copied moderation objects when the approval transaction fails', async () => {
        await seedApprovalMedia({id: mediaId, userId: ownerId, characterId, sfwPreviewImageKey: null})
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        try {
            const response = await withFailingTrigger(
                {name: 'admin_media_update', operation: 'UPDATE', table: 'character_media'},
                async () => await postImageApproval(mediaId, {sfwAction: 'mark_nsfw'}, mediaBucket),
            )
            expect(response.status).toBe(500)
            expect(await mediaBucket.get('characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png')).toBeNull()
        } finally {
            error.mockRestore()
        }
    })

    it('returns 500 when a moderation move source object is missing from R2', async () => {
        await seedApprovalMedia({id: mediaId, userId: ownerId, characterId, sfwPreviewImageKey: null})
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        try {
            const response = await postImageApproval(mediaId, {sfwAction: 'mark_nsfw'}, createMockR2Bucket())
            expect(response.status).toBe(500)
        } finally {
            error.mockRestore()
        }
    })
})

describe('POST /admin/reports/images/:mediaId/:rating/:action', () => {
    it('returns 401 when report moderation is requested without a session', async () => {
        const response = await adminPageActionRoutes.request(
            'https://example.com/admin/reports/images/media-1/sfw/ignore',
            {method: 'POST', body: JSON.stringify({}), headers: {'content-type': 'application/json'}},
            requestEnv(createMockR2Bucket()),
        )
        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({error: 'Authentication required'})
    })

    it('returns 403 for moderator users', async () => {
        await seedCurrentUser('moderator')
        const response = await postReportAction(mediaId, 'sfw', 'ignore', createMockR2Bucket())
        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({error: 'Admin access required'})
    })

    it('returns 400 for invalid report actions', async () => {
        await seedCurrentUser()
        const response = await postReportAction(mediaId, 'private', 'ignore', createMockR2Bucket())
        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Report action is invalid'})
    })

    it('redirects HTML report action requests back to the reports page', async () => {
        await seedCurrentUser()
        const response = await postReportAction(mediaId, 'private', 'ignore', createMockR2Bucket(), 'session-token', 'text/html')
        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe('/admin/reports')
    })

    it('returns 404 when the reported media row does not exist', async () => {
        await seedCurrentUser()
        const response = await postReportAction('missing-media', 'sfw', 'ignore', createMockR2Bucket())
        expect(response.status).toBe(404)
        await expect(response.json()).resolves.toEqual({error: 'Reported media not found'})
    })

    it.each([
        [{sfwImageKey: null, nsfwImageKey: 'nsfw-key'}, 'sfw', 'Reported image not found', 404],
        [{sfwReviewStatus: 'approved'}, 'sfw', 'Image is not currently reported', 400],
    ] as const)('validates reported media state', async (media, rating, error, status) => {
        await seedCurrentUser()
        await seedModerationMedia({id: mediaId, userId: ownerId, characterId, sfwReviewStatus: 'reported', ...media})
        const response = await postReportAction(mediaId, rating, 'ignore', createMockR2Bucket())
        expect(response.status).toBe(status)
        await expect(response.json()).resolves.toEqual({error})
    })

    it('ignores an image report by moving it back to pending review', async () => {
        await seedCurrentUser()
        await seedModerationMedia({id: mediaId, userId: ownerId, characterId, sfwReviewStatus: 'reported'})
        const response = await postReportAction(mediaId, 'sfw', 'ignore', createMockR2Bucket())
        const media = await queryOne<{sfw_review_status: string; sfw_homepage_allowed: number}>(
            'SELECT sfw_review_status, sfw_homepage_allowed FROM character_media WHERE id = ?',
            [mediaId],
        )
        const events = await queryAll<{image_rating: string; action: string}>(
            'SELECT image_rating, action FROM character_media_review_events WHERE media_id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({sfw_review_status: 'pending', sfw_homepage_allowed: 0})
        expect(events).toEqual([{image_rating: 'sfw', action: 'ignore_report'}])
    })

    it('ignores an NSFW image report by moving it back to pending review', async () => {
        await seedCurrentUser()
        await seedModerationMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            nsfwImageKey: 'nsfw-key',
            sfwReviewStatus: 'pending',
            nsfwReviewStatus: 'reported',
        })
        const response = await postReportAction(mediaId, 'nsfw', 'ignore', createMockR2Bucket())
        const media = await queryOne<{nsfw_review_status: string}>('SELECT nsfw_review_status FROM character_media WHERE id = ?', [mediaId])
        const event = await queryOne<{image_rating: string; action: string}>(
            'SELECT image_rating, action FROM character_media_review_events WHERE media_id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({nsfw_review_status: 'pending'})
        expect(event).toEqual({image_rating: 'nsfw', action: 'ignore_report'})
    })

    it('deletes a reported image variant from D1 and R2', async () => {
        await seedCurrentUser()
        await seedModerationMedia({id: mediaId, userId: ownerId, characterId, sfwReviewStatus: 'reported'})
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        const response = await postReportAction(mediaId, 'sfw', 'delete-image', mediaBucket)
        expect(response.status).toBe(200)
        await expect(queryOne('SELECT id FROM character_media WHERE id = ?', [mediaId])).resolves.toBeNull()
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })

    it('clears a reported SFW image while preserving an existing NSFW image', async () => {
        await seedCurrentUser()
        await seedModerationMedia({id: mediaId, userId: ownerId, characterId, sfwReviewStatus: 'reported', nsfwImageKey: 'nsfw-key'})
        const mediaBucket = createMockR2Bucket()
        const response = await postReportAction(mediaId, 'sfw', 'delete-image', mediaBucket)
        const media = await queryOne<{sfw_image_key: string | null; nsfw_image_key: string | null}>(
            'SELECT sfw_image_key, nsfw_image_key FROM character_media WHERE id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({sfw_image_key: null, nsfw_image_key: 'nsfw-key'})
        expectBucketDeletes(mediaBucket, [
            'characters/owner-1/character-1/media/media-1/sfw/sfw-key.png',
            'characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp',
        ])
    })

    it('clears a reported NSFW image while preserving an existing SFW image', async () => {
        await seedCurrentUser()
        await seedModerationMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            sfwReviewStatus: 'approved',
            nsfwImageKey: 'nsfw-key',
            nsfwPreviewImageKey: 'nsfw-preview-key',
            nsfwBlurImageKey: 'nsfw-blur-key',
            nsfwReviewStatus: 'reported',
        })
        const mediaBucket = createMockR2Bucket()
        const response = await postReportAction(mediaId, 'nsfw', 'delete-image', mediaBucket)
        const media = await queryOne<{sfw_image_key: string | null; nsfw_image_key: string | null}>(
            'SELECT sfw_image_key, nsfw_image_key FROM character_media WHERE id = ?',
            [mediaId],
        )
        expect(response.status).toBe(200)
        expect(media).toEqual({sfw_image_key: 'sfw-key', nsfw_image_key: null})
        expectBucketDeletes(mediaBucket, [
            'characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png',
            'characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp',
            'characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp',
        ])
    })

    it('deletes the reported character and all character media objects', async () => {
        await seedCurrentUser()
        await seedModerationMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            sfwReviewStatus: 'reported',
            nsfwImageKey: 'nsfw-key',
            nsfwPreviewImageKey: 'nsfw-preview-key',
            nsfwBlurImageKey: 'nsfw-blur-key',
        })
        const mediaBucket = createMockR2Bucket()
        const response = await postReportAction(mediaId, 'sfw', 'delete-character', mediaBucket)
        expect(response.status).toBe(200)
        await expect(queryOne('SELECT id FROM characters WHERE id = ?', [characterId])).resolves.toBeNull()
        await expect(queryOne('SELECT id FROM character_media WHERE id = ?', [mediaId])).resolves.toBeNull()
        expectBucketDeletes(mediaBucket, reportedCharacterMediaR2Keys)
    })

    it('bans a user, deletes their content rows, clears sessions, and removes R2 objects', async () => {
        await seedCurrentUser()
        await seedUser({id: ownerId, email: 'owner@example.test', username: 'owner_user', profilePhotoKey: 'profile-key'})
        await seedCharacter({id: characterId, userId: ownerId, name: 'Quartz', profileImageKey: 'character-profile-key'})
        await seedMedia({
            id: mediaId,
            userId: ownerId,
            characterId,
            sfwImageKey: 'sfw-key',
            nsfwImageKey: 'nsfw-key',
            sfwPreviewImageKey: 'sfw-preview-key',
            nsfwPreviewImageKey: 'nsfw-preview-key',
            nsfwBlurImageKey: 'nsfw-blur-key',
            sfwReviewStatus: 'reported',
        })
        const mediaBucket = createMockR2Bucket()
        const response = await postReportAction(mediaId, 'sfw', 'ban-user', mediaBucket)
        const owner = await queryOne<{banned_at: string | null; banned_by_user_id: string | null}>(
            'SELECT banned_at, banned_by_user_id FROM users WHERE id = ?',
            [ownerId],
        )
        expect(response.status).toBe(200)
        expect(owner?.banned_at).toEqual(expect.any(String))
        expect(owner?.banned_by_user_id).toBe(currentUserId)
        await expect(queryOne('SELECT id FROM sessions WHERE user_id = ?', [ownerId])).resolves.toBeNull()
        await expect(queryOne('SELECT id FROM characters WHERE user_id = ?', [ownerId])).resolves.toBeNull()
        expectBucketDeletes(mediaBucket, ['users/owner-1/profile/profile-key.webp', ...reportedCharacterMediaR2Keys])
    })
})

async function expectStoredBytes(bucket: R2Bucket, key: string, expected: Uint8Array): Promise<void> {
    const object = await bucket.get(key)
    if (!object) throw new Error(`Expected R2 object to exist: ${key}`)
    expect(await object.bytes()).toEqual(expected)
}
