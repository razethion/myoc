import {getWebpDimensions} from './webp'

export const PROFILE_IMAGE_SIZE = 512
export const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const PROFILE_IMAGE_MAX_REQUEST_BYTES = 3 * 1024 * 1024

type ProfileImagePayload = {
    contentType: string
    bytes: Uint8Array
}

export function validateProfileImagePayload(
    image: ProfileImagePayload,
    label: string,
): { ok: true } | { error: string; status: 400 } {
    if (image.contentType !== 'image/webp') {
        return {error: `${label} must be a WebP image`, status: 400}
    }

    if (image.bytes.byteLength > PROFILE_IMAGE_MAX_BYTES) {
        return {error: `${label} must be 2 MB or smaller`, status: 400}
    }

    const dimensions = getWebpDimensions(image.bytes)

    if (!dimensions) {
        return {error: `${label} must be a valid WebP image`, status: 400}
    }

    if (dimensions.width !== PROFILE_IMAGE_SIZE || dimensions.height !== PROFILE_IMAGE_SIZE) {
        return {error: `${label} must be exactly 512x512 pixels`, status: 400}
    }

    return {ok: true}
}
