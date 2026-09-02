export type TestRequestOptions = {
    sessionToken?: string
    csrfToken?: string
    contentLength?: string
}

export function createRequestHeaders(
    body: unknown,
    options: TestRequestOptions = {},
    includeJsonContentType = true,
): Record<string, string> {
    const headers: Record<string, string> = {}

    if (includeJsonContentType && !(body instanceof FormData)) {
        headers['content-type'] = 'application/json'
    }

    if (options.sessionToken) {
        headers.cookie = `myoc_session=${options.sessionToken}`
    }

    if (options.csrfToken) {
        headers['x-csrf-token'] = options.csrfToken
    }

    if (options.contentLength) {
        headers['content-length'] = options.contentLength
    }

    return headers
}
