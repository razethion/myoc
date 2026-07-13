import {Hono} from 'hono'
import {runAdminJob} from './lib/admin/jobs'
import {apiRoutes} from './routes/api'
import {pageRoutes, renderNotFoundPage} from './routes/pages'
import type {Bindings} from './types/bindings'

const D1_BACKUP_CRON = '0 8 * * *'
const R2_MEDIA_CLEANUP_CRON = '0 9 * * *'
const LEADERBOARD_REFRESH_CRON = '0 10 * * *'

const app = new Hono<{Bindings: Bindings}>()

app.route('/api', apiRoutes)
app.route('/', pageRoutes)

app.notFound(async (c) => renderNotFoundPage(c))

const worker = app as typeof app & {
    scheduled: (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => void
}

worker.scheduled = (event, env, ctx) => {
    if (event.cron === D1_BACKUP_CRON) {
        ctx.waitUntil(
            runAdminJob(env, 'd1-backup', {
                cron: event.cron,
                triggerSource: 'cron',
            }),
        )
        return
    }

    if (event.cron === R2_MEDIA_CLEANUP_CRON) {
        ctx.waitUntil(
            runAdminJob(env, 'r2-media-cleanup', {
                cron: event.cron,
                triggerSource: 'cron',
            }),
        )
        return
    }

    if (event.cron === LEADERBOARD_REFRESH_CRON) {
        ctx.waitUntil(
            runAdminJob(env, 'leaderboard-refresh', {
                cron: event.cron,
                triggerSource: 'cron',
            }),
        )
        return
    }

    console.warn('Unhandled scheduled cron trigger', {
        cron: event.cron,
    })
}

// Cloudflare Workers loads this default export from wrangler.jsonc.
// noinspection JSUnusedGlobalSymbols
export default worker
