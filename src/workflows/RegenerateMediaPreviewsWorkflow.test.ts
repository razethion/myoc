import {introspectWorkflowInstance} from 'cloudflare:test'
import {env} from 'cloudflare:workers'
import {describe, expect, it} from 'vitest'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'

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

async function getJob(runId: string): Promise<StoredJobRun | null> {
    return queryOne<StoredJobRun>('SELECT status, summary_json, error_message FROM admin_job_runs WHERE id = ?', [runId])
}

async function seedSfwMedia(count: number): Promise<void> {
    const userId = 'workflow-owner'
    const characterId = 'workflow-character'
    await seedUser({id: userId})
    await seedCharacter({id: characterId, userId})

    for (let index = 1; index <= count; index += 1) {
        await seedMedia({
            id: `workflow-media-${String(index).padStart(2, '0')}`,
            userId,
            characterId,
        })
    }
}

describe('RegenerateMediaPreviewsWorkflow', () => {
    it('completes an empty regeneration job and stores its final summary', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('complete')

        const expectedSummary = summary()
        await expect(instance.getOutput()).resolves.toEqual(expectedSummary)
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'success', error_message: null})
        expect(JSON.parse(run?.summary_json ?? 'null')).toEqual(expectedSummary)
    })

    it('processes successful results across more than one batch', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await seedSfwMedia(26)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)
        await instance.modify(async (modifier) => {
            for (let item = 1; item <= 25; item += 1) {
                await modifier.mockStepResult(
                    {name: `regenerate batch 1 item ${item}`},
                    {
                        status: 'regenerated',
                        regeneratedBlur: false,
                        error: null,
                    },
                )
            }
            await modifier.mockStepResult(
                {name: 'regenerate batch 2 item 1'},
                {
                    status: 'regenerated',
                    regeneratedBlur: false,
                    error: null,
                },
            )
        })

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('complete')

        const expectedSummary = {
            ...summary(26),
            processedVariants: 26,
            regeneratedPreviews: 26,
        }
        await expect(instance.getOutput()).resolves.toEqual(expectedSummary)
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'success', error_message: null})
        expect(JSON.parse(run?.summary_json ?? 'null')).toEqual(expectedSummary)
    })

    it('records one item failure and completes the remaining job', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await seedSfwMedia(1)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)
        await instance.modify(async (modifier) => {
            await modifier.disableRetryDelays()
            await modifier.mockStepError({name: 'regenerate batch 1 item 1'}, new Error('Preview processor failed'))
        })

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('complete')

        const expectedSummary = {
            ...summary(1),
            processedVariants: 1,
            failedVariants: 1,
            lastError: 'Preview processor failed',
        }
        await expect(instance.getOutput()).resolves.toEqual(expectedSummary)
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'success', error_message: null})
        expect(JSON.parse(run?.summary_json ?? 'null')).toEqual(expectedSummary)
    })

    it('records a missing source as an item failure', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await seedSfwMedia(1)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('complete')

        const expectedSummary = {
            ...summary(1),
            processedVariants: 1,
            failedVariants: 1,
            lastError: 'SFW source image is missing or invalid for media workflow-media-01',
        }
        await expect(instance.getOutput()).resolves.toEqual(expectedSummary)
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'success', error_message: null})
        expect(JSON.parse(run?.summary_json ?? 'null')).toEqual(expectedSummary)
    })

    it('fails the job when a job-level step cannot finish', async () => {
        const runId = crypto.randomUUID()
        const failureMessage = 'x'.repeat(2_001)
        await seedJob(runId)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)
        await instance.modify(async (modifier) => {
            await modifier.disableRetryDelays()
            await modifier.mockStepError({name: 'initialize job'}, new Error(failureMessage))
        })

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('errored')

        await expect(instance.getError()).resolves.toMatchObject({name: 'Error', message: failureMessage})
        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'error', summary_json: null, error_message: failureMessage.slice(0, 2_000)})
    })

    it('stores a safe message for a job error without a message', async () => {
        const runId = crypto.randomUUID()
        await seedJob(runId)
        await using instance = await introspectWorkflowInstance(env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW, runId)
        await instance.modify(async (modifier) => {
            await modifier.disableRetryDelays()
            await modifier.mockStepError({name: 'initialize job'}, new Error())
        })

        await env.REGENERATE_MEDIA_PREVIEWS_WORKFLOW.create({id: runId, params: {runId}})
        await instance.waitForStatus('errored')

        const run = await getJob(runId)
        expect(run).toMatchObject({status: 'error', summary_json: null, error_message: 'Error'})
    })
})
