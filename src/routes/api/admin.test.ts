import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createMockDb} from '../../test/mockD1'

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

async function getAdminApi(db: D1Database, cookie?: string): Promise<Response> {
    return apiRoutes.request('https://example.com/admin', {
        headers: cookie ? {cookie} : undefined,
    }, {
        DB: db,
    })
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
