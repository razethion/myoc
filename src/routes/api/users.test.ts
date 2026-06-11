import {compare} from 'bcryptjs'
import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createMockDb} from '../../test/mockD1'

type CreateUserResponse = {
    user: {
        email: string
        username: string
        profilePhotoKey: string | null
        bio: string
        createdAt: string
    }
}

async function postUser(body: unknown, db: D1Database, url = 'https://example.com/users'): Promise<Response> {
    return await apiRoutes.request(url, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
        },
    }, {
        DB: db,
    })
}

describe('POST /users', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postUser('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email, username, and password are required',
        })
    })

    it('returns 400 for an invalid email', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'not-an-email',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email must be valid',
        })
    })

    it('returns 400 for an invalid username', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'bad-user',
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 400 for a short password', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'short',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Password must be at least 8 characters',
        })
    })

    it('returns 409 when the email or username is already in use', async () => {
        const {db} = createMockDb({firstResults: [{id: 'existing-user'}]})

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('returns 409 when the insert hits a unique constraint', async () => {
        const {db} = createMockDb({
            firstResults: [null],
            runError: new Error('UNIQUE constraint failed: users.email'),
        })

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a user, starts a session, and returns the public user', async () => {
        const {db, boundStatements} = createMockDb({firstResults: [null]})

        const response = await postUser({
            email: ' Test@Example.com ',
            username: ' testuser ',
            password: ' password123 ',
        }, db)

        expect(response.status).toBe(201)

        const body = await response.json() as CreateUserResponse
        expect(body.user.email).toBe('test@example.com')
        expect(body.user.username).toBe('testuser')
        expect(body.user.profilePhotoKey).toBeNull()
        expect(body.user.bio).toBe('')
        expect(body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        expect(JSON.stringify(body)).not.toContain('password_hash')

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Max-Age=2592000')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Secure')

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(4)
        expect(boundStatements[0]?.binds).toEqual(['test@example.com', 'testuser'])
        expect(boundStatements[1]?.sql).toContain(['INSERT INTO', 'users'].join(' '))
        expect(boundStatements[1]?.binds[1]).toBe('test@example.com')
        expect(boundStatements[1]?.binds[2]).toBe('testuser')
        expect(await compare('password123', boundStatements[1]?.binds[3] as string)).toBe(true)
        expect(boundStatements[2]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[3]?.sql).toContain(['INSERT INTO', 'sessions'].join(' '))
        expect(boundStatements[3]?.binds[1]).toBe(boundStatements[1]?.binds[0])
    })
})
