import type {Bindings} from '../../types/bindings'
import {objectStorageEncryptionKey} from '../storage/ssec'

const THUMBNAIL_SOURCE_MAX_BYTES = 3 * 1024 * 1024
const THUMBNAIL_SOURCE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif'])

type ThumbnailContentType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif'

export type ThumbnailSourceTarget = {
    kind: 'user-profile' | 'character-profile' | 'folder-image'
    userId: string
    targetId: string
    imageKey: string
    objectKey: string
    contentType: string
}

type RetainedSourceRow = {
    object_key: string
    content_type: string
}

export function thumbnailOriginalObjectKey(thumbnailObjectKey: string): string {
    return `thumbnail-originals/${thumbnailObjectKey}.source`
}

export async function retainThumbnailOriginal(
    env: Pick<Bindings, 'MEDIA_BUCKET' | 'OBJECT_STORAGE_ENCRYPTION_KEY'>,
    thumbnailObjectKey: string,
    bytes: Uint8Array,
    contentType: string,
): Promise<void> {
    const normalizedContentType = validateThumbnailSource(bytes, contentType)

    await env.MEDIA_BUCKET.put(thumbnailOriginalObjectKey(thumbnailObjectKey), bytes, {
        onlyIf: new Headers({'if-none-match': '*'}),
        httpMetadata: {
            cacheControl: 'private, no-store',
            contentType: normalizedContentType,
        },
        ssecKey: objectStorageEncryptionKey(env),
    })
}

export async function readThumbnailOriginal(
    env: Pick<Bindings, 'DB' | 'MEDIA_BUCKET' | 'OBJECT_STORAGE_ENCRYPTION_KEY'>,
    target: ThumbnailSourceTarget,
): Promise<{bytes: Uint8Array; contentType: ThumbnailContentType}> {
    const retainedKey = thumbnailOriginalObjectKey(target.objectKey)
    const ssecKey = objectStorageEncryptionKey(env)
    const retained = await env.MEDIA_BUCKET.get(retainedKey, {ssecKey})

    if (retained) {
        return await readBoundedObject(retained, retained.httpMetadata?.contentType)
    }

    const source = await findReadyUploadSource(env.DB, target)

    if (source) {
        const sourceObject = await env.MEDIA_BUCKET.get(source.object_key, {ssecKey})

        if (sourceObject) {
            return await readBoundedObject(sourceObject, source.content_type)
        }
    }

    const currentThumbnail = await env.MEDIA_BUCKET.get(target.objectKey)

    if (!currentThumbnail) {
        throw new Error('The thumbnail source is not available')
    }

    const fallback = await readBoundedObject(currentThumbnail, currentThumbnail.httpMetadata?.contentType ?? target.contentType)
    await retainThumbnailOriginal(env, target.objectKey, fallback.bytes, fallback.contentType)
    return fallback
}

async function findReadyUploadSource(db: D1Database, target: ThumbnailSourceTarget): Promise<RetainedSourceRow | null> {
    const targetType =
        target.kind === 'user-profile' ? 'user_profile' : target.kind === 'character-profile' ? 'character_profile' : 'folder_image'

    return await db
        .prepare(
            `SELECT source.object_key, source.content_type
             FROM image_upload_jobs AS job
             JOIN image_upload_sources AS source ON source.job_id = job.id
             WHERE job.user_id = ?
               AND job.target_type = ?
               AND job.target_id = ?
               AND job.state = 'ready'
               AND source.state = 'ready'
               AND json_extract(job.result_json, '$.key') = ?
             ORDER BY job.updated_at DESC
             LIMIT 1`,
        )
        .bind(target.userId, targetType, target.targetId, target.imageKey)
        .first<RetainedSourceRow>()
}

async function readBoundedObject(object: R2ObjectBody, contentType: string | undefined) {
    if (object.size > THUMBNAIL_SOURCE_MAX_BYTES) {
        throw new Error('The thumbnail source is too large')
    }

    const bytes = new Uint8Array(await object.arrayBuffer())
    const normalizedContentType = validateThumbnailSource(bytes, contentType ?? '')
    return {bytes, contentType: normalizedContentType}
}

function validateThumbnailSource(bytes: Uint8Array, contentType: string): ThumbnailContentType {
    if (bytes.byteLength === 0) {
        throw new Error('The thumbnail source is empty')
    }

    if (bytes.byteLength > THUMBNAIL_SOURCE_MAX_BYTES) {
        throw new Error('The thumbnail source is too large')
    }

    const normalizedContentType = contentType.trim().toLowerCase()

    if (!THUMBNAIL_SOURCE_CONTENT_TYPES.has(normalizedContentType)) {
        throw new Error('The thumbnail source type is not supported')
    }

    return normalizedContentType as ThumbnailContentType
}
