import {describe, expect, it} from 'vitest'
import {tagPngWithSrgb} from './pngColorSpace'

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
})
