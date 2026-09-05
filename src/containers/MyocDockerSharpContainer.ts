import {Container} from '@cloudflare/containers'

type MyocDockerSharpContainerEnv = {
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

MyocDockerSharpContainer.outbound = async (request) => fetch(request)
