import {vi} from 'vitest'

export function createMockR2Bucket(): R2Bucket {
    const objects = new Map<string, Uint8Array>()
    const multipartUploads = new Map<string, Map<number, Uint8Array>>()

    const objectFor = (key: string, bytes: Uint8Array): R2ObjectBody => ({
        key,
        version: 'mock-version',
        size: bytes.byteLength,
        etag: 'mock-etag',
        httpEtag: '"mock-etag"',
        checksums: {},
        uploaded: new Date('2026-06-10T12:00:00Z'),
        storageClass: 'Standard',
        writeHttpMetadata: vi.fn(),
        body: new ReadableStream({
            start(controller) {
                controller.enqueue(bytes)
                controller.close()
            },
        }),
        bodyUsed: false,
        arrayBuffer: vi.fn(async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
        bytes: vi.fn(async () => bytes),
        text: vi.fn(async () => new TextDecoder().decode(bytes)),
        json: vi.fn(async () => JSON.parse(new TextDecoder().decode(bytes))),
        blob: vi.fn(async () => new Blob([bytes])),
    } as unknown as R2ObjectBody)

    const bucket = {
        put: vi.fn(async (key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob) => {
            const bytes = await bytesFromR2Value(value)
            objects.set(key, bytes)
            return objectFor(key, bytes)
        }),
        get: vi.fn(async (key: string, options?: R2GetOptions) => {
            const bytes = objects.get(key)

            if (!bytes) {
                return null
            }

            const range = options?.range && 'offset' in options.range
                ? options.range
                : null
            const rangedBytes = range
                ? bytes.slice(range.offset ?? 0, (range.offset ?? 0) + (range.length ?? bytes.byteLength))
                : bytes

            return objectFor(key, rangedBytes)
        }),
        delete: vi.fn(async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
                objects.delete(key)
            }
        }),
        createMultipartUpload: vi.fn(async (key: string) => {
            const uploadId = `mock-upload-${multipartUploads.size + 1}`
            multipartUploads.set(`${key}:${uploadId}`, new Map())
            return createMultipartUploadHandle(key, uploadId, objects, multipartUploads, objectFor)
        }),
        resumeMultipartUpload: vi.fn((key: string, uploadId: string) => {
            const uploadKey = `${key}:${uploadId}`

            if (!multipartUploads.has(uploadKey)) {
                multipartUploads.set(uploadKey, new Map())
            }

            return createMultipartUploadHandle(key, uploadId, objects, multipartUploads, objectFor)
        }),
        head: vi.fn(async (key: string) => {
            const bytes = objects.get(key)
            return bytes ? objectFor(key, bytes) : null
        }),
        list: vi.fn(async (options?: R2ListOptions) => {
            const prefix = options?.prefix ?? ''
            const limit = options?.limit ?? 1000
            const start = options?.cursor ? Number(options.cursor) : 0
            const keys = [...objects.keys()]
                .filter((key) => key.startsWith(prefix))
                .sort()
            const selectedKeys = keys.slice(start, start + limit)
            const nextCursorIndex = start + selectedKeys.length
            const truncated = nextCursorIndex < keys.length

            return {
                objects: selectedKeys.map((key) => {
                    const object = objects.get(key)
                    if (object === undefined) {
                        throw new Error(`Missing object for key: ${key}`)
                    }

                    return objectFor(key, object)
                }),
                truncated,
                cursor: truncated ? String(nextCursorIndex) : undefined,
                delimitedPrefixes: [],
            }
        }),
    }

    return bucket as unknown as R2Bucket
}

function createMultipartUploadHandle(
    key: string,
    uploadId: string,
    objects: Map<string, Uint8Array>,
    multipartUploads: Map<string, Map<number, Uint8Array>>,
    objectFor: (key: string, bytes: Uint8Array) => R2ObjectBody,
): R2MultipartUpload {
    return {
        key,
        uploadId,
        uploadPart: vi.fn(async (partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob) => {
            const uploadParts = multipartUploads.get(`${key}:${uploadId}`) ?? new Map<number, Uint8Array>()
            const bytes = await bytesFromR2Value(value)
            uploadParts.set(partNumber, bytes)
            multipartUploads.set(`${key}:${uploadId}`, uploadParts)
            return {
                partNumber,
                etag: `etag-${partNumber}`,
            }
        }),
        abort: vi.fn(async () => {
            multipartUploads.delete(`${key}:${uploadId}`)
        }),
        complete: vi.fn(async (uploadedParts: R2UploadedPart[]) => {
            const uploadParts = multipartUploads.get(`${key}:${uploadId}`) ?? new Map<number, Uint8Array>()
            const orderedParts = [...uploadedParts].sort((left, right) => left.partNumber - right.partNumber)
            const bytes = concatBytes(orderedParts.map((part) => uploadParts.get(part.partNumber) ?? new Uint8Array()))
            objects.set(key, bytes)
            multipartUploads.delete(`${key}:${uploadId}`)
            return objectFor(key, bytes)
        }),
    } as unknown as R2MultipartUpload
}

async function bytesFromR2Value(value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<Uint8Array> {
    if (!value) {
        return new Uint8Array()
    }

    if (typeof value === 'string') {
        return new TextEncoder().encode(value)
    }

    if (value instanceof Blob) {
        return new Uint8Array(await value.arrayBuffer())
    }

    if (value instanceof ReadableStream) {
        return await bytesFromStream(value)
    }

    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value)
    }

    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

async function bytesFromStream(stream: ReadableStream): Promise<Uint8Array> {
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []

    while (true) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        chunks.push(value)
    }

    return concatBytes(chunks)
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
