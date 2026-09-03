import {afterEach, describe, expect, it, vi} from 'vitest'
import {createAvifBytes} from '../../test/imageFixtures'
import type {Bindings} from '../../types/bindings'
import {generateMediaPreviewWithContainer, generateNsfwBlurImage} from './previewGeneration'

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
        const fetch = vi.fn(async () => new Response(null, {status: 429}))
        const generation = generateMediaPreviewWithContainer(previewEnvironment([], fetch), sourceUrl, {width: 100, height: 80})
        const expectation = expect(generation).rejects.toThrow('Container preview failed with 429')

        await vi.runAllTimersAsync()

        await expectation
        expect(fetch).toHaveBeenCalledTimes(3)
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

    it('returns the AVIF blur image from Cloudflare Images', async () => {
        const bytes = createAvifBytes(100, 80)

        await expect(
            generateNsfwBlurImage(imagesBinding(new Response(bytes, {headers: {'content-type': 'IMAGE/AVIF; charset=binary'}})), preview),
        ).resolves.toEqual({
            bytes,
            contentType: 'image/avif',
        })
    })

    it('rejects use without a Cloudflare Images binding', async () => {
        await expect(generateNsfwBlurImage(undefined, preview)).rejects.toThrow('Cloudflare Images binding is not configured.')
    })

    it.each([
        ['a failed response', new Response(createAvifBytes(100, 80), {status: 500, headers: {'content-type': 'image/avif'}})],
        ['a non-AVIF response', new Response(createAvifBytes(100, 80), {headers: {'content-type': 'image/webp'}})],
        ['a response without a content type', new Response(createAvifBytes(100, 80))],
    ])('rejects %s', async (_caseName, response) => {
        await expect(generateNsfwBlurImage(imagesBinding(response), preview)).rejects.toThrow(
            'Cloudflare Images did not return the requested AVIF blur image',
        )
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

function imagesBinding(response: Response): ImagesBinding {
    const transformer = {
        transform: vi.fn(() => transformer),
        output: vi.fn(async () => ({response: () => response})),
    }

    return {
        input: vi.fn(() => transformer),
    } as unknown as ImagesBinding
}
