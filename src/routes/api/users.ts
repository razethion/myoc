import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {readFormDataUpTo} from '../../lib/http/requestBody'
import {ErrorResponseSchema, responseSchema} from '../../lib/http/responseSchemas'
import {normalizeProfileImagePayload, PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES} from '../../lib/media/profileImage'
import {profilePhotoObjectKey, profilePhotoUrl} from '../../lib/media/url'
import {APP_VERSION} from '../../lib/releases'
import type {Bindings} from '../../types/bindings'

const ReleaseViewResponseSchema = responseSchema({
    ok: z.literal(true),
    version: z.string(),
})
const ProfilePhotoResponseSchema = responseSchema({
    profilePhotoKey: z.string(),
    profilePhotoUrl: z.string(),
})

export const userRoutes = new Hono<{Bindings: Bindings}>()

userRoutes.post('/me/release-view', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    await c.env.DB.prepare(
        `UPDATE users
         SET last_seen_version = ?
         WHERE id = ?`,
    )
        .bind(APP_VERSION, currentUser.id)
        .run()

    return jsonResponse(c, ReleaseViewResponseSchema, {
        ok: true,
        version: APP_VERSION,
    })
})

userRoutes.post('/me/profile-photo', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Authentication required'}, 401)
    }

    const form = await readFormDataUpTo(c.req.raw, PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES)

    if (!form) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Profile photo upload is too large'}, 413)
    }
    const file = form.get('profilePhoto')

    if (!(file instanceof File)) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Profile photo is required'}, 400)
    }

    const image = await normalizeProfileImagePayload(
        {
            contentType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
        },
        'Profile photo',
        c.env.IMAGES,
    )

    if ('error' in image) {
        return jsonResponse(c, ErrorResponseSchema, {error: image.error}, image.status)
    }

    const profilePhotoKey = crypto.randomUUID()
    const objectKey = profilePhotoObjectKey(currentUser.id, profilePhotoKey)

    await c.env.MEDIA_BUCKET.put(objectKey, image.bytes, {
        httpMetadata: {
            cacheControl: 'public, max-age=31536000, immutable',
            contentType: image.contentType,
        },
    })

    try {
        await c.env.DB.prepare(
            `UPDATE users
             SET profile_photo_key = ?
             WHERE id = ?`,
        )
            .bind(profilePhotoKey, currentUser.id)
            .run()
    } catch (error) {
        await c.env.MEDIA_BUCKET.delete(objectKey)
        throw error
    }

    if (currentUser.profilePhotoKey) {
        try {
            await c.env.MEDIA_BUCKET.delete(profilePhotoObjectKey(currentUser.id, currentUser.profilePhotoKey))
        } catch (error) {
            console.warn('Unable to delete old profile photo', error)
        }
    }

    return jsonResponse(c, ProfilePhotoResponseSchema, {
        profilePhotoKey,
        profilePhotoUrl: profilePhotoUrl(c.env.MEDIA_PUBLIC_BASE_URL, currentUser.id, profilePhotoKey),
    })
})
