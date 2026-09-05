import {Hono} from 'hono'

export {ContainerProxy} from '@cloudflare/containers'

import {consumeImageProcessingDeadLetterQueue, consumeMediaPreviewDeadLetterQueue} from './lib/admin/deadLetterQueue'
import {runAdminJob} from './lib/admin/jobs'
import {consumeMediaPreviewRegenerationQueue} from './lib/admin/mediaPreviewQueue'
import {securityHeaders} from './lib/http/securityHeaders'
import {consumeImageProcessingQueue, reconcileImageUploads} from './lib/media/imageUploadJobs'
import {cleanupRecentFeed} from './lib/recentMedia/cleanup'
import {publishRecentFeed} from './lib/recentMedia/publisher'
import {apiRoutes} from './routes/api'
import {pageRoutes, renderNotFoundPage} from './routes/pages'
import type {Bindings} from './types/bindings'

export {MyocDockerSharpContainer} from './containers/MyocDockerSharpContainer'
export {RegenerateMediaPreviewsWorkflow} from './workflows/RegenerateMediaPreviewsWorkflow'

const D1_BACKUP_CRON = '0 8 * * *'
const R2_MEDIA_CLEANUP_CRON = '0 9 * * *'
const LEADERBOARD_REFRESH_CRON = '0 10 * * *'
const RECENT_FEED_RECOVERY_CRON = '* * * * *'
const RECENT_FEED_CLEANUP_CRON = '30 9 * * *'

const app = new Hono<{Bindings: Bindings}>()

app.use('*', securityHeaders)
app.route('/api', apiRoutes)
app.route('/', pageRoutes)

app.notFound(async (c) => renderNotFoundPage(c))

const worker = app as typeof app & {
    queue: (batch: MessageBatch, env: Bindings, ctx: ExecutionContext) => Promise<void>
    scheduled: (event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) => void
}

worker.queue = async (batch, env) => {
    if (batch.queue === env.IMAGE_PROCESSING_DLQ_NAME) {
        await consumeImageProcessingDeadLetterQueue(batch, env)
        return
    }

    if (batch.queue === env.MEDIA_PREVIEW_REGENERATION_DLQ_NAME) {
        await consumeMediaPreviewDeadLetterQueue(batch, env)
        return
    }

    if (batch.queue.includes('image-processing')) {
        await consumeImageProcessingQueue(batch, env)
        return
    }

    await consumeMediaPreviewRegenerationQueue(batch, env)
}

worker.scheduled = (event, env, ctx) => {
    if (event.cron === RECENT_FEED_RECOVERY_CRON) {
        ctx.waitUntil(Promise.all([publishRecentFeed(env), reconcileImageUploads(env)]).then(() => undefined))
        return
    }

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

    if (event.cron === RECENT_FEED_CLEANUP_CRON) {
        ctx.waitUntil(cleanupRecentFeed(env))
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
