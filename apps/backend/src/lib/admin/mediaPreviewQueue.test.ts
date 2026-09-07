import {describe, expect, it, vi} from 'vitest'
import {consumeImageProcessingQueue} from '../../index'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockQueue as createQueue} from '../../test/mockQueue'
import {createMockR2Bucket} from '../../test/mockR2'
import type {Bindings} from '../../types/bindings'
import type {ImageProcessingFailureMessage, ImageProcessingMessage} from '../../types/imageProcessing'
import type {MediaPreviewRegenerationMessage} from '../../types/mediaPreviewQueue'
import {characterMediaImageObjectKey} from '../media/url'
import {consumeImageProcessingDeadLetterQueue} from './deadLetterQueue'
import {
    claimMediaPreviewRegenerationTask,
    completeMediaPreviewRegenerationDispatch,
    enqueueMediaPreviewRegenerationCandidates,
    getMediaPreviewRegenerationCandidates,
    initializeMediaPreviewRegenerationDispatch,
} from './mediaPreviewRegeneration'

const db = useTestDatabase()
const runId = 'queue-run'
const mediaId = 'queue-media'

function createContainer(responses: Response | Array<Response | Error>) {
    const sequence = Array.isArray(responses) ? responses : [responses]
    let index = 0
    const fetch = vi.fn(async () => {
        const response = sequence[Math.min(index, sequence.length - 1)]
        index += 1
        if (response instanceof Error) throw response
        if (!response) throw new Error('Missing mocked container response')
        return response.clone()
    })

    return {
        fetch,
        namespace: {
            idFromName: vi.fn(() => 'container-id'),
            get: vi.fn(() => ({fetch})),
        } as unknown as DurableObjectNamespace,
    }
}

function createMessage(body: unknown, attempts = 1) {
    const ack = vi.fn()
    const retry = vi.fn()
    const message = {
        ack,
        attempts,
        body,
        id: crypto.randomUUID(),
        retry,
        timestamp: new Date('2026-09-04T12:00:00Z'),
    } as unknown as Message

    return {ack, message, retry}
}

function createBatch(message: Message): MessageBatch {
    return {
        ackAll: vi.fn(),
        messages: [message],
        metadata: {metrics: {backlogBytes: 0, backlogCount: 0}},
        queue: 'myoc-media-preview-regeneration-0',
        retryAll: vi.fn(),
    }
}

async function createQueuedTask(responses: Response | Array<Response | Error> = validPreviewResponse()) {
    await seedUser({id: 'queue-user'})
    await seedCharacter({id: 'queue-character', userId: 'queue-user'})
    await seedMedia({id: mediaId, userId: 'queue-user', characterId: 'queue-character', sfwImageKey: 'source'})
    await db
        .prepare(
            `INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at, summary_json)
             VALUES (?, 'media-preview-regeneration', 'manual', 'running', CURRENT_TIMESTAMP, '{}')`,
        )
        .bind(runId)
        .run()

    const bucket = createMockR2Bucket()
    await bucket.put(
        characterMediaImageObjectKey('queue-user', 'queue-character', mediaId, 'source', 'sfw', 'image/png'),
        new Uint8Array(await createPngFile(100, 80).arrayBuffer()),
    )
    const processing = createQueue<ImageProcessingMessage>()
    const deadLetter = createQueue<ImageProcessingFailureMessage>()
    const container = createContainer(responses)
    const env = {
        DB: db,
        MEDIA_BUCKET: bucket,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        IMAGE_PROCESSING_DLQ: deadLetter.queue,
        IMAGE_PROCESSING_QUEUE: processing.queue,
        MYOC_DOCKER_SHARP_CONTAINER: container.namespace,
        PREVIEW_PROCESSOR_TOKEN: 'preview-token',
    } as unknown as Bindings

    await initializeMediaPreviewRegenerationDispatch(db, runId)
    const candidates = await getMediaPreviewRegenerationCandidates(db, null)
    await enqueueMediaPreviewRegenerationCandidates(db, env, runId, candidates)
    await completeMediaPreviewRegenerationDispatch(db, runId)

    const body = processing.bodies[0] as MediaPreviewRegenerationMessage | undefined
    if (!body) throw new Error('Expected one queued media preview task')

    return {body, container, deadLetter, env, processing}
}

function validPreviewResponse(): Response {
    return new Response(createAvifBytes(100, 80), {headers: {'content-type': 'image/avif'}})
}

async function expectCompletedJobSummary(expected: Record<string, number>): Promise<void> {
    const job = await queryOne<{status: string; summary_json: string}>('SELECT status, summary_json FROM admin_job_runs WHERE id = ?', [
        runId,
    ])
    expect(job?.status).toBe('success')
    expect(JSON.parse(job?.summary_json ?? '{}')).toMatchObject(expected)
}

describe('media preview queue consumer', () => {
    it('requeues an exhausted delivery until its durable processing attempts are spent', async () => {
        const {body, env, container, processing} = await createQueuedTask()
        const now = new Date('2026-09-04T12:00:00Z')
        await claimMediaPreviewRegenerationTask(db, body.taskId, now)
        const active = createMessage(body)
        await consumeImageProcessingDeadLetterQueue(createBatch(active.message), env, () => now)
        expect(active.ack).toHaveBeenCalledOnce()
        expect(active.retry).not.toHaveBeenCalled()
        expect(processing.bodies).toEqual([body, body])

        await db.prepare(`UPDATE media_preview_regeneration_items SET processing_attempts = 3 WHERE task_id = ?`).bind(body.taskId).run()

        const expired = createMessage(body)
        await consumeImageProcessingDeadLetterQueue(createBatch(expired.message), env, () => new Date(now.getTime() + 121_000))
        expect(expired.ack).toHaveBeenCalledOnce()
        expect(container.fetch).not.toHaveBeenCalled()
        await expectCompletedJobSummary({processedVariants: 1, failedVariants: 1})
        await expect(queryOne('SELECT task_id FROM media_preview_regeneration_items WHERE run_id = ?', [runId])).resolves.toBeNull()
    })

    it('retries an exhausted delivery while its last processing lease is active', async () => {
        const {body, env, processing} = await createQueuedTask()
        const now = new Date('2026-09-04T12:00:00Z')
        await claimMediaPreviewRegenerationTask(db, body.taskId, now)
        await db.prepare(`UPDATE media_preview_regeneration_items SET processing_attempts = 3 WHERE task_id = ?`).bind(body.taskId).run()
        const delivery = createMessage(body)

        await consumeImageProcessingDeadLetterQueue(createBatch(delivery.message), env, () => now)

        expect(delivery.ack).not.toHaveBeenCalled()
        expect(delivery.retry).toHaveBeenCalledWith({delaySeconds: 60})
        expect(processing.bodies).toEqual([body])
    })

    it('does not send queue messages for an empty candidate page', async () => {
        const processing = createQueue<ImageProcessingMessage>()

        await expect(
            enqueueMediaPreviewRegenerationCandidates(db, {IMAGE_PROCESSING_QUEUE: processing.queue}, runId, []),
        ).resolves.toBeUndefined()
        expect(processing.bodies).toEqual([])
    })

    it('publishes a queued preview and completes its job', async () => {
        const {body, env} = await createQueuedTask()
        const {ack, message, retry} = createMessage(body)

        await consumeImageProcessingQueue(createBatch(message), env)

        expect(ack).toHaveBeenCalledOnce()
        expect(retry).not.toHaveBeenCalled()
        await expectCompletedJobSummary({processedVariants: 1, regeneratedPreviews: 1})
        await expect(queryOne('SELECT task_id FROM media_preview_regeneration_items WHERE run_id = ?', [runId])).resolves.toBeNull()
    })

    it('retries after a container disconnect and completes on the next delivery', async () => {
        const {body, env} = await createQueuedTask([new Error('Container stopped'), validPreviewResponse()])
        const first = createMessage(body)

        await consumeImageProcessingQueue(createBatch(first.message), env)

        expect(first.ack).not.toHaveBeenCalled()
        expect(first.retry).toHaveBeenCalledWith({delaySeconds: 1})
        expect(
            await queryOne<{status: string}>('SELECT status FROM media_preview_regeneration_items WHERE task_id = ?', [body.taskId]),
        ).toEqual({
            status: 'pending',
        })

        const second = createMessage(body, 2)
        await consumeImageProcessingQueue(createBatch(second.message), env)

        expect(second.ack).toHaveBeenCalledOnce()
        expect(second.retry).not.toHaveBeenCalled()
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId])).toEqual({status: 'success'})
    })

    it('requeues capacity work without spending a processing attempt', async () => {
        const {body, env, processing} = await createQueuedTask(new Response('busy', {status: 429}))
        const delivery = createMessage(body, 10)

        await consumeImageProcessingQueue(createBatch(delivery.message), env)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(processing.bodies).toEqual([body, body])
        expect(
            await queryOne<{processing_attempts: number; status: string}>(
                'SELECT processing_attempts, status FROM media_preview_regeneration_items WHERE task_id = ?',
                [body.taskId],
            ),
        ).toEqual({processing_attempts: 0, status: 'pending'})
    })

    it('moves a permanent failure to the dead-letter queue after three deliveries', async () => {
        const {body, deadLetter, env} = await createQueuedTask(new Response(null, {status: 400}))
        const first = createMessage(body, 10)
        const second = createMessage(body, 10)
        const third = createMessage(body, 10)

        await consumeImageProcessingQueue(createBatch(first.message), env)
        await consumeImageProcessingQueue(createBatch(second.message), env)
        await consumeImageProcessingQueue(createBatch(third.message), env)

        expect(first.retry).toHaveBeenCalled()
        expect(second.retry).toHaveBeenCalled()
        expect(third.ack).toHaveBeenCalledOnce()
        expect(third.retry).not.toHaveBeenCalled()
        expect(deadLetter.bodies).toEqual([expect.objectContaining({taskId: body.taskId, error: 'Container preview failed with 400'})])
        await expectCompletedJobSummary({processedVariants: 1, failedVariants: 1})
    })

    it('moves invalid stored task data to the dead-letter queue', async () => {
        const {body, deadLetter, env} = await createQueuedTask()
        await db.prepare(`UPDATE media_preview_regeneration_items SET candidate_json = '{}' WHERE task_id = ?`).bind(body.taskId).run()
        const {ack, message} = createMessage(body)

        await consumeImageProcessingQueue(createBatch(message), env)

        expect(ack).toHaveBeenCalledOnce()
        expect(deadLetter.bodies).toEqual([
            expect.objectContaining({taskId: body.taskId, error: 'Stored media preview task data is invalid'}),
        ])
    })

    it('delays a duplicate delivery while the first task lease is active', async () => {
        const {body, env} = await createQueuedTask()
        await claimMediaPreviewRegenerationTask(db, body.taskId, new Date('2026-09-04T12:00:00Z'))
        const {ack, message, retry} = createMessage(body, 2)

        await consumeImageProcessingQueue(createBatch(message), env, () => new Date('2026-09-04T12:00:01Z'))

        expect(ack).not.toHaveBeenCalled()
        expect(retry).toHaveBeenCalledWith({delaySeconds: 119})
    })

    it('uses the minimum delay when a processing task has no lease time', async () => {
        const {body, env} = await createQueuedTask()
        await db
            .prepare(
                `UPDATE media_preview_regeneration_items SET status = 'processing', lease_id = NULL, lease_expires_at = NULL WHERE task_id = ?`,
            )
            .bind(body.taskId)
            .run()
        const {ack, message, retry} = createMessage(body, 2)

        await consumeImageProcessingQueue(createBatch(message), env)

        expect(ack).not.toHaveBeenCalled()
        expect(retry).toHaveBeenCalledWith({delaySeconds: 1})
    })

    it('acknowledges malformed and completed deliveries', async () => {
        const {body, env} = await createQueuedTask()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const malformed = createMessage({version: 2})
            await consumeImageProcessingQueue(createBatch(malformed.message), env)
            expect(malformed.ack).toHaveBeenCalledOnce()

            const unknown = createMessage({...body, runId: 'missing-run', taskId: 'missing-task'})
            await consumeImageProcessingQueue(createBatch(unknown.message), env)
            expect(unknown.ack).toHaveBeenCalledOnce()

            const first = createMessage(body)
            await consumeImageProcessingQueue(createBatch(first.message), env)
            const duplicate = createMessage(body, 2)
            await consumeImageProcessingQueue(createBatch(duplicate.message), env)
            expect(duplicate.ack).toHaveBeenCalledOnce()
            expect(duplicate.retry).not.toHaveBeenCalled()
        } finally {
            error.mockRestore()
        }
    })

    it('retries when task storage is unavailable', async () => {
        const {body, env} = await createQueuedTask()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const failingEnv = {
            ...env,
            DB: {
                prepare: () => {
                    throw 'D1 is unavailable'
                },
            },
        } as unknown as Bindings
        const {ack, message, retry} = createMessage(body, 8)

        try {
            await consumeImageProcessingQueue(createBatch(message), failingEnv)
            expect(ack).not.toHaveBeenCalled()
            expect(retry).toHaveBeenCalledWith({delaySeconds: 60})
        } finally {
            error.mockRestore()
        }
    })
})
