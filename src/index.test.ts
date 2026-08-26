import {beforeEach, describe, expect, it, vi} from 'vitest'
import worker from './index'
import {runAdminJob} from './lib/admin/jobs'
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
