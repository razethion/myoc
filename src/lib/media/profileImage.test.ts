import {describe, expect, it, vi} from 'vitest'
import {createAvifBytes, createPngFile} from '../../test/imageFixtures'
import type {Bindings} from '../../types/bindings'
import {normalizeProfileImagePayload} from './profileImage'

describe('normalizeProfileImagePayload', () => {
    it('converts a valid 512 pixel PNG to AVIF in the Sharp container', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        const output = createAvifBytes(512, 512)

        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', containerEnv(output))).resolves.toEqual(
            {
                bytes: output,
                contentType: 'image/avif',
            },
        )
    })

    it('rejects an unsupported source type', async () => {
        const bytes = new Uint8Array(await createPngFile(512, 512).arrayBuffer())
        await expect(normalizeProfileImagePayload({contentType: 'image/gif', bytes}, 'Profile photo', containerEnv())).resolves.toEqual({
            error: 'Unexpected media, contact support',
            status: 400,
        })
    })

    it('rejects a PNG with the wrong dimensions', async () => {
        const file = createPngFile(511, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        await expect(normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', containerEnv())).resolves.toEqual({
            error: 'Profile photo must be exactly 512x512 pixels',
            status: 400,
        })
    })

    it('rejects malformed PNG data', async () => {
        await expect(
            normalizeProfileImagePayload({contentType: 'image/png', bytes: new Uint8Array([1, 2, 3])}, 'Profile photo', containerEnv()),
        ).resolves.toEqual({error: 'Unexpected media, contact support', status: 400})
    })

    it('maps a container failure to the stable media error', async () => {
        const file = createPngFile(512, 512)
        const bytes = new Uint8Array(await file.arrayBuffer())
        await expect(
            normalizeProfileImagePayload({contentType: file.type, bytes}, 'Profile photo', containerEnv(new Error('failed'))),
        ).resolves.toEqual({error: 'Unexpected media, contact support', status: 400})
    })

    it('rejects oversized source bytes before invoking the container', async () => {
        const env = containerEnv()
        const bytes = new Uint8Array(3 * 1024 * 1024 + 1)
        await expect(normalizeProfileImagePayload({contentType: 'image/png', bytes}, 'Profile photo', env)).resolves.toEqual({
            error: 'Profile photo upload is too large',
            status: 413,
        })
        expect(env.MYOC_DOCKER_SHARP_CONTAINER.get).not.toHaveBeenCalled()
    })
})

function containerEnv(response: Uint8Array | Error = createAvifBytes(512, 512)) {
    const fetch = vi.fn(async () => {
        if (response instanceof Error) throw response
        return new Response(response, {headers: {'content-type': 'image/avif'}})
    })
    return {
        MEDIA_PREVIEW_OVERFLOW_ENABLED: 'false' as const,
        MYOC_DOCKER_SHARP_CONTAINER: {
            idFromName: vi.fn(() => 'container-id'),
            get: vi.fn(() => ({fetch})),
        } as unknown as Bindings['MYOC_DOCKER_SHARP_CONTAINER'],
        PREVIEW_PROCESSOR_TOKEN: 'test-token',
    }
}
