import {cloudflareTest, readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'

const runtimeProcess = (globalThis as typeof globalThis & {process?: {env: Record<string, string | undefined>}}).process
if (runtimeProcess) runtimeProcess.env.WRANGLER_LOG ??= 'error'

export default defineConfig({
    plugins: [
        cloudflareTest(async () => ({
            main: './src/index.ts',
            miniflare: {
                bindings: {
                    TEST_MIGRATIONS: await readD1Migrations('./migrations'),
                },
            },
            remoteBindings: false,
            wrangler: {
                configPath: './wrangler.jsonc',
            },
        })),
    ],
    logLevel: 'error',
    test: {
        coverage: {
            exclude: ['src/test/**'],
            provider: 'istanbul',
        },
        include: ['src/**/*.test.mjs', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
        reporters: ['dot'],
        silent: 'passed-only',
    },
})
