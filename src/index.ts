import {Hono} from 'hono'
import {cleanupStaleR2Media} from './lib/media/r2Cleanup'
import {apiRoutes} from './routes/api'
import {pageRoutes, renderNotFoundPage} from './routes/pages'
import type {Bindings} from './types/bindings'

const app = new Hono<{Bindings: Bindings}>()

app.route('/api', apiRoutes)
app.route('/', pageRoutes)

app.notFound(async (c) => renderNotFoundPage(c))

const worker = app as typeof app & {
    scheduled: (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => void
}

worker.scheduled = (_event, env, ctx) => {
    ctx.waitUntil(cleanupStaleR2Media(env))
}

// Cloudflare Workers loads this default export from wrangler.jsonc.
// noinspection JSUnusedGlobalSymbols
export default worker
