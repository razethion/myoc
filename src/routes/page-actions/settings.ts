import {hash} from 'bcryptjs'
import type {Context} from 'hono'
import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser, normalizeCredential, toSqlTimestamp, type UserRecord} from '../../lib/auth/session'
import {csrfProtection} from '../../lib/http/csrf'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {ErrorResponseSchema, OkResponseSchema, responseSchema} from '../../lib/http/responseSchemas'
import {FIXED_SOCIAL_LINKS, type UserSocialLink} from '../../lib/socialLinks'
import type {Bindings} from '../../types/bindings'

type SettingsRouteContext = Context<{Bindings: Bindings}>

type UpdateUserRequest = {
    email?: unknown
    username?: unknown
    bio?: unknown
    password?: unknown
    displayNsfwMedia?: unknown
    customLinkLabel?: unknown
    customLinkUrl?: unknown
    socialLinks?: unknown
    [key: string]: unknown
}

type PasskeyPromptChoice = 'setup' | 'later'

const PASSWORD_HASH_ROUNDS = 10
const BIO_MAX_LENGTH = 255
const PasskeyPromptResponseSchema = responseSchema({
    ok: z.literal(true),
    choice: z.enum(['setup', 'later']),
    redirectTo: z.string(),
})

export const settingsPageActionRoutes = new Hono<{Bindings: Bindings}>()

settingsPageActionRoutes.use('/settings', csrfProtection)
settingsPageActionRoutes.use('/passkey-setup', csrfProtection)

settingsPageActionRoutes.post('/settings', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        if (c.req.header('accept')?.includes('text/html')) {
            return c.redirect('/login')
        }

        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const body = await parseUpdateUserRequest(c.req)
    const email = normalizeCredential(body.email)?.toLowerCase() ?? null
    const username = normalizeCredential(body.username)
    const bio = normalizeOptionalText(body.bio) ?? ''
    const password = normalizeOptionalText(body.password)
    const displayNsfwMedia = parseBooleanPreference(body.displayNsfwMedia)

    if (!email || !username) {
        return respondToUpdate(c, {error: 'Email and username are required'}, 400)
    }

    if (!isValidEmail(email)) {
        return respondToUpdate(c, {error: 'Email must be valid'}, 400)
    }

    if (!isValidUsername(username)) {
        return respondToUpdate(c, {error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores'}, 400)
    }

    if (bio.length > BIO_MAX_LENGTH) {
        return respondToUpdate(c, {error: 'Bio must be 255 characters or fewer'}, 400)
    }

    if (password && password.length < 8) {
        return respondToUpdate(c, {error: 'Password must be at least 8 characters'}, 400)
    }

    const socialLinksResult = parseSocialLinks(body)

    if ('error' in socialLinksResult) {
        return respondToUpdate(c, {error: socialLinksResult.error}, 400)
    }

    const existingUser = await c.env.DB.prepare(
        `SELECT id
         FROM users
         WHERE (lower(email) = lower(?)
             OR username = ?)
           AND id <> ?
         LIMIT 1`,
    )
        .bind(email, username, currentUser.id)
        .first<Pick<UserRecord, 'id'>>()

    if (existingUser) {
        return respondToUpdate(c, {error: 'Email or username is already in use'}, 409)
    }

    try {
        const statements: D1PreparedStatement[] = []

        if (password) {
            statements.push(
                c.env.DB.prepare(
                    `UPDATE users
                 SET email         = ?,
                     username      = ?,
                     bio           = ?,
                     display_nsfw_media = ?,
                     password_hash = ?
                 WHERE id = ?`,
                ).bind(email, username, bio, displayNsfwMedia ? 1 : 0, await hash(password, PASSWORD_HASH_ROUNDS), currentUser.id),
            )
        } else {
            statements.push(
                c.env.DB.prepare(
                    `UPDATE users
                 SET email              = ?,
                     username           = ?,
                     bio                = ?,
                     display_nsfw_media = ?
                 WHERE id = ?`,
                ).bind(email, username, bio, displayNsfwMedia ? 1 : 0, currentUser.id),
            )
        }

        statements.push(c.env.DB.prepare('DELETE FROM user_social_links WHERE user_id = ?').bind(currentUser.id))

        for (const link of socialLinksResult.links) {
            statements.push(
                c.env.DB.prepare(
                    `INSERT INTO user_social_links (user_id, platform, label, url, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                ).bind(currentUser.id, link.platform, link.label, link.url),
            )
        }

        await c.env.DB.batch(statements)
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return respondToUpdate(c, {error: 'Email or username is already in use'}, 409)
        }

        throw error
    }

    return respondToUpdate(c, {ok: true})
})

settingsPageActionRoutes.post('/passkey-setup', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const body = await parsePasskeyPromptResponse(c.req.raw)
    const choice = body.choice === 'setup' ? 'setup' : 'later'
    const returnTo = safeLocalRedirectPath(body.returnTo) ?? `/u/${encodeURIComponent(currentUser.username)}`
    const redirectTo = choice === 'setup' ? '/settings' : returnTo

    await c.env.DB.prepare(
        `UPDATE users
         SET passkey_prompt_seen_at = ?
         WHERE id = ?`,
    )
        .bind(toSqlTimestamp(new Date()), currentUser.id)
        .run()

    if (c.req.header('accept')?.includes('text/html')) {
        return c.redirect(redirectTo)
    }

    return jsonResponse(c, PasskeyPromptResponseSchema, {
        ok: true,
        choice,
        redirectTo,
    })
})

async function parsePasskeyPromptResponse(req: Request): Promise<{
    choice: PasskeyPromptChoice
    returnTo: string | null
}> {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
        const body = (await req.json().catch(() => ({}))) as {choice?: unknown; returnTo?: unknown}

        return {
            choice: body.choice === 'setup' ? 'setup' : 'later',
            returnTo: typeof body.returnTo === 'string' ? body.returnTo : null,
        }
    }

    const form = await req.formData()
    const choice = form.get('choice')
    const returnTo = form.get('returnTo')

    return {
        choice: choice === 'setup' ? 'setup' : 'later',
        returnTo: typeof returnTo === 'string' ? returnTo : null,
    }
}

function safeLocalRedirectPath(value: string | null): string | null {
    if (!value?.startsWith('/') || value.startsWith('//')) {
        return null
    }

    if (value.startsWith('/api/') || value === '/passkey-setup') {
        return null
    }

    return value
}

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUsername(username: string): boolean {
    return /^[A-Za-z0-9_]{3,32}$/.test(username)
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('unique')
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() : null
}

function parseBooleanPreference(value: unknown): boolean {
    return value === true || value === 'true' || value === '1' || value === 'on'
}

function parseSocialLinks(body: UpdateUserRequest): {links: UserSocialLink[]} | {error: string} {
    const links: UserSocialLink[] = []

    for (const definition of FIXED_SOCIAL_LINKS) {
        const rawUrl = readSocialUrl(body, definition.platform, definition.formName)

        if (!rawUrl) {
            continue
        }

        const urlResult = validateSocialUrl(rawUrl, definition.label)

        if ('error' in urlResult) {
            return urlResult
        }

        links.push({
            platform: definition.platform,
            label: null,
            url: urlResult.url,
        })
    }

    const customLabel = normalizeOptionalText(body.customLinkLabel) ?? ''
    const customUrl = normalizeOptionalText(body.customLinkUrl) ?? ''

    if (customLabel && !customUrl) {
        return {error: 'Custom link requires a URL'}
    }

    if (customUrl && !customLabel) {
        return {error: 'Custom link requires a label'}
    }

    if (customLabel.length > 40) {
        return {error: 'Custom link label must be 40 characters or fewer'}
    }

    if (customUrl) {
        const urlResult = validateSocialUrl(customUrl, 'Custom link')

        if ('error' in urlResult) {
            return urlResult
        }

        links.push({
            platform: 'custom',
            label: customLabel,
            url: urlResult.url,
        })
    }

    return {links}
}

function readSocialUrl(body: UpdateUserRequest, platform: string, formName: string): string {
    if (isRecord(body.socialLinks)) {
        return normalizeOptionalText(body.socialLinks[platform]) ?? ''
    }

    return normalizeOptionalText(body[formName]) ?? ''
}

function validateSocialUrl(value: string, label: string): {url: string} | {error: string} {
    if (value.length > 2048) {
        return {error: `${label} URL must be 2048 characters or fewer`}
    }

    let url: URL

    try {
        url = new URL(value)
    } catch {
        return {error: `${label} must be a valid URL`}
    }

    if (url.protocol !== 'https:') {
        return {error: `${label} must start with https://`}
    }

    return {url: url.toString()}
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseUpdateUserRequest(req: SettingsRouteContext['req']): Promise<UpdateUserRequest> {
    const contentType = req.header('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            return await req.json<UpdateUserRequest>()
        } catch {
            return {}
        }
    }

    const form = await req.formData()

    return {
        email: form.get('email'),
        username: form.get('username'),
        bio: form.get('bio'),
        password: form.get('password'),
        displayNsfwMedia: form.get('displayNsfwMedia'),
        ...Object.fromEntries(FIXED_SOCIAL_LINKS.map((link) => [link.formName, form.get(link.formName)])),
        customLinkLabel: form.get('customLinkLabel'),
        customLinkUrl: form.get('customLinkUrl'),
    }
}

function respondToUpdate(
    c: SettingsRouteContext,
    body:
        | {ok: true}
        | {
              error: string
          },
    status: 200 | 400 | 401 | 409 = 200,
): Response {
    if (c.req.header('accept')?.includes('text/html')) {
        return c.redirect('/settings', status === 200 ? 302 : 303)
    }

    return jsonResponse(c, 'ok' in body ? OkResponseSchema : ErrorResponseSchema, body, status)
}
