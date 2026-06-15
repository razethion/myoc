import {hash} from 'bcryptjs'
import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createMockDb} from '../../test/mockD1'
import {createCsrfToken, type UserRecord} from '../../lib/auth/session'
import {expectSessionCookie} from '../../test/assertions'

async function postLogin(body: unknown, db: D1Database, url = '/login'): Promise<Response> {
    return apiRoutes.request(url, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
        },
    }, {
        DB: db,
    });
}

async function postLogout(
    db: D1Database,
    cookie?: string,
    url = 'https://example.com/logout',
    csrfToken?: string,
): Promise<Response> {
    return apiRoutes.request(url, {
        method: 'POST',
        headers: cookie
            ? {
                cookie,
                ...(csrfToken ? {'x-csrf-token': csrfToken} : {}),
            }
            : undefined,
    }, {
        DB: db,
    });
}

async function postLogoutForm(db: D1Database, cookie?: string, csrfToken?: string): Promise<Response> {
    const body = new URLSearchParams()

    if (csrfToken) {
        body.set('csrfToken', csrfToken)
    }

    return apiRoutes.request('https://example.com/logout', {
        method: 'POST',
        body,
        headers: {
            accept: 'text/html',
            'content-type': 'application/x-www-form-urlencoded',
            ...(cookie ? {cookie} : {}),
        },
    }, {
        DB: db,
    });
}

describe('POST /login', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postLogin('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when the username is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 400 when the password is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            username: 'testuser',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 401 when no matching user exists', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            username: 'missinguser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('returns 401 when the password does not match the stored hash', async () => {
        const user = await createTestUser('password123')
        const {db} = createMockDb({firstResults: [user]})

        const response = await postLogin({
            username: 'testuser',
            password: 'wrong-password',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('queries by username only', async () => {
        const {db, boundStatements} = createMockDb()

        await postLogin({
            username: 'test@example.com',
            password: 'password123',
        }, db)

        expect(boundStatements[0]?.sql).toContain('WHERE username = ?')
        expect(boundStatements[0]?.sql).not.toContain('lower(email)')
        expect(boundStatements[0]?.binds).toEqual(['test@example.com'])
    })

    it('returns the public user and creates a secure session for valid credentials', async () => {
        const user = await createTestUser('password123')
        const {db, boundStatements} = createMockDb({firstResults: [user]})

        const response = await postLogin({
            username: ' testuser ',
            password: ' password123 ',
        }, db, 'https://example.com/login')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: 'user',
                profilePhotoKey: user.profile_photo_key,
                bio: user.bio,
                displayNsfwMedia: false,
                createdAt: user.created_at,
            },
        })

        expectSessionCookie(response)

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[0]?.binds).toEqual(['testuser'])
        expect(boundStatements[1]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'sessions'].join(' '))
        expect(boundStatements[2]?.binds[1]).toBe(user.id)
    })
})

describe('POST /logout', () => {
    it('returns 204 and clears the cookie when no session cookie exists', async () => {
        const {db} = createMockDb()

        const response = await postLogout(db)

        expect(response.status).toBe(204)
        expect(db.prepare).not.toHaveBeenCalled()

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Secure')
    })

    it('returns 403 when a session cookie exists without a CSRF token', async () => {
        const {db} = createMockDb()

        const response = await postLogout(db, 'myoc_session=session-token')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('deletes the current session and clears the cookie with a valid CSRF token', async () => {
        const {db, boundStatements} = createMockDb()
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)

        const response = await postLogout(db, `myoc_session=${sessionToken}`, 'https://example.com/logout', csrfToken)

        expect(response.status).toBe(204)
        expect(boundStatements).toHaveLength(1)
        expect(boundStatements[0]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[0]?.binds).toHaveLength(1)
        expect(boundStatements[0]?.binds[0]).not.toBe(sessionToken)
        expect(boundStatements[0]?.binds[0]).toBe(await sha256Hex(sessionToken))

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Secure')
    })

    it('redirects browser form submissions after logout', async () => {
        const {db} = createMockDb()
        const sessionToken = 'session-token'

        const response = await postLogoutForm(db, `myoc_session=${sessionToken}`, await createCsrfToken(sessionToken))

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    })
})

async function createTestUser(password: string): Promise<UserRecord> {
    return {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: await hash(password, 10),
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        created_at: '2026-06-10 12:00:00',
    }
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte
        .toString(16)
        .padStart(2, '0'))
        .join('')
}
