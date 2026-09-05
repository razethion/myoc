import {afterEach, describe, expect, it, vi} from 'vitest'
import {createAvifBytes} from '../../test/imageFixtures'
import type {Bindings} from '../../types/bindings'
import {
    generateGalleryOutputsWithContainer,
    generateMediaPreviewWithContainer,
    generateNsfwBlurImage,
    generateSquareImageWithContainer,
    mediaPreviewContainerIndex,
} from './previewGeneration'

const sourceUrl = 'https://media.example.test/original.png'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('generateMediaPreviewWithContainer', () => {
    it('returns a valid AVIF preview at the uploaded display dimensions', async () => {
        const bytes = createAvifBytes(1600, 800)
        const result = await generateMediaPreviewWithContainer(
            previewEnvironment([new Response(bytes, {headers: {'content-type': 'IMAGE/AVIF; charset=binary'}})]),
            sourceUrl,
            {width: 800, height: 1600, displayWidth: 2400, displayHeight: 1200},
        )

        expect(result).toEqual({bytes, contentType: 'image/avif', width: 1600, height: 800})
    })

    it('accepts previews within one pixel of the source dimensions', async () => {
        await expect(
            generateMediaPreviewWithContainer(previewEnvironment([avifResponse(101, 79)]), sourceUrl, {width: 100, height: 80}),
        ).resolves.toMatchObject({width: 101, height: 79})
    })

    it('rejects use without a preview container binding', async () => {
        const env = {PREVIEW_PROCESSOR_TOKEN: 'test-token'} as Pick<Bindings, 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

        await expect(generateMediaPreviewWithContainer(env, sourceUrl, {width: 100, height: 80})).rejects.toThrow(
            'Preview container binding is not configured.',
        )
    })

    it.each([
        ['an absent content type', new Response(createAvifBytes(100, 80)), 'Container preview returned an unexpected content type'],
        [
            'a non-AVIF content type',
            new Response(createAvifBytes(100, 80), {headers: {'content-type': 'image/webp'}}),
            'Container preview returned an unexpected content type (image/webp)',
        ],
        ['an empty body', new Response(null, {headers: {'content-type': 'image/avif'}}), 'Container preview is empty'],
        [
            'malformed AVIF bytes',
            new Response(new Uint8Array([0, 1, 2]), {headers: {'content-type': 'image/avif'}}),
            'Container preview returned an invalid AVIF image',
        ],
        ['different dimensions', avifResponse(98, 80), 'Container preview dimensions must match the uploaded image scaled to 1600px'],
        [
            'more bytes than its dimensions allow',
            new Response(paddedAvifBytes(100, 80, 40_000), {headers: {'content-type': 'image/avif'}}),
            'Container preview is too large for its dimensions',
        ],
    ])('rejects a preview with %s', async (_caseName, response, message) => {
        await expect(
            generateMediaPreviewWithContainer(previewEnvironment([response]), sourceUrl, {width: 100, height: 80}),
        ).rejects.toThrow(message)
    })

    it('does not retry a permanent container response error', async () => {
        const fetch = vi.fn(async () => new Response(null, {status: 400}))

        await expect(generateMediaPreviewWithContainer(previewEnvironment([], fetch), sourceUrl, {width: 100, height: 80})).rejects.toThrow(
            'Container preview failed with 400',
        )
        expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('retries transient container errors and returns the later preview', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => {
            if (fetch.mock.calls.length === 1) {
                return new Response(null, {status: 503})
            }

            return avifResponse(100, 80)
        })
        const generation = generateMediaPreviewWithContainer(previewEnvironment([], fetch), sourceUrl, {width: 100, height: 80})

        await vi.advanceTimersByTimeAsync(1_000)

        await expect(generation).resolves.toMatchObject({width: 100, height: 80})
        expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('returns the final transient container failure after all attempts', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => new Response(null, {status: 503}))
        const generation = generateMediaPreviewWithContainer(previewEnvironment([], fetch), sourceUrl, {width: 100, height: 80})
        const expectation = expect(generation).rejects.toThrow('Container preview failed with 503')

        await vi.runAllTimersAsync()

        await expectation
        expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('uses overflow capacity after every primary container is busy', async () => {
        const requestedContainers: string[] = []
        const env = routedPreviewEnvironment(async (containerName) => {
            requestedContainers.push(containerName)
            const index = Number(containerName.split('-').at(-1))

            return index < 3 ? new Response(null, {status: 429}) : avifResponse(100, 80)
        })

        await expect(generateMediaPreviewWithContainer(env, sourceUrl, {width: 100, height: 80})).resolves.toMatchObject({
            width: 100,
            height: 80,
        })

        expect(requestedContainers).toHaveLength(4)
        expect(requestedContainers.slice(0, 3).every((name) => Number(name.split('-').at(-1)) < 3)).toBe(true)
        expect(Number(requestedContainers[3]?.split('-').at(-1))).toBeGreaterThanOrEqual(3)
    })

    it('does not use overflow capacity for background work', async () => {
        const requestedContainers: string[] = []
        const env = routedPreviewEnvironment(async (containerName) => {
            requestedContainers.push(containerName)
            return new Response(null, {status: 429})
        })

        await expect(generateMediaPreviewWithContainer(env, sourceUrl, {width: 100, height: 80}, {priority: 'background'})).rejects.toThrow(
            'Container preview failed with 429',
        )

        expect(requestedContainers).toHaveLength(1)
        expect(Number(requestedContainers[0]?.split('-').at(-1))).toBeLessThan(3)
    })

    it('reports busy after all interactive capacity is in use', async () => {
        const requestedContainers: string[] = []
        const env = routedPreviewEnvironment(async (containerName) => {
            requestedContainers.push(containerName)
            return new Response(null, {status: 429})
        })

        await expect(generateMediaPreviewWithContainer(env, sourceUrl, {width: 100, height: 80})).rejects.toThrow(
            'Container preview failed with 429',
        )

        expect(new Set(requestedContainers)).toEqual(new Set(Array.from({length: 8}, (_, index) => `myoc-docker-sharp-${index}`)))
    })

    it('keeps interactive work on primary containers when overflow is disabled', async () => {
        const requestedContainers: string[] = []
        const env = routedPreviewEnvironment(async (containerName) => {
            requestedContainers.push(containerName)
            return new Response(null, {status: 429})
        }, false)

        await expect(generateMediaPreviewWithContainer(env, sourceUrl, {width: 100, height: 80})).rejects.toThrow(
            'Container preview failed with 429',
        )

        expect(requestedContainers).toHaveLength(3)
        expect(requestedContainers.every((name) => Number(name.split('-').at(-1)) < 3)).toBe(true)
    })

    it('retries a non-Error container failure', async () => {
        vi.useFakeTimers()
        const fetch = vi.fn(async () => {
            if (fetch.mock.calls.length === 1) {
                throw 'unavailable'
            }

            return avifResponse(100, 80)
        })
        const generation = generateMediaPreviewWithContainer(previewEnvironment([], fetch), sourceUrl, {width: 100, height: 80})

        await vi.advanceTimersByTimeAsync(1_000)

        await expect(generation).resolves.toMatchObject({width: 100, height: 80})
    })
})

describe('generateNsfwBlurImage', () => {
    const preview = {bytes: createAvifBytes(100, 80), contentType: 'image/avif' as const, width: 100, height: 80}

    it('returns the AVIF blur image from the container', async () => {
        const bytes = createAvifBytes(100, 80)

        await expect(
            generateNsfwBlurImage(
                previewEnvironment([new Response(bytes, {headers: {'content-type': 'IMAGE/AVIF; charset=binary'}})]),
                preview,
            ),
        ).resolves.toEqual({
            bytes,
            contentType: 'image/avif',
        })
    })

    it('rejects use without a preview container binding', async () => {
        const env = {PREVIEW_PROCESSOR_TOKEN: 'test-token'} as Pick<Bindings, 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

        await expect(generateNsfwBlurImage(env, preview)).rejects.toThrow('Preview container binding is not configured.')
    })

    it.each([
        ['a failed response', new Response(createAvifBytes(100, 80), {status: 500, headers: {'content-type': 'image/avif'}})],
        ['a non-AVIF response', new Response(createAvifBytes(100, 80), {headers: {'content-type': 'image/webp'}})],
        ['a response without a content type', new Response(createAvifBytes(100, 80))],
    ])('rejects %s', async (_caseName, response) => {
        await expect(generateNsfwBlurImage(previewEnvironment([response]), preview, {maxAttempts: 1})).rejects.toThrow('Container blur')
    })

    it('rejects a blur with dimensions that do not match the preview', async () => {
        await expect(generateNsfwBlurImage(previewEnvironment([avifResponse(98, 80)]), preview)).rejects.toThrow(
            'Container blur dimensions must match the preview scaled to 960px wide',
        )
    })

    it.each([
        [
            'invalid AVIF bytes',
            new Response(new Uint8Array([1, 2, 3]), {headers: {'content-type': 'image/avif'}}),
            'Container blur returned an invalid AVIF image',
        ],
        [
            'too many bytes for its dimensions',
            new Response(paddedAvifBytes(1, 1, 5_000), {headers: {'content-type': 'image/avif'}}),
            'Container blur is too large for its dimensions',
        ],
    ])('rejects a blur with %s', async (_caseName, response, message) => {
        const onePixelPreview = {bytes: createAvifBytes(1, 1), contentType: 'image/avif' as const, width: 1, height: 1}
        await expect(generateNsfwBlurImage(previewEnvironment([response]), onePixelPreview)).rejects.toThrow(message)
    })
})

describe('mediaPreviewContainerIndex', () => {
    it('maps the same key to one stable configured container', () => {
        const first = mediaPreviewContainerIndex('media-1:sfw')

        expect(first).toBeGreaterThanOrEqual(0)
        expect(first).toBeLessThan(3)
        expect(mediaPreviewContainerIndex('media-1:sfw')).toBe(first)
    })
})

describe('container image recipes', () => {
    const source = () => Promise.resolve(new Blob([new Uint8Array([1])]).stream())

    it('requires a container binding for square and gallery recipes', async () => {
        const env = {PREVIEW_PROCESSOR_TOKEN: 'test-token'} as Pick<Bindings, 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'>

        await expect(generateSquareImageWithContainer(env, new Uint8Array([1]), 'square')).rejects.toThrow(
            'Image container binding is not configured.',
        )
        await expect(generateGalleryOutputsWithContainer(env, source, {width: 100, height: 80}, false, 'gallery')).rejects.toThrow(
            'Image container binding is not configured.',
        )
    })

    it('rejects a square container output with the wrong dimensions', async () => {
        await expect(
            generateSquareImageWithContainer(previewEnvironment([avifResponse(511, 512)]), new Uint8Array([1]), 'square'),
        ).rejects.toThrow('Container square image must be a 512x512 AVIF image')
    })

    it('forwards the validated source content type to the square recipe', async () => {
        const fetch = vi.fn(async (_input?: RequestInfo | URL, init?: RequestInit) => {
            expect(new Headers(init?.headers).get('content-type')).toBe('image/jpeg')
            return avifResponse(512, 512)
        })

        await expect(
            generateSquareImageWithContainer(previewEnvironment([], fetch), new Uint8Array([1]), 'square', {
                sourceContentType: 'image/jpeg',
            }),
        ).resolves.toMatchObject({contentType: 'image/avif'})
    })

    it.each([
        ['a failed response', new Response('failed', {status: 503}), false, 'Container gallery image failed with 503'],
        ['no preview length', new Response(createAvifBytes(100, 80)), false, 'Container gallery response is missing x-preview-length'],
        [
            'incorrect output lengths',
            new Response(createAvifBytes(100, 80), {headers: {'x-preview-length': '47'}}),
            false,
            'Container gallery output lengths are invalid',
        ],
        [
            'incorrect blur dimensions',
            combinedGalleryResponse(createAvifBytes(100, 80), createAvifBytes(99, 80)),
            true,
            'Container blur dimensions are invalid',
        ],
    ])('rejects gallery output with %s', async (_label, response, includeBlur, message) => {
        await expect(
            generateGalleryOutputsWithContainer(previewEnvironment([response]), source, {width: 100, height: 80}, includeBlur, 'gallery', {
                maxAttempts: 1,
            }),
        ).rejects.toThrow(message)
    })
})

function avifResponse(width: number, height: number): Response {
    return new Response(createAvifBytes(width, height), {headers: {'content-type': 'image/avif'}})
}

function paddedAvifBytes(width: number, height: number, byteLength: number): Uint8Array {
    const bytes = new Uint8Array(byteLength)
    bytes.set(createAvifBytes(width, height))
    return bytes
}

function combinedGalleryResponse(preview: Uint8Array, blur: Uint8Array): Response {
    const bytes = new Uint8Array(preview.byteLength + blur.byteLength)
    bytes.set(preview)
    bytes.set(blur, preview.byteLength)
    return new Response(bytes, {
        headers: {'x-preview-length': String(preview.byteLength), 'x-blur-length': String(blur.byteLength)},
    })
}

function previewEnvironment(
    responses: Response[],
    fetch = vi.fn(async () => {
        const response = responses.shift()

        if (!response) {
            throw new Error('No response configured')
        }

        return response
    }),
): Pick<Bindings, 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'> {
    return {
        MYOC_DOCKER_SHARP_CONTAINER: {
            idFromName: vi.fn(() => 'preview-container'),
            get: vi.fn(() => ({fetch})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER'],
        PREVIEW_PROCESSOR_TOKEN: 'test-token',
    }
}

function routedPreviewEnvironment(
    fetch: (containerName: string) => Promise<Response>,
    overflowEnabled = true,
): Pick<Bindings, 'MEDIA_PREVIEW_OVERFLOW_ENABLED' | 'MYOC_DOCKER_SHARP_CONTAINER' | 'PREVIEW_PROCESSOR_TOKEN'> {
    return {
        MEDIA_PREVIEW_OVERFLOW_ENABLED: String(overflowEnabled),
        MYOC_DOCKER_SHARP_CONTAINER: {
            idFromName: vi.fn((name: string) => name),
            get: vi.fn((id: string) => ({fetch: async () => await fetch(id)})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER'],
        PREVIEW_PROCESSOR_TOKEN: 'test-token',
    }
}
