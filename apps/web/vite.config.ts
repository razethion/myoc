import adapter from '@sveltejs/adapter-cloudflare'
import {sveltekit} from '@sveltejs/kit/vite'
import tailwindcss from '@tailwindcss/vite'
import {defineConfig} from 'vite'

export default defineConfig({
    cacheDir: '../../node_modules/.vite/apps-web',
    server: {
        host: '127.0.0.1',
        port: 5173,
        strictPort: true,
    },
    plugins: [
        tailwindcss(),
        sveltekit({
            adapter: adapter(),
            compilerOptions: {
                runes: ({filename}) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true),
            },
            csp: {
                mode: 'nonce',
                directives: {
                    'base-uri': ['self'],
                    'connect-src': ['self', 'https://m.myoc.art', 'https://m.dev.myoc.art', 'https://feed-data.myoc.art'],
                    'default-src': ['self'],
                    'font-src': ['self', 'data:'],
                    'form-action': ['self'],
                    'frame-ancestors': ['none'],
                    'frame-src': ['none'],
                    'img-src': ['self', 'data:', 'blob:', 'https://m.myoc.art', 'https://m.dev.myoc.art'],
                    'manifest-src': ['self'],
                    'media-src': ['self', 'https://m.myoc.art', 'https://m.dev.myoc.art'],
                    'object-src': ['none'],
                    'script-src': ['self'],
                    'script-src-attr': ['none'],
                    'style-src': ['self', 'unsafe-inline'],
                    'style-src-attr': ['unsafe-inline'],
                    'style-src-elem': ['self', 'unsafe-inline'],
                    'worker-src': ['none'],
                },
            },
        }),
    ],
})
