import {type VerifiedRegistrationResponse, verifyRegistrationResponse} from '@simplewebauthn/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hashRecoveryPhrase, verifyRecoveryPhrase} from '../../lib/auth/passkeys'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {apiRoutes} from '../api'

vi.mock('@simplewebauthn/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@simplewebauthn/server')>()

    return {
        ...actual,
        verifyRegistrationResponse: vi.fn(),
    }
})

const sessionToken = 'session-token'

beforeEach(() => {
    vi.mocked(verifyRegistrationResponse).mockReset()
})

async function securityRequest(
    path: string,
    db: D1Database,
    options: {
        method?: string
        body?: unknown
        sessionToken?: string | null
        csrfToken?: string
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
            DB: db,
        },
    )
}

describe('POST /security/passkeys/options', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await securityRequest('/passkeys/options', db, {
            sessionToken: null,
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('creates a registration challenge for the current user', async () => {
        const existingPasskey = createPasskey({
            credential_id: 'existing-credential',
            transports: 'internal,usb',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser(), createSecurityUser()],
            allResults: [[existingPasskey]],
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

        const challengeInsert = boundStatements.find((statement) => statement.sql.includes('INSERT INTO webauthn_challenges'))
        expect(challengeInsert?.binds.slice(1, 7)).toEqual([
            'user-1',
            'test@example.com',
            'testuser',
            'webauthn-user-1',
            'registration',
            body.options.challenge,
        ])
        expect(db.batch).toHaveBeenCalledTimes(1)
    })
})

describe('POST /security/passkeys/verify', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUser()],
        })

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
        const {db} = createMockDb({
            firstResults: [createCurrentUser()],
        })

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
        const {db} = createMockDb({
            firstResults: [
                createCurrentUser(),
                {
                    ...createChallenge(),
                    user_id: 'other-user',
                },
            ],
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
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser(), createChallenge()],
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

        const updateUser = boundStatements.find((statement) => statement.sql.includes('secure_account_required_passkey_id'))
        const passkeyInsert = boundStatements.find((statement) => statement.sql.includes('INSERT INTO user_passkeys'))
        const challengeDelete = boundStatements.find((statement) => statement.sql.includes('DELETE FROM webauthn_challenges'))
        expect(updateUser?.binds[0]).toBe('webauthn-user-1')
        expect(updateUser?.binds[2]).toBe('user-1')
        expect(passkeyInsert?.binds.slice(1, 10)).toEqual([
            'user-1',
            'credential-id',
            'AQID',
            'webauthn-user-1',
            9,
            'multiDevice',
            1,
            'internal,usb',
            'Laptop',
        ])
        expect(challengeDelete?.binds).toEqual(['challenge-1'])
        expect(db.batch).toHaveBeenCalledTimes(1)
    })
})

describe('DELETE /security/passkeys/:id', () => {
    it('prevents deleting the only passkey on a passkey-only account', async () => {
        const passkey = createPasskey({id: 'passkey-1'})
        const {db} = createMockDb({
            firstResults: [
                createCurrentUser(),
                createSecurityUser({
                    password_hash: 'passkey-only:disabled',
                }),
                passkey,
            ],
            allResults: [[passkey]],
        })

        const response = await securityRequest('/passkeys/passkey-1', db, {
            method: 'DELETE',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add another passkey before removing this one',
        })
    })

    it('deletes a passkey when another sign-in method remains', async () => {
        const passkey = createPasskey({id: 'passkey-1'})
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser(), createSecurityUser(), passkey],
            allResults: [[passkey]],
        })

        const response = await securityRequest('/passkeys/passkey-1', db, {
            method: 'DELETE',
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const passkeyDelete = boundStatements.find((statement) => statement.sql.includes('DELETE FROM user_passkeys'))
        expect(passkeyDelete?.binds).toEqual(['user-1', 'passkey-1'])
    })
})

describe('POST /security/recovery/regenerate', () => {
    it('stores a new recovery phrase hash and returns the plaintext phrase once', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser()],
        })

        const response = await securityRequest('/recovery/regenerate', db)

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            recoveryPhrase: string
            recoveryPhraseNeedsConfirmation: boolean
        }
        expect(body.recoveryPhrase.split('-')).toHaveLength(4)
        expect(body.recoveryPhraseNeedsConfirmation).toBe(true)

        const updateUser = boundStatements.find((statement) => statement.sql.includes('recovery_phrase_hash'))
        expect(updateUser?.binds[2]).toBe('user-1')
        expect(await verifyRecoveryPhrase(body.recoveryPhrase, updateUser?.binds[0] as string)).toBe(true)
    })
})

describe('POST /security/recovery/confirm', () => {
    it('returns 400 when the recovery phrase is missing', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUser()],
        })

        const response = await securityRequest('/recovery/confirm', db, {
            body: {},
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Recovery phrase is required',
        })
    })

    it('returns 400 when no phrase has been regenerated', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUser(), createSecurityUser()],
        })

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
        const {db} = createMockDb({
            firstResults: [
                createCurrentUser(),
                createSecurityUser({
                    recovery_phrase_hash: await hashRecoveryPhrase('correct-horse-battery-staple'),
                }),
            ],
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
    })

    it('marks the recovery phrase as confirmed', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUser(),
                createSecurityUser({
                    recovery_phrase_hash: await hashRecoveryPhrase('correct-horse-battery-staple'),
                }),
            ],
        })

        const response = await securityRequest('/recovery/confirm', db, {
            body: {
                recoveryPhrase: ' Correct Horse_Battery Staple ',
            },
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const updateUser = boundStatements.find((statement) => statement.sql.includes('recovery_phrase_confirmed_at = ?'))
        expect(updateUser?.binds[1]).toBe('user-1')
    })
})

describe('POST /security/sessions/revoke-others', () => {
    it('deletes every session except the current one', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser()],
        })

        const response = await securityRequest('/sessions/revoke-others', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const sessionDelete = boundStatements.find((statement) => statement.sql.includes('id <> ?'))
        expect(sessionDelete?.binds).toEqual(['user-1', 'current-session'])
    })
})

describe('POST /security/sessions/:id/revoke', () => {
    it('rejects attempts to revoke the current session', async () => {
        const {db} = createMockDb({
            firstResults: [createCurrentUser()],
        })

        const response = await securityRequest('/sessions/current-session/revoke', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Use logout to end your current session',
        })
    })

    it('deletes the requested other session', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createCurrentUser()],
        })

        const response = await securityRequest('/sessions/other-session/revoke', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const sessionDelete = boundStatements.find((statement) => statement.sql.includes('id = ?'))
        expect(sessionDelete?.binds).toEqual(['user-1', 'other-session'])
    })
})

describe('POST /security/complete', () => {
    it('requires at least one passkey for a normal security completion', async () => {
        const {db} = createMockDb({
            firstResults: [
                createCurrentUser(),
                createSecurityUser({
                    recovery_phrase_confirmed_at: '2026-06-10 12:05:00',
                }),
            ],
            allResults: [[]],
        })

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add a passkey before completing account recovery',
        })
    })

    it('requires a confirmed recovery phrase before disabling password login', async () => {
        const passkey = createPasskey({id: 'passkey-1'})
        const {db} = createMockDb({
            firstResults: [createCurrentUser(), createSecurityUser()],
            allResults: [[passkey]],
        })

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Regenerate and confirm a recovery phrase first',
        })
    })

    it('disables password login after passkey and recovery phrase setup are complete', async () => {
        const passkey = createPasskey({id: 'passkey-1'})
        const {db, boundStatements} = createMockDb({
            firstResults: [
                createCurrentUser(),
                createSecurityUser({
                    recovery_phrase_confirmed_at: '2026-06-10 12:05:00',
                }),
            ],
            allResults: [[passkey]],
        })

        const response = await securityRequest('/complete', db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})

        const updateUser = boundStatements.find((statement) => statement.sql.includes('SET password_hash'))
        expect(updateUser?.binds[0]).toMatch(/^passkey-only:/)
        expect(updateUser?.binds[1]).toBe('user-1')
    })
})

function createCurrentUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 'user-1',
        session_id: 'current-session',
        email: 'test@example.com',
        username: 'testuser',
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 0,
        passkey_prompt_seen_at: null,
        ...overrides,
    }
}

function createSecurityUser(overrides: Record<string, unknown> = {}) {
    return {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: 'password-hash',
        webauthn_user_id: 'webauthn-user-1',
        recovery_phrase_hash: null,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 0,
        secure_account_required_at: null,
        secure_account_required_passkey_id: null,
        ...overrides,
    }
}

function createPasskey(overrides: Record<string, unknown> = {}) {
    return {
        id: 'passkey-1',
        user_id: 'user-1',
        credential_id: 'credential-id',
        public_key: 'AQID',
        webauthn_user_id: 'webauthn-user-1',
        counter: 0,
        device_type: 'singleDevice',
        backed_up: 0,
        transports: null,
        name: 'Laptop',
        created_at: '2026-06-10 12:00:00',
        last_used_at: null,
        ...overrides,
    }
}

function createChallenge(overrides: Record<string, unknown> = {}) {
    return {
        id: 'challenge-1',
        user_id: 'user-1',
        email: null,
        username: null,
        webauthn_user_id: 'webauthn-user-1',
        ceremony: 'registration',
        challenge: 'stored-challenge',
        expires_at: '2026-06-10 12:05:00',
        ...overrides,
    }
}

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
