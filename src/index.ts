import { Hono } from 'hono'
import { pageRoutes } from './routes/pages'

const app = new Hono()

app.route('/', pageRoutes)

// Cloudflare Workers loads this default export from wrangler.jsonc.
// noinspection JSUnusedGlobalSymbols
export default app
