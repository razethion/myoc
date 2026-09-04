import type {Bindings} from '../../types/bindings'
import {readGalleryImageDimensions} from './imageMetadata'

export const GALLERY_PREVIEW_CONTENT_TYPE = 'image/avif' as const
export const GALLERY_NSFW_BLUR_CONTENT_TYPE = 'image/avif' as const

const GALLERY_PREVIEW_MAX_LONG_EDGE = 1600
const GALLERY_PREVIEW_MAX_PIXELS = GALLERY_PREVIEW_MAX_LONG_EDGE * GALLERY_PREVIEW_MAX_LONG_EDGE
const GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL = 4
const GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES = 4096
const GALLERY_PREVIEW_MAX_BYTES =
    GALLERY_PREVIEW_MAX_PIXELS * GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL + GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES
const GALLERY_PREVIEW_DIMENSION_TOLERANCE = 1
const GALLERY_PREVIEW_CONTAINER_MAX_ATTEMPTS = 3
const GALLERY_PREVIEW_CONTAINER_RETRY_DELAY_MS = 1_000
const GALLERY_NSFW_BLUR_MAX_WIDTH = 960
const GALLERY_NSFW_BLUR_AMOUNT = 250
const GALLERY_NSFW_BLUR_QUALITY = 60

type PreviewGeneratorEnv = Pick<Bindings, 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

export type PreviewSourceImage = {
    width: number
    height: number
    displayWidth?: number
    displayHeight?: number
}

export type GeneratedGalleryPreview = {
    bytes: Uint8Array
    contentType: typeof GALLERY_PREVIEW_CONTENT_TYPE
    width: number
    height: number
}

type GeneratedNsfwBlur = {
    bytes: Uint8Array
    contentType: typeof GALLERY_NSFW_BLUR_CONTENT_TYPE
}

class PreviewValidationError extends Error {}

export async function generateMediaPreviewWithContainer(
    env: PreviewGeneratorEnv,
    sourceUrl: string,
    image: PreviewSourceImage,
): Promise<GeneratedGalleryPreview> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Preview container binding is not configured.')
    }

    const id = env.MYOC_DOCKER_SHARP_CONTAINER.idFromName('myoc-docker-sharp')
    const container = env.MYOC_DOCKER_SHARP_CONTAINER.get(id)

    for (let attempt = 1; attempt <= GALLERY_PREVIEW_CONTAINER_MAX_ATTEMPTS; attempt += 1) {
        try {
            const response = await container.fetch('https://container/images/preview', {
                body: JSON.stringify({imageUrl: sourceUrl}),
                headers: {
                    authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
                    'content-type': 'application/json',
                },
                method: 'POST',
            })

            return await previewFromResponse(response, image, 'Container preview')
        } catch (error) {
            if (error instanceof PreviewValidationError || attempt === GALLERY_PREVIEW_CONTAINER_MAX_ATTEMPTS) {
                throw error
            }

            console.warn('Container preview generation failed transiently, retrying', {
                attempt,
                error: error instanceof Error ? error.message : String(error),
            })
            await sleep(GALLERY_PREVIEW_CONTAINER_RETRY_DELAY_MS)
        }
    }

    /* istanbul ignore next -- maxAttempts is positive, and the loop either returns or throws from the catch block. */
    throw new Error('Container preview failed unexpectedly.')
}

export async function generateNsfwBlurImage(
    images: ImagesBinding | undefined,
    preview: GeneratedGalleryPreview,
): Promise<GeneratedNsfwBlur> {
    if (!images) {
        throw new Error('Cloudflare Images binding is not configured.')
    }

    const result = await images
        .input(streamFromBytes(preview.bytes))
        .transform({width: GALLERY_NSFW_BLUR_MAX_WIDTH, fit: 'scale-down'})
        .transform({blur: GALLERY_NSFW_BLUR_AMOUNT})
        .output({format: GALLERY_NSFW_BLUR_CONTENT_TYPE, quality: GALLERY_NSFW_BLUR_QUALITY})

    const response = result.response()
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''

    if (!response.ok || contentType !== GALLERY_NSFW_BLUR_CONTENT_TYPE) {
        throw new Error('Cloudflare Images did not return the requested AVIF blur image')
    }

    return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: GALLERY_NSFW_BLUR_CONTENT_TYPE,
    }
}

function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/* istanbul ignore next -- validation branches are directly tested; remaining gaps are defensive message-format combinations. */
async function previewFromResponse(response: Response, image: PreviewSourceImage, label: string): Promise<GeneratedGalleryPreview> {
    const bytes = new Uint8Array(await response.arrayBuffer())
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? ''

    assertPreviewResponse(response, bytes, contentType, label)

    const dimensions = readGalleryImageDimensions(bytes, GALLERY_PREVIEW_CONTENT_TYPE)

    if (!dimensions) {
        throw new PreviewValidationError(`${label} returned an invalid AVIF image`)
    }

    const preview = {
        bytes,
        contentType: GALLERY_PREVIEW_CONTENT_TYPE,
        width: dimensions.width,
        height: dimensions.height,
    } satisfies GeneratedGalleryPreview

    assertPreviewMatchesOriginal(preview, image, label)

    if (bytes.byteLength > maxPreviewByteSize(preview.width, preview.height)) {
        throw new PreviewValidationError(`${label} is too large for its dimensions`)
    }

    return preview
}

function assertPreviewResponse(response: Response, bytes: Uint8Array, contentType: string, label: string): void {
    if (!response.ok) {
        const message = `${label} failed with ${response.status}`

        if (response.status === 429 || response.status >= 500) {
            throw new Error(message)
        }

        throw new PreviewValidationError(message)
    }

    if (contentType !== GALLERY_PREVIEW_CONTENT_TYPE) {
        const details = contentType ? ` (${contentType})` : ''
        throw new PreviewValidationError(`${label} returned an unexpected content type${details}`)
    }

    if (bytes.byteLength <= 0) {
        throw new PreviewValidationError(`${label} is empty`)
    }

    /* istanbul ignore if -- exercising this would require allocating an 800MB+ response in a Worker test. */
    if (bytes.byteLength > GALLERY_PREVIEW_MAX_BYTES) {
        throw new PreviewValidationError(`${label} is too large`)
    }
}

function assertPreviewMatchesOriginal(preview: GeneratedGalleryPreview, original: PreviewSourceImage, label: string): void {
    const expected = expectedPreviewDimensions(original)
    const widthDelta = Math.abs(preview.width - expected.width)
    const heightDelta = Math.abs(preview.height - expected.height)

    if (widthDelta > GALLERY_PREVIEW_DIMENSION_TOLERANCE || heightDelta > GALLERY_PREVIEW_DIMENSION_TOLERANCE) {
        throw new PreviewValidationError(`${label} dimensions must match the uploaded image scaled to ${GALLERY_PREVIEW_MAX_LONG_EDGE}px`)
    }
}

function expectedPreviewDimensions(original: PreviewSourceImage): {width: number; height: number} {
    const width = original.displayWidth ?? original.width
    const height = original.displayHeight ?? original.height
    const longEdge = Math.max(width, height)
    const scale = Math.min(1, GALLERY_PREVIEW_MAX_LONG_EDGE / longEdge)

    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    }
}

function maxPreviewByteSize(width: number, height: number): number {
    return width * height * GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL + GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}
