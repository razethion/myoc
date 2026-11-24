import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import test from 'node:test'
import {
    ANIMATED_AVIF_CRF,
    ANIMATED_AVIF_FALLBACK_CRF,
    AnimatedPreviewTooLargeError,
    buildAnimatedFilterGraph,
    createAnimatedAvifPreview,
    extractFirstFramePng,
    isAvifSource,
    isGifSource,
    parseGifProbe,
    scaleAnimatedDimensions,
} from './animatedAvif.mjs'

function gifBytes() {
    return Buffer.from('GIF89a' + '\0'.repeat(32), 'latin1')
}

function probeJson({frames = 3, height = 200, streams = 1, width = 300} = {}) {
    return JSON.stringify({
        streams: Array.from({length: streams}, () => ({codec_type: 'video', height, nb_frames: String(frames), width})),
    })
}

function fakeExec({alphaBytes, frames = 3, height = 2000, outputSizes = [1024], streams = 1, transparent = false, width = 3000} = {}) {
    const calls = []
    let encodeIndex = 0

    const run = async (command, args) => {
        calls.push({args, command})

        if (command === 'ffprobe') {
            return {stderr: '', stdout: probeJson({frames, height, streams, width})}
        }

        if (args.some((arg) => arg.includes('signalstats'))) {
            const values = alphaBytes ?? [transparent ? 0 : 255]
            return {
                stderr: '',
                stdout: values.map((value) => `lavfi.signalstats.YMIN=${value}`).join('\n'),
            }
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

function avifHeader(brand) {
    const bytes = Buffer.alloc(24)
    bytes.writeUInt32BE(24, 0)
    bytes.write('ftyp', 4, 'latin1')
    bytes.write(brand, 8, 'latin1')
    return bytes
}

test('detects AVIF brands', () => {
    assert.equal(isAvifSource(avifHeader('avif')), true)
    assert.equal(isAvifSource(avifHeader('avis')), true)
    assert.equal(isAvifSource(avifHeader('isom')), false)
    assert.equal(isAvifSource(Buffer.from('GIF89a', 'latin1')), false)
})

test('extracts frame zero as PNG', async () => {
    const fake = fakeExec({outputSizes: [512]})

    const bytes = await extractFirstFramePng(Buffer.from('fake-avif'), {execFile: fake.run})

    assert.equal(bytes.length, 512)
    const call = fake.calls.at(-1)
    assert.equal(call.command, 'ffmpeg')
    assert.ok(call.args.includes('0:v:0'))
    assert.ok(call.args.includes('png'))
})

test('merges the alpha stream when the animated AVIF carries one', async () => {
    const fake = fakeExec({outputSizes: [512], streams: 2})

    const bytes = await extractFirstFramePng(Buffer.from('fake-avif'), {execFile: fake.run})

    assert.equal(bytes.length, 512)
    const call = fake.calls.at(-1)
    assert.equal(call.command, 'ffmpeg')
    assert.ok(call.args.includes('-filter_complex'))
    assert.ok(call.args.some((arg) => arg.includes('alphamerge')))
    assert.ok(call.args.includes('[v]'))
    assert.equal(call.args.includes('0:v:0'), false)
})

test('falls back to a static preview above the pixel budget', async () => {
    const fake = fakeExec({height: 5000, width: 6000})

    const result = await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 10_000,
        maxLongEdge: 1600,
    })

    assert.equal(result, null)
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].command, 'ffprobe')
})

test('treats a non-numeric frame count as a static source', async () => {
    const fake = fakeExec({frames: 'N/A'})

    const result = await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 10_000,
        maxLongEdge: 1600,
    })

    assert.equal(result, null)
})

test('rejects frame extraction above the pixel budget', async () => {
    const fake = fakeExec({height: 5000, width: 6000})

    await assert.rejects(() => extractFirstFramePng(Buffer.from('fake-avif'), {execFile: fake.run}), /pixel budget/)
    assert.equal(fake.calls.length, 1)
    assert.equal(fake.calls[0].command, 'ffprobe')
})

test('rejects frame extraction without a video stream', async () => {
    const run = async () => ({stderr: '', stdout: '{"streams":[]}'})

    await assert.rejects(() => extractFirstFramePng(Buffer.from('fake-avif'), {execFile: run}), /no video stream/)
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

test('builds an opaque filter graph with limited-range BT.709 color', () => {
    const graph = buildAnimatedFilterGraph(1600, 1066, false)

    assert.match(graph, /scale=1600:1066:flags=lanczos:out_color_matrix=bt709:out_range=tv/)
    assert.match(graph, /format=yuv420p/)
    assert.match(graph, /setparams=colorspace=bt709/)
    assert.match(graph, /color_trc=iec61966-2-1/)
    assert.doesNotMatch(graph, /range=pc/)
    assert.doesNotMatch(graph, /alphaextract/)
    assert.doesNotMatch(graph, /premultiply/)
})

test('builds a transparent filter graph that resizes premultiplied color', () => {
    const graph = buildAnimatedFilterGraph(1600, 1066, true)

    assert.match(graph, /alphaextract,scale=1600:1066:flags=lanczos,format=gray/)
    assert.match(graph, /colorspace=unknown/)
    assert.match(graph, /\[bg\]\[ap\]premultiply\[pm\]/)
    assert.match(graph, /\[pm\]scale=1600:1066:flags=lanczos\[ps\]/)
    assert.match(graph, /\[ps\]\[ag3\]blend=all_mode=divide,/)
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
    const encodeCalls = fake.calls.filter((call) => call.command === 'ffmpeg' && call.args.includes('libaom-av1'))
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
    const encodeCalls = fake.calls.filter((call) => call.command === 'ffmpeg' && call.args.includes('libaom-av1'))
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

    const encodeCall = fake.calls.find((call) => call.command === 'ffmpeg' && call.args.includes('libaom-av1'))
    assert.ok(encodeCall)
    assert.equal(encodeCall.args.includes('[a]'), true)
    assert.equal(encodeCall.args.includes('-filter_complex'), true)
})

test('detects transparency that appears after the first 30 frames', async () => {
    const fake = fakeExec({alphaBytes: [...Array(30).fill(255), 0], outputSizes: [2048]})

    await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    const encodeCall = fake.calls.find((call) => call.command === 'ffmpeg' && call.args.includes('libaom-av1'))
    assert.ok(encodeCall)
    assert.equal(encodeCall.args.includes('[a]'), true)
    assert.equal(encodeCall.args.includes('-filter_complex'), true)
})

test('probes every frame at full resolution for transparency', async () => {
    const fake = fakeExec({alphaBytes: [...Array(30).fill(255), 0], outputSizes: [2048]})

    await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    const probeCall = fake.calls.find((call) => call.command === 'ffmpeg' && call.args.some((arg) => arg.includes('signalstats')))
    assert.ok(probeCall)
    assert.equal(
        probeCall.args.some((arg) => arg.includes('metadata=print:file=-')),
        true,
    )
    assert.equal(
        probeCall.args.some((arg) => arg.includes('scale=')),
        false,
    )
})

test('maps the color stream for an opaque GIF', async () => {
    const fake = fakeExec({outputSizes: [2048]})

    await createAnimatedAvifPreview(gifBytes(), {
        execFile: fake.run,
        maxBytes: 4096,
        maxLongEdge: 1600,
    })

    const encodeCall = fake.calls.find((call) => call.command === 'ffmpeg' && call.args.includes('libaom-av1'))
    assert.ok(encodeCall)
    assert.equal(encodeCall.args.includes('[c]'), true)
    assert.equal(encodeCall.args.includes('-filter_complex'), true)
    assert.equal(encodeCall.args.includes('-vf'), false)
})
