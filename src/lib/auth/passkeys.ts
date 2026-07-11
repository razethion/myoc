import {compare, hash} from 'bcryptjs'
import {wordlist} from '@scure/bip39/wordlists/english.js'
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    type AuthenticatorTransportFuture,
    type Base64URLString,
    type PublicKeyCredentialCreationOptionsJSON,
    type PublicKeyCredentialRequestOptionsJSON,
    type WebAuthnCredential,
} from '@simplewebauthn/server'
import type {Context} from 'hono'
import type {Bindings} from '../../types/bindings'
import {toSqlTimestamp, type CurrentUser} from './session'

export type PasskeyRecord = {
    id: string
    user_id: string
    credential_id: Base64URLString
    public_key: string
    webauthn_user_id: Base64URLString
    counter: number
    device_type: string
    backed_up: number
    transports: string | null
    name: string | null
    created_at: string
    last_used_at: string | null
}

export type PasskeySummary = {
    id: string
    name: string
    deviceType: string
    backedUp: boolean
    transports: string[]
    createdAt: string
    lastUsedAt: string | null
}

export type SessionSummary = {
    id: string
    createdAt: string
    expiresAt: string
    isCurrent: boolean
}

export type WebAuthnChallengeRecord = {
    id: string
    user_id: string | null
    email: string | null
    username: string | null
    webauthn_user_id: string | null
    ceremony: 'registration' | 'authentication'
    challenge: string
    expires_at: string
}

export type PasskeyRegistrationOptions = {
    challengeId: string
    options: PublicKeyCredentialCreationOptionsJSON
}

export type PasskeyAuthenticationOptions = {
    challengeId: string
    options: PublicKeyCredentialRequestOptionsJSON
}

const CHALLENGE_TTL_SECONDS = 60 * 5
const RECOVERY_WORD_COUNT = 4
const RECOVERY_HASH_ROUNDS = 10
const PASSWORD_UNSET_PREFIX = 'passkey-only:'

export function getWebAuthnRelyingParty(c: Context<{ Bindings: Bindings }>): { rpID: string; origin: string } {
    const url = new URL(c.req.url)
    const isLoopbackIp = url.hostname === '127.0.0.1' || url.hostname === '::1'
    const rpID = isLoopbackIp ? 'localhost' : url.hostname
    const host = isLoopbackIp
        ? `localhost${url.port ? `:${url.port}` : ''}`
        : url.host

    return {
        rpID,
        origin: `${url.protocol}//${host}`,
    }
}

export async function createPasskeyRegistrationOptions(
    c: Context<{ Bindings: Bindings }>,
    user: { id: string; username: string; email: string; webauthn_user_id?: string | null },
): Promise<PasskeyRegistrationOptions> {
    const {rpID} = getWebAuthnRelyingParty(c)
    const webAuthnUserId = user.webauthn_user_id ?? createBase64UrlToken(32)
    const existingPasskeys = await listUserPasskeys(c.env.DB, user.id)
    const options = await generateRegistrationOptions({
        rpName: 'MyOC',
        rpID,
        userID: base64UrlToBytes(webAuthnUserId),
        userName: user.username,
        userDisplayName: user.username,
        attestationType: 'none',
        excludeCredentials: existingPasskeys.map((passkey) => ({
            id: passkey.credential_id,
            transports: parseTransports(passkey.transports),
        })),
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
        },
        supportedAlgorithmIDs: [-7, -257],
    })

    const challengeId = await storeWebAuthnChallenge(c.env.DB, {
        userId: user.id,
        email: user.email,
        username: user.username,
        webAuthnUserId,
        ceremony: 'registration',
        challenge: options.challenge,
    })

    return {challengeId, options}
}

export async function createNewAccountPasskeyRegistrationOptions(
    c: Context<{ Bindings: Bindings }>,
    user: { email: string; username: string },
): Promise<PasskeyRegistrationOptions & { userId: string; webAuthnUserId: string }> {
    const {rpID} = getWebAuthnRelyingParty(c)
    const userId = crypto.randomUUID()
    const webAuthnUserId = createBase64UrlToken(32)
    const options = await generateRegistrationOptions({
        rpName: 'MyOC',
        rpID,
        userID: base64UrlToBytes(webAuthnUserId),
        userName: user.username,
        userDisplayName: user.username,
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
        },
        supportedAlgorithmIDs: [-7, -257],
    })

    const challengeId = await storeWebAuthnChallenge(c.env.DB, {
        userId,
        email: user.email,
        username: user.username,
        webAuthnUserId,
        ceremony: 'registration',
        challenge: options.challenge,
    })

    return {challengeId, options, userId, webAuthnUserId}
}

export async function createPasskeyAuthenticationOptions(
    c: Context<{ Bindings: Bindings }>,
    user?: { id: string } | null,
): Promise<PasskeyAuthenticationOptions> {
    const {rpID} = getWebAuthnRelyingParty(c)
    const passkeys = user ? await listUserPasskeys(c.env.DB, user.id) : []
    const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: user
            ? passkeys.map((passkey) => ({
                id: passkey.credential_id,
                transports: parseTransports(passkey.transports),
            }))
            : undefined,
        userVerification: 'required',
    })

    const challengeId = await storeWebAuthnChallenge(c.env.DB, {
        userId: user?.id ?? null,
        ceremony: 'authentication',
        challenge: options.challenge,
    })

    return {challengeId, options}
}

export async function storeWebAuthnChallenge(
    db: D1Database,
    options: {
        userId?: string | null
        email?: string | null
        username?: string | null
        webAuthnUserId?: string | null
        ceremony: 'registration' | 'authentication'
        challenge: string
        now?: Date
    },
): Promise<string> {
    const now = options.now ?? new Date()
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_SECONDS * 1000)
    const challengeId = crypto.randomUUID()

    await db.batch([
        db.prepare('DELETE FROM webauthn_challenges WHERE expires_at <= ?').bind(toSqlTimestamp(now)),
        db.prepare(
            `INSERT INTO webauthn_challenges (id, user_id, email, username, webauthn_user_id, ceremony, challenge, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
            challengeId,
            options.userId ?? null,
            options.email ?? null,
            options.username ?? null,
            options.webAuthnUserId ?? null,
            options.ceremony,
            options.challenge,
            toSqlTimestamp(expiresAt),
        ),
    ])

    return challengeId
}

export async function getWebAuthnChallenge(
    db: D1Database,
    challengeId: string,
    ceremony: 'registration' | 'authentication',
    now = new Date(),
): Promise<WebAuthnChallengeRecord | null> {
    return await db.prepare(
        `SELECT id,
                user_id,
                email,
                username,
                webauthn_user_id,
                ceremony,
                challenge,
                expires_at
         FROM webauthn_challenges
         WHERE id = ?
           AND ceremony = ?
           AND expires_at > ?
         LIMIT 1`,
    )
        .bind(challengeId, ceremony, toSqlTimestamp(now))
        .first<WebAuthnChallengeRecord>()
}

export async function deleteWebAuthnChallenge(db: D1Database, challengeId: string): Promise<void> {
    await db.prepare('DELETE FROM webauthn_challenges WHERE id = ?')
        .bind(challengeId)
        .run()
}

export async function listUserPasskeys(db: D1Database, userId: string): Promise<PasskeyRecord[]> {
    const result = await db.prepare(
        `SELECT id,
                user_id,
                credential_id,
                public_key,
                webauthn_user_id,
                counter,
                device_type,
                backed_up,
                transports,
                name,
                created_at,
                last_used_at
         FROM user_passkeys
         WHERE user_id = ?
         ORDER BY created_at DESC`,
    )
        .bind(userId)
        .all<PasskeyRecord>()

    return result.results
}

export async function getPasskeyByCredentialId(db: D1Database, credentialId: string): Promise<PasskeyRecord | null> {
    return await db.prepare(
        `SELECT id,
                user_id,
                credential_id,
                public_key,
                webauthn_user_id,
                counter,
                device_type,
                backed_up,
                transports,
                name,
                created_at,
                last_used_at
         FROM user_passkeys
         WHERE credential_id = ?
         LIMIT 1`,
    )
        .bind(credentialId)
        .first<PasskeyRecord>()
}

export async function getUserPasskeyById(db: D1Database, userId: string, passkeyId: string): Promise<PasskeyRecord | null> {
    return await db.prepare(
        `SELECT id,
                user_id,
                credential_id,
                public_key,
                webauthn_user_id,
                counter,
                device_type,
                backed_up,
                transports,
                name,
                created_at,
                last_used_at
         FROM user_passkeys
         WHERE user_id = ?
           AND id = ?
         LIMIT 1`,
    )
        .bind(userId, passkeyId)
        .first<PasskeyRecord>()
}

export function toWebAuthnCredential(passkey: PasskeyRecord): WebAuthnCredential {
    return {
        id: passkey.credential_id,
        publicKey: base64UrlToBytes(passkey.public_key),
        counter: passkey.counter,
        transports: parseTransports(passkey.transports),
    }
}

export function toPasskeySummary(passkey: PasskeyRecord): PasskeySummary {
    return {
        id: passkey.id,
        name: passkey.name ?? defaultPasskeyName(passkey),
        deviceType: passkey.device_type,
        backedUp: Boolean(passkey.backed_up),
        transports: parseTransports(passkey.transports) ?? [],
        createdAt: passkey.created_at,
        lastUsedAt: passkey.last_used_at,
    }
}

export async function listUserSessions(db: D1Database, user: CurrentUser): Promise<SessionSummary[]> {
    const result = await db.prepare(
        `SELECT id,
                created_at,
                expires_at
         FROM sessions
         WHERE user_id = ?
           AND expires_at > ?
         ORDER BY created_at DESC`,
    )
        .bind(user.id, toSqlTimestamp(new Date()))
        .all<{
            id: string
            created_at: string
            expires_at: string
        }>()

    return result.results.map((session) => ({
        id: session.id,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        isCurrent: session.id === user.sessionId,
    }))
}

export function serializeTransports(transports?: AuthenticatorTransportFuture[]): string | null {
    return transports?.length ? transports.join(',') : null
}

export function parseTransports(value: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
    if (!value) {
        return undefined
    }

    return value.split(',')
        .map((transport) => transport.trim())
        .filter(Boolean) as AuthenticatorTransportFuture[]
}

export function createCredentialPublicKeyValue(publicKey: Uint8Array): string {
    return bytesToBase64Url(publicKey)
}

export function createDisabledPasswordHash(): string {
    return `${PASSWORD_UNSET_PREFIX}${createBase64UrlToken(32)}`
}

export function hasUsablePassword(passwordHash: string): boolean {
    return !passwordHash.startsWith(PASSWORD_UNSET_PREFIX)
}

export function generateRecoveryPhrase(): string {
    const words: string[] = []
    const bytes = new Uint16Array(RECOVERY_WORD_COUNT)
    crypto.getRandomValues(bytes)

    for (const value of bytes) {
        words.push(wordlist[value % wordlist.length])
    }

    return words.join('-')
}

export async function hashRecoveryPhrase(phrase: string): Promise<string> {
    return await hash(normalizeRecoveryPhrase(phrase), RECOVERY_HASH_ROUNDS)
}

export async function verifyRecoveryPhrase(phrase: string, phraseHash: string): Promise<boolean> {
    return await compare(normalizeRecoveryPhrase(phrase), phraseHash)
}

export function normalizeRecoveryPhrase(phrase: string): string {
    return phrase.trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-')
}

export function createBase64UrlToken(byteLength: number): string {
    const bytes = new Uint8Array(byteLength)
    crypto.getRandomValues(bytes)
    return bytesToBase64Url(bytes)
}

export function bytesToBase64Url(bytes: Uint8Array): Base64URLString {
    let binary = ''

    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const binary = atob(padded)
    const buffer = new ArrayBuffer(binary.length)
    const bytes = new Uint8Array(buffer)

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }

    return bytes
}

function defaultPasskeyName(passkey: PasskeyRecord): string {
    if (passkey.device_type === 'multiDevice') {
        return 'Synced passkey'
    }

    return 'Security key'
}
