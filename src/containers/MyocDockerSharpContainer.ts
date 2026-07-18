import {Container} from '@cloudflare/containers'

type MyocDockerSharpContainerEnv = {
    PREVIEW_PROCESSOR_TOKEN: string
}

type EmptyContainerProps = Record<string | number | symbol, never>

export class MyocDockerSharpContainer extends Container<MyocDockerSharpContainerEnv> {
    override defaultPort = 8080
    override enableInternet = true
    override pingEndpoint = 'localhost/health'
    override requiredPorts = [8080]
    override sleepAfter = '10s'

    constructor(ctx: DurableObjectState<EmptyContainerProps>, env: MyocDockerSharpContainerEnv) {
        super(ctx, env)
        this.envVars = {
            PREVIEW_PROCESSOR_TOKEN: env.PREVIEW_PROCESSOR_TOKEN,
            SOURCE_IMAGE_MAX_BYTES: String(256 * 1024 * 1024),
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

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
