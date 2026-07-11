import {hash} from 'bcryptjs'
import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createMockDb} from '../../test/mockD1'
import {createCsrfToken, type UserRecord} from '../../lib/auth/session'
import {hashRecoveryPhrase} from '../../lib/auth/passkeys'
import {expectSessionCookie} from '../../test/assertions'

type SecurityTestUser = UserRecord & {
    webauthn_user_id: string | null
    recovery_phrase_hash: string | null
    recovery_phrase_confirmed_at: string | null
    secure_account_required: number
    secure_account_required_at: string | null
    secure_account_required_passkey_id: string | null
    banned_at: string | null
}

async function postLogin(body: unknown, db: D1Database, url = '/login', cookie?: string): Promise<Response> {
    return apiRoutes.request(
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
    return apiRoutes.request(
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

async function postRecoveryLogin(body: unknown, db: D1Database): Promise<Response> {
    return apiRoutes.request(
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
    return apiRoutes.request(
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

    return apiRoutes.request(
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
        expect(boundStatements[1]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'sessions'].join(' '))
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
        expect(boundStatements[2]?.sql).toContain(['INSERT INTO', 'webauthn_challenges'].join(' '))
        expect(boundStatements[2]?.binds[2]).toBe('test@example.com')
        expect(boundStatements[2]?.binds[3]).toBe('testuser')
    })
})

describe('POST /recovery/login', () => {
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
        expect(boundStatements.some((statement) => statement.sql.includes(['DELETE FROM', 'user_passkeys'].join(' ')))).toBe(false)
        expect(
            boundStatements.some(
                (statement) => statement.sql.includes(['DELETE FROM', 'sessions'].join(' ')) && statement.sql.includes('user_id'),
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
        expect(boundStatements[0]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
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

function createPasskey(id: string) {
    return {
        id,
        user_id: 'user-1',
        credential_id: `${id}-credential`,
        public_key: `${id}-public-key`,
        webauthn_user_id: 'webauthn-user-1',
        counter: 0,
        device_type: 'singleDevice',
        backed_up: 0,
        transports: null,
        name: id,
        created_at: '2026-06-10 12:10:00',
        last_used_at: null,
    }
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
