import {hash} from 'bcryptjs'
import {Hono} from 'hono'
import {
    createSession,
    normalizeCredential,
    setSessionCookie,
    toPublicUser,
    toSqlTimestamp,
    type UserRecord,
} from '../../lib/auth/session'
import type {Bindings} from '../../types/bindings'

type CreateUserRequest = {
    email?: unknown
    username?: unknown
    password?: unknown
}

const PASSWORD_HASH_ROUNDS = 10

export const userRoutes = new Hono<{ Bindings: Bindings }>()

userRoutes.post('/', async (c) => {
    let body: CreateUserRequest

    try {
        body = await c.req.json<CreateUserRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const email = normalizeCredential(body.email)?.toLowerCase() ?? null
    const username = normalizeCredential(body.username)
    const password = normalizeCredential(body.password)

    if (!email || !username || !password) {
        return c.json({error: 'Email, username, and password are required'}, 400)
    }

    if (!isValidEmail(email)) {
        return c.json({error: 'Email must be valid'}, 400)
    }

    if (!isValidUsername(username)) {
        return c.json({error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores'}, 400)
    }

    if (password.length < 8) {
        return c.json({error: 'Password must be at least 8 characters'}, 400)
    }

    const existingUser = await c.env.DB.prepare(
        `SELECT id
         FROM users
         WHERE lower(email) = lower(?)
            OR username = ?
         LIMIT 1`,
    )
        .bind(email, username)
        .first<Pick<UserRecord, 'id'>>()

    if (existingUser) {
        return c.json({error: 'Email or username is already in use'}, 409)
    }

    const now = new Date()
    const user: UserRecord = {
        id: crypto.randomUUID(),
        email,
        username,
        password_hash: await hash(password, PASSWORD_HASH_ROUNDS),
        profile_photo_key: null,
        bio: '',
        created_at: toSqlTimestamp(now),
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO users (id, email, username, password_hash, bio, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        )
            .bind(user.id, user.email, user.username, user.password_hash, user.bio, user.created_at)
            .run()
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return c.json({error: 'Email or username is already in use'}, 409)
        }

        throw error
    }

    const sessionToken = await createSession(c.env.DB, user.id, now)
    setSessionCookie(c, sessionToken)

    return c.json({user: toPublicUser(user)}, 201)
})

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUsername(username: string): boolean {
    return /^[A-Za-z0-9_]{3,32}$/.test(username)
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('unique')
}
