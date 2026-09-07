type RequestBodyParser<T> = (response: Response) => Promise<T>

type RequestBodyReadResult<T> = {tooLarge: true} | {tooLarge: false; value: T}

export type JsonBodyReadResult<T> = RequestBodyReadResult<T>

export const STANDARD_JSON_REQUEST_MAX_BYTES = 1024 * 1024

async function parseRequestBodyUpTo<T>(request: Request, maxBytes: number, parse: RequestBodyParser<T>): Promise<RequestBodyReadResult<T>> {
    const contentLength = request.headers.get('content-length')
    const contentType = request.headers.get('content-type')
    const headers = contentType ? {'content-type': contentType} : undefined

    if (contentLength !== null) {
        const parsedContentLength = Number(contentLength)

        if (!Number.isSafeInteger(parsedContentLength) || parsedContentLength < 0 || parsedContentLength > maxBytes) {
            return {tooLarge: true}
        }
    }

    if (!request.body) {
        return {tooLarge: false, value: await parse(new Response(null, {headers}))}
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
        return {tooLarge: false, value: await parse(limitedResponse)}
    } catch (error) {
        if (exceededLimit) {
            return {tooLarge: true}
        }

        throw error
    }
}

export async function readFormDataUpTo(request: Request, maxBytes: number): Promise<FormData | null> {
    const result = await parseRequestBodyUpTo(request, maxBytes, async (limitedResponse) => await limitedResponse.formData())

    return result.tooLarge ? null : result.value
}

export async function readJsonUpTo<T>(request: Request, maxBytes: number): Promise<JsonBodyReadResult<T>> {
    return await parseRequestBodyUpTo(request, maxBytes, async (limitedResponse) => await limitedResponse.json<T>())
}
