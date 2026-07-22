export async function readRequestBodyUpTo(request: Request, maxBytes: number): Promise<Uint8Array | null> {
    const contentLength = request.headers.get('content-length')

    if (contentLength !== null) {
        const parsedContentLength = Number(contentLength)

        if (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0 || parsedContentLength > maxBytes) {
            return null
        }
    }

    if (!request.body) {
        return new Uint8Array()
    }

    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let totalBytes = 0

    try {
        while (true) {
            const {done, value} = await reader.read()

            if (done) {
                break
            }

            if (!value) {
                continue
            }

            totalBytes += value.byteLength

            if (totalBytes > maxBytes) {
                await reader.cancel()
                return null
            }

            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }

    const bytes = new Uint8Array(totalBytes)
    let offset = 0

    for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
    }

    return bytes
}

export async function readFormDataUpTo(request: Request, maxBytes: number): Promise<FormData | null> {
    const bytes = await readRequestBodyUpTo(request, maxBytes)

    if (!bytes) {
        return null
    }

    return await new Request(request.url, {
        method: request.method,
        headers: request.headers,
        body: new Blob([bytes]),
    }).formData()
}

export async function readJsonUpTo<T>(request: Request, maxBytes: number): Promise<T | null> {
    const bytes = await readRequestBodyUpTo(request, maxBytes)

    if (!bytes) {
        return null
    }

    return JSON.parse(new TextDecoder().decode(bytes)) as T
}
