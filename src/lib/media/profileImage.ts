import type {Bindings} from '../../types/bindings'
import {readGalleryImageDimensions} from './imageMetadata'
import {generateSquareImageWithContainer, type SQUARE_IMAGE_CONTENT_TYPE} from './previewGeneration'

const PROFILE_IMAGE_SIZE = 512
const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const PROFILE_IMAGE_SOURCE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR = 'Unexpected media, contact support'
const PROFILE_IMAGE_MAX_REQUEST_BYTES = 3 * 1024 * 1024
const PROFILE_IMAGE_MAX_DATA_URL_BYTES = Math.ceil(PROFILE_IMAGE_MAX_REQUEST_BYTES / 3) * 4 + 4
export const PROFILE_IMAGE_MAX_JSON_REQUEST_BYTES = PROFILE_IMAGE_MAX_DATA_URL_BYTES + 16 * 1024
export const PROFILE_IMAGE_MAX_MULTIPART_REQUEST_BYTES = PROFILE_IMAGE_MAX_REQUEST_BYTES + 64 * 1024

type ProfileImagePayload = {
    contentType: string
    bytes: Uint8Array
}

type NormalizedProfileImagePayload = {
    contentType: typeof SQUARE_IMAGE_CONTENT_TYPE
    bytes: Uint8Array
}

function validateProfileImagePayload(
    image: ProfileImagePayload,
    label: string,
):
    | {ok: true}
    | {
          error: string
          status: 400
      } {
    if (image.bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) {
        return {error: `${label} must be 2 MB or smaller`, status: 400}
    }

    const dimensions = readGalleryImageDimensions(image.bytes, image.contentType)

    if (!dimensions) {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
    }

    if (dimensions.width !== PROFILE_IMAGE_SIZE || dimensions.height !== PROFILE_IMAGE_SIZE) {
        return {error: `${label} must be exactly 512x512 pixels`, status: 400}
    }

    return {ok: true}
}

export async function normalizeProfileImagePayload(
    image: ProfileImagePayload,
    label: string,
    env: Pick<Bindings, 'MEDIA_PREVIEW_OVERFLOW_ENABLED' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>,
): Promise<
    | NormalizedProfileImagePayload
    | {
          error: string
          status: 400 | 413
      }
> {
    if (image.bytes.byteLength > PROFILE_IMAGE_MAX_REQUEST_BYTES) {
        return {error: `${label} upload is too large`, status: 413}
    }

    const contentType = image.contentType.toLowerCase()

    if (!PROFILE_IMAGE_SOURCE_CONTENT_TYPES.has(contentType)) {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
    }

    const validation = validateProfileImagePayload({...image, contentType}, label)

    if ('error' in validation) {
        return validation
    }

    try {
        return await generateSquareImageWithContainer(env, image.bytes, crypto.randomUUID(), {
            sourceContentType: contentType as 'image/jpeg' | 'image/png' | 'image/webp',
        })
    } catch {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
    }
}

export function isProfileImageDataUrlTooLarge(encodedBytes: string): boolean {
    return encodedBytes.length > PROFILE_IMAGE_MAX_DATA_URL_BYTES
}
