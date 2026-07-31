import {cloudflareTest} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'

const runtimeProcess = (globalThis as typeof globalThis & {process?: {env: Record<string, string | undefined>}}).process
if (runtimeProcess) runtimeProcess.env.WRANGLER_LOG ??= 'error'

export default defineConfig({
    plugins: [
        cloudflareTest({
            main: './src/index.ts',
            remoteBindings: false,
            wrangler: {
                configPath: './wrangler.jsonc',
            },
        }),
    ],
    logLevel: 'error',
    test: {
        coverage: {
            exclude: ['src/test/**'],
            provider: 'istanbul',
        },
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
        reporters: ['dot'],
        silent: 'passed-only',
    },
})
