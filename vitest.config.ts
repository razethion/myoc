import {cloudflareTest} from '@cloudflare/vitest-pool-workers'
import {defineConfig} from 'vitest/config'

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
    test: {
        coverage: {
            exclude: ['src/test/**'],
            provider: 'istanbul',
        },
        include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
})
