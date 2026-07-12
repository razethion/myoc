import {describe, expect, it} from 'vitest'
import {getPngDimensions} from './png'
import {getWebpDimensions} from './webp'

describe('getPngDimensions', () => {
    it('reads dimensions from a PNG IHDR chunk', () => {
        expect(getPngDimensions(createPngBytes(640, 480))).toEqual({
            width: 640,
            height: 480,
        })
    })

    it('returns null for malformed PNG bytes', () => {
        expect(getPngDimensions(new Uint8Array(8))).toBeNull()
        expect(getPngDimensions(createPngBytes(640, 480, {signatureByte: 0}))).toBeNull()
        expect(getPngDimensions(createPngBytes(640, 480, {chunkType: 'IDAT'}))).toBeNull()
        expect(getPngDimensions(createPngBytes(0, 480))).toBeNull()
    })
})

describe('getWebpDimensions', () => {
    it('reads VP8X dimensions', () => {
        expect(getWebpDimensions(createVp8xWebpBytes(800, 600))).toEqual({
            width: 800,
            height: 600,
        })
    })

    it('reads VP8L dimensions', () => {
        expect(getWebpDimensions(createVp8lWebpBytes(321, 123))).toEqual({
            width: 321,
            height: 123,
        })
    })

    it('reads VP8 dimensions', () => {
        expect(getWebpDimensions(createVp8WebpBytes(1024, 768))).toEqual({
            width: 1024,
            height: 768,
        })
    })

    it('skips odd-sized chunks before reading dimensions', () => {
        expect(
            getWebpDimensions(
                createWebpBytes([
                    {type: 'JUNK', data: new Uint8Array([1])},
                    {type: 'VP8X', data: createVp8xData(75, 50)},
                ]),
            ),
        ).toEqual({
            width: 75,
            height: 50,
        })
    })

    it('returns null for malformed WebP bytes', () => {
        expect(getWebpDimensions(new Uint8Array(29))).toBeNull()
        expect(getWebpDimensions(createWebpBytes([{type: 'NOPE', data: new Uint8Array([1, 2, 3, 4])}]))).toBeNull()
        expect(getWebpDimensions(createWebpBytes([{type: 'VP8X', data: new Uint8Array(10)}]))).toEqual({
            width: 1,
            height: 1,
        })
        expect(getWebpDimensions(createWebpBytes([{type: 'VP8X', data: new Uint8Array(10)}], {riffType: 'RAFF'}))).toBeNull()
        expect(getWebpDimensions(createWebpBytes([{type: 'VP8X', data: new Uint8Array(10)}], {containerType: 'WARP'}))).toBeNull()
        expect(getWebpDimensions(createTruncatedWebpChunk())).toBeNull()
    })
})

function createPngBytes(width: number, height: number, options: {signatureByte?: number; chunkType?: string} = {}): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)

    if (options.signatureByte !== undefined) {
        bytes[1] = options.signatureByte
    }

    writeUint32Be(bytes, 8, 13)
    writeAscii(bytes, 12, options.chunkType ?? 'IHDR')
    writeUint32Be(bytes, 16, width)
    writeUint32Be(bytes, 20, height)
    return bytes
}

function createVp8xWebpBytes(width: number, height: number): Uint8Array {
    return createWebpBytes([{type: 'VP8X', data: createVp8xData(width, height)}])
}

function createVp8lWebpBytes(width: number, height: number): Uint8Array {
    const widthMinusOne = width - 1
    const heightMinusOne = height - 1
    const data = new Uint8Array(5)
    data[0] = 0x2f
    data[1] = widthMinusOne & 0xff
    data[2] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6)
    data[3] = (heightMinusOne >> 2) & 0xff
    data[4] = (heightMinusOne >> 10) & 0x0f

    return createWebpBytes([{type: 'VP8L', data}])
}

function createVp8WebpBytes(width: number, height: number): Uint8Array {
    const data = new Uint8Array(10)
    data[3] = 0x9d
    data[4] = 0x01
    data[5] = 0x2a
    writeUint16Le(data, 6, width)
    writeUint16Le(data, 8, height)

    return createWebpBytes([{type: 'VP8 ', data}])
}

function createVp8xData(width: number, height: number): Uint8Array {
    const data = new Uint8Array(10)
    writeUint24Le(data, 4, width - 1)
    writeUint24Le(data, 7, height - 1)
    return data
}

function createTruncatedWebpChunk(): Uint8Array {
    const bytes = new Uint8Array(30)
    writeAscii(bytes, 0, 'RIFF')
    writeUint32Le(bytes, 4, bytes.length - 8)
    writeAscii(bytes, 8, 'WEBP')
    writeAscii(bytes, 12, 'VP8X')
    writeUint32Le(bytes, 16, 40)
    return bytes
}

function createWebpBytes(
    chunks: Array<{type: string; data: Uint8Array}>,
    options: {riffType?: string; containerType?: string} = {},
): Uint8Array {
    const length = chunks.reduce((total, chunk) => total + 8 + chunk.data.length + (chunk.data.length % 2), 12)
    const bytes = new Uint8Array(Math.max(length, 30))
    writeAscii(bytes, 0, options.riffType ?? 'RIFF')
    writeUint32Le(bytes, 4, bytes.length - 8)
    writeAscii(bytes, 8, options.containerType ?? 'WEBP')

    let offset = 12

    for (const chunk of chunks) {
        writeAscii(bytes, offset, chunk.type)
        writeUint32Le(bytes, offset + 4, chunk.data.length)
        bytes.set(chunk.data, offset + 8)
        offset += 8 + chunk.data.length + (chunk.data.length % 2)
    }

    return bytes
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index)
    }
}

function writeUint16Le(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
}

function writeUint24Le(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
    bytes[offset + 2] = (value >> 16) & 0xff
}

function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
    bytes[offset + 2] = (value >> 16) & 0xff
    bytes[offset + 3] = (value >> 24) & 0xff
}

function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = (value >> 24) & 0xff
    bytes[offset + 1] = (value >> 16) & 0xff
    bytes[offset + 2] = (value >> 8) & 0xff
    bytes[offset + 3] = value & 0xff
}
