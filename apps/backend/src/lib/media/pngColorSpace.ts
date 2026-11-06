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
 *
 * @internal
 */
export function tagPngWithSrgb(stream: ReadableStream): ReadableStream {
    return stream.pipeThrough(new TransformStream(new PngSrgbTagger()))
}

const PNG_SRGB_PROBE_BYTES = 1024 * 1024

type PngSrgbDecision = 'insert' | 'preserve' | 'undecided'

/**
 * Tag an untagged RGB PNG and return a body whose length is known to R2.
 * The prefix is inspected first so the FixedLengthStream can be sized before
 * the upload starts; if the decision is not visible in the prefix, the source
 * passes through unchanged.
 */
export async function tagPngWithSrgbFixedLength(
    source: ReadableStream,
    sourceSize: number,
    probeBytes = PNG_SRGB_PROBE_BYTES,
): Promise<ReadableStream> {
    const reader = source.getReader()
    const {prefix, remainder} = await readPrefix(reader, probeBytes)
    const insert = pngSrgbDecision(prefix) === 'insert'
    const fixed = new FixedLengthStream(sourceSize + (insert ? SRGB_CHUNK.length : 0))
    const combined = combinePrefixAndReader(prefix, remainder, reader)
    const body = insert ? tagPngWithSrgb(combined) : combined

    body.pipeTo(fixed.writable).catch(() => undefined)

    return fixed.readable
}

type PrefixRead = {
    prefix: Uint8Array
    remainder: Uint8Array
    reader: ReadableStreamDefaultReader<Uint8Array>
}

async function readPrefix(reader: ReadableStreamDefaultReader<Uint8Array>, maxBytes: number): Promise<PrefixRead> {
    const parts: Uint8Array[] = []
    let total = 0
    let remainder: Uint8Array = new Uint8Array(0)

    while (total < maxBytes) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        const remaining = maxBytes - total

        if (value.byteLength > remaining) {
            parts.push(value.subarray(0, remaining))
            remainder = value.subarray(remaining)
            total = maxBytes
            break
        }

        parts.push(value)
        total += value.byteLength
    }

    return {prefix: concatBytes(parts), remainder, reader}
}

function combinePrefixAndReader(
    prefix: Uint8Array,
    remainder: Uint8Array,
    reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream {
    const initial = concatBytes([prefix, remainder])
    let initialSent = false

    return new ReadableStream({
        async pull(controller) {
            if (!initialSent) {
                initialSent = true
                controller.enqueue(initial)
                return
            }

            const {done, value} = await reader.read()

            if (done) {
                controller.close()
                return
            }

            controller.enqueue(value)
        },
        cancel(reason) {
            return reader.cancel(reason)
        },
    })
}

type ChunkRead = {
    decision: PngSrgbDecision | null
    colorType: number | null
    nextOffset: number
}

function pngSrgbDecision(bytes: Uint8Array): PngSrgbDecision {
    if (bytes.length < PNG_SIGNATURE.length) {
        return 'undecided'
    }

    if (!matchesSignature(bytes.subarray(0, PNG_SIGNATURE.length))) {
        return 'preserve'
    }

    let offset = PNG_SIGNATURE.length
    let colorType: number | null = null

    while (offset + PNG_CHUNK_HEADER_BYTES <= bytes.length) {
        const chunk = readChunkDecision(bytes, offset, colorType)

        if (chunk.decision !== null) {
            return chunk.decision
        }

        colorType = chunk.colorType ?? colorType

        if (chunk.nextOffset > bytes.length) {
            return 'undecided'
        }

        offset = chunk.nextOffset
    }

    return 'undecided'
}

function readChunkDecision(bytes: Uint8Array, offset: number, colorType: number | null): ChunkRead {
    const length = readUint32Be(bytes, offset)
    const type = readChunkType(bytes.subarray(offset, offset + PNG_CHUNK_HEADER_BYTES))
    const nextOffset = offset + PNG_CHUNK_HEADER_BYTES + 4 + length

    if (type === 'IHDR') {
        const ihdr = readIhdrColorType(bytes, offset, length)

        if (ihdr === null) {
            return {decision: 'undecided', colorType: null, nextOffset}
        }

        if (ihdr === 'preserve') {
            return {decision: 'preserve', colorType: null, nextOffset}
        }

        return {decision: null, colorType: ihdr, nextOffset}
    }

    if (COLOR_CHUNK_TYPES.has(type)) {
        return {decision: 'preserve', colorType: null, nextOffset}
    }

    if (type === 'PLTE' || type === 'IDAT') {
        return {decision: colorType !== null && RGB_COLOR_TYPES.has(colorType) ? 'insert' : 'preserve', colorType: null, nextOffset}
    }

    return {decision: null, colorType: null, nextOffset}
}

function readIhdrColorType(bytes: Uint8Array, offset: number, length: number): number | 'preserve' | null {
    if (length !== IHDR_DATA_BYTES) {
        return 'preserve'
    }

    const colorTypeOffset = offset + PNG_CHUNK_HEADER_BYTES + IHDR_COLOR_TYPE_OFFSET

    if (colorTypeOffset >= bytes.length) {
        return null
    }

    const colorType = bytes[colorTypeOffset] ?? 0
    return RGB_COLOR_TYPES.has(colorType) ? colorType : 'preserve'
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
    if (parts.length === 0) {
        return new Uint8Array(0)
    }

    if (parts.length === 1) {
        return parts[0] ?? new Uint8Array(0)
    }

    const total = parts.reduce((sum, part) => sum + part.length, 0)
    const combined = new Uint8Array(total)
    let offset = 0

    for (const part of parts) {
        combined.set(part, offset)
        offset += part.length
    }

    return combined
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
