export type WebpDimensions = {
    width: number
    height: number
}

const RIFF = 'RIFF'
const WEBP = 'WEBP'
const VP8 = 'VP8 '
const VP8L = 'VP8L'
const VP8X = 'VP8X'

export function getWebpDimensions(bytes: Uint8Array): WebpDimensions | null {
    if (bytes.length < 30 || readAscii(bytes, 0, 4) !== RIFF || readAscii(bytes, 8, 4) !== WEBP) {
        return null
    }

    let offset = 12

    while (offset + 8 <= bytes.length) {
        const chunkType = readAscii(bytes, offset, 4)
        const chunkSize = readUint32Le(bytes, offset + 4)
        const dataOffset = offset + 8

        if (dataOffset + chunkSize > bytes.length) {
            return null
        }

        if (chunkType === VP8X && chunkSize >= 10) {
            return {
                width: readUint24Le(bytes, dataOffset + 4) + 1,
                height: readUint24Le(bytes, dataOffset + 7) + 1,
            }
        }

        if (chunkType === VP8L && chunkSize >= 5 && byteAt(bytes, dataOffset) === 0x2f) {
            const b1 = byteAt(bytes, dataOffset + 1)
            const b2 = byteAt(bytes, dataOffset + 2)
            const b3 = byteAt(bytes, dataOffset + 3)
            const b4 = byteAt(bytes, dataOffset + 4)

            return {
                width: 1 + (((b2 & 0x3f) << 8) | b1),
                height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
            }
        }

        if (
            chunkType === VP8
            && chunkSize >= 10
            && byteAt(bytes, dataOffset + 3) === 0x9d
            && byteAt(bytes, dataOffset + 4) === 0x01
            && byteAt(bytes, dataOffset + 5) === 0x2a
        ) {
            return {
                width: readUint16Le(bytes, dataOffset + 6) & 0x3fff,
                height: readUint16Le(bytes, dataOffset + 8) & 0x3fff,
            }
        }

        offset = dataOffset + chunkSize + (chunkSize % 2)
    }

    return null
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
    return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8)
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
    return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8) | (byteAt(bytes, offset + 2) << 16)
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
    return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8) | (byteAt(bytes, offset + 2) << 16) | (byteAt(bytes, offset + 3) << 24)
}

function byteAt(bytes: Uint8Array, offset: number): number {
    const value = bytes[offset]
    if (value === undefined) {
        throw new Error(`WebP byte offset out of range: ${offset}`)
    }

    return value
}
