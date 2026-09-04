import {vi} from 'vitest'
import {createAvifBytes, createWebpBytes} from './imageFixtures'

const transformedImageBytes = createWebpBytes(512, 512)

export function createMockImagesBinding(): ImagesBinding {
    return {
        info: vi.fn(async () => ({
            format: 'image/webp',
            fileSize: transformedImageBytes.byteLength,
            width: 1,
            height: 1,
        })),
        input: vi.fn(() => createMockImageTransformer()),
        hosted: {
            image: vi.fn(),
            upload: vi.fn(),
            list: vi.fn(),
        },
    } as unknown as ImagesBinding
}

function createMockImageTransformer(): ImageTransformer {
    const transformer = {
        transform: vi.fn(() => transformer),
        draw: vi.fn(() => transformer),
        output: vi.fn(async (options?: {format?: string}) => {
            const contentType = options?.format === 'image/avif' ? 'image/avif' : 'image/webp'
            const bytes = contentType === 'image/avif' ? createAvifBytes(512, 512) : transformedImageBytes

            return {
                response: () =>
                    new Response(bytes, {
                        headers: {
                            'content-type': contentType,
                        },
                    }),
                contentType: () => contentType,
                image: () => streamFromBytes(bytes),
            }
        }),
    }

    return transformer as unknown as ImageTransformer
}

function streamFromBytes(bytes: Uint8Array): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes)
            controller.close()
        },
    })
}
