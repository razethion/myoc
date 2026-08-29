import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import type {Bindings} from '../../types/bindings'
import {csrfProtection} from './csrf'

const SESSION_COOKIE = 'myoc_session=test-session'

describe('csrfProtection', () => {
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
    return await app.request(request)
}
