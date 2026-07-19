import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {MyocDockerSharpContainer} from './MyocDockerSharpContainer'

const containerMock = vi.hoisted(() => ({
    nextState: {status: 'stopped'},
    destroy: vi.fn(),
    getState: vi.fn(),
    stop: vi.fn(),
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

        constructor(
            readonly ctx: unknown,
            readonly env: TEnv,
        ) {
            Object.assign(this, {
                destroy: containerMock.destroy,
                getState: containerMock.getState,
                stop: containerMock.stop,
            })
        }
    }

    return {Container}
})

describe('MyocDockerSharpContainer', () => {
    beforeEach(() => {
        containerMock.nextState = {status: 'stopped'}
        containerMock.destroy.mockReset()
        containerMock.destroy.mockResolvedValue(undefined)
        containerMock.getState.mockReset()
        containerMock.getState.mockImplementation(async () => containerMock.nextState)
        containerMock.stop.mockReset()
        containerMock.stop.mockResolvedValue(undefined)
    })

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

        expect(containerMock.stop).toHaveBeenCalledTimes(1)
        expect(containerMock.getState).toHaveBeenCalledTimes(1)
        expect(containerMock.destroy).toHaveBeenCalledTimes(1)
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

        expect(containerMock.stop).toHaveBeenCalledTimes(1)
        expect(containerMock.getState).toHaveBeenCalledTimes(1)
        expect(containerMock.destroy).not.toHaveBeenCalled()
    })

    it.each([
        'm.myoc.art',
        'm.dev.myoc.art',
    ])('allows outbound requests to the %s media origin through the Worker fetch implementation', async (host) => {
        const request = new Request(`https://${host}/characters/owner/character/media/image.png`)
        const fetcher = vi.fn(async () => new Response('ok', {status: 202}))
        vi.stubGlobal('fetch', fetcher)

        const outbound = MyocDockerSharpContainer.outbound as (request: Request) => Promise<Response>
        const response = await outbound(request)

        expect(response.status).toBe(202)
        expect(fetcher).toHaveBeenCalledWith(request)
    })
})
