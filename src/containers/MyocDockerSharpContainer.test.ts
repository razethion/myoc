import {afterEach, describe, expect, it, vi} from 'vitest'
import {MyocDockerSharpContainer} from './MyocDockerSharpContainer'

const containerMock = vi.hoisted(() => ({
    nextState: {status: 'stopped'},
}))

vi.mock('@cloudflare/containers', () => {
    let outboundHandler: ((request: Request) => Promise<Response>) | undefined

    class Container<TEnv> {
        static get outbound(): ((request: Request) => Promise<Response>) | undefined {
            return outboundHandler
        }

        static set outbound(handler: (request: Request) => Promise<Response>) {
            outboundHandler = handler
        }

        envVars: Record<string, string> = {}
        stop = vi.fn()
        destroy = vi.fn()
        getState = vi.fn(async () => containerMock.nextState)

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
        containerMock.nextState = {status: 'stopped'}
    })

    it('configures the preview processor container runtime and environment', () => {
        const container = new MyocDockerSharpContainer({} as DurableObjectState<Record<never, never>>, {
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
        })

        expect(container.defaultPort).toBe(8080)
        expect(container.enableInternet).toBe(false)
        expect(container.allowedHosts).toEqual(['m.myoc.art'])
        expect(container.interceptHttps).toBe(true)
        expect(container.pingEndpoint).toBe('localhost/health')
        expect(container.requiredPorts).toEqual([8080])
        expect(container.sleepAfter).toBe('10s')
        expect(container.envVars).toEqual({
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: '200000000',
        })
    })

    it.each([
        'running',
        'healthy',
        'stopping',
    ] as const)('destroys the preview container when it remains %s after an idle stop signal', async (status) => {
        vi.useFakeTimers()
        containerMock.nextState = {status}
        const container = new MyocDockerSharpContainer({} as DurableObjectState<Record<never, never>>, {
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
        })
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        const activityExpired = container.onActivityExpired()
        await vi.advanceTimersByTimeAsync(1_000)
        await activityExpired

        expect(container.stop).toHaveBeenCalledTimes(1)
        expect(container.getState).toHaveBeenCalledTimes(1)
        expect(container.destroy).toHaveBeenCalledTimes(1)
        expect(log).toHaveBeenCalledWith('Preview container idle, signalling stop')
        expect(warn).toHaveBeenCalledWith('Preview container ignored stop signal, destroying instance')
    })

    it('does not destroy the preview container once the idle stop signal succeeds', async () => {
        vi.useFakeTimers()
        containerMock.nextState = {status: 'stopped'}
        const container = new MyocDockerSharpContainer({} as DurableObjectState<Record<never, never>>, {
            PREVIEW_PROCESSOR_TOKEN: 'preview-token',
        })
        vi.spyOn(console, 'log').mockImplementation(() => undefined)

        const activityExpired = container.onActivityExpired()
        await vi.advanceTimersByTimeAsync(1_000)
        await activityExpired

        expect(container.stop).toHaveBeenCalledTimes(1)
        expect(container.getState).toHaveBeenCalledTimes(1)
        expect(container.destroy).not.toHaveBeenCalled()
    })

    it('allows outbound requests to the media origin through the Worker fetch implementation', async () => {
        const request = new Request('https://m.myoc.art/characters/owner/character/media/image.png')
        const fetcher = vi.fn(async () => new Response('ok', {status: 202}))
        vi.stubGlobal('fetch', fetcher)

        const outbound = MyocDockerSharpContainer.outbound as (request: Request) => Promise<Response>
        const response = await outbound(request)

        expect(response.status).toBe(202)
        expect(fetcher).toHaveBeenCalledWith(request)
    })
})
