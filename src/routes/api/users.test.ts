import {compare} from 'bcryptjs'
import {describe, expect, it, vi} from 'vitest'
import {apiRoutes} from '../api'
import {createCsrfToken} from '../../lib/auth/session'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import {expectSessionCookie} from '../../test/assertions'
import {createMalformedWebpFile, createOversizedWebpFile, createWebpFile} from '../../test/imageFixtures'
import {createRequestHeaders, type TestRequestOptions} from '../../test/request'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const profilePhotoKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type CreateUserResponse = {
    user: {
        email: string
        username: string
        role: 'user' | 'admin'
        profilePhotoKey: string | null
        bio: string
        displayNsfwMedia: boolean
        lastSeenVersion: string | null
        createdAt: string
    }
}

type UserRequestOptions = TestRequestOptions

async function postUser(body: unknown, db: D1Database, url = 'https://example.com/users'): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return apiRoutes.request(url, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: {
            'content-type': 'application/json',
        },
    }, {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

async function postCurrentUserSettings(
    body: unknown,
    db: D1Database,
    options: UserRequestOptions = {},
): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return apiRoutes.request('https://example.com/users/me', {
        method: 'POST',
        body: body instanceof FormData ? body : JSON.stringify(body),
        headers: createRequestHeaders(body, options),
    }, {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

async function postCurrentUserReleaseView(
    db: D1Database,
    options: UserRequestOptions = {},
): Promise<Response> {
    const mediaBucket = createMockR2Bucket()

    return apiRoutes.request('https://example.com/users/me/release-view', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: createRequestHeaders({}, options),
    }, {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

async function postProfilePhoto(
    db: D1Database,
    mediaBucket: R2Bucket,
    options: { sessionToken: string; csrfToken: string; file?: File },
): Promise<Response> {
    const form = new FormData()
    form.set('csrfToken', options.csrfToken)

    if (options.file) {
        form.set('profilePhoto', options.file)
    }

    return apiRoutes.request('https://example.com/users/me/profile-photo', {
        method: 'POST',
        body: form,
        headers: {
            cookie: `myoc_session=${options.sessionToken}`,
        },
    }, {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    });
}

const currentUserRecord = {
    id: 'current-user',
    email: 'old@example.com',
    username: 'olduser',
    role: 'user',
    profile_photo_key: null,
    bio: 'Old bio',
    display_nsfw_media: 0,
    last_seen_version: null,
}

describe('POST /users', () => {
    it('returns 400 for invalid JSON', async () => {
        const {db} = createMockDb()

        const response = await postUser('{bad json', db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Invalid JSON body',
        })
    })

    it('returns 400 when required fields are missing', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email, username, and password are required',
        })
    })

    it('returns 400 for an invalid email', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'not-an-email',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Email must be valid',
        })
    })

    it('returns 400 for an invalid username', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'bad-user',
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 400 when the username contains URL-hostile characters', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'bad/user',
            password: 'password123',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('returns 400 for a short password', async () => {
        const {db} = createMockDb()

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'short',
        }, db)

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Password must be at least 8 characters',
        })
    })

    it('returns 409 when the email or username is already in use', async () => {
        const {db} = createMockDb({firstResults: [{id: 'existing-user'}]})

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('returns 409 when the insert hits a unique constraint', async () => {
        const {db} = createMockDb({
            firstResults: [null],
            runError: new Error('UNIQUE constraint failed: users.email'),
        })

        const response = await postUser({
            email: 'test@example.com',
            username: 'testuser',
            password: 'password123',
        }, db)

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('creates a user, starts a session, and returns the public user', async () => {
        const {db, boundStatements} = createMockDb({firstResults: [null]})

        const response = await postUser({
            email: ' Test@Example.com ',
            username: ' testuser ',
            password: ' password123 ',
        }, db)

        expect(response.status).toBe(201)

        const body = await response.json() as CreateUserResponse
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

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(4)
        expect(boundStatements[0]?.binds).toEqual(['test@example.com', 'testuser'])
        expect(boundStatements[1]?.sql).toContain(['INSERT INTO', 'users'].join(' '))
        expect(boundStatements[1]?.binds[1]).toBe('test@example.com')
        expect(boundStatements[1]?.binds[2]).toBe('testuser')
        expect(await compare('password123', boundStatements[1]?.binds[3] as string)).toBe(true)
        expect(boundStatements[1]?.binds[4]).toBe('user')
        expect(boundStatements[1]?.binds[6]).toBe(0)
        expect(boundStatements[2]?.sql).toContain(['DELETE FROM', 'sessions'].join(' '))
        expect(boundStatements[3]?.sql).toContain(['INSERT INTO', 'sessions'].join(' '))
        expect(boundStatements[3]?.binds[1]).toBe(boundStatements[1]?.binds[0])
    })
})

describe('POST /users/me', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postCurrentUserSettings({
            email: 'test@example.com',
            username: 'testuser',
            bio: 'New bio',
        }, db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

        const response = await postCurrentUserSettings({
            email: 'test@example.com',
            username: 'testuser',
            bio: 'New bio',
        }, db, {
            sessionToken: 'session-token',
        })

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: 'Invalid CSRF token',
        })
    })

    it('returns 400 when the updated username contains URL-hostile characters', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCurrentUserSettings({
            email: 'test@example.com',
            username: 'bad/user',
            bio: 'New bio',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Username must be 3-32 characters and contain only letters, numbers, and underscores',
        })
    })

    it('updates the current user without changing the password', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await postCurrentUserSettings({
            email: ' New@Example.com ',
            username: ' newuser ',
            bio: ' Updated bio ',
            password: '',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(4)
        expect(boundStatements[0]?.sql).toContain('INNER JOIN users')
        expect(boundStatements[1]?.binds).toEqual(['new@example.com', 'newuser', currentUserRecord.id])
        expect(boundStatements[2]?.sql).toContain('UPDATE users')
        expect(boundStatements[2]?.sql).not.toContain('password_hash')
        expect(boundStatements[2]?.binds).toEqual(['new@example.com', 'newuser', 'Updated bio', 0, currentUserRecord.id])
        expect(boundStatements[3]?.sql).toContain(['DELETE FROM', 'user_social_links'].join(' '))
        expect(boundStatements[3]?.binds).toEqual([currentUserRecord.id])
    })

    it('updates the NSFW media display preference from the settings form checkbox', async () => {
        const sessionToken = 'session-token'
        const form = new FormData()
        form.set('email', 'new@example.com')
        form.set('username', 'newuser')
        form.set('bio', 'Updated bio')
        form.set('password', '')
        form.set('displayNsfwMedia', 'true')
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await postCurrentUserSettings(form, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })
        expect(boundStatements[2]?.binds).toEqual(['new@example.com', 'newuser', 'Updated bio', 1, currentUserRecord.id])
    })

    it('returns 409 when the updated email or username already exists', async () => {
        const sessionToken = 'session-token'
        const {db} = createMockDb({
            firstResults: [currentUserRecord, {id: 'other-user'}],
        })

        const response = await postCurrentUserSettings({
            email: 'taken@example.com',
            username: 'takenuser',
            bio: 'Updated bio',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(409)
        expect(await response.json()).toEqual({
            error: 'Email or username is already in use',
        })
    })

    it('updates the password when a new password is provided', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await postCurrentUserSettings({
            email: 'new@example.com',
            username: 'newuser',
            bio: 'Updated bio',
            password: 'newpassword123',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        expect(boundStatements[2]?.sql).toContain('password_hash')
        expect(boundStatements[2]?.binds[0]).toBe('new@example.com')
        expect(boundStatements[2]?.binds[1]).toBe('newuser')
        expect(boundStatements[2]?.binds[2]).toBe('Updated bio')
        expect(boundStatements[2]?.binds[3]).toBe(0)
        expect(await compare('newpassword123', boundStatements[2]?.binds[4] as string)).toBe(true)
        expect(boundStatements[2]?.binds[5]).toBe(currentUserRecord.id)
    })

    it('replaces the current social links when settings are saved', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord, null],
        })

        const response = await postCurrentUserSettings({
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
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
        })

        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements).toHaveLength(7)
        expect(boundStatements[3]?.sql).toContain(['DELETE FROM', 'user_social_links'].join(' '))
        expect(boundStatements[4]?.sql).toContain(['INSERT INTO', 'user_social_links'].join(' '))
        expect(boundStatements[4]?.binds).toEqual([currentUserRecord.id, 'twitter', null, 'https://twitter.com/newuser'])
        expect(boundStatements[5]?.binds).toEqual([currentUserRecord.id, 'bluesky', null, 'https://bsky.app/profile/newuser.test'])
        expect(boundStatements[6]?.binds).toEqual([currentUserRecord.id, 'custom', 'Website', 'https://example.com/'])
    })

    it('returns 400 when a social link is not a valid URL', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCurrentUserSettings({
            email: 'new@example.com',
            username: 'newuser',
            bio: 'Updated bio',
            twitterUrl: 'not-a-url',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Twitter / X must be a valid URL',
        })
        expect(db.batch).not.toHaveBeenCalled()
        expect(boundStatements).toHaveLength(1)
    })

    it('returns 400 when a social link is not HTTPS', async () => {
        const sessionToken = 'session-token'
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        // noinspection HttpUrlsUsage
        const response = await postCurrentUserSettings({
            email: 'new@example.com',
            username: 'newuser',
            bio: 'Updated bio',
            twitterUrl: 'http://twitter.com/newuser',
        }, db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Twitter / X must start with https://',
        })
        expect(db.batch).not.toHaveBeenCalled()
        expect(boundStatements).toHaveLength(1)
    })
})

describe('POST /users/me/release-view', () => {
    it('returns 401 when the user is not logged in', async () => {
        const {db} = createMockDb()

        const response = await postCurrentUserReleaseView(db)

        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({
            error: 'Authentication required',
        })
    })

    it('returns 403 when a logged-in request is missing CSRF protection', async () => {
        const {db} = createMockDb()

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
        const {db, boundStatements} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postCurrentUserReleaseView(db, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
        })

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            ok: true,
            version: '2026.06.16.02',
        })
        expect(boundStatements[1]?.sql).toContain('UPDATE users')
        expect(boundStatements[1]?.sql).toContain('last_seen_version')
        expect(boundStatements[1]?.binds).toEqual(['2026.06.16.02', currentUserRecord.id])
    })
})

describe('POST /users/me/profile-photo', () => {
    it('returns 401 when the user is not logged in', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [null],
        })

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
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

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

    it('uploads a validated 512x512 WebP profile photo to R2', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db, boundStatements} = createMockDb({
            firstResults: [{
                ...currentUserRecord,
                profile_photo_key: 'old-profile-photo-key',
            }],
        })

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createWebpFile(),
        })

        expect(response.status).toBe(200)

        const body = await response.json() as { profilePhotoKey: string; profilePhotoUrl: string }
        expect(body.profilePhotoKey).toMatch(profilePhotoKeyPattern)
        expect(body.profilePhotoUrl).toBe(`${mediaPublicBaseUrl}/users/current-user/profile/${body.profilePhotoKey}.webp`)
        expect(mediaBucket.put).toHaveBeenCalledTimes(1)
        expect(mediaBucket.put).toHaveBeenCalledWith(`users/current-user/profile/${body.profilePhotoKey}.webp`, expect.any(Uint8Array), {
            httpMetadata: {
                cacheControl: 'public, max-age=31536000, immutable',
                contentType: 'image/webp',
            },
        })
        expect(mediaBucket.delete).toHaveBeenCalledWith('users/current-user/profile/old-profile-photo-key.webp')
        expect(boundStatements[1]?.sql).toContain('UPDATE users')
        expect(boundStatements[1]?.binds).toEqual([body.profilePhotoKey, currentUserRecord.id])
    })

    it('deletes the new R2 object when the D1 profile update fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
            runError: new Error('D1 update failed'),
        })

        try {
            const response = await postProfilePhoto(db, mediaBucket, {
                sessionToken,
                csrfToken: await createCsrfToken(sessionToken),
                file: createWebpFile(),
            })

            expect(response.status).toBe(500)
            const uploadedKey = vi.mocked(mediaBucket.put).mock.calls[0]?.[0]
            expect(uploadedKey).toMatch(/^users\/current-user\/profile\/.+\.webp$/)
            expect((uploadedKey as string).slice('users/current-user/profile/'.length, -'.webp'.length)).toMatch(profilePhotoKeyPattern)
            expect(mediaBucket.delete).toHaveBeenCalledWith(uploadedKey)
        } finally {
            error.mockRestore()
        }
    })

    it('still succeeds when deleting the previous profile photo fails', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        vi.mocked(mediaBucket.delete).mockRejectedValueOnce(new Error('R2 delete failed'))
        const {db} = createMockDb({
            firstResults: [{
                ...currentUserRecord,
                profile_photo_key: 'old-profile-photo-key',
            }],
        })

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
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

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

    it('rejects profile photos that are not WebP files', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createWebpFile(512, 512, 'image/png'),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo must be a WebP image',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('rejects profile photos that are larger than 2 MB after processing', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

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

    it('rejects profile photos with malformed WebP bytes', async () => {
        const sessionToken = 'session-token'
        const mediaBucket = createMockR2Bucket()
        const {db} = createMockDb({
            firstResults: [currentUserRecord],
        })

        const response = await postProfilePhoto(db, mediaBucket, {
            sessionToken,
            csrfToken: await createCsrfToken(sessionToken),
            file: createMalformedWebpFile(),
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Profile photo must be a valid WebP image',
        })
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })
})
