// Download the source image for a generation request. Large GIF sources fetch
// from the media origin for tens of seconds. The origin can answer transient
// 5xx errors when many backfill tasks fetch at once. Retry those errors with
// backoff. Reject other errors right away.

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 520, 521, 522, 524])

class SourceFetchError extends Error {
    /**
     * @param {string} message
     * @param {boolean} retryable
     */
    constructor(message, retryable) {
        super(message)
        this.retryable = retryable
    }
}

/**
 * @param {string} imageUrl
 * @param {{fetchImpl?: typeof fetch, maxAttempts?: number, maxBytes: number, retryDelayMs?: number, sleepImpl?: (ms: number) => Promise<void>, timeoutMs: number}} options
 * @returns {Promise<Buffer>}
 */
export async function fetchImageBytes(imageUrl, options) {
    const fetchImpl = options.fetchImpl ?? fetch
    const sleepImpl =
        options.sleepImpl ??
        ((ms) =>
            new Promise((resolve) => {
                setTimeout(resolve, ms)
            }))
    const maxAttempts = options.maxAttempts ?? 3
    const retryDelayMs = options.retryDelayMs ?? 2_000

    for (let attempt = 1; ; attempt++) {
        try {
            return await fetchImageBytesOnce(imageUrl, options, fetchImpl)
        } catch (error) {
            if (!(error instanceof SourceFetchError) || !error.retryable || attempt >= maxAttempts) {
                throw error
            }
            await sleepImpl(retryDelayMs * attempt)
        }
    }
}

/**
 * @param {string} imageUrl
 * @param {{maxBytes: number, timeoutMs: number}} options
 * @param {typeof fetch} fetchImpl
 * @returns {Promise<Buffer>}
 */
async function fetchImageBytesOnce(imageUrl, options, fetchImpl) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs)

    try {
        const response = await fetchImpl(imageUrl, {
            headers: {
                accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
            },
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new SourceFetchError(`Source image fetch failed with ${response.status}`, RETRYABLE_STATUSES.has(response.status))
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

        if (contentLength > options.maxBytes) {
            throw new SourceFetchError('Source image is too large', false)
        }

        return await readResponseBytes(response, options.maxBytes)
    } catch (error) {
        if (error instanceof SourceFetchError) {
            throw error
        }
        throw new SourceFetchError(`Source image fetch failed: ${String(error)}`, true)
    } finally {
        clearTimeout(timeout)
    }
}

/**
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
async function readResponseBytes(response, maxBytes) {
    if (!response.body) {
        throw new SourceFetchError('Source image response has no body', false)
    }

    const chunks = []
    const reader = response.body.getReader()
    let receivedBytes = 0

    while (true) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        receivedBytes += Buffer.byteLength(value)

        if (receivedBytes > maxBytes) {
            await reader.cancel()
            throw new SourceFetchError('Source image is too large', false)
        }

        chunks.push(value)
    }

    return Buffer.concat(chunks, receivedBytes)
}
