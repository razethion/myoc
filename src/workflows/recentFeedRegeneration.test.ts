import type {WorkflowEvent, WorkflowStep} from 'cloudflare:workers'
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {publishRecentFeed, requestRecentFeedRegeneration} from '../lib/recentMedia/publisher'
import {getGeneratedRecentMediaPage} from '../lib/recentMedia/reader'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import {createMockR2Bucket} from '../test/mockR2'
import type {Bindings} from '../types/bindings'
import {RegenerateMediaPreviewsWorkflow, type RegenerateMediaPreviewsWorkflowParams} from './RegenerateMediaPreviewsWorkflow'

vi.mock('../lib/recentMedia/publisher', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../lib/recentMedia/publisher')>()
    return {
        ...actual,
        publishRecentFeed: vi.fn(actual.publishRecentFeed),
        requestRecentFeedRegeneration: vi.fn(actual.requestRecentFeedRegeneration),
    }
})

const db = useTestDatabase()

beforeEach(() => vi.clearAllMocks())

async function setup(status = 'running') {
    const bucket = createMockR2Bucket()
    const runId = crypto.randomUUID()
    await db
        .prepare(`INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at, summary_json)
        VALUES (?, 'recent-feed-regeneration', 'manual', ?, CURRENT_TIMESTAMP, '{"status":"building"}')`)
        .bind(runId, status)
        .run()
    const env = {
        DB: db,
        MEDIA_BUCKET: bucket,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        RECENT_FEED_CURSOR_SECRET: 'recent-feed-test-cursor-secret-32-bytes',
    } as unknown as Bindings
    const workflow = Object.create(RegenerateMediaPreviewsWorkflow.prototype) as RegenerateMediaPreviewsWorkflow
    Reflect.set(workflow, 'env', env)
    const sleep = vi.fn(async () => undefined)
    const step = {
        do: async (_name: string, _config: unknown, callback: () => Promise<unknown>) => await callback(),
        sleep,
    } as unknown as WorkflowStep
    const run = async () =>
        await workflow.run({payload: {kind: 'recent-feed', runId}} as WorkflowEvent<RegenerateMediaPreviewsWorkflowParams>, step)
    return {bucket, env, runId, run, sleep}
}

describe('recent feed regeneration workflow', () => {
    it('rebuilds a missing root and records a successful job', async () => {
        await seedUser({id: 'owner'})
        await seedCharacter({id: 'character', userId: 'owner'})
        await seedMedia({
            id: 'media',
            userId: 'owner',
            characterId: 'character',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-09-05 12:00:00',
            sfwPreviewImageKey: 'preview',
        })
        const test = await setup()
        await publishRecentFeed(test.env, {force: true})
        const pointer = await queryOne<{root_key: string}>('SELECT root_key FROM recent_feed_state WHERE singleton = 1')
        if (!pointer) throw new Error('Expected a published feed')
        await test.bucket.delete(pointer.root_key)

        await expect(test.run()).resolves.toMatchObject({status: 'published'})

        expect(await queryOne('SELECT status, error_message FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({
            status: 'success',
            error_message: null,
        })
        const page = await getGeneratedRecentMediaPage(test.env, {limit: 10, showNsfw: false, showUnapproved: false})
        expect(page.items).toHaveLength(1)
        expect(page.generation).not.toBeNull()
    })

    it.each(['building', 'busy'] as const)('continues after a %s publication result', async (status) => {
        const test = await setup()
        vi.mocked(publishRecentFeed).mockResolvedValueOnce({status})
        await expect(test.run()).resolves.toMatchObject({status: 'published'})
        expect(test.sleep).toHaveBeenCalled()
        expect(await queryOne('SELECT status FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({status: 'success'})
    })

    it('accepts a feed completed by the recovery cron', async () => {
        const test = await setup()
        await requestRecentFeedRegeneration(test.env, test.runId)
        await publishRecentFeed(test.env, {force: true})
        await expect(test.run()).resolves.toMatchObject({status: 'current'})
        expect(await queryOne('SELECT status FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({status: 'success'})
    })

    it('leaves a closed job and its feed unchanged', async () => {
        const test = await setup('error')
        await expect(test.run()).resolves.toEqual({status: 'closed'})
        expect(test.bucket.put).not.toHaveBeenCalled()
        expect(await queryOne('SELECT status FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({status: 'error'})
    })

    it('stops when a job closes after its rebuild request', async () => {
        const test = await setup()
        const request = vi.mocked(requestRecentFeedRegeneration).getMockImplementation()
        if (!request) throw new Error('Expected request implementation')
        vi.mocked(requestRecentFeedRegeneration).mockImplementationOnce(async (env, id) => {
            const result = await request(env, id)
            await db.prepare("UPDATE admin_job_runs SET status = 'error' WHERE id = ?").bind(id).run()
            return result
        })
        await expect(test.run()).resolves.toEqual({status: 'closed'})
        expect(test.bucket.put).not.toHaveBeenCalled()
    })

    it('reports a busy reset for workflow retry', async () => {
        const test = await setup()
        await db
            .prepare("UPDATE recent_feed_state SET lease_owner = 'other', lease_expires_at = '2099-01-01 00:00:00' WHERE singleton = 1")
            .run()
        await expect(test.run()).rejects.toThrow('Recent feed publication is busy')
        expect(test.bucket.put).not.toHaveBeenCalled()
    })

    it('records publication failures in job history', async () => {
        const test = await setup()
        vi.mocked(test.bucket.put).mockRejectedValueOnce(new Error('R2 unavailable'))
        await expect(test.run()).rejects.toThrow('R2 unavailable')
        expect(await queryOne('SELECT status, error_message FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({
            status: 'error',
            error_message: 'R2 unavailable',
        })
    })

    it('records an error if publication never becomes available', async () => {
        const test = await setup()
        const publish = vi.mocked(publishRecentFeed).getMockImplementation()
        if (!publish) throw new Error('Expected publisher implementation')
        vi.mocked(publishRecentFeed).mockResolvedValue({status: 'busy'})
        try {
            await expect(test.run()).rejects.toThrow('did not finish within 1000 batches')
            expect(await queryOne('SELECT status FROM admin_job_runs WHERE id = ?', [test.runId])).toEqual({status: 'error'})
        } finally {
            vi.mocked(publishRecentFeed).mockImplementation(publish)
        }
    })
})
