import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {createMockImagesBinding} from '../../test/mockImages'
import {createMockKVNamespace} from '../../test/mockKV'
import {createMockR2Bucket} from '../../test/mockR2'
import {apiRoutes} from '../api'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const reportedCharacterMediaR2Keys = [
    'characters/owner-1/character-1/profile/character-profile-key.webp',
    'characters/owner-1/character-1/media/media-1/sfw/sfw-key.png',
    'characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp',
    'characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png',
    'characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp',
    'characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp',
] as const

function createCurrentUserRecord(role: 'user' | 'moderator' | 'admin') {
    return {
        id: 'current-user',
        email: 'current@example.test',
        username: 'current_user',
        role,
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
    }
}

function requestEnv(db: D1Database, mediaBucket = createMockR2Bucket(), imagesBinding = createMockImagesBinding()) {
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
    expect(imagesBinding.input).toHaveBeenCalledTimes(1)
    const imageTransformer = vi.mocked(imagesBinding.input).mock.results[0]?.value as ImageTransformer
    ;[{width: 960, fit: 'scale-down'}, {blur: 250}].forEach((transform, index) => {
        expect(imageTransformer.transform).toHaveBeenNthCalledWith(index + 1, transform)
    })
    expect(imageTransformer.output).toHaveBeenCalledWith({format: 'image/webp', quality: 85})
}

function expectBucketDeletes(mediaBucket: R2Bucket, keys: readonly string[]): void {
    for (const key of keys) {
        expect(mediaBucket.delete).toHaveBeenCalledWith(key)
    }
}

async function getAdminApi(db: D1Database, cookie?: string, path = '/admin'): Promise<Response> {
    return apiRoutes.request(
        `https://example.com${path}`,
        {
            headers: cookie ? {cookie} : undefined,
        },
        requestEnv(db),
    )
}

async function postImageApproval(
    mediaId: string,
    body: unknown,
    db: D1Database,
    mediaBucket: R2Bucket,
    imagesBinding = createMockImagesBinding(),
    sessionToken = 'session-token',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/admin/image-approvals/${mediaId}`,
        {
            method: 'POST',
            body: JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
            },
        },
        requestEnv(db, mediaBucket, imagesBinding),
    )
}

async function postReportAction(
    mediaId: string,
    rating: string,
    action: string,
    db: D1Database,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
    accept = 'application/json',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/admin/reports/images/${mediaId}/${rating}/${action}`,
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
        requestEnv(db, mediaBucket),
    )
}

async function postAdminJobRun(
    jobName: string,
    db: D1Database,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
    accept = 'application/json',
): Promise<Response> {
    return apiRoutes.request(
        `https://example.com/admin/jobs/${jobName}/run`,
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
        requestEnv(db, mediaBucket),
    )
}

describe('GET /admin', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await getAdminApi(db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when the user is not an admin', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('user')],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Admin access required',
        })
    })

    it('returns 403 for moderator users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('moderator')],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Admin access required',
        })
    })

    it('returns 200 for admin users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })
    })
})

describe('GET /admin/image-approvals', () => {
    it('returns 401 when image approval data is requested without a session', async () => {
        const {db} = createMockDb()

        const response = await getAdminApi(db, undefined, '/admin/image-approvals')

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns pending image approval data for admin users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), null, createImageApprovalLeaseRow(), {count: 1}, createImageApprovalItemRow()],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals')
        const body = (await response.json()) as {
            current: {id: string; sfw: {objectKey: string}}
            pendingCount: number
            leaseExpiresAt: string | null
        }

        expect(response.status).toBe(200)
        expect(body.current.id).toBe('media-1')
        expect(body.current.sfw.objectKey).toBe('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(body.pendingCount).toBe(1)
        expect(body.leaseExpiresAt).toBe('2026-06-10 12:30:00')
    })

    it('returns pending image approval data for moderator users', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('moderator'),
                null,
                createImageApprovalLeaseRow(),
                {count: 1},
                createImageApprovalItemRow(),
            ],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals')
        const body = (await response.json()) as {
            current: {id: string}
            pendingCount: number
        }

        expect(response.status).toBe(200)
        expect(body.current.id).toBe('media-1')
        expect(body.pendingCount).toBe(1)
    })

    it('returns an exact pending approval count when the queue exceeds the sidebar page size', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                null,
                createImageApprovalLeaseRow({media_id: 'media-0'}),
                {count: 125},
                {
                    ...createImageApprovalItemRow(),
                    id: 'media-0',
                },
            ],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals')
        const body = (await response.json()) as {
            pendingCount: number
        }
        const leaseStatement = boundStatements.find((statement) => statement.sql.includes('RETURNING media_id'))

        expect(response.status).toBe(200)
        expect(body.pendingCount).toBe(125)
        expect(leaseStatement?.binds[1]).toBe('current-user')
    })

    it('returns no current review when no lease is available', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), null, null, {count: 0}],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals?mediaId=history-media')
        const body = (await response.json()) as {
            current: unknown
            pendingCount: number
        }

        expect(response.status).toBe(200)
        expect(body.current).toBeNull()
        expect(body.pendingCount).toBe(0)
    })
})

describe('GET /admin/jobs', () => {
    it('returns 401 when job history is requested without a session', async () => {
        const {db} = createMockDb()

        const response = await getAdminApi(db, undefined, '/admin/jobs')

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns recent job runs for admin users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
            allResults: [
                [
                    {
                        id: 'run-1',
                        job_name: 'r2-media-cleanup',
                        trigger_source: 'manual',
                        triggered_by_user_id: 'current-user',
                        triggered_by_username: 'current_user',
                        cron: null,
                        status: 'success',
                        started_at: '2026-07-11 09:00:00',
                        finished_at: '2026-07-11 09:00:01',
                        duration_ms: 1000,
                        summary_json: JSON.stringify({
                            deleted: 0,
                            errors: 0,
                            keptReferenced: 0,
                            recognized: 0,
                            scanned: 0,
                            skippedRecent: 0,
                            skippedUnknown: 0,
                            stoppedAtDeleteLimit: false,
                        }),
                        error_message: null,
                    },
                ],
            ],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/jobs')
        const body = (await response.json()) as {runs: Array<{jobName: string; label: string; triggerSource: string}>}

        expect(response.status).toBe(200)
        expect(body.runs).toEqual([
            expect.objectContaining({
                jobName: 'r2-media-cleanup',
                label: 'R2 Media Cleanup',
                triggerSource: 'manual',
            }),
        ])
    })

    it('returns 403 for moderator users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('moderator')],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/jobs')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Admin access required',
        })
    })
})

describe('POST /admin/jobs/:jobName/run', () => {
    it('rejects invalid job names', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postAdminJobRun('unknown-job', db, mediaBucket)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Admin job is invalid',
        })
    })

    it('runs R2 media cleanup and records a successful job result', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postAdminJobRun('r2-media-cleanup', db, mediaBucket)
        const body = (await response.json()) as {
            ok: true
            run: {jobName: string; status: string; summary: {scanned: number; deleted: number}}
        }

        expect(response.status).toBe(200)
        expect(body.ok).toBe(true)
        expect(body.run).toEqual(
            expect.objectContaining({
                jobName: 'r2-media-cleanup',
                status: 'success',
                summary: expect.objectContaining({
                    scanned: 0,
                    deleted: 0,
                }),
            }),
        )
        expect(boundStatements).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    binds: expect.arrayContaining(['r2-media-cleanup', 'manual', 'current-user', 'running']),
                    sql: expect.stringMatching(/INSERT\s+INTO\s+admin_job_runs/),
                }),
                expect.objectContaining({
                    binds: expect.arrayContaining(['success']),
                    sql: expect.stringContaining('UPDATE admin_job_runs'),
                }),
            ]),
        )
    })

    it('redirects HTML job run requests back to admin options', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postAdminJobRun('r2-media-cleanup', db, mediaBucket, 'session-token', 'text/html')

        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe('/admin/admin-options?status=success&job=r2-media-cleanup')
    })
})

describe('POST /admin/image-approvals/:mediaId', () => {
    it('returns 401 when posting an approval without a session', async () => {
        const {db} = createMockDb()
        const mediaBucket = createMockR2Bucket()

        const response = await apiRoutes.request(
            'https://example.com/admin/image-approvals/media-1',
            {
                method: 'POST',
                body: JSON.stringify({sfwAction: 'approve_sfw_homepage'}),
                headers: {
                    'content-type': 'application/json',
                },
            },
            requestEnv(db, mediaBucket),
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 400 for invalid JSON bodies', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('moderator')],
        })
        const mediaBucket = createMockR2Bucket()
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
            requestEnv(db, mediaBucket),
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it.each([
        {
            body: {sfwAction: 'bogus'},
            error: 'SFW action is invalid',
        },
        {
            body: {nsfwAction: 'bogus'},
            error: 'NSFW action is invalid',
        },
        {
            body: {sfwAction: 'approve_nsfw'},
            error: 'SFW action is invalid',
        },
        {
            body: {nsfwAction: 'approve_sfw_homepage'},
            error: 'NSFW action is invalid',
        },
        {
            body: {},
            error: 'At least one approval action is required',
        },
    ])('returns 400 when approval validation fails with $error', async ({body, error}) => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval('media-1', body, db, mediaBucket)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('returns 404 when the media row does not exist', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createImageApprovalLeaseRow(), null],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval(
            'missing-media',
            {
                sfwAction: 'approve_sfw_homepage',
            },
            db,
            mediaBucket,
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Media not found',
        })
    })

    it.each([
        {
            media: createModerationMediaRow({sfw_image_key: null}),
            body: {sfwAction: 'approve_sfw_homepage'},
            error: 'This media row does not have an SFW image',
        },
        {
            media: createModerationMediaRow({nsfw_image_key: null}),
            body: {nsfwAction: 'approve_nsfw'},
            error: 'This media row does not have an NSFW image',
        },
        {
            media: createModerationMediaRow({
                nsfw_image_key: 'nsfw-key',
                nsfw_content_type: 'image/png',
            }),
            body: {sfwAction: 'mark_nsfw'},
            error: 'Cannot mark SFW as NSFW when the media row already has an NSFW image',
        },
        {
            media: createModerationMediaRow({
                nsfw_image_key: 'nsfw-key',
                nsfw_content_type: 'image/png',
            }),
            body: {nsfwAction: 'mark_sfw_homepage'},
            error: 'Cannot mark NSFW as SFW when the media row already has an SFW image',
        },
    ])('returns 400 when the media shape cannot support the requested action', async ({media, body, error}) => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createImageApprovalLeaseRow(), media],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval('media-1', body, db, mediaBucket)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error})
        expect(db.batch).not.toHaveBeenCalled()
    })

    it('approves an SFW image for homepage display', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createImageApprovalLeaseRow(), createModerationMediaRow()],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval(
            'media-1',
            {
                sfwAction: 'approve_sfw_homepage',
            },
            db,
            mediaBucket,
        )

        expect(response.status).toBe(200)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[3]?.sql).toContain('UPDATE character_media')
        expect(boundStatements[3]?.binds[20]).toBe(1)
        expect(boundStatements[3]?.binds[21]).toBe('approved')
        expect(boundStatements[3]?.binds[26]).toBe(1)
        expect(boundStatements[3]?.binds[27]).toBe(1)
        expect(boundStatements[4]?.sql).toContain(['INSERT INTO', 'character_media_review_events'].join(' '))
        expect(boundStatements[4]?.binds[3]).toBe('approve_sfw_homepage')
    })

    it('records reported SFW and approved NSFW review actions together', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalLeaseRow(),
                createModerationMediaRow({
                    nsfw_image_key: 'nsfw-key',
                    nsfw_content_type: 'image/png',
                    nsfw_width: 800,
                    nsfw_height: 600,
                    nsfw_byte_size: 2048,
                    nsfw_preview_image_key: 'nsfw-preview-key',
                    nsfw_preview_width: 800,
                    nsfw_preview_height: 600,
                    nsfw_preview_byte_size: 512,
                }),
            ],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval(
            'media-1',
            {
                sfwAction: 'report_sfw',
                nsfwAction: 'approve_nsfw',
            },
            db,
            mediaBucket,
        )

        expect(response.status).toBe(200)
        expect(boundStatements[3]?.binds[21]).toBe('reported')
        expect(boundStatements[3]?.binds[29]).toBe('approved')
        expect(boundStatements[4]?.binds[2]).toBe('sfw')
        expect(boundStatements[4]?.binds[3]).toBe('report_sfw')
        expect(boundStatements[5]?.binds[2]).toBe('nsfw')
        expect(boundStatements[5]?.binds[3]).toBe('approve_nsfw')
    })

    it('moves an SFW image to the NSFW path when marked NSFW', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createImageApprovalLeaseRow(), createModerationMediaRow()],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()
        const imagesBinding = createMockImagesBinding()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp', new Uint8Array([4, 5, 6]))

        const response = await postImageApproval(
            'media-1',
            {
                sfwAction: 'mark_nsfw',
            },
            db,
            mediaBucket,
            imagesBinding,
        )

        expect(response.status).toBe(200)
        expect(mediaBucket.get).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/nsfw/preview/sfw-preview-key.webp',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expectNsfwBlurTransform(imagesBinding)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            expect.stringMatching(/^characters\/owner-1\/character-1\/media\/media-1\/nsfw\/blur\/[0-9a-f-]+\.webp$/),
            expect.any(Uint8Array),
            {
                httpMetadata: {
                    cacheControl: 'public, max-age=31536000, immutable',
                    contentType: 'image/webp',
                },
            },
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp')
        expect(boundStatements[3]?.binds[0]).toBeNull()
        expect(boundStatements[3]?.binds[1]).toBe('sfw-key')
        expect(boundStatements[3]?.binds[9]).toBeNull()
        expect(boundStatements[3]?.binds[16]).toBe('sfw-preview-key')
        expect(boundStatements[3]?.binds[34]).toMatch(/^[0-9a-f-]+$/)
        expect(boundStatements[3]?.binds[28]).toBe(1)
        expect(boundStatements[3]?.binds[29]).toBe('approved')
        expect(boundStatements[4]?.binds[3]).toBe('mark_nsfw')
    })

    it('moves an SFW image to NSFW without preview objects when no preview key exists', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalLeaseRow(),
                createModerationMediaRow({
                    sfw_preview_image_key: null,
                    sfw_preview_width: null,
                    sfw_preview_height: null,
                    sfw_preview_byte_size: null,
                }),
            ],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))

        const response = await postImageApproval(
            'media-1',
            {
                sfwAction: 'mark_nsfw',
            },
            db,
            mediaBucket,
        )

        expect(response.status).toBe(200)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expect(mediaBucket.put).not.toHaveBeenCalledWith(expect.stringContaining('/preview/'), expect.anything(), expect.anything())
        expect(boundStatements[3]?.binds[16]).toBeNull()
        expect(boundStatements[3]?.binds[34]).toBeNull()
    })

    it('moves an NSFW image to SFW and deletes the old blur image', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalLeaseRow(),
                createModerationMediaRow({
                    sfw_image_key: null,
                    sfw_content_type: null,
                    sfw_artist: '',
                    sfw_width: null,
                    sfw_height: null,
                    sfw_byte_size: null,
                    sfw_preview_image_key: null,
                    sfw_preview_width: null,
                    sfw_preview_height: null,
                    sfw_preview_byte_size: null,
                    nsfw_image_key: 'nsfw-key',
                    nsfw_content_type: 'image/png',
                    nsfw_artist: 'NSFW Artist',
                    nsfw_width: 700,
                    nsfw_height: 500,
                    nsfw_byte_size: 2048,
                    nsfw_preview_image_key: 'nsfw-preview-key',
                    nsfw_blur_image_key: 'nsfw-blur-key',
                    nsfw_preview_width: 700,
                    nsfw_preview_height: 500,
                    nsfw_preview_byte_size: 512,
                }),
            ],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png', new Uint8Array([1, 2, 3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp', new Uint8Array([4, 5, 6]))

        const response = await postImageApproval(
            'media-1',
            {
                nsfwAction: 'mark_sfw_homepage',
            },
            db,
            mediaBucket,
        )

        expect(response.status).toBe(200)
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/sfw/nsfw-key.png',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/sfw/preview/nsfw-preview-key.webp',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp')
        expect(boundStatements[3]?.binds[0]).toBe('nsfw-key')
        expect(boundStatements[3]?.binds[1]).toBeNull()
        expect(boundStatements[3]?.binds[9]).toBe('nsfw-preview-key')
        expect(boundStatements[3]?.binds[27]).toBe(1)
        expect(boundStatements[4]?.binds[3]).toBe('mark_sfw_homepage')
    })

    it('removes copied moderation objects when the approval transaction fails', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalLeaseRow(),
                createModerationMediaRow({
                    sfw_preview_image_key: null,
                    sfw_preview_width: null,
                    sfw_preview_height: null,
                    sfw_preview_byte_size: null,
                }),
            ],
            runError: new Error('D1 batch failed'),
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))

        try {
            const response = await postImageApproval(
                'media-1',
                {
                    sfwAction: 'mark_nsfw',
                },
                db,
                mediaBucket,
            )

            expect(response.status).toBe(500)
            expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png')
        } finally {
            error.mockRestore()
        }
    })

    it('returns 500 when a moderation move source object is missing from R2', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalLeaseRow(),
                createModerationMediaRow({
                    sfw_preview_image_key: null,
                    sfw_preview_width: null,
                    sfw_preview_height: null,
                    sfw_preview_byte_size: null,
                }),
            ],
        })
        const mediaBucket = createMockR2Bucket()

        try {
            const response = await postImageApproval(
                'media-1',
                {
                    sfwAction: 'mark_nsfw',
                },
                db,
                mediaBucket,
            )

            expect(response.status).toBe(500)
            expect(mediaBucket.put).not.toHaveBeenCalled()
        } finally {
            error.mockRestore()
        }
    })
})

describe('POST /admin/reports/images/:mediaId/:rating/:action', () => {
    it('returns 401 when report moderation is requested without a session', async () => {
        const {db} = createMockDb()
        const mediaBucket = createMockR2Bucket()

        const response = await apiRoutes.request(
            'https://example.com/admin/reports/images/media-1/sfw/ignore',
            {
                method: 'POST',
                body: JSON.stringify({}),
                headers: {
                    'content-type': 'application/json',
                },
            },
            requestEnv(db, mediaBucket),
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 for moderator users', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('moderator')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Admin access required',
        })
    })

    it('returns 400 for invalid report actions', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'private', 'ignore', db, mediaBucket)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Report action is invalid',
        })
    })

    it('redirects HTML report action requests back to the reports page', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin')],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'private', 'ignore', db, mediaBucket, 'session-token', 'text/html')

        expect(response.status).toBe(303)
        expect(response.headers.get('location')).toBe('/admin/reports')
    })

    it('returns 404 when the reported media row does not exist', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), null],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('missing-media', 'sfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Reported media not found',
        })
    })

    it('returns 404 when the requested reported image variant is missing', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow({
                    sfw_image_key: null,
                }),
            ],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'Reported image not found',
        })
    })

    it('returns 400 when the requested image is no longer reported', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow({
                    sfw_review_status: 'approved',
                }),
            ],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Image is not currently reported',
        })
    })

    it('ignores an image report by moving it back to pending review', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createReportedMediaRow()],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[2]?.sql).toContain('sfw_review_status')
        expect(boundStatements[2]?.binds).toEqual(['media-1'])
        expect(boundStatements[3]?.sql).toContain(['INSERT INTO', 'character_media_review_events'].join(' '))
        expect(boundStatements[3]?.binds[3]).toBe('ignore_report')
    })

    it('ignores an NSFW image report by moving it back to pending review', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow({
                    sfw_review_status: 'pending',
                    nsfw_image_key: 'nsfw-key',
                    nsfw_content_type: 'image/png',
                    nsfw_review_status: 'reported',
                }),
            ],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'nsfw', 'ignore', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[2]?.sql).toContain('nsfw_review_status')
        expect(boundStatements[2]?.binds).toEqual(['media-1'])
        expect(boundStatements[3]?.binds[2]).toBe('nsfw')
        expect(boundStatements[3]?.binds[3]).toBe('ignore_report')
    })

    it('deletes a reported image variant from D1 and R2', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createReportedMediaRow()],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))

        const response = await postReportAction('media-1', 'sfw', 'delete-image', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM character_media WHERE id = ?'))).toBe(true)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })

    it('clears a reported SFW image while preserving an existing NSFW image', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow({
                    nsfw_image_key: 'nsfw-key',
                    nsfw_content_type: 'image/png',
                }),
            ],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'delete-image', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('SET sfw_image_key = NULL'))).toBe(true)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp')
    })

    it('clears a reported NSFW image while preserving an existing SFW image', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow({
                    sfw_review_status: 'approved',
                    nsfw_image_key: 'nsfw-key',
                    nsfw_content_type: 'image/png',
                    nsfw_preview_image_key: 'nsfw-preview-key',
                    nsfw_blur_image_key: 'nsfw-blur-key',
                    nsfw_review_status: 'reported',
                }),
            ],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'nsfw', 'delete-image', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('SET nsfw_image_key = NULL'))).toBe(true)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp')
    })

    it('deletes the reported character and all character media objects', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createReportedMediaRow()],
            allResults: [
                [
                    {
                        id: 'media-1',
                        user_id: 'owner-1',
                        character_id: 'character-1',
                        sfw_image_key: 'sfw-key',
                        nsfw_image_key: 'nsfw-key',
                        sfw_content_type: 'image/png',
                        nsfw_content_type: 'image/png',
                        sfw_preview_image_key: 'sfw-preview-key',
                        nsfw_preview_image_key: 'nsfw-preview-key',
                        nsfw_blur_image_key: 'nsfw-blur-key',
                    },
                ],
                [],
            ],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postReportAction('media-1', 'sfw', 'delete-character', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM characters WHERE id = ?'))).toBe(true)
        expectBucketDeletes(mediaBucket, reportedCharacterMediaR2Keys)
    })

    it('bans a user, deletes their content rows, clears sessions, and removes R2 objects', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUserRecord('admin'), createReportedMediaRow(), {profile_photo_key: 'profile-key'}],
            allResults: [
                [
                    {
                        id: 'character-1',
                        user_id: 'owner-1',
                        profile_image_key: 'character-profile-key',
                    },
                ],
                [
                    {
                        id: 'media-1',
                        user_id: 'owner-1',
                        character_id: 'character-1',
                        sfw_image_key: 'sfw-key',
                        nsfw_image_key: 'nsfw-key',
                        sfw_content_type: 'image/png',
                        nsfw_content_type: 'image/png',
                        sfw_preview_image_key: 'sfw-preview-key',
                        nsfw_preview_image_key: 'nsfw-preview-key',
                        nsfw_blur_image_key: 'nsfw-blur-key',
                    },
                ],
                [],
            ],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('users/owner-1/profile/profile-key.webp', new Uint8Array([1]))
        await mediaBucket.put('characters/owner-1/character-1/profile/character-profile-key.webp', new Uint8Array([2]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([3]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/preview/sfw-preview-key.webp', new Uint8Array([4]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png', new Uint8Array([5]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/preview/nsfw-preview-key.webp', new Uint8Array([6]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/nsfw/blur/nsfw-blur-key.webp', new Uint8Array([7]))

        const response = await postReportAction('media-1', 'sfw', 'ban-user', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM sessions WHERE user_id = ?'))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE users') && statement.sql.includes('banned_at'))).toBe(
            true,
        )
        expectBucketDeletes(mediaBucket, ['users/owner-1/profile/profile-key.webp', ...reportedCharacterMediaR2Keys])
    })
})

function createImageApprovalItemRow() {
    return {
        id: 'media-1',
        user_id: 'owner-1',
        username: 'uploader',
        email: 'uploader@example.test',
        character_id: 'character-1',
        character_name: 'Quartz',
        sfw_image_key: 'sfw-key',
        nsfw_image_key: null,
        sfw_content_type: 'image/png',
        nsfw_content_type: null,
        sfw_artist: 'Artist',
        nsfw_artist: '',
        sfw_width: 1200,
        sfw_height: 900,
        sfw_byte_size: 1024,
        sfw_preview_image_key: 'sfw-preview-key',
        sfw_preview_width: 800,
        sfw_preview_height: 600,
        sfw_preview_byte_size: 512,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
        sfw_review_status: 'pending',
        sfw_reviewed_at: null,
        sfw_approved_at: null,
        sfw_homepage_allowed: 0,
        nsfw_review_status: 'pending',
        nsfw_reviewed_at: null,
        nsfw_approved_at: null,
        created_at: '2026-06-10 12:00:00',
        updated_at: '2026-06-10 12:00:00',
    }
}

function createImageApprovalLeaseRow(overrides: Record<string, unknown> = {}) {
    return {
        media_id: 'media-1',
        lease_expires_at: '2026-06-10 12:30:00',
        ...overrides,
    }
}

function createModerationMediaRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'media-1',
        user_id: 'owner-1',
        character_id: 'character-1',
        sfw_image_key: 'sfw-key',
        nsfw_image_key: null,
        sfw_content_type: 'image/png',
        nsfw_content_type: null,
        sfw_artist: 'Artist',
        nsfw_artist: '',
        sfw_width: 1200,
        sfw_height: 900,
        sfw_byte_size: 1024,
        sfw_preview_image_key: 'sfw-preview-key',
        sfw_preview_width: 800,
        sfw_preview_height: 600,
        sfw_preview_byte_size: 512,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
        nsfw_preview_image_key: null,
        nsfw_blur_image_key: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_preview_byte_size: null,
        ...overrides,
    }
}

function createReportedMediaRow(overrides: Record<string, unknown> = {}) {
    return {
        ...createModerationMediaRow(),
        username: 'uploader',
        profile_photo_key: null,
        character_name: 'Quartz',
        profile_image_key: 'character-profile-key',
        sfw_review_status: 'reported',
        nsfw_review_status: 'pending',
        ...overrides,
    }
}
