import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import test from 'node:test'
import {
    ANIMATED_AVIF_CRF,
    ANIMATED_AVIF_FALLBACK_CRF,
    AnimatedPreviewTooLargeError,
    buildAnimatedFilterGraph,
    createAnimatedAvifPreview,
    isGifSource,
    parseGifProbe,
    scaleAnimatedDimensions,
} from './animatedAvif.mjs'

function gifBytes() {
    return Buffer.from('GIF89a' + '\0'.repeat(32), 'latin1')
}

function probeJson({frames = 3, height = 200, width = 300} = {}) {
    return JSON.stringify({
        streams: [{codec_type: 'video', height, nb_frames: String(frames), width}],
    })
}

function fakeExec({frames = 3, height = 2000, outputSizes = [1024], transparent = false, width = 3000} = {}) {
    const calls = []
    let encodeIndex = 0

    const run = async (command, args) => {
        calls.push({args, command})

        if (command === 'ffprobe') {
            return {stderr: '', stdout: probeJson({frames, height, width})}
        }

        if (args.includes('rawvideo')) {
            return {stderr: '', stdout: Buffer.from([transparent ? 0 : 255])}
        }

        const outputPath = args.at(-1)
        const size = outputSizes[Math.min(encodeIndex, outputSizes.length - 1)]
        encodeIndex += 1
        await writeFile(outputPath, Buffer.alloc(size))
        return {stderr: '', stdout: ''}
    }

    return {calls, run}
}

test('detects GIF signatures', () => {
    assert.equal(isGifSource(Buffer.from('GIF87a', 'latin1')), true)
    assert.equal(isGifSource(Buffer.from('GIF89a', 'latin1')), true)
    assert.equal(isGifSource(Buffer.from('GIF8', 'latin1')), false)
    assert.equal(isGifSource(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false)
})

test('parses frame count from count_frames tags', () => {
    const probe = parseGifProbe(
        JSON.stringify({
            streams: [{codec_type: 'video', height: 200, tags: {count_frames: '58'}, width: 300}],
        }),
    )

    assert.deepEqual(probe, {frames: 58, height: 200, width: 300})
})

test('parses frame count from nb_frames', () => {
    assert.deepEqual(parseGifProbe(probeJson({frames: 7})), {frames: 7, height: 200, width: 300})
})

test('parses frame count from nb_read_frames', () => {
    const probe = parseGifProbe(
        JSON.stringify({
            streams: [{codec_type: 'video', height: 200, nb_read_frames: '12', width: 300}],
        }),
    )

    assert.deepEqual(probe, {frames: 12, height: 200, width: 300})
})

test('rejects a probe without a video stream', () => {
    assert.throws(() => parseGifProbe(JSON.stringify({streams: []})), /no video stream/)
})

test('scales animated previews to the long edge and rounds to even', () => {
    assert.deepEqual(scaleAnimatedDimensions(3000, 2000, 1600), {height: 1066, width: 1600})
    assert.deepEqual(scaleAnimatedDimensions(640, 480, 1600), {height: 480, width: 640})
    assert.deepEqual(scaleAnimatedDimensions(1, 1, 1600), {height: 2, width: 2})
})

test('builds an opaque filter graph with the BT.709 matrix', () => {
    const graph = buildAnimatedFilterGraph(1600, 1066, false)

    assert.match(graph, /scale=1600:1066:flags=lanczos:out_color_matrix=bt709:out_range=tv/)
    assert.match(graph, /format=yuv420p/)
    assert.match(graph, /setparams=colorspace=bt709/)
    assert.doesNotMatch(graph, /alphaextract/)
})

test('builds a transparent filter graph that extracts alpha before scaling', () => {
    const graph = buildAnimatedFilterGraph(1600, 1066, true)

    assert.match(graph, /alphaextract,scale=1600:1066:flags=lanczos,format=gray/)
    assert.match(graph, /colorspace=unknown/)
})

test('returns null for a non-GIF source', async () => {
    const fake = fakeExec()

    const result = await createAnimatedAvifPreview(Buffer.from('PNG data'), {
        execFile: fake.run,
        maxBytes: 10_000,
        maxLongEdge: 1600,
    })

    assert.equal(result, null)
    assert.equal(fake.calls.length, 0)
})

test('returns null for a single-frame GIF', async () => {
    const fake = fakeExec({frames: 1})

    const result = await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 10_000,
        maxLongEdge: 1600,
    })

    assert.equal(result, null)
})

test('encodes an animated GIF within the size limit', async () => {
    const fake = fakeExec({outputSizes: [2048]})

    const result = await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    assert.deepEqual(result, {bytes: Buffer.alloc(2048), height: 1066, width: 1600})
    const encodeCalls = fake.calls.filter((call) => call.command === 'ffmpeg' && !call.args.includes('rawvideo'))
    assert.equal(encodeCalls.length, 1)
    assert.equal(encodeCalls[0].args.includes(String(ANIMATED_AVIF_CRF)), true)
    assert.equal(encodeCalls[0].args.includes('-usage'), true)
    assert.equal(encodeCalls[0].args.includes('realtime'), true)
})

test('retries at the fallback CRF when the first encode is too large', async () => {
    const fake = fakeExec({outputSizes: [8192, 2048]})

    const result = await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    assert.deepEqual(result, {bytes: Buffer.alloc(2048), height: 1066, width: 1600})
    const encodeCalls = fake.calls.filter((call) => call.command === 'ffmpeg' && !call.args.includes('rawvideo'))
    assert.equal(encodeCalls.length, 2)
    assert.equal(encodeCalls[1].args.includes(String(ANIMATED_AVIF_FALLBACK_CRF)), true)
})

test('throws when both encodes exceed the size limit', async () => {
    const fake = fakeExec({outputSizes: [8192]})

    await assert.rejects(
        createAnimatedAvifPreview(gifBytes(), {
            execFile: fake.run,
            maxBytes: 4096,
            maxLongEdge: 1600,
        }),
        AnimatedPreviewTooLargeError,
    )
})

test('maps both streams for a transparent GIF', async () => {
    const fake = fakeExec({outputSizes: [2048], transparent: true})

    await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    const encodeCall = fake.calls.find((call) => call.command === 'ffmpeg' && !call.args.includes('rawvideo'))
    assert.ok(encodeCall)
    assert.equal(encodeCall.args.includes('[a]'), true)
    assert.equal(encodeCall.args.includes('-filter_complex'), true)
})

test('maps the color stream for an opaque GIF', async () => {
    const fake = fakeExec({outputSizes: [2048]})

    await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    const encodeCall = fake.calls.find((call) => call.command === 'ffmpeg' && !call.args.includes('rawvideo'))
    assert.ok(encodeCall)
    assert.equal(encodeCall.args.includes('[c]'), true)
    assert.equal(encodeCall.args.includes('-filter_complex'), true)
    assert.equal(encodeCall.args.includes('-vf'), false)
})
