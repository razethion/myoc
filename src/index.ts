import { Hono } from 'hono'
import { apiRoutes } from './routes/api'
import { pageRoutes } from './routes/pages'
import type { Bindings } from './types/bindings'

const app = new Hono<{ Bindings: Bindings }>()

app.route('/api', apiRoutes)
app.route('/', pageRoutes)

// Cloudflare Workers loads this default export from wrangler.jsonc.
// noinspection JSUnusedGlobalSymbols
export default app
