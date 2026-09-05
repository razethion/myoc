import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {type AdminJobSummary, getAdminOptionsData, recordAdminJobRun, runAdminJob} from './jobs'

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

function createMockWorkflowBinding(initialStatuses: Record<string, string> = {}) {
    const statuses = new Map(Object.entries(initialStatuses))

    return {
        create: vi.fn(async ({id}: {id: string}) => {
            statuses.set(id, 'running')
            return {id}
        }),
        get: vi.fn(async (id: string) => {
            if (statuses.get(id) === 'missing') {
                throw new Error('Workflow instance does not exist')
            }

            return {
                id,
                status: vi.fn(async () => ({status: statuses.get(id) ?? 'unknown'})),
            }
        }),
    }
}

function thumbnailJobEnv(workflow: ReturnType<typeof createMockWorkflowBinding>): Parameters<typeof runAdminJob>[0] {
    return {DB: db, REGENERATE_MEDIA_PREVIEWS_WORKFLOW: workflow} as unknown as Parameters<typeof runAdminJob>[0]
}

function emptyRegenerationSummary() {
    return {
        totalVariants: 0,
        processedVariants: 0,
        regeneratedPreviews: 0,
        regeneratedBlurs: 0,
        skippedVariants: 0,
        failedVariants: 0,
        lastError: null,
    }
}

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

describe('D1 backup jobs', () => {
    it('records an error without starting an export when the backup bucket is not configured', async () => {
        const fetcher = vi.fn()
        const mediaBucket = createMockR2Bucket()
        vi.stubGlobal('fetch', fetcher)

        try {
            await expect(
                runAdminJob({DB: db, MEDIA_BUCKET: mediaBucket} as unknown as Parameters<typeof runAdminJob>[0], 'd1-backup', {
                    triggerSource: 'manual',
                }),
            ).rejects.toThrow('DB_BACKUP_BUCKET is not configured')

            expect(fetcher).not.toHaveBeenCalled()
            expect(mediaBucket.createMultipartUpload).not.toHaveBeenCalled()
            expect(mediaBucket.put).not.toHaveBeenCalled()
            expect(
                await queryOne<{error_message: string | null; status: string}>(
                    `SELECT status, error_message
                     FROM admin_job_runs
                     WHERE job_name = 'd1-backup'`,
                ),
            ).toEqual({status: 'error', error_message: 'DB_BACKUP_BUCKET is not configured'})
        } finally {
            vi.unstubAllGlobals()
        }
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

    it('includes the thumbnail regeneration job', async () => {
        const data = await getAdminOptionsData(db)

        expect(data.jobs).toContainEqual({name: 'thumbnail-regeneration', label: 'Thumbnail Regeneration'})
    })
})

describe('thumbnail regeneration jobs', () => {
    it('starts one workflow and reuses its active run', async () => {
        const workflow = createMockWorkflowBinding()
        const env = thumbnailJobEnv(workflow)

        const first = await runAdminJob(env, 'thumbnail-regeneration', {triggerSource: 'manual'})
        const second = await runAdminJob(env, 'thumbnail-regeneration', {triggerSource: 'manual'})

        expect(second).toEqual(first)
        expect(first).toMatchObject({jobName: 'thumbnail-regeneration', status: 'running', summary: emptyRegenerationSummary()})
        expect(workflow.create).toHaveBeenCalledOnce()
        expect(workflow.create).toHaveBeenCalledWith({
            id: first.runId,
            params: {kind: 'thumbnails', runId: first.runId},
        })
    })

    it('reuses a thumbnail run while its durable queue item is pending', async () => {
        const runId = 'queued-thumbnail-run'
        await db.batch([
            db
                .prepare(
                    `INSERT INTO admin_job_runs (
                         id, job_name, trigger_source, status, started_at, summary_json
                     ) VALUES (?, 'thumbnail-regeneration', 'manual', 'running', ?, ?)`,
                )
                .bind(runId, '2026-01-01 00:00:00', JSON.stringify({...emptyRegenerationSummary(), totalVariants: 1})),
            db
                .prepare(
                    `INSERT INTO media_preview_regeneration_runs (run_id, dispatch_complete, enqueued_items)
                     VALUES (?, 1, 1)`,
                )
                .bind(runId),
            db
                .prepare(
                    `INSERT INTO media_preview_regeneration_items (
                         task_id, run_id, media_id, rating, container_slot, candidate_json
                     ) VALUES (?, ?, 'thumbnail:user-profile:queued-user', 'sfw', 0, '{}')`,
                )
                .bind(`${runId}:thumbnail:user-profile:queued-user`, runId),
        ])
        const workflow = createMockWorkflowBinding({[runId]: 'complete'})

        const result = await runAdminJob(thumbnailJobEnv(workflow), 'thumbnail-regeneration', {triggerSource: 'manual'})

        expect(result).toMatchObject({jobName: 'thumbnail-regeneration', runId, status: 'running'})
        expect(workflow.create).not.toHaveBeenCalled()
    })

    it('closes a stopped workflow before it starts a replacement', async () => {
        await db
            .prepare(
                `INSERT INTO admin_job_runs (
                    id, job_name, trigger_source, status, started_at, summary_json
                ) VALUES (?, 'thumbnail-regeneration', 'manual', 'running', ?, ?)`,
            )
            .bind('stopped-thumbnail-run', '2026-01-01 00:00:00', JSON.stringify(emptyRegenerationSummary()))
            .run()
        const workflow = createMockWorkflowBinding({'stopped-thumbnail-run': 'terminated'})

        const result = await runAdminJob(thumbnailJobEnv(workflow), 'thumbnail-regeneration', {triggerSource: 'manual'})
        const stopped = await queryOne<{status: string; error_message: string | null}>(
            'SELECT status, error_message FROM admin_job_runs WHERE id = ?',
            ['stopped-thumbnail-run'],
        )

        expect(result).toMatchObject({jobName: 'thumbnail-regeneration', status: 'running'})
        expect(result.runId).not.toBe('stopped-thumbnail-run')
        expect(stopped).toEqual({
            status: 'error',
            error_message: 'The thumbnail regeneration Workflow stopped before the job record finished.',
        })
        expect(workflow.create).toHaveBeenCalledOnce()
    })

    it('records a workflow start failure', async () => {
        const workflow = createMockWorkflowBinding()
        workflow.create.mockRejectedValueOnce(new Error('Workflow could not start'))

        await expect(runAdminJob(thumbnailJobEnv(workflow), 'thumbnail-regeneration', {triggerSource: 'manual'})).rejects.toThrow(
            'Workflow could not start',
        )

        expect(
            await queryOne<{status: string; error_message: string | null}>(
                `SELECT status, error_message
                 FROM admin_job_runs
                 WHERE job_name = 'thumbnail-regeneration'`,
            ),
        ).toEqual({status: 'error', error_message: 'Workflow could not start'})
    })

    it('replaces an old thumbnail run when its continuation is missing', async () => {
        const staleSummary = {...emptyRegenerationSummary(), totalVariants: 251, processedVariants: 250}
        await db
            .prepare(
                `INSERT INTO admin_job_runs (
                    id, job_name, trigger_source, status, started_at, summary_json
                ) VALUES (?, 'thumbnail-regeneration', 'manual', 'running', ?, ?)`,
            )
            .bind('stale-thumbnail-run', '2026-01-01 00:00:00', JSON.stringify(staleSummary))
            .run()
        const workflow = createMockWorkflowBinding({
            'stale-thumbnail-run': 'complete',
            'stale-thumbnail-run-segment-1': 'missing',
        })

        const result = await runAdminJob(thumbnailJobEnv(workflow), 'thumbnail-regeneration', {triggerSource: 'manual'})

        expect(result).toMatchObject({jobName: 'thumbnail-regeneration', status: 'running'})
        expect(result.runId).not.toBe('stale-thumbnail-run')
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', ['stale-thumbnail-run'])).toEqual({
            status: 'error',
        })
        expect(workflow.create).toHaveBeenCalledOnce()
    })
})
