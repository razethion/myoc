import type {Context} from 'hono'
import {getCookie, setCookie} from 'hono/cookie'
import type {Bindings} from '../../types/bindings'

export type UserRecord = {
    id: string
    email: string
    username: string
    password_hash: string
    role: UserRole
    profile_photo_key: string | null
    bio: string
    display_nsfw_media: number
    last_seen_version: string | null
    created_at: string
    webauthn_user_id?: string | null
    recovery_phrase_confirmed_at?: string | null
    secure_account_required?: number | null
    passkey_prompt_seen_at?: string | null
}

export type UserRole = 'user' | 'moderator' | 'admin'

export type CurrentUser = {
    id: string
    sessionId: string
    email: string
    username: string
    role: UserRole
    profilePhotoKey: string | null
    bio: string
    displayNsfwMedia: boolean
    showUnapprovedMedia: boolean
    lastSeenVersion: string | null
    authenticatedAt: string | null
    recoveryPhraseConfirmed?: boolean
    secureAccountRequired?: boolean
    passkeyPromptSeen?: boolean
    csrfToken: string
}

const SESSION_COOKIE = 'myoc_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

// Sensitive account changes require a full authentication no older than this window.
const STEP_UP_AUTH_WINDOW_SECONDS = 10 * 60
const SESSION_RENEWAL_INTERVAL_SECONDS = 60 * 60 * 24
const SESSION_TOKEN_BYTES = 32
const CSRF_TOKEN_PREFIX = 'csrf:'

export async function createSession(db: D1Database, userId: string, now = new Date()): Promise<string> {
    const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
    const sessionToken = createSessionToken()
    const sessionHash = await sha256Hex(sessionToken)

    await db.batch([
        db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(toSqlTimestamp(now)),
        db
            .prepare(
                `INSERT INTO sessions (id, user_id, session_hash, expires_at, authenticated_at)
             VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(crypto.randomUUID(), userId, sessionHash, toSqlTimestamp(expiresAt), toSqlTimestamp(now)),
    ])

    return sessionToken
}

export async function deleteSession(db: D1Database, sessionToken: string): Promise<void> {
    const sessionHash = await sha256Hex(sessionToken)

    await db.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(sessionHash).run()
}

/**
 * True when the session completed a full authentication inside the step-up window.
 * A missing or unparseable timestamp fails closed: an unusable value can only
 * block a change, never authorize one.
 */
export function hasRecentAuthentication(user: Pick<CurrentUser, 'authenticatedAt'>, now = new Date()): boolean {
    if (!user.authenticatedAt) {
        return false
    }

    const authenticatedAtMs = Date.parse(`${user.authenticatedAt.replace(' ', 'T')}Z`)

    // A NaN timestamp makes the comparison false, so unparseable values fail closed.
    return now.getTime() - authenticatedAtMs <= STEP_UP_AUTH_WINDOW_SECONDS * 1000
}

/**
 * SQL fragment that guards every credential write and session revocation for
 * issue #251. A request that started on a session later revoked (a password
 * change or recovery login ends other sessions) must commit nothing once that
 * session is gone, including its own revocation, which would otherwise delete
 * the owner's remaining sessions while its keep id points at a dead row.
 */
export const SESSION_STILL_ACTIVE = 'EXISTS (SELECT 1 FROM sessions WHERE id = ? AND user_id = ?)'

/**
 * Statement that deletes every session except the one being kept, and only
 * while that kept session still exists. Callers add it to the same DB.batch as
 * the credential change it belongs to, so a failed revocation rolls the
 * credential change back instead of leaving a partial security update.
 */
export function revokeOtherSessionsStatement(db: D1Database, userId: string, keepSessionId: string): D1PreparedStatement {
    return db
        .prepare(
            `DELETE FROM sessions
         WHERE user_id = ?
           AND id <> ?
           AND ${SESSION_STILL_ACTIVE}`,
        )
        .bind(userId, keepSessionId, keepSessionId, userId)
}

export async function getCurrentUser(c: Context<{Bindings: Bindings}>): Promise<CurrentUser | null> {
    const sessionToken = getCookie(c, SESSION_COOKIE)

    if (!sessionToken) {
        return null
    }

    const now = new Date()
    const sessionHash = await sha256Hex(sessionToken)
    const user = await c.env.DB.prepare(
        `SELECT users.id,
                sessions.id AS session_id,
                sessions.expires_at AS session_expires_at,
                sessions.authenticated_at,
                users.email,
                users.username,
                users.role,
                users.profile_photo_key,
                users.bio,
                users.display_nsfw_media,
                users.show_unapproved_media,
                users.last_seen_version,
                users.recovery_phrase_confirmed_at,
                users.secure_account_required,
                users.passkey_prompt_seen_at
         FROM sessions
         INNER JOIN users ON users.id = sessions.user_id
         WHERE sessions.session_hash = ?
           AND sessions.expires_at > ?
           AND users.banned_at IS NULL
         LIMIT 1`,
    )
        .bind(sessionHash, toSqlTimestamp(now))
        .first<{
            id: string
            session_id: string
            session_expires_at: string
            authenticated_at: string | null
            email: string
            username: string
            role: string | null
            profile_photo_key: string | null
            bio: string
            display_nsfw_media: number
            show_unapproved_media?: number
            last_seen_version: string | null
            recovery_phrase_confirmed_at: string | null
            secure_account_required: number | null
            passkey_prompt_seen_at: string | null
        }>()

    if (!user) {
        return null
    }

    await renewSessionIfDue(c, sessionToken, user.session_id, user.session_expires_at, now)

    return {
        id: user.id,
        sessionId: user.session_id,
        email: user.email,
        username: user.username,
        role: normalizeUserRole(user.role),
        profilePhotoKey: user.profile_photo_key,
        bio: user.bio,
        displayNsfwMedia: Boolean(user.display_nsfw_media),
        showUnapprovedMedia: user.show_unapproved_media !== 0,
        lastSeenVersion: user.last_seen_version ?? null,
        authenticatedAt: user.authenticated_at ?? null,
        recoveryPhraseConfirmed: Boolean(user.recovery_phrase_confirmed_at),
        secureAccountRequired: Boolean(user.secure_account_required),
        passkeyPromptSeen: Boolean(user.passkey_prompt_seen_at),
        csrfToken: await createCsrfToken(sessionToken),
    }
}

async function renewSessionIfDue(
    c: Context<{Bindings: Bindings}>,
    sessionToken: string,
    sessionId: string,
    sessionExpiresAt: string,
    now: Date,
): Promise<void> {
    // Renew when the session is at least one day old, so an active session is written at most once per day.
    const renewBefore = new Date(now.getTime() + (SESSION_TTL_SECONDS - SESSION_RENEWAL_INTERVAL_SECONDS) * 1000)

    if (sessionExpiresAt > toSqlTimestamp(renewBefore)) {
        return
    }

    const renewedExpiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000)
    await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ? AND expires_at <= ?')
        .bind(toSqlTimestamp(renewedExpiresAt), sessionId, toSqlTimestamp(renewBefore))
        .run()
    setSessionCookie(c, sessionToken)
}

export function setSessionCookie(c: Context<{Bindings: Bindings}>, sessionToken: string): void {
    setCookie(c, SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge: SESSION_TTL_SECONDS,
        path: '/',
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
    })
}

export function clearSessionCookie(c: Context<{Bindings: Bindings}>): void {
    setCookie(c, SESSION_COOKIE, '', {
        httpOnly: true,
        maxAge: 0,
        path: '/',
        sameSite: 'Lax',
        secure: new URL(c.req.url).protocol === 'https:',
    })
}

export function getSessionCookieName(): string {
    return SESSION_COOKIE
}

export async function createCsrfToken(sessionToken: string): Promise<string> {
    return await sha256Hex(`${CSRF_TOKEN_PREFIX}${sessionToken}`)
}

export async function isValidCsrfToken(sessionToken: string, csrfToken: string | null): Promise<boolean> {
    return isValidCsrfTokenValue(await createCsrfToken(sessionToken), csrfToken)
}

export function isValidCsrfTokenValue(expectedCsrfToken: string, csrfToken: unknown): boolean {
    return typeof csrfToken === 'string' && timingSafeEqual(expectedCsrfToken, csrfToken)
}

export function normalizeCredential(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export function toPublicUser(user: UserRecord) {
    return {
        id: user.id,
        email: user.email,
        username: user.username,
        role: normalizeUserRole(user.role),
        profilePhotoKey: user.profile_photo_key,
        bio: user.bio,
        displayNsfwMedia: Boolean(user.display_nsfw_media),
        lastSeenVersion: user.last_seen_version ?? null,
        createdAt: user.created_at,
    }
}

export function toSqlTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19)
}

export function isAdminUser(user: CurrentUser | null): user is CurrentUser & {role: 'admin'} {
    return user?.role === 'admin'
}

export function canModerateImages(user: CurrentUser | null): user is CurrentUser & {role: 'moderator' | 'admin'} {
    return user?.role === 'moderator' || user?.role === 'admin'
}

function normalizeUserRole(role: unknown): UserRole {
    return role === 'moderator' || role === 'admin' ? role : 'user'
}

function createSessionToken(): string {
    const bytes = new Uint8Array(SESSION_TOKEN_BYTES)
    crypto.getRandomValues(bytes)
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(left: string, right: string): boolean {
    const leftBytes = new TextEncoder().encode(left)
    const rightBytes = new TextEncoder().encode(right)

    if (leftBytes.length !== rightBytes.length) {
        return false
    }

    let mismatch = 0

    for (let index = 0; index < leftBytes.length; index += 1) {
        mismatch |= byteAt(leftBytes, index) ^ byteAt(rightBytes, index)
    }

    return mismatch === 0
}

function byteAt(bytes: Uint8Array, offset: number): number {
    const value = bytes[offset]
    if (value === undefined) {
        throw new Error(`Byte offset out of range: ${offset}`)
    }

    return value
}
