import type {Context, Next} from 'hono'
import {getCookie} from 'hono/cookie'
import type {Bindings} from '../../types/bindings'
import {getSessionCookieName, isValidCsrfToken} from '../auth/session'
import {jsonResponse} from './jsonResponse'
import {readFormDataUpTo} from './requestBody'
import {ErrorResponseSchema} from './responseSchemas'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_FORM_MAX_BYTES = 64 * 1024
const PUBLIC_UNSAFE_PATHS = new Set([
    '/login',
    '/login/passkey/options',
    '/login/passkey/verify',
    '/recovery/login',
    '/register',
    '/register/passkey/options',
    '/register/passkey/verify',
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
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid CSRF token'}, 403)
    }

    return await next()
}

async function getCsrfToken(c: Context<{Bindings: Bindings}>): Promise<string | null> {
    const headerToken = c.req.header('x-csrf-token')

    if (headerToken) {
        return headerToken
    }

    const contentType = c.req.header('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
        return await readMultipartCsrfToken(c.req.raw.clone())
    }

    if (!contentType.includes('application/x-www-form-urlencoded')) {
        return null
    }

    try {
        const form = await readFormDataUpTo(c.req.raw.clone(), CSRF_FORM_MAX_BYTES)
        const formToken = form?.get('csrfToken')

        return typeof formToken === 'string' ? formToken : null
    } catch {
        return null
    }
}

async function readMultipartCsrfToken(request: Request): Promise<string | null> {
    try {
        const form = await request.formData()
        const formToken = form.get('csrfToken')

        return typeof formToken === 'string' ? formToken : null
    } catch {
        return null
    }
}
