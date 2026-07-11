import type {Context, Next} from 'hono'
import {getCookie} from 'hono/cookie'
import {getSessionCookieName, isValidCsrfToken} from '../auth/session'
import type {Bindings} from '../../types/bindings'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const PUBLIC_UNSAFE_PATHS = new Set([
    '/login',
    '/api/login',
    '/api/login/passkey/options',
    '/api/login/passkey/verify',
    '/api/recovery/login',
    '/api/register/passkey/options',
    '/api/register/passkey/verify',
    '/users',
    '/api/users',
])

export async function csrfProtection(c: Context<{Bindings: Bindings}>, next: Next) {
    if (!UNSAFE_METHODS.has(c.req.method)) {
        return await next()
    }

    if (PUBLIC_UNSAFE_PATHS.has(new URL(c.req.url).pathname)) {
        return await next()
    }

    const sessionToken = getCookie(c, getSessionCookieName())

    if (!sessionToken) {
        return await next()
    }

    const csrfToken = await getCsrfToken(c)

    if (!(await isValidCsrfToken(sessionToken, csrfToken))) {
        return c.json({error: 'Invalid CSRF token'}, 403)
    }

    return await next()
}

async function getCsrfToken(c: Context<{Bindings: Bindings}>): Promise<string | null> {
    const headerToken = c.req.header('x-csrf-token')

    if (headerToken) {
        return headerToken
    }

    const contentType = c.req.header('content-type') ?? ''

    if (!contentType.includes('application/x-www-form-urlencoded') && !contentType.includes('multipart/form-data')) {
        return null
    }

    const form = await c.req.raw.clone().formData()
    const formToken = form.get('csrfToken')

    return typeof formToken === 'string' ? formToken : null
}
