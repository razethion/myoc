const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_CHUNK_HEADER_BYTES = 8
const IHDR_DATA_BYTES = 13
const IHDR_COLOR_TYPE_OFFSET = 9
const COLOR_CHUNK_TYPES = new Set(['iCCP', 'sRGB', 'cICP', 'gAMA', 'cHRM'])
const RGB_COLOR_TYPES = new Set([2, 6])

// Canonical PNG sRGB chunk: length 1, type sRGB, rendering intent 0 (perceptual).
const SRGB_CHUNK = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9])

type TaggerPhase = 'signature' | 'chunkHeader' | 'ihdrData' | 'chunkData' | 'passthrough'

class PngSrgbTagger implements Transformer<Uint8Array, Uint8Array> {
    private phase: TaggerPhase = 'signature'
    private buffered = new Uint8Array(0)
    private remainingChunkBytes = 0
    private sawColorChunk = false
    private insertedSrgb = false
    private isRgb = false
    private firstChunk = true
    private lastChunkType = ''

    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): void {
        let offset = 0

        while (offset < chunk.length) {
            if (this.phase === 'passthrough') {
                controller.enqueue(chunk.subarray(offset))
                return
            }

            if (this.phase === 'chunkData') {
                offset = this.consumeChunkData(chunk, offset, controller)
                continue
            }

            if (this.phase === 'ihdrData') {
                offset = this.consumeIhdrData(chunk, offset, controller)
                continue
            }

            offset = this.consumeHeaderBytes(chunk, offset, controller)
        }
    }

    flush(controller: TransformStreamDefaultController<Uint8Array>): void {
        if (this.buffered.length > 0) {
            controller.enqueue(this.buffered)
            this.buffered = new Uint8Array(0)
        }
    }

    private consumeChunkData(chunk: Uint8Array, offset: number, controller: TransformStreamDefaultController<Uint8Array>): number {
        if (this.remainingChunkBytes === 0) {
            this.phase = this.lastChunkType === 'IEND' ? 'passthrough' : 'chunkHeader'
            return offset
        }

        const take = Math.min(chunk.length - offset, this.remainingChunkBytes)
        controller.enqueue(chunk.subarray(offset, offset + take))
        this.remainingChunkBytes -= take

        if (this.remainingChunkBytes === 0) {
            this.phase = this.lastChunkType === 'IEND' ? 'passthrough' : 'chunkHeader'
        }

        return offset + take
    }

    private consumeIhdrData(chunk: Uint8Array, offset: number, controller: TransformStreamDefaultController<Uint8Array>): number {
        const take = Math.min(IHDR_DATA_BYTES - this.buffered.length, chunk.length - offset)
        this.buffered = appendBytes(this.buffered, chunk.subarray(offset, offset + take))
        const nextOffset = offset + take

        if (this.buffered.length < IHDR_DATA_BYTES) {
            return nextOffset
        }

        const ihdr = this.buffered
        this.buffered = new Uint8Array(0)
        this.isRgb = RGB_COLOR_TYPES.has(ihdr[IHDR_COLOR_TYPE_OFFSET] ?? 0)
        controller.enqueue(ihdr)
        this.remainingChunkBytes = 4
        this.phase = 'chunkData'
        return nextOffset
    }

    private consumeHeaderBytes(chunk: Uint8Array, offset: number, controller: TransformStreamDefaultController<Uint8Array>): number {
        const take = Math.min(PNG_CHUNK_HEADER_BYTES - this.buffered.length, chunk.length - offset)
        this.buffered = appendBytes(this.buffered, chunk.subarray(offset, offset + take))
        const nextOffset = offset + take

        if (this.buffered.length < PNG_CHUNK_HEADER_BYTES) {
            return nextOffset
        }

        const header = this.buffered
        this.buffered = new Uint8Array(0)

        if (this.phase === 'signature') {
            controller.enqueue(header)
            this.phase = matchesSignature(header) ? 'chunkHeader' : 'passthrough'
            return nextOffset
        }

        this.handleChunkHeader(header, controller)
        return nextOffset
    }

    private handleChunkHeader(header: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>): void {
        const length = readUint32Be(header, 0)
        const type = readChunkType(header)
        this.lastChunkType = type

        if (this.firstChunk) {
            this.firstChunk = false

            if (type !== 'IHDR') {
                controller.enqueue(header)
                this.phase = 'passthrough'
                return
            }
        }

        if (COLOR_CHUNK_TYPES.has(type)) {
            this.sawColorChunk = true
        }

        if (type === 'IHDR') {
            controller.enqueue(header)
            this.remainingChunkBytes = length + 4

            if (length === IHDR_DATA_BYTES) {
                this.phase = 'ihdrData'
            } else {
                this.isRgb = false
                this.phase = 'chunkData'
            }

            return
        }

        if (this.isRgb && !this.sawColorChunk && !this.insertedSrgb && (type === 'PLTE' || type === 'IDAT')) {
            controller.enqueue(SRGB_CHUNK)
            this.insertedSrgb = true
        }

        controller.enqueue(header)
        this.remainingChunkBytes = length + 4
        this.phase = 'chunkData'
    }
}

/**
 * Insert a PNG sRGB chunk into an untagged RGB PNG without touching its pixels.
 * Images that already declare a color space (iCCP, sRGB, cICP, gAMA, cHRM) and
 * non-RGB or non-PNG data pass through byte-for-byte.
 */
export function tagPngWithSrgb(stream: ReadableStream): ReadableStream {
    return stream.pipeThrough(new TransformStream(new PngSrgbTagger()))
}

function appendBytes(left: Uint8Array, right: Uint8Array): Uint8Array<ArrayBuffer> {
    if (left.length === 0) {
        return right.slice()
    }

    const combined = new Uint8Array(left.length + right.length)
    combined.set(left)
    combined.set(right, left.length)
    return combined
}

function matchesSignature(bytes: Uint8Array): boolean {
    if (bytes.length !== PNG_SIGNATURE.length) {
        return false
    }

    return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        (((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16) | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0)) >>> 0
    )
}

function readChunkType(bytes: Uint8Array): string {
    return String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0)
}
