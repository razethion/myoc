import {describe, expect, it, vi} from 'vitest'
import worker from '../../index'
import {queryOne, seedUser, useTestDatabase} from '../../test/d1'
import type {Bindings} from '../../types/bindings'
import {consumeImageProcessingDeadLetterQueue} from './deadLetterQueue'
import {getAdminErrorLogs} from './errorLog'

const db = useTestDatabase()
const now = new Date('2026-09-04T12:00:00Z')
const imageProcessingQueue = {send: vi.fn(async () => undefined)} as unknown as Bindings['IMAGE_PROCESSING_QUEUE']
const dlqEnv = {DB: db, IMAGE_PROCESSING_QUEUE: imageProcessingQueue}

type Delivery = {
    ack: ReturnType<typeof vi.fn>
    body: unknown
    id: string
    retry: ReturnType<typeof vi.fn>
}

function createDelivery(body: unknown, attempts = 1, id = crypto.randomUUID()): Delivery & {message: Message} {
    const ack = vi.fn()
    const retry = vi.fn()
    return {
        ack,
        body,
        id,
        message: {
            ack,
            attempts,
            body,
            id,
            retry,
            timestamp: now,
        } as unknown as Message,
        retry,
    }
}

function batch(message: Message): MessageBatch {
    return {
        ackAll: vi.fn(),
        messages: [message],
        metadata: {metrics: {backlogBytes: 0, backlogCount: 0}},
        queue: 'dead-letter-queue',
        retryAll: vi.fn(),
    }
}

async function seedImageTask(states: {job: string; task: string} = {job: 'ready', task: 'ready'}) {
    const jobId = crypto.randomUUID()
    const sourceId = crypto.randomUUID()
    const taskId = crypto.randomUUID()
    await seedUser({id: 'dlq-user'})
    await db.batch([
        db
            .prepare(
                `INSERT INTO image_upload_jobs (
                    id, user_id, target_type, target_id, state, idempotency_key, request_json, deadline_at
                 ) VALUES (?, 'dlq-user', 'user_profile', 'dlq-user', ?, ?, '{"kind":"user-profile","targetId":"dlq-user"}', '2099-01-01 00:00:00')`,
            )
            .bind(jobId, states.job, `dlq-${jobId}`),
        db
            .prepare(
                `INSERT INTO image_upload_sources (id, job_id, state, object_key, content_type)
                 VALUES (?, ?, 'ready', ?, 'image/png')`,
            )
            .bind(sourceId, jobId, `image-sources/dlq-user/${jobId}/${sourceId}.png`),
        db
            .prepare(
                `INSERT INTO image_processing_tasks (
                    id, job_id, source_id, run_id, recipe, container_slot, state
                 ) VALUES (?, ?, ?, ?, 'user-profile-v1', 0, ?)`,
            )
            .bind(taskId, jobId, sourceId, crypto.randomUUID(), states.task),
    ])
    return {jobId, taskId}
}

async function imageStates(jobId: string, taskId: string) {
    return {
        job: await queryOne<{state: string}>('SELECT state FROM image_upload_jobs WHERE id = ?', [jobId], db),
        task: await queryOne<{state: string}>('SELECT state FROM image_processing_tasks WHERE id = ?', [taskId], db),
    }
}

describe('dead-letter queue consumers', () => {
    it('routes an image dead-letter delivery to the error log with the current time', async () => {
        const delivery = createDelivery({version: 1, kind: 'upload', taskId: crypto.randomUUID()})
        const queue = 'myoc-image-processing-dlq'
        await worker.queue(
            {...batch(delivery.message), queue},
            {DB: db, IMAGE_PROCESSING_DLQ_NAME: queue} as Bindings,
            {} as ExecutionContext,
        )
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(await getAdminErrorLogs(db)).toEqual([
            expect.objectContaining({source: 'image-processing', messageId: delivery.id, jobId: null}),
        ])
    })

    it('records an exhausted raw image upload delivery once and keeps its current task and job state', async () => {
        const {jobId, taskId} = await seedImageTask({job: 'processing', task: 'processing'})
        const delivery = createDelivery({version: 1, kind: 'upload', taskId})

        await consumeImageProcessingDeadLetterQueue(batch(delivery.message), dlqEnv, () => now)
        await consumeImageProcessingDeadLetterQueue(batch(createDelivery(delivery.body, 2, delivery.id).message), dlqEnv, () => now)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(await getAdminErrorLogs(db)).toEqual([
            expect.objectContaining({
                source: 'image-processing',
                messageId: delivery.id,
                jobId,
                taskId,
                errorCode: 'queue_delivery_exhausted',
                errorMessage: 'Image processing stopped after all Queue delivery retries.',
            }),
        ])
        expect(await imageStates(jobId, taskId)).toEqual({job: {state: 'processing'}, task: {state: 'processing'}})
    })

    it('records a stale enriched image upload failure without changing the newer task or job state', async () => {
        const {jobId, taskId} = await seedImageTask()
        const delivery = createDelivery({
            version: 1,
            kind: 'upload',
            taskId,
            failureId: 'failure-event-1',
            jobId,
            errorCode: 'container_failed',
            error: 'The previous run could not reach the image processor.',
        })

        await consumeImageProcessingDeadLetterQueue(batch(delivery.message), dlqEnv, () => now)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(await getAdminErrorLogs(db)).toEqual([
            expect.objectContaining({
                messageId: 'failure-event-1',
                jobId,
                taskId,
                errorCode: 'container_failed',
                errorMessage: 'The previous run could not reach the image processor.',
            }),
        ])
        expect(await imageStates(jobId, taskId)).toEqual({job: {state: 'ready'}, task: {state: 'ready'}})
    })

    it('records malformed deliveries with a generic error and acknowledges them', async () => {
        const image = createDelivery({version: 2})
        const second = createDelivery({version: 2})

        await consumeImageProcessingDeadLetterQueue(batch(image.message), dlqEnv, () => now)
        await consumeImageProcessingDeadLetterQueue(batch(second.message), dlqEnv, () => now)

        expect(image.ack).toHaveBeenCalledOnce()
        expect(second.ack).toHaveBeenCalledOnce()
        expect(image.retry).not.toHaveBeenCalled()
        expect(second.retry).not.toHaveBeenCalled()
        expect(await getAdminErrorLogs(db)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({source: 'image-processing', messageId: image.id, errorCode: 'invalid_dead_letter_message'}),
                expect.objectContaining({
                    source: 'image-processing',
                    messageId: second.id,
                    errorCode: 'invalid_dead_letter_message',
                }),
            ]),
        )
    })

    it('records raw and stale enriched preview failures once without retrying successful log writes', async () => {
        const raw = createDelivery({version: 1, kind: 'media-regeneration', taskId: 'old-task', runId: 'new-run'})
        const enriched = createDelivery({
            version: 1,
            kind: 'media-regeneration',
            taskId: 'old-task',
            runId: 'new-run',
            errorCode: 'preview_generation_failed',
            error: 'The old preview task failed.',
        })

        await consumeImageProcessingDeadLetterQueue(batch(raw.message), dlqEnv, () => now)
        await consumeImageProcessingDeadLetterQueue(batch(enriched.message), dlqEnv, () => now)
        await consumeImageProcessingDeadLetterQueue(batch(createDelivery(enriched.body, 2, crypto.randomUUID()).message), dlqEnv, () => now)

        expect(raw.ack).toHaveBeenCalledOnce()
        expect(enriched.ack).toHaveBeenCalledOnce()
        expect(raw.retry).not.toHaveBeenCalled()
        expect(enriched.retry).not.toHaveBeenCalled()
        expect(await getAdminErrorLogs(db)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    source: 'media-preview-regeneration',
                    messageId: raw.id,
                    jobId: 'new-run',
                    taskId: 'old-task',
                    errorCode: 'queue_delivery_exhausted',
                }),
                expect.objectContaining({
                    source: 'media-preview-regeneration',
                    messageId: 'new-run:old-task',
                    jobId: 'new-run',
                    taskId: 'old-task',
                    errorCode: 'preview_generation_failed',
                }),
            ]),
        )
        expect(await getAdminErrorLogs(db)).toHaveLength(2)
    })

    it('records a thumbnail failure from the shared dead-letter queue', async () => {
        const delivery = createDelivery({
            version: 1,
            kind: 'thumbnail-regeneration',
            taskId: 'thumbnail-task',
            runId: 'thumbnail-run',
            errorCode: 'thumbnail_generation_failed',
            error: 'The thumbnail could not be generated.',
        })

        await consumeImageProcessingDeadLetterQueue(batch(delivery.message), dlqEnv, () => now)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(await getAdminErrorLogs(db)).toEqual([
            expect.objectContaining({
                source: 'image-processing',
                messageId: 'thumbnail-run:thumbnail-task',
                jobId: 'thumbnail-run',
                taskId: 'thumbnail-task',
                errorCode: 'thumbnail_generation_failed',
            }),
        ])
    })

    it('retries dead-letter deliveries when the error log cannot be written', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const image = createDelivery({version: 2}, 8)
        const second = createDelivery({version: 2}, 8)
        const unavailable = {
            DB: {
                prepare: () => {
                    throw new Error('D1 is unavailable')
                },
            },
            IMAGE_PROCESSING_QUEUE: imageProcessingQueue,
        } as unknown as Pick<Bindings, 'DB' | 'IMAGE_PROCESSING_QUEUE'>

        try {
            await consumeImageProcessingDeadLetterQueue(batch(image.message), unavailable, () => now)
            await consumeImageProcessingDeadLetterQueue(batch(second.message), unavailable, () => now)
        } finally {
            error.mockRestore()
        }

        expect(image.ack).not.toHaveBeenCalled()
        expect(second.ack).not.toHaveBeenCalled()
        expect(image.retry).toHaveBeenCalledWith({delaySeconds: 60})
        expect(second.retry).toHaveBeenCalledWith({delaySeconds: 60})
    })
})
