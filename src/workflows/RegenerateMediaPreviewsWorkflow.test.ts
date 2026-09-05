import {introspectWorkflowInstance} from 'cloudflare:test'
import {env, type WorkflowEvent, type WorkflowStep} from 'cloudflare:workers'
import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import type {Bindings} from '../types/bindings'
import type {RegenerateMediaPreviewsWorkflowParams} from './RegenerateMediaPreviewsWorkflow'
import {RegenerateMediaPreviewsWorkflow} from './RegenerateMediaPreviewsWorkflow'

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

async function seedJob(runId: string): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_job_runs (
                id, job_name, trigger_source, status, started_at, summary_json
            ) VALUES (?, 'media-preview-regeneration', 'manual', 'running', ?, ?)`,
        )
        .bind(runId, '2026-09-03 12:00:00', JSON.stringify(summary()))
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
    const sendBatch = vi.fn(async () => undefined)
    return {sendBatch, binding: {sendBatch} as unknown as Queue}
}

async function runWorkflow(params: RegenerateMediaPreviewsWorkflowParams, failure?: {name: string; error: Error}) {
    const lane0 = createQueue()
    const lane1 = createQueue()
    const lane2 = createQueue()
    const createBatch = vi.fn(async () => undefined)
    const workflowEnv = {
        DB: db,
        MEDIA_PREVIEW_REGENERATION_QUEUE_0: lane0.binding,
        MEDIA_PREVIEW_REGENERATION_QUEUE_1: lane1.binding,
        MEDIA_PREVIEW_REGENERATION_QUEUE_2: lane2.binding,
        REGENERATE_MEDIA_PREVIEWS_WORKFLOW: {createBatch},
    } as unknown as Bindings
    const workflow = Object.create(RegenerateMediaPreviewsWorkflow.prototype) as RegenerateMediaPreviewsWorkflow
    Reflect.set(workflow, 'env', workflowEnv)
    let failed = false
    const step = {
        do: async (name: string, _config: unknown, callback: () => Promise<unknown>) => {
            if (!failed && failure?.name === name) {
                failed = true
                throw failure.error
            }

            return await callback()
        },
    } as unknown as WorkflowStep
    const output = await workflow.run({payload: params} as WorkflowEvent<RegenerateMediaPreviewsWorkflowParams>, step)

    return {createBatch, lane0, lane1, lane2, output}
}

describe('RegenerateMediaPreviewsWorkflow', () => {
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
        expect(tasks.slice(0, 6).map((task) => task.container_slot)).toEqual([0, 1, 2, 0, 1, 2])
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
                        nextContainerSlot: 2,
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
                nextContainerSlot: 2,
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
})
