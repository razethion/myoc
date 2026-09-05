import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {readFormDataUpTo} from '../../lib/http/requestBody'
import {ErrorResponseSchema, responseSchema} from '../../lib/http/responseSchemas'
import {
    cancelImageUploadJob,
    createSquareImageUploadJob,
    getImageUploadBatchStatus,
    getImageUploadStatus,
    ImageUploadConflictError,
    ImageUploadKindSchema,
    ImageUploadValidationError,
    retryImageUploadJob,
} from '../../lib/media/imageUploadJobs'
import type {Bindings} from '../../types/bindings'

const IMAGE_UPLOAD_FORM_MAX_BYTES = 3 * 1024 * 1024 + 64 * 1024
const IDEMPOTENCY_KEY_MAX_LENGTH = 200
const SquareImageUploadKindSchema = z.enum(['user-profile', 'character-profile', 'folder-image'])
const ImageUploadStatusSchema = z
    .object({
        id: z.string(),
        batchId: z.string().nullable(),
        state: z.enum(['checking', 'uploading', 'waiting', 'processing', 'ready', 'failed', 'canceled']),
        kind: ImageUploadKindSchema,
        result: z.record(z.string(), z.unknown()).nullable(),
        error: z.object({code: z.string(), message: z.string()}).strict().nullable(),
        createdAt: z.string(),
        updatedAt: z.string(),
    })
    .strict()
const ImageUploadResponseSchema = responseSchema({job: ImageUploadStatusSchema, statusUrl: z.string()})
const ImageUploadBatchResponseSchema = responseSchema({jobs: z.array(ImageUploadStatusSchema)})

export const imageUploadRoutes = new Hono<{Bindings: Bindings}>()

imageUploadRoutes.post('/', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const idempotencyKey = readIdempotencyKey(c.req.header('idempotency-key'))

    if (!idempotencyKey) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'A valid Idempotency-Key header is required'}, 400)
    }

    const form = await readFormDataUpTo(c.req.raw, IMAGE_UPLOAD_FORM_MAX_BYTES)

    if (!form) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Image upload is too large'}, 413)
    }

    const kind = SquareImageUploadKindSchema.safeParse(form.get('kind'))
    const targetId = form.get('targetId')
    const batchId = form.get('batchId')
    const source = form.get('source')

    if (!kind.success || typeof targetId !== 'string' || targetId.length === 0 || !(source instanceof File)) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Image upload data is invalid'}, 400)
    }

    if (source.type.toLowerCase() !== 'image/png') {
        return jsonResponse(c, ErrorResponseSchema, {error: 'The cropped image must be a PNG image'}, 400)
    }

    try {
        const job = await createSquareImageUploadJob(c.env, {
            userId: currentUser.id,
            kind: kind.data,
            targetId,
            idempotencyKey,
            batchId: typeof batchId === 'string' && batchId ? batchId : null,
            bytes: new Uint8Array(await source.arrayBuffer()),
        })
        return jsonResponse(c, ImageUploadResponseSchema, {job, statusUrl: `/api/image-uploads/${encodeURIComponent(job.id)}`}, 202)
    } catch (error) {
        if (error instanceof ImageUploadConflictError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 409)
        }

        if (error instanceof ImageUploadValidationError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

imageUploadRoutes.get('/:jobId', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const job = await getImageUploadStatus(c.env.DB, currentUser.id, c.req.param('jobId'))

    if (!job) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Image upload not found'}, 404)
    }

    const etag = jobEtag(job.id, job.updatedAt, job.state)

    if (c.req.header('if-none-match') === etag) {
        return c.body(null, 304, {etag})
    }

    c.header('etag', etag)
    return jsonResponse(c, ImageUploadResponseSchema, {job, statusUrl: c.req.path}, 200)
})

imageUploadRoutes.post('/:jobId/retry', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const idempotencyKey = readIdempotencyKey(c.req.header('idempotency-key'))

    if (!idempotencyKey) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'A valid Idempotency-Key header is required'}, 400)
    }

    try {
        const job = await retryImageUploadJob(c.env, currentUser.id, c.req.param('jobId'), idempotencyKey)

        if (!job) {
            return jsonResponse(c, ErrorResponseSchema, {error: 'Image upload not found'}, 404)
        }

        return jsonResponse(c, ImageUploadResponseSchema, {job, statusUrl: c.req.path.replace(/\/retry$/, '')}, 202)
    } catch (error) {
        if (error instanceof ImageUploadConflictError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 409)
        }

        throw error
    }
})

imageUploadRoutes.delete('/:jobId', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    await cancelImageUploadJob(c.env.DB, currentUser.id, c.req.param('jobId'))
    const job = await getImageUploadStatus(c.env.DB, currentUser.id, c.req.param('jobId'))

    if (!job) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Image upload not found'}, 404)
    }

    return jsonResponse(c, ImageUploadResponseSchema, {job, statusUrl: c.req.path})
})

export const imageUploadBatchRoutes = new Hono<{Bindings: Bindings}>()

imageUploadBatchRoutes.get('/:batchId', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const jobs = await getImageUploadBatchStatus(c.env.DB, currentUser.id, c.req.param('batchId'))
    return jsonResponse(c, ImageUploadBatchResponseSchema, {jobs})
})

function readIdempotencyKey(value: string | undefined): string | null {
    const normalized = value?.trim() ?? ''
    return normalized.length >= 8 && normalized.length <= IDEMPOTENCY_KEY_MAX_LENGTH ? normalized : null
}

function jobEtag(jobId: string, updatedAt: string, state: string): string {
    const source = `${jobId}:${updatedAt}:${state}`
    let hash = 2_166_136_261
    for (let index = 0; index < source.length; index += 1) hash = Math.imul(hash ^ source.charCodeAt(index), 16_777_619)
    return `W/"${(hash >>> 0).toString(16)}"`
}
