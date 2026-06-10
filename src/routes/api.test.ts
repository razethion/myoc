import {hash} from 'bcryptjs'
import {describe, expect, it, vi} from 'vitest'
import {apiRoutes} from './api'

type MockUserRecord = {
    id: string
    email: string
    username: string
    password_hash: string
    profile_photo_key: string | null
    bio: string
    created_at: string
}

type BoundStatement = {
    sql: string
    binds: unknown[]
    first: ReturnType<typeof vi.fn>
}

function createMockDb(user: MockUserRecord | null = null): {
    db: D1Database
    boundStatements: BoundStatement[]
} {
    const boundStatements: BoundStatement[] = []

    const db = {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn((...binds: unknown[]) => {
                const statement: BoundStatement = {
                    sql,
                    binds,
                    first: vi.fn(async () => user),
                }

                boundStatements.push(statement)
                return statement
            }),
        })),
        batch: vi.fn(async () => []),
    }

    return {
        db: db as unknown as D1Database,
        boundStatements,
    }
}

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

describe('POST /login', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postLogin('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when the identifier is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Identifier and password are required',
        })
    })

    it('returns 400 when the password is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            identifier: 'test@example.com',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Identifier and password are required',
        })
    })

    it('returns 401 when no matching user exists', async () => {
        const {db} = createMockDb()

        const response = await postLogin({
            identifier: 'missing@example.com',
            password: 'password123',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid identifier or password',
        })
    })

    it('returns 401 when the password does not match the stored hash', async () => {
        const user = await createTestUser('password123')
        const {db} = createMockDb(user)

        const response = await postLogin({
            identifier: 'test@example.com',
            password: 'wrong-password',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid identifier or password',
        })
    })

    it('returns the public user and creates a secure session for valid credentials', async () => {
        const user = await createTestUser('password123')
        const {db, boundStatements} = createMockDb(user)

        const response = await postLogin({
            identifier: ' test@example.com ',
            password: ' password123 ',
        }, db, 'https://example.com/login')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                profilePhotoKey: user.profile_photo_key,
                bio: user.bio,
                createdAt: user.created_at,
            },
        })

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Max-Age=2592000')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Secure')

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[0]?.binds).toEqual(['test@example.com', 'test@example.com'])
        expect(boundStatements[1]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'sessions'].join(' '))
        expect(boundStatements[2]?.binds[1]).toBe(user.id)
    })
})

async function createTestUser(password: string): Promise<MockUserRecord> {
    return {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: await hash(password, 10),
        profile_photo_key: null,
        bio: '',
        created_at: '2026-06-10 12:00:00',
    }
}
