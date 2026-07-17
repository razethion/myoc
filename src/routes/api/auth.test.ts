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
import {createMockDb, sqlFragment} from '../../test/mockD1'
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

beforeEach(() => {
    vi.mocked(verifyAuthenticationResponse).mockReset()
    vi.mocked(verifyRegistrationResponse).mockReset()
})

async function postLogin(body: unknown, db: D1Database, url = '/login', cookie?: string): Promise<Response> {
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

async function postPasskeyRegistrationOptions(body: unknown, db: D1Database): Promise<Response> {
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

async function postPasskeyRegistrationVerify(body: unknown, db: D1Database): Promise<Response> {
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

async function postPasskeyLoginOptions(body: unknown, db: D1Database): Promise<Response> {
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

async function postPasskeyLoginVerify(body: unknown, db: D1Database): Promise<Response> {
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

async function postRecoveryLogin(body: unknown, db: D1Database): Promise<Response> {
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

async function postSecurityComplete(db: D1Database, sessionToken = 'session-token'): Promise<Response> {
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

async function postLogout(db: D1Database, cookie?: string, url = 'https://example.com/logout', csrfToken?: string): Promise<Response> {
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

async function postLogoutForm(db: D1Database, cookie?: string, csrfToken?: string): Promise<Response> {
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
        const {db} = createMockDb()

        const response = await postLogin('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when the username is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin(
            {
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 400 when the password is missing', async () => {
        const {db} = createMockDb()

        const response = await postLogin(
            {
                username: 'testuser',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and password are required',
        })
    })

    it('returns 401 when no matching user exists', async () => {
        const {db} = createMockDb()

        const response = await postLogin(
            {
                username: 'missinguser',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('returns 401 when the password does not match the stored hash', async () => {
        const user = await createTestUser('password123')
        const {db} = createMockDb({firstResults: [user]})

        const response = await postLogin(
            {
                username: 'testuser',
                password: 'wrong-password',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or password',
        })
    })

    it('returns 403 when the account is banned', async () => {
        const user = {
            ...(await createTestUser('password123')),
            banned_at: '2026-06-10 12:00:00',
        }
        const {db} = createMockDb({firstResults: [user]})

        const response = await postLogin(
            {
                username: 'testuser',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Account is banned',
        })
    })

    it('queries by username only', async () => {
        const {db, boundStatements} = createMockDb()

        await postLogin(
            {
                username: 'test@example.com',
                password: 'password123',
            },
            db,
        )

        expect(boundStatements[0]?.sql).toContain('WHERE username = ?')
        expect(boundStatements[0]?.sql).not.toContain('lower(email)')
        expect(boundStatements[0]?.binds).toEqual(['test@example.com'])
    })

    it('returns the public user and creates a secure session for valid credentials', async () => {
        const user = await createTestUser('password123')
        const {db, boundStatements} = createMockDb({firstResults: [user]})

        const response = await postLogin(
            {
                username: ' testuser ',
                password: ' password123 ',
            },
            db,
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

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(3)
        expect(boundStatements[0]?.binds).toEqual(['testuser'])
        expect(boundStatements[1]?.sql).toContain(sqlFragment('DELETE', 'FROM', 'sessions'))
        expect(boundStatements[2]?.sql).toContain(sqlFragment('INSERT', 'INTO', 'sessions'))
        expect(boundStatements[2]?.binds[1]).toBe(user.id)
    })

    it('allows login when a stale session cookie is present', async () => {
        const user = await createTestUser('password123')
        const {db} = createMockDb({firstResults: [user]})

        const response = await postLogin(
            {
                username: 'testuser',
                password: 'password123',
            },
            db,
            'https://example.com/login',
            'myoc_session=stale-session-token',
        )

        expect(response.status).toBe(200)
        expectSessionCookie(response)
    })
})

describe('POST /register/passkey/options', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationOptions('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationOptions(
            {
                email: 'test@example.com',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email and username are required',
        })
    })

    it('returns 400 for an invalid email', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationOptions(
            {
                email: 'not-an-email',
                username: 'testuser',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email must be valid',
        })
    })

    it('returns 400 for an invalid username', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationOptions(
            {
                email: 'test@example.com',
                username: 'bad-user',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 409 when the email or username is already in use', async () => {
        const {db} = createMockDb({firstResults: [{id: 'existing-user'}]})

        const response = await postPasskeyRegistrationOptions(
            {
                email: 'test@example.com',
                username: 'testuser',
            },
            db,
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a passkey registration challenge for a new account', async () => {
        const {db, boundStatements} = createMockDb({firstResults: [null]})

        const response = await postPasskeyRegistrationOptions(
            {
                email: ' Test@Example.com ',
                username: ' testuser ',
            },
            db,
        )

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            challengeId: string
            options: {challenge: string; user: {name: string}}
        }
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(body.options.challenge).toBeTruthy()
        expect(body.options.user.name).toBe('testuser')
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[0]?.binds).toEqual(['test@example.com', 'testuser'])
        expect(boundStatements[2]?.sql).toContain(sqlFragment('INSERT', 'INTO', 'webauthn_challenges'))
        expect(boundStatements[2]?.binds[2]).toBe('test@example.com')
        expect(boundStatements[2]?.binds[3]).toBe('testuser')
    })
})

describe('POST /register/passkey/verify', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationVerify('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the challenge or credential is missing', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyRegistrationVerify(
            {
                challengeId: 'challenge-1',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Challenge and passkey response are required',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the registration challenge has expired', async () => {
        const {db} = createMockDb({
            firstResults: [null],
        })

        const response = await postPasskeyRegistrationVerify(
            {
                challengeId: 'challenge-1',
                credential: createRegistrationCredential(),
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey registration expired',
        })
        expect(verifyRegistrationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the passkey response cannot be verified', async () => {
        const {db} = createMockDb({
            firstResults: [createRegistrationChallenge()],
        })
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({verified: false})

        const response = await postPasskeyRegistrationVerify(
            {
                challengeId: 'challenge-1',
                credential: createRegistrationCredential(),
            },
            db,
        )

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
        const {db} = createMockDb({
            firstResults: [createRegistrationChallenge()],
            runError: new Error('UNIQUE constraint failed: users.username'),
        })
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(createRegistrationVerification())

        const response = await postPasskeyRegistrationVerify(
            {
                challengeId: 'challenge-1',
                credential: createRegistrationCredential(),
            },
            db,
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a passkey-only user, starts a session, and returns the recovery phrase', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [createRegistrationChallenge()],
        })
        vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce(createRegistrationVerification())

        const response = await postPasskeyRegistrationVerify(
            {
                challengeId: ' challenge-1 ',
                credential: createRegistrationCredential(),
                name: ' Primary laptop ',
            },
            db,
        )

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

        const userInsert = boundStatements.find((statement) => statement.sql.includes(sqlFragment('INSERT', 'INTO', 'users')))
        const passkeyInsert = boundStatements.find((statement) => statement.sql.includes(sqlFragment('INSERT', 'INTO', 'user_passkeys')))
        const challengeDelete = boundStatements.find((statement) =>
            statement.sql.includes(sqlFragment('DELETE', 'FROM', 'webauthn_challenges')),
        )
        expect(userInsert?.binds[0]).toBe('new-user-id')
        expect(userInsert?.binds[1]).toBe('new@example.com')
        expect(userInsert?.binds[2]).toBe('newuser')
        expect(userInsert?.binds[3]).toMatch(/^passkey-only:/)
        expect(await verifyRecoveryPhrase(body.recoveryPhrase, userInsert?.binds[9] as string)).toBe(true)
        expect(userInsert?.binds[11]).toBe(1)
        expect(userInsert?.binds[12]).toBe(passkeyInsert?.binds[0])
        expect(passkeyInsert?.binds.slice(1, 10)).toEqual([
            'new-user-id',
            'credential-id',
            'AQID',
            'webauthn-user-1',
            7,
            'multiDevice',
            1,
            'internal,usb',
            'Primary laptop',
        ])
        expect(challengeDelete?.binds).toEqual(['challenge-1'])
        expect(db.batch).toHaveBeenCalledTimes(2)
    })
})

describe('POST /login/passkey/options', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyLoginOptions('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 404 when a username has no registered passkey', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [null],
        })

        const response = await postPasskeyLoginOptions(
            {
                username: 'missinguser',
            },
            db,
        )

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: 'No passkey is registered for that username',
        })
        expect(boundStatements[0]?.sql).toContain(sqlFragment('INNER', 'JOIN', 'user_passkeys'))
        expect(boundStatements[0]?.binds).toEqual(['missinguser'])
    })

    it('creates scoped authentication options for a username with a passkey', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [{id: 'user-1'}],
            allResults: [
                [
                    createPasskey('passkey-1', {
                        credential_id: 'credential-id',
                        transports: 'internal,usb',
                    }),
                ],
            ],
        })

        const response = await postPasskeyLoginOptions(
            {
                username: ' testuser ',
            },
            db,
        )

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

        const challengeInsert = boundStatements.find((statement) =>
            statement.sql.includes(sqlFragment('INSERT', 'INTO', 'webauthn_challenges')),
        )
        expect(challengeInsert?.binds[1]).toBe('user-1')
        expect(challengeInsert?.binds[5]).toBe('authentication')
        expect(challengeInsert?.binds[6]).toBe(body.options.challenge)
    })

    it('creates discoverable authentication options when no username is supplied', async () => {
        const {db, boundStatements} = createMockDb()

        const response = await postPasskeyLoginOptions({}, db)

        expect(response.status).toBe(200)
        const body = (await response.json()) as {
            options: {
                allowCredentials?: unknown[]
                rpId: string
            }
        }
        expect(body.options.rpId).toBe('example.com')
        expect(body.options.allowCredentials).toBeUndefined()
        const challengeInsert = boundStatements.find((statement) =>
            statement.sql.includes(sqlFragment('INSERT', 'INTO', 'webauthn_challenges')),
        )
        expect(challengeInsert?.binds[1]).toBeNull()
    })
})

describe('POST /login/passkey/verify', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyLoginVerify('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the challenge or credential id is missing', async () => {
        const {db} = createMockDb()

        const response = await postPasskeyLoginVerify(
            {
                challengeId: 'challenge-1',
                credential: {},
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Challenge and passkey response are required',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 400 when the passkey login challenge has expired', async () => {
        const {db} = createMockDb({
            firstResults: [null],
        })

        const response = await postPasskeyLoginVerify(
            {
                challengeId: 'challenge-1',
                credential: createAuthenticationCredential(),
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Passkey login expired',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 401 when the passkey is not registered for the requested user', async () => {
        const {db} = createMockDb({
            firstResults: [
                createAuthenticationChallenge({
                    user_id: 'user-1',
                }),
                createPasskey('passkey-1', {
                    user_id: 'other-user',
                }),
            ],
        })

        const response = await postPasskeyLoginVerify(
            {
                challengeId: 'challenge-1',
                credential: createAuthenticationCredential(),
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Passkey is not registered for this login',
        })
        expect(verifyAuthenticationResponse).not.toHaveBeenCalled()
    })

    it('returns 401 when the passkey response cannot be verified', async () => {
        const {db} = createMockDb({
            firstResults: [createAuthenticationChallenge(), createPasskey('passkey-1')],
        })
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification({verified: false}))

        const response = await postPasskeyLoginVerify(
            {
                challengeId: 'challenge-1',
                credential: createAuthenticationCredential(),
            },
            db,
        )

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
        const {db} = createMockDb({
            firstResults: [createAuthenticationChallenge(), createPasskey('passkey-1'), null],
        })
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification())

        const response = await postPasskeyLoginVerify(
            {
                challengeId: 'challenge-1',
                credential: createAuthenticationCredential(),
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Passkey is not registered for an active account',
        })
    })

    it('updates passkey usage, clears the challenge, and starts a session', async () => {
        const user = await createTestUser('password123')
        const {db, boundStatements} = createMockDb({
            firstResults: [createAuthenticationChallenge(), createPasskey('passkey-1'), user],
        })
        vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce(createAuthenticationVerification())

        const response = await postPasskeyLoginVerify(
            {
                challengeId: ' challenge-1 ',
                credential: createAuthenticationCredential(),
            },
            db,
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            user: {
                id: user.id,
                email: user.email,
                username: user.username,
            },
        })
        expectSessionCookie(response)

        const passkeyUpdate = boundStatements.find((statement) => statement.sql.includes(sqlFragment('UPDATE', 'user_passkeys')))
        const challengeDelete = boundStatements.find((statement) =>
            statement.sql.includes(sqlFragment('DELETE', 'FROM', 'webauthn_challenges')),
        )
        expect(passkeyUpdate?.binds[0]).toBe(12)
        expect(passkeyUpdate?.binds[1]).toBe('multiDevice')
        expect(passkeyUpdate?.binds[2]).toBe(1)
        expect(passkeyUpdate?.binds[4]).toBe('passkey-1')
        expect(challengeDelete?.binds).toEqual(['challenge-1'])
        expect(db.batch).toHaveBeenCalledTimes(2)
    })
})

describe('POST /recovery/login', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postRecoveryLogin('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const {db} = createMockDb()

        const response = await postRecoveryLogin(
            {
                username: 'testuser',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username and recovery phrase are required',
        })
    })

    it('returns 401 when the recovery phrase does not match', async () => {
        const user = {
            ...(await createTestUser('password123')),
            recovery_phrase_hash: await hashRecoveryPhrase('correct-horse-battery-staple'),
            banned_at: null,
        }
        const {db} = createMockDb({firstResults: [user]})

        const response = await postRecoveryLogin(
            {
                username: 'testuser',
                recoveryPhrase: 'wrong phrase',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Invalid username or recovery phrase',
        })
    })

    it('returns 403 when the account is banned', async () => {
        const recoveryPhrase = 'correct-horse-battery-staple'
        const user = {
            ...(await createTestUser('password123')),
            recovery_phrase_hash: await hashRecoveryPhrase(recoveryPhrase),
            banned_at: '2026-06-10 12:00:00',
        }
        const {db} = createMockDb({firstResults: [user]})

        const response = await postRecoveryLogin(
            {
                username: 'testuser',
                recoveryPhrase,
            },
            db,
        )

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Account is banned',
        })
    })

    it('creates a session and forces account security review when recovery succeeds', async () => {
        const recoveryPhrase = 'correct-horse-battery-staple'
        const user = {
            ...(await createTestUser('password123')),
            recovery_phrase_hash: await hashRecoveryPhrase(recoveryPhrase),
            banned_at: null,
        }
        const {db, boundStatements} = createMockDb({firstResults: [user]})

        const response = await postRecoveryLogin(
            {
                username: 'testuser',
                recoveryPhrase,
            },
            db,
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
            secureAccountRequired: true,
            user: {
                id: user.id,
                username: user.username,
            },
        })
        expectSessionCookie(response)
        expect(boundStatements[1]?.sql).toContain('secure_account_required')
        expect(boundStatements[1]?.sql).toContain('secure_account_required_at')
        expect(boundStatements[1]?.sql).toContain('secure_account_required_passkey_id = NULL')
        expect(boundStatements[1]?.binds).toHaveLength(2)
        expect(boundStatements[1]?.binds[1]).toBe(user.id)
        expect(boundStatements.some((statement) => statement.sql.includes(sqlFragment('DELETE', 'FROM', 'user_passkeys')))).toBe(false)
        expect(
            boundStatements.some(
                (statement) => statement.sql.includes(sqlFragment('DELETE', 'FROM', 'sessions')) && statement.sql.includes('user_id'),
            ),
        ).toBe(false)
        expect(db.batch).toHaveBeenCalledTimes(1)
    })
})

describe('POST /security/complete', () => {
    it('requires a new passkey after recovery instead of accepting existing passkeys', async () => {
        const user = await createSecurityUser({
            recovery_phrase_confirmed_at: '2026-06-10 12:05:00',
            secure_account_required: 1,
            secure_account_required_at: '2026-06-10 12:00:00',
            secure_account_required_passkey_id: null,
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [createSessionUser(user), user],
            allResults: [[createPasskey('old-passkey')]],
        })

        const response = await postSecurityComplete(db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Add a new passkey before completing account recovery',
        })
        expect(boundStatements.some((statement) => statement.sql.includes('SET password_hash'))).toBe(false)
    })

    it('completes recovery when the forced passkey is still registered', async () => {
        const user = await createSecurityUser({
            recovery_phrase_confirmed_at: '2026-06-10 12:05:00',
            secure_account_required: 1,
            secure_account_required_at: '2026-06-10 12:00:00',
            secure_account_required_passkey_id: 'new-passkey',
        })
        const {db, boundStatements} = createMockDb({
            firstResults: [createSessionUser(user), user],
            allResults: [[createPasskey('old-passkey'), createPasskey('new-passkey')]],
        })

        const response = await postSecurityComplete(db)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({ok: true})
        expect(boundStatements[3]?.sql).toContain('secure_account_required = 0')
        expect(boundStatements[3]?.sql).toContain('secure_account_required_at = NULL')
        expect(boundStatements[3]?.sql).toContain('secure_account_required_passkey_id = NULL')
        expect(boundStatements[3]?.binds[1]).toBe(user.id)
    })
})

describe('POST /logout', () => {
    it('returns 204 and clears the cookie when no session cookie exists', async () => {
        const {db} = createMockDb()

        const response = await postLogout(db)

        expect(response.status).toBe(204)
        expect(db.prepare).not.toHaveBeenCalled()

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('HttpOnly')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Path=/')
        expect(cookie).toContain('SameSite=Lax')
        expect(cookie).toContain('Secure')
    })

    it('returns 403 when a session cookie exists without a CSRF token', async () => {
        const {db} = createMockDb()

        const response = await postLogout(db, 'myoc_session=session-token')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('deletes the current session and clears the cookie with a valid CSRF token', async () => {
        const {db, boundStatements} = createMockDb()
        const sessionToken = 'session-token'
        const csrfToken = await createCsrfToken(sessionToken)

        const response = await postLogout(db, `myoc_session=${sessionToken}`, 'https://example.com/logout', csrfToken)

        expect(response.status).toBe(204)
        expect(boundStatements).toHaveLength(1)
        expect(boundStatements[0]?.sql).toContain(sqlFragment('DELETE', 'FROM', 'sessions'))
        expect(boundStatements[0]?.binds).toHaveLength(1)
        expect(boundStatements[0]?.binds[0]).not.toBe(sessionToken)
        expect(boundStatements[0]?.binds[0]).toBe(await sha256Hex(sessionToken))

        const cookie = response.headers.get('set-cookie')
        expect(cookie).toContain('myoc_session=')
        expect(cookie).toContain('Max-Age=0')
        expect(cookie).toContain('Secure')
    })

    it('redirects browser form submissions after logout', async () => {
        const {db} = createMockDb()
        const sessionToken = 'session-token'

        const response = await postLogoutForm(db, `myoc_session=${sessionToken}`, await createCsrfToken(sessionToken))

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/')
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    })
})

async function createTestUser(password: string): Promise<UserRecord> {
    return {
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
}

async function createSecurityUser(overrides: Partial<SecurityTestUser> = {}): Promise<SecurityTestUser> {
    return {
        ...(await createTestUser('password123')),
        webauthn_user_id: 'webauthn-user-1',
        recovery_phrase_hash: null,
        recovery_phrase_confirmed_at: null,
        secure_account_required: 0,
        secure_account_required_at: null,
        secure_account_required_passkey_id: null,
        banned_at: null,
        ...overrides,
    }
}

function createSessionUser(
    user: UserRecord & {
        recovery_phrase_confirmed_at?: string | null
        secure_account_required?: number | null
    },
) {
    return {
        id: user.id,
        session_id: 'session-1',
        email: user.email,
        username: user.username,
        role: user.role,
        profile_photo_key: user.profile_photo_key,
        bio: user.bio,
        display_nsfw_media: user.display_nsfw_media,
        last_seen_version: user.last_seen_version,
        recovery_phrase_confirmed_at: user.recovery_phrase_confirmed_at ?? null,
        secure_account_required: user.secure_account_required ?? 0,
    }
}

function createPasskey(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        user_id: 'user-1',
        credential_id: `${id}-credential`,
        public_key: 'AQID',
        webauthn_user_id: 'webauthn-user-1',
        counter: 0,
        device_type: 'singleDevice',
        backed_up: 0,
        transports: null,
        name: id,
        created_at: '2026-06-10 12:10:00',
        last_used_at: null,
        ...overrides,
    }
}

function createRegistrationChallenge(overrides: Record<string, unknown> = {}) {
    return {
        id: 'challenge-1',
        user_id: 'new-user-id',
        email: 'new@example.com',
        username: 'newuser',
        webauthn_user_id: 'webauthn-user-1',
        ceremony: 'registration',
        challenge: 'stored-challenge',
        expires_at: '2026-06-10 12:05:00',
        ...overrides,
    }
}

function createAuthenticationChallenge(overrides: Record<string, unknown> = {}) {
    return {
        id: 'challenge-1',
        user_id: null,
        email: null,
        username: null,
        webauthn_user_id: null,
        ceremony: 'authentication',
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

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
