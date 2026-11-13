import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {expectSessionCookie} from '../../test/assertions'
import {queryOne, seedSession, seedUser, sha256Hex, useTestDatabase} from '../../test/d1'
import type {Bindings} from '../../types/bindings'
import {getCurrentUser, toSqlTimestamp} from './session'

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
