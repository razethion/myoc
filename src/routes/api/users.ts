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
import {profilePhotoObjectKey, profilePhotoUrl} from '../../lib/media/url'
import {getWebpDimensions} from '../../lib/media/webp'
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
    customLinkLabel?: unknown
    customLinkUrl?: unknown
    socialLinks?: unknown
    [key: string]: unknown
}

const PASSWORD_HASH_ROUNDS = 10
const BIO_MAX_LENGTH = 255
const PROFILE_PHOTO_SIZE = 512
const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024
const PROFILE_PHOTO_MAX_REQUEST_BYTES = 3 * 1024 * 1024

export const userRoutes = new Hono<{ Bindings: Bindings }>()

userRoutes.post('/me/profile-photo', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const contentLength = Number(c.req.header('content-length') ?? 0)

    if (contentLength > PROFILE_PHOTO_MAX_REQUEST_BYTES) {
        return c.json({error: 'Profile photo upload is too large'}, 413)
    }

    const form = await c.req.formData()
    const file = form.get('profilePhoto')

    if (!(file instanceof File)) {
        return c.json({error: 'Profile photo is required'}, 400)
    }

    if (file.type !== 'image/webp') {
        return c.json({error: 'Profile photo must be a WebP image'}, 400)
    }

    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
        return c.json({error: 'Profile photo must be 2 MB or smaller'}, 400)
    }

    const bytes = new Uint8Array(await file.arrayBuffer())
    const dimensions = getWebpDimensions(bytes)

    if (!dimensions) {
        return c.json({error: 'Profile photo must be a valid WebP image'}, 400)
    }

    if (dimensions.width !== PROFILE_PHOTO_SIZE || dimensions.height !== PROFILE_PHOTO_SIZE) {
        return c.json({error: 'Profile photo must be exactly 512x512 pixels'}, 400)
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
                     password_hash = ?
                 WHERE id = ?`,
            )
                .bind(email, username, bio, await hash(password, PASSWORD_HASH_ROUNDS), currentUser.id))
        } else {
            statements.push(c.env.DB.prepare(
                `UPDATE users
                 SET email    = ?,
                     username = ?,
                     bio      = ?
                 WHERE id = ?`,
            )
                .bind(email, username, bio, currentUser.id))
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

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' ? value.trim() : null
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
