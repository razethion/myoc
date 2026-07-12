import {beforeEach, describe, expect, it, vi} from 'vitest'
import worker from './index'
import {runAdminJob} from './lib/admin/jobs'
import type {Bindings} from './types/bindings'

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

const env = {
    DB: {},
    DB_BACKUP_BUCKET: {},
    MEDIA_BUCKET: {},
} as Bindings

describe('worker scheduled handler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it.each([
        ['0 8 * * *', 'd1-backup'],
        ['0 9 * * *', 'r2-media-cleanup'],
    ] as const)('runs the %s cron as %s', async (cron, jobName) => {
        const {ctx, waitUntilPromises} = createExecutionContext()

        worker.scheduled({cron} as ScheduledEvent, env, ctx)

        expect(runAdminJob).toHaveBeenCalledWith(env, jobName, {
            cron,
            triggerSource: 'cron',
        })
        expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
        await Promise.all(waitUntilPromises)
    })

    it('warns without scheduling work for unknown cron triggers', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const {ctx} = createExecutionContext()

        try {
            worker.scheduled({cron: '* * * * *'} as ScheduledEvent, env, ctx)

            expect(runAdminJob).not.toHaveBeenCalled()
            expect(ctx.waitUntil).not.toHaveBeenCalled()
            expect(warn).toHaveBeenCalledWith('Unhandled scheduled cron trigger', {
                cron: '* * * * *',
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
