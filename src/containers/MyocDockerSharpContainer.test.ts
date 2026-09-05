import {afterEach, describe, expect, it, vi} from 'vitest'
import {MyocDockerSharpContainer} from './MyocDockerSharpContainer'

vi.mock('@cloudflare/containers', () => {
    let outboundHandler: ((request: Request) => Promise<Response>) | undefined

    class Container<TEnv> {
        static get outbound(): ((request: Request) => Promise<Response>) | undefined {
            return outboundHandler
        }

        static set outbound(handler: (request: Request) => Promise<Response>) {
            outboundHandler = handler
        }

        constructor(
            readonly ctx: unknown,
            readonly env: TEnv,
        ) {}

        async fetch(request: Request): Promise<Response> {
            return await fetch(request)
        }
    }

    return {Container}
})

describe('MyocDockerSharpContainer', () => {
    afterEach(() => {
        vi.useRealTimers()
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('configures the preview processor container runtime and environment', () => {
        const container = new MyocDockerSharpContainer({} as DurableObjectState<Record<never, never>>, {
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
        })

        expect(container.defaultPort).toBe(8080)
        expect(container.enableInternet).toBe(false)
        expect(container.allowedHosts).toEqual(['m.myoc.art', 'm.dev.myoc.art'])
        expect(container.interceptHttps).toBe(true)
        expect(container.pingEndpoint).toBe('localhost/health')
        expect(container.requiredPorts).toEqual([8080])
        expect(container.sleepAfter).toBe('10s')
        expect(container.envVars).toEqual({
            BLUR_AVIF_QUALITY: '60',
            BLUR_MAX_WIDTH: '960',
            BLUR_SIGMA: '250',
            BLUR_SOURCE_MAX_BYTES: String(16 * 1024 * 1024),
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_AVIF_QUALITY: '60',
            PREVIEW_MAX_LONG_EDGE: '1600',
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: '200000000',
            SQUARE_IMAGE_AVIF_QUALITY: '75',
            SQUARE_IMAGE_SIZE: '512',
            SQUARE_SOURCE_MAX_BYTES: String(3 * 1024 * 1024),
        })
    })

    it('limits one container to four active image requests', async () => {
        let release = () => {}
        const pending = new Promise<void>((resolve) => {
            release = resolve
        })
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => {
                await pending
                return new Response('ok')
            }),
        )
        const container = new MyocDockerSharpContainer({} as DurableObjectState<Record<never, never>>, {
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
        })
        const active = Array.from({length: 4}, async (_, index) => container.fetch(new Request(`https://container/image-${index}`)))

        const rejected = await container.fetch(new Request('https://container/image-5'))
        expect(rejected.status).toBe(429)
        expect(rejected.headers.get('retry-after')).toBe('1')

        release()
        await expect(Promise.all(active)).resolves.toHaveLength(4)
        await expect(container.fetch(new Request('https://container/image-6'))).resolves.toHaveProperty('status', 200)
    })

    it.each(['m.myoc.art', 'm.dev.myoc.art'])(
        'allows outbound requests to the %s media origin through the Worker fetch implementation',
        async (host) => {
            const request = new Request(`https://${host}/characters/owner/character/media/image.png`)
            const fetcher = vi.fn(async () => new Response('ok', {status: 202}))
            vi.stubGlobal('fetch', fetcher)

            const outbound = MyocDockerSharpContainer.outbound as (request: Request) => Promise<Response>
            const response = await outbound(request)

            expect(response.status).toBe(202)
            expect(fetcher).toHaveBeenCalledWith(request)
        },
    )
})
