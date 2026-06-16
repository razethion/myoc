export function createWebpFile(
    width = 512,
    height = 512,
    type = 'image/webp',
    name = 'profile-image.webp',
): File {
    return new File([createVp8xWebpBytes(width, height)], name, {
        type,
    })
}

export function createOversizedWebpFile(name = 'profile-image.webp'): File {
    return new File([new Uint8Array((2 * 1024 * 1024) + 1)], name, {
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

export function createWebpDataUrl(width = 512, height = 512): string {
    const bytes = createVp8xWebpBytes(width, height)
    let binary = ''

    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }

    return `data:image/webp;base64,${btoa(binary)}`
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

function createVp8xWebpBytes(width: number, height: number): Uint8Array {
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

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index)
    }
}

function writeUint24Le(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
    bytes[offset + 2] = (value >> 16) & 0xff
}

function writeUint16Le(bytes: Uint8Array, offset: number, value: number): void {
    bytes[offset] = value & 0xff
    bytes[offset + 1] = (value >> 8) & 0xff
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
