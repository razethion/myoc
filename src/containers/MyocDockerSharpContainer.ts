import {Container} from '@cloudflare/containers'

type MyocDockerSharpContainerEnv = {
    PREVIEW_PROCESSOR_TOKEN: string
}

type EmptyContainerProps = Record<string | number | symbol, never>

export class MyocDockerSharpContainer extends Container<MyocDockerSharpContainerEnv> {
    override defaultPort = 8080
    override enableInternet = false
    override allowedHosts = ['m.myoc.art', 'm.dev.myoc.art']
    override interceptHttps = true
    override pingEndpoint = 'localhost/health'
    override requiredPorts = [8080]
    override sleepAfter = '1m'

    constructor(ctx: DurableObjectState<EmptyContainerProps>, env: MyocDockerSharpContainerEnv) {
        super(ctx, env)
        this.envVars = {
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_AVIF_QUALITY: '60',
            PREVIEW_MAX_LONG_EDGE: '1600',
            PREVIEW_PROCESSOR_TOKEN: env.PREVIEW_PROCESSOR_TOKEN,
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: String(200_000_000),
        }
    }
}

MyocDockerSharpContainer.outbound = async (request) => fetch(request)
