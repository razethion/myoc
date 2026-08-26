import {beforeEach, describe, expect, it, vi} from 'vitest'
import {getCurrentUser} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import type {Bindings} from '../../types/bindings'
import {userRoutes} from './users'

vi.mock('../../lib/auth/session', () => ({
    getCurrentUser: vi.fn(),
}))

const mockedGetCurrentUser = vi.mocked(getCurrentUser)

const currentUser = {
    id: 'current-user',
    email: 'user@example.com',
    username: 'current-user',
    role: 'user' as const,
    profilePhotoKey: null,
    bio: '',
    displayNsfwMedia: false,
    showUnapprovedMedia: true,
    lastSeenVersion: null,
    csrfToken: 'csrf-token',
}

function requestEnv(db: D1Database): Bindings {
    return {DB: db} as unknown as Bindings
}

beforeEach(() => {
    mockedGetCurrentUser.mockReset()
})

describe('POST /me/recent-media-preference', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()
        mockedGetCurrentUser.mockResolvedValue(null)

        const response = await userRoutes.request(
            'https://example.com/me/recent-media-preference',
            {method: 'POST', body: JSON.stringify({showUnapproved: true})},
            requestEnv(db),
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({error: 'Authentication required'})
    })

    it.each([
        ['malformed JSON', '{bad json'],
        ['a non-boolean value', JSON.stringify({showUnapproved: 'true'})],
        ['an extra field', JSON.stringify({showUnapproved: true, extra: false})],
    ])('returns 400 for %s', async (_description, body) => {
        const {db} = createMockDb()
        mockedGetCurrentUser.mockResolvedValue(currentUser)

        const response = await userRoutes.request('https://example.com/me/recent-media-preference', {method: 'POST', body}, requestEnv(db))

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Recent media preference is invalid'})
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it.each([true, false])('updates the preference to %s', async (showUnapproved) => {
        const {db, boundStatements} = createMockDb()
        mockedGetCurrentUser.mockResolvedValue(currentUser)

        const response = await userRoutes.request(
            'https://example.com/me/recent-media-preference',
            {method: 'POST', body: JSON.stringify({showUnapproved})},
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true, showUnapproved})
        expect(boundStatements).toHaveLength(1)
        expect(boundStatements[0]?.sql).toContain('UPDATE users')
        expect(boundStatements[0]?.sql).toContain('SET show_unapproved_media = ?')
        expect(boundStatements[0]?.binds).toEqual([showUnapproved ? 1 : 0, currentUser.id])
    })
})
