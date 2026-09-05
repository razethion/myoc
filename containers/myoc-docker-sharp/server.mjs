import {Buffer} from 'node:buffer'
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto'
import http from 'node:http'
import process from 'node:process'
import timers from 'node:timers'
import {createAvifBlur, createAvifPreview, createGalleryAvifOutputs, createSquareAvif} from './preview.mjs'

const port = Number.parseInt(process.env['PORT'] ?? '8080', 10)
const previewLongEdge = parsePositiveInteger(process.env['PREVIEW_MAX_LONG_EDGE'], 1600)
const previewQuality = clamp(parsePositiveInteger(process.env['PREVIEW_AVIF_QUALITY'], 60), 1, 100)
const blurMaxWidth = parsePositiveInteger(process.env['BLUR_MAX_WIDTH'], 960)
const blurQuality = clamp(parsePositiveInteger(process.env['BLUR_AVIF_QUALITY'], 60), 1, 100)
const blurSigma = clamp(parsePositiveNumber(process.env['BLUR_SIGMA'], 250), 0.3, 1000)
const blurSourceMaxBytes = parsePositiveInteger(process.env['BLUR_SOURCE_MAX_BYTES'], 16 * 1024 * 1024)
const requestBodyMaxBytes = parsePositiveInteger(process.env['REQUEST_BODY_MAX_BYTES'], 4096)
const sourceImageMaxBytes = parsePositiveInteger(process.env['SOURCE_IMAGE_MAX_BYTES'], 64 * 1024 * 1024)
const sourceFetchTimeoutMs = parsePositiveInteger(process.env['SOURCE_FETCH_TIMEOUT_MS'], 30_000)
const sourceLimitInputPixels = parsePositiveInteger(process.env['SOURCE_LIMIT_INPUT_PIXELS'], 100_000_000)
const allowHttpSourceUrls = process.env['ALLOW_HTTP_SOURCE_URLS'] === 'true'
const squareImageQuality = clamp(parsePositiveInteger(process.env['SQUARE_IMAGE_AVIF_QUALITY'], 75), 1, 100)
const squareImageSize = parsePositiveInteger(process.env['SQUARE_IMAGE_SIZE'], 512)
const squareSourceMaxBytes = parsePositiveInteger(process.env['SQUARE_SOURCE_MAX_BYTES'], 3 * 1024 * 1024)

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `https://${request.headers.host ?? 'localhost'}`)

    if (url.pathname === '/health') {
        response.writeHead(200, {'content-type': 'application/json'})
        response.end(JSON.stringify({ok: true}))
        return
    }

    if (url.pathname === '/images/preview') {
        await handlePreviewRequest(request, response)
        return
    }

    if (url.pathname === '/images/blur') {
        await handleBlurRequest(request, response)
        return
    }

    if (url.pathname === '/images/square') {
        await handleSquareRequest(request, response)
        return
    }

    if (url.pathname === '/images/gallery') {
        await handleGalleryRequest(request, response, url)
        return
    }

    sendJson(response, 404, {error: 'Not found'})
})

export {server}

server.listen(port, '0.0.0.0', () => {
    console.log(`myoc-docker-sharp listening on ${port}`)
})

process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))

function shutdown(signal) {
    console.log(`received ${signal}, shutting down`)

    server.close(() => {
        process.exit(0)
    })

    timers
        .setTimeout(() => {
            server.closeAllConnections?.()
            process.exit(0)
        }, 2_000)
        .unref()
}

async function handleBlurRequest(request, response) {
    if (!authorizePost(request, response)) return

    const requestId = randomUUID()
    const startedAt = Date.now()

    try {
        const sourceBytes = await readRequestBytes(request, blurSourceMaxBytes)
        const result = await createAvifBlur(sourceBytes, {
            limitInputPixels: sourceLimitInputPixels,
            maxWidth: blurMaxWidth,
            quality: blurQuality,
            sigma: blurSigma,
        })

        console.log('Preview container processed blur', {
            blurBytes: Buffer.byteLength(result.bytes),
            blurHeight: result.height,
            blurWidth: result.width,
            durationMs: Date.now() - startedAt,
            requestId,
            sourceBytes: Buffer.byteLength(sourceBytes),
        })

        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(result.bytes),
            'content-type': 'image/avif',
            'x-preview-height': result.height,
            'x-preview-width': result.width,
        })
        response.end(result.bytes)
    } catch (error) {
        console.error('Blur generation failed', {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            requestId,
        })
        sendJson(response, 502, {error: 'Blur generation failed'})
    }
}

async function handleSquareRequest(request, response) {
    if (!authorizePost(request, response)) return

    const requestId = randomUUID()
    const startedAt = Date.now()

    try {
        const sourceBytes = await readRequestBytes(request, squareSourceMaxBytes)
        const result = await createSquareAvif(sourceBytes, {
            limitInputPixels: sourceLimitInputPixels,
            quality: squareImageQuality,
            size: squareImageSize,
        })

        console.log('Image container processed square image', {
            durationMs: Date.now() - startedAt,
            outputBytes: Buffer.byteLength(result.bytes),
            requestId,
            sourceBytes: Buffer.byteLength(sourceBytes),
        })

        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(result.bytes),
            'content-type': 'image/avif',
            'x-preview-height': result.height,
            'x-preview-width': result.width,
        })
        response.end(result.bytes)
    } catch (error) {
        console.error('Square image generation failed', {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            requestId,
        })
        sendJson(response, 422, {error: 'Square image generation failed'})
    }
}

async function handleGalleryRequest(request, response, url) {
    if (!authorizePost(request, response)) return

    const requestId = randomUUID()
    const startedAt = Date.now()

    try {
        const sourceBytes = await readRequestBytes(request, sourceImageMaxBytes)
        const result = await createGalleryAvifOutputs(sourceBytes, {
            blur: url.searchParams.get('blur') === '1',
            blurMaxWidth,
            blurQuality,
            blurSigma,
            limitInputPixels: sourceLimitInputPixels,
            maxLongEdge: previewLongEdge,
            previewQuality,
        })
        const body = result.blur ? Buffer.concat([result.preview.bytes, result.blur.bytes]) : result.preview.bytes
        const headers = {
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(body),
            'content-type': 'application/octet-stream',
            'x-preview-height': result.preview.height,
            'x-preview-length': Buffer.byteLength(result.preview.bytes),
            'x-preview-width': result.preview.width,
        }

        if (result.blur) {
            headers['x-blur-height'] = result.blur.height
            headers['x-blur-length'] = Buffer.byteLength(result.blur.bytes)
            headers['x-blur-width'] = result.blur.width
        }

        console.log('Image container processed gallery image', {
            blurBytes: result.blur ? Buffer.byteLength(result.blur.bytes) : 0,
            durationMs: Date.now() - startedAt,
            previewBytes: Buffer.byteLength(result.preview.bytes),
            requestId,
            sourceBytes: Buffer.byteLength(sourceBytes),
        })
        response.writeHead(200, headers)
        response.end(body)
    } catch (error) {
        console.error('Gallery image generation failed', {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            requestId,
        })
        sendJson(response, 422, {error: 'Gallery image generation failed'})
    }
}

function authorizePost(request, response) {
    if (request.method !== 'POST') {
        response.writeHead(405, {allow: 'POST'})
        response.end()
        return false
    }

    if (!isAuthorized(request)) {
        sendJson(response, 401, {error: 'Unauthorized'})
        return false
    }
    return true
}

async function handlePreviewRequest(request, response) {
    if (!authorizePost(request, response)) return

    let payload

    try {
        payload = JSON.parse(await readRequestText(request, requestBodyMaxBytes))
    } catch {
        sendJson(response, 400, {error: 'Invalid JSON body'})
        return
    }

    const imageUrl = typeof payload.imageUrl === 'string' ? payload.imageUrl : ''

    if (!isAllowedSourceUrl(imageUrl)) {
        sendJson(response, 400, {error: 'imageUrl must be a valid HTTPS URL'})
        return
    }

    const requestId = randomUUID()
    const startedAt = Date.now()
    const source = describeSourceUrl(imageUrl)

    console.log('Preview container processing image', {
        requestId,
        ...source,
    })

    try {
        const sourceBytes = await fetchImageBytes(imageUrl)
        const result = await createAvifPreview(sourceBytes, {
            limitInputPixels: sourceLimitInputPixels,
            maxLongEdge: previewLongEdge,
            quality: previewQuality,
        })

        console.log('Preview container processed image', {
            durationMs: Date.now() - startedAt,
            previewBytes: Buffer.byteLength(result.bytes),
            previewHeight: result.height,
            previewWidth: result.width,
            requestId,
            sourceBytes: Buffer.byteLength(sourceBytes),
            ...source,
        })

        response.writeHead(200, {
            'cache-control': 'no-store',
            'content-length': Buffer.byteLength(result.bytes),
            'content-type': 'image/avif',
            'x-preview-height': result.height,
            'x-preview-width': result.width,
        })
        response.end(result.bytes)
    } catch (error) {
        console.error('Preview generation failed', {
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
            requestId,
            ...source,
        })
        sendJson(response, 502, {error: 'Preview generation failed'})
    }
}

function isAuthorized(request) {
    const token = process.env['PREVIEW_PROCESSOR_TOKEN']

    if (!token) {
        return false
    }

    const authorization = request.headers.authorization ?? ''
    const prefix = 'Bearer '

    if (!authorization.startsWith(prefix)) {
        return false
    }

    return timingSafeStringEqual(authorization.slice(prefix.length), token)
}

function timingSafeStringEqual(left, right) {
    const leftDigest = createHash('sha256').update(left).digest()
    const rightDigest = createHash('sha256').update(right).digest()

    return timingSafeEqual(leftDigest, rightDigest)
}

function isAllowedSourceUrl(value) {
    let url

    try {
        url = new URL(value)
    } catch {
        return false
    }

    return url.protocol === 'https:' || (allowHttpSourceUrls && url.protocol === 'http:')
}

function describeSourceUrl(value) {
    const url = new URL(value)

    return {
        sourceHost: url.host,
        sourcePath: url.pathname,
    }
}

async function fetchImageBytes(imageUrl) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), sourceFetchTimeoutMs)

    try {
        const response = await fetch(imageUrl, {
            headers: {
                accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
            },
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`Source image fetch failed with ${response.status}`)
        }

        const contentLength = Number.parseInt(response.headers.get('content-length') ?? '0', 10)

        if (contentLength > sourceImageMaxBytes) {
            throw new Error('Source image is too large')
        }

        return await readResponseBytes(response, sourceImageMaxBytes)
    } finally {
        clearTimeout(timeout)
    }
}

async function readResponseBytes(response, maxBytes) {
    if (!response.body) {
        throw new Error('Source image response has no body')
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
            throw new Error('Source image is too large')
        }

        chunks.push(value)
    }

    return Buffer.concat(chunks, receivedBytes)
}

/**
 * @returns {Promise<string>}
 */
async function readRequestText(request, maxBytes) {
    return (await readRequestBytes(request, maxBytes)).toString('utf8')
}

function readRequestBytes(request, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = []
        let receivedBytes = 0

        request.on('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
            receivedBytes += Buffer.byteLength(bytes)

            if (receivedBytes > maxBytes) {
                request.destroy()
                reject(new Error('Request body is too large'))
                return
            }

            chunks.push(bytes)
        })

        request.on('end', () => resolve(Buffer.concat(chunks, receivedBytes)))
        request.on('error', reject)
    })
}

function sendJson(response, status, body) {
    response.writeHead(status, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
    })
    response.end(JSON.stringify(body))
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value ?? '', 10)
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function parsePositiveNumber(value, fallback) {
    const parsed = Number.parseFloat(value ?? '')
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}
