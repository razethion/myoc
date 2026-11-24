import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {expectSessionCookie} from '../../test/assertions'
import {queryAll, queryOne, seedSession, seedUser, sha256Hex, useTestDatabase} from '../../test/d1'
import type {Bindings} from '../../types/bindings'
import {createSession, getCurrentUser, hasRecentAuthentication, revokeOtherSessionsStatement, toSqlTimestamp} from './session'

const db = useTestDatabase()
const DAY_MS = 60 * 60 * 24 * 1000
const HOUR_MS = 60 * 60 * 1000

function createProbeApp() {
    const app = new Hono<{Bindings: Bindings}>()
    app.get('/probe', async (c) => {
        const user = await getCurrentUser(c)
        return c.json({id: user?.id ?? null})
    })
    return app
}

async function probe(token: string): Promise<Response> {
    return await createProbeApp().request('https://example.com/probe', {headers: {cookie: `myoc_session=${token}`}}, {
        DB: db,
    } as Bindings)
}

async function sessionExpiry(token: string): Promise<string | null> {
    const row = await queryOne<{expires_at: string}>('SELECT expires_at FROM sessions WHERE session_hash = ?', [await sha256Hex(token)])
    return row?.expires_at ?? null
}

describe('session renewal', () => {
    it('renews a session once it is a day old', async () => {
        const token = 'renew-me'
        const seededExpiry = toSqlTimestamp(new Date(Date.now() + 29 * DAY_MS - HOUR_MS))

        await seedUser({id: 'user-1'})
        await seedSession({userId: 'user-1', token, expiresAt: seededExpiry})

        const response = await probe(token)

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({id: 'user-1'})
        expectSessionCookie(response)

        const expiry = await sessionExpiry(token)
        const earliest = toSqlTimestamp(new Date(Date.now() + 30 * DAY_MS - 5000))
        const latest = toSqlTimestamp(new Date(Date.now() + 30 * DAY_MS + 5000))

        expect(expiry).not.toBeNull()
        expect(expiry && expiry >= earliest && expiry <= latest).toBe(true)
    })

    it('keeps a session that is less than a day old', async () => {
        const token = 'leave-alone'
        const seededExpiry = toSqlTimestamp(new Date(Date.now() + 29 * DAY_MS + HOUR_MS))

        await seedUser({id: 'user-2'})
        await seedSession({userId: 'user-2', token, expiresAt: seededExpiry})

        const response = await probe(token)

        expect(response.status).toBe(200)
        expect(response.headers.get('set-cookie')).toBeNull()
        await expect(sessionExpiry(token)).resolves.toBe(seededExpiry)
    })

    it('does not renew an expired session', async () => {
        const token = 'expired'

        await seedUser({id: 'user-3'})
        await seedSession({userId: 'user-3', token, expiresAt: toSqlTimestamp(new Date(Date.now() - DAY_MS))})

        const response = await probe(token)

        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toEqual({id: null})
        expect(response.headers.get('set-cookie')).toBeNull()
    })
})

describe('step-up authentication window', () => {
    const now = new Date('2026-06-10T12:05:00Z')

    it('accepts an authentication inside the window', () => {
        expect(hasRecentAuthentication({authenticatedAt: '2026-06-10 11:55:00'}, now)).toBe(true)
    })

    it('rejects an authentication older than the window', () => {
        expect(hasRecentAuthentication({authenticatedAt: '2026-06-10 11:54:59'}, now)).toBe(false)
    })

    it('rejects a session without an authentication timestamp', () => {
        expect(hasRecentAuthentication({authenticatedAt: null}, now)).toBe(false)
    })

    it('rejects an unparseable authentication timestamp', () => {
        expect(hasRecentAuthentication({authenticatedAt: 'not-a-timestamp'}, now)).toBe(false)
    })

    it('records the authentication time when a session is created', async () => {
        await seedUser({id: 'user-10'})

        const token = await createSession(db, 'user-10', new Date('2026-06-10T12:00:00Z'))

        expect(
            await queryOne<{authenticated_at: string}>('SELECT authenticated_at FROM sessions WHERE session_hash = ?', [
                await sha256Hex(token),
            ]),
        ).toEqual({authenticated_at: '2026-06-10 12:00:00'})
    })

    it('reports the stored authentication time on the current user', async () => {
        const token = 'auth-time'
        await seedUser({id: 'user-11'})
        await seedSession({userId: 'user-11', token, authenticatedAt: '2026-06-10 12:00:00'})

        const app = new Hono<{Bindings: Bindings}>()
        app.get('/probe', async (c) => {
            const user = await getCurrentUser(c)
            return c.json({authenticatedAt: user?.authenticatedAt ?? null})
        })

        const response = await app.request('https://example.com/probe', {headers: {cookie: `myoc_session=${token}`}}, {DB: db} as Bindings)

        expect(await response.json()).toEqual({authenticatedAt: '2026-06-10 12:00:00'})
    })

    it('reports no authentication time for a legacy session row', async () => {
        const token = 'legacy-auth'
        await seedUser({id: 'user-14'})
        await seedSession({userId: 'user-14', token, authenticatedAt: null})

        const app = new Hono<{Bindings: Bindings}>()
        app.get('/probe', async (c) => {
            const user = await getCurrentUser(c)
            return c.json({authenticatedAt: user?.authenticatedAt ?? null})
        })

        const response = await app.request('https://example.com/probe', {headers: {cookie: `myoc_session=${token}`}}, {DB: db} as Bindings)

        expect(await response.json()).toEqual({authenticatedAt: null})
    })

    it('keeps authentication time stale when an old session renews', async () => {
        const token = 'renew-without-reauth'
        const seededExpiry = toSqlTimestamp(new Date(Date.now() + 29 * DAY_MS - HOUR_MS))
        // 12 minutes ago: past the 10-minute step-up window used by hasRecentAuthentication.
        const authenticatedAt = toSqlTimestamp(new Date(Date.now() - 12 * 60 * 1000))

        await seedUser({id: 'user-12'})
        await seedSession({userId: 'user-12', token, expiresAt: seededExpiry, authenticatedAt})

        expect((await probe(token)).status).toBe(200)

        const row = await queryOne<{expires_at: string; authenticated_at: string}>(
            'SELECT expires_at, authenticated_at FROM sessions WHERE session_hash = ?',
            [await sha256Hex(token)],
        )

        expect(row?.expires_at).not.toBe(seededExpiry)
        expect(row?.authenticated_at).toBe(authenticatedAt)
    })

    it('revokes every session except the one being kept', async () => {
        await seedUser({id: 'user-13'})
        await seedSession({id: 'keep-me', userId: 'user-13', token: 'keep-token'})
        await seedSession({id: 'drop-me', userId: 'user-13', token: 'drop-token'})

        await revokeOtherSessionsStatement(db, 'user-13', 'keep-me').run()

        expect(await queryAll<{id: string}>('SELECT id FROM sessions WHERE user_id = ? ORDER BY id', ['user-13'])).toEqual([
            {id: 'keep-me'},
        ])
    })
})
