import {describe, expect, it, vi} from 'vitest'
import {createPngFile, createWebpBytes, createWebpFile} from '../../test/imageFixtures'
import {normalizeProfileImagePayload, PROFILE_IMAGE_MAX_REQUEST_BYTES, PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR} from './profileImage'

describe('normalizeProfileImagePayload', () => {
    it('accepts valid WebP profile images without Cloudflare Images', async () => {
        const file = createWebpFile()
        const bytes = new Uint8Array(await file.arrayBuffer())

        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', undefined)).resolves.toEqual({
            bytes,
            contentType: 'image/webp',
        })
    })

    it('converts PNG profile images and accepts result.contentType when the response header is missing', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const images = createImagesBinding({
            contentType: 'image/webp',
            responseBytes: createWebpBytes(512, 512),
            responseHeaders: {},
        })

        const result = await normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', images)

        expect(result).toEqual({
            bytes: createWebpBytes(512, 512),
            contentType: 'image/webp',
        })
    })

    it('rejects converted profile images when Cloudflare Images does not return WebP', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const images = createImagesBinding({
            contentType: 'image/png',
            responseBytes: createWebpBytes(512, 512),
            responseHeaders: {'content-type': 'image/png'},
        })

        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', images)).resolves.toEqual({
            error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR,
            status: 400,
        })
    })

    it('rejects profile images when Cloudflare Images conversion fails', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const images = createImagesBinding({
            outputError: new Error('conversion failed'),
        })

        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', images)).resolves.toEqual({
            error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR,
            status: 400,
        })
    })

    it('rejects converted profile images when the returned WebP bytes are malformed', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const images = createImagesBinding({
            contentType: 'image/webp',
            responseBytes: new Uint8Array([0, 1, 2, 3]),
            responseHeaders: {'content-type': 'image/webp'},
        })

        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', images)).resolves.toEqual({
            error: PROFILE_IMAGE_UNEXPECTED_MEDIA_ERROR,
            status: 400,
        })
    })

    it('rejects oversized source bytes before invoking the Images binding', async () => {
        const images = createImagesBinding({})
        const bytes = new Uint8Array(PROFILE_IMAGE_MAX_REQUEST_BYTES + 1)

        await expect(normalizeProfileImagePayload({contentType: 'image/png', bytes}, 'Profile photo', images)).resolves.toEqual({
            error: 'Profile photo upload is too large',
            status: 413,
        })
        expect(images.input).not.toHaveBeenCalled()
    })
})

function createImagesBinding({
    contentType = 'image/webp',
    outputError,
    responseBytes = createWebpBytes(512, 512),
    responseHeaders = {'content-type': contentType},
}: {
    contentType?: string
    outputError?: Error
    responseBytes?: Uint8Array
    responseHeaders?: HeadersInit
}): ImagesBinding {
    const transformer = {
        draw: vi.fn(() => transformer),
        output: vi.fn(async () => {
            if (outputError) {
                throw outputError
            }

            return {
                contentType: () => contentType,
                image: () => new ReadableStream<Uint8Array>(),
                response: () =>
                    new Response(responseBytes, {
                        headers: responseHeaders,
                    }),
            }
        }),
        transform: vi.fn(() => transformer),
    }

    return {
        hosted: {
            image: vi.fn(),
            list: vi.fn(),
            upload: vi.fn(),
        },
        info: vi.fn(),
        input: vi.fn(() => transformer),
    } as unknown as ImagesBinding
}
