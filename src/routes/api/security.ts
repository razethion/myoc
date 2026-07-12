import {type RegistrationResponseJSON, verifyRegistrationResponse} from '@simplewebauthn/server'
import {Hono} from 'hono'
import {
    createCredentialPublicKeyValue,
    createDisabledPasswordHash,
    createPasskeyRegistrationOptions,
    generateRecoveryPhrase,
    getUserPasskeyById,
    getWebAuthnChallenge,
    getWebAuthnRelyingParty,
    hashRecoveryPhrase,
    hasUsablePassword,
    listUserPasskeys,
    serializeTransports,
    verifyRecoveryPhrase,
} from '../../lib/auth/passkeys'
import {getCurrentUser, normalizeCredential, toSqlTimestamp} from '../../lib/auth/session'
import type {Bindings} from '../../types/bindings'

type PasskeyVerifyRequest = {
    challengeId?: unknown
    credential?: unknown
    name?: unknown
}

type RecoveryPhraseRequest = {
    recoveryPhrase?: unknown
}

type SecurityUserRecord = {
    id: string
    email: string
    username: string
    password_hash: string
    webauthn_user_id: string | null
    recovery_phrase_hash: string | null
    recovery_phrase_confirmed_at: string | null
    secure_account_required: number
    secure_account_required_at: string | null
    secure_account_required_passkey_id: string | null
}

export const securityRoutes = new Hono<{Bindings: Bindings}>()

securityRoutes.post('/passkeys/options', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const user = await getSecurityUser(c.env.DB, currentUser.id)

    if (!user) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const registration = await createPasskeyRegistrationOptions(c, user)

    return c.json({
        challengeId: registration.challengeId,
        options: registration.options,
    })
})

securityRoutes.post('/passkeys/verify', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    let body: PasskeyVerifyRequest

    try {
        body = await c.req.json<PasskeyVerifyRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const challengeId = normalizeCredential(body.challengeId)

    if (!challengeId || !body.credential) {
        return c.json({error: 'Challenge and passkey response are required'}, 400)
    }

    const challenge = await getWebAuthnChallenge(c.env.DB, challengeId, 'registration')

    if (!challenge || challenge.user_id !== currentUser.id || !challenge.webauthn_user_id) {
        return c.json({error: 'Passkey registration expired'}, 400)
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
        return c.json({error: 'Passkey could not be verified'}, 400)
    }

    const now = new Date()
    const {credential, credentialBackedUp, credentialDeviceType} = verification.registrationInfo
    const passkeyId = crypto.randomUUID()

    await c.env.DB.batch([
        c.env.DB.prepare(
            `UPDATE users
             SET webauthn_user_id = COALESCE(webauthn_user_id, ?),
                 secure_account_required_passkey_id = CASE
                     WHEN secure_account_required = 1 THEN ?
                     ELSE secure_account_required_passkey_id
                 END
             WHERE id = ?`,
        ).bind(challenge.webauthn_user_id, passkeyId, currentUser.id),
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
            currentUser.id,
            credential.id,
            createCredentialPublicKeyValue(credential.publicKey),
            challenge.webauthn_user_id,
            credential.counter,
            credentialDeviceType,
            credentialBackedUp ? 1 : 0,
            serializeTransports(credential.transports),
            normalizeOptionalText(body.name) ?? null,
            toSqlTimestamp(now),
        ),
        c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE id = ?').bind(challengeId),
    ])

    return c.json({ok: true})
})

securityRoutes.delete('/passkeys/:id', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const passkeyId = c.req.param('id')
    const [user, passkeys] = await Promise.all([getSecurityUser(c.env.DB, currentUser.id), listUserPasskeys(c.env.DB, currentUser.id)])

    if (!user) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const passkey = await getUserPasskeyById(c.env.DB, currentUser.id, passkeyId)

    if (!passkey) {
        return c.json({error: 'Passkey not found'}, 404)
    }

    if (passkeys.length <= 1 && !hasUsablePassword(user.password_hash)) {
        return c.json({error: 'Add another passkey before removing this one'}, 400)
    }

    await c.env.DB.prepare(
        `DELETE FROM user_passkeys
         WHERE user_id = ?
           AND id = ?`,
    )
        .bind(currentUser.id, passkeyId)
        .run()

    return c.json({ok: true})
})

securityRoutes.post('/recovery/regenerate', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const phrase = generateRecoveryPhrase()
    const phraseHash = await hashRecoveryPhrase(phrase)

    await c.env.DB.prepare(
        `UPDATE users
         SET recovery_phrase_hash         = ?,
             recovery_phrase_set_at       = ?,
             recovery_phrase_confirmed_at = NULL
         WHERE id = ?`,
    )
        .bind(phraseHash, toSqlTimestamp(new Date()), currentUser.id)
        .run()

    return c.json({
        recoveryPhrase: phrase,
        recoveryPhraseNeedsConfirmation: true,
    })
})

securityRoutes.post('/recovery/confirm', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    let body: RecoveryPhraseRequest

    try {
        body = await c.req.json<RecoveryPhraseRequest>()
    } catch {
        return c.json({error: 'Invalid JSON body'}, 400)
    }

    const recoveryPhrase = normalizeCredential(body.recoveryPhrase)

    if (!recoveryPhrase) {
        return c.json({error: 'Recovery phrase is required'}, 400)
    }

    const user = await getSecurityUser(c.env.DB, currentUser.id)

    if (!user?.recovery_phrase_hash) {
        return c.json({error: 'Regenerate a recovery phrase first'}, 400)
    }

    if (!(await verifyRecoveryPhrase(recoveryPhrase, user.recovery_phrase_hash))) {
        return c.json({error: 'Recovery phrase does not match'}, 400)
    }

    await c.env.DB.prepare(
        `UPDATE users
         SET recovery_phrase_confirmed_at = ?
         WHERE id = ?`,
    )
        .bind(toSqlTimestamp(new Date()), currentUser.id)
        .run()

    return c.json({ok: true})
})

securityRoutes.post('/sessions/revoke-others', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser?.sessionId) {
        return c.json({error: 'Authentication required'}, 401)
    }

    await c.env.DB.prepare(
        `DELETE FROM sessions
         WHERE user_id = ?
           AND id <> ?`,
    )
        .bind(currentUser.id, currentUser.sessionId)
        .run()

    return c.json({ok: true})
})

securityRoutes.post('/sessions/:id/revoke', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser?.sessionId) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const sessionId = c.req.param('id')

    if (sessionId === currentUser.sessionId) {
        return c.json({error: 'Use logout to end your current session'}, 400)
    }

    await c.env.DB.prepare(
        `DELETE FROM sessions
         WHERE user_id = ?
           AND id = ?`,
    )
        .bind(currentUser.id, sessionId)
        .run()

    return c.json({ok: true})
})

securityRoutes.post('/complete', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.json({error: 'Authentication required'}, 401)
    }

    const [user, passkeys] = await Promise.all([getSecurityUser(c.env.DB, currentUser.id), listUserPasskeys(c.env.DB, currentUser.id)])

    if (!user) {
        return c.json({error: 'Authentication required'}, 401)
    }

    if (user.secure_account_required) {
        const hasRequiredPasskey =
            Boolean(user.secure_account_required_passkey_id) &&
            passkeys.some((passkey) => passkey.id === user.secure_account_required_passkey_id)

        if (!hasRequiredPasskey) {
            return c.json({error: 'Add a new passkey before completing account recovery'}, 400)
        }
    } else if (passkeys.length === 0) {
        return c.json({error: 'Add a passkey before completing account recovery'}, 400)
    }

    if (!user.recovery_phrase_confirmed_at) {
        return c.json({error: 'Regenerate and confirm a recovery phrase first'}, 400)
    }

    await c.env.DB.prepare(
        `UPDATE users
         SET password_hash            = ?,
             secure_account_required = 0,
             secure_account_required_at = NULL,
             secure_account_required_passkey_id = NULL
         WHERE id = ?`,
    )
        .bind(createDisabledPasswordHash(), currentUser.id)
        .run()

    return c.json({ok: true})
})

async function getSecurityUser(db: D1Database, userId: string): Promise<SecurityUserRecord | null> {
    return await db
        .prepare(
            `SELECT id,
                email,
                username,
                password_hash,
                webauthn_user_id,
                recovery_phrase_hash,
                recovery_phrase_confirmed_at,
                secure_account_required,
                secure_account_required_at,
                secure_account_required_passkey_id
         FROM users
         WHERE id = ?
         LIMIT 1`,
        )
        .bind(userId)
        .first<SecurityUserRecord>()
}

function normalizeOptionalText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}
