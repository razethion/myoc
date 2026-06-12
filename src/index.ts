import { Hono } from 'hono'
import { apiRoutes } from './routes/api'
import { pageRoutes, renderNotFoundPage } from './routes/pages'
import type { Bindings } from './types/bindings'

const app = new Hono<{ Bindings: Bindings }>()

app.route('/api', apiRoutes)
app.route('/', pageRoutes)

app.notFound(async (c) => renderNotFoundPage(c))

// Cloudflare Workers loads this default export from wrangler.jsonc.
// noinspection JSUnusedGlobalSymbols
export default app
