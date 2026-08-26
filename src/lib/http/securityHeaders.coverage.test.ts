import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {securityHeaders} from './securityHeaders'

function createApp(): Hono<{Bindings: Bindings}> {
    const app = new Hono<{Bindings: Bindings}>()
    app.use('*', securityHeaders)
    app.get('/html', (c) =>
        c.html(
            `<!doctype html><script>window.one = 1</script><script type="module">window.two = 2</script><script type=" text/javascript ">window.three = 3</script><script type="application/javascript">window.four = 4</script><script type="application/ecmascript">window.five = 5</script><script type="text/ecmascript">window.six = 6</script><script type="application/ld+json">{"name":"test"}</script><script type="text/plain">not code</script>`,
        ),
    )
    app.get('/text', (c) => c.text('plain response'))
    app.get('/empty', () => new Response(null))

    return app
}

function request(app: Hono<{Bindings: Bindings}>, path: string, url: string, bindings: Record<string, unknown> = {}): Promise<Response> {
    return Promise.resolve(app.request(`${url}${path}`, {}, createWorkerEnv(bindings as Partial<Bindings>)))
}

describe('securityHeaders middleware coverage', () => {
    it('protects HTML and allows configured media and feed origins', async () => {
        const app = createApp()
        const response = await request(app, '/html', 'https://example.test', {
            MEDIA_PUBLIC_BASE_URL: 'https://media.example.test/assets/',
            RECENT_FEED_PUBLIC_BASE_URL: 'https://feed.example.test/recent',
        })
        const body = await response.text()
        const policy = response.headers.get('Content-Security-Policy') ?? ''
        const nonce = body.match(/nonce="([A-Za-z0-9+/]{22}==)"/)?.[1]

        expect(response.status).toBe(200)
        expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains')
        expect(response.headers.get('Content-Length')).toBeNull()
        expect(policy).toContain("connect-src 'self' https://media.example.test https://feed.example.test")
        expect(policy).toContain("img-src 'self' data: blob: https://media.example.test https://file.toyhou.se https://f2.toyhou.se")
        expect(policy).toContain("media-src 'self' https://media.example.test")
        expect(nonce).toBeDefined()

        for (const type of ['', 'module', ' text/javascript ', 'application/javascript', 'application/ecmascript', 'text/ecmascript']) {
            const typeSelector = type ? `type="${type}"` : ''
            const script = typeSelector ? `<script ${typeSelector}>` : '<script>'
            expect(body).toContain(`${script.slice(0, -1)} nonce="${nonce}">`)
        }
        expect(body).toContain('<script type="application/ld+json">')
        expect(body).toContain('<script type="text/plain">')
    })

    it('uses the locked-down policy for non-HTML HTTP responses', async () => {
        const app = createApp()
        const response = await request(app, '/text', 'http://example.test', {
            MEDIA_PUBLIC_BASE_URL: 'not a URL',
            RECENT_FEED_PUBLIC_BASE_URL: 'ftp://feed.example.test',
        })

        expect(response.headers.get('Strict-Transport-Security')).toBeNull()
        expect(response.headers.get('Content-Security-Policy')).toBe(
            "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; sandbox",
        )
        expect(await response.text()).toBe('plain response')
    })

    it('treats responses without a content type as non-HTML', async () => {
        const response = await request(createApp(), '/empty', 'https://example.test', {
            MEDIA_PUBLIC_BASE_URL: 'https://media.example.test',
        })

        expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
        expect(await response.text()).toBe('')
    })

    it('omits invalid and absent optional origins from the HTML policy', async () => {
        const app = createApp()
        const response = await request(app, '/html', 'https://example.test', {
            MEDIA_PUBLIC_BASE_URL: 'http://insecure.example.test/media',
            RECENT_FEED_PUBLIC_BASE_URL: undefined,
        })
        const policy = response.headers.get('Content-Security-Policy') ?? ''

        expect(policy).toContain("connect-src 'self'")
        expect(policy).not.toContain('insecure.example.test')
        expect(policy).not.toContain('undefined')
        expect(policy).toContain("img-src 'self' data: blob: https://file.toyhou.se https://f2.toyhou.se")
        expect(policy).toContain("media-src 'self'")
    })
})
