import {
    type AuthenticationResponseJSON,
    type RegistrationResponseJSON,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {compare} from 'bcryptjs'
import {Hono} from 'hono'
import {getCookie} from 'hono/cookie'
import {z} from 'zod'
import {
    createCredentialPublicKeyValue,
    createDisabledPasswordHash,
    createNewAccountPasskeyRegistrationOptions,
    createPasskeyAuthenticationOptions,
    generateRecoveryPhrase,
    getPasskeyByCredentialId,
    getWebAuthnChallenge,
    getWebAuthnRelyingParty,
    hashRecoveryPhrase,
    hasUsablePassword,
    serializeTransports,
    toWebAuthnCredential,
    verifyRecoveryPhrase,
} from '../../lib/auth/passkeys'
import {
    clearSessionCookie,
    createCsrfToken,
    createSession,
    deleteSession,
    getSessionCookieName,
    normalizeCredential,
    setSessionCookie,
    toPublicUser,
    toSqlTimestamp,
    type UserRecord,
} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {ErrorResponseSchema, OwnUserSchema, responseSchema} from '../../lib/http/responseSchemas'
import type {Bindings} from '../../types/bindings'

type LoginRequest = {
    username?: unknown
    password?: unknown
}

type PasskeyRegistrationOptionsRequest = {
    email?: unknown
    username?: unknown
}

type PasskeyRegistrationVerifyRequest = {
    challengeId?: unknown
    credential?: unknown
    name?: unknown
}

type PasskeyAuthenticationOptionsRequest = {
    username?: unknown
}

type PasskeyAuthenticationVerifyRequest = {
    challengeId?: unknown
    credential?: unknown
}

type RecoveryLoginRequest = {
    username?: unknown
    recoveryPhrase?: unknown
}

const AuthUserResponseSchema = responseSchema({user: OwnUserSchema})
const PasskeyOptionsResponseSchema = responseSchema({
    challengeId: z.string(),
    options: z.unknown(),
})
const PasskeyRegistrationResponseSchema = responseSchema({
    user: OwnUserSchema,
    csrfToken: z.string(),
    recoveryPhrase: z.string(),
    recoveryPhraseNeedsConfirmation: z.literal(true),
})
const RecoveryLoginResponseSchema = responseSchema({
    user: OwnUserSchema,
    secureAccountRequired: z.literal(true),
})

export const authRoutes = new Hono<{Bindings: Bindings}>()

authRoutes.post('/logout', async (c) => {
    const sessionToken = getCookie(c, getSessionCookieName())
    const isBrowserForm = c.req.header('accept')?.includes('text/html')

    if (sessionToken) {
        await deleteSession(c.env.DB, sessionToken)
    }

    clearSessionCookie(c)

    if (isBrowserForm) {
        return c.redirect('/')
    }

    return c.body(null, 204)
})

authRoutes.post('/login', async (c) => {
    let body: LoginRequest

    try {
        body = await c.req.json<LoginRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const username = normalizeCredential(body.username)
    const password = normalizeCredential(body.password)

    if (!username || !password) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Username and password are required'}, 400)
    }

    const user = await c.env.DB.prepare(
        `SELECT id,
                email,
                username,
                password_hash,
                role,
                profile_photo_key,
                bio,
                display_nsfw_media,
                last_seen_version,
                created_at,
                banned_at
         FROM users
         WHERE username = ?
         LIMIT 1`,
    )
        .bind(username)
        .first<UserRecord & {banned_at: string | null}>()

    if (!user || !hasUsablePassword(user.password_hash) || !(await compare(password, user.password_hash))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid username or password'}, 401)
    }

    if (user.banned_at) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Account is banned'}, 403)
    }

    const sessionToken = await createSession(c.env.DB, user.id)
    setSessionCookie(c, sessionToken)

    return jsonResponse(c, AuthUserResponseSchema, {user: toPublicUser(user)})
})

authRoutes.post('/register/passkey/options', async (c) => {
    let body: PasskeyRegistrationOptionsRequest

    try {
        body = await c.req.json<PasskeyRegistrationOptionsRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const email = normalizeCredential(body.email)?.toLowerCase() ?? null
    const username = normalizeCredential(body.username)

    if (!email || !username) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Email and username are required'}, 400)
    }

    if (!isValidEmail(email)) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Email must be valid'}, 400)
    }

    if (!isValidUsername(username)) {
        return jsonResponse(
            c,
            ErrorResponseSchema,
            {error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores'},
            400,
        )
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
        return jsonResponse(c, ErrorResponseSchema, {error: 'Email or username is already in use'}, 409)
    }

    const registration = await createNewAccountPasskeyRegistrationOptions(c, {email, username})

    return jsonResponse(c, PasskeyOptionsResponseSchema, {
        challengeId: registration.challengeId,
        options: registration.options,
    })
})

authRoutes.post('/register/passkey/verify', async (c) => {
    let body: PasskeyRegistrationVerifyRequest

    try {
        body = await c.req.json<PasskeyRegistrationVerifyRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const challengeId = normalizeCredential(body.challengeId)

    if (!challengeId || !body.credential) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Challenge and passkey response are required'}, 400)
    }

    const challenge = await getWebAuthnChallenge(c.env.DB, challengeId, 'registration')

    if (!challenge?.user_id || !challenge.email || !challenge.username || !challenge.webauthn_user_id) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey registration expired'}, 400)
    }

    const {origin, rpID} = getWebAuthnRelyingParty(c)
    const verification = await verifyRegistrationResponse({
        response: body.credential as RegistrationResponseJSON,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
    })

    if (!verification.verified) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey could not be verified'}, 400)
    }

    const now = new Date()
    const recoveryPhrase = generateRecoveryPhrase()
    const recoveryPhraseHash = await hashRecoveryPhrase(recoveryPhrase)
    const {credential, credentialBackedUp, credentialDeviceType} = verification.registrationInfo
    const passkeyId = crypto.randomUUID()
    const user: UserRecord = {
        id: challenge.user_id,
        email: challenge.email,
        username: challenge.username,
        password_hash: createDisabledPasswordHash(),
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        created_at: toSqlTimestamp(now),
        webauthn_user_id: challenge.webauthn_user_id,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 1,
    }

    try {
        await c.env.DB.batch([
            c.env.DB.prepare(
                `INSERT INTO users (
                    id,
                    email,
                    username,
                    password_hash,
                    role,
                    bio,
                    display_nsfw_media,
                    created_at,
                    webauthn_user_id,
                    recovery_phrase_hash,
                    recovery_phrase_set_at,
                    secure_account_required,
                    secure_account_required_passkey_id
                )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                user.id,
                user.email,
                user.username,
                user.password_hash,
                user.role,
                user.bio,
                user.display_nsfw_media,
                user.created_at,
                challenge.webauthn_user_id,
                recoveryPhraseHash,
                toSqlTimestamp(now),
                1,
                passkeyId,
            ),
            c.env.DB.prepare(
                `INSERT INTO user_passkeys (
                    id,
                    user_id,
                    credential_id,
                    public_key,
                    webauthn_user_id,
                    counter,
                    device_type,
                    backed_up,
                    transports,
                    name,
                    created_at
                )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
                passkeyId,
                user.id,
                credential.id,
                createCredentialPublicKeyValue(credential.publicKey),
                challenge.webauthn_user_id,
                credential.counter,
                credentialDeviceType,
                credentialBackedUp ? 1 : 0,
                serializeTransports(credential.transports),
                normalizeOptionalText(body.name) ?? 'Primary passkey',
                toSqlTimestamp(now),
            ),
            c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(challengeId),
        ])
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            return jsonResponse(c, ErrorResponseSchema, {error: 'Email or username is already in use'}, 409)
        }

        throw error
    }

    const sessionToken = await createSession(c.env.DB, user.id, now)
    setSessionCookie(c, sessionToken)

    return jsonResponse(
        c,
        PasskeyRegistrationResponseSchema,
        {
            user: toPublicUser(user),
            csrfToken: await createCsrfToken(sessionToken),
            recoveryPhrase,
            recoveryPhraseNeedsConfirmation: true,
        },
        201,
    )
})

authRoutes.post('/login/passkey/options', async (c) => {
    let body: PasskeyAuthenticationOptionsRequest

    try {
        body = await c.req.json<PasskeyAuthenticationOptionsRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const username = normalizeCredential(body.username)
    let user: {id: string} | null = null

    if (username) {
        user = await c.env.DB.prepare(
            `SELECT users.id
             FROM users
             INNER JOIN user_passkeys ON user_passkeys.user_id = users.id
             WHERE users.username = ?
               AND users.banned_at IS NULL
             LIMIT 1`,
        )
            .bind(username)
            .first<{id: string}>()

        if (!user) {
            return jsonResponse(c, ErrorResponseSchema, {error: 'No passkey is registered for that username'}, 404)
        }
    }

    const authentication = await createPasskeyAuthenticationOptions(c, user)

    return jsonResponse(c, PasskeyOptionsResponseSchema, {
        challengeId: authentication.challengeId,
        options: authentication.options,
    })
})

authRoutes.post('/login/passkey/verify', async (c) => {
    let body: PasskeyAuthenticationVerifyRequest

    try {
        body = await c.req.json<PasskeyAuthenticationVerifyRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const challengeId = normalizeCredential(body.challengeId)
    const credentialResponse = body.credential as AuthenticationResponseJSON | undefined

    if (!challengeId || !credentialResponse?.id) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Challenge and passkey response are required'}, 400)
    }

    const challenge = await getWebAuthnChallenge(c.env.DB, challengeId, 'authentication')

    if (!challenge) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey login expired'}, 400)
    }

    const passkey = await getPasskeyByCredentialId(c.env.DB, credentialResponse.id)

    if (!passkey || (challenge.user_id && passkey.user_id !== challenge.user_id)) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey is not registered for this login'}, 401)
    }

    const {origin, rpID} = getWebAuthnRelyingParty(c)
    const verification = await verifyAuthenticationResponse({
        response: credentialResponse,
        expectedChallenge: challenge.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: toWebAuthnCredential(passkey),
        requireUserVerification: true,
    })

    if (!verification.verified) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey could not be verified'}, 401)
    }

    const user = await getUserForLogin(c.env.DB, passkey.user_id)

    if (!user) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Passkey is not registered for an active account'}, 401)
    }

    const now = new Date()
    await c.env.DB.batch([
        c.env.DB.prepare(
            `UPDATE user_passkeys
             SET counter      = ?,
                 device_type  = ?,
                 backed_up    = ?,
                 last_used_at = ?
             WHERE id = ?`,
        ).bind(
            verification.authenticationInfo.newCounter,
            verification.authenticationInfo.credentialDeviceType,
            verification.authenticationInfo.credentialBackedUp ? 1 : 0,
            toSqlTimestamp(now),
            passkey.id,
        ),
        c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(challengeId),
    ])

    const sessionToken = await createSession(c.env.DB, user.id, now)
    setSessionCookie(c, sessionToken)

    return jsonResponse(c, AuthUserResponseSchema, {user: toPublicUser(user)})
})

authRoutes.post('/recovery/login', async (c) => {
    let body: RecoveryLoginRequest

    try {
        body = await c.req.json<RecoveryLoginRequest>()
    } catch {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid JSON body'}, 400)
    }

    const username = normalizeCredential(body.username)
    const recoveryPhrase = normalizeCredential(body.recoveryPhrase)

    if (!username || !recoveryPhrase) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Username and recovery phrase are required'}, 400)
    }

    const user = await c.env.DB.prepare(
        `SELECT id,
                email,
                username,
                password_hash,
                role,
                profile_photo_key,
                bio,
                display_nsfw_media,
                last_seen_version,
                created_at,
                recovery_phrase_hash,
                banned_at
         FROM users
         WHERE username = ?
         LIMIT 1`,
    )
        .bind(username)
        .first<UserRecord & {recovery_phrase_hash: string | null; banned_at: string | null}>()

    if (!user?.recovery_phrase_hash || !(await verifyRecoveryPhrase(recoveryPhrase, user.recovery_phrase_hash))) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Invalid username or recovery phrase'}, 401)
    }

    if (user.banned_at) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Account is banned'}, 403)
    }

    const now = new Date()

    await c.env.DB.prepare(
        `UPDATE users
         SET secure_account_required            = 1,
             secure_account_required_at         = ?,
             secure_account_required_passkey_id = NULL,
             recovery_phrase_hash               = NULL,
             recovery_phrase_set_at             = NULL,
             recovery_phrase_confirmed_at       = NULL
         WHERE id = ?`,
    )
        .bind(toSqlTimestamp(now), user.id)
        .run()

    const sessionToken = await createSession(c.env.DB, user.id, now)
    setSessionCookie(c, sessionToken)

    return jsonResponse(c, RecoveryLoginResponseSchema, {
        user: toPublicUser({
            ...user,
            secure_account_required: 1,
            recovery_phrase_confirmed_at: null,
        }),
        secureAccountRequired: true,
    })
})

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUsername(username: string): boolean {
    return /^[A-Za-z0-9_]{3,32}$/.test(username)
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Error && error.message.toLowerCase().includes('unique')
}

async function getUserForLogin(db: D1Database, userId: string): Promise<UserRecord | null> {
    return await db
        .prepare(
            `SELECT id,
                email,
                username,
                password_hash,
                role,
                profile_photo_key,
                bio,
                display_nsfw_media,
                last_seen_version,
                created_at,
                recovery_phrase_confirmed_at,
                secure_account_required
         FROM users
         WHERE id = ?
           AND banned_at IS NULL
         LIMIT 1`,
        )
        .bind(userId)
        .first<UserRecord>()
}
