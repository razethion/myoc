import {
    type VerifiedAuthenticationResponse,
    type VerifiedRegistrationResponse,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server'
import {hash} from 'bcryptjs'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hashRecoveryPhrase, verifyRecoveryPhrase} from '../../lib/auth/passkeys'
import {createCsrfToken, type UserRecord} from '../../lib/auth/session'
import {expectSessionCookie} from '../../test/assertions'
import {queryAll, queryOne, seedAuthenticatedUser, seedChallenge, seedPasskey, seedUser, sha256Hex, useTestDatabase} from '../../test/d1'
import {apiRoutes} from '../api'
import {authPageActionRoutes} from '../page-actions/auth'

vi.mock('@simplewebauthn/server', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@simplewebauthn/server')>()

    return {
        ...actual,
        verifyAuthenticationResponse: vi.fn(),
        verifyRegistrationResponse: vi.fn(),
    }
})

type SecurityTestUser = UserRecord & {
    webauthn_user_id: string | null
    recovery_phrase_hash: string | null
    recovery_phrase_confirmed_at: string | null
    secure_account_required: number
    secure_account_required_at: string | null
    secure_account_required_passkey_id: string | null
    banned_at: string | null
}

const db = useTestDatabase()

beforeEach(() => {
    vi.mocked(verifyAuthenticationResponse).mockReset()
    vi.mocked(verifyRegistrationResponse).mockReset()
})

async function postLogin(body: unknown, url = '/login', cookie?: string): Promise<Response> {
    return authPageActionRoutes.request(
        url,
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                ...(cookie ? {cookie} : {}),
            },
        },
        {
            DB: db,
        },
    )
}

async function postPasskeyRegistrationOptions(body: unknown): Promise<Response> {
    return authPageActionRoutes.request(
        'https://example.com/register/passkey/options',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
            },
        },
        {
            DB: db,
        },
    )
}

async function postPasskeyRegistrationVerify(body: unknown): Promise<Response> {
    return authPageActionRoutes.request(
        'https://example.com/register/passkey/verify',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
            },
        },
        {
            DB: db,
        },
    )
}

async function postPasskeyLoginOptions(body: unknown): Promise<Response> {
    return authPageActionRoutes.request(
        'https://example.com/login/passkey/options',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
            },
        },
        {
            DB: db,
        },
    )
}

async function postPasskeyLoginVerify(body: unknown): Promise<Response> {
    return authPageActionRoutes.request(
        'https://example.com/login/passkey/verify',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
            },
        },
        {
            DB: db,
        },
    )
}

async function postRecoveryLogin(body: unknown): Promise<Response> {
    return authPageActionRoutes.request(
        'https://example.com/recovery/login',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
            },
        },
        {
            DB: db,
        },
    )
}

async function postSecurityComplete(sessionToken = 'session-token'): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/security/complete',
        {
            method: 'POST',
            headers: {
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
            },
        },
        {
            DB: db,
        },
    )
}

async function postLogout(cookie?: string, url = 'https://example.com/logout', csrfToken?: string): Promise<Response> {
    return authPageActionRoutes.request(
        url,
        {
            method: 'POST',
            headers: cookie
                ? {
                      cookie,
                      ...(csrfToken ? {'x-csrf-token': csrfToken} : {}),
                  }
                : undefined,
        },
        {
            DB: db,
        },
    )
}

async function postLogoutForm(cookie?: string, csrfToken?: string): Promise<Response> {
    const body = new URLSearchParams()

    if (csrfToken) {
        body.set('csrfToken', csrfToken)
    }

    return authPageActionRoutes.request(
        'https://example.com/logout',
        {
            method: 'POST',
            body,
            headers: {
                accept: 'text/html',
                'content-type': 'application/x-www-form-urlencoded',
                ...(cookie ? {cookie} : {}),
            },
        },
        {
            DB: db,
        },
    )
}

describe('POST /login', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postLogin('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('rejects an oversized request body', async () => {
        const response = await postLogin({
            password: 'password123',
            username: 'a'.repeat(1024 * 1024),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('reads multipart login fields', async () => {
        const user = await seedTestUser('password123')
        const form = new FormData()
        form.set('username', 'testuser')
        form.set('password', 'password123')

        const response = await authPageActionRoutes.request('https://example.com/login', {method: 'POST', body: form}, {DB: db})

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({user: {id: user.id, username: user.username}})
        expectSessionCookie(response)
    })

    it('uses an empty login body for an unsupported content type', async () => {
        const response = await authPageActionRoutes.request(
            'https://example.com/login',
            {body: 'username=testuser', headers: {'content-type': 'text/plain'}, method: 'POST'},
            {DB: db},
        )

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Username and password are required'})
    })

    it('rejects an oversized URL-encoded login form', async () => {
        const response = await authPageActionRoutes.request(
            'https://example.com/login',
            {
                method: 'POST',
                body: new URLSearchParams({username: 'a'.repeat(1024 * 1024), password: 'password123'}),
            },
            {DB: db},
        )

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Invalid JSON body'})
    })

    it('returns 400 when the username is missing', async () => {
        const response = await postLogin({
            password: 'password123',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 400 when the password is missing', async () => {
        const response = await postLogin({
            username: 'testuser',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 401 when no matching user exists', async () => {
        const response = await postLogin({
            username: 'missinguser',
            password: 'password123',
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('does not treat an email address as a username', async () => {
        const user = await seedTestUser('password123')

        const response = await postLogin({
            username: user.email,
            password: 'password123',
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({error: 'Invalid username or password'})
        expect(await queryAll('SELECT id FROM sessions WHERE user_id = ?', [user.id])).toEqual([])
    })

    it('returns 401 when the password does not match the stored hash', async () => {
        await seedTestUser('password123')

        const response = await postLogin({
            username: 'testuser',
            password: 'wrong-password',
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('returns 403 when the account is banned', async () => {
        await seedTestUser('password123', {bannedAt: '2026-06-10 12:00:00'})

        const response = await postLogin({
            username: 'testuser',
            password: 'password123',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Account is banned',
        })
    })

    it('returns the public user and creates a secure session for valid credentials', async () => {
        const user = await seedTestUser('password123')

        const response = await postLogin(
            {
                username: ' testuser ',
                password: ' password123 ',
            },
            'https://example.com/login',
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
                role: 'user',
                profilePhotoKey: user.profile_photo_key,
                bio: user.bio,
                displayNsfwMedia: false,
                lastSeenVersion: null,
                createdAt: user.created_at,
            },
        })

        expectSessionCookie(response)

        expect(await queryAll('SELECT id FROM sessions WHERE user_id = ?', [user.id])).toHaveLength(1)
    })

    it('allows login when a stale session cookie is present', async () => {
        await seedTestUser('password123')

        const response = await postLogin(
            {
                username: 'testuser',
                password: 'password123',
            },
            'https://example.com/login',
            'myoc_session=stale-session-token',
        )

        expect(response.status).toBe(200)
        expectSessionCookie(response)
    })
})

describe('POST /register/passkey/options', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postPasskeyRegistrationOptions('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const response = await postPasskeyRegistrationOptions({
            email: 'test@example.com',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email and username are required',
        })
    })

    it('returns 400 for an invalid email', async () => {
        const response = await postPasskeyRegistrationOptions({
            email: 'not-an-email',
            username: 'testuser',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email must be valid',
        })
    })

    it('returns 400 for an invalid username', async () => {
        const response = await postPasskeyRegistrationOptions({
            email: 'test@example.com',
            username: 'bad-user',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 409 when the email or username is already in use', async () => {
        await seedUser({id: 'existing-user', email: 'test@example.com', username: 'existinguser'})

        const response = await postPasskeyRegistrationOptions({
            email: 'test@example.com',
            username: 'testuser',
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a passkey registration challenge for a new account', async () => {
        const response = await postPasskeyRegistrationOptions({
            email: ' Test@Example.com ',
            username: ' testuser ',
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            challengeId: string
            options: {challenge: string; user: {name: string}}
        }
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(body.options.challenge).toBeTruthy()
        expect(body.options.user.name).toBe('testuser')
        await expect(
            queryOne('SELECT email, username, ceremony, challenge FROM webauthn_challenges WHERE id = ?', [body.challengeId]),
        ).resolves.toEqual({
            email: 'test@example.com',
            username: 'testuser',
            ceremony: 'registration',
            challenge: body.options.challenge,
        })
    })
})

describe('POST /register/passkey/verify', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postPasskeyRegistrationVerify('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the challenge or credential is missing', async () => {
        const response = await postPasskeyRegistrationVerify({
            challengeId: 'challenge-1',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Challenge and passkey response are required',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the registration challenge has expired', async () => {
        const response = await postPasskeyRegistrationVerify({
            challengeId: 'challenge-1',
            credential: createRegistrationCredential(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey registration expired',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the passkey response cannot be verified', async () => {
        await seedRegistrationChallenge()
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({verified: false})

        const response = await postPasskeyRegistrationVerify({
            challengeId: 'challenge-1',
            credential: createRegistrationCredential(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey could not be verified',
        })
        expect(verifyRegistrationResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedChallenge: 'stored-challenge',
                expectedOrigin: 'https://example.com',
                expectedRPID: 'example.com',
            }),
        )
    })

    it('returns 409 when passkey registration hits a unique constraint', async () => {
        await seedRegistrationChallenge()
        await seedUser({id: 'existing-user', email: 'new@example.com', username: 'existinguser'})
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(createRegistrationVerification())

        const response = await postPasskeyRegistrationVerify({
            challengeId: 'challenge-1',
            credential: createRegistrationCredential(),
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a passkey-only user, starts a session, and returns the recovery phrase', async () => {
        await seedRegistrationChallenge()
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(createRegistrationVerification())

        const response = await postPasskeyRegistrationVerify({
            challengeId: ' challenge-1 ',
            credential: createRegistrationCredential(),
            name: ' Primary laptop ',
        })

        expect(response.status).toBe(201)
        const body = (await response.json()) as {
            csrfToken: string
            recoveryPhrase: string
            recoveryPhraseNeedsConfirmation: boolean
            user: {
                id: string
                email: string
                username: string
                role: string
            }
        }
        expect(body.user).toMatchObject({
            id: 'new-user-id',
            email: 'new@example.com',
            username: 'newuser',
            role: 'user',
        })
        expect(body.csrfToken).toMatch(/^[0-9a-f]{64}$/)
        expect(body.recoveryPhrase.split('-')).toHaveLength(4)
        expect(body.recoveryPhraseNeedsConfirmation).toBe(true)
        expectSessionCookie(response)

        const user = await queryOne<Pick<SecurityTestUser, 'password_hash' | 'recovery_phrase_hash' | 'secure_account_required'>>(
            'SELECT password_hash, recovery_phrase_hash, secure_account_required FROM users WHERE id = ?',
            ['new-user-id'],
        )
        expect(user?.password_hash).toMatch(/^passkey-only:/)
        expect(await verifyRecoveryPhrase(body.recoveryPhrase, user?.recovery_phrase_hash ?? '')).toBe(true)
        expect(user).toMatchObject({secure_account_required: 1})
        const passkey = await queryOne(
            'SELECT user_id, credential_id, public_key, webauthn_user_id, counter, device_type, backed_up, transports, name FROM user_passkeys WHERE user_id = ?',
            ['new-user-id'],
        )
        expect(passkey).toEqual({
            user_id: 'new-user-id',
            credential_id: 'credential-id',
            public_key: 'AQID',
            webauthn_user_id: 'webauthn-user-1',
            counter: 7,
            device_type: 'multiDevice',
            backed_up: 1,
            transports: 'internal,usb',
            name: 'Primary laptop',
        })
        await expect(queryOne('SELECT id FROM webauthn_challenges WHERE id = ?', ['challenge-1'])).resolves.toBeNull()
        expect(await queryAll('SELECT id FROM sessions WHERE user_id = ?', ['new-user-id'])).toHaveLength(1)
    })
})

describe('POST /login/passkey/options', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postPasskeyLoginOptions('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 404 when a username has no registered passkey', async () => {
        const response = await postPasskeyLoginOptions({
            username: 'missinguser',
        })

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'No passkey is registered for that username',
        })
    })

    it('creates scoped authentication options for a username with a passkey', async () => {
        await seedUser({id: 'user-1', username: 'testuser', webauthnUserId: 'webauthn-user-1'})
        await seedPasskey({
            id: 'passkey-1',
            userId: 'user-1',
            credentialId: 'credential-id',
            transports: 'internal,usb',
            webauthnUserId: 'webauthn-user-1',
        })

        const response = await postPasskeyLoginOptions({
            username: ' testuser ',
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            challengeId: string
            options: {
                allowCredentials?: Array<{id: string; transports?: string[]; type: string}>
                challenge: string
                rpId: string
            }
        }
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(body.options.rpId).toBe('example.com')
        expect(body.options.allowCredentials).toEqual([
            {
                id: 'credential-id',
                transports: ['internal', 'usb'],
                type: 'public-key',
            },
        ])

        await expect(
            queryOne('SELECT user_id, ceremony, challenge FROM webauthn_challenges WHERE id = ?', [body.challengeId]),
        ).resolves.toEqual({
            user_id: 'user-1',
            ceremony: 'authentication',
            challenge: body.options.challenge,
        })
    })

    it('creates discoverable authentication options when no username is supplied', async () => {
        const response = await postPasskeyLoginOptions({})

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            challengeId: string
            options: {
                allowCredentials?: unknown[]
                rpId: string
            }
        }
        expect(body.options.rpId).toBe('example.com')
        expect(body.options.allowCredentials).toBeUndefined()
        await expect(queryOne('SELECT user_id FROM webauthn_challenges WHERE id = ?', [body.challengeId])).resolves.toEqual({user_id: null})
    })
})

describe('POST /login/passkey/verify', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postPasskeyLoginVerify('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the challenge or credential id is missing', async () => {
        const response = await postPasskeyLoginVerify({
            challengeId: 'challenge-1',
            credential: {},
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Challenge and passkey response are required',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the passkey login challenge has expired', async () => {
        const response = await postPasskeyLoginVerify({
            challengeId: 'challenge-1',
            credential: createAuthenticationCredential(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey login expired',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 401 when the passkey is not registered for the requested user', async () => {
        await seedUser({id: 'user-1', webauthnUserId: 'webauthn-user-1'})
        await seedUser({id: 'other-user', webauthnUserId: 'other-webauthn-user'})
        await seedAuthenticationChallenge({userId: 'user-1'})
        await seedPasskey({id: 'passkey-1', userId: 'other-user', credentialId: 'credential-id', webauthnUserId: 'other-webauthn-user'})

        const response = await postPasskeyLoginVerify({
            challengeId: 'challenge-1',
            credential: createAuthenticationCredential(),
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Passkey is not registered for this login',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 401 when the passkey response cannot be verified', async () => {
        await seedTestUser('password123', {webauthnUserId: 'webauthn-user-1'})
        await seedAuthenticationChallenge()
        await seedPasskey({id: 'passkey-1', userId: 'user-1', credentialId: 'credential-id', webauthnUserId: 'webauthn-user-1'})
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification({verified: false}))

        const response = await postPasskeyLoginVerify({
            challengeId: 'challenge-1',
            credential: createAuthenticationCredential(),
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Passkey could not be verified',
        })
        expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedChallenge: 'stored-challenge',
                expectedOrigin: 'https://example.com',
                expectedRPID: 'example.com',
                requireUserVerification: true,
            }),
        )
    })

    it('returns 401 when the passkey owner is no longer active', async () => {
        await seedTestUser('password123', {webauthnUserId: 'webauthn-user-1', bannedAt: '2026-06-10 12:00:00'})
        await seedAuthenticationChallenge()
        await seedPasskey({id: 'passkey-1', userId: 'user-1', credentialId: 'credential-id', webauthnUserId: 'webauthn-user-1'})
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification())

        const response = await postPasskeyLoginVerify({
            challengeId: 'challenge-1',
            credential: createAuthenticationCredential(),
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Passkey is not registered for an active account',
        })
    })

    it('updates passkey usage, clears the challenge, and starts a session', async () => {
        const user = await seedTestUser('password123', {webauthnUserId: 'webauthn-user-1'})
        await seedAuthenticationChallenge()
        await seedPasskey({id: 'passkey-1', userId: user.id, credentialId: 'credential-id', webauthnUserId: 'webauthn-user-1'})
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification())

        const response = await postPasskeyLoginVerify({
            challengeId: ' challenge-1 ',
            credential: createAuthenticationCredential(),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
            },
        })
        expectSessionCookie(response)

        await expect(
            queryOne('SELECT counter, device_type, backed_up, last_used_at FROM user_passkeys WHERE id = ?', ['passkey-1']),
        ).resolves.toMatchObject({
            counter: 12,
            device_type: 'multiDevice',
            backed_up: 1,
            last_used_at: expect.any(String),
        })
        await expect(queryOne('SELECT id FROM webauthn_challenges WHERE id = ?', ['challenge-1'])).resolves.toBeNull()
        expect(await queryAll('SELECT id FROM sessions WHERE user_id = ?', [user.id])).toHaveLength(1)
    })
})

describe('POST /recovery/login', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postRecoveryLogin('{bad json')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const response = await postRecoveryLogin({
            username: 'testuser',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and recovery phrase are required',
        })
    })

    it('returns 401 when the recovery phrase does not match', async () => {
        await seedTestUser('password123', {recoveryPhraseHash: await hashRecoveryPhrase('correct-horse-battery-staple')})

        const response = await postRecoveryLogin({
            username: 'testuser',
            recoveryPhrase: 'wrong phrase',
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or recovery phrase',
        })
    })

    it('returns 403 when the account is banned', async () => {
        const recoveryPhrase = 'correct-horse-battery-staple'
        await seedTestUser('password123', {
            recoveryPhraseHash: await hashRecoveryPhrase(recoveryPhrase),
            bannedAt: '2026-06-10 12:00:00',
        })

        const response = await postRecoveryLogin({
            username: 'testuser',
            recoveryPhrase,
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Account is banned',
        })
    })

    it('creates a session without forcing new recovery credentials when recovery succeeds', async () => {
        const recoveryPhrase = 'correct-horse-battery-staple'
        const recoveryPhraseHash = await hashRecoveryPhrase(recoveryPhrase)
        const user = await seedTestUser('password123', {
            recoveryPhraseHash,
            recoveryPhraseConfirmedAt: '2026-06-10 12:05:00',
            secureAccountRequired: true,
            secureAccountRequiredAt: '2026-06-10 12:00:00',
            secureAccountRequiredPasskeyId: 'old-passkey',
        })
        await seedPasskey({id: 'old-passkey', userId: user.id, webauthnUserId: 'webauthn-user-1'})

        const response = await postRecoveryLogin({
            username: 'testuser',
            recoveryPhrase,
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            secureAccountRequired: false,
            user: {
                id: user.id,
                username: user.username,
            },
        })
        expectSessionCookie(response)
        await expect(
            queryOne(
                'SELECT recovery_phrase_hash, recovery_phrase_confirmed_at, secure_account_required, secure_account_required_at, secure_account_required_passkey_id FROM users WHERE id = ?',
                [user.id],
            ),
        ).resolves.toEqual({
            recovery_phrase_hash: recoveryPhraseHash,
            recovery_phrase_confirmed_at: '2026-06-10 12:05:00',
            secure_account_required: 0,
            secure_account_required_at: null,
            secure_account_required_passkey_id: null,
        })
        expect(await queryAll('SELECT id FROM user_passkeys WHERE user_id = ?', [user.id])).toHaveLength(1)
        expect(await queryAll('SELECT id FROM sessions WHERE user_id = ?', [user.id])).toHaveLength(1)
    })

    it('still redirects successful browser recovery login to settings', async () => {
        const recoveryPhrase = 'correct-horse-battery-staple'
        const user = await seedTestUser('password123', {recoveryPhraseHash: await hashRecoveryPhrase(recoveryPhrase)})

        const response = await authPageActionRoutes.request(
            'https://example.com/recovery/login',
            {
                method: 'POST',
                body: JSON.stringify({username: user.username, recoveryPhrase}),
                headers: {
                    accept: 'text/html',
                    'content-type': 'application/json',
                },
            },
            {DB: db},
        )

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/settings')
        expectSessionCookie(response)
    })
})

describe('POST /security/complete', () => {
    it('requires a new passkey after recovery instead of accepting existing passkeys', async () => {
        const user = await seedSecurityUser({
            recoveryPhraseConfirmedAt: '2026-06-10 12:05:00',
            secureAccountRequired: true,
            secureAccountRequiredAt: '2026-06-10 12:00:00',
        })
        await seedPasskey({id: 'old-passkey', userId: user.id, webauthnUserId: 'webauthn-user-1'})

        const response = await postSecurityComplete()

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add a new passkey before completing account recovery',
        })
        await expect(queryOne('SELECT password_hash FROM users WHERE id = ?', [user.id])).resolves.toEqual({
            password_hash: user.password_hash,
        })
    })

    it('completes recovery when the forced passkey is still registered', async () => {
        const user = await seedSecurityUser({
            recoveryPhraseConfirmedAt: '2026-06-10 12:05:00',
            secureAccountRequired: true,
            secureAccountRequiredAt: '2026-06-10 12:00:00',
            secureAccountRequiredPasskeyId: 'new-passkey',
        })
        await seedPasskey({id: 'old-passkey', userId: user.id, webauthnUserId: 'webauthn-user-1'})
        await seedPasskey({id: 'new-passkey', userId: user.id, webauthnUserId: 'webauthn-user-1', credentialId: 'new-passkey-credential'})

        const response = await postSecurityComplete()

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        await expect(
            queryOne(
                'SELECT password_hash, secure_account_required, secure_account_required_at, secure_account_required_passkey_id FROM users WHERE id = ?',
                [user.id],
            ),
        ).resolves.toMatchObject({
            password_hash: expect.stringMatching(/^passkey-only:/),
            secure_account_required: 0,
            secure_account_required_at: null,
            secure_account_required_passkey_id: null,
        })
    })
})

describe('POST /logout', () => {
    it('returns 204 and clears the cookie when no session cookie exists', async () => {
        const response = await postLogout()

        expect(response.status).toBe(204)

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Secure')
    })

    it('returns 403 when a session cookie exists without a CSRF token', async () => {
        const response = await postLogout('myoc_session=session-token')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
    })

    it('deletes the current session and clears the cookie with a valid CSRF token', async () => {
        const sessionToken = 'session-token'
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const csrfToken = await createCsrfToken(sessionToken)

        const response = await postLogout(`myoc_session=${sessionToken}`, 'https://example.com/logout', csrfToken)

        expect(response.status).toBe(204)
        await expect(queryOne('SELECT id FROM sessions WHERE session_hash = ?', [await sha256Hex(sessionToken)])).resolves.toBeNull()

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Secure')
    })

    it('redirects browser form submissions after logout', async () => {
        const sessionToken = 'session-token'

        const response = await postLogoutForm(`myoc_session=${sessionToken}`, await createCsrfToken(sessionToken))

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    })
})

type TestUserOverrides = {
    bannedAt?: string | null
    recoveryPhraseHash?: string | null
    recoveryPhraseConfirmedAt?: string | null
    secureAccountRequired?: boolean
    secureAccountRequiredAt?: string | null
    secureAccountRequiredPasskeyId?: string | null
    webauthnUserId?: string | null
}

async function seedTestUser(password: string, overrides: TestUserOverrides = {}): Promise<UserRecord> {
    const user: UserRecord = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: await hash(password, 10),
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        created_at: '2026-06-10 12:00:00',
    }
    await seedUser({
        id: user.id,
        email: user.email,
        username: user.username,
        passwordHash: user.password_hash,
        profilePhotoKey: user.profile_photo_key,
        bio: user.bio,
        displayNsfwMedia: Boolean(user.display_nsfw_media),
        role: user.role,
        createdAt: user.created_at,
        ...overrides,
    })
    return user
}

async function seedSecurityUser(overrides: TestUserOverrides = {}): Promise<SecurityTestUser> {
    const passwordHash = await hash('password123', 10)
    const user: SecurityTestUser = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        password_hash: passwordHash,
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        created_at: '2026-06-10 12:00:00',
        webauthn_user_id: 'webauthn-user-1',
        recovery_phrase_hash: null,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 0,
        secure_account_required_at: null,
        secure_account_required_passkey_id: null,
        banned_at: null,
    }
    await seedAuthenticatedUser(
        {
            id: user.id,
            email: user.email,
            username: user.username,
            passwordHash: user.password_hash,
            profilePhotoKey: user.profile_photo_key,
            bio: user.bio,
            displayNsfwMedia: Boolean(user.display_nsfw_media),
            role: user.role,
            createdAt: user.created_at,
            webauthnUserId: user.webauthn_user_id,
            recoveryPhraseHash: user.recovery_phrase_hash,
            recoveryPhraseConfirmedAt: user.recovery_phrase_confirmed_at,
            secureAccountRequired: Boolean(user.secure_account_required),
            secureAccountRequiredAt: user.secure_account_required_at,
            secureAccountRequiredPasskeyId: user.secure_account_required_passkey_id,
            bannedAt: user.banned_at,
            ...overrides,
        },
        'session-token',
    )
    return user
}

async function seedRegistrationChallenge(): Promise<void> {
    await seedChallenge({
        id: 'challenge-1',
        userId: 'new-user-id',
        email: 'new@example.com',
        username: 'newuser',
        webauthnUserId: 'webauthn-user-1',
        ceremony: 'registration',
        challenge: 'stored-challenge',
    })
}

async function seedAuthenticationChallenge(overrides: {userId?: string | null} = {}): Promise<void> {
    await seedChallenge({
        id: 'challenge-1',
        userId: overrides.userId ?? null,
        ceremony: 'authentication',
        challenge: 'stored-challenge',
    })
}

function createRegistrationCredential() {
    return {
        id: 'credential-id',
        rawId: 'credential-id',
        response: {
            attestationObject: 'attestation-object',
            clientDataJSON: 'client-data',
        },
        clientExtensionResults: {},
        type: 'public-key',
    }
}

function createAuthenticationCredential() {
    return {
        id: 'credential-id',
        rawId: 'credential-id',
        response: {
            authenticatorData: 'authenticator-data',
            clientDataJSON: 'client-data',
            signature: 'signature',
        },
        clientExtensionResults: {},
        type: 'public-key',
    }
}

function createRegistrationVerification(): VerifiedRegistrationResponse {
    return {
        verified: true,
        registrationInfo: {
            fmt: 'none',
            aaguid: '00000000-0000-0000-0000-000000000000',
            credential: {
                id: 'credential-id',
                publicKey: new Uint8Array([1, 2, 3]),
                counter: 7,
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
}

function createAuthenticationVerification(overrides: Partial<VerifiedAuthenticationResponse> = {}): VerifiedAuthenticationResponse {
    return {
        verified: true,
        authenticationInfo: {
            credentialID: 'credential-id',
            newCounter: 12,
            userVerified: true,
            credentialDeviceType: 'multiDevice',
            credentialBackedUp: true,
            origin: 'https://example.com',
            rpID: 'example.com',
        },
        ...overrides,
    }
}
