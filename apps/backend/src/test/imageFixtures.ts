import {writeAscii, writeUint16Be, writeUint16Le, writeUint24Le, writeUint32Be, writeUint32Le} from './binaryWriters'

export function createWebpFile(width = 512, height = 512, type = 'image/webp', name = 'profile-image.webp'): File {
    return new File([createWebpBytes(width, height)], name, {
        type,
    })
}

export function createOversizedWebpFile(name = 'profile-image.webp'): File {
    return new File([new Uint8Array(2 * 1024 * 1024 + 1)], name, {
        type: 'image/webp',
    })
}

export function createMalformedWebpFile(name = 'profile-image.webp'): File {
    return new File([new Uint8Array([0, 1, 2, 3])], name, {
        type: 'image/webp',
    })
}

export function createPngFile(width = 100, height = 80, type = 'image/png', name = 'gallery.png'): File {
    return new File([createPngBytes(width, height)], name, {
        type,
    })
}

export function createGifFile(width = 100, height = 80, name = 'gallery.gif'): File {
    return new File([createGifBytes(width, height)], name, {
        type: 'image/gif',
    })
}

export function createJpegFile(width = 100, height = 80, name = 'gallery.jpg'): File {
    return new File([createJpegBytes(width, height)], name, {
        type: 'image/jpeg',
    })
}

export function createExifOrientationJpegFile(width = 100, height = 80, orientation = 6, name = 'gallery.jpg'): File {
    return new File([createExifOrientationJpegBytes(width, height, orientation)], name, {
        type: 'image/jpeg',
    })
}

export function createBigEndianExifOrientationJpegFile(width = 100, height = 80, orientation = 6, name = 'gallery.jpg'): File {
    return new File([createExifOrientationJpegBytes(width, height, orientation, false)], name, {
        type: 'image/jpeg',
    })
}

export function createJpegFileWithExifWithoutOrientation(width = 100, height = 80, name = 'gallery.jpg'): File {
    return new File([createExifJpegBytes(width, height, null, true)], name, {
        type: 'image/jpeg',
    })
}

export function createAvifFile(width = 100, height = 80, name = 'gallery.avif'): File {
    return new File([createAvifBytes(width, height)], name, {
        type: 'image/avif',
    })
}

export function createWebpDataUrl(width = 512, height = 512): string {
    const bytes = createWebpBytes(width, height)
    return webpBytesToDataUrl(bytes)
}

export function createPngDataUrl(width = 512, height = 512): string {
    return bytesToDataUrl(createPngBytes(width, height), 'image/png')
}

function webpBytesToDataUrl(bytes: Uint8Array): string {
    return bytesToDataUrl(bytes, 'image/webp')
}

function bytesToDataUrl(bytes: Uint8Array, contentType: string): string {
    let binary = ''

    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }

    return `data:${contentType};base64,${btoa(binary)}`
}

function createPngBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(33)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
    writeUint32Be(bytes, 8, 13)
    writeAscii(bytes, 12, 'IHDR')
    writeUint32Be(bytes, 16, width)
    writeUint32Be(bytes, 20, height)
    return bytes
}

function createGifBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(10)
    writeAscii(bytes, 0, 'GIF89a')
    writeUint16Le(bytes, 6, width)
    writeUint16Le(bytes, 8, height)
    return bytes
}

function createJpegBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(16)
    bytes.set([0xff, 0xd8, 0xff, 0xe0], 0)
    writeUint32Be(bytes, 4, 0x0002ffc0)
    writeUint32Be(bytes, 8, 0x00080800)
    bytes[11] = (height >>> 8) & 0xff
    bytes[12] = height & 0xff
    bytes[13] = (width >>> 8) & 0xff
    bytes[14] = width & 0xff
    return bytes
}

function createExifOrientationJpegBytes(width: number, height: number, orientation: number, littleEndian = true): Uint8Array {
    return createExifJpegBytes(width, height, orientation, littleEndian)
}

function createExifJpegBytes(width: number, height: number, orientation: number | null, littleEndian: boolean): Uint8Array {
    const jpegBytes = createJpegBytes(width, height)
    const app1Payload = new Uint8Array(32)
    writeAscii(app1Payload, 0, 'Exif')
    writeAscii(app1Payload, 6, littleEndian ? 'II' : 'MM')

    const writeUint16 = littleEndian ? writeUint16Le : writeUint16Be
    const writeUint32 = littleEndian ? writeUint32Le : writeUint32Be

    writeUint16(app1Payload, 8, 42)
    writeUint32(app1Payload, 10, 8)
    writeUint16(app1Payload, 14, 1)
    writeUint16(app1Payload, 16, orientation === null ? 0x010f : 0x0112)
    writeUint16(app1Payload, 18, orientation === null ? 2 : 3)
    writeUint32(app1Payload, 20, 1)
    writeUint16(app1Payload, 24, orientation ?? 0)

    const app1Segment = new Uint8Array(4 + app1Payload.byteLength)
    app1Segment.set([0xff, 0xe1], 0)
    app1Segment[2] = ((app1Payload.byteLength + 2) >>> 8) & 0xff
    app1Segment[3] = (app1Payload.byteLength + 2) & 0xff
    app1Segment.set(app1Payload, 4)

    return concatBytes([jpegBytes.slice(0, 2), app1Segment, jpegBytes.slice(2)])
}

function createAvifBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(48)
    writeUint32Be(bytes, 0, 48)
    writeAscii(bytes, 4, 'meta')
    writeUint32Be(bytes, 8, 0)
    writeUint32Be(bytes, 12, 36)
    writeAscii(bytes, 16, 'iprp')
    writeUint32Be(bytes, 20, 28)
    writeAscii(bytes, 24, 'ipco')
    writeUint32Be(bytes, 28, 20)
    writeAscii(bytes, 32, 'ispe')
    writeUint32Be(bytes, 36, 0)
    writeUint32Be(bytes, 40, width)
    writeUint32Be(bytes, 44, height)
    return bytes
}

export function createWebpBytes(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(30)
    writeAscii(bytes, 0, 'RIFF')
    writeUint32Le(bytes, 4, bytes.length - 8)
    writeAscii(bytes, 8, 'WEBP')
    writeAscii(bytes, 12, 'VP8X')
    writeUint32Le(bytes, 16, 10)
    writeUint24Le(bytes, 24, width - 1)
    writeUint24Le(bytes, 27, height - 1)
    return bytes
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
    const bytes = new Uint8Array(totalLength)
    let offset = 0

    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }

    return bytes
}
