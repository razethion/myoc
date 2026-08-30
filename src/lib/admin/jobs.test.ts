import {describe, expect, it} from 'vitest'
import {queryOne, seedUser, useTestDatabase} from '../../test/d1'
import {type AdminJobSummary, getAdminOptionsData, recordAdminJobRun} from './jobs'

const db = useTestDatabase()

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
        const storedRun = await queryOne<{
            cron: string
            duration_ms: number
            error_message: string | null
            finished_at: string | null
            job_name: string
            started_at: string
            status: string
            summary_json: string | null
            trigger_source: string
        }>(
            `SELECT job_name, trigger_source, cron, status, started_at, finished_at,
                    duration_ms, summary_json, error_message
             FROM admin_job_runs
             WHERE id = ?`,
            [result.runId],
        )
        expect(storedRun).toMatchObject({
            cron: '0 8 * * *',
            error_message: null,
            job_name: 'd1-backup',
            started_at: '2026-07-11 08:00:00',
            status: 'success',
            trigger_source: 'cron',
        })
        expect(storedRun?.finished_at).not.toBeNull()
        expect(storedRun?.duration_ms).toBeGreaterThanOrEqual(0)
        expect(JSON.parse(storedRun?.summary_json ?? 'null')).toEqual(backupSummary)
    })

    it('records failed job runs before rethrowing', async () => {
        await seedUser({id: 'admin-1', role: 'admin'})

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

        const storedRun = await queryOne<{
            duration_ms: number
            error_message: string | null
            finished_at: string | null
            job_name: string
            status: string
            summary_json: string | null
            trigger_source: string
            triggered_by_user_id: string | null
        }>(
            `SELECT job_name, trigger_source, status, finished_at, duration_ms,
                    summary_json, error_message, triggered_by_user_id
             FROM admin_job_runs
             WHERE job_name = ?`,
            ['r2-media-cleanup'],
        )
        expect(storedRun).toEqual(
            expect.objectContaining({
                error_message: 'cleanup failed',
                job_name: 'r2-media-cleanup',
                status: 'error',
                summary_json: null,
                trigger_source: 'manual',
                triggered_by_user_id: 'admin-1',
            }),
        )
        expect(storedRun?.finished_at).not.toBeNull()
        expect(storedRun?.duration_ms).toBeGreaterThanOrEqual(0)
    })
})

describe('getAdminOptionsData', () => {
    it('returns known job runs with parsed summaries', async () => {
        await db.batch([
            db
                .prepare(
                    `INSERT INTO admin_job_runs (
                        id, job_name, trigger_source, cron, status, started_at, finished_at, duration_ms, summary_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind(
                    'run-1',
                    'd1-backup',
                    'cron',
                    '0 8 * * *',
                    'success',
                    '2026-07-11 08:00:00',
                    '2026-07-11 08:00:02',
                    2000,
                    JSON.stringify(backupSummary),
                ),
            db
                .prepare(
                    `INSERT INTO admin_job_runs (
                        id, job_name, trigger_source, cron, status, started_at, finished_at, duration_ms, summary_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .bind('run-2', 'old-job', 'cron', '* * * * *', 'success', '2026-07-11 07:00:00', '2026-07-11 07:00:01', 1000, '{}'),
        ])

        const data = await getAdminOptionsData(db)

        expect(data.runs).toEqual([
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
