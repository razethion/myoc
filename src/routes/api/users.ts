import {hash} from 'bcryptjs'
import {Hono} from 'hono'
import type {Context} from 'hono'
import {
    createSession,
    getCurrentUser,
    normalizeCredential,
    setSessionCookie,
    toPublicUser,
    toSqlTimestamp,
    type UserRecord,
} from '../../lib/auth/session'
import {APP_VERSION} from '../../lib/releases'
import {profilePhotoObjectKey, profilePhotoUrl} from '../../lib/media/url'
import {
    PROFILE_IMAGE_MAX_REQUEST_BYTES,
    validateProfileImagePayload,
} from '../../lib/media/profileImage'
import {FIXED_SOCIAL_LINKS, type UserSocialLink} from '../../lib/socialLinks'
import type {Bindings} from '../../types/bindings'

type UserRouteContext = Context<{ Bindings: Bindings }>

type CreateUserRequest = {
    email?: unknown
    username?: unknown
    password?: unknown
}

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
export const userRoutes = new Hono<{ Bindings: Bindings }>()

userRoutes.post('/me/release-view', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    await c.env.DB.prepare(
        `UPDATE users
         SET last_seen_version = ?
         WHERE id = ?`,
    )
        .bind(APP_VERSION, currentUser.id)
        .run()

    return c.json({
        ok: true,
        version: APP_VERSION,
    })
})

userRoutes.post('/me/passkey-prompt-response', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
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

    return c.json({
        ok: true,
        choice,
        redirectTo,
    })
})

userRoutes.post('/me/profile-photo', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
        return c.json({error: 'Profile photo upload is too large'}, 413)
    }

    const form = await c.req.formData()
    const file = form.get('profilePhoto')

    if (!(file instanceof File)) {
        return c.json({error: 'Profile photo is required'}, 400)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const validation = validateProfileImagePayload({
        contentType: file.type,
        bytes,
    }, 'Profile photo')

    if ('error' in validation) {
        return c.json({error: validation.error}, validation.status)
    }

    const profilePhotoKey = crypto.randomUUID()
    const objectKey = profilePhotoObjectKey(currentUser.id, profilePhotoKey)

    await c.env.MEDIA_BUCKET.put(objectKey, bytes, {
        httpMetadata: {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: 'image/webp',
        },
    })

    try {
        await c.env.DB.prepare(
            `UPDATE users
             SET profile_photo_key = ?
             WHERE id = ?`,
        )
            .bind(profilePhotoKey, currentUser.id)
            .run()
    } catch (error) {
        await c.env.MEDIA_BUCKET.delete(objectKey)
        throw error
    }

    if (currentUser.profilePhotoKey) {
        try {
            await c.env.MEDIA_BUCKET.delete(profilePhotoObjectKey(currentUser.id, currentUser.profilePhotoKey))
        } catch (error) {
            console.warn('Unable to delete old profile photo', error)
        }
    }

    return c.json({
        profilePhotoKey,
        profilePhotoUrl: profilePhotoUrl(c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id, profilePhotoKey),
    })
})

userRoutes.post('/me', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        if (c.req.header('accept')?.includes('text/html')) {
            return c.redirect('/login')
        }

        return c.json({error: 'Authentication required'}, 401)
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
            statements.push(c.env.DB.prepare(
                `UPDATE users
                 SET email         = ?,
                     username      = ?,
                     bio           = ?,
                     display_nsfw_media = ?,
                     password_hash = ?
                 WHERE id = ?`,
            )
                .bind(email, username, bio, displayNsfwMedia ? 1 : 0, await hash(password, PASSWORD_HASH_ROUNDS), currentUser.id))
        } else {
            statements.push(c.env.DB.prepare(
                `UPDATE users
                 SET email              = ?,
                     username           = ?,
                     bio                = ?,
                     display_nsfw_media = ?
                 WHERE id = ?`,
            )
                .bind(email, username, bio, displayNsfwMedia ? 1 : 0, currentUser.id))
        }

        statements.push(c.env.DB.prepare('DELETE FROM user_social_links WHERE user_id = ?').bind(currentUser.id))

        for (const link of socialLinksResult.links) {
            statements.push(c.env.DB.prepare(
                `INSERT INTO user_social_links (user_id, platform, label, url, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            ).bind(currentUser.id, link.platform, link.label, link.url))
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
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        created_at: toSqlTimestamp(now),
    }

    try {
        await c.env.DB.prepare(
            `INSERT INTO users (id, email, username, password_hash, role, bio, display_nsfw_media, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
            .bind(user.id, user.email, user.username, user.password_hash, user.role, user.bio, user.display_nsfw_media, user.created_at)
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

async function parsePasskeyPromptResponse(req: Request): Promise<{
    choice: PasskeyPromptChoice
    returnTo: string | null
}> {
    const contentType = req.headers.get('content-type') ?? ''

    if (contentType.includes('application/json')) {
        const body = await req.json().catch(() => ({})) as { choice?: unknown; returnTo?: unknown }

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

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() : null
}

function parseBooleanPreference(value: unknown): boolean {
    return value === true
        || value === 'true'
        || value === '1'
        || value === 'on'
}

function parseSocialLinks(body: UpdateUserRequest): { links: UserSocialLink[] } | { error: string } {
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

function validateSocialUrl(value: string, label: string): { url: string } | { error: string } {
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

async function parseUpdateUserRequest(req: UserRouteContext['req']): Promise<UpdateUserRequest> {
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

function respondToUpdate(c: UserRouteContext, body: { ok: true } | {
    error: string
}, status: 200 | 400 | 401 | 409 = 200): Response {
    if (c.req.header('accept')?.includes('text/html')) {
        return c.redirect('/settings', status === 200 ? 302 : 303)
    }

    return c.json(body, status)
}
