export type PngDimensions = {
    width: number
    height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function getPngDimensions(bytes: Uint8Array): PngDimensions | null {
    if (bytes.length < 33) {
        return null
    }

    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
        if (bytes[index] !== PNG_SIGNATURE[index]) {
            return null
        }
    }

    if (readAscii(bytes, 12, 4) !== 'IHDR') {
        return null
    }

    const width = readUint32Be(bytes, 16)
    const height = readUint32Be(bytes, 20)

    if (width <= 0 || height <= 0) {
        return null
    }

    return {width, height}
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let value = ''

    for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(bytes[offset + index])
    }

    return value
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        (bytes[offset] * 0x1000000)
        + ((bytes[offset + 1] << 16) >>> 0)
        + ((bytes[offset + 2] << 8) >>> 0)
        + bytes[offset + 3]
    )
}
