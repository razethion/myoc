import {introspectWorkflowInstance} from 'cloudflare:test'
import {env, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {countThumbnailCandidates, getThumbnailCandidates, type ThumbnailCandidate} from '../lib/admin/thumbnailRegeneration'
import {queryAll, queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import type {Bindings} from '../types/bindings'
import type {RegenerateMediaPreviewsWorkflowParams} from './RegenerateMediaPreviewsWorkflow'
import {RegenerateMediaPreviewsWorkflow} from './RegenerateMediaPreviewsWorkflow'

vi.mock('../lib/admin/thumbnailRegeneration', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/admin/thumbnailRegeneration')>()

    return {
        ...actual,
        countThumbnailCandidates: vi.fn(actual.countThumbnailCandidates),
        getThumbnailCandidates: vi.fn(actual.getThumbnailCandidates),
    }
})

const db = useTestDatabase()

type StoredJobRun = {
    status: string
    summary_json: string | null
    error_message: string | null
}

function summary(totalVariants = 0) {
    return {
        totalVariants,
        processedVariants: 0,
        regeneratedPreviews: 0,
        regeneratedBlurs: 0,
        skippedVariants: 0,
        failedVariants: 0,
        lastError: null,
    }
}

async function seedJob(runId: string, jobName = 'media-preview-regeneration', status = 'running'): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_job_runs (
                id, job_name, trigger_source, status, started_at, summary_json
            ) VALUES (?, ?, 'manual', ?, ?, ?)`,
        )
        .bind(runId, jobName, status, '2026-09-03 12:00:00', JSON.stringify(summary()))
        .run()
}

async function seedSfwMedia(count: number): Promise<void> {
    const userId = 'workflow-owner'
    const characterId = 'workflow-character'
    await seedUser({id: userId})
    await seedCharacter({id: characterId, userId})

    for (let index = 1; index <= count; index += 1) {
        await seedMedia({
            id: `workflow-media-${String(index).padStart(4, '0')}`,
            userId,
            characterId,
        })
    }
}

async function getJob(runId: string): Promise<StoredJobRun | null> {
    return queryOne<StoredJobRun>('SELECT status, summary_json, error_message FROM admin_job_runs WHERE id = ?', [runId])
}

function createQueue() {
    const bodies: unknown[] = []
    const sendBatch = vi.fn(async (messages: Array<{body: unknown}>) => {
        bodies.push(...messages.map(({body}) => body))
    })
    return {bodies, sendBatch, binding: {sendBatch} as unknown as Queue}
}

async function runWorkflow(
    params: RegenerateMediaPreviewsWorkflowParams,
    failure?: {name: string; error: Error},
    beforeStep?: (name: string) => void | Promise<void>,
) {
    const queue = createQueue()
    const createBatch = vi.fn(async () => undefined)
    const workflowEnv = {
        DB: db,
        IMAGE_PROCESSING_QUEUE: queue.binding,
        REGENERATE_MEDIA_PREVIEWS_WORKFLOW: {createBatch},
    } as unknown as Bindings
    const workflow = Object.create(RegenerateMediaPreviewsWorkflow.prototype) as RegenerateMediaPreviewsWorkflow
    Reflect.set(workflow, 'env', workflowEnv)
    let failed = false
    const step = {
        do: async (name: string, _config: unknown, callback: () => Promise<unknown>) => {
            await beforeStep?.(name)

            if (!failed && failure?.name === name) {
                failed = true
                throw failure.error
            }

            return await callback()
        },
    } as unknown as WorkflowStep
    const output = await workflow.run({payload: params} as WorkflowEvent<RegenerateMediaPreviewsWorkflowParams>, step)

    return {createBatch, output, queue}
}

describe('RegenerateMediaPreviewsWorkflow', () => {
    beforeEach(() => {
        vi.mocked(countThumbnailCandidates).mockReset()
        vi.mocked(getThumbnailCandidates).mockReset()
    })

    it('completes an empty regeneration job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('complete')

        await expect(instance.getOutput()).resolves.toEqual({queuedVariants: 0})
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'success', error_message: null})
        expect(JSON.parse(run?.summary_json ?? 'null')).toEqual(summary())
    })

    it('queues all variants and leaves processing to the queue consumer', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await seedSfwMedia(101)
        const result = await runWorkflow({runId})

        expect(result.output).toEqual({queuedVariants: 101})
        const tasks = await queryAll<{container_slot: number; status: string}>(
            `SELECT container_slot, status
             FROM media_preview_regeneration_items
             WHERE run_id = ?
             ORDER BY media_id`,
            [runId],
        )
        expect(tasks).toHaveLength(101)
        expect(new Set(tasks.map((task) => task.container_slot))).toEqual(new Set([0]))
        expect(result.queue.bodies).toHaveLength(101)
        expect(new Set(tasks.map((task) => task.status))).toEqual(new Set(['pending']))
        expect(await getJob(runId)).toMatchObject({status: 'running'})
    })

    it('starts a continuation after a full workflow segment', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await seedSfwMedia(201)
        const first = await runWorkflow({runId})

        expect(first.output).toEqual({queuedVariants: 200})
        expect(first.createBatch).toHaveBeenCalledWith([
            {
                id: `${runId}-segment-1`,
                params: {
                    runId,
                    continuation: {
                        cursor: {mediaId: 'workflow-media-0200', ratingOrder: 0},
                        queuedVariants: 200,
                        segment: 1,
                    },
                },
            },
        ])

        const continuation = await runWorkflow({
            runId,
            continuation: {
                cursor: {mediaId: 'workflow-media-0200', ratingOrder: 0},
                queuedVariants: 200,
                segment: 1,
            },
        })
        expect(continuation.output).toEqual({queuedVariants: 201})
        expect(
            await queryOne<{dispatch_complete: number; enqueued_items: number}>(
                'SELECT dispatch_complete, enqueued_items FROM media_preview_regeneration_runs WHERE run_id = ?',
                [runId],
            ),
        ).toEqual({dispatch_complete: 1, enqueued_items: 201})
    })

    it('records a job-level dispatch failure', async () => {
        const runId = crypto.randomUUID()
        const failureMessage = 'x'.repeat(2_001)
        await seedJob(runId)
        await expect(runWorkflow({runId}, {name: 'initialize job', error: new Error(failureMessage)})).rejects.toThrow(failureMessage)

        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'error', summary_json: null, error_message: failureMessage.slice(0, 2_000)})
    })

    it('stores a safe message for a job error without a message', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await expect(runWorkflow({runId}, {name: 'initialize job', error: new Error()})).rejects.toThrow()

        expect(await getJob(runId)).toMatchObject({status: 'error', summary_json: null, error_message: 'Error'})
    })

    it('queues thumbnail candidates and leaves processing to the shared image queue', async () => {
        const runId = crypto.randomUUID()
        const candidates = [thumbnailCandidate('a'), thumbnailCandidate('b'), thumbnailCandidate('c'), thumbnailCandidate('d')]
        await seedJob(runId, 'thumbnail-regeneration')
        vi.mocked(countThumbnailCandidates).mockResolvedValue(candidates.length)
        vi.mocked(getThumbnailCandidates).mockResolvedValueOnce(candidates)
        const result = await runWorkflow({kind: 'thumbnails', runId})

        expect(result.output).toEqual(summary(4))
        expect(result.queue.bodies).toEqual(
            candidates.map((candidate) => ({
                version: 1,
                kind: 'thumbnail-regeneration',
                taskId: `${runId}:thumbnail:${candidate.kind}:${candidate.targetId}`,
                runId,
            })),
        )
        expect(await queryAll<{status: string}>('SELECT status FROM media_preview_regeneration_items WHERE run_id = ?', [runId])).toEqual(
            Array.from({length: 4}, () => ({status: 'pending'})),
        )
        expect(await getJob(runId)).toMatchObject({status: 'running', error_message: null})
    })

    it('completes an empty thumbnail job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'thumbnail-regeneration')
        vi.mocked(countThumbnailCandidates).mockResolvedValue(0)
        vi.mocked(getThumbnailCandidates).mockResolvedValue([])

        const output = await runWorkflow({kind: 'thumbnails', runId})

        expect(output.output).toEqual(summary())
        expect(await getJob(runId)).toMatchObject({status: 'success', error_message: null})
        expect(output.queue.bodies).toEqual([])
    })

    it('starts a thumbnail continuation after 250 candidates', async () => {
        const runId = crypto.randomUUID()
        const candidates = Array.from({length: 251}, (_, index) => thumbnailCandidate(String(index + 1).padStart(4, '0')))
        await seedJob(runId, 'thumbnail-regeneration')
        vi.mocked(countThumbnailCandidates).mockResolvedValue(candidates.length)
        vi.mocked(getThumbnailCandidates).mockImplementation(async (_db, cursor, limit = 25) => {
            const start = cursor ? candidates.findIndex((candidate) => candidate.targetId === cursor.targetId) + 1 : 0
            return candidates.slice(start, start + limit)
        })
        const first = await runWorkflow({kind: 'thumbnails', runId})

        expect(first.output).toEqual(summary(251))
        expect(first.queue.bodies).toHaveLength(250)
        expect(first.createBatch).toHaveBeenCalledWith([
            {
                id: `${runId}-segment-1`,
                params: {
                    kind: 'thumbnails',
                    runId,
                    continuation: {
                        cursor: {kind: 'user-profile', targetId: '0250'},
                        segment: 1,
                    },
                },
            },
        ])

        const continuation = await runWorkflow({
            kind: 'thumbnails',
            runId,
            continuation: {
                cursor: {kind: 'user-profile', targetId: '0250'},
                segment: 1,
            },
        })
        expect(continuation.output).toEqual(summary(251))
        expect(continuation.queue.bodies).toHaveLength(1)
        expect(
            await queryOne<{dispatch_complete: number; enqueued_items: number}>(
                'SELECT dispatch_complete, enqueued_items FROM media_preview_regeneration_runs WHERE run_id = ?',
                [runId],
            ),
        ).toEqual({dispatch_complete: 1, enqueued_items: 251})
        expect(await getJob(runId)).toMatchObject({status: 'running', error_message: null})
    })

    it('stops a stale thumbnail workflow before it processes a candidate', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'thumbnail-regeneration', 'error')
        vi.mocked(countThumbnailCandidates).mockResolvedValue(1)
        vi.mocked(getThumbnailCandidates).mockResolvedValue([thumbnailCandidate('stale')])

        const output = await runWorkflow({kind: 'thumbnails', runId})

        expect(output.output).toEqual(summary(1))
        expect(await getJob(runId)).toMatchObject({status: 'error'})
    })

    it('stops when a thumbnail job closes after initialization', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'thumbnail-regeneration')
        vi.mocked(countThumbnailCandidates).mockResolvedValue(1)
        vi.mocked(getThumbnailCandidates).mockResolvedValue([thumbnailCandidate('stale')])

        const output = await runWorkflow({kind: 'thumbnails', runId}, undefined, async (name) => {
            if (name === 'queue thumbnail batch 1') {
                await db.prepare("UPDATE admin_job_runs SET status = 'error' WHERE id = ?").bind(runId).run()
            }
        })

        expect(output.output).toEqual(summary(1))
        expect(output.queue.bodies).toEqual([])
        expect(await getJob(runId)).toMatchObject({status: 'error'})
    })

    it.each([
        ['malformed', '{not json'],
        ['incomplete', '{}'],
        ['missing', null],
    ])('uses an empty summary when a continuation has %s job data', async (_caseName, summaryJson) => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'thumbnail-regeneration')
        await db.prepare('UPDATE admin_job_runs SET summary_json = ? WHERE id = ?').bind(summaryJson, runId).run()
        vi.mocked(getThumbnailCandidates).mockResolvedValue([])

        const output = await runWorkflow({
            kind: 'thumbnails',
            runId,
            continuation: {cursor: {kind: 'user-profile', targetId: 'previous'}, segment: 1},
        })

        expect(output.output).toEqual(summary())
        expect(await getJob(runId)).toMatchObject({status: 'success'})
    })

    it('records a job failure when thumbnail initialization cannot finish', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId, 'thumbnail-regeneration')
        vi.mocked(countThumbnailCandidates).mockRejectedValue(new Error('D1 unavailable'))

        await expect(runWorkflow({kind: 'thumbnails', runId})).rejects.toThrow('D1 unavailable')

        expect(await getJob(runId)).toMatchObject({status: 'error', summary_json: null, error_message: 'D1 unavailable'})
    })
})

function thumbnailCandidate(targetId: string): ThumbnailCandidate {
    return {
        kind: 'user-profile',
        userId: targetId,
        targetId,
        imageKey: `image-${targetId}`,
        objectKey: `users/${targetId}/profile/image-${targetId}.avif`,
        contentType: 'image/avif',
        outputImageKey: `avif-output-${targetId}`,
        outputObjectKey: `users/${targetId}/profile/avif-output-${targetId}.avif`,
    }
}
