import type {Bindings} from '../../types/bindings'
import {readGalleryImageDimensions} from './imageMetadata'

export const GALLERY_PREVIEW_CONTENT_TYPE = 'image/avif' as const
export const GALLERY_NSFW_BLUR_CONTENT_TYPE = 'image/avif' as const
export const SQUARE_IMAGE_CONTENT_TYPE = 'image/avif' as const

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
const MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT = 3
const MEDIA_PREVIEW_TOTAL_CONTAINER_COUNT = 8

type PreviewGeneratorEnv = Pick<Bindings, 'MEDIA_PREVIEW_OVERFLOW_ENABLED' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

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

export type GeneratedNsfwBlur = {
    bytes: Uint8Array
    contentType: typeof GALLERY_NSFW_BLUR_CONTENT_TYPE
}

export type GeneratedSquareImage = {
    bytes: Uint8Array
    contentType: typeof SQUARE_IMAGE_CONTENT_TYPE
}

export type GeneratedGalleryOutputs = {
    preview: GeneratedGalleryPreview
    blur: GeneratedNsfwBlur | null
}

export class PreviewValidationError extends Error {}
export class PreviewContainerBusyError extends Error {}

export type PreviewContainerRequestOptions = {
    containerIndex?: number
    maxAttempts?: number
    priority?: 'background' | 'interactive'
    sourceContentType?: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
}

export async function generateMediaPreviewWithContainer(
    env: PreviewGeneratorEnv,
    sourceUrl: string,
    image: PreviewSourceImage,
    options: PreviewContainerRequestOptions = {},
): Promise<GeneratedGalleryPreview> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Preview container binding is not configured.')
    }

    return await withPreviewContainerRetry(env, sourceUrl, options, async (container) => {
        const response = await container.fetch('https://container/images/preview', {
            body: JSON.stringify({imageUrl: sourceUrl}),
            headers: {
                authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
                'content-type': 'application/json',
            },
            method: 'POST',
        })

        return await previewFromResponse(response, image, 'Container preview')
    })
}

export async function generateNsfwBlurImage(
    env: PreviewGeneratorEnv,
    preview: Pick<GeneratedGalleryPreview, 'bytes' | 'height' | 'width'>,
    options: PreviewContainerRequestOptions = {},
): Promise<GeneratedNsfwBlur> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Preview container binding is not configured.')
    }

    return await withPreviewContainerRetry(env, String(preview.width), options, async (container) => {
        const response = await container.fetch('https://container/images/blur', {
            body: preview.bytes,
            headers: {
                authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
                'content-type': GALLERY_PREVIEW_CONTENT_TYPE,
            },
            method: 'POST',
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''

        assertPreviewResponse(response, bytes, contentType, 'Container blur')
        const dimensions = readGalleryImageDimensions(bytes, GALLERY_NSFW_BLUR_CONTENT_TYPE)

        if (!dimensions) {
            throw new PreviewValidationError('Container blur returned an invalid AVIF image')
        }

        const expected = expectedBlurDimensions(preview)
        if (
            Math.abs(dimensions.width - expected.width) > GALLERY_PREVIEW_DIMENSION_TOLERANCE ||
            Math.abs(dimensions.height - expected.height) > GALLERY_PREVIEW_DIMENSION_TOLERANCE
        ) {
            throw new PreviewValidationError(
                `Container blur dimensions must match the preview scaled to ${GALLERY_NSFW_BLUR_MAX_WIDTH}px wide`,
            )
        }

        if (bytes.byteLength > maxPreviewByteSize(dimensions.width, dimensions.height)) {
            throw new PreviewValidationError('Container blur is too large for its dimensions')
        }

        return {
            bytes,
            contentType: GALLERY_NSFW_BLUR_CONTENT_TYPE,
        }
    })
}

export async function generateSquareImageWithContainer(
    env: PreviewGeneratorEnv,
    source: Uint8Array,
    routingKey: string,
    options: PreviewContainerRequestOptions = {},
): Promise<GeneratedSquareImage> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Image container binding is not configured.')
    }

    return await withPreviewContainerRetry(env, routingKey, options, async (container) => {
        const response = await container.fetch('https://container/images/square', {
            body: source,
            headers: {
                authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
                'content-type': options.sourceContentType ?? 'image/png',
            },
            method: 'POST',
        })
        const bytes = new Uint8Array(await response.arrayBuffer())
        const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''

        assertPreviewResponse(response, bytes, contentType, 'Container square image')
        const dimensions = readGalleryImageDimensions(bytes, SQUARE_IMAGE_CONTENT_TYPE)

        if (dimensions?.width !== 512 || dimensions.height !== 512) {
            throw new PreviewValidationError('Container square image must be a 512x512 AVIF image')
        }

        return {
            bytes,
            contentType: SQUARE_IMAGE_CONTENT_TYPE,
        }
    })
}

export async function generateGalleryOutputsWithContainer(
    env: PreviewGeneratorEnv,
    source: () => Promise<ReadableStream>,
    sourceImage: PreviewSourceImage,
    includeBlur: boolean,
    routingKey: string,
    options: PreviewContainerRequestOptions = {},
): Promise<GeneratedGalleryOutputs> {
    if (!env.MYOC_DOCKER_SHARP_CONTAINER) {
        throw new Error('Image container binding is not configured.')
    }

    return await withPreviewContainerRetry(env, routingKey, options, async (container) => {
        const response = await container.fetch(`https://container/images/gallery?blur=${includeBlur ? '1' : '0'}`, {
            body: await source(),
            headers: {
                authorization: `Bearer ${env.PREVIEW_PROCESSOR_TOKEN}`,
                'content-type': 'application/octet-stream',
            },
            method: 'POST',
        })
        const bytes = new Uint8Array(await response.arrayBuffer())

        if (!response.ok) {
            assertPreviewResponse(response, bytes, '', 'Container gallery image')
        }

        const previewLength = readPositiveHeader(response, 'x-preview-length')
        const blurLength = includeBlur ? readPositiveHeader(response, 'x-blur-length') : 0

        if (previewLength + blurLength !== bytes.byteLength) {
            throw new PreviewValidationError('Container gallery output lengths are invalid')
        }

        const previewBytes = bytes.slice(0, previewLength)
        const preview = await previewFromResponse(
            new Response(previewBytes, {status: 200, headers: {'content-type': GALLERY_PREVIEW_CONTENT_TYPE}}),
            sourceImage,
            'Container preview',
        )
        const blurBytes = bytes.slice(previewLength)

        if (!includeBlur) {
            return {preview, blur: null}
        }

        const blurDimensions = readGalleryImageDimensions(blurBytes, GALLERY_NSFW_BLUR_CONTENT_TYPE)
        const expected = expectedBlurDimensions(preview)

        if (!blurDimensions || blurDimensions.width !== expected.width || blurDimensions.height !== expected.height) {
            throw new PreviewValidationError('Container blur dimensions are invalid')
        }

        return {
            preview,
            blur: {bytes: blurBytes, contentType: GALLERY_NSFW_BLUR_CONTENT_TYPE},
        }
    })
}

async function withPreviewContainerRetry<T>(
    env: PreviewGeneratorEnv,
    routingKey: string,
    options: PreviewContainerRequestOptions,
    request: (container: DurableObjectStub) => Promise<T>,
): Promise<T> {
    const maxAttempts = options.maxAttempts ?? GALLERY_PREVIEW_CONTAINER_MAX_ATTEMPTS
    const firstContainerIndex = options.containerIndex ?? mediaPreviewContainerIndex(routingKey)
    const containerIndices = mediaPreviewContainerIndices(
        routingKey,
        firstContainerIndex,
        options.priority ?? 'interactive',
        maxAttempts,
        env.MEDIA_PREVIEW_OVERFLOW_ENABLED === 'true',
    )
    let processingAttempts = 0
    let lastError: unknown = new Error('No preview container was selected.')

    for (const containerIndex of containerIndices) {
        const id = env.MYOC_DOCKER_SHARP_CONTAINER.idFromName(`myoc-docker-sharp-${containerIndex}`)
        const container = env.MYOC_DOCKER_SHARP_CONTAINER.get(id)
        const result = await requestPreviewContainer(container, request)

        if (result.status === 'success') {
            return result.value
        }

        lastError = result.error

        if (shouldTryNextContainer(result.status, result.error, options.priority ?? 'interactive')) {
            continue
        }

        processingAttempts += 1

        if (processingAttempts === maxAttempts) {
            throw result.error
        }

        console.warn('Container image generation failed transiently, retrying', {
            attempt: processingAttempts,
            containerIndex,
            error: result.error instanceof Error ? result.error.message : String(result.error),
        })
        await sleep(GALLERY_PREVIEW_CONTAINER_RETRY_DELAY_MS)
    }

    throw lastError
}

function shouldTryNextContainer(status: 'busy' | 'failed', error: unknown, priority: 'background' | 'interactive'): boolean {
    if (status === 'failed') {
        return false
    }

    if (priority === 'background') {
        throw error
    }

    return true
}

async function requestPreviewContainer<T>(
    container: DurableObjectStub,
    request: (container: DurableObjectStub) => Promise<T>,
): Promise<{status: 'success'; value: T} | {status: 'busy' | 'failed'; error: unknown}> {
    try {
        return {status: 'success', value: await request(container)}
    } catch (error) {
        if (error instanceof PreviewValidationError) {
            throw error
        }

        return {
            status: error instanceof PreviewContainerBusyError ? 'busy' : 'failed',
            error,
        }
    }
}

export function mediaPreviewContainerIndex(key: string): 0 | 1 | 2 {
    return (mediaPreviewKeyHash(key) % MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT) as 0 | 1 | 2
}

function mediaPreviewContainerIndices(
    routingKey: string,
    firstContainerIndex: number,
    priority: 'background' | 'interactive',
    maxAttempts: number,
    overflowEnabled: boolean,
): number[] {
    const normalizedPrimaryIndex = normalizeContainerIndex(firstContainerIndex, MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT)

    if (priority === 'background') {
        return Array.from({length: maxAttempts}, () => normalizedPrimaryIndex)
    }

    const primaryIndices = rotatedContainerIndices(0, MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT, normalizedPrimaryIndex)

    if (!overflowEnabled) {
        return primaryIndices
    }

    const overflowCount = MEDIA_PREVIEW_TOTAL_CONTAINER_COUNT - MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT
    const firstOverflowIndex = MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT + (mediaPreviewKeyHash(routingKey) % overflowCount)
    const overflowIndices = rotatedContainerIndices(MEDIA_PREVIEW_PRIMARY_CONTAINER_COUNT, overflowCount, firstOverflowIndex)

    return [...primaryIndices, ...overflowIndices]
}

function rotatedContainerIndices(start: number, count: number, firstIndex: number): number[] {
    return Array.from({length: count}, (_, offset) => start + ((firstIndex - start + offset) % count))
}

function normalizeContainerIndex(index: number, count: number): number {
    return ((index % count) + count) % count
}

function mediaPreviewKeyHash(key: string): number {
    let hash = 2_166_136_261

    for (let index = 0; index < key.length; index += 1) {
        hash = Math.imul(hash ^ key.charCodeAt(index), 16_777_619)
    }

    return hash >>> 0
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

        if (response.status === 429) {
            throw new PreviewContainerBusyError(message)
        }

        if (response.status >= 500) {
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

function expectedBlurDimensions(preview: Pick<GeneratedGalleryPreview, 'height' | 'width'>): {width: number; height: number} {
    const scale = Math.min(1, GALLERY_NSFW_BLUR_MAX_WIDTH / preview.width)

    return {
        width: Math.max(1, Math.round(preview.width * scale)),
        height: Math.max(1, Math.round(preview.height * scale)),
    }
}

function maxPreviewByteSize(width: number, height: number): number {
    return width * height * GALLERY_PREVIEW_MAX_BYTES_PER_PIXEL + GALLERY_PREVIEW_MAX_CONTAINER_OVERHEAD_BYTES
}

function readPositiveHeader(response: Response, name: string): number {
    const value = Number.parseInt(response.headers.get(name) ?? '', 10)

    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new PreviewValidationError(`Container gallery response is missing ${name}`)
    }

    return value
}
