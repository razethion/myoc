import {hash} from 'bcryptjs'
import type {Context} from 'hono'
import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser, normalizeCredential, toSqlTimestamp, type UserRecord} from '../../lib/auth/session'
import {csrfProtection} from '../../lib/http/csrf'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {readFormDataUpTo, readJsonUpTo} from '../../lib/http/requestBody'
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

type SettingsUpdate = {
    email: string
    username: string
    bio: string
    password: string | null
    displayNsfwMedia: boolean
    socialLinks: UserSocialLink[]
}

type ParsedRequest<T> = {body: T} | {tooLarge: true}

const PASSWORD_HASH_ROUNDS = 10
const BIO_MAX_LENGTH = 255
const SETTINGS_REQUEST_MAX_BYTES = 64 * 1024
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

    const requestResult = await parseUpdateUserRequest(c.req.raw)

    if ('tooLarge' in requestResult) {
        return respondToUpdate(c, {error: 'Request body is too large'}, 413)
    }

    const updateResult = parseValidatedSettingsUpdate(requestResult.body)

    if ('error' in updateResult) {
        return respondToUpdate(c, updateResult, 400)
    }

    if (await hasConflictingUser(c.env.DB, updateResult.email, updateResult.username, currentUser.id)) {
        return respondToUpdate(c, {error: 'Email or username is already in use'}, 409)
    }

    try {
        await c.env.DB.batch(await buildSettingsUpdateStatements(c.env.DB, currentUser.id, updateResult))
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

    const requestResult = await parsePasskeyPromptResponse(c.req.raw)

    if ('tooLarge' in requestResult) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Request body is too large'}, 413)
    }

    const body = requestResult.body
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

async function parsePasskeyPromptResponse(req: Request): Promise<ParsedRequest<{choice: PasskeyPromptChoice; returnTo: string | null}>> {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
        return await parseJsonPasskeyPromptResponse(req)
    }

    return await parseFormPasskeyPromptResponse(req)
}

async function parseJsonPasskeyPromptResponse(
    req: Request,
): Promise<ParsedRequest<{choice: PasskeyPromptChoice; returnTo: string | null}>> {
    let body: {choice?: unknown; returnTo?: unknown}

    try {
        const parsed = await readJsonUpTo<unknown>(req, SETTINGS_REQUEST_MAX_BYTES)

        if (parsed === null) {
            return {tooLarge: true}
        }

        body = isRecord(parsed) ? parsed : {}
    } catch {
        body = {}
    }

    return {
        body: {
            choice: body.choice === 'setup' ? 'setup' : 'later',
            returnTo: typeof body.returnTo === 'string' ? body.returnTo : null,
        },
    }
}

async function parseFormPasskeyPromptResponse(
    req: Request,
): Promise<ParsedRequest<{choice: PasskeyPromptChoice; returnTo: string | null}>> {
    try {
        const form = await readFormDataUpTo(req, SETTINGS_REQUEST_MAX_BYTES)

        if (!form) {
            return {tooLarge: true}
        }

        const choice = form.get('choice')
        const returnTo = form.get('returnTo')

        return {
            body: {
                choice: choice === 'setup' ? 'setup' : 'later',
                returnTo: typeof returnTo === 'string' ? returnTo : null,
            },
        }
    } catch {
        return {body: {choice: 'later', returnTo: null}}
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

function parseValidatedSettingsUpdate(body: UpdateUserRequest): SettingsUpdate | {error: string} {
    const email = normalizeCredential(body.email)?.toLowerCase() ?? null
    const username = normalizeCredential(body.username)
    const bio = normalizeOptionalText(body.bio) ?? ''
    const password = normalizeOptionalText(body.password)

    if (!email || !username) {
        return {error: 'Email and username are required'}
    }

    if (!isValidEmail(email)) {
        return {error: 'Email must be valid'}
    }

    if (!isValidUsername(username)) {
        return {error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores'}
    }

    if (bio.length > BIO_MAX_LENGTH) {
        return {error: 'Bio must be 255 characters or fewer'}
    }

    if (password && password.length < 8) {
        return {error: 'Password must be at least 8 characters'}
    }

    const socialLinksResult = parseSocialLinks(body)

    if ('error' in socialLinksResult) {
        return socialLinksResult
    }

    return {
        email,
        username,
        bio,
        password,
        displayNsfwMedia: parseBooleanPreference(body.displayNsfwMedia),
        socialLinks: socialLinksResult.links,
    }
}

async function hasConflictingUser(db: D1Database, email: string, username: string, excludedUserId: string): Promise<boolean> {
    const existingUser = await db
        .prepare(
            `SELECT id
             FROM users
             WHERE (lower(email) = lower(?)
                 OR username = ?)
               AND id <> ?
             LIMIT 1`,
        )
        .bind(email, username, excludedUserId)
        .first<Pick<UserRecord, 'id'>>()

    return Boolean(existingUser)
}

async function buildSettingsUpdateStatements(db: D1Database, userId: string, update: SettingsUpdate): Promise<D1PreparedStatement[]> {
    const statements = [await buildUserUpdateStatement(db, userId, update)]
    statements.push(db.prepare('DELETE FROM user_social_links WHERE user_id = ?').bind(userId))

    for (const link of update.socialLinks) {
        statements.push(
            db
                .prepare(
                    `INSERT INTO user_social_links (user_id, platform, label, url, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                )
                .bind(userId, link.platform, link.label, link.url),
        )
    }

    return statements
}

async function buildUserUpdateStatement(db: D1Database, userId: string, update: SettingsUpdate): Promise<D1PreparedStatement> {
    const displayNsfwMedia = Number(update.displayNsfwMedia)

    if (update.password) {
        return db
            .prepare(
                `UPDATE users
                 SET email              = ?,
                     username           = ?,
                     bio                = ?,
                     display_nsfw_media = ?,
                     password_hash      = ?
                 WHERE id = ?`,
            )
            .bind(update.email, update.username, update.bio, displayNsfwMedia, await hash(update.password, PASSWORD_HASH_ROUNDS), userId)
    }

    return db
        .prepare(
            `UPDATE users
             SET email              = ?,
                 username           = ?,
                 bio                = ?,
                 display_nsfw_media = ?
             WHERE id = ?`,
        )
        .bind(update.email, update.username, update.bio, displayNsfwMedia, userId)
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

async function parseUpdateUserRequest(req: Request): Promise<ParsedRequest<UpdateUserRequest>> {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
        try {
            const body = await readJsonUpTo<unknown>(req, SETTINGS_REQUEST_MAX_BYTES)

            if (body === null) {
                return {tooLarge: true}
            }

            return {body: isRecord(body) ? body : {}}
        } catch {
            return {body: {}}
        }
    }

    try {
        const form = await readFormDataUpTo(req, SETTINGS_REQUEST_MAX_BYTES)

        if (!form) {
            return {tooLarge: true}
        }

        return {
            body: {
                email: form.get('email'),
                username: form.get('username'),
                bio: form.get('bio'),
                password: form.get('password'),
                displayNsfwMedia: form.get('displayNsfwMedia'),
                ...Object.fromEntries(FIXED_SOCIAL_LINKS.map((link) => [link.formName, form.get(link.formName)])),
                customLinkLabel: form.get('customLinkLabel'),
                customLinkUrl: form.get('customLinkUrl'),
            },
        }
    } catch {
        return {body: {}}
    }
}

function respondToUpdate(
    c: SettingsRouteContext,
    body:
        | {ok: true}
        | {
              error: string
          },
    status: 200 | 400 | 401 | 409 | 413 = 200,
): Response {
    if (c.req.header('accept')?.includes('text/html')) {
        return c.redirect('/settings', status === 200 ? 302 : 303)
    }

    return jsonResponse(c, 'ok' in body ? OkResponseSchema : ErrorResponseSchema, body, status)
}
