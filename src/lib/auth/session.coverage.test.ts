import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {
    type CurrentUser,
    canModerateImages,
    clearSessionCookie,
    createCsrfToken,
    createSession,
    deleteSession,
    getCurrentUser,
    getSessionCookieName,
    isAdminUser,
    isValidCsrfToken,
    normalizeCredential,
    setSessionCookie,
    toPublicUser,
    toSqlTimestamp,
    type UserRecord,
} from './session'

describe('session coverage', () => {
    it('creates and deletes hashed sessions', async () => {
        const {db, boundStatements} = createMockDb()
        const now = new Date('2026-06-10T12:00:00.000Z')

        const token = await createSession(db, 'user-1', now)

        expect(token).toMatch(/^[0-9a-f]{64}$/)
        expect(boundStatements).toHaveLength(2)
        expect(boundStatements[0]?.sql).toContain('DELETE FROM sessions')
        expect(boundStatements[0]?.binds).toEqual(['2026-06-10 12:00:00'])
        expect(boundStatements[1]?.sql).toContain('INSERT INTO sessions')
        expect(boundStatements[1]?.binds[1]).toBe('user-1')
        expect(boundStatements[1]?.binds[3]).toBe('2026-07-10 12:00:00')

        await deleteSession(db, token)
        expect(boundStatements[2]?.sql).toContain('DELETE FROM sessions WHERE session_hash = ?')
        expect(boundStatements[2]?.binds).toHaveLength(1)
    })

    it('returns no current user without a session cookie', async () => {
        const {db} = createMockDb()
        const app = createApp((c) => getCurrentUser(c))

        const response = await app.request('https://example.test/', {}, createWorkerEnv({DB: db}))
        expect(response.status).toBe(200)
        expect(await response.json()).toBeNull()
    })

    it('maps a current user and the unapproved-media setting', async () => {
        const user = {
            id: 'user-1',
            session_id: 'session-1',
            email: 'user@example.com',
            username: 'user',
            role: 'unknown',
            profile_photo_key: null,
            bio: 'Bio',
            display_nsfw_media: 1,
            show_unapproved_media: 0,
            last_seen_version: null,
            recovery_phrase_confirmed_at: '2026-06-01 00:00:00',
            secure_account_required: 0,
            passkey_prompt_seen_at: null,
        }
        const {db, boundStatements} = createMockDb({firstResults: [user]})
        const app = createApp((c) => getCurrentUser(c))
        const response = await app.request(
            'https://example.test/',
            {headers: {Cookie: `${getSessionCookieName()}=session-token`}},
            createWorkerEnv({DB: db}),
        )

        expect(await response.json()).toEqual({
            id: 'user-1',
            sessionId: 'session-1',
            email: 'user@example.com',
            username: 'user',
            role: 'user',
            profilePhotoKey: null,
            bio: 'Bio',
            displayNsfwMedia: true,
            showUnapprovedMedia: false,
            lastSeenVersion: null,
            recoveryPhraseConfirmed: true,
            secureAccountRequired: false,
            passkeyPromptSeen: false,
            csrfToken: await createCsrfToken('session-token'),
        })
        expect(boundStatements[0]?.binds).toHaveLength(2)

        const {db: emptyDb} = createMockDb({firstResults: [null]})
        const emptyApp = createApp((c) => getCurrentUser(c))
        const emptyResponse = await emptyApp.request(
            'https://example.test/',
            {headers: {Cookie: `${getSessionCookieName()}=session-token`}},
            createWorkerEnv({DB: emptyDb}),
        )
        expect(await emptyResponse.json()).toBeNull()

        const {db: enabledDb} = createMockDb({firstResults: [{...user, show_unapproved_media: 1}]})
        const enabledApp = createApp((c) => getCurrentUser(c))
        const enabledResponse = await enabledApp.request(
            'https://example.test/',
            {headers: {Cookie: `${getSessionCookieName()}=session-token`}},
            createWorkerEnv({DB: enabledDb}),
        )
        expect((await enabledResponse.json<{showUnapprovedMedia: boolean}>()).showUnapprovedMedia).toBe(true)
    })

    it('sets and clears secure session cookies', async () => {
        const app = new Hono()
        app.get('/set', (c) => {
            setSessionCookie(c as never, 'token')
            return c.text('ok')
        })
        app.get('/clear', (c) => {
            clearSessionCookie(c as never)
            return c.text('ok')
        })

        const setResponse = await app.request('https://example.test/set')
        expect(setResponse.headers.get('Set-Cookie')).toContain(`${getSessionCookieName()}=token`)
        expect(setResponse.headers.get('Set-Cookie')).toContain('Secure')
        const clearResponse = await app.request('http://example.test/clear')
        expect(clearResponse.headers.get('Set-Cookie')).toContain(`${getSessionCookieName()}=`)
        expect(clearResponse.headers.get('Set-Cookie')).toContain('Max-Age=0')
    })

    it('validates csrf tokens and normalizes credentials and timestamps', async () => {
        const token = await createCsrfToken('session-token')
        await expect(isValidCsrfToken('session-token', token)).resolves.toBe(true)
        await expect(isValidCsrfToken('session-token', null)).resolves.toBe(false)
        await expect(isValidCsrfToken('session-token', `${token.slice(0, -1)}0`)).resolves.toBe(false)
        await expect(isValidCsrfToken('session-token', `${token}0`)).resolves.toBe(false)
        expect(normalizeCredential('  credential  ')).toBe('credential')
        expect(normalizeCredential('   ')).toBeNull()
        expect(normalizeCredential(42)).toBeNull()
        expect(toSqlTimestamp(new Date('2026-06-10T12:34:56.789Z'))).toBe('2026-06-10 12:34:56')
    })

    it('maps public users and checks permissions', () => {
        const user = createUser({role: 'moderator', display_nsfw_media: 1})
        expect(toPublicUser(user)).toEqual({
            id: 'user-1',
            email: 'user@example.com',
            username: 'user',
            role: 'moderator',
            profilePhotoKey: null,
            bio: '',
            displayNsfwMedia: true,
            lastSeenVersion: null,
            createdAt: '2026-06-01 00:00:00',
        })
        const current = createCurrentUser('admin')
        expect(isAdminUser(current)).toBe(true)
        expect(isAdminUser(createCurrentUser('user'))).toBe(false)
        expect(isAdminUser(null)).toBe(false)
        expect(canModerateImages(current)).toBe(true)
        expect(canModerateImages(createCurrentUser('moderator'))).toBe(true)
        expect(canModerateImages(createCurrentUser('user'))).toBe(false)
        expect(canModerateImages(null)).toBe(false)
    })
})

function createApp(handler: (c: Parameters<typeof getCurrentUser>[0]) => Promise<unknown>): Hono<{Bindings: Bindings}> {
    const app = new Hono<{Bindings: Bindings}>()
    app.get('/', async (c) => c.json(await handler(c)))
    return app
}

function createUser(overrides: Partial<UserRecord> = {}): UserRecord {
    return {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        password_hash: 'hash',
        role: 'user',
        profile_photo_key: null,
        bio: '',
        display_nsfw_media: 0,
        last_seen_version: null,
        created_at: '2026-06-01 00:00:00',
        ...overrides,
    }
}

function createCurrentUser(role: CurrentUser['role']): CurrentUser {
    return {
        id: 'user-1',
        email: 'user@example.com',
        username: 'user',
        role,
        profilePhotoKey: null,
        bio: '',
        displayNsfwMedia: false,
        showUnapprovedMedia: true,
        lastSeenVersion: null,
        csrfToken: 'csrf-token',
    }
}
