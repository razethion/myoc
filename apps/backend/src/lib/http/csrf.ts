import type {Context, Next} from 'hono'
import {getCookie, setCookie} from 'hono/cookie'
import type {Bindings} from '../../types/bindings'
import {getSessionCookieName, isValidCsrfToken} from '../auth/session'
import {jsonResponse} from './jsonResponse'
import {readFormDataUpTo} from './requestBody'
import {ErrorResponseSchema} from './responseSchemas'

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const CSRF_FORM_MAX_BYTES = 64 * 1024
const PRE_AUTH_CSRF_COOKIE = 'myoc_pre_auth_csrf'
const PRE_AUTH_CSRF_TTL_SECONDS = 60 * 60
const PRE_AUTH_CSRF_PATHS = new Set(['/login', '/recovery/login'])
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
        if (!hasTrustedRequestSource(c.req.raw) || !(await hasValidPreAuthCsrfToken(c))) {
            return invalidCsrfResponse(c)
        }

        await next()
        appendCsrfVaryHeaders(c)
        return
    }

    const sessionToken = getCookie(c, getSessionCookieName())

    if (!sessionToken) {
        return await next()
    }

    const csrfToken = await getCsrfToken(c)

    if (!(await isValidCsrfToken(sessionToken, csrfToken))) {
        return invalidCsrfResponse(c)
    }

    return await next()
}

export function issuePreAuthCsrfToken(c: Context<{Bindings: Bindings}>): string {
    const existingToken = getCookie(c, PRE_AUTH_CSRF_COOKIE)
    const token = existingToken && isValidPreAuthCsrfTokenValue(existingToken) ? existingToken : crypto.randomUUID()

    setCookie(c, PRE_AUTH_CSRF_COOKIE, token, {
        httpOnly: true,
        maxAge: PRE_AUTH_CSRF_TTL_SECONDS,
        path: '/',
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
    })
    c.header('Cache-Control', 'private, no-store')
    c.header('Vary', 'Cookie', {append: true})
    return token
}

function hasTrustedRequestSource(request: Request): boolean {
    const requestOrigin = new URL(request.url).origin
    const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()

    if (fetchSite && fetchSite !== 'same-origin') {
        return false
    }

    const origin = request.headers.get('origin')

    if (origin) {
        return origin === requestOrigin
    }

    const referer = request.headers.get('referer')

    if (!referer) {
        return false
    }

    try {
        return new URL(referer).origin === requestOrigin
    } catch {
        return false
    }
}

function invalidCsrfResponse(c: Context<{Bindings: Bindings}>): Response {
    const response = jsonResponse(c, ErrorResponseSchema, {error: 'Invalid CSRF token'}, 403)
    appendCsrfVaryHeaders(c)
    return response
}

function appendCsrfVaryHeaders(c: Context<{Bindings: Bindings}>): void {
    c.header('Vary', 'Origin, Sec-Fetch-Site', {append: true})
}

async function hasValidPreAuthCsrfToken(c: Context<{Bindings: Bindings}>): Promise<boolean> {
    if (!PRE_AUTH_CSRF_PATHS.has(new URL(c.req.url).pathname)) {
        return true
    }

    const cookieToken = getCookie(c, PRE_AUTH_CSRF_COOKIE)
    const requestToken = await getCsrfToken(c)
    return Boolean(cookieToken && requestToken && isValidPreAuthCsrfTokenValue(cookieToken) && cookieToken === requestToken)
}

function isValidPreAuthCsrfTokenValue(value: string): boolean {
    return /^[A-Za-z0-9_-]{32,128}$/.test(value)
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
