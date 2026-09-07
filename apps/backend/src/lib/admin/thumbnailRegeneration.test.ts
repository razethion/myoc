import {describe, expect, it, vi} from 'vitest'
import {queryAll, queryOne, seedCharacter, seedFolder, seedUser, useTestDatabase} from '../../test/d1'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import {createMockQueue as createQueue} from '../../test/mockQueue'
import {createMockR2Bucket} from '../../test/mockR2'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import type {ThumbnailRegenerationProcessingMessage} from '../../types/imageProcessing'
import {PreviewContainerBusyError} from '../media/previewGeneration'
import {thumbnailOriginalObjectKey} from '../media/thumbnailSources'
import {claimMediaPreviewRegenerationTask, completeMediaPreviewRegenerationDispatch} from './mediaPreviewRegeneration'
import {
    consumeThumbnailRegenerationMessage,
    countThumbnailCandidates,
    enqueueThumbnailRegenerationCandidates,
    getThumbnailCandidates,
    initializeThumbnailRegenerationDispatch,
    regenerateThumbnail,
    type ThumbnailCandidate,
} from './thumbnailRegeneration'

const db = useTestDatabase()
const userId = 'thumbnail-owner'
const characterId = 'thumbnail-character'
const folderId = 'thumbnail-folder'

function createThumbnailBucket(onPut?: (key: string) => Promise<void> | void): R2Bucket {
    const bucket = createMockR2Bucket()
    const contentTypes = new Map<string, string | undefined>()
    const put = vi.fn(async (key: string, value: Parameters<R2Bucket['put']>[1], options?: R2PutOptions) => {
        const metadata = options?.httpMetadata
        contentTypes.set(key, metadata instanceof Headers ? (metadata.get('content-type') ?? undefined) : metadata?.contentType)
        const object = await bucket.put(key, value, options)
        await onPut?.(key)
        return object
    })
    const get = vi.fn(async (key: string, options?: R2GetOptions) => withContentType(await bucket.get(key, options), contentTypes.get(key)))
    const head = vi.fn(async (key: string) => withContentType(await bucket.head(key), contentTypes.get(key)))

    return new Proxy(bucket, {
        get(target, property, receiver) {
            if (property === 'put') return put
            if (property === 'get') return get
            if (property === 'head') return head
            return Reflect.get(target, property, receiver)
        },
    })
}

function withContentType<T extends R2Object | R2ObjectBody | null>(object: T, contentType: string | undefined): T {
    if (object) Object.defineProperty(object, 'httpMetadata', {value: {contentType}})
    return object
}

function createSquareContainer(onFetch?: (request: Request) => Promise<void> | void): Bindings['MYOC_DOCKER_SHARP_CONTAINER'] {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        await onFetch?.(request)
        return new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}})
    })

    return {
        idFromName: vi.fn(() => 'thumbnail-container-id'),
        get: vi.fn(() => ({fetch})),
    } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']
}

function combinedThumbnailBucket(mediaBucket: R2Bucket, sourceBucket: R2Bucket): R2Bucket {
    return new Proxy(mediaBucket, {
        get(target, property, receiver) {
            if (property === 'get' || property === 'head' || property === 'put' || property === 'delete') {
                return (key: string, ...args: unknown[]) => {
                    const bucket = key.startsWith('thumbnail-originals/') ? sourceBucket : target
                    return Reflect.apply(bucket[property] as (...values: unknown[]) => unknown, bucket, [key, ...args])
                }
            }
            return Reflect.get(target, property, receiver)
        },
    })
}

function regenerationEnv(mediaBucket: R2Bucket, sourceBucket: R2Bucket, container = createSquareContainer()): Bindings {
    return createWorkerEnv({
        DB: db,
        MEDIA_BUCKET: combinedThumbnailBucket(mediaBucket, sourceBucket),
        MYOC_DOCKER_SHARP_CONTAINER: container,
        PREVIEW_PROCESSOR_TOKEN: 'thumbnail-test-token',
    })
}

function createMessage(body: ThumbnailRegenerationProcessingMessage, attempts = 1) {
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

async function seedThumbnailJob(runId: string, status = 'running'): Promise<void> {
    await db
        .prepare(
            `INSERT INTO admin_job_runs (id, job_name, trigger_source, status, started_at, summary_json)
             VALUES (?, 'thumbnail-regeneration', 'manual', ?, CURRENT_TIMESTAMP, '{}')`,
        )
        .bind(runId, status)
        .run()
}

async function createQueuedThumbnail(options: {container?: Bindings['MYOC_DOCKER_SHARP_CONTAINER']; complete?: boolean} = {}) {
    const runId = crypto.randomUUID()
    await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
    await seedThumbnailJob(runId)
    const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
    const mediaBucket = createThumbnailBucket()
    const sourceBucket = createThumbnailBucket()
    await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
        httpMetadata: {contentType: 'image/png'},
    })
    const processingQueue = createQueue<ThumbnailRegenerationProcessingMessage>()
    const deadLetterQueue = createQueue()
    const env = createWorkerEnv({
        DB: db,
        IMAGE_PROCESSING_DLQ: deadLetterQueue.queue,
        IMAGE_PROCESSING_QUEUE: processingQueue.queue,
        MEDIA_BUCKET: combinedThumbnailBucket(mediaBucket, sourceBucket),
        MYOC_DOCKER_SHARP_CONTAINER: options.container ?? createSquareContainer(),
        PREVIEW_PROCESSOR_TOKEN: 'thumbnail-test-token',
    })

    await initializeThumbnailRegenerationDispatch(db, runId)
    await enqueueThumbnailRegenerationCandidates(db, env, runId, [candidate])
    if (options.complete ?? true) await completeMediaPreviewRegenerationDispatch(db, runId)
    const body = processingQueue.bodies[0]
    if (!body) throw new Error('Expected one queued thumbnail task')

    return {body, candidate, deadLetterQueue, env, processingQueue, runId}
}

async function pngBytes(): Promise<Uint8Array> {
    return new Uint8Array(await createPngFile(512, 512).arrayBuffer())
}

async function seedThumbnailTargets(): Promise<void> {
    await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
    await seedFolder({id: folderId, userId, name: 'Thumbnail Folder', folderImageKey: 'folder-old'})
    await seedCharacter({id: characterId, userId, name: 'Thumbnail Character', profileImageKey: 'character-old'})
}

function candidateFor(candidates: ThumbnailCandidate[], kind: ThumbnailCandidate['kind']): ThumbnailCandidate {
    const candidate = candidates.find((item) => item.kind === kind)
    if (!candidate) throw new Error(`Expected a ${kind} candidate`)
    return candidate
}

async function currentImageKey(candidate: ThumbnailCandidate): Promise<string | null> {
    if (candidate.kind === 'user-profile') {
        return (
            (await db
                .prepare('SELECT profile_photo_key FROM users WHERE id = ?')
                .bind(candidate.targetId)
                .first<string>('profile_photo_key')) ?? null
        )
    }
    if (candidate.kind === 'character-profile') {
        return (
            (await db
                .prepare('SELECT profile_image_key FROM characters WHERE id = ?')
                .bind(candidate.targetId)
                .first<string>('profile_image_key')) ?? null
        )
    }
    return (
        (await db
            .prepare('SELECT folder_image_key FROM character_folders WHERE id = ?')
            .bind(candidate.targetId)
            .first<string>('folder_image_key')) ?? null
    )
}

describe('thumbnail regeneration', () => {
    it('counts and returns all thumbnail kinds in stable cursor order', async () => {
        await seedThumbnailTargets()

        expect(await countThumbnailCandidates(db)).toBe(3)
        const firstPage = await getThumbnailCandidates(db, null, 2)
        expect(firstPage.map(({kind, targetId}) => ({kind, targetId}))).toEqual([
            {kind: 'character-profile', targetId: characterId},
            {kind: 'folder-image', targetId: folderId},
        ])
        const last = firstPage[1]
        if (!last) throw new Error('Expected a second thumbnail candidate')
        const secondPage = await getThumbnailCandidates(db, {kind: last.kind, targetId: last.targetId}, 2)
        expect(secondPage.map(({kind, targetId}) => ({kind, targetId}))).toEqual([{kind: 'user-profile', targetId: userId}])
        expect(firstPage[0]?.outputImageKey).toMatch(/^avif-[0-9a-f-]+$/)
        expect(firstPage[0]?.outputObjectKey).toMatch(/\.avif$/)
        await expect(getThumbnailCandidates(db, null, 0)).rejects.toThrow('Thumbnail candidate limit must be from 1 through 100')
    })

    it('stores and processes a thumbnail task through the shared image queue', async () => {
        const {body, candidate, deadLetterQueue, env, processingQueue, runId} = await createQueuedThumbnail()

        expect(processingQueue.bodies).toEqual([
            {
                version: 1,
                kind: 'thumbnail-regeneration',
                taskId: `${runId}:thumbnail:user-profile:${userId}`,
                runId,
            },
        ])
        expect(
            await queryOne<{candidate_json: string; container_slot: number; media_id: string; status: string}>(
                `SELECT candidate_json, container_slot, media_id, status
                 FROM media_preview_regeneration_items
                 WHERE task_id = ?`,
                [body.taskId],
                db,
            ),
        ).toEqual({
            candidate_json: JSON.stringify(candidate),
            container_slot: 0,
            media_id: `thumbnail:user-profile:${userId}`,
            status: 'pending',
        })
        const delivery = createMessage(body)

        await consumeThumbnailRegenerationMessage(delivery.message, body, env)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(deadLetterQueue.bodies).toEqual([])
        expect(await currentImageKey(candidate)).toBe(candidate.outputImageKey)
        const job = await queryOne<{status: string; summary_json: string}>(
            'SELECT status, summary_json FROM admin_job_runs WHERE id = ?',
            [runId],
            db,
        )
        expect(job?.status).toBe('success')
        expect(JSON.parse(job?.summary_json ?? '{}')).toMatchObject({
            totalVariants: 1,
            processedVariants: 1,
            regeneratedPreviews: 1,
        })
        await expect(queryOne('SELECT task_id FROM media_preview_regeneration_items WHERE run_id = ?', [runId], db)).resolves.toBeNull()
    })

    it('does not enqueue thumbnail work for a stopped job or an empty page', async () => {
        const runId = crypto.randomUUID()
        await seedThumbnailJob(runId, 'error')
        const queue = createQueue<ThumbnailRegenerationProcessingMessage>()
        const inactive = await initializeThumbnailRegenerationDispatch(db, runId)

        expect(inactive.active).toBe(false)
        await expect(enqueueThumbnailRegenerationCandidates(db, {IMAGE_PROCESSING_QUEUE: queue.queue}, runId, [])).resolves.toBe(false)
        await expect(
            enqueueThumbnailRegenerationCandidates(db, {IMAGE_PROCESSING_QUEUE: queue.queue}, runId, [
                {
                    kind: 'user-profile',
                    userId,
                    targetId: userId,
                    imageKey: 'old',
                    objectKey: 'old.avif',
                    contentType: 'image/avif',
                    outputImageKey: 'new',
                    outputObjectKey: 'new.avif',
                },
            ]),
        ).resolves.toBe(false)
        expect(queue.bodies).toEqual([])
        await expect(queryOne('SELECT run_id FROM media_preview_regeneration_runs WHERE run_id = ?', [runId], db)).resolves.toBeNull()
    })

    it('retries a failed thumbnail and completes it on the next delivery', async () => {
        const container = createSquareContainer()
        const stub = container.get(container.idFromName('thumbnail-container-id'))
        vi.mocked(stub.fetch)
            .mockRejectedValueOnce(new Error('Container stopped'))
            .mockResolvedValueOnce(new Response(createAvifBytes(512, 512), {headers: {'content-type': 'image/avif'}}))
        const {body, env, runId} = await createQueuedThumbnail({container})
        const first = createMessage(body)

        await consumeThumbnailRegenerationMessage(first.message, body, env)

        expect(first.ack).not.toHaveBeenCalled()
        expect(first.retry).toHaveBeenCalledWith({delaySeconds: 1})
        expect(
            await queryOne<{last_error: string; status: string}>(
                'SELECT last_error, status FROM media_preview_regeneration_items WHERE task_id = ?',
                [body.taskId],
                db,
            ),
        ).toEqual({last_error: 'Container stopped', status: 'pending'})

        const second = createMessage(body, 2)
        await consumeThumbnailRegenerationMessage(second.message, body, env)

        expect(second.ack).toHaveBeenCalledOnce()
        expect(second.retry).not.toHaveBeenCalled()
        expect(await queryOne<{status: string}>('SELECT status FROM admin_job_runs WHERE id = ?', [runId], db)).toEqual({status: 'success'})
    })

    it('records a terminal thumbnail failure in the shared dead-letter queue', async () => {
        const container = createSquareContainer()
        const stub = container.get(container.idFromName('thumbnail-container-id'))
        vi.mocked(stub.fetch).mockRejectedValue(new Error('Container stopped'))
        const {body, deadLetterQueue, env, runId} = await createQueuedThumbnail({container})
        const first = createMessage(body, 10)
        const second = createMessage(body, 10)
        const delivery = createMessage(body, 10)

        await consumeThumbnailRegenerationMessage(first.message, body, env)
        await consumeThumbnailRegenerationMessage(second.message, body, env)
        await consumeThumbnailRegenerationMessage(delivery.message, body, env)

        expect(first.retry).toHaveBeenCalled()
        expect(second.retry).toHaveBeenCalled()
        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(deadLetterQueue.bodies).toEqual([
            {
                ...body,
                errorCode: 'thumbnail_generation_failed',
                error: 'Container stopped',
            },
        ])
        const job = await queryOne<{status: string; summary_json: string}>(
            'SELECT status, summary_json FROM admin_job_runs WHERE id = ?',
            [runId],
            db,
        )
        expect(job?.status).toBe('success')
        expect(JSON.parse(job?.summary_json ?? '{}')).toMatchObject({
            processedVariants: 1,
            failedVariants: 1,
            lastError: 'Container stopped',
        })
    })

    it('requeues capacity-only failures without using the processing attempt limit', async () => {
        const container = createSquareContainer()
        const stub = container.get(container.idFromName('thumbnail-container-id'))
        vi.mocked(stub.fetch).mockRejectedValue(new PreviewContainerBusyError('All image processors are busy'))
        const {body, deadLetterQueue, env, processingQueue} = await createQueuedThumbnail({container})
        const delivery = createMessage(body, 10)

        await consumeThumbnailRegenerationMessage(delivery.message, body, env)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(delivery.retry).not.toHaveBeenCalled()
        expect(processingQueue.bodies).toEqual([body, body])
        expect(deadLetterQueue.bodies).toEqual([])
        expect(
            await queryOne<{last_error: string | null; processing_attempts: number; status: string}>(
                'SELECT last_error, processing_attempts, status FROM media_preview_regeneration_items WHERE task_id = ?',
                [body.taskId],
                db,
            ),
        ).toEqual({last_error: null, processing_attempts: 0, status: 'pending'})
    })

    it('moves invalid stored thumbnail data to the shared dead-letter queue', async () => {
        const {body, deadLetterQueue, env} = await createQueuedThumbnail()
        await db.prepare(`UPDATE media_preview_regeneration_items SET candidate_json = '{}' WHERE task_id = ?`).bind(body.taskId).run()
        const delivery = createMessage(body)

        await consumeThumbnailRegenerationMessage(delivery.message, body, env)

        expect(delivery.ack).toHaveBeenCalledOnce()
        expect(deadLetterQueue.bodies).toEqual([
            expect.objectContaining({
                ...body,
                errorCode: 'thumbnail_generation_failed',
                error: 'Stored thumbnail task data is invalid',
            }),
        ])
    })

    it('delays a duplicate thumbnail delivery while its lease is active', async () => {
        const {body, env} = await createQueuedThumbnail({complete: false})
        const now = new Date('2026-09-04T12:00:00Z')
        await claimMediaPreviewRegenerationTask(db, body.taskId, now)
        const delivery = createMessage(body, 2)

        await consumeThumbnailRegenerationMessage(delivery.message, body, env, () => new Date(now.getTime() + 1_000))

        expect(delivery.ack).not.toHaveBeenCalled()
        expect(delivery.retry).toHaveBeenCalledWith({delaySeconds: 119})
    })

    it('retries a processing thumbnail without a lease after one second', async () => {
        const {body, env} = await createQueuedThumbnail({complete: false})
        await db
            .prepare(
                `UPDATE media_preview_regeneration_items SET status = 'processing', lease_id = NULL, lease_expires_at = NULL WHERE task_id = ?`,
            )
            .bind(body.taskId)
            .run()
        const delivery = createMessage(body, 2)

        await consumeThumbnailRegenerationMessage(delivery.message, body, env, () => new Date('2026-09-04T12:00:00Z'))

        expect(delivery.ack).not.toHaveBeenCalled()
        expect(delivery.retry).toHaveBeenCalledWith({delaySeconds: 1})
    })

    it('acknowledges a stale thumbnail delivery and retries a storage failure', async () => {
        const {body, env} = await createQueuedThumbnail()
        const first = createMessage(body)
        await consumeThumbnailRegenerationMessage(first.message, body, env)
        const duplicate = createMessage(body, 2)
        await consumeThumbnailRegenerationMessage(duplicate.message, body, env)
        expect(duplicate.ack).toHaveBeenCalledOnce()

        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
        const unavailable = {
            ...env,
            DB: {
                prepare: () => {
                    throw new Error('D1 is unavailable')
                },
            },
        } as unknown as Bindings
        const failed = createMessage({...body, taskId: 'unavailable-task'}, 8)

        try {
            await consumeThumbnailRegenerationMessage(
                failed.message,
                failed.message.body as ThumbnailRegenerationProcessingMessage,
                unavailable,
            )
        } finally {
            error.mockRestore()
        }

        expect(failed.ack).not.toHaveBeenCalled()
        expect(failed.retry).toHaveBeenCalledWith({delaySeconds: 60})
    })

    it('skips a reference that changed before processing starts', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await db
            .prepare(`UPDATE users SET profile_photo_key = 'new-upload', profile_photo_content_type = 'image/avif' WHERE id = ?`)
            .bind(userId)
            .run()
        const container = createSquareContainer()

        await expect(
            regenerateThumbnail(regenerationEnv(createThumbnailBucket(), createThumbnailBucket(), container), candidate),
        ).resolves.toEqual({
            status: 'skipped',
            error: null,
        })

        expect(container.get).not.toHaveBeenCalled()
        expect(await currentImageKey(candidate)).toBe('new-upload')
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(3)
    })

    it.each(['user-profile', 'character-profile', 'folder-image'] as const)(
        'regenerates a %s thumbnail from its retained original',
        async (kind) => {
            await seedThumbnailTargets()
            const candidate = candidateFor(await getThumbnailCandidates(db, null), kind)
            const mediaBucket = createThumbnailBucket()
            const sourceBucket = createThumbnailBucket()
            const original = await pngBytes()
            const seenSources: Uint8Array[] = []
            const container = createSquareContainer(async (request) => {
                seenSources.push(new Uint8Array(await request.arrayBuffer()))
                expect(request.headers.get('content-type')).toBe('image/png')
            })
            await mediaBucket.put(candidate.objectKey, createAvifBytes(512, 512), {
                httpMetadata: {contentType: candidate.contentType},
            })
            await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), original, {
                httpMetadata: {contentType: 'image/png'},
            })

            await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
                status: 'regenerated',
                error: null,
            })

            expect(seenSources).toEqual([original])
            expect(await currentImageKey(candidate)).toBe(candidate.outputImageKey)
            await expect(mediaBucket.get(candidate.outputObjectKey)).resolves.not.toBeNull()
            const copiedOriginal = await sourceBucket.get(thumbnailOriginalObjectKey(candidate.outputObjectKey))
            expect(copiedOriginal ? new Uint8Array(await copiedOriginal.arrayBuffer()) : null).toEqual(original)
            expect(
                await queryAll<{bucket: string; object_key: string}>(
                    'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket, object_key',
                    [],
                    db,
                ),
            ).toEqual([
                {bucket: 'media', object_key: candidate.objectKey},
                {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
            ])
        },
    )

    it('retains a public thumbnail as the original when no retained source exists', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const original = await pngBytes()
        await db.prepare(`UPDATE users SET profile_photo_content_type = 'image/png' WHERE id = ?`).bind(userId).run()
        const refreshedCandidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await mediaBucket.put(refreshedCandidate.objectKey, original, {httpMetadata: {contentType: 'image/png'}})

        await regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), refreshedCandidate)

        for (const key of [refreshedCandidate.objectKey, refreshedCandidate.outputObjectKey]) {
            const retained = await sourceBucket.get(thumbnailOriginalObjectKey(key))
            expect(retained ? new Uint8Array(await retained.arrayBuffer()) : null).toEqual(original)
        }
        expect(candidate.imageKey).toBe(refreshedCandidate.imageKey)
    })

    it('uses the same original through repeated regeneration', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        await db.prepare(`UPDATE users SET profile_photo_content_type = 'image/png' WHERE id = ?`).bind(userId).run()
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const original = await pngBytes()
        const seenSources: Uint8Array[] = []
        const container = createSquareContainer(async (request) => {
            seenSources.push(new Uint8Array(await request.arrayBuffer()))
        })
        const first = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await mediaBucket.put(first.objectKey, original, {httpMetadata: {contentType: 'image/png'}})
        const env = regenerationEnv(mediaBucket, sourceBucket, container)

        await regenerateThumbnail(env, first)
        const second = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        await regenerateThumbnail(env, second)

        expect(seenSources).toEqual([original, original])
        expect(await currentImageKey(second)).toBe(second.outputImageKey)
    })

    it('keeps a newer upload when it wins the publish race', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await mediaBucket.put(candidate.objectKey, await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = createSquareContainer(async () => {
            await db
                .prepare(`UPDATE users SET profile_photo_key = 'new-upload', profile_photo_content_type = 'image/avif' WHERE id = ?`)
                .bind(userId)
                .run()
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
            status: 'skipped',
            error: null,
        })

        expect(await currentImageKey(candidate)).toBe('new-upload')
        const cleanup = await queryAll<{bucket: string; object_key: string}>(
            'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
            [],
            db,
        )
        expect(cleanup).toEqual([
            {bucket: 'media', object_key: candidate.outputObjectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
        ])
        expect(cleanup.some(({object_key}) => object_key.includes('new-upload'))).toBe(false)
    })

    it('skips a target that is deleted while processing', async () => {
        await seedThumbnailTargets()
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'folder-image')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = createSquareContainer(async () => {
            await db.prepare('DELETE FROM character_folders WHERE id = ?').bind(folderId).run()
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).resolves.toEqual({
            status: 'skipped',
            error: null,
        })
        expect(await currentImageKey(candidate)).toBeNull()
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(3)
    })

    it('returns an idempotent result when the output is already current', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        const container = createSquareContainer()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const env = regenerationEnv(mediaBucket, sourceBucket, container)

        await regenerateThumbnail(env, candidate)
        await expect(regenerateThumbnail(env, candidate)).resolves.toEqual({status: 'regenerated', error: null})

        const stub = container.get(container.idFromName('thumbnail-container-id'))
        expect(stub.fetch).toHaveBeenCalledTimes(1)
        expect(await queryAll('SELECT object_key FROM image_cleanup_tasks', [], db)).toHaveLength(2)
    })

    it('keeps the old thumbnail when image processing fails', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket()
        const sourceBucket = createThumbnailBucket()
        await mediaBucket.put(candidate.objectKey, createAvifBytes(512, 512), {
            httpMetadata: {contentType: candidate.contentType},
        })
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })
        const container = {
            idFromName: vi.fn(() => 'thumbnail-container-id'),
            get: vi.fn(() => ({fetch: vi.fn(async () => Promise.reject(new Error('Container stopped')))})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER']

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket, container), candidate)).rejects.toThrow(
            'Container stopped',
        )

        expect(await currentImageKey(candidate)).toBe(candidate.imageKey)
        await expect(mediaBucket.get(candidate.objectKey)).resolves.not.toBeNull()
        await expect(mediaBucket.get(candidate.outputObjectKey)).resolves.toBeNull()
        expect(await queryOne<{total: number}>('SELECT COUNT(*) AS total FROM image_cleanup_tasks', [], db)).toEqual({total: 0})
    })

    it('queues staged objects for cleanup when the public write fails', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket((key) => {
            if (key === candidate.outputObjectKey) throw new Error('R2 write failed')
        })
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), candidate)).rejects.toThrow('R2 write failed')

        expect(await currentImageKey(candidate)).toBe(candidate.imageKey)
        expect(
            await queryAll<{bucket: string; object_key: string}>(
                'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
                [],
                db,
            ),
        ).toEqual([
            {bucket: 'media', object_key: candidate.outputObjectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.outputObjectKey)},
        ])
    })

    it('finishes cleanup when a write reports an error after publication', async () => {
        await seedUser({id: userId, username: 'thumbnail_owner', profilePhotoKey: 'user-old'})
        const candidate = candidateFor(await getThumbnailCandidates(db, null), 'user-profile')
        const mediaBucket = createThumbnailBucket(async (key) => {
            if (key !== candidate.outputObjectKey) return
            await db
                .prepare(`UPDATE users SET profile_photo_key = ?, profile_photo_content_type = 'image/avif' WHERE id = ?`)
                .bind(candidate.outputImageKey, userId)
                .run()
            throw new Error('R2 response was lost')
        })
        const sourceBucket = createThumbnailBucket()
        await sourceBucket.put(thumbnailOriginalObjectKey(candidate.objectKey), await pngBytes(), {
            httpMetadata: {contentType: 'image/png'},
        })

        await expect(regenerateThumbnail(regenerationEnv(mediaBucket, sourceBucket), candidate)).resolves.toEqual({
            status: 'regenerated',
            error: null,
        })

        expect(await currentImageKey(candidate)).toBe(candidate.outputImageKey)
        expect(
            await queryAll<{bucket: string; object_key: string}>(
                'SELECT bucket, object_key FROM image_cleanup_tasks ORDER BY bucket',
                [],
                db,
            ),
        ).toEqual([
            {bucket: 'media', object_key: candidate.objectKey},
            {bucket: 'source', object_key: thumbnailOriginalObjectKey(candidate.objectKey)},
        ])
    })
})
