import {getWebpDimensions} from './webp'

const PROFILE_IMAGE_SIZE = 512
const PROFILE_IMAGE_MAX_BYTES = 2 * 1024 * 1024
const PROFILE_IMAGE_WEBP_QUALITY = 90
const PROFILE_IMAGE_CONTENT_TYPE = 'image/webp'
const PROFILE_IMAGE_CONVERTIBLE_CONTENT_TYPES = new Set(['image/png', 'image/jpeg'])
export const PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR = 'Unexpected media, contact support'
export const PROFILE_IMAGE_MAX_REQUEST_BYTES = 3 * 1024 * 1024
const PROFILE_IMAGE_MAX_DATA_URL_BYTES = Math.ceil(PROFILE_IMAGE_MAX_REQUEST_BYTES / 3) * 4 + 4

type ProfileImagePayload = {
    contentType: string
    bytes: Uint8Array
}

type NormalizedProfileImagePayload = {
    contentType: typeof PROFILE_IMAGE_CONTENT_TYPE
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

    const dimensions = getWebpDimensions(image.bytes)

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
    images: ImagesBinding | undefined,
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
    const normalizedImage: NormalizedProfileImagePayload | {error: string; status: 400} =
        contentType === PROFILE_IMAGE_CONTENT_TYPE
            ? {
                  contentType: PROFILE_IMAGE_CONTENT_TYPE,
                  bytes: image.bytes,
              }
            : await convertProfileImageToWebp(
                  {
                      contentType,
                      bytes: image.bytes,
                  },
                  images,
              )

    if ('error' in normalizedImage) {
        return normalizedImage
    }

    const validation = validateProfileImagePayload(normalizedImage, label)

    if ('error' in validation) {
        return validation
    }

    return normalizedImage
}

async function convertProfileImageToWebp(
    image: ProfileImagePayload,
    images: ImagesBinding | undefined,
): Promise<
    | NormalizedProfileImagePayload
    | {
          error: string
          status: 400
      }
> {
    if (!PROFILE_IMAGE_CONVERTIBLE_CONTENT_TYPES.has(image.contentType) || !images) {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
    }

    try {
        const result = await images.input(streamFromBytes(image.bytes)).output({
            format: PROFILE_IMAGE_CONTENT_TYPE,
            quality: PROFILE_IMAGE_WEBP_QUALITY,
        })
        const response = result.response()
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? result.contentType().toLowerCase()

        if (contentType !== PROFILE_IMAGE_CONTENT_TYPE) {
            return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
        }

        return {
            contentType: PROFILE_IMAGE_CONTENT_TYPE,
            bytes: new Uint8Array(await response.arrayBuffer()),
        }
    } catch {
        return {error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR, status: 400}
    }
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}

export function isProfileImageDataUrlTooLarge(encodedBytes: string): boolean {
    return encodedBytes.length > PROFILE_IMAGE_MAX_DATA_URL_BYTES
}
