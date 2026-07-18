import {Container} from '@cloudflare/containers'

type MyocDockerSharpContainerEnv = {
    PREVIEW_PROCESSOR_TOKEN: string
}

type EmptyContainerProps = Record<string | number | symbol, never>

export class MyocDockerSharpContainer extends Container<MyocDockerSharpContainerEnv> {
    override defaultPort = 8080
    override enableInternet = false
    override allowedHosts = ['m.myoc.art']
    override interceptHttps = true
    override pingEndpoint = 'localhost/health'
    override requiredPorts = [8080]
    override sleepAfter = '10s'

    constructor(ctx: DurableObjectState<EmptyContainerProps>, env: MyocDockerSharpContainerEnv) {
        super(ctx, env)
        this.envVars = {
            NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
            PREVIEW_PROCESSOR_TOKEN: env.PREVIEW_PROCESSOR_TOKEN,
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
            SOURCE_LIMIT_INPUT_PIXELS: String(200_000_000),
        }
    }

    override async onActivityExpired(): Promise<void> {
        console.log('Preview container idle, signalling stop')
        await this.stop()
        await sleep(1_000)

        const state = await this.getState()

        if (state.status === 'running' || state.status === 'healthy' || state.status === 'stopping') {
            console.warn('Preview container ignored stop signal, destroying instance')
            await this.destroy()
        }
    }
}

MyocDockerSharpContainer.outbound = async (request) => fetch(request)

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
