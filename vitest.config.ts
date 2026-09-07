import {cloudflareTest, readD1Migrations} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'

const runtimeProcess = (globalThis as typeof globalThis & {process?: {env: Record<string, string | undefined>}}).process
if (runtimeProcess) runtimeProcess.env.WRANGLER_LOG ??= 'error'

export default defineConfig({
    plugins: [
        cloudflareTest(async () => ({
            main: './apps/backend/src/index.ts',
            miniflare: {
                bindings: {
                    TEST_MIGRATIONS: await readD1Migrations('./apps/backend/migrations'),
                },
            },
            remoteBindings: false,
            wrangler: {
                configPath: './apps/backend/wrangler.jsonc',
            },
        })),
    ],
    logLevel: 'error',
    test: {
        coverage: {
            exclude: ['apps/backend/src/test/**'],
            provider: 'istanbul',
        },
        include: [
            'scripts/**/*.test.mjs',
            'apps/backend/src/**/*.test.mjs',
            'apps/backend/src/**/*.test.ts',
            'apps/backend/src/**/*.test.tsx',
        ],
        reporters: ['dot'],
        silent: 'passed-only',
    },
})
