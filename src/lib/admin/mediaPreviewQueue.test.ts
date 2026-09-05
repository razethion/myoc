import {describe, expect, it, vi} from 'vitest'
import {queryOne, seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import type {Bindings} from '../../types/bindings'
import type {MediaPreviewRegenerationFailureMessage, MediaPreviewRegenerationMessage} from '../../types/mediaPreviewQueue'
import {characterMediaImageObjectKey} from '../media/url'
import {consumeMediaPreviewDeadLetterQueue} from './deadLetterQueue'
import {consumeMediaPreviewRegenerationQueue} from './mediaPreviewQueue'
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

function createQueue<T>() {
    const bodies: T[] = []
    const queue = {
        send: vi.fn(async (body: T) => {
            bodies.push(body)
        }),
        sendBatch: vi.fn(async (messages: Array<{body: T}>) => {
            bodies.push(...messages.map(({body}) => body))
        }),
    }

    return {bodies, queue: queue as unknown as Queue<T>}
}

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
    const lane0 = createQueue<MediaPreviewRegenerationMessage>()
    const lane1 = createQueue<MediaPreviewRegenerationMessage>()
    const lane2 = createQueue<MediaPreviewRegenerationMessage>()
    const deadLetter = createQueue<MediaPreviewRegenerationFailureMessage>()
    const container = createContainer(responses)
    const env = {
        DB: db,
        MEDIA_BUCKET: bucket,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        MEDIA_PREVIEW_REGENERATION_DLQ: deadLetter.queue,
        MEDIA_PREVIEW_REGENERATION_QUEUE_0: lane0.queue,
        MEDIA_PREVIEW_REGENERATION_QUEUE_1: lane1.queue,
        MEDIA_PREVIEW_REGENERATION_QUEUE_2: lane2.queue,
        MYOC_DOCKER_SHARP_CONTAINER: container.namespace,
        PREVIEW_PROCESSOR_TOKEN: 'preview-token',
    } as unknown as Bindings

    await initializeMediaPreviewRegenerationDispatch(db, runId)
    const candidates = await getMediaPreviewRegenerationCandidates(db, null)
    await enqueueMediaPreviewRegenerationCandidates(db, env, runId, candidates, 0)
    await completeMediaPreviewRegenerationDispatch(db, runId)

    const body = lane0.bodies[0]
    if (!body) throw new Error('Expected one queued media preview task')

    return {body, container, deadLetter, env}
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
    it('finishes exhausted preview work after its active lease expires', async () => {
        const {body, env, container} = await createQueuedTask()
        const now = new Date('2026-09-04T12:00:00Z')
        await claimMediaPreviewRegenerationTask(db, body.taskId, now)
        const active = createMessage(body)
        await consumeMediaPreviewDeadLetterQueue(createBatch(active.message), env, () => now)
        expect(active.ack).not.toHaveBeenCalled()
        expect(active.retry).toHaveBeenCalled()

        const expired = createMessage(body)
        await consumeMediaPreviewDeadLetterQueue(createBatch(expired.message), env, () => new Date(now.getTime() + 121_000))
        expect(expired.ack).toHaveBeenCalledOnce()
        expect(container.fetch).not.toHaveBeenCalled()
        await expectCompletedJobSummary({processedVariants: 1, failedVariants: 1})
        await expect(queryOne('SELECT task_id FROM media_preview_regeneration_items WHERE run_id = ?', [runId])).resolves.toBeNull()
    })

    it('does not send queue messages for an empty candidate page', async () => {
        const lane0 = createQueue<MediaPreviewRegenerationMessage>()
        const lane1 = createQueue<MediaPreviewRegenerationMessage>()
        const lane2 = createQueue<MediaPreviewRegenerationMessage>()

        await expect(
            enqueueMediaPreviewRegenerationCandidates(
                db,
                {
                    MEDIA_PREVIEW_REGENERATION_QUEUE_0: lane0.queue,
                    MEDIA_PREVIEW_REGENERATION_QUEUE_1: lane1.queue,
                    MEDIA_PREVIEW_REGENERATION_QUEUE_2: lane2.queue,
                },
                runId,
                [],
                2,
            ),
        ).resolves.toBe(2)
        expect([...lane0.bodies, ...lane1.bodies, ...lane2.bodies]).toEqual([])
    })

    it('publishes a queued preview and completes its job', async () => {
        const {body, env} = await createQueuedTask()
        const {ack, message, retry} = createMessage(body)

        await consumeMediaPreviewRegenerationQueue(createBatch(message), env)

        expect(ack).toHaveBeenCalledOnce()
        expect(retry).not.toHaveBeenCalled()
        await expectCompletedJobSummary({processedVariants: 1, regeneratedPreviews: 1})
        await expect(queryOne('SELECT task_id FROM media_preview_regeneration_items WHERE run_id = ?', [runId])).resolves.toBeNull()
    })

    it('retries after a container disconnect and completes on the next delivery', async () => {
        const {body, env} = await createQueuedTask([new Error('Container stopped'), validPreviewResponse()])
        const first = createMessage(body)

        await consumeMediaPreviewRegenerationQueue(createBatch(first.message), env)

        expect(first.ack).not.toHaveBeenCalled()
        expect(first.retry).toHaveBeenCalledWith({delaySeconds: 1})
        expect(
            await queryOne<{status: string}>('SELECT status FROM media_preview_regeneration_items WHERE task_id = ?', [body.taskId]),
        ).toEqual({
            status: 'pending',
        })

        const second = createMessage(body, 2)
        await consumeMediaPreviewRegenerationQueue(createBatch(second.message), env)

        expect(second.ack).toHaveBeenCalledOnce()
        expect(second.retry).not.toHaveBeenCalled()
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId])).toEqual({status: 'success'})
    })

    it('moves a permanent failure to the dead-letter queue after three deliveries', async () => {
        const {body, deadLetter, env} = await createQueuedTask(new Response(null, {status: 400}))
        const {ack, message, retry} = createMessage(body, 3)

        await consumeMediaPreviewRegenerationQueue(createBatch(message), env)

        expect(ack).toHaveBeenCalledOnce()
        expect(retry).not.toHaveBeenCalled()
        expect(deadLetter.bodies).toEqual([expect.objectContaining({taskId: body.taskId, error: 'Container preview failed with 400'})])
        await expectCompletedJobSummary({processedVariants: 1, failedVariants: 1})
    })

    it('moves invalid stored task data to the dead-letter queue', async () => {
        const {body, deadLetter, env} = await createQueuedTask()
        await db.prepare(`UPDATE media_preview_regeneration_items SET candidate_json = '{}' WHERE task_id = ?`).bind(body.taskId).run()
        const {ack, message} = createMessage(body)

        await consumeMediaPreviewRegenerationQueue(createBatch(message), env)

        expect(ack).toHaveBeenCalledOnce()
        expect(deadLetter.bodies).toEqual([
            expect.objectContaining({taskId: body.taskId, error: 'Stored media preview task data is invalid'}),
        ])
    })

    it('delays a duplicate delivery while the first task lease is active', async () => {
        const {body, env} = await createQueuedTask()
        await claimMediaPreviewRegenerationTask(db, body.taskId, new Date('2026-09-04T12:00:00Z'))
        const {ack, message, retry} = createMessage(body, 2)

        await consumeMediaPreviewRegenerationQueue(createBatch(message), env, () => new Date('2026-09-04T12:00:01Z'))

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

        await consumeMediaPreviewRegenerationQueue(createBatch(message), env)

        expect(ack).not.toHaveBeenCalled()
        expect(retry).toHaveBeenCalledWith({delaySeconds: 1})
    })

    it('acknowledges malformed and completed deliveries', async () => {
        const {body, env} = await createQueuedTask()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const malformed = createMessage({version: 2})
            await consumeMediaPreviewRegenerationQueue(createBatch(malformed.message), env)
            expect(malformed.ack).toHaveBeenCalledOnce()

            const unknown = createMessage({...body, runId: 'missing-run', taskId: 'missing-task'})
            await consumeMediaPreviewRegenerationQueue(createBatch(unknown.message), env)
            expect(unknown.ack).toHaveBeenCalledOnce()

            const first = createMessage(body)
            await consumeMediaPreviewRegenerationQueue(createBatch(first.message), env)
            const duplicate = createMessage(body, 2)
            await consumeMediaPreviewRegenerationQueue(createBatch(duplicate.message), env)
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
            await consumeMediaPreviewRegenerationQueue(createBatch(message), failingEnv)
            expect(ack).not.toHaveBeenCalled()
            expect(retry).toHaveBeenCalledWith({delaySeconds: 60})
        } finally {
            error.mockRestore()
        }
    })
})
