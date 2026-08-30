export function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let value = ''

    for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(byteAt(bytes, offset + index))
    }

    return value
}

export function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        byteAt(bytes, offset) * 0x1000000 +
        ((byteAt(bytes, offset + 1) << 16) >>> 0) +
        ((byteAt(bytes, offset + 2) << 8) >>> 0) +
        byteAt(bytes, offset + 3)
    )
}

function byteAt(bytes: Uint8Array, offset: number): number {
    return bytes[offset] as number
}
