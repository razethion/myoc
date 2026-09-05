import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedFolder, seedUser, useTestDatabase, withFailingTrigger} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import type {Bindings} from '../../types/bindings'
import type {ImageProcessingFailureMessage, ImageUploadProcessingMessage} from '../../types/imageProcessing'
import {
    cancelImageUploadJob,
    consumeImageUploadProcessingMessage,
    createGalleryImageUploadJob,
    createSquareImageUploadJob,
    getImageUploadBatchStatus,
    getImageUploadStatus,
    ImageUploadConflictError,
    ImageUploadValidationError,
    reconcileImageUploads,
    retryImageUploadJob,
} from './imageUploadJobs'
import {thumbnailOriginalObjectKey} from './thumbnailSources'
import {characterMediaImageObjectKey} from './url'

const db = useTestDatabase()
const now = new Date('2026-09-04T12:00:00Z')

type QueuedMessage = {body: ImageUploadProcessingMessage}

function createQueue<T = ImageUploadProcessingMessage>() {
    const messages: Array<{body: T}> = []
    const queue = {
        send: vi.fn(async (body: T) => {
            messages.push({body})
        }),
    }
    return {messages, queue: queue as unknown as Queue<T>}
}

function createContainer(handler: (request: Request) => Response | Promise<Response>) {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init)
        return handler(request)
    })
    return {
        fetch,
        namespace: {
            idFromName: vi.fn((name: string) => name),
            get: vi.fn(() => ({fetch})),
        } as unknown as DurableObjectNamespace,
    }
}

function galleryResponse(includeBlur: boolean, width = 100, height = 80): Response {
    const preview = createAvifBytes(width, height)
    const blur = includeBlur ? createAvifBytes(width, height) : new Uint8Array()
    const bytes = new Uint8Array(preview.byteLength + blur.byteLength)
    bytes.set(preview)
    bytes.set(blur, preview.byteLength)
    return new Response(bytes, {
        headers: {
            'x-preview-length': String(preview.byteLength),
            ...(includeBlur ? {'x-blur-length': String(blur.byteLength)} : {}),
        },
    })
}

function createEnv(
    handler: (request: Request) => Response | Promise<Response> = (request) =>
        new URL(request.url).pathname === '/images/gallery'
            ? galleryResponse(new URL(request.url).searchParams.get('blur') === '1')
            : new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}}),
) {
    const processing = createQueue()
    const deadLetter = createQueue<ImageProcessingFailureMessage>()
    const container = createContainer(handler)
    const mediaBucket = createMockR2Bucket()
    const sourceBucket = mediaBucket
    const env = {
        DB: db,
        IMAGE_PROCESSING_QUEUE: processing.queue,
        IMAGE_PROCESSING_DLQ: deadLetter.queue,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        MYOC_DOCKER_SHARP_CONTAINER: container.namespace,
        OBJECT_STORAGE_ENCRYPTION_KEY: '11'.repeat(32),
        PREVIEW_PROCESSOR_TOKEN: 'processor-token',
    } as unknown as Bindings

    return {container, deadLetter, env, lanes: [processing], mediaBucket, sourceBucket}
}

async function pngBytes(width = 512, height = 512): Promise<Uint8Array> {
    return new Uint8Array(await createPngFile(width, height).arrayBuffer())
}

function queuedMessages(lanes: Array<{messages: QueuedMessage[]}>): QueuedMessage[] {
    return lanes.flatMap((lane) => lane.messages)
}

function firstQueuedMessage(lanes: Array<{messages: QueuedMessage[]}>): QueuedMessage {
    const message = queuedMessages(lanes)[0]
    if (!message) throw new Error('Expected one queued image task')
    return message
}

function queueMessage(body: ImageUploadProcessingMessage, attempts = 1) {
    const ack = vi.fn()
    const retry = vi.fn()
    const message = {
        ack,
        attempts,
        body,
        id: crypto.randomUUID(),
        retry,
        timestamp: now,
    } as unknown as Message
    return {ack, message, retry}
}

async function consumeQueued(env: Bindings, queued: QueuedMessage, attempts = 1) {
    const message = queueMessage(queued.body, attempts)
    await consumeImageUploadProcessingMessage(message.message, queued.body, env, () => now)
    return message
}

async function createSingleGalleryJob(setup: ReturnType<typeof createEnv>, rating: 'sfw' | 'nsfw' = 'sfw') {
    const objectKey = `image-staging/${characterMediaImageObjectKey(
        'user-1',
        'character-1',
        'media-1',
        `${rating}-source`,
        rating,
        'image/png',
    )}`
    const bytes = await pngBytes(100, 80)
    await setup.sourceBucket.put(objectKey, bytes)
    const job = await createGalleryImageUploadJob(setup.env, {
        userId: 'user-1',
        characterId: 'character-1',
        mediaId: 'media-1',
        idempotencyKey: `gallery-${rating}-job`,
        sfwArtist: 'Artist A',
        nsfwArtist: 'Artist B',
        sources: [
            {
                rating,
                objectKey,
                contentType: 'image/png',
                byteSize: bytes.byteLength,
                width: 100,
                height: 80,
                displayWidth: 100,
                displayHeight: 80,
            },
        ],
        now,
    })
    return {job, queued: firstQueuedMessage(setup.lanes), sourceKey: objectKey}
}

describe('image upload jobs', () => {
    it('publishes a user profile AVIF and keeps the source for a later recipe', async () => {
        await seedUser({id: 'user-1', profilePhotoKey: 'old-photo'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'profile-upload-1',
            batchId: 'batch-1',
            bytes: await pngBytes(),
            now,
        })

        expect(job.state).toBe('waiting')
        expect(queuedMessages(setup.lanes)).toHaveLength(1)
        const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        const ready = await getImageUploadStatus(db, 'user-1', job.id)
        expect(ready).toMatchObject({state: 'ready', kind: 'user-profile', batchId: 'batch-1'})
        expect(ready?.result).toMatchObject({contentType: 'image/avif'})
        const user = await queryOne<{profile_photo_key: string; profile_photo_content_type: string}>(
            'SELECT profile_photo_key, profile_photo_content_type FROM users WHERE id = ?',
            ['user-1'],
            db,
        )
        expect(user?.profile_photo_key).toMatch(/^avif-/)
        expect(user?.profile_photo_content_type).toBe('image/avif')
        expect(await setup.sourceBucket.list()).toHaveProperty('objects.length', 3)
        const outputKey = (ready?.result?.objectKey as string | undefined) ?? ''
        const retained = await setup.sourceBucket.get(thumbnailOriginalObjectKey(outputKey))
        expect(retained).not.toBeNull()
        if (!retained) throw new Error('Expected a retained thumbnail source')
        expect(new Uint8Array(await retained.arrayBuffer())).toEqual(await pngBytes())
        expect(await getImageUploadBatchStatus(db, 'user-1', 'batch-1')).toHaveLength(1)
    })

    it.each([
        ['character-profile', 'character_profile', 'character-1'],
        ['folder-image', 'folder_image', 'folder-1'],
    ] as const)('publishes a %s image for an owned target', async (kind, targetType, targetId) => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        await seedFolder({id: 'folder-1', userId: 'user-1'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind,
            targetId,
            idempotencyKey: `upload-${kind}`,
            bytes: await pngBytes(),
            now,
        })

        await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'ready'})
        expect(await queryOne<{target_type: string}>('SELECT target_type FROM image_upload_jobs WHERE id = ?', [job.id], db)).toEqual({
            target_type: targetType,
        })
    })

    it('returns an existing job for the same request and rejects an idempotency conflict', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const input = {
            userId: 'user-1',
            kind: 'user-profile' as const,
            targetId: 'user-1',
            idempotencyKey: 'same-key',
            bytes: await pngBytes(),
            now,
        }
        const first = await createSquareImageUploadJob(setup.env, input)

        await expect(createSquareImageUploadJob(setup.env, input)).resolves.toEqual(first)
        await expect(createSquareImageUploadJob(setup.env, {...input, kind: 'folder-image', targetId: 'folder-1'})).rejects.toBeInstanceOf(
            ImageUploadConflictError,
        )
        expect(queuedMessages(setup.lanes)).toHaveLength(1)
    })

    it('cleans up a staged square source when the D1 transaction fails', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        await expect(
            withFailingTrigger(
                {name: 'image_job_insert_failure', operation: 'INSERT', table: 'image_upload_jobs'},
                () =>
                    createSquareImageUploadJob(setup.env, {
                        userId: 'user-1',
                        kind: 'user-profile',
                        targetId: 'user-1',
                        idempotencyKey: 'failed-insert',
                        bytes: new Uint8Array(),
                        now,
                    }),
                db,
            ),
        ).rejects.toBeInstanceOf(ImageUploadValidationError)

        const bytes = await pngBytes()
        await expect(
            withFailingTrigger(
                {name: 'image_job_insert_failure', operation: 'INSERT', table: 'image_upload_jobs'},
                () =>
                    createSquareImageUploadJob(setup.env, {
                        userId: 'user-1',
                        kind: 'user-profile',
                        targetId: 'user-1',
                        idempotencyKey: 'failed-insert-valid',
                        bytes,
                        now,
                    }),
                db,
            ),
        ).rejects.toThrow()
        expect(await setup.sourceBucket.list()).toHaveProperty('objects.length', 0)
    })

    it('rejects invalid square sources and targets before it creates work', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const base = {
            userId: 'user-1',
            kind: 'user-profile' as const,
            targetId: 'user-1',
            idempotencyKey: 'invalid-upload',
            now,
        }

        await expect(createSquareImageUploadJob(setup.env, {...base, bytes: new Uint8Array()})).rejects.toBeInstanceOf(
            ImageUploadValidationError,
        )
        await expect(createSquareImageUploadJob(setup.env, {...base, bytes: await pngBytes(10, 10)})).rejects.toBeInstanceOf(
            ImageUploadValidationError,
        )
        await expect(
            createSquareImageUploadJob(setup.env, {...base, targetId: 'other-user', bytes: await pngBytes()}),
        ).rejects.toBeInstanceOf(ImageUploadValidationError)
        await expect(
            createSquareImageUploadJob(setup.env, {
                ...base,
                kind: 'character-profile',
                targetId: 'missing-character',
                bytes: await pngBytes(),
            }),
        ).rejects.toBeInstanceOf(ImageUploadValidationError)
        expect(await queryAll<{id: string}>('SELECT id FROM image_upload_jobs', [], db)).toEqual([])
    })

    it('cancels active work and makes a late Queue delivery a no-op', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'cancel-job',
            bytes: await pngBytes(),
            now,
        })

        await expect(cancelImageUploadJob(db, 'user-1', job.id, now)).resolves.toBe(true)
        await expect(cancelImageUploadJob(db, 'user-1', job.id, now)).resolves.toBe(false)
        const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(setup.container.fetch).not.toHaveBeenCalled()
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'canceled'})
        expect(await queryAll<{bucket: string}>('SELECT bucket FROM image_cleanup_tasks', [], db)).toEqual([{bucket: 'source'}])
    })

    it('does not use a Sharp attempt when all containers are busy', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv(() => new Response('busy', {status: 429}))
        await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'busy-job',
            bytes: await pngBytes(),
            now,
        })

        const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        expect(delivery.retry).toHaveBeenCalledWith({delaySeconds: 1})
        expect(
            await queryOne<{state: string; sharp_attempts: number}>('SELECT state, sharp_attempts FROM image_processing_tasks', [], db),
        ).toEqual({
            state: 'queued',
            sharp_attempts: 0,
        })
    })

    it('records three temporary processor failures and then permits an explicit retry run', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv(() => new Response('failed', {status: 503}))
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'failed-job',
            bytes: await pngBytes(),
            now,
        })
        const queued = firstQueuedMessage(setup.lanes)

        expect((await consumeQueued(setup.env, queued, 1)).retry).toHaveBeenCalledWith({delaySeconds: 1})
        expect((await consumeQueued(setup.env, queued, 2)).retry).toHaveBeenCalledWith({delaySeconds: 3})
        expect((await consumeQueued(setup.env, queued, 3)).ack).toHaveBeenCalledOnce()
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({
            state: 'failed',
            error: {code: 'processor_failed'},
        })
        expect(await queryAll<{id: string}>('SELECT id FROM image_processing_attempts', [], db)).toHaveLength(3)
        expect(setup.deadLetter.messages).toEqual([
            {
                body: expect.objectContaining({
                    error: 'Image processing failed. Try again.',
                    errorCode: 'processor_failed',
                    jobId: job.id,
                }),
            },
        ])
        expect(await queryAll<{message_id: string}>('SELECT message_id FROM admin_error_logs', [], db)).toHaveLength(1)

        const [retried, duplicateRetry] = await Promise.all([
            retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-run-1', now),
            retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-run-1', now),
        ])
        expect(duplicateRetry).toEqual(retried)
        expect(await queryAll('SELECT id FROM image_queue_outbox', [], db)).toHaveLength(2)
        expect(retried).toMatchObject({state: 'waiting'})
        await expect(retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-run-1', now)).resolves.toEqual(retried)
        expect(
            await queryOne<{failure_event_id: string | null; failure_reported_at: string | null}>(
                'SELECT failure_event_id, failure_reported_at FROM image_processing_tasks',
                [],
                db,
            ),
        ).toEqual({failure_event_id: null, failure_reported_at: null})
    })

    it('rejects one of two concurrent retries that use different keys', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv(() => new Response('invalid', {status: 422}))
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'concurrent-retry-job',
            bytes: await pngBytes(),
            now,
        })
        await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        const results = await Promise.allSettled([
            retryImageUploadJob(setup.env, 'user-1', job.id, 'concurrent-retry-a', now),
            retryImageUploadJob(setup.env, 'user-1', job.id, 'concurrent-retry-b', now),
        ])

        expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
        for (const result of results) {
            if (result.status === 'fulfilled') {
                expect(result.value).toMatchObject({state: 'waiting'})
            } else {
                expect(result.reason).toBeInstanceOf(ImageUploadConflictError)
            }
        }
        expect(queuedMessages(setup.lanes)).toHaveLength(2)
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'waiting'})
    })

    it('does not let a worker with an expired lease publish a square output', async () => {
        await seedUser({id: 'user-1', profilePhotoKey: 'old-photo'})
        let taskId = ''
        const setup = createEnv(async () => {
            await db
                .prepare(`UPDATE image_processing_tasks SET state = 'queued', lease_id = NULL, lease_expires_at = NULL WHERE id = ?`)
                .bind(taskId)
                .run()
            return new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}})
        })
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'expired-lease-success',
            bytes: await pngBytes(),
            now,
        })
        taskId = firstQueuedMessage(setup.lanes).body.taskId

        await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        expect(await queryOne<{profile_photo_key: string}>('SELECT profile_photo_key FROM users WHERE id = ?', ['user-1'], db)).toEqual({
            profile_photo_key: 'old-photo',
        })
        expect(await queryAll('SELECT id FROM image_processing_attempts', [], db)).toEqual([])
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'waiting'})
        expect(await queryAll<{bucket: string}>('SELECT bucket FROM image_cleanup_tasks ORDER BY bucket', [], db)).toEqual([
            {bucket: 'media'},
            {bucket: 'source'},
        ])
    })

    it('does not let a worker with an expired lease fail a current task', async () => {
        await seedUser({id: 'user-1'})
        let taskId = ''
        const setup = createEnv(async () => {
            await db
                .prepare(`UPDATE image_processing_tasks SET state = 'queued', lease_id = NULL, lease_expires_at = NULL WHERE id = ?`)
                .bind(taskId)
                .run()
            return new Response('invalid', {status: 422})
        })
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'expired-lease-failure',
            bytes: await pngBytes(),
            now,
        })
        taskId = firstQueuedMessage(setup.lanes).body.taskId

        await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

        expect(await queryAll('SELECT id FROM image_processing_attempts', [], db)).toEqual([])
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'waiting'})
        expect(setup.deadLetter.messages).toEqual([])
    })

    it('fails a permanent image response without a Queue retry', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv(() => new Response('invalid', {status: 422}))
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'invalid-output',
            bytes: await pngBytes(),
            now,
        })

        const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'failed', error: {code: 'invalid_image'}})
    })

    it('fails a task when its retained source is missing', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'missing-source',
            bytes: await pngBytes(),
            now,
        })
        const source = await queryOne<{object_key: string}>('SELECT object_key FROM image_upload_sources WHERE job_id = ?', [job.id], db)
        await setup.sourceBucket.delete(source?.object_key ?? '')

        const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'failed', error: {code: 'source_unavailable'}})
    })

    it('deletes a retained output source when the public R2 write fails', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'media-write-failure',
            bytes: await pngBytes(),
            now,
        })
        vi.mocked(setup.mediaBucket.put)
            .mockResolvedValueOnce({} as R2Object)
            .mockRejectedValueOnce(new Error('R2 write failed'))

        try {
            const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))
            expect(delivery.retry).toHaveBeenCalledOnce()
            const retainedKey = vi.mocked(setup.sourceBucket.put).mock.calls[1]?.[0]
            expect(retainedKey).toMatch(/^thumbnail-originals\/users\/user-1\/profile\/.+\.avif\.source$/)
            expect(setup.sourceBucket.delete).toHaveBeenCalledWith(retainedKey)
            expect(setup.mediaBucket.delete).toHaveBeenCalledWith(
                (retainedKey as string).slice('thumbnail-originals/'.length, -'.source'.length),
            )
        } finally {
            error.mockRestore()
        }
    })

    it('queues an unpublished square output for cleanup after a cancel race', async () => {
        await seedUser({id: 'user-1'})
        let jobId = ''
        const setup = createEnv(async () => {
            await db.prepare(`UPDATE image_upload_jobs SET state = 'canceled' WHERE id = ?`).bind(jobId).run()
            return new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}})
        })
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'cancel-race',
            bytes: await pngBytes(),
            now,
        })
        jobId = job.id

        await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))
        expect(await queryOne<{state: string}>('SELECT state FROM image_upload_jobs WHERE id = ?', [job.id], db)).toEqual({
            state: 'canceled',
        })
        const cleanup = await queryAll<{bucket: string; object_key: string}>(
            'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
            [],
            db,
        )
        expect(cleanup).toHaveLength(2)
        const mediaCleanup = cleanup.find((task) => task.bucket === 'media')
        expect(mediaCleanup).toBeDefined()
        expect(cleanup).toContainEqual({bucket: 'source', object_key: thumbnailOriginalObjectKey(mediaCleanup?.object_key ?? '')})
    })

    it('publishes an SFW and NSFW gallery pair only after both outputs are ready', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        const setup = createEnv()
        const sources = []

        for (const rating of ['sfw', 'nsfw'] as const) {
            const objectKey = `image-staging/${characterMediaImageObjectKey(
                'user-1',
                'character-1',
                'media-1',
                `${rating}-source`,
                rating,
                'image/png',
            )}`
            const bytes = await pngBytes(100, 80)
            await setup.sourceBucket.put(objectKey, bytes)
            sources.push({
                rating,
                objectKey,
                contentType: 'image/png',
                byteSize: bytes.byteLength,
                width: 100,
                height: 80,
                displayWidth: 100,
                displayHeight: 80,
            })
        }

        const job = await createGalleryImageUploadJob(setup.env, {
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            idempotencyKey: 'gallery-pair-1',
            sfwArtist: 'Artist A',
            nsfwArtist: 'Artist B',
            sources,
            now,
        })
        const queued = queuedMessages(setup.lanes)
        expect(queued).toHaveLength(2)
        const first = queued[0]
        const second = queued[1]
        if (!first || !second) throw new Error('Expected two queued gallery tasks')

        await consumeQueued(setup.env, first)
        expect(await queryAll<{id: string}>('SELECT id FROM character_media', [], db)).toEqual([])
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'waiting'})

        await consumeQueued(setup.env, second)
        expect(
            await queryOne<{sfw_preview_content_type: string; nsfw_blur_content_type: string}>(
                'SELECT sfw_preview_content_type, nsfw_blur_content_type FROM character_media WHERE id = ?',
                ['media-1'],
                db,
            ),
        ).toEqual({sfw_preview_content_type: 'image/avif', nsfw_blur_content_type: 'image/avif'})
        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'ready', kind: 'gallery'})
        expect(await queryAll<{media_id: string}>('SELECT media_id FROM admin_image_review_queue', [], db)).toEqual([{media_id: 'media-1'}])
    })

    it('rejects invalid gallery source sets and foreign targets', async () => {
        await seedUser({id: 'user-1'})
        await seedUser({id: 'user-2'})
        await seedCharacter({id: 'character-2', userId: 'user-2'})
        const setup = createEnv()
        const input = {
            userId: 'user-1',
            characterId: 'character-2',
            mediaId: 'media-1',
            idempotencyKey: 'gallery-invalid',
            sfwArtist: '',
            nsfwArtist: '',
            sources: [],
            now,
        }

        await expect(createGalleryImageUploadJob(setup.env, input)).rejects.toBeInstanceOf(ImageUploadValidationError)
        await expect(
            createGalleryImageUploadJob(setup.env, {
                ...input,
                sources: [
                    {
                        rating: 'sfw',
                        objectKey: 'source.png',
                        contentType: 'image/png',
                        byteSize: 10,
                        width: 10,
                        height: 10,
                        displayWidth: 10,
                        displayHeight: 10,
                    },
                ],
            }),
        ).rejects.toBeInstanceOf(ImageUploadValidationError)
    })

    it('returns the existing gallery job and rejects a changed idempotent request', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        const setup = createEnv()
        const created = await createSingleGalleryJob(setup)
        const source = {
            rating: 'sfw' as const,
            objectKey: created.sourceKey,
            contentType: 'image/png',
            byteSize: 33,
            width: 100,
            height: 80,
            displayWidth: 100,
            displayHeight: 80,
        }
        const same = {
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-1',
            idempotencyKey: 'gallery-sfw-job',
            sfwArtist: 'Artist A',
            nsfwArtist: 'Artist B',
            sources: [source],
            now,
        }

        await expect(createGalleryImageUploadJob(setup.env, same)).resolves.toEqual(created.job)
        await expect(createGalleryImageUploadJob(setup.env, {...same, sfwArtist: 'Changed'})).rejects.toBeInstanceOf(
            ImageUploadConflictError,
        )
    })

    it('handles gallery capacity, processing, and metadata failures', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})

        const busySetup = createEnv(() => new Response('busy', {status: 429}))
        const busy = await createSingleGalleryJob(busySetup)
        expect((await consumeQueued(busySetup.env, busy.queued)).retry).toHaveBeenCalledWith({delaySeconds: 1})

        await db.prepare(`DELETE FROM image_upload_jobs WHERE id != ''`).run()
        const failedSetup = createEnv(() => new Response('failed', {status: 503}))
        const failed = await createSingleGalleryJob(failedSetup)
        expect((await consumeQueued(failedSetup.env, failed.queued)).retry).toHaveBeenCalledWith({delaySeconds: 1})

        await db.prepare(`DELETE FROM image_upload_jobs WHERE id != ''`).run()
        const invalidSetup = createEnv()
        const invalid = await createSingleGalleryJob(invalidSetup)
        await db.prepare(`UPDATE image_upload_sources SET width = NULL WHERE job_id = ?`).bind(invalid.job.id).run()
        expect((await consumeQueued(invalidSetup.env, invalid.queued)).ack).toHaveBeenCalledOnce()
        expect(await getImageUploadStatus(db, 'user-1', invalid.job.id)).toMatchObject({state: 'failed', error: {code: 'source_invalid'}})
    })

    it('fails a gallery task if its source disappears during processing', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        let sourceKey = ''
        const setup = createEnv(async (request) => {
            await setup.sourceBucket.delete(sourceKey)
            return galleryResponse(new URL(request.url).searchParams.get('blur') === '1')
        })
        const created = await createSingleGalleryJob(setup)
        sourceKey = created.sourceKey

        const delivery = await consumeQueued(setup.env, created.queued)
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(await getImageUploadStatus(db, 'user-1', created.job.id)).toMatchObject({state: 'failed'})
    })

    it.each(['sfw', 'nsfw'] as const)('removes stale %s gallery derivatives after the task lease expires', async (rating) => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        let taskId = ''
        const setup = createEnv(async (request) => {
            await db
                .prepare(`UPDATE image_processing_tasks SET state = 'queued', lease_id = NULL, lease_expires_at = NULL WHERE id = ?`)
                .bind(taskId)
                .run()
            return galleryResponse(new URL(request.url).searchParams.get('blur') === '1')
        })
        const created = await createSingleGalleryJob(setup, rating)
        taskId = created.queued.body.taskId

        const delivery = await consumeQueued(setup.env, created.queued)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(await getImageUploadStatus(db, 'user-1', created.job.id)).toMatchObject({state: 'waiting'})
        expect(await queryAll<{id: string}>('SELECT id FROM image_processing_attempts', [], db)).toEqual([])
        expect((await setup.mediaBucket.list()).objects.map((object) => object.key)).toEqual([created.sourceKey])
        expect(await queryAll<{id: string}>('SELECT id FROM character_media', [], db)).toEqual([])
    })

    it('queues gallery outputs for cleanup when cancel wins the publish race', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        let jobId = ''
        const setup = createEnv(async (request) => {
            await db.prepare(`UPDATE image_upload_jobs SET state = 'canceled' WHERE id = ?`).bind(jobId).run()
            return galleryResponse(new URL(request.url).searchParams.get('blur') === '1')
        })
        const created = await createSingleGalleryJob(setup, 'nsfw')
        jobId = created.job.id

        await consumeQueued(setup.env, created.queued)

        expect(await getImageUploadStatus(db, 'user-1', jobId)).toMatchObject({state: 'canceled'})
        expect(await queryAll<{object_key: string}>('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(3)
    })

    it('publishes a one-sided gallery and returns null fields for the absent rating', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        const setup = createEnv()
        const created = await createSingleGalleryJob(setup)

        await consumeQueued(setup.env, created.queued)
        const status = await getImageUploadStatus(db, 'user-1', created.job.id)
        expect(status).toMatchObject({state: 'ready', result: {media: {nsfwImageKey: null, nsfwImageUrl: null}}})
    })

    it('acknowledges a missing task without starting Sharp', async () => {
        const setup = createEnv()
        const body = {version: 1, kind: 'upload', taskId: crypto.randomUUID()} as const
        const missing = queueMessage(body)

        await consumeImageUploadProcessingMessage(missing.message, body, setup.env)

        expect(missing.ack).toHaveBeenCalledOnce()
        expect(setup.container.fetch).not.toHaveBeenCalled()
    })

    it('lets Queue retry a system failure without using a Sharp attempt', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'system-error',
            bytes: await pngBytes(),
            now,
        })
        vi.mocked(setup.sourceBucket.get).mockRejectedValueOnce('R2 failed')
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const delivery = await consumeQueued(setup.env, firstQueuedMessage(setup.lanes), 8)
            expect(delivery.retry).toHaveBeenCalledWith({delaySeconds: 60})
            expect(await queryOne<{sharp_attempts: number}>('SELECT sharp_attempts FROM image_processing_tasks', [], db)).toEqual({
                sharp_attempts: 0,
            })
        } finally {
            error.mockRestore()
        }
    })

    it('keeps an outbox row pending after a send failure and dispatches it later', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        for (const lane of setup.lanes) {
            vi.mocked(lane.queue.send).mockRejectedValueOnce(new Error('Queue unavailable'))
        }
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            await createSquareImageUploadJob(setup.env, {
                userId: 'user-1',
                kind: 'user-profile',
                targetId: 'user-1',
                idempotencyKey: 'outbox-retry',
                bytes: await pngBytes(),
                now,
            })
            expect(await queryOne<{state: string}>('SELECT state FROM image_queue_outbox', [], db)).toEqual({state: 'pending'})
            await reconcileImageUploads(setup.env, new Date(now.getTime() + 5_000))
            expect(await queryOne<{state: string}>('SELECT state FROM image_queue_outbox', [], db)).toEqual({state: 'sent'})
        } finally {
            error.mockRestore()
        }
    })

    it('reconciles a deadline and due cleanup work', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'deadline-job',
            bytes: await pngBytes(),
            now,
        })
        await setup.mediaBucket.put('stale-output.avif', new Uint8Array([1]))
        await db
            .prepare(
                `INSERT INTO image_cleanup_tasks (id, job_id, bucket, object_key, state, not_before, created_at, updated_at)
             VALUES ('cleanup-1', ?, 'media', 'stale-output.avif', 'pending', ?, ?, ?)`,
            )
            .bind(job.id, '2026-09-04 11:00:00', '2026-09-04 11:00:00', '2026-09-04 11:00:00')
            .run()

        await reconcileImageUploads(setup.env, new Date(now.getTime() + 16 * 60 * 1_000))

        expect(await getImageUploadStatus(db, 'user-1', job.id)).toMatchObject({state: 'failed', error: {code: 'deadline_exceeded'}})
        expect(await setup.mediaBucket.get('stale-output.avif')).toBeNull()
        expect(setup.deadLetter.messages).toEqual([{body: expect.objectContaining({errorCode: 'deadline_exceeded', jobId: job.id})}])
        expect(await queryOne<{state: string}>('SELECT state FROM image_cleanup_tasks WHERE id = ?', ['cleanup-1'], db)).toEqual({
            state: 'done',
        })
    })

    it('keeps a failed task pending when the failure queue is unavailable and reports it during reconciliation', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv(() => new Response('invalid', {status: 422}))
        vi.mocked(setup.deadLetter.queue.send)
            .mockRejectedValueOnce(new Error('Failure queue unavailable'))
            .mockRejectedValueOnce(new Error('Failure queue unavailable'))
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

        try {
            const job = await createSquareImageUploadJob(setup.env, {
                userId: 'user-1',
                kind: 'user-profile',
                targetId: 'user-1',
                idempotencyKey: 'failure-report-recovery',
                bytes: await pngBytes(),
                now,
            })
            await consumeQueued(setup.env, firstQueuedMessage(setup.lanes))

            expect(await queryAll<{message_id: string}>('SELECT message_id FROM admin_error_logs', [], db)).toHaveLength(1)
            expect(
                await queryOne<{failure_reported_at: string | null}>('SELECT failure_reported_at FROM image_processing_tasks', [], db),
            ).toEqual({failure_reported_at: null})
            await expect(retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-before-report', now)).rejects.toBeInstanceOf(
                ImageUploadConflictError,
            )

            await reconcileImageUploads(setup.env, now)

            expect(setup.deadLetter.messages).toEqual([{body: expect.objectContaining({errorCode: 'invalid_image', jobId: job.id})}])
            expect(
                await queryOne<{failure_reported_at: string | null}>('SELECT failure_reported_at FROM image_processing_tasks', [], db),
            ).not.toEqual({failure_reported_at: null})
        } finally {
            error.mockRestore()
        }
    })

    it('records cleanup failures and stops after three attempts', async () => {
        const setup = createEnv()
        vi.mocked(setup.sourceBucket.delete).mockRejectedValue(new Error('R2 delete failed'))
        await db
            .prepare(
                `INSERT INTO image_cleanup_tasks (id, bucket, object_key, state, not_before, created_at, updated_at)
             VALUES ('failed-cleanup', 'source', 'source.png', 'pending', ?, ?, ?)`,
            )
            .bind('2026-09-04 11:00:00', '2026-09-04 11:00:00', '2026-09-04 11:00:00')
            .run()

        await reconcileImageUploads(setup.env, now)
        await reconcileImageUploads(setup.env, now)
        await reconcileImageUploads(setup.env, now)

        expect(await queryOne<{state: string; attempts: number}>('SELECT state, attempts FROM image_cleanup_tasks', [], db)).toEqual({
            state: 'failed',
            attempts: 3,
        })
    })

    it('returns null for missing retry work and rejects invalid retry states', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        await expect(retryImageUploadJob(setup.env, 'user-1', 'missing-job', 'retry-missing-job', now)).resolves.toBeNull()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'retry-edge',
            bytes: await pngBytes(),
            now,
        })
        await expect(retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-active', now)).rejects.toBeInstanceOf(ImageUploadConflictError)
        await db.prepare(`UPDATE image_upload_jobs SET state = 'failed' WHERE id = ?`).bind(job.id).run()
        await db.prepare(`DELETE FROM image_processing_tasks WHERE job_id = ?`).bind(job.id).run()
        await expect(retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-missing', now)).rejects.toThrow(
            'Image upload task was not found',
        )
    })

    it('queues a previous unpublished output for cleanup during retry', async () => {
        await seedUser({id: 'user-1'})
        const setup = createEnv()
        const job = await createSquareImageUploadJob(setup.env, {
            userId: 'user-1',
            kind: 'user-profile',
            targetId: 'user-1',
            idempotencyKey: 'retry-output',
            bytes: await pngBytes(),
            now,
        })
        await db.prepare(`UPDATE image_upload_jobs SET state = 'failed' WHERE id = ?`).bind(job.id).run()
        await db
            .prepare(`UPDATE image_processing_tasks SET state = 'failed', output_json = '{"objectKey":"old-output.avif"}' WHERE job_id = ?`)
            .bind(job.id)
            .run()

        await retryImageUploadJob(setup.env, 'user-1', job.id, 'retry-output-key', now)

        expect(
            await queryAll<{bucket: string; object_key: string}>(
                'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
                [],
                db,
            ),
        ).toEqual([
            {bucket: 'media', object_key: 'old-output.avif'},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey('old-output.avif')},
        ])
    })

    it('restarts every unfinished task in a failed gallery pair', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        const setup = createEnv()
        const sources = []

        for (const rating of ['sfw', 'nsfw'] as const) {
            const objectKey = `image-staging/${characterMediaImageObjectKey(
                'user-1',
                'character-1',
                'media-retry',
                `${rating}-source`,
                rating,
                'image/png',
            )}`
            const bytes = await pngBytes(100, 80)
            await setup.sourceBucket.put(objectKey, bytes)
            sources.push({
                rating,
                objectKey,
                contentType: 'image/png',
                byteSize: bytes.byteLength,
                width: 100,
                height: 80,
                displayWidth: 100,
                displayHeight: 80,
            })
        }

        const job = await createGalleryImageUploadJob(setup.env, {
            userId: 'user-1',
            characterId: 'character-1',
            mediaId: 'media-retry',
            idempotencyKey: 'gallery-pair-retry',
            sfwArtist: '',
            nsfwArtist: '',
            sources,
            now,
        })
        await db.prepare(`UPDATE image_upload_jobs SET state = 'failed' WHERE id = ?`).bind(job.id).run()
        await db
            .prepare(
                `UPDATE image_processing_tasks
                 SET state = CASE WHEN recipe = 'gallery-sfw-v1' THEN 'failed' ELSE 'queued' END,
                     sharp_attempts = CASE WHEN recipe = 'gallery-sfw-v1' THEN 3 ELSE 0 END
                 WHERE job_id = ?`,
            )
            .bind(job.id)
            .run()

        await retryImageUploadJob(setup.env, 'user-1', job.id, 'gallery-retry-run', now)

        expect(
            await queryAll<{state: string; sharp_attempts: number}>(
                'SELECT state, sharp_attempts FROM image_processing_tasks ORDER BY recipe',
                [],
                db,
            ),
        ).toEqual([
            {state: 'queued', sharp_attempts: 0},
            {state: 'queued', sharp_attempts: 0},
        ])
        expect(await queryOne<{generation: number}>('SELECT generation FROM image_upload_jobs WHERE id = ?', [job.id], db)).toEqual({
            generation: 2,
        })
        expect(queuedMessages(setup.lanes)).toHaveLength(4)
    })
})
