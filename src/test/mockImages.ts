import {vi} from 'vitest'

const transformedImageBytes = new TextEncoder().encode('mock-transformed-image')

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
        output: vi.fn(async () => ({
            response: () =>
                new Response(transformedImageBytes, {
                    headers: {
                        'content-type': 'image/webp',
                    },
                }),
            contentType: () => 'image/webp',
            image: () => streamFromBytes(transformedImageBytes),
        })),
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
