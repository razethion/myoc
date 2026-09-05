import {beforeEach, describe, expect, it, vi} from 'vitest'
import worker from './index'
import {consumeImageProcessingDeadLetterQueue} from './lib/admin/deadLetterQueue'
import {runAdminJob} from './lib/admin/jobs'
import {consumeMediaPreviewRegenerationMessage} from './lib/admin/mediaPreviewQueue'
import {consumeThumbnailRegenerationMessage} from './lib/admin/thumbnailRegeneration'
import {consumeImageUploadProcessingMessage, reconcileImageUploads} from './lib/media/imageUploadJobs'
import {cleanupRecentFeed} from './lib/recentMedia/cleanup'
import {publishRecentFeed} from './lib/recentMedia/publisher'
import {createWorkerEnv} from './test/workerBindings'

vi.mock('./lib/admin/jobs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./lib/admin/jobs')>()

    return {
        ...actual,
        runAdminJob: vi.fn(async () => ({
            jobName: 'd1-backup',
            runId: 'run-1',
            status: 'success',
        })),
    }
})

vi.mock('./lib/recentMedia/publisher', () => ({
    publishRecentFeed: vi.fn(async () => ({status: 'disabled'})),
}))

vi.mock('./lib/recentMedia/cleanup', () => ({
    cleanupRecentFeed: vi.fn(async () => ({
        retainedGenerations: 0,
        deletedGenerations: 0,
        deletedObjects: 0,
    })),
}))

vi.mock('./lib/media/imageUploadJobs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./lib/media/imageUploadJobs')>()
    return {
        ...actual,
        consumeImageUploadProcessingMessage: vi.fn(async () => undefined),
        reconcileImageUploads: vi.fn(async () => undefined),
    }
})

vi.mock('./lib/admin/mediaPreviewQueue', () => ({
    consumeMediaPreviewRegenerationMessage: vi.fn(async () => undefined),
}))

vi.mock('./lib/admin/thumbnailRegeneration', () => ({
    consumeThumbnailRegenerationMessage: vi.fn(async () => undefined),
}))

vi.mock('./lib/admin/deadLetterQueue', () => ({
    consumeImageProcessingDeadLetterQueue: vi.fn(async () => undefined),
}))

const env = createWorkerEnv()

describe('worker scheduled handler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it.each([
        ['* * * * *', 'recent-feed'],
        ['0 8 * * *', 'd1-backup'],
        ['0 9 * * *', 'r2-media-cleanup'],
        ['30 9 * * *', 'recent-feed-cleanup'],
        ['0 10 * * *', 'leaderboard-refresh'],
    ] as const)('runs the %s cron as %s', async (cron, jobName) => {
        const {ctx, waitUntilPromises} = createExecutionContext()

        worker.scheduled({cron} as ScheduledEvent, env, ctx)

        if (jobName === 'recent-feed') {
            expect(publishRecentFeed).toHaveBeenCalledWith(env)
            expect(reconcileImageUploads).toHaveBeenCalledWith(env)
            expect(runAdminJob).not.toHaveBeenCalled()
        } else if (jobName === 'recent-feed-cleanup') {
            expect(cleanupRecentFeed).toHaveBeenCalledWith(env)
            expect(runAdminJob).not.toHaveBeenCalled()
        } else {
            expect(runAdminJob).toHaveBeenCalledWith(env, jobName, {
                cron,
                triggerSource: 'cron',
            })
        }
        expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
        await Promise.all(waitUntilPromises)
    })

    it('warns without scheduling work for unknown cron triggers', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const {ctx} = createExecutionContext()

        try {
            worker.scheduled({cron: '15 4 * * *'} as ScheduledEvent, env, ctx)

            expect(runAdminJob).not.toHaveBeenCalled()
            expect(ctx.waitUntil).not.toHaveBeenCalled()
            expect(warn).toHaveBeenCalledWith('Unhandled scheduled cron trigger', {
                cron: '15 4 * * *',
            })
        } finally {
            warn.mockRestore()
        }
    })
})

describe('worker queue handler', () => {
    it('acknowledges malformed work so it cannot block the queue', async () => {
        const ack = vi.fn()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const batch = {
            queue: 'myoc-image-processing',
            messages: [
                {
                    ack,
                    attempts: 1,
                    body: {version: 2},
                    id: 'invalid-preview-task',
                    retry: vi.fn(),
                    timestamp: new Date(),
                },
            ],
        } as unknown as MessageBatch

        try {
            await worker.queue(batch, env, {} as ExecutionContext)
            expect(ack).toHaveBeenCalledOnce()
        } finally {
            error.mockRestore()
        }
    })

    it.each([
        [{version: 1, kind: 'upload', taskId: '00000000-0000-4000-8000-000000000001'}, consumeImageUploadProcessingMessage],
        [{version: 1, kind: 'media-regeneration', taskId: 'preview-task', runId: 'preview-run'}, consumeMediaPreviewRegenerationMessage],
        [
            {version: 1, kind: 'thumbnail-regeneration', taskId: 'thumbnail-task', runId: 'thumbnail-run'},
            consumeThumbnailRegenerationMessage,
        ],
    ] as const)('routes $kind work by its validated message kind', async (body, consumer) => {
        const message = {
            ack: vi.fn(),
            attempts: 1,
            body,
            id: 'message-1',
            retry: vi.fn(),
            timestamp: new Date(),
        } as unknown as Message
        const batch = {
            queue: 'myoc-image-processing',
            messages: [message],
        } as unknown as MessageBatch

        await worker.queue(batch, env, {} as ExecutionContext)

        expect(consumer).toHaveBeenCalledWith(message, body, env, expect.any(Function))
    })

    it('routes the shared dead-letter queue to its consumer', async () => {
        const batch = {
            queue: env.IMAGE_PROCESSING_DLQ_NAME,
            messages: [],
        } as unknown as MessageBatch

        await worker.queue(batch, env, {} as ExecutionContext)

        expect(consumeImageProcessingDeadLetterQueue).toHaveBeenCalledWith(batch, env)
    })
})

function createExecutionContext(): {
    ctx: ExecutionContext
    waitUntilPromises: Array<Promise<unknown>>
} {
    const waitUntilPromises: Array<Promise<unknown>> = []
    const ctx = {
        waitUntil: vi.fn((promise: Promise<unknown>) => {
            waitUntilPromises.push(promise)
        }),
    } as unknown as ExecutionContext

    return {ctx, waitUntilPromises}
}
