export function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
    for (let index = 0; index < value.length; index += 1) {
        bytes[offset + index] = value.charCodeAt(index)
    }
}

export function writeUint16Le(bytes: Uint8Array, offset: number, value: number): void {
    writeUintLe(bytes, offset, value, 2)
}

export function writeUint24Le(bytes: Uint8Array, offset: number, value: number): void {
    writeUintLe(bytes, offset, value, 3)
}

export function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
    writeUintLe(bytes, offset, value, 4)
}

export function writeUint32Be(bytes: Uint8Array, offset: number, value: number): void {
    writeUintBe(bytes, offset, value, 4)
}

function writeUintLe(bytes: Uint8Array, offset: number, value: number, byteLength: number): void {
    for (let index = 0; index < byteLength; index += 1) {
        bytes[offset + index] = (value >>> (8 * index)) & 0xff
    }
}

function writeUintBe(bytes: Uint8Array, offset: number, value: number, byteLength: number): void {
    for (let index = 0; index < byteLength; index += 1) {
        bytes[offset + index] = (value >>> (8 * (byteLength - index - 1))) & 0xff
    }
}
