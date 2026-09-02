type RequestBodyParser<T> = (response: Response) => Promise<T>

async function parseRequestBodyUpTo<T>(request: Request, maxBytes: number, parse: RequestBodyParser<T>): Promise<T | null> {
    const contentLength = request.headers.get('content-length')
    const contentType = request.headers.get('content-type')
    const headers = contentType ? {'content-type': contentType} : undefined

    if (contentLength !== null) {
        const parsedContentLength = Number(contentLength)

        if (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0 || parsedContentLength > maxBytes) {
            return null
        }
    }

    if (!request.body) {
        return await parse(new Response(null, {headers}))
    }

    let totalBytes = 0
    let exceededLimit = false
    const limitedBody = request.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                totalBytes += chunk.byteLength

                if (totalBytes > maxBytes) {
                    exceededLimit = true
                    controller.error(new Error('Request body is too large'))
                    return
                }

                controller.enqueue(chunk)
            },
        }),
    )
    const limitedResponse = new Response(limitedBody, {headers})

    try {
        return await parse(limitedResponse)
    } catch (error) {
        if (exceededLimit) {
            return null
        }

        throw error
    }
}

export async function readFormDataUpTo(request: Request, maxBytes: number): Promise<FormData | null> {
    return await parseRequestBodyUpTo(request, maxBytes, async (limitedResponse) => await limitedResponse.formData())
}

export async function readJsonUpTo<T>(request: Request, maxBytes: number): Promise<T | null> {
    return await parseRequestBodyUpTo(request, maxBytes, async (limitedResponse) => await limitedResponse.json<T>())
}
