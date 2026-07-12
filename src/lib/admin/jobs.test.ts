import {describe, expect, it} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {type AdminJobSummary, getAdminJobRuns, recordAdminJobRun} from './jobs'

const backupSummary = {
    compressedBytes: 2048,
    databaseName: 'myoc-db',
    generatedAt: '2026-07-11T08:00:00.000Z',
    key: 'd1/myoc-db/2026/07/11/myoc-db.sql.gz',
    rows: 42,
    schemaObjects: 5,
    tables: 4,
} satisfies AdminJobSummary

describe('recordAdminJobRun', () => {
    it('records successful job runs', async () => {
        const {db, boundStatements} = createMockDb()

        const result = await recordAdminJobRun(
            db,
            'd1-backup',
            {
                cron: '0 8 * * *',
                now: new Date('2026-07-11T08:00:00Z'),
                triggerSource: 'cron',
            },
            async () => backupSummary,
        )

        expect(result).toEqual(
            expect.objectContaining({
                jobName: 'd1-backup',
                status: 'success',
                summary: backupSummary,
            }),
        )
        expect(boundStatements).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    binds: expect.arrayContaining(['d1-backup', 'cron', '0 8 * * *', 'running', '2026-07-11 08:00:00']),
                    sql: expect.stringMatching(/INSERT\s+INTO\s+admin_job_runs/),
                }),
                expect.objectContaining({
                    binds: expect.arrayContaining(['success', JSON.stringify(backupSummary)]),
                    sql: expect.stringContaining('UPDATE admin_job_runs'),
                }),
            ]),
        )
    })

    it('records failed job runs before rethrowing', async () => {
        const {db, boundStatements} = createMockDb()

        await expect(
            recordAdminJobRun(
                db,
                'r2-media-cleanup',
                {
                    triggeredByUserId: 'admin-1',
                    triggerSource: 'manual',
                },
                async () => {
                    throw new Error('cleanup failed')
                },
            ),
        ).rejects.toThrow('cleanup failed')

        expect(boundStatements).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    binds: expect.arrayContaining(['r2-media-cleanup', 'manual', 'admin-1', 'running']),
                    sql: expect.stringMatching(/INSERT\s+INTO\s+admin_job_runs/),
                }),
                expect.objectContaining({
                    binds: expect.arrayContaining(['error', 'cleanup failed']),
                    sql: expect.stringContaining('UPDATE admin_job_runs'),
                }),
            ]),
        )
    })
})

describe('getAdminJobRuns', () => {
    it('returns known job runs with parsed summaries', async () => {
        const {db} = createMockDb({
            allResults: [
                [
                    {
                        id: 'run-1',
                        job_name: 'd1-backup',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: '0 8 * * *',
                        status: 'success',
                        started_at: '2026-07-11 08:00:00',
                        finished_at: '2026-07-11 08:00:02',
                        duration_ms: 2000,
                        summary_json: JSON.stringify(backupSummary),
                        error_message: null,
                    },
                    {
                        id: 'run-2',
                        job_name: 'old-job',
                        trigger_source: 'cron',
                        triggered_by_user_id: null,
                        triggered_by_username: null,
                        cron: '* * * * *',
                        status: 'success',
                        started_at: '2026-07-11 07:00:00',
                        finished_at: '2026-07-11 07:00:01',
                        duration_ms: 1000,
                        summary_json: '{}',
                        error_message: null,
                    },
                ],
            ],
        })

        const runs = await getAdminJobRuns(db)

        expect(runs).toEqual([
            expect.objectContaining({
                cron: '0 8 * * *',
                id: 'run-1',
                jobName: 'd1-backup',
                label: 'D1 Database Backup',
                summary: backupSummary,
            }),
        ])
    })
})
