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

export type UserRole = 'user' | 'admin'

export type CurrentUser = {
    id: string
    sessionId?: string
    email: string
    username: string
    role: UserRole
    profilePhotoKey: string | null
    bio: string
    displayNsfwMedia: boolean
    lastSeenVersion: string | null
    recoveryPhraseConfirmed?: boolean
    secureAccountRequired?: boolean
    passkeyPromptSeen?: boolean
    csrfToken: string
}

const SESSION_COOKIE = 'myoc_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
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
                `INSERT INTO sessions (id, user_id, session_hash, expires_at)
             VALUES (?, ?, ?, ?)`,
            )
            .bind(crypto.randomUUID(), userId, sessionHash, toSqlTimestamp(expiresAt)),
    ])

    return sessionToken
}

export async function deleteSession(db: D1Database, sessionToken: string): Promise<void> {
    const sessionHash = await sha256Hex(sessionToken)

    await db.prepare('DELETE FROM sessions WHERE session_hash = ?').bind(sessionHash).run()
}

export async function getCurrentUser(c: Context<{Bindings: Bindings}>): Promise<CurrentUser | null> {
    const sessionToken = getCookie(c, SESSION_COOKIE)

    if (!sessionToken) {
        return null
    }

    const sessionHash = await sha256Hex(sessionToken)
    const user = await c.env.DB.prepare(
        `SELECT users.id,
                sessions.id AS session_id,
                users.email,
                users.username,
                users.role,
                users.profile_photo_key,
                users.bio,
                users.display_nsfw_media,
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
        .bind(sessionHash, toSqlTimestamp(new Date()))
        .first<{
            id: string
            session_id: string
            email: string
            username: string
            role: string | null
            profile_photo_key: string | null
            bio: string
            display_nsfw_media: number
            last_seen_version: string | null
            recovery_phrase_confirmed_at: string | null
            secure_account_required: number | null
            passkey_prompt_seen_at: string | null
        }>()

    if (!user) {
        return null
    }

    return {
        id: user.id,
        sessionId: user.session_id,
        email: user.email,
        username: user.username,
        role: normalizeUserRole(user.role),
        profilePhotoKey: user.profile_photo_key,
        bio: user.bio,
        displayNsfwMedia: Boolean(user.display_nsfw_media),
        lastSeenVersion: user.last_seen_version ?? null,
        recoveryPhraseConfirmed: Boolean(user.recovery_phrase_confirmed_at),
        secureAccountRequired: Boolean(user.secure_account_required),
        passkeyPromptSeen: Boolean(user.passkey_prompt_seen_at),
        csrfToken: await createCsrfToken(sessionToken),
    }
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
    if (!csrfToken) {
        return false
    }

    return timingSafeEqual(await createCsrfToken(sessionToken), csrfToken)
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

export function normalizeUserRole(role: unknown): UserRole {
    return role === 'admin' ? 'admin' : 'user'
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
