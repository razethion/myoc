import {Hono} from 'hono'
import {setCookie} from 'hono/cookie'
import {compare} from 'bcryptjs'
import type {Bindings} from '../types/bindings'

type UserRecord = {
    id: string
    email: string
    username: string
    password_hash: string
    profile_photo_key: string | null
    bio: string
    created_at: string
}

type LoginRequest = {
    identifier?: unknown
    password?: unknown
}

const SESSION_COOKIE = 'myoc_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
const SESSION_TOKEN_BYTES = 32

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

apiRoutes.post('/login', async (c) => {
    let body: LoginRequest

    try {
        body = await c.req.json<LoginRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const identifier = normalizeCredential(body.identifier)
    const password = normalizeCredential(body.password)

    if (!identifier || !password) {
        return c.json({error: 'Identifier and password are required'}, 400)
    }

    const user = await c.env.DB.prepare(
        `SELECT id, email, username, password_hash, profile_photo_key, bio, created_at
         FROM users
         WHERE lower(email) = lower(?)
            OR username = ?
         LIMIT 1`,
    )
        .bind(identifier, identifier)
        .first<UserRecord>()

    if (!user || !(await compare(password, user.password_hash))) {
        return c.json({error: 'Invalid identifier or password'}, 401)
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
    const sessionToken = createSessionToken()
    const sessionHash = await sha256Hex(sessionToken)

    await c.env.DB.batch([
        c.env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(toSqlTimestamp(now)),
        c.env.DB.prepare(
            `INSERT INTO sessions (id, user_id, session_hash, expires_at)
             VALUES (?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), user.id, sessionHash, toSqlTimestamp(expiresAt)),
    ])

    setCookie(c, SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
    })

    return c.json({
        user: {
            id: user.id,
            email: user.email,
            username: user.username,
            profilePhotoKey: user.profile_photo_key,
            bio: user.bio,
            createdAt: user.created_at,
        },
    })
})

function normalizeCredential(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function createSessionToken(): string {
    const bytes = new Uint8Array(SESSION_TOKEN_BYTES)
    crypto.getRandomValues(bytes)
    return [...bytes].map((byte) => byte
        .toString(16)
        .padStart(2, '0'))
        .join('')
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte
        .toString(16)
        .padStart(2, '0'))
        .join('')
}

function toSqlTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19)
}
