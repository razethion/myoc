import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import bcrypt from 'bcryptjs'
import {
    createSessionToken,
    getSessionExpiryDate,
    hashSessionToken
} from '../utils/sessions'
import { getCurrentUser } from '../utils/currentUser'
import { Bindings } from '../types/env'

type UserRow = {
    id: string
    email: string
    username: string
    password_hash: string
}

export const authRoutes = new Hono<{ Bindings: Bindings }>()

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUsername(username: string): boolean {
    return /^[a-z0-9_-]{3,32}$/.test(username)
}

function isValidPassword(password: string): boolean {
    return password.length >= 12 && password.length <= 128
}

authRoutes.post('/register', async (c) => {
    const body = await c.req.json()

    if (
        typeof body.email !== 'string' ||
        typeof body.username !== 'string' ||
        typeof body.password !== 'string'
    ) {
        return c.json({ error: 'Invalid request' }, 400)
    }

    const email = body.email.trim().toLowerCase()
    const username = body.username.trim().toLowerCase()
    const password = body.password

    if (!email || !username || !password) {
        return c.json({ error: 'Missing required fields' }, 400)
    }

    if (!isValidEmail(email)) {
        return c.json({ error: 'Invalid email address' }, 400)
    }

    if (!isValidUsername(username)) {
        return c.json({
            error:
                'Username must be 3-32 characters and contain only lowercase letters, numbers, underscores, or hyphens'
        }, 400)
    }

    if (!isValidPassword(password)) {
        return c.json({ error: 'Password must be between 12 and 128 characters' }, 400)
    }

    const existingUser = await c.env.DB
        .prepare(`
            SELECT id
            FROM users
            WHERE email = ?
               OR username = ?
        `)
        .bind(email, username)
        .first()

    if (existingUser) {
        return c.json({ error: 'Email or username already exists' }, 409)
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const id = crypto.randomUUID()

    await c.env.DB
        .prepare(`
            INSERT INTO users (
                id,
                email,
                username,
                password_hash,
                bio
            )
            VALUES (?, ?, ?, ?, ?)
        `)
        .bind(id, email, username, passwordHash, '')
        .run()

    return c.json({
        success: true,
        userId: id
    })
})

authRoutes.post('/login', async (c) => {
    const body = await c.req.json()

    if (
        typeof body.username !== 'string' ||
        typeof body.password !== 'string'
    ) {
        return c.json({ error: 'Invalid request' }, 400)
    }

    const username = body.username.trim().toLowerCase()
    const password = body.password

    if (!username || !password) {
        return c.json({ error: 'Missing username or password' }, 400)
    }

    const user = await c.env.DB
        .prepare(`
            SELECT id, email, username, password_hash
            FROM users
            WHERE username = ?
        `)
        .bind(username)
        .first<UserRow>()

    if (!user) {
        return c.json({ error: 'Invalid username or password' }, 401)
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash)

    if (!passwordValid) {
        return c.json({ error: 'Invalid username or password' }, 401)
    }

    const sessionToken = createSessionToken()
    const sessionHash = await hashSessionToken(sessionToken)
    const sessionId = crypto.randomUUID()
    const expiresAt = getSessionExpiryDate()

    await c.env.DB
        .prepare(`
            INSERT INTO sessions (
                id,
                user_id,
                session_hash,
                expires_at
            )
            VALUES (?, ?, ?, ?)
        `)
        .bind(sessionId, user.id, sessionHash, expiresAt)
        .run()

    const isLocalhost = new URL(c.req.url).hostname === 'localhost'

    setCookie(c, 'session', sessionToken, {
        httpOnly: true,
        secure: !isLocalhost,
        sameSite: 'Lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 30
    })

    return c.json({
        success: true,
        user: {
            id: user.id,
            email: user.email,
            username: user.username
        }
    })
})

authRoutes.get('/me', async (c) => {
    const user = await getCurrentUser(c)

    if (!user) {
        return c.json({ user: null }, 401)
    }

    return c.json({
        user
    })
})

authRoutes.post('/logout', async (c) => {
    const sessionToken = getCookie(c, 'session')

    if (sessionToken) {
        const sessionHash = await hashSessionToken(sessionToken)

        await c.env.DB
            .prepare(`
        DELETE FROM sessions
        WHERE session_hash = ?
      `)
            .bind(sessionHash)
            .run()
    }

    deleteCookie(c, 'session', {
        path: '/'
    })

    return c.json({
        success: true
    })
})