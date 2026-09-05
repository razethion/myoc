import {env} from 'cloudflare:workers'
import {compare} from 'bcryptjs'
import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES} from '../../lib/media/profileImage'
import {thumbnailOriginalObjectKey} from '../../lib/media/thumbnailSources'
import {APP_VERSION} from '../../lib/releases'
import {expectSessionCookie} from '../../test/assertions'
import {queryAll, queryOne, seedAuthenticatedUser, seedUser, useTestDatabase, withFailingTrigger} from '../../test/d1'
import {
    createAvifBytes,
    createGifFile,
    createJpegFile,
    createMalformedWebpFile,
    createOversizedWebpFile,
    createPngFile,
    createWebpFile,
} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createAllowingAuthRateLimits} from '../../test/mockRateLimit'
import {createRequestHeaders, type TestRequestOptions} from '../../test/request'
import {apiRoutes} from '../api'
import {authPageActionRoutes} from '../page-actions/auth'
import {settingsPageActionRoutes} from '../page-actions/settings'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const profilePhotoKeyPattern = /^avif-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createSquareImageContainer(
    response: Response | Error = new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}}),
) {
    const fetch = vi.fn(async () => {
        if (response instanceof Error) throw response
        return response.clone()
    })
    return {
        fetch,
        namespace: {
            idFromName: vi.fn(() => 'image-container-id'),
            get: vi.fn(() => ({fetch})),
        } as unknown as DurableObjectNamespace,
    }
}

type CreateUserResponse = {
    user: {
        email: string
        username: string
        role: 'user' | 'moderator' | 'admin'
        profilePhotoKey: string | null
        bio: string
        displayNsfwMedia: boolean
        lastSeenVersion: string | null
        createdAt: string
    }
}

type UserRequestOptions = TestRequestOptions

async function postUser(body: unknown, db: D1Database, url = 'https://example.com/register'): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return authPageActionRoutes.request(
        url,
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: {
                'content-type': 'application/json',
                origin: new URL(url).origin,
            },
        },
        {
            ...createAllowingAuthRateLimits(),
            DB: db,
            MEDIA_BUCKET: mediaBucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

async function postCurrentUserSettings(body: unknown, db: D1Database, options: UserRequestOptions = {}): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return settingsPageActionRoutes.request(
        'https://example.com/settings',
        {
            method: 'POST',
            body: body instanceof FormData ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        {
            DB: db,
            MEDIA_BUCKET: mediaBucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

async function postRawCurrentUserSettings(
    body: BodyInit | null,
    db: D1Database,
    sessionToken: string,
    contentType?: string,
): Promise<Response> {
    return settingsPageActionRoutes.request(
        'https://example.com/settings',
        {
            method: 'POST',
            body,
            headers: {
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
                ...(contentType ? {'content-type': contentType} : {}),
            },
        },
        {DB: db},
    )
}

async function postCurrentUserReleaseView(db: D1Database, options: UserRequestOptions = {}): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return apiRoutes.request(
        'https://example.com/users/me/release-view',
        {
            method: 'POST',
            body: JSON.stringify({}),
            headers: createRequestHeaders({}, options),
        },
        {
            DB: db,
            MEDIA_BUCKET: mediaBucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

async function postCurrentUserRecentMediaPreference(body: unknown, db: D1Database, options: UserRequestOptions = {}): Promise<Response> {
    return apiRoutes.request(
        'https://example.com/users/me/recent-media-preference',
        {
            method: 'POST',
            body: typeof body === 'string' ? body : JSON.stringify(body),
            headers: createRequestHeaders(body, options),
        },
        {DB: db},
    )
}

async function postPasskeyPromptResponse(body: unknown, db: D1Database, options: UserRequestOptions = {}): Promise<Response> {
    const mediaBucket = createMockR2Bucket()
    const headers = createRequestHeaders(body, options)

    if (body instanceof FormData) {
        headers.accept = 'text/html'
    }

    return settingsPageActionRoutes.request(
        'https://example.com/passkey-setup',
        {
            method: 'POST',
            body: body instanceof FormData ? body : JSON.stringify(body),
            headers,
        },
        {
            DB: db,
            MEDIA_BUCKET: mediaBucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

async function postRawPasskeyPromptResponse(body: BodyInit, db: D1Database, sessionToken: string, contentType?: string): Promise<Response> {
    return settingsPageActionRoutes.request(
        'https://example.com/passkey-setup',
        {
            method: 'POST',
            body,
            headers: {
                cookie: `myoc_session=${sessionToken}`,
                'x-csrf-token': await createCsrfToken(sessionToken),
                ...(contentType ? {'content-type': contentType} : {}),
            },
        },
        {DB: db},
    )
}

async function postProfilePhoto(
    db: D1Database,
    mediaBucket: R2Bucket,
    options: {
        sessionToken: string
        csrfToken: string
        file?: File
        previewContainer?: DurableObjectNamespace
    },
): Promise<Response> {
    const form = new FormData()
    form.set('csrfToken', options.csrfToken)

    if (options.file) {
        form.set('profilePhoto', options.file)
    }

    return apiRoutes.request(
        'https://example.com/users/me/profile-photo',
        {
            method: 'POST',
            body: form,
            headers: {
                cookie: `myoc_session=${options.sessionToken}`,
                'x-csrf-token': options.csrfToken,
            },
        },
        {
            DB: db,
            MYOC_DOCKER_SHARP_CONTAINER: options.previewContainer ?? createSquareImageContainer().namespace,
            MEDIA_PREVIEW_OVERFLOW_ENABLED: 'false',
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
            MEDIA_BUCKET: mediaBucket,
            MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
        },
    )
}

type CurrentUserSeedOverrides = {
    id?: string
    email?: string
    username?: string
    role?: 'user' | 'moderator' | 'admin'
    passwordHash?: string
    profilePhotoKey?: string | null
    bio?: string
    displayNsfwMedia?: boolean
    lastSeenVersion?: string | null
}

const currentUser = {
    id: 'current-user',
    email: 'old@example.com',
    username: 'olduser',
    role: 'user' as const,
    profilePhotoKey: null,
    bio: 'Old bio',
    displayNsfwMedia: false,
    lastSeenVersion: null,
}

const db = env.DB
useTestDatabase()

async function seedCurrentUser(overrides: CurrentUserSeedOverrides = {}, sessionToken = 'session-token'): Promise<void> {
    const user = {...currentUser, ...overrides}

    await seedAuthenticatedUser(
        {
            id: user.id,
            email: user.email,
            username: user.username,
            role: user.role,
            passwordHash: user.passwordHash,
            profilePhotoKey: user.profilePhotoKey,
            bio: user.bio,
            displayNsfwMedia: user.displayNsfwMedia,
            lastSeenVersion: user.lastSeenVersion,
        },
        sessionToken,
        db,
    )
}

describe('POST /register', () => {
    it('returns 400 for invalid JSON', async () => {
        const response = await postUser('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const response = await postUser(
            {
                email: 'test@example.com',
                username: 'testuser',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email, username, and password are required',
        })
    })

    it('returns 400 for an invalid email', async () => {
        const response = await postUser(
            {
                email: 'not-an-email',
                username: 'testuser',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email must be valid',
        })
    })

    it('returns 400 for an invalid username', async () => {
        const response = await postUser(
            {
                email: 'test@example.com',
                username: 'bad-user',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 400 when the username contains URL-hostile characters', async () => {
        const response = await postUser(
            {
                email: 'test@example.com',
                username: 'bad/user',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 400 for a short password', async () => {
        const response = await postUser(
            {
                email: 'test@example.com',
                username: 'testuser',
                password: 'short',
            },
            db,
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Password must be at least 8 characters',
        })
    })

    it('returns 409 when the email or username is already in use', async () => {
        await seedUser({id: 'existing-user', email: 'test@example.com', username: 'testuser'}, db)

        const response = await postUser(
            {
                email: 'test@example.com',
                username: 'testuser',
                password: 'password123',
            },
            db,
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('returns 409 when the insert hits a unique constraint', async () => {
        const response = await withFailingTrigger(
            {
                name: 'register_unique_constraint',
                operation: 'INSERT',
                table: 'users',
                message: 'UNIQUE constraint failed: users.email',
            },
            async () =>
                await postUser(
                    {
                        email: 'test@example.com',
                        username: 'testuser',
                        password: 'password123',
                    },
                    db,
                ),
            db,
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a user, starts a session, and returns the public user', async () => {
        const response = await postUser(
            {
                email: ' Test@Example.com ',
                username: ' testuser ',
                password: ' password123 ',
            },
            db,
        )

        expect(response.status).toBe(201)

        const body = (await response.json()) as CreateUserResponse
        expect(body.user.email).toBe('test@example.com')
        expect(body.user.username).toBe('testuser')
        expect(body.user.role).toBe('user')
        expect(body.user.profilePhotoKey).toBeNull()
        expect(body.user.bio).toBe('')
        expect(body.user.displayNsfwMedia).toBe(false)
        expect(body.user.lastSeenVersion).toBeNull()
        expect(body.user.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
        expect(JSON.stringify(body)).not.toContain('password_hash')

        expectSessionCookie(response)

        const storedUser = await queryOne<{
            id: string
            email: string
            username: string
            password_hash: string
            role: string
            bio: string
            display_nsfw_media: number
        }>('SELECT id, email, username, password_hash, role, bio, display_nsfw_media FROM users WHERE email = ?', ['test@example.com'], db)
        expect(storedUser).toMatchObject({
            email: 'test@example.com',
            username: 'testuser',
            role: 'user',
            bio: '',
            display_nsfw_media: 0,
        })
        expect(await compare('password123', storedUser?.password_hash ?? '')).toBe(true)
        expect(await queryOne<{user_id: string}>('SELECT user_id FROM sessions WHERE user_id = ?', [storedUser?.id], db)).toEqual({
            user_id: storedUser?.id,
        })
    })
})

describe('POST /settings', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await postCurrentUserSettings(
            {
                email: 'test@example.com',
                username: 'testuser',
                bio: 'New bio',
            },
            db,
        )

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const response = await postCurrentUserSettings(
            {
                email: 'test@example.com',
                username: 'testuser',
                bio: 'New bio',
            },
            db,
            {
                sessionToken: 'session-token',
            },
        )

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
    })

    it('reads a multipart CSRF token after a large file field', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const form = new FormData()
        form.set('largeFile', new File([new Uint8Array(70 * 1024)], 'large.bin'))
        form.set('csrfToken', await createCsrfToken(sessionToken))

        const response = await postCurrentUserSettings(form, db, {sessionToken})

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Request body is too large',
        })
    })

    it('rejects an oversized JSON settings request', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const response = await postCurrentUserSettings({padding: 'x'.repeat(64 * 1024)}, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        await expect(response.json()).resolves.toEqual({error: 'Request body is too large'})
    })

    it.each([
        {name: 'malformed JSON', body: '{bad json', contentType: 'application/json'},
        {name: 'JSON with a scalar root', body: '"text"', contentType: 'application/json'},
        {name: 'a request without a body or content type', body: null, contentType: undefined},
    ])('rejects $name as an invalid settings update', async ({body, contentType}) => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const response = await postRawCurrentUserSettings(body, db, sessionToken, contentType)

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Email and username are required'})
    })

    it.each([
        {
            name: 'an invalid email',
            body: {email: 'invalid', username: 'newuser'},
            error: 'Email must be valid',
        },
        {
            name: 'an oversized bio',
            body: {email: 'new@example.com', username: 'newuser', bio: 'a'.repeat(256)},
            error: 'Bio must be 255 characters or fewer',
        },
        {
            name: 'a short password',
            body: {email: 'new@example.com', username: 'newuser', password: 'short'},
            error: 'Password must be at least 8 characters',
        },
    ])('rejects $name', async ({body, error}) => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const response = await postCurrentUserSettings(body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error})
    })

    it('returns 400 when the updated username contains URL-hostile characters', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserSettings(
            {
                email: 'test@example.com',
                username: 'bad/user',
                bio: 'New bio',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('updates the current user without changing the password', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({passwordHash: 'old-password-hash'}, sessionToken)

        const response = await postCurrentUserSettings(
            {
                email: ' New@Example.com ',
                username: ' newuser ',
                bio: ' Updated bio ',
                password: '',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        expect(
            await queryOne<{email: string; username: string; bio: string; display_nsfw_media: number; password_hash: string}>(
                'SELECT email, username, bio, display_nsfw_media, password_hash FROM users WHERE id = ?',
                [currentUser.id],
                db,
            ),
        ).toEqual({
            email: 'new@example.com',
            username: 'newuser',
            bio: 'Updated bio',
            display_nsfw_media: 0,
            password_hash: 'old-password-hash',
        })
    })

    it('updates the NSFW media display preference from the settings form checkbox', async () => {
        const sessionToken = 'session-token'
        const form = new FormData()
        form.set('email', 'new@example.com')
        form.set('username', 'newuser')
        form.set('bio', 'Updated bio')
        form.set('password', '')
        form.set('displayNsfwMedia', 'true')
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserSettings(form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })
        expect(
            await queryOne<{display_nsfw_media: number}>('SELECT display_nsfw_media FROM users WHERE id = ?', [currentUser.id], db),
        ).toEqual({display_nsfw_media: 1})
    })

    it('returns 409 when the updated email or username already exists', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        await seedUser({id: 'other-user', email: 'taken@example.com', username: 'takenuser'}, db)

        const response = await postCurrentUserSettings(
            {
                email: 'taken@example.com',
                username: 'takenuser',
                bio: 'Updated bio',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('updates the password when a new password is provided', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({passwordHash: 'old-password-hash'}, sessionToken)

        const response = await postCurrentUserSettings(
            {
                email: 'new@example.com',
                username: 'newuser',
                bio: 'Updated bio',
                password: 'newpassword123',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        const updatedUser = await queryOne<{password_hash: string}>('SELECT password_hash FROM users WHERE id = ?', [currentUser.id], db)
        expect(await compare('newpassword123', updatedUser?.password_hash ?? '')).toBe(true)
    })

    it('replaces the current social links when settings are saved', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        await db
            .prepare(
                "INSERT INTO user_social_links (user_id, platform, label, url, updated_at) VALUES (?, 'custom', 'Old', 'https://old.example/', CURRENT_TIMESTAMP)",
            )
            .bind(currentUser.id)
            .run()

        const response = await postCurrentUserSettings(
            {
                email: 'new@example.com',
                username: 'newuser',
                bio: 'Updated bio',
                twitterUrl: ' https://twitter.com/newuser ',
                telegramUrl: '',
                discordUrl: '',
                instagramUrl: '',
                furaffinityUrl: '',
                blueskyUrl: 'https://bsky.app/profile/newuser.test',
                customLinkLabel: 'Website',
                customLinkUrl: 'https://example.com',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        expect(
            await queryAll<{platform: string; label: string | null; url: string}>(
                'SELECT platform, label, url FROM user_social_links WHERE user_id = ? ORDER BY platform',
                [currentUser.id],
                db,
            ),
        ).toEqual([
            {platform: 'bluesky', label: null, url: 'https://bsky.app/profile/newuser.test'},
            {platform: 'custom', label: 'Website', url: 'https://example.com/'},
            {platform: 'twitter', label: null, url: 'https://twitter.com/newuser'},
        ])
    })

    it('returns 400 when a social link is not a valid URL', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserSettings(
            {
                email: 'new@example.com',
                username: 'newuser',
                bio: 'Updated bio',
                twitterUrl: 'not-a-url',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Twitter / X must be a valid URL',
        })
    })

    it('returns 400 when a social link is not HTTPS', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        // noinspection HttpUrlsUsage
        const response = await postCurrentUserSettings(
            {
                email: 'new@example.com',
                username: 'newuser',
                bio: 'Updated bio',
                twitterUrl: 'http://twitter.com/newuser',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Twitter / X must start with https://',
        })
    })
})

describe('POST /users/me/release-view', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await postCurrentUserReleaseView(db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const response = await postCurrentUserReleaseView(db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
    })

    it('stores the current app version as seen for the current user', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserReleaseView(db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
            version: APP_VERSION,
        })
        expect(
            await queryOne<{last_seen_version: string}>('SELECT last_seen_version FROM users WHERE id = ?', [currentUser.id], db),
        ).toEqual({
            last_seen_version: APP_VERSION,
        })
    })
})

describe('POST /users/me/recent-media-preference', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await postCurrentUserRecentMediaPreference({showUnapproved: false}, db)

        expect(response.status).toBe(401)
        await expect(response.json()).resolves.toEqual({error: 'Authentication required'})
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const response = await postCurrentUserRecentMediaPreference({showUnapproved: false}, db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({error: 'Invalid CSRF token'})
    })

    it.each([
        {name: 'malformed JSON', body: '{bad json'},
        {name: 'a missing preference', body: {}},
        {name: 'a non-boolean preference', body: {showUnapproved: 'false'}},
        {name: 'an extra field', body: {showUnapproved: false, unexpected: true}},
    ])('returns 400 for $name', async ({body}) => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserRecentMediaPreference(body, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        await expect(response.json()).resolves.toEqual({error: 'Recent media preference is invalid'})
    })

    it.each([false, true])('stores showUnapproved=%s for the current user', async (showUnapproved) => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postCurrentUserRecentMediaPreference({showUnapproved}, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ok: true, showUnapproved})
        await expect(
            queryOne<{show_unapproved_media: number}>('SELECT show_unapproved_media FROM users WHERE id = ?', [currentUser.id], db),
        ).resolves.toEqual({show_unapproved_media: showUnapproved ? 1 : 0})
    })
})

describe('POST /passkey-setup', () => {
    it('returns 401 when the user is not logged in', async () => {
        const response = await postPasskeyPromptResponse({choice: 'later'}, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('stores the prompt response and returns the setup redirect', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)

        const response = await postPasskeyPromptResponse(
            {
                choice: 'setup',
                returnTo: '/search?q=demo',
            },
            db,
            {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
            },
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
            choice: 'setup',
            redirectTo: '/settings',
        })
        expect(
            await queryOne<{passkey_prompt_seen_at: string | null}>(
                'SELECT passkey_prompt_seen_at FROM users WHERE id = ?',
                [currentUser.id],
                db,
            ),
        ).toEqual({passkey_prompt_seen_at: expect.any(String)})
    })

    it('rejects an oversized JSON prompt response', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const response = await postPasskeyPromptResponse({choice: 'later', padding: 'x'.repeat(64 * 1024)}, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        await expect(response.json()).resolves.toEqual({error: 'Request body is too large'})
    })

    it.each([
        {name: 'malformed JSON', body: '{bad json', contentType: 'application/json'},
        {name: 'JSON with a scalar root', body: '"text"', contentType: 'application/json'},
        {name: 'a body without a content type', body: 'raw body', contentType: undefined},
    ])('uses safe defaults for $name', async ({body, contentType}) => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const response = await postRawPasskeyPromptResponse(body, db, sessionToken, contentType)

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({ok: true, choice: 'later', redirectTo: '/u/olduser'})
    })

    it('rejects an oversized form prompt response', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const form = new FormData()
        form.set('choice', 'later')
        form.set('padding', 'x'.repeat(64 * 1024))
        const response = await postPasskeyPromptResponse(form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(413)
        await expect(response.json()).resolves.toEqual({error: 'Request body is too large'})
    })

    it('reads a setup choice from a small form without a return path', async () => {
        const sessionToken = 'session-token'
        await seedCurrentUser({}, sessionToken)
        const form = new FormData()
        form.set('choice', 'setup')
        const response = await postPasskeyPromptResponse(form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/settings')
    })

    it('redirects browser form submissions back to a safe local path', async () => {
        const sessionToken = 'session-token'
        const form = new FormData()
        form.set('csrfToken', await createCsrfToken(sessionToken))
        form.set('choice', 'later')
        form.set('returnTo', '/search?q=demo')
        await seedCurrentUser({}, sessionToken)

        const response = await postPasskeyPromptResponse(form, db, {
            sessionToken,
        })

        expect(response.status).toBe(302)
        expect(response.headers.get('location')).toBe('/search?q=demo')
    })

    it.each(['//evil.example', '/\\evil.example', '/\\\\evil.example', '/%61pi/search', '/%70asskey-setup'])(
        'rejects unsafe return path %s for browser form submissions',
        async (returnTo) => {
            const sessionToken = 'session-token'
            const form = new FormData()
            form.set('csrfToken', await createCsrfToken(sessionToken))
            form.set('choice', 'later')
            form.set('returnTo', returnTo)
            await seedCurrentUser({}, sessionToken)

            const response = await postPasskeyPromptResponse(form, db, {
                sessionToken,
            })

            expect(response.status).toBe(302)
            expect(response.headers.get('location')).toBe('/u/olduser')
        },
    )
})

describe('POST /users/me/profile-photo', () => {
    it('returns 401 when the user is not logged in', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createWebpFile(),
        })

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('returns 400 when the profile photo file is missing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo is required',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('uploads a validated 512x512 AVIF profile photo to R2', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const file = createWebpFile()
        await seedCurrentUser({profilePhotoKey: 'old-profile-photo-key'}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file,
        })

        expect(response.status).toBe(200)

        const body = (await response.json()) as {profilePhotoKey: string; profilePhotoUrl: string}
        expect(body.profilePhotoKey).toMatch(profilePhotoKeyPattern)
        expect(body.profilePhotoUrl).toBe(`${mediaPublicBaseUrl}/users/current-user/profile/${body.profilePhotoKey}.avif`)
        expect(mediaBucket.put).toHaveBeenCalledTimes(2)
        expect(mediaBucket.put).toHaveBeenCalledWith(`users/current-user/profile/${body.profilePhotoKey}.avif`, expect.any(Uint8Array), {
            httpMetadata: {
                cacheControl: 'public, max-age=300, must-revalidate',
                contentType: 'image/avif',
            },
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith('users/current-user/profile/old-profile-photo-key.webp')
        expect(mediaBucket.put).toHaveBeenCalledWith(
            thumbnailOriginalObjectKey(`users/current-user/profile/${body.profilePhotoKey}.avif`),
            new Uint8Array(await file.arrayBuffer()),
            {
                onlyIf: expect.any(Headers),
                httpMetadata: {
                    cacheControl: 'private, no-store',
                    contentType: 'image/webp',
                },
            },
        )
        expect(mediaBucket.delete).toHaveBeenCalledWith(thumbnailOriginalObjectKey('users/current-user/profile/old-profile-photo-key.webp'))
        expect(
            await queryOne<{profile_photo_key: string; profile_photo_content_type: string}>(
                'SELECT profile_photo_key, profile_photo_content_type FROM users WHERE id = ?',
                [currentUser.id],
                db,
            ),
        ).toEqual({profile_photo_key: body.profilePhotoKey, profile_photo_content_type: 'image/avif'})
    })

    it('deletes the new R2 object when the D1 profile update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        await seedCurrentUser({}, sessionToken)

        try {
            const response = await withFailingTrigger(
                {
                    name: 'profile_photo_update',
                    operation: 'UPDATE',
                    table: 'users',
                    columns: ['profile_photo_key'],
                },
                async () =>
                    await postProfilePhoto(db, mediaBucket, {
                        sessionToken,
                        csrfToken: await createCsrfToken(sessionToken),
                        file: createWebpFile(),
                    }),
                db,
            )

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls.find(([key]) => !key.startsWith('thumbnail-originals/'))?.[0]
            expect(uploadedKey).toMatch(/^users\/current-user\/profile\/.+\.avif$/)
            expect((uploadedKey as string).slice('users/current-user/profile/'.length, -'.avif'.length)).toMatch(profilePhotoKeyPattern)
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
        } finally {
            error.mockRestore()
        }
    })

    it('deletes the retained source when the public profile photo write fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const putImplementation = vi.mocked(mediaBucket.put).getMockImplementation()
        if (!putImplementation) throw new Error('Expected the mock R2 bucket to have a put implementation')
        vi.mocked(mediaBucket.put).mockImplementationOnce(putImplementation).mockRejectedValueOnce(new Error('R2 write failed'))
        await seedCurrentUser({}, sessionToken)

        try {
            const response = await postProfilePhoto(db, mediaBucket, {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
                file: createWebpFile(),
            })

            expect(response.status).toBe(500)
            const retainedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(retainedKey).toMatch(/^thumbnail-originals\/users\/current-user\/profile\/.+\.avif\.source$/)
            expect(mediaBucket.delete).toHaveBeenCalledWith(retainedKey)
            expect(mediaBucket.delete).toHaveBeenCalledWith((retainedKey as string).slice('thumbnail-originals/'.length, -'.source'.length))
        } finally {
            error.mockRestore()
        }
    })

    it('still succeeds when deleting the previous profile photo fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.mocked(mediaBucket.delete).mockRejectedValueOnce(new Error('R2 delete failed'))
        await seedCurrentUser({profilePhotoKey: 'old-profile-photo-key'}, sessionToken)

        try {
            const response = await postProfilePhoto(db, mediaBucket, {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
                file: createWebpFile(),
            })

            expect(response.status).toBe(200)
            expect(mediaBucket.delete).toHaveBeenCalledWith('users/current-user/profile/old-profile-photo-key.webp')
            expect(warn).toHaveBeenCalledWith('Unable to delete old profile photo', expect.any(Error))
        } finally {
            warn.mockRestore()
        }
    })

    it('rejects profile photos that are not exactly 512x512', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createWebpFile(1024, 1024),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo must be exactly 512x512 pixels',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('converts PNG profile photos to AVIF before storing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createPngFile(512, 512, 'image/png', 'profile-photo.png'),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as {profilePhotoKey: string}
        expect(mediaBucket.put).toHaveBeenCalledWith(`users/current-user/profile/${body.profilePhotoKey}.avif`, expect.any(Uint8Array), {
            httpMetadata: {
                cacheControl: 'public, max-age=300, must-revalidate',
                contentType: 'image/avif',
            },
        })
    })

    it('converts JPEG profile photos to AVIF before storing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createJpegFile(512, 512, 'profile-photo.jpg'),
        })

        expect(response.status).toBe(200)
    })

    it('rejects profile photos that cannot be normalized', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createGifFile(512, 512, 'profile-photo.gif'),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Unexpected media, contact support',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile photos that are larger than 2 MB after processing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createOversizedWebpFile(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo must be 2 MB or smaller',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('allows multipart framing around a 3 MB profile photo before image validation', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: new File([new Uint8Array(3 * 1024 * 1024)], 'profile-photo.webp', {type: 'image/webp'}),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo must be 2 MB or smaller',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile photo bodies that exceed the multipart allowance', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: new File([new Uint8Array(PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES + 1)], 'profile-photo.webp', {
                type: 'image/webp',
            }),
        })

        expect(response.status).toBe(413)
        expect(await response.json()).toEqual({
            error: 'Profile photo upload is too large',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile photos with malformed WebP bytes', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        await seedCurrentUser({}, sessionToken)

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createMalformedWebpFile(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Unexpected media, contact support',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })
})
