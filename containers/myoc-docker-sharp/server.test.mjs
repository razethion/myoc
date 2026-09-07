import assert from 'node:assert/strict'
import {Buffer} from 'node:buffer'
import process from 'node:process'
import {after, before, test} from 'node:test'
import sharp from 'sharp'

const processorToken = 'container-test-token'
let baseUrl
let server

before(async () => {
    process.env.PORT = '0'
    process.env.PREVIEW_PROCESSOR_TOKEN = processorToken
    process.env.REQUEST_BODY_MAX_BYTES = '64'
    process.env.BLUR_SOURCE_MAX_BYTES = String(32 * 1024)
    process.env.SOURCE_IMAGE_MAX_BYTES = String(32 * 1024)
    process.env.SQUARE_SOURCE_MAX_BYTES = String(32 * 1024)

    const serverModule = await import('./server.mjs')
    server = serverModule.server

    if (!server.listening) {
        await new Promise((resolve) => server.once('listening', resolve))
    }

    const address = server.address()
    assert.ok(address && typeof address === 'object')
    baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
    delete process.env.PORT
    delete process.env.PREVIEW_PROCESSOR_TOKEN
    delete process.env.REQUEST_BODY_MAX_BYTES
    delete process.env.BLUR_SOURCE_MAX_BYTES
    delete process.env.SOURCE_IMAGE_MAX_BYTES
    delete process.env.SQUARE_SOURCE_MAX_BYTES

    if (server?.listening) {
        await new Promise((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()))
        })
    }
})

test('reports container health', async () => {
    const response = await fetch(`${baseUrl}/health`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {ok: true})
})

test('returns a JSON error for an unknown endpoint', async () => {
    const response = await fetch(`${baseUrl}/images/missing`)

    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {error: 'Not found'})
})

test('rejects unsupported blur methods', async () => {
    const response = await fetch(`${baseUrl}/images/blur`)

    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'POST')
})

test('requires the processor token for blur requests', async () => {
    const response = await fetch(`${baseUrl}/images/blur`, {
        body: new Uint8Array([1]),
        method: 'POST',
    })

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {error: 'Unauthorized'})
})

test('rejects a processor token with extra text', async () => {
    const response = await fetch(`${baseUrl}/images/blur`, {
        body: new Uint8Array([1]),
        headers: {authorization: `Bearer ${processorToken}-extra`},
        method: 'POST',
    })

    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {error: 'Unauthorized'})
})

test('rejects invalid preview request JSON', async () => {
    const response = await fetch(`${baseUrl}/images/preview`, {
        body: '{',
        headers: {
            authorization: `Bearer ${processorToken}`,
            'content-type': 'application/json',
        },
        method: 'POST',
    })

    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), {error: 'Invalid JSON body'})
})

for (const imageUrl of ['http://m.myoc.art/image.png', 'file:///etc/passwd', 'not-a-url']) {
    test(`rejects unsafe preview URL ${imageUrl}`, async () => {
        const response = await fetch(`${baseUrl}/images/preview`, {
            body: JSON.stringify({imageUrl}),
            headers: {
                authorization: `Bearer ${processorToken}`,
                'content-type': 'application/json',
            },
            method: 'POST',
        })

        assert.equal(response.status, 400)
        assert.deepEqual(await response.json(), {error: 'imageUrl must be a valid HTTPS URL'})
    })
}

test('returns 413 for an oversized preview request', async () => {
    const response = await fetch(`${baseUrl}/images/preview`, {
        body: JSON.stringify({imageUrl: 'https://m.myoc.art/image.png', padding: 'x'.repeat(64)}),
        headers: {
            authorization: `Bearer ${processorToken}`,
            'content-type': 'application/json',
        },
        method: 'POST',
    })

    assert.equal(response.status, 413)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), {error: 'Request body is too large'})
})

for (const endpoint of ['blur', 'square', 'gallery', 'height-chart']) {
    test(`returns 413 for an oversized ${endpoint} request`, async () => {
        const response = await fetch(`${baseUrl}/images/${endpoint}`, {
            body: new Uint8Array(32 * 1024 + 1),
            headers: {authorization: `Bearer ${processorToken}`},
            method: 'POST',
        })

        assert.equal(response.status, 413)
        assert.equal(response.headers.get('cache-control'), 'no-store')
        assert.deepEqual(await response.json(), {error: 'Request body is too large'})
    })
}

test('creates a bounded AVIF blur through the HTTP interface', async () => {
    /** @type {Buffer} */
    const source = await sharp({
        create: {
            background: {b: 20, g: 80, r: 220},
            channels: 3,
            height: 800,
            width: 1200,
        },
    })
        .png()
        .toBuffer()
    const requestBody = /** @type {BodyInit} */ (source)
    const response = await fetch(`${baseUrl}/images/blur`, {
        body: requestBody,
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })
    const result = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(result).metadata()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal(response.headers.get('content-type'), 'image/avif')
    assert.equal(response.headers.get('x-preview-width'), '960')
    assert.equal(response.headers.get('x-preview-height'), '640')
    assert.equal(Number(response.headers.get('content-length')), result.byteLength)
    assert.equal(metadata.format, 'heif')
    assert.equal(metadata.compression, 'av1')
    assert.equal(metadata.width, 960)
    assert.equal(metadata.height, 640)
})

test('returns a stable error when Sharp rejects a blur source', async () => {
    const response = await fetch(`${baseUrl}/images/blur`, {
        body: new Uint8Array([1, 2, 3]),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })

    assert.equal(response.status, 502)
    assert.deepEqual(await response.json(), {error: 'Blur generation failed'})
})

test('creates a square AVIF through the HTTP interface', async () => {
    const source = await sharp({
        create: {background: {b: 20, g: 80, r: 220}, channels: 3, height: 512, width: 512},
    })
        .png()
        .toBuffer()
    const response = await fetch(`${baseUrl}/images/square`, {
        body: /** @type {BodyInit} */ (source),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })
    const result = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(result).metadata()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/avif')
    assert.equal(response.headers.get('x-preview-width'), '512')
    assert.equal(response.headers.get('x-preview-height'), '512')
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
})

test('returns a stable error for an invalid square source', async () => {
    const response = await fetch(`${baseUrl}/images/square`, {
        body: new Uint8Array([1, 2, 3]),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {error: 'Square image generation failed'})
})

test('rejects unsupported square methods and unauthorized requests', async () => {
    const unsupported = await fetch(`${baseUrl}/images/square`)
    const unauthorized = await fetch(`${baseUrl}/images/square`, {
        body: new Uint8Array([1]),
        method: 'POST',
    })

    assert.equal(unsupported.status, 405)
    assert.equal(unsupported.headers.get('allow'), 'POST')
    assert.equal(unauthorized.status, 401)
    assert.deepEqual(await unauthorized.json(), {error: 'Unauthorized'})
})

test('creates one framed gallery response with an optional blur', async () => {
    const source = await sharp({
        create: {background: {b: 20, g: 80, r: 220}, channels: 3, height: 800, width: 1200},
    })
        .png()
        .toBuffer()
    const response = await fetch(`${baseUrl}/images/gallery?blur=1`, {
        body: /** @type {BodyInit} */ (source),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })
    const result = Buffer.from(await response.arrayBuffer())
    const previewLength = Number(response.headers.get('x-preview-length'))
    const blurLength = Number(response.headers.get('x-blur-length'))

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/octet-stream')
    assert.equal(previewLength + blurLength, result.byteLength)
    assert.equal((await sharp(result.subarray(0, previewLength)).metadata()).format, 'heif')
    assert.equal((await sharp(result.subarray(previewLength)).metadata()).format, 'heif')
})

test('returns a stable error for an invalid gallery source', async () => {
    const response = await fetch(`${baseUrl}/images/gallery`, {
        body: new Uint8Array([1, 2, 3]),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {error: 'Gallery image generation failed'})
})

test('creates a proportional AVIF height chart with transparency', async () => {
    const source = await sharp({
        create: {background: {alpha: 0.5, b: 20, g: 80, r: 220}, channels: 4, height: 1200, width: 600},
    })
        .png()
        .toBuffer()
    const response = await fetch(`${baseUrl}/images/height-chart`, {
        body: /** @type {BodyInit} */ (source),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })
    const result = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(result).metadata()

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/avif')
    assert.equal(response.headers.get('x-preview-width'), '600')
    assert.equal(response.headers.get('x-preview-height'), '1200')
    assert.equal(metadata.width, 600)
    assert.equal(metadata.height, 1200)
    assert.equal(metadata.hasAlpha, true)
})

test('returns a stable error for an invalid height chart source', async () => {
    const response = await fetch(`${baseUrl}/images/height-chart`, {
        body: new Uint8Array([1, 2, 3]),
        headers: {authorization: `Bearer ${processorToken}`},
        method: 'POST',
    })

    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {error: 'Height chart generation failed'})
})

test('rejects unsupported gallery methods and unauthorized requests', async () => {
    const unsupported = await fetch(`${baseUrl}/images/gallery`)
    const unauthorized = await fetch(`${baseUrl}/images/gallery`, {
        body: new Uint8Array([1]),
        method: 'POST',
    })

    assert.equal(unsupported.status, 405)
    assert.equal(unsupported.headers.get('allow'), 'POST')
    assert.equal(unauthorized.status, 401)
    assert.deepEqual(await unauthorized.json(), {error: 'Unauthorized'})
})
