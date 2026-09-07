import type {WorkflowStep} from 'cloudflare:workers'
import {describe, expect, it} from 'vitest'
import {emptySizeChartImageBackfillSummary} from '../lib/admin/sizeChartImageBackfill'
import {queryOne, seedCharacter, seedUser, useTestDatabase} from '../test/d1'
import {createMockR2Bucket} from '../test/mockR2'
import {createWorkerEnv} from '../test/workerBindings'
import {runSizeChartImageBackfillWorkflow} from './sizeChartImageBackfill'

const db = useTestDatabase()

async function seedJob(runId: string): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at, summary_json)
             VALUES (?, 'size-chart-image-backfill', 'manual', 'running', CURRENT_TIMESTAMP, ?)`,
        )
        .bind(runId, JSON.stringify(emptySizeChartImageBackfillSummary()))
        .run()
}

function immediateStep(): WorkflowStep {
    return {
        do: async (_name: string, _config: unknown, callback: () => Promise<unknown>) => await callback(),
    } as unknown as WorkflowStep
}

describe('size chart image backfill workflow', () => {
    it('completes an empty job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)

        const summary = await runSizeChartImageBackfillWorkflow(
            createWorkerEnv({DB: db}),
            {kind: 'size-chart-images', runId},
            immediateStep(),
        )

        expect(summary).toEqual(emptySizeChartImageBackfillSummary())
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId])).toEqual({status: 'success'})
    })

    it('records a missing source and continues to completion', async () => {
        const runId = crypto.randomUUID()
        const userId = 'missing-source-owner'
        await seedJob(runId)
        await seedUser({id: userId})
        await seedCharacter({
            id: 'missing-source-chart',
            userId,
            heightChartJson: JSON.stringify({
                version: 1,
                height: {meters: 1.7},
                image: {key: 'missing', contentType: 'image/png', naturalWidth: 100, naturalHeight: 200},
                calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false, nameTagXPercent: 50},
            }),
        })

        const summary = await runSizeChartImageBackfillWorkflow(
            createWorkerEnv({DB: db, MEDIA_BUCKET: createMockR2Bucket()}),
            {kind: 'size-chart-images', runId},
            immediateStep(),
        )

        expect(summary).toMatchObject({totalImages: 1, processedImages: 1, replacedImages: 0, failedImages: 1})
        expect(summary.lastError).toContain('source size chart image is missing')
        const stored = await queryOne<{status: string; summary_json: string}>(
            'SELECT status, summary_json FROM admin_job_runs WHERE id = ?',
            [runId],
        )
        expect(stored?.status).toBe('success')
        expect(JSON.parse(stored?.summary_json ?? 'null')).toEqual(summary)
    })
})
