import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import type {Bindings} from '../../types/bindings'
import {csrfProtection} from './csrf'

const SESSION_COOKIE = 'myoc_session=test-session'
const PRE_AUTH_CSRF_TOKEN = '0123456789abcdef0123456789abcdef'

describe('csrfProtection', () => {
    it.each([
        {name: 'a cross-site fetch', headers: {origin: 'https://evil.example', 'sec-fetch-site': 'cross-site'}},
        {name: 'a same-site sibling origin', headers: {origin: 'https://sibling.example.test', 'sec-fetch-site': 'same-site'}},
        {name: 'a null origin', headers: {origin: 'null'}},
        {name: 'missing source headers', headers: {}},
    ] as Array<{name: string; headers: Record<string, string>}>)('rejects $name on public authentication routes', async ({headers}) => {
        const response = await publicAuthRequest(headers)

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({error: 'Invalid CSRF token'})
    })

    it.each([
        {name: 'an exact Origin', headers: {origin: 'https://example.test', 'sec-fetch-site': 'same-origin'}},
        {name: 'an exact Referer', headers: {referer: 'https://example.test/login'}},
    ] as Array<{name: string; headers: Record<string, string>}>)('allows $name on public authentication routes', async ({headers}) => {
        const response = await publicAuthRequest(headers)

        expect(response.status).toBe(204)
        expect(response.headers.get('vary')).toContain('Origin')
        expect(response.headers.get('vary')).toContain('Sec-Fetch-Site')
    })

    it('rejects a public login when the pre-auth CSRF token does not match its cookie', async () => {
        const response = await publicAuthRequest({
            cookie: `myoc_pre_auth_csrf=${'f'.repeat(32)}`,
            origin: 'https://example.test',
        })

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({error: 'Invalid CSRF token'})
    })

    it.each([
        {
            name: 'an oversized URL-encoded form',
            contentType: 'application/x-www-form-urlencoded',
            body: 'csrfToken=missing',
            contentLength: '65537',
        },
        {
            name: 'malformed multipart data',
            contentType: 'multipart/form-data; boundary=missing',
            body: 'not multipart data',
        },
    ])('rejects $name', async ({contentType, body, contentLength}) => {
        const response = await protectedRequest(
            new Request('https://example.test/protected', {
                method: 'POST',
                body,
                headers: {
                    cookie: SESSION_COOKIE,
                    'content-type': contentType,
                    ...(contentLength ? {'content-length': contentLength} : {}),
                },
            }),
        )

        expect(response.status).toBe(403)
        await expect(response.json()).resolves.toEqual({error: 'Invalid CSRF token'})
    })

    it('rejects a URL-encoded body that cannot be read', async () => {
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.error(new Error('request stream failed'))
            },
        })
        const response = await protectedRequest(
            new Request('https://example.test/protected', {
                method: 'POST',
                body,
                headers: {
                    cookie: SESSION_COOKIE,
                    'content-type': 'application/x-www-form-urlencoded',
                },
            }),
        )

        expect(response.status).toBe(403)
    })

    it('rejects a multipart file in the CSRF token field', async () => {
        const form = new FormData()
        form.set('csrfToken', new File(['not a token'], 'token.txt'))

        const response = await protectedRequest(
            new Request('https://example.test/protected', {
                method: 'POST',
                body: form,
                headers: {cookie: SESSION_COOKIE},
            }),
        )

        expect(response.status).toBe(403)
    })
})

async function protectedRequest(request: Request): Promise<Response> {
    const app = new Hono<{Bindings: Bindings}>()
    app.use('*', csrfProtection)
    app.post('/protected', (c) => c.text('ok'))
    return app.request(request)
}

async function publicAuthRequest(headers: Record<string, string>): Promise<Response> {
    const app = new Hono<{Bindings: Bindings}>()
    app.use('*', csrfProtection)
    app.post('/login', (c) => c.body(null, 204))
    return app.request('https://example.test/login', {
        method: 'POST',
        headers: {
            cookie: `myoc_pre_auth_csrf=${PRE_AUTH_CSRF_TOKEN}`,
            'x-csrf-token': PRE_AUTH_CSRF_TOKEN,
            ...headers,
        },
    })
}
