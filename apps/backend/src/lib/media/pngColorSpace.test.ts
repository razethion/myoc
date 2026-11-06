import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {tagPngWithSrgb, tagPngWithSrgbFixedLength} from './pngColorSpace'

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SRGB_CHUNK = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9])

function concat(parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }

    return out
}

function ascii(value: string): Uint8Array {
    const out = new Uint8Array(value.length)

    for (let index = 0; index < value.length; index += 1) {
        out[index] = value.charCodeAt(index)
    }

    return out
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = (value >>> 24) & 0xff
    bytes[offset + 1] = (value >>> 16) & 0xff
    bytes[offset + 2] = (value >>> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return (
        (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
    )
}

function readType(bytes: Uint8Array, offset: number): string {
    return String.fromCharCode(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0, bytes[offset + 3] ?? 0)
}

function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length)
    writeUint32(out, 0, data.length)
    out.set(ascii(type), 4)
    out.set(data, 8)
    return out
}

function ihdr(colorType: number, width = 100, height = 80): Uint8Array {
    const data = new Uint8Array(13)
    writeUint32(data, 0, width)
    writeUint32(data, 4, height)
    data[8] = 8
    data[9] = colorType
    return chunk('IHDR', data)
}

function png(extra: Uint8Array[], colorType = 6): Uint8Array {
    return concat([SIGNATURE, ihdr(colorType), ...extra, chunk('IDAT', new Uint8Array([1, 2, 3, 4, 5])), chunk('IEND', new Uint8Array(0))])
}

function streamOf(bytes: Uint8Array, chunkSize = bytes.length): ReadableStream<Uint8Array> {
    let offset = 0

    return new ReadableStream({
        pull(controller) {
            if (offset >= bytes.length) {
                controller.close()
                return
            }

            const end = Math.min(offset + chunkSize, bytes.length)
            controller.enqueue(bytes.subarray(offset, end))
            offset = end
        },
    })
}

async function readAll(stream: ReadableStream): Promise<Uint8Array> {
    const reader = stream.getReader()
    const parts: Uint8Array[] = []

    for (;;) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        parts.push(value)
    }

    return concat(parts)
}

async function tag(bytes: Uint8Array, chunkSize = bytes.length): Promise<Uint8Array> {
    return readAll(tagPngWithSrgb(streamOf(bytes, chunkSize)))
}

function chunkTypes(bytes: Uint8Array): string[] {
    const types: string[] = []
    let offset = 8

    while (offset + 8 <= bytes.length) {
        const length = readUint32(bytes, offset)
        types.push(readType(bytes, offset + 4))
        offset += 12 + length
    }

    return types
}

function chunkOffset(bytes: Uint8Array, type: string): number {
    let offset = 8

    while (offset + 8 <= bytes.length) {
        const length = readUint32(bytes, offset)

        if (readType(bytes, offset + 4) === type) {
            return offset
        }

        offset += 12 + length
    }

    return -1
}

function withoutChunk(bytes: Uint8Array, type: string): Uint8Array {
    const parts: Uint8Array[] = [bytes.subarray(0, 8)]
    let offset = 8

    while (offset + 8 <= bytes.length) {
        const length = readUint32(bytes, offset)
        const end = offset + 12 + length

        if (readType(bytes, offset + 4) !== type) {
            parts.push(bytes.subarray(offset, end))
        }

        offset = end
    }

    return concat(parts)
}

describe('tagPngWithSrgb', () => {
    it('inserts an sRGB chunk before IDAT for an untagged RGB PNG', async () => {
        const input = png([])
        const output = await tag(input)

        expect(chunkTypes(output)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
        expect(withoutChunk(output, 'sRGB')).toEqual(input)
    })

    it('inserts the canonical sRGB chunk', async () => {
        const output = await tag(png([]))
        const offset = chunkOffset(output, 'sRGB')

        expect(offset).toBeGreaterThan(0)
        expect(output.subarray(offset, offset + SRGB_CHUNK.length)).toEqual(SRGB_CHUNK)
    })

    it.each(['iCCP', 'sRGB', 'cICP', 'gAMA', 'cHRM'])('preserves an existing %s chunk', async (type) => {
        const input = png([chunk(type, new Uint8Array([1]))])

        expect(await tag(input)).toEqual(input)
    })

    it('leaves grayscale PNGs unchanged', async () => {
        const input = png([], 0)

        expect(await tag(input)).toEqual(input)
    })

    it('leaves non-PNG data unchanged', async () => {
        const input = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])

        expect(await tag(input)).toEqual(input)
    })

    it('inserts before PLTE when a palette precedes IDAT', async () => {
        const input = png([chunk('PLTE', new Uint8Array([0, 0, 0]))])
        const output = await tag(input)

        expect(chunkTypes(output)).toEqual(['IHDR', 'sRGB', 'PLTE', 'IDAT', 'IEND'])
        expect(withoutChunk(output, 'sRGB')).toEqual(input)
    })

    it('handles chunk boundaries split across reads', async () => {
        const input = png([chunk('pHYs', new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0]))])

        expect(await tag(input, 1)).toEqual(await tag(input))
    })

    it('does not insert when the stream ends before IDAT', async () => {
        const input = concat([SIGNATURE, ihdr(6)])

        expect(await tag(input)).toEqual(input)
    })

    it('inserts once for multiple IDAT chunks', async () => {
        const input = concat([
            SIGNATURE,
            ihdr(6),
            chunk('IDAT', new Uint8Array([1])),
            chunk('IDAT', new Uint8Array([2])),
            chunk('IEND', new Uint8Array(0)),
        ])

        expect(chunkTypes(await tag(input))).toEqual(['IHDR', 'sRGB', 'IDAT', 'IDAT', 'IEND'])
    })

    it('preserves a truncated signature', async () => {
        const input = SIGNATURE.slice(0, 6)

        expect(await tag(input)).toEqual(input)
    })

    it('passes through when the first chunk is not IHDR', async () => {
        const input = concat([
            SIGNATURE,
            chunk('tEXt', ascii('x')),
            chunk('IDAT', new Uint8Array([1, 2, 3])),
            chunk('IEND', new Uint8Array(0)),
        ])

        expect(await tag(input)).toEqual(input)
    })

    it('passes through an IHDR with an unexpected length', async () => {
        const input = concat([
            SIGNATURE,
            chunk('IHDR', new Uint8Array(12)),
            chunk('IDAT', new Uint8Array([1, 2, 3])),
            chunk('IEND', new Uint8Array(0)),
        ])

        expect(await tag(input)).toEqual(input)
    })
})

describe('tagPngWithSrgbFixedLength', () => {
    it('returns a fixed-length body with the sRGB chunk for an untagged RGB PNG', async () => {
        const input = png([])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output.length).toBe(input.length + SRGB_CHUNK.length)
        expect(chunkTypes(output)).toEqual(['IHDR', 'sRGB', 'IDAT', 'IEND'])
        expect(withoutChunk(output, 'sRGB')).toEqual(input)
    })

    it('returns an unchanged fixed-length body for an already-tagged PNG', async () => {
        const input = png([chunk('iCCP', new Uint8Array([1]))])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output.length).toBe(input.length)
        expect(output).toEqual(input)
    })

    it('returns an unchanged fixed-length body for a grayscale PNG', async () => {
        const input = png([], 0)
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output).toEqual(input)
    })

    it('returns an unchanged fixed-length body for non-PNG data', async () => {
        const input = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output).toEqual(input)
    })

    it('passes through when the prefix does not reach the color decision', async () => {
        const input = png([])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length, {probeBytes: 20}))

        expect(output).toEqual(input)
    })

    it('continues past the probe with ranged reads for large metadata', async () => {
        const metadata = new Uint8Array(1.5 * 1024 * 1024)
        metadata[0] = 0x41
        const input = png([chunk('iTXt', metadata)])
        const bucket = createMockR2Bucket()
        await bucket.put('probe.png', input)
        const stored = await bucket.get('probe.png')

        if (!stored) {
            throw new Error('probe object was not stored')
        }

        const output = await readAll(await tagPngWithSrgbFixedLength(stored.body, input.length, {bucket, key: 'probe.png'}))

        expect(output.length).toBe(input.length + SRGB_CHUNK.length)
        expect(chunkTypes(output)).toEqual(['IHDR', 'iTXt', 'sRGB', 'IDAT', 'IEND'])
        expect(withoutChunk(output, 'sRGB')).toEqual(input)
    }, 20_000)

    it('caps ranged reads for pathological chunk sequences', async () => {
        const tiny = chunk('tEXt', new Uint8Array(0))
        const count = 450_000
        const repeated = new Uint8Array(tiny.length * count)

        for (let index = 0; index < count; index += 1) {
            repeated.set(tiny, index * tiny.length)
        }

        const input = png([repeated])
        const bucket = createMockR2Bucket()
        await bucket.put('probe.png', input)
        const stored = await bucket.get('probe.png')

        if (!stored) {
            throw new Error('probe object was not stored')
        }

        const getCallsBefore = vi.mocked(bucket.get).mock.calls.length
        const output = await readAll(await tagPngWithSrgbFixedLength(stored.body, input.length, {bucket, key: 'probe.png'}))
        const getCalls = vi.mocked(bucket.get).mock.calls.length - getCallsBefore

        expect(getCalls).toBeLessThanOrEqual(65)
        expect(output).toEqual(input)
    }, 20_000)

    it('passes through when the probe is shorter than the signature', async () => {
        const input = png([])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length, {probeBytes: 4}))

        expect(output).toEqual(input)
    })

    it('passes through when a chunk extends past the declared size', async () => {
        const input = concat([SIGNATURE, ihdr(6), chunk('tEXt', new Uint8Array([1, 2, 3, 4, 5]))])
        const truncated = input.subarray(0, input.length - 3)
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(truncated), truncated.length))

        expect(output).toEqual(truncated)
    })

    it('passes through a PNG without IDAT', async () => {
        const input = concat([SIGNATURE, ihdr(6), chunk('IEND', new Uint8Array(0))])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output).toEqual(input)
    })

    it('passes through a PNG with an unexpected IHDR length', async () => {
        const input = concat([
            SIGNATURE,
            chunk('IHDR', new Uint8Array(12)),
            chunk('IDAT', new Uint8Array([1, 2, 3])),
            chunk('IEND', new Uint8Array(0)),
        ])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output).toEqual(input)
    })

    it('passes through a PNG whose first chunk is IDAT', async () => {
        const input = concat([SIGNATURE, chunk('IDAT', new Uint8Array([1, 2, 3])), chunk('IEND', new Uint8Array(0))])
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length))

        expect(output).toEqual(input)
    })

    it('passes through a truncated IHDR when the bucket cannot supply the missing bytes', async () => {
        const input = concat([SIGNATURE, ihdr(6).subarray(0, 8 + 9)])
        const bucket = createMockR2Bucket()
        await bucket.put('probe.png', input)
        const output = await readAll(
            await tagPngWithSrgbFixedLength(streamOf(input), input.length, {probeBytes: 16, bucket, key: 'probe.png'}),
        )

        expect(output).toEqual(input)
    })

    it('passes through when the bucket object is missing', async () => {
        const metadata = new Uint8Array(1.5 * 1024 * 1024)
        const input = png([chunk('iTXt', metadata)])
        const bucket = createMockR2Bucket()
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length, {bucket, key: 'missing.png'}))

        expect(output).toEqual(input)
    }, 20_000)

    it('passes through when a ranged read returns fewer bytes than requested', async () => {
        const metadata = new Uint8Array(1.5 * 1024 * 1024)
        const input = png([chunk('iTXt', metadata)])
        const bucket = {
            get: vi.fn(async () => ({arrayBuffer: async () => new Uint8Array(4).buffer})),
        } as unknown as R2Bucket
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input), input.length, {bucket, key: 'probe.png'}))

        expect(output).toEqual(input)
    }, 20_000)

    it('returns an empty body for an empty source', async () => {
        const source = new ReadableStream({
            start(controller) {
                controller.close()
            },
        })
        const output = await readAll(await tagPngWithSrgbFixedLength(source, 0))

        expect(output.length).toBe(0)
    })

    it('reads the remaining source chunks after the prefix', async () => {
        const metadata = new Uint8Array(1.5 * 1024 * 1024)
        const input = png([chunk('iTXt', metadata)])
        const bucket = createMockR2Bucket()
        await bucket.put('probe.png', input)
        const output = await readAll(await tagPngWithSrgbFixedLength(streamOf(input, 64 * 1024), input.length, {bucket, key: 'probe.png'}))

        expect(chunkTypes(output)).toEqual(['IHDR', 'iTXt', 'sRGB', 'IDAT', 'IEND'])
    }, 20_000)

    it('rejects when the source is larger than the declared size', async () => {
        const metadata = new Uint8Array(1.5 * 1024 * 1024)
        const input = png([chunk('iTXt', metadata)])
        const source = new ReadableStream({
            start(controller) {
                for (let offset = 0; offset < input.length; offset += 64 * 1024) {
                    controller.enqueue(input.subarray(offset, Math.min(offset + 64 * 1024, input.length)))
                }

                controller.close()
            },
        })
        const body = await tagPngWithSrgbFixedLength(source, input.length - 10)

        await expect(readAll(body)).rejects.toThrow()
    }, 20_000)
})
