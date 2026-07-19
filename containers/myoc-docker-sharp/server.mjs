import {Buffer} from 'node:buffer'
import {createHash, randomUUID, timingSafeEqual} from 'node:crypto'
import http from 'node:http'
import process from 'node:process'
import timers from 'node:timers'
import sharp from 'sharp'

const port = Number.parseInt(process.env['PORT'] ?? '8080', 10)
const previewLongEdge = parsePositiveInteger(process.env['PREVIEW_MAX_LONG_EDGE'], 1600)
const previewQuality = clamp(parsePositiveInteger(process.env['PREVIEW_WEBP_QUALITY'], 90), 1, 100)
const requestBodyMaxBytes = parsePositiveInteger(process.env['REQUEST_BODY_MAX_BYTES'], 4096)
const sourceImageMaxBytes = parsePositiveInteger(process.env['SOURCE_IMAGE_MAX_BYTES'], 64 * 1024 * 1024)
const sourceFetchTimeoutMs = parsePositiveInteger(process.env['SOURCE_FETCH_TIMEOUT_MS'], 30_000)
const sourceLimitInputPixels = parsePositiveInteger(process.env['SOURCE_LIMIT_INPUT_PIXELS'], 100_000_000)
const allowHttpSourceUrls = process.env['ALLOW_HTTP_SOURCE_URLS'] === 'true'

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

    sendJson(response, 404, {error: 'Not found'})
})

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

async function handlePreviewRequest(request, response) {
    if (request.method !== 'POST') {
        response.writeHead(405, {allow: 'POST'})
        response.end()
        return
    }

    if (!isAuthorized(request)) {
        sendJson(response, 401, {error: 'Unauthorized'})
        return
    }

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
        const result = await createWebpPreview(sourceBytes)

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
            'content-type': 'image/webp',
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
 * @returns {Promise<{bytes: Buffer, height: number, width: number}>}
 */
async function createWebpPreview(sourceBytes) {
    const image = sharp(sourceBytes, {
        limitInputPixels: sourceLimitInputPixels,
    }).rotate()

    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0

    if (width < 1 || height < 1) {
        throw new Error('Source image dimensions could not be read')
    }

    const longEdge = Math.max(width, height)
    const scale = Math.min(1, previewLongEdge / longEdge)
    const previewWidth = Math.max(1, Math.round(width * scale))
    const previewHeight = Math.max(1, Math.round(height * scale))
    const bytes = await image.resize(previewWidth, previewHeight, {fit: 'fill'}).webp({quality: previewQuality}).toBuffer()

    return {
        bytes,
        height: previewHeight,
        width: previewWidth,
    }
}

/**
 * @returns {Promise<string>}
 */
function readRequestText(request, maxBytes) {
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

        request.on('end', () => resolve(Buffer.concat(chunks, receivedBytes).toString('utf8')))
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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value))
}
