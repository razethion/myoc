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
        expect(container.sleepAfter).toBe('1m')
        expect(container.envVars).toEqual({
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_AVIF_QUALITY: '60',
            PREVIEW_MAX_LONG_EDGE: '1600',
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: '200000000',
        })
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
