import {type VerifiedRegistrationResponse, verifyRegistrationResponse} from '@simplewebauthn/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hashRecoveryPhrase, verifyRecoveryPhrase} from '../../lib/auth/passkeys'
import {createCsrfToken} from '../../lib/auth/session'
import {countRows, queryAll, queryOne, seedChallenge, seedPasskey, seedSession, seedUser, useTestDatabase} from '../../test/d1'
import {createAllowingAuthRateLimits, createMockRateLimit} from '../../test/mockRateLimit'
import {apiRoutes} from '../api'

vi.mock('@simplewebauthn/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@simplewebauthn/server')>()

    return {
        ...actual,
        verifyRegistrationResponse: vi.fn(),
    }
})

const sessionToken = 'session-token'
const db = useTestDatabase()

beforeEach(() => {
    vi.mocked(verifyRegistrationResponse).mockReset()
})

type CurrentUserOverrides = {
    passwordHash?: string
    webauthnUserId?: string | null
    recoveryPhraseHash?: string | null
    recoveryPhraseConfirmedAt?: string | null
    secureAccountRequired?: boolean
    secureAccountRequiredAt?: string | null
    secureAccountRequiredPasskeyId?: string | null
}

async function seedCurrentUser(overrides: CurrentUserOverrides = {}): Promise<void> {
    await seedUser({
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        passwordHash: overrides.passwordHash ?? 'password-hash',
        webauthnUserId: overrides.webauthnUserId === undefined ? 'webauthn-user-1' : overrides.webauthnUserId,
        recoveryPhraseHash: overrides.recoveryPhraseHash ?? null,
        recoveryPhraseConfirmedAt: overrides.recoveryPhraseConfirmedAt ?? null,
        secureAccountRequired: overrides.secureAccountRequired ?? false,
        secureAccountRequiredAt: overrides.secureAccountRequiredAt ?? null,
        secureAccountRequiredPasskeyId: overrides.secureAccountRequiredPasskeyId ?? null,
    })
    await seedSession({id: 'current-session', userId: 'user-1', token: sessionToken})
}

async function securityRequest(
    path: string,
    db: D1Database,
    options: {
        method?: string
        body?: unknown
        sessionToken?: string | null
        csrfToken?: string
        rateLimits?: Partial<ReturnType<typeof createAllowingAuthRateLimits>>
    } = {},
): Promise<Response> {
    const headers: Record<string, string> = {}
    const requestSessionToken = options.sessionToken === undefined ? sessionToken : options.sessionToken
    const body = options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body)

    if (body !== undefined) {
        headers['content-type'] = 'application/json'
    }

    if (requestSessionToken) {
        headers.cookie = `myoc_session=${requestSessionToken}`
        headers['x-csrf-token'] = options.csrfToken ?? (await createCsrfToken(requestSessionToken))
    }

    return apiRoutes.request(
        `https://example.com/security${path}`,
        {
            method: options.method ?? 'POST',
            body,
            headers,
        },
        {
            ...createAllowingAuthRateLimits(),
            ...options.rateLimits,
            DB: db,
        },
    )
}

describe('POST /security/passkeys/options', () => {
    it('returns 429 when the user identity limit is exhausted', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/passkeys/options', db, {
            rateLimits: {AUTH_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(false)},
        })

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        await expect(response.json()).resolves.toEqual({error: 'Too many requests. Try again later.'})
    })

    it('returns 401 when the user is not logged in', async () => {
        const response = await securityRequest('/passkeys/options', db, {
            sessionToken: null,
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('creates a registration challenge for the current user', async () => {
        await seedCurrentUser()
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'existing-credential',
            webauthnUserId: 'webauthn-user-1',
            transports: 'internal,usb',
        })

        const response = await securityRequest('/passkeys/options', db)

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            challengeId: string
            options: {
                challenge: string
                rp: {id: string; name: string}
                user: {name: string}
                excludeCredentials?: Array<{id: string; transports?: string[]}>
            }
        }
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(body.options.rp).toEqual({
            id: 'example.com',
            name: 'MyOC',
        })
        expect(body.options.user.name).toBe('testuser')
        expect(body.options.excludeCredentials).toEqual([
            {
                id: 'existing-credential',
                transports: ['internal', 'usb'],
                type: 'public-key',
            },
        ])

        expect(
            await queryOne<{
                user_id: string
                email: string
                username: string
                webauthn_user_id: string
                ceremony: string
                challenge: string
            }>('SELECT user_id, email, username, webauthn_user_id, ceremony, challenge FROM webauthn_challenges WHERE id = ?', [
                body.challengeId,
            ]),
        ).toEqual({
            user_id: 'user-1',
            email: 'test@example.com',
            username: 'testuser',
            webauthn_user_id: 'webauthn-user-1',
            ceremony: 'registration',
            challenge: body.options.challenge,
        })
    })
})

describe('POST /security/passkeys/verify', () => {
    it('returns 429 when the challenge limit is exhausted', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/passkeys/verify', db, {
            body: {challengeId: 'challenge-1', credential: createRegistrationCredential()},
            rateLimits: {AUTH_CHALLENGE_RATE_LIMITER: createMockRateLimit(false)},
        })

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        await expect(response.json()).resolves.toEqual({error: 'Too many requests. Try again later.'})
    })

    it('returns 429 when the user identity limit is exhausted', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/passkeys/verify', db, {
            body: {challengeId: 'challenge-1', credential: createRegistrationCredential()},
            rateLimits: {AUTH_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(false)},
        })

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        await expect(response.json()).resolves.toEqual({error: 'Too many requests. Try again later.'})
    })

    it('returns 400 for invalid JSON', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/passkeys/verify', db, {
            body: '{bad json',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the challenge is missing', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/passkeys/verify', db, {
            body: {
                credential: {},
            },
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Challenge and passkey response are required',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the stored challenge is expired or owned by another user', async () => {
        await seedCurrentUser()
        await seedUser({
            id: 'other-user',
            email: 'other@example.test',
            username: 'otheruser',
            webauthnUserId: 'other-webauthn-user',
        })
        await seedChallenge({
            id: 'challenge-1',
            userId: 'other-user',
            webauthnUserId: 'other-webauthn-user',
            ceremony: 'registration',
            challenge: 'stored-challenge',
        })

        const response = await securityRequest('/passkeys/verify', db, {
            body: {
                challengeId: 'challenge-1',
                credential: createRegistrationCredential(),
            },
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey registration expired',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('stores the verified passkey and removes the challenge', async () => {
        await seedCurrentUser({webauthnUserId: null})
        await seedChallenge({
            id: 'challenge-1',
            userId: 'user-1',
            webauthnUserId: 'webauthn-user-1',
            ceremony: 'registration',
            challenge: 'stored-challenge',
        })
        const verification: VerifiedRegistrationResponse = {
            verified: true,
            registrationInfo: {
                fmt: 'none',
                aaguid: '00000000-0000-0000-0000-000000000000',
                credential: {
                    id: 'credential-id',
                    publicKey: new Uint8Array([1, 2, 3]),
                    counter: 9,
                    transports: ['internal', 'usb'],
                },
                credentialType: 'public-key',
                attestationObject: new Uint8Array(),
                userVerified: true,
                credentialDeviceType: 'multiDevice',
                credentialBackedUp: true,
                origin: 'https://example.com',
                rpID: 'example.com',
            },
        }
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(verification)

        const response = await securityRequest('/passkeys/verify', db, {
            body: {
                challengeId: ' challenge-1 ',
                credential: createRegistrationCredential(),
                name: ' Laptop ',
            },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(verifyRegistrationResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedChallenge: 'stored-challenge',
                expectedOrigin: 'https://example.com',
                expectedRPID: 'example.com',
                requireUserVerification: true,
                supportedAlgorithmIDs: [-7, -257],
            }),
        )

        expect(await queryOne<{webauthn_user_id: string}>('SELECT webauthn_user_id FROM users WHERE id = ?', ['user-1'])).toEqual({
            webauthn_user_id: 'webauthn-user-1',
        })
        expect(
            await queryOne<{
                user_id: string
                credential_id: string
                public_key: string
                webauthn_user_id: string
                counter: number
                device_type: string
                backed_up: number
                transports: string
                name: string
            }>(
                `SELECT user_id, credential_id, public_key, webauthn_user_id, counter, device_type, backed_up, transports, name
                 FROM user_passkeys
                 WHERE user_id = ?`,
                ['user-1'],
            ),
        ).toEqual({
            user_id: 'user-1',
            credential_id: 'credential-id',
            public_key: 'AQID',
            webauthn_user_id: 'webauthn-user-1',
            counter: 9,
            device_type: 'multiDevice',
            backed_up: 1,
            transports: 'internal,usb',
            name: 'Laptop',
        })
        expect(await queryOne('SELECT id FROM webauthn_challenges WHERE id = ?', ['challenge-1'])).toBeNull()
    })
})

describe('DELETE /security/passkeys/:id', () => {
    it('prevents deleting the only passkey on a passkey-only account', async () => {
        await seedCurrentUser({passwordHash: 'passkey-only:disabled'})
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-id',
            webauthnUserId: 'webauthn-user-1',
        })

        const response = await securityRequest('/passkeys/passkey-1', db, {
            method: 'DELETE',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add another passkey before removing this one',
        })
        expect(await countRows('user_passkeys')).toBe(1)
    })

    it('deletes a passkey when another sign-in method remains', async () => {
        await seedCurrentUser()
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-id',
            webauthnUserId: 'webauthn-user-1',
        })

        const response = await securityRequest('/passkeys/passkey-1', db, {
            method: 'DELETE',
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(await countRows('user_passkeys')).toBe(0)
    })
})

describe('POST /security/recovery/regenerate', () => {
    it('returns 429 when the user identity limit is exhausted', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/recovery/regenerate', db, {
            rateLimits: {AUTH_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(false)},
        })

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        await expect(response.json()).resolves.toEqual({error: 'Too many requests. Try again later.'})
    })

    it('stores a new recovery phrase hash and returns the plaintext phrase once', async () => {
        await seedCurrentUser({recoveryPhraseConfirmedAt: '2026-06-10 12:05:00'})

        const response = await securityRequest('/recovery/regenerate', db)

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            recoveryPhrase: string
            recoveryPhraseNeedsConfirmation: boolean
        }
        expect(body.recoveryPhrase.split('-')).toHaveLength(4)
        expect(body.recoveryPhraseNeedsConfirmation).toBe(true)

        const saved = await queryOne<{
            recovery_phrase_hash: string
            recovery_phrase_set_at: string
            recovery_phrase_confirmed_at: string | null
        }>('SELECT recovery_phrase_hash, recovery_phrase_set_at, recovery_phrase_confirmed_at FROM users WHERE id = ?', ['user-1'])
        expect(saved?.recovery_phrase_set_at).toEqual(expect.any(String))
        expect(saved?.recovery_phrase_confirmed_at).toBeNull()
        expect(await verifyRecoveryPhrase(body.recoveryPhrase, saved?.recovery_phrase_hash ?? '')).toBe(true)
    })
})

describe('POST /security/recovery/confirm', () => {
    it('returns 429 when the user identity limit is exhausted', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/recovery/confirm', db, {
            body: {recoveryPhrase: 'one-two-three-four'},
            rateLimits: {AUTH_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(false)},
        })

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        await expect(response.json()).resolves.toEqual({error: 'Too many requests. Try again later.'})
    })

    it('returns 400 when the recovery phrase is missing', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/recovery/confirm', db, {
            body: {},
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Recovery phrase is required',
        })
    })

    it('returns 400 when no phrase has been regenerated', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/recovery/confirm', db, {
            body: {
                recoveryPhrase: 'correct-horse-battery-staple',
            },
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Regenerate a recovery phrase first',
        })
    })

    it('returns 400 when the recovery phrase does not match', async () => {
        await seedCurrentUser({
            recoveryPhraseHash: await hashRecoveryPhrase('correct-horse-battery-staple'),
        })

        const response = await securityRequest('/recovery/confirm', db, {
            body: {
                recoveryPhrase: 'wrong phrase',
            },
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Recovery phrase does not match',
        })
        expect(
            await queryOne<{recovery_phrase_confirmed_at: string | null}>('SELECT recovery_phrase_confirmed_at FROM users WHERE id = ?', [
                'user-1',
            ]),
        ).toEqual({recovery_phrase_confirmed_at: null})
    })

    it('marks the recovery phrase as confirmed', async () => {
        await seedCurrentUser({
            recoveryPhraseHash: await hashRecoveryPhrase('correct-horse-battery-staple'),
        })

        const response = await securityRequest('/recovery/confirm', db, {
            body: {
                recoveryPhrase: ' Correct Horse_Battery Staple ',
            },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(
            (
                await queryOne<{recovery_phrase_confirmed_at: string | null}>(
                    'SELECT recovery_phrase_confirmed_at FROM users WHERE id = ?',
                    ['user-1'],
                )
            )?.recovery_phrase_confirmed_at,
        ).toEqual(expect.any(String))
    })
})

describe('POST /security/sessions/revoke-others', () => {
    it('deletes every session except the current one', async () => {
        await seedCurrentUser()
        await seedSession({id: 'other-session-1', userId: 'user-1', token: 'other-token-1'})
        await seedSession({id: 'other-session-2', userId: 'user-1', token: 'other-token-2'})

        const response = await securityRequest('/sessions/revoke-others', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(await queryAll<{id: string}>('SELECT id FROM sessions WHERE user_id = ? ORDER BY id', ['user-1'])).toEqual([
            {id: 'current-session'},
        ])
    })
})

describe('POST /security/sessions/:id/revoke', () => {
    it('rejects attempts to revoke the current session', async () => {
        await seedCurrentUser()

        const response = await securityRequest('/sessions/current-session/revoke', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Use logout to end your current session',
        })
        expect(await countRows('sessions')).toBe(1)
    })

    it('deletes the requested other session', async () => {
        await seedCurrentUser()
        await seedSession({id: 'other-session', userId: 'user-1', token: 'other-token'})

        const response = await securityRequest('/sessions/other-session/revoke', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(await queryAll<{id: string}>('SELECT id FROM sessions WHERE user_id = ? ORDER BY id', ['user-1'])).toEqual([
            {id: 'current-session'},
        ])
    })
})

describe('POST /security/complete', () => {
    it('requires at least one passkey for a normal security completion', async () => {
        await seedCurrentUser({recoveryPhraseConfirmedAt: '2026-06-10 12:05:00'})

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add a passkey before completing account recovery',
        })
    })

    it('requires a confirmed recovery phrase before disabling password login', async () => {
        await seedCurrentUser()
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-id',
            webauthnUserId: 'webauthn-user-1',
        })

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Regenerate and confirm a recovery phrase first',
        })
    })

    it('disables password login after passkey and recovery phrase setup are complete', async () => {
        await seedCurrentUser({
            recoveryPhraseConfirmedAt: '2026-06-10 12:05:00',
            secureAccountRequired: true,
            secureAccountRequiredAt: '2026-06-10 12:00:00',
            secureAccountRequiredPasskeyId: 'passkey-1',
        })
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-id',
            webauthnUserId: 'webauthn-user-1',
        })

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const saved = await queryOne<{
            password_hash: string
            secure_account_required: number
            secure_account_required_at: string | null
            secure_account_required_passkey_id: string | null
        }>(
            `SELECT password_hash, secure_account_required, secure_account_required_at, secure_account_required_passkey_id
             FROM users
             WHERE id = ?`,
            ['user-1'],
        )
        expect(saved?.password_hash).toMatch(/^passkey-only:/)
        expect(saved).toMatchObject({
            secure_account_required: 0,
            secure_account_required_at: null,
            secure_account_required_passkey_id: null,
        })
    })
})

function createRegistrationCredential() {
    return {
        id: 'credential-id',
        rawId: 'credential-id',
        response: {
            attestationObject: 'attestation',
            clientDataJSON: 'client-data',
        },
        clientExtensionResults: {},
        type: 'public-key',
    }
}
