import {describe, expect, it, vi} from 'vitest'
import {createCsrfToken} from '../../lib/auth/session'
import {queryOne, seedAuthenticatedUser, seedFolder, useTestDatabase} from '../../test/d1'
import {createPngFile} from '../../test/imageFixtures'
import {createMockR2Bucket} from '../../test/mockR2'
import {createAllowingUploadRateLimits, createMockRateLimit} from '../../test/mockRateLimit'
import type {Bindings} from '../../types/bindings'
import {apiRoutes} from '../api'

const db = useTestDatabase()
const sessionToken = 'image-upload-session'

function createQueue(): Queue {
    return {send: vi.fn(async () => undefined)} as unknown as Queue
}

function createEnv(overrides: Partial<Bindings> = {}): Bindings {
    return {
        DB: db,
        IMAGE_PROCESSING_QUEUE: createQueue(),
        MEDIA_BUCKET: createMockR2Bucket(),
        MEDIA_PUBLIC_BASE_URL: 'https://m.myoc.art',
        ...createAllowingUploadRateLimits(),
        ...overrides,
    } as unknown as Bindings
}

function sqlTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19)
}

async function seedUploadJob(id: string, state: string, options: {createdAt?: Date; userId?: string} = {}): Promise<void> {
    const createdAt = sqlTimestamp(options.createdAt ?? new Date())
    await db
        .prepare(
            `INSERT INTO image_upload_jobs (
                id, user_id, target_type, target_id, state, idempotency_key, request_json,
                deadline_at, created_at, updated_at
            ) VALUES (?, ?, 'user_profile', 'user-1', ?, ?, '{"kind":"user-profile","targetId":"user-1"}',
                '2099-01-01 00:00:00', ?, ?)`,
        )
        .bind(id, options.userId ?? 'user-1', state, `seed-${id}`, createdAt, createdAt)
        .run()
}

async function postUpload(env: Bindings, options: {form?: FormData; idempotencyKey?: string; authenticated?: boolean} = {}) {
    const form = options.form ?? validForm()
    const authenticated = options.authenticated ?? true
    return apiRoutes.request(
        'https://example.com/image-uploads',
        {
            method: 'POST',
            body: form,
            headers: {
                ...(authenticated
                    ? {
                          cookie: `myoc_session=${sessionToken}`,
                          'x-csrf-token': await createCsrfToken(sessionToken),
                      }
                    : {}),
                ...(options.idempotencyKey === undefined
                    ? {'idempotency-key': 'route-upload-key'}
                    : options.idempotencyKey
                      ? {'idempotency-key': options.idempotencyKey}
                      : {}),
            },
        },
        env,
    )
}

function validForm(): FormData {
    const form = new FormData()
    form.set('kind', 'user-profile')
    form.set('targetId', 'user-1')
    form.set('batchId', 'batch-1')
    form.set('source', createPngFile(512, 512))
    return form
}

describe('image upload API', () => {
    it('requires authentication', async () => {
        const response = await postUpload(createEnv(), {authenticated: false})
        expect(response.status).toBe(401)
        expect(await response.json()).toEqual({error: 'Authentication required'})
    })

    it.each([
        ['GET', '/image-uploads/missing'],
        ['POST', '/image-uploads/missing/retry'],
        ['DELETE', '/image-uploads/missing'],
        ['GET', '/image-upload-batches/missing'],
    ])('requires authentication for %s %s', async (method, path) => {
        const response = await apiRoutes.request(`https://example.com${path}`, {method}, createEnv())
        expect(response.status).toBe(401)
    })

    it('creates, reads, caches, lists, and cancels an upload job', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv()
        const createdResponse = await postUpload(env)
        expect(createdResponse.status).toBe(202)
        const created = (await createdResponse.json()) as {job: {id: string; state: string}; statusUrl: string}
        expect(created.job.state).toBe('waiting')
        const routePath = created.statusUrl.replace(/^\/api/, '')

        const statusResponse = await apiRoutes.request(
            `https://example.com${routePath}`,
            {
                headers: {cookie: `myoc_session=${sessionToken}`},
            },
            env,
        )
        expect(statusResponse.status).toBe(200)
        const etag = statusResponse.headers.get('etag')
        expect(etag).toMatch(/^W\/"\w+"$/)
        if (!etag) throw new Error('Expected an ETag')

        const cachedResponse = await apiRoutes.request(
            `https://example.com${routePath}`,
            {
                headers: {cookie: `myoc_session=${sessionToken}`, 'if-none-match': etag},
            },
            env,
        )
        expect(cachedResponse.status).toBe(304)

        const batchResponse = await apiRoutes.request(
            'https://example.com/image-upload-batches/batch-1',
            {
                headers: {cookie: `myoc_session=${sessionToken}`},
            },
            env,
        )
        expect(batchResponse.status).toBe(200)
        expect((await batchResponse.json()) as {jobs: unknown[]}).toHaveProperty('jobs.length', 1)

        const canceledResponse = await apiRoutes.request(
            `https://example.com${routePath}`,
            {
                method: 'DELETE',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(canceledResponse.status).toBe(200)
        expect((await canceledResponse.json()) as {job: {state: string}}).toHaveProperty('job.state', 'canceled')
    })

    it('creates an upload job without a batch ID', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const form = validForm()
        form.delete('batchId')

        const response = await postUpload(createEnv(), {form, idempotencyKey: 'upload-without-batch'})

        expect(response.status).toBe(202)
        expect((await response.json()) as {job: {batchId: string | null}}).toHaveProperty('job.batchId', null)
    })

    it.each([
        ['missing idempotency key', validForm(), '', 400],
        ['invalid fields', new FormData(), 'valid-key', 400],
        [
            'non-PNG source',
            (() => {
                const form = validForm()
                form.set('source', new File([new Uint8Array([1])], 'source.jpg', {type: 'image/jpeg'}))
                return form
            })(),
            'valid-key',
            400,
        ],
    ] as const)('rejects %s', async (_label, form, idempotencyKey, status) => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const response = await postUpload(createEnv(), {form, idempotencyKey})
        expect(response.status).toBe(status)
    })

    it('rejects an oversized request and a PNG with invalid dimensions', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const oversized = validForm()
        oversized.set('source', new File([new Uint8Array(3 * 1024 * 1024 + 128 * 1024)], 'large.png', {type: 'image/png'}))
        expect((await postUpload(createEnv(), {form: oversized})).status).toBe(413)

        const invalid = validForm()
        invalid.set('source', createPngFile(10, 10))
        expect((await postUpload(createEnv(), {form: invalid})).status).toBe(400)
    })

    it('propagates an unexpected source storage failure', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv()
        vi.mocked(env.MEDIA_BUCKET.put).mockRejectedValueOnce(new Error('R2 unavailable'))
        await expect(postUpload(env)).resolves.toHaveProperty('status', 500)
    })

    it('returns conflict for an idempotency key that has different upload data', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        await seedFolder({id: 'folder-1', userId: 'user-1'})
        const env = createEnv()
        expect((await postUpload(env)).status).toBe(202)
        const form = validForm()
        form.set('kind', 'folder-image')
        form.set('targetId', 'folder-1')
        const response = await postUpload(env, {form})
        expect(response.status).toBe(409)
    })

    it('does not expose another user job or batch', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        await seedAuthenticatedUser({id: 'user-2'}, 'other-session')
        const env = createEnv()
        const created = (await (await postUpload(env)).json()) as {job: {id: string}}

        const status = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}`,
            {
                headers: {cookie: 'myoc_session=other-session'},
            },
            env,
        )
        expect(status.status).toBe(404)
        const batch = await apiRoutes.request(
            'https://example.com/image-upload-batches/batch-1',
            {
                headers: {cookie: 'myoc_session=other-session'},
            },
            env,
        )
        expect(await batch.json()).toEqual({jobs: []})
    })

    it('does not let another user retry or cancel an upload job', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const otherSession = 'other-session'
        await seedAuthenticatedUser({id: 'user-2'}, otherSession)
        const env = createEnv()
        const created = (await (await postUpload(env)).json()) as {job: {id: string}}
        await db
            .prepare("UPDATE image_upload_jobs SET state = 'failed', error_code = 'processor_failed' WHERE id = ?")
            .bind(created.job.id)
            .run()

        const headers = {
            cookie: `myoc_session=${otherSession}`,
            'x-csrf-token': await createCsrfToken(otherSession),
        }
        const retry = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}/retry`,
            {method: 'POST', headers: {...headers, 'idempotency-key': 'other-user-retry'}},
            env,
        )
        const cancel = await apiRoutes.request(`https://example.com/image-uploads/${created.job.id}`, {method: 'DELETE', headers}, env)

        expect(retry.status).toBe(404)
        expect(cancel.status).toBe(404)
        const ownerStatus = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}`,
            {
                headers: {cookie: `myoc_session=${sessionToken}`},
            },
            env,
        )
        expect(ownerStatus.status).toBe(200)
        expect((await ownerStatus.json()) as {job: {state: string}}).toHaveProperty('job.state', 'failed')
    })

    it('retries a failed job once for each retry idempotency key', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv()
        const created = (await (await postUpload(env)).json()) as {job: {id: string}}
        await db
            .prepare(
                `UPDATE image_upload_jobs SET state = 'failed', error_code = 'processor_failed', error_message = 'Failed' WHERE id = ?`,
            )
            .bind(created.job.id)
            .run()
        await db
            .prepare(`UPDATE image_processing_tasks SET state = 'failed', sharp_attempts = 3 WHERE job_id = ?`)
            .bind(created.job.id)
            .run()

        const response = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'retry-route-key',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(response.status).toBe(202)
        expect((await response.json()) as {job: {state: string}}).toHaveProperty('job.state', 'waiting')
        expect(await queryOne<{generation: number}>('SELECT generation FROM image_upload_jobs WHERE id = ?', [created.job.id], db)).toEqual(
            {
                generation: 2,
            },
        )
    })

    it('returns clear status and retry errors', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv()
        const missing = await apiRoutes.request(
            `https://example.com/image-uploads/${crypto.randomUUID()}`,
            {
                headers: {cookie: `myoc_session=${sessionToken}`},
            },
            env,
        )
        expect(missing.status).toBe(404)

        const retry = await apiRoutes.request(
            `https://example.com/image-uploads/${crypto.randomUUID()}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'retry-route-key',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(retry.status).toBe(404)

        const invalidRetry = await apiRoutes.request(
            `https://example.com/image-uploads/${crypto.randomUUID()}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'short',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(invalidRetry.status).toBe(400)

        const created = (await (await postUpload(env, {idempotencyKey: 'active-retry-job'})).json()) as {job: {id: string}}
        const conflict = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'active-retry-key',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(conflict.status).toBe(409)

        await db.prepare(`UPDATE image_upload_jobs SET state = 'failed' WHERE id = ?`).bind(created.job.id).run()
        await db.prepare(`DELETE FROM image_processing_tasks WHERE job_id = ?`).bind(created.job.id).run()
        const systemFailure = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'missing-task-retry',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            env,
        )
        expect(systemFailure.status).toBe(500)

        const cancelHeaders = {
            cookie: `myoc_session=${sessionToken}`,
            'x-csrf-token': await createCsrfToken(sessionToken),
        }
        expect(
            (
                await apiRoutes.request(
                    `https://example.com/image-uploads/${created.job.id}`,
                    {method: 'DELETE', headers: cancelHeaders},
                    env,
                )
            ).status,
        ).toBe(200)
        expect(
            (
                await apiRoutes.request(
                    `https://example.com/image-uploads/${created.job.id}`,
                    {method: 'DELETE', headers: cancelHeaders},
                    env,
                )
            ).status,
        ).toBe(200)
        expect(
            (
                await apiRoutes.request(
                    `https://example.com/image-uploads/${crypto.randomUUID()}`,
                    {method: 'DELETE', headers: cancelHeaders},
                    env,
                )
            ).status,
        ).toBe(404)
    })

    it('rejects uploads when the network rate limiter denies the request', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv({UPLOAD_NETWORK_RATE_LIMITER: createMockRateLimit(false)})

        const response = await postUpload(env)

        expect(response.status).toBe(429)
        expect(response.headers.get('retry-after')).toBe('60')
        expect(await queryOne(`SELECT id FROM image_upload_jobs WHERE user_id = 'user-1'`)).toBeNull()
    })

    it('rejects uploads when the identity rate limiter denies the request', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv({UPLOAD_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(false)})

        const response = await postUpload(env)

        expect(response.status).toBe(429)
    })

    it('rejects retries when the network rate limiter denies the request', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv()
        const created = (await (await postUpload(env, {idempotencyKey: 'retry-limited-key'})).json()) as {job: {id: string}}

        const response = await apiRoutes.request(
            `https://example.com/image-uploads/${created.job.id}/retry`,
            {
                method: 'POST',
                headers: {
                    cookie: `myoc_session=${sessionToken}`,
                    'idempotency-key': 'retry-limited-retry',
                    'x-csrf-token': await createCsrfToken(sessionToken),
                },
            },
            createEnv({UPLOAD_NETWORK_RATE_LIMITER: createMockRateLimit(false)}),
        )

        expect(response.status).toBe(429)
    })

    it('caps active upload jobs per account', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        await seedUploadJob('active-job-1', 'queued')
        await seedUploadJob('active-job-2', 'processing')
        const env = createEnv({IMAGE_UPLOAD_MAX_ACTIVE_JOBS: '2'})

        const blocked = await postUpload(env, {idempotencyKey: 'over-active-cap'})
        expect(blocked.status).toBe(429)
        expect(blocked.headers.get('retry-after')).toBe('60')

        await db.prepare(`UPDATE image_upload_jobs SET state = 'ready' WHERE id = 'active-job-2'`).run()
        const allowed = await postUpload(env, {idempotencyKey: 'under-active-cap'})
        expect(allowed.status).toBe(202)
    })

    it('falls back to the default cap when the override is not a positive number', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        await seedUploadJob('active-job-1', 'queued')
        const env = createEnv({IMAGE_UPLOAD_MAX_ACTIVE_JOBS: '0'})

        const response = await postUpload(env, {idempotencyKey: 'zero-cap-override'})
        expect(response.status).toBe(202)
    })

    it('caps upload jobs created per rolling day', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        await seedUploadJob('quota-job-1', 'ready')
        await seedUploadJob('quota-job-2', 'ready')
        await seedUploadJob('quota-job-old', 'ready', {createdAt: new Date(Date.now() - 25 * 60 * 60 * 1_000)})
        const env = createEnv({IMAGE_UPLOAD_DAILY_QUOTA: '2'})

        const blocked = await postUpload(env, {idempotencyKey: 'over-daily-quota'})
        expect(blocked.status).toBe(429)
    })

    it('lets an idempotent replay through even when the quota is exhausted', async () => {
        await seedAuthenticatedUser({id: 'user-1'}, sessionToken)
        const env = createEnv({IMAGE_UPLOAD_DAILY_QUOTA: '1'})

        const first = await postUpload(env, {idempotencyKey: 'quota-replay-key'})
        expect(first.status).toBe(202)
        const firstBody = (await first.json()) as {job: {id: string}}

        const replay = await postUpload(env, {idempotencyKey: 'quota-replay-key'})
        expect(replay.status).toBe(202)
        expect((await replay.json()) as {job: {id: string}}).toHaveProperty('job.id', firstBody.job.id)
    })
})
