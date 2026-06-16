import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'

const mediaPublicBaseUrl = 'https://m.myoc.art'

function createCurrentUserRecord(role: 'user' | 'admin') {
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

function requestEnv(db: D1Database, mediaBucket = createMockR2Bucket()) {
    return {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    }
}

async function getAdminApi(db: D1Database, cookie?: string, path = '/admin'): Promise<Response> {
    return apiRoutes.request(`https://example.com${path}`, {
        headers: cookie ? {cookie} : undefined,
    }, requestEnv(db))
}

async function postImageApproval(
    mediaId: string,
    body: unknown,
    db: D1Database,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
): Promise<Response> {
    return apiRoutes.request(`https://example.com/admin/image-approvals/${mediaId}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
            cookie: `myoc_session=${sessionToken}`,
            'x-csrf-token': await createCsrfToken(sessionToken),
        },
    }, requestEnv(db, mediaBucket))
}

async function postReportAction(
    mediaId: string,
    rating: 'sfw' | 'nsfw',
    action: 'ignore' | 'delete-image' | 'delete-character' | 'ban-user',
    db: D1Database,
    mediaBucket: R2Bucket,
    sessionToken = 'session-token',
): Promise<Response> {
    return apiRoutes.request(`https://example.com/admin/reports/images/${mediaId}/${rating}/${action}`, {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
            'content-type': 'application/json',
            cookie: `myoc_session=${sessionToken}`,
            'x-csrf-token': await createCsrfToken(sessionToken),
        },
    }, requestEnv(db, mediaBucket))
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
    it('returns pending image approval data for admin users', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createImageApprovalItemRow(),
            ],
            allResults: [[createImageApprovalQueueRow()], []],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals')
        const body = await response.json() as {
            current: { id: string; sfw: { objectKey: string } }
            pending: unknown[]
            history: unknown[]
        }

        expect(response.status).toBe(200)
        expect(body.current.id).toBe('media-1')
        expect(body.current.sfw.objectKey).toBe('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(body.pending).toHaveLength(1)
        expect(body.history).toHaveLength(0)
    })

    it('loads a selected historical media row even when it is not pending', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                {
                    ...createImageApprovalItemRow(),
                    id: 'history-media',
                },
            ],
            allResults: [
                [],
                [{
                    id: 'event-1',
                    media_id: 'history-media',
                    image_rating: 'sfw',
                    action: 'approve_sfw_no_homepage',
                    homepage_allowed: 0,
                    moderator_username: 'admin_user',
                    owner_username: 'uploader',
                    character_name: 'Quartz',
                    created_at: '2026-06-11 12:00:00',
                }],
            ],
        })

        const response = await getAdminApi(db, 'myoc_session=session-token', '/admin/image-approvals?mediaId=history-media')
        const body = await response.json() as {
            current: { id: string }
            pending: unknown[]
            history: Array<{ mediaId: string }>
        }

        expect(response.status).toBe(200)
        expect(body.current.id).toBe('history-media')
        expect(body.pending).toHaveLength(0)
        expect(body.history[0]?.mediaId).toBe('history-media')
    })
})

describe('POST /admin/image-approvals/:mediaId', () => {
    it('approves an SFW image for homepage display', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createModerationMediaRow(),
            ],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()

        const response = await postImageApproval('media-1', {
            sfwAction: 'approve_sfw_homepage',
        }, db, mediaBucket)

        expect(response.status).toBe(200)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[2]?.sql).toContain('UPDATE character_media')
        expect(boundStatements[2]?.binds[12]).toBe(1)
        expect(boundStatements[2]?.binds[13]).toBe('approved')
        expect(boundStatements[2]?.binds[18]).toBe(1)
        expect(boundStatements[2]?.binds[19]).toBe(1)
        expect(boundStatements[3]?.sql).toContain(['INSERT INTO', 'character_media_review_events'].join(' '))
        expect(boundStatements[3]?.binds[3]).toBe('approve_sfw_homepage')
    })

    it('moves an SFW image to the NSFW path when marked NSFW', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createModerationMediaRow(),
            ],
            allResults: [[], []],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))

        const response = await postImageApproval('media-1', {
            sfwAction: 'mark_nsfw',
        }, db, mediaBucket)

        expect(response.status).toBe(200)
        expect(mediaBucket.get).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(mediaBucket.put).toHaveBeenCalledWith(
            'characters/owner-1/character-1/media/media-1/nsfw/sfw-key.png',
            expect.any(ArrayBuffer),
            expect.any(Object),
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
        expect(boundStatements[2]?.binds[0]).toBeNull()
        expect(boundStatements[2]?.binds[1]).toBe('sfw-key')
        expect(boundStatements[2]?.binds[20]).toBe(1)
        expect(boundStatements[2]?.binds[21]).toBe('approved')
        expect(boundStatements[3]?.binds[3]).toBe('mark_nsfw')
    })
})

describe('POST /admin/reports/images/:mediaId/:rating/:action', () => {
    it('ignores an image report by moving it back to pending review', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow(),
            ],
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

    it('deletes a reported image variant from D1 and R2', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow(),
            ],
            allResults: [[]],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([1, 2, 3]))

        const response = await postReportAction('media-1', 'sfw', 'delete-image', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM character_media WHERE id = ?'))).toBe(true)
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })

    it('bans a user, deletes their content rows, clears sessions, and removes R2 objects', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUserRecord('admin'),
                createReportedMediaRow(),
                {profile_photo_key: 'profile-key'},
            ],
            allResults: [
                [{
                    id: 'character-1',
                    user_id: 'owner-1',
                    profile_image_key: 'character-profile-key',
                }],
                [{
                    id: 'media-1',
                    user_id: 'owner-1',
                    character_id: 'character-1',
                    sfw_image_key: 'sfw-key',
                    nsfw_image_key: null,
                    sfw_content_type: 'image/png',
                    nsfw_content_type: null,
                }],
                [],
            ],
        })
        const mediaBucket = createMockR2Bucket()
        await mediaBucket.put('users/owner-1/profile/profile-key.webp', new Uint8Array([1]))
        await mediaBucket.put('characters/owner-1/character-1/profile/character-profile-key.webp', new Uint8Array([2]))
        await mediaBucket.put('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png', new Uint8Array([3]))

        const response = await postReportAction('media-1', 'sfw', 'ban-user', db, mediaBucket)

        expect(response.status).toBe(200)
        expect(boundStatements.some((statement) => statement.sql.includes('DELETE FROM sessions WHERE user_id = ?'))).toBe(true)
        expect(boundStatements.some((statement) => statement.sql.includes('UPDATE users') && statement.sql.includes('banned_at'))).toBe(true)
        expect(mediaBucket.delete).toHaveBeenCalledWith('users/owner-1/profile/profile-key.webp')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/profile/character-profile-key.webp')
        expect(mediaBucket.delete).toHaveBeenCalledWith('characters/owner-1/character-1/media/media-1/sfw/sfw-key.png')
    })
})

function createImageApprovalQueueRow() {
    return {
        id: 'media-1',
        username: 'uploader',
        character_name: 'Quartz',
        sfw_image_key: 'sfw-key',
        nsfw_image_key: null,
        sfw_content_type: 'image/png',
        nsfw_content_type: null,
        sfw_review_status: 'pending',
        sfw_reviewed_at: null,
        nsfw_review_status: 'pending',
        nsfw_reviewed_at: null,
        created_at: '2026-06-10 12:00:00',
        updated_at: '2026-06-10 12:00:00',
    }
}

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

function createModerationMediaRow() {
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
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
    }
}

function createReportedMediaRow() {
    return {
        ...createModerationMediaRow(),
        username: 'uploader',
        profile_photo_key: null,
        character_name: 'Quartz',
        profile_image_key: 'character-profile-key',
        sfw_review_status: 'reported',
        nsfw_review_status: 'pending',
    }
}
