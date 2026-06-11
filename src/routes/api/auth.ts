import {compare} from 'bcryptjs'
import {Hono} from 'hono'
import {getCookie} from 'hono/cookie'
import {
    clearSessionCookie,
    createSession,
    deleteSession,
    getSessionCookieName,
    normalizeCredential,
    setSessionCookie,
    toPublicUser,
    type UserRecord,
} from '../../lib/auth/session'
import type {Bindings} from '../../types/bindings'

type LoginRequest = {
    username?: unknown
    password?: unknown
}

export const authRoutes = new Hono<{ Bindings: Bindings }>()

authRoutes.post('/logout', async (c) => {
    const sessionToken = getCookie(c, getSessionCookieName())
    const isBrowserForm = c.req.header('accept')?.includes('text/html')

    if (sessionToken) {
        await deleteSession(c.env.DB, sessionToken)
    }

    clearSessionCookie(c)

    if (isBrowserForm) {
        return c.redirect('/')
    }

    return c.body(null, 204)
})

authRoutes.post('/login', async (c) => {
    let body: LoginRequest

    try {
        body = await c.req.json<LoginRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const username = normalizeCredential(body.username)
    const password = normalizeCredential(body.password)

    if (!username || !password) {
        return c.json({error: 'Username and password are required'}, 400)
    }

    const user = await c.env.DB.prepare(
        `SELECT id, email, username, password_hash, profile_photo_key, bio, created_at
         FROM users
         WHERE username = ?
         LIMIT 1`,
    )
        .bind(username)
        .first<UserRecord>()

    if (!user || !(await compare(password, user.password_hash))) {
        return c.json({error: 'Invalid username or password'}, 401)
    }

    const sessionToken = await createSession(c.env.DB, user.id)
    setSessionCookie(c, sessionToken)

    return c.json({user: toPublicUser(user)})
})
