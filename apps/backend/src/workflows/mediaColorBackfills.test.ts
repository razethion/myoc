import type {WorkflowStep} from 'cloudflare:workers'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
    type AvifIconColorBackfillCandidate,
    emptyAvifIconColorBackfillSummary,
    getAvifIconColorBackfillCandidates,
    repairAvifIconColorCandidate,
} from '../lib/admin/avifIconColorBackfill'
import {
    emptyPngSrgbBackfillSummary,
    getPngSrgbBackfillCandidates,
    type PngSrgbBackfillCandidate,
    tagPngSrgbCandidate,
} from '../lib/admin/pngSrgbBackfill'
import {queryOne, useTestDatabase} from '../test/d1'
import {createWorkerEnv} from '../test/workerBindings'
import type {Bindings} from '../types/bindings'
import {runAvifIconColorBackfillWorkflow} from './avifIconColorBackfill'
import {runPngSrgbBackfillWorkflow} from './pngSrgbBackfill'

vi.mock('../lib/admin/pngSrgbBackfill', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/admin/pngSrgbBackfill')>()
    return {
        ...actual,
        getPngSrgbBackfillCandidates: vi.fn(actual.getPngSrgbBackfillCandidates),
        tagPngSrgbCandidate: vi.fn(actual.tagPngSrgbCandidate),
    }
})

vi.mock('../lib/admin/avifIconColorBackfill', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/admin/avifIconColorBackfill')>()
    return {
        ...actual,
        getAvifIconColorBackfillCandidates: vi.fn(actual.getAvifIconColorBackfillCandidates),
        repairAvifIconColorCandidate: vi.fn(actual.repairAvifIconColorCandidate),
    }
})

const db = useTestDatabase()

function immediateStep(): WorkflowStep {
    return {
        do: async (_name: string, _config: unknown, callback: () => Promise<unknown>) => await callback(),
    } as unknown as WorkflowStep
}

async function seedJob(runId: string, jobName: string, summary: unknown): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at, summary_json)
             VALUES (?, ?, 'manual', 'running', CURRENT_TIMESTAMP, ?)`,
        )
        .bind(runId, jobName, JSON.stringify(summary))
        .run()
}

function pngCandidate(index: number): PngSrgbBackfillCandidate {
    return {
        mediaId: `png-media-${String(index).padStart(3, '0')}`,
        userId: 'png-owner',
        characterId: 'png-character',
        createdAt: '2026-01-01 00:00:00',
        rating: 'sfw',
        imageKey: `png-source-${index}`,
        contentType: 'image/png',
        byteSize: 100,
    }
}

function iconCandidate(index: number): AvifIconColorBackfillCandidate {
    return {
        kind: 'character-profile',
        userId: 'icon-owner',
        targetId: `icon-${String(index).padStart(3, '0')}`,
        imageKey: `icon-source-${index}`,
        contentType: 'image/webp',
        objectKey: `icons/${index}`,
    }
}

describe('PNG sRGB backfill workflow', () => {
    beforeEach(() => {
        vi.mocked(getPngSrgbBackfillCandidates).mockReset()
        vi.mocked(tagPngSrgbCandidate).mockReset()
    })

    it('completes an empty job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'png-srgb-backfill', emptyPngSrgbBackfillSummary())
        vi.mocked(getPngSrgbBackfillCandidates).mockResolvedValue([])

        const summary = await runPngSrgbBackfillWorkflow(createWorkerEnv({DB: db}), {kind: 'png-srgb-backfill', runId}, immediateStep())

        expect(summary).toEqual(emptyPngSrgbBackfillSummary())
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId])).toEqual({status: 'success'})
    })

    it('counts retagged, skipped, and failed variants', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'png-srgb-backfill', emptyPngSrgbBackfillSummary())
        vi.mocked(getPngSrgbBackfillCandidates).mockResolvedValue([pngCandidate(1), pngCandidate(2), pngCandidate(3)])
        vi.mocked(tagPngSrgbCandidate)
            .mockResolvedValueOnce({status: 'retagged'})
            .mockResolvedValueOnce({status: 'skipped'})
            .mockRejectedValueOnce(new Error('bad PNG'))

        const summary = await runPngSrgbBackfillWorkflow(createWorkerEnv({DB: db}), {kind: 'png-srgb-backfill', runId}, immediateStep())

        expect(summary).toEqual({
            totalVariants: 3,
            processedVariants: 3,
            retaggedVariants: 1,
            skippedVariants: 1,
            failedVariants: 1,
            lastError: 'bad PNG',
        })
        expect(
            await queryOne<{status: string; summary_json: string}>('SELECT status, summary_json FROM admin_job_runs WHERE id = ?', [runId]),
        ).toEqual({status: 'success', summary_json: JSON.stringify(summary)})
    })

    it('starts a continuation after 250 variants', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'png-srgb-backfill', emptyPngSrgbBackfillSummary())
        const batch = Array.from({length: 25}, (_, index) => pngCandidate(index + 1))
        vi.mocked(getPngSrgbBackfillCandidates).mockResolvedValue(batch)
        vi.mocked(tagPngSrgbCandidate).mockResolvedValue({status: 'skipped'})
        const create = vi.fn(async () => ({id: 'continuation'}))

        const summary = await runPngSrgbBackfillWorkflow(
            createWorkerEnv({
                DB: db,
                REGENERATE_MEDIA_PREVIEWS_WORKFLOW: {create} as unknown as Bindings['REGENERATE_MEDIA_PREVIEWS_WORKFLOW'],
            }),
            {kind: 'png-srgb-backfill', runId},
            immediateStep(),
        )

        expect(summary).toMatchObject({
            totalVariants: 250,
            processedVariants: 250,
            retaggedVariants: 0,
            skippedVariants: 250,
            failedVariants: 0,
        })
        expect(create).toHaveBeenCalledWith({
            id: `${runId}-png-srgb-segment-1`,
            params: {
                kind: 'png-srgb-backfill',
                runId,
                continuation: {
                    cursor: {createdAt: batch[24]?.createdAt, mediaId: batch[24]?.mediaId, rating: batch[24]?.rating},
                    segment: 1,
                },
            },
        })
    })

    it('does not resume a job that is no longer running', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'png-srgb-backfill', emptyPngSrgbBackfillSummary())
        await db.prepare("UPDATE admin_job_runs SET status = 'error' WHERE id = ?").bind(runId).run()

        const summary = await runPngSrgbBackfillWorkflow(
            createWorkerEnv({DB: db}),
            {
                kind: 'png-srgb-backfill',
                runId,
                continuation: {cursor: {createdAt: '2026-01-01 00:00:00', mediaId: 'old', rating: 'sfw'}, segment: 1},
            },
            immediateStep(),
        )

        expect(summary).toEqual(emptyPngSrgbBackfillSummary())
    })
})

describe('AVIF icon color backfill workflow', () => {
    beforeEach(() => {
        vi.mocked(getAvifIconColorBackfillCandidates).mockReset()
        vi.mocked(repairAvifIconColorCandidate).mockReset()
    })

    it('completes an empty job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'avif-icon-color-backfill', emptyAvifIconColorBackfillSummary())
        vi.mocked(getAvifIconColorBackfillCandidates).mockResolvedValue([])

        const summary = await runAvifIconColorBackfillWorkflow(
            createWorkerEnv({DB: db}),
            {kind: 'avif-icon-color-backfill', runId},
            immediateStep(),
        )

        expect(summary).toEqual(emptyAvifIconColorBackfillSummary())
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId])).toEqual({status: 'success'})
    })

    it('counts retagged, skipped, and failed icons', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'avif-icon-color-backfill', emptyAvifIconColorBackfillSummary())
        vi.mocked(getAvifIconColorBackfillCandidates).mockResolvedValue([iconCandidate(1), iconCandidate(2), iconCandidate(3)])
        vi.mocked(repairAvifIconColorCandidate)
            .mockResolvedValueOnce({status: 'retagged'})
            .mockResolvedValueOnce({status: 'skipped'})
            .mockRejectedValueOnce(new Error('bad icon'))

        const summary = await runAvifIconColorBackfillWorkflow(
            createWorkerEnv({DB: db}),
            {kind: 'avif-icon-color-backfill', runId},
            immediateStep(),
        )

        expect(summary).toEqual({
            totalIcons: 3,
            processedIcons: 3,
            retaggedIcons: 1,
            skippedIcons: 1,
            failedIcons: 1,
            lastError: 'bad icon',
        })
        expect(
            await queryOne<{status: string; summary_json: string}>('SELECT status, summary_json FROM admin_job_runs WHERE id = ?', [runId]),
        ).toEqual({status: 'success', summary_json: JSON.stringify(summary)})
    })

    it('starts a continuation after 250 icons', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'avif-icon-color-backfill', emptyAvifIconColorBackfillSummary())
        const batch = Array.from({length: 25}, (_, index) => iconCandidate(index + 1))
        vi.mocked(getAvifIconColorBackfillCandidates).mockResolvedValue(batch)
        vi.mocked(repairAvifIconColorCandidate).mockResolvedValue({status: 'skipped'})
        const create = vi.fn(async () => ({id: 'continuation'}))

        const summary = await runAvifIconColorBackfillWorkflow(
            createWorkerEnv({
                DB: db,
                REGENERATE_MEDIA_PREVIEWS_WORKFLOW: {create} as unknown as Bindings['REGENERATE_MEDIA_PREVIEWS_WORKFLOW'],
            }),
            {kind: 'avif-icon-color-backfill', runId},
            immediateStep(),
        )

        expect(summary).toMatchObject({
            totalIcons: 250,
            processedIcons: 250,
            retaggedIcons: 0,
            skippedIcons: 250,
            failedIcons: 0,
        })
        expect(create).toHaveBeenCalledWith({
            id: `${runId}-avif-icon-segment-1`,
            params: {
                kind: 'avif-icon-color-backfill',
                runId,
                continuation: {
                    cursor: {kind: batch[24]?.kind, targetId: batch[24]?.targetId},
                    segment: 1,
                },
            },
        })
    })

    it('does not resume a job that is no longer running', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'avif-icon-color-backfill', emptyAvifIconColorBackfillSummary())
        await db.prepare("UPDATE admin_job_runs SET status = 'error' WHERE id = ?").bind(runId).run()

        const summary = await runAvifIconColorBackfillWorkflow(
            createWorkerEnv({DB: db}),
            {
                kind: 'avif-icon-color-backfill',
                runId,
                continuation: {cursor: {kind: 'character-profile', targetId: 'old'}, segment: 1},
            },
            immediateStep(),
        )

        expect(summary).toEqual(emptyAvifIconColorBackfillSummary())
    })
})
