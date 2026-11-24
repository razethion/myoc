import {Container} from '@cloudflare/containers'

type MyocDockerSharpContainerEnv = {
    MEDIA_PUBLIC_BASE_URL?: string
    PREVIEW_PROCESSOR_TOKEN: string
}

type EmptyContainerProps = Record<string | number | symbol, never>

export class MyocDockerSharpContainer extends Container<MyocDockerSharpContainerEnv> {
    private activeImageRequests = 0
    override defaultPort = 8080
    override enableInternet = false
    override allowedHosts = ['m.myoc.art', 'm.dev.myoc.art']
    override interceptHttps = true
    override pingEndpoint = 'localhost/health'
    override requiredPorts = [8080]
    override sleepAfter = '10s'

    constructor(ctx: DurableObjectState<EmptyContainerProps>, env: MyocDockerSharpContainerEnv) {
        super(ctx, env)
        this.envVars = {
            BLUR_AVIF_QUALITY: '60',
            BLUR_MAX_WIDTH: '960',
            BLUR_SIGMA: '250',
            BLUR_SOURCE_MAX_BYTES: String(16 * 1024 * 1024),
            HEIGHT_CHART_AVIF_QUALITY: '75',
            HEIGHT_CHART_MAX_LONG_EDGE: '1600',
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_AVIF_QUALITY: '60',
            PREVIEW_MAX_LONG_EDGE: '1600',
            PREVIEW_PROCESSOR_TOKEN: env.PREVIEW_PROCESSOR_TOKEN,
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: String(200_000_000),
            SQUARE_IMAGE_AVIF_QUALITY: '75',
            SQUARE_IMAGE_SIZE: '512',
            SQUARE_SOURCE_MAX_BYTES: String(3 * 1024 * 1024),
        }

        // Preview regeneration passes media URLs to the container. The
        // container fetches them through the allowedHosts gate. Preview
        // deployments serve media from a bucket domain, so the deployment's
        // own media host must pass that gate too.
        const mediaHost = publicMediaHost(env.MEDIA_PUBLIC_BASE_URL)

        if (mediaHost && !this.allowedHosts.includes(mediaHost)) {
            this.allowedHosts = [...this.allowedHosts, mediaHost]
        }
    }

    override async fetch(request: Request): Promise<Response> {
        if (this.activeImageRequests >= 4) {
            return new Response('Preview container is busy', {
                status: 429,
                headers: {'retry-after': '1'},
            })
        }

        this.activeImageRequests += 1

        try {
            return await super.fetch(request)
        } finally {
            this.activeImageRequests -= 1
        }
    }
}

/**
 * Returns the host name of a base URL. Returns null when the value is
 * missing or invalid.
 */
function publicMediaHost(value: string | undefined): string | null {
    if (!value) {
        return null
    }

    try {
        return new URL(value).host
    } catch {
        return null
    }
}

MyocDockerSharpContainer.outbound = async (request) => fetch(request)
