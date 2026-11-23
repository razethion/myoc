import assert from 'node:assert/strict'
import {execFile as execFileCallback} from 'node:child_process'
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import {promisify} from 'node:util'
import {createAnimatedAvifPreview} from './animatedAvif.mjs'

const execFile = promisify(execFileCallback)

const SOURCE_SIZE = 64
const PREVIEW_SIZE = 32
const SOURCE_RED = [220, 10, 10, 255]
const SOURCE_TRANSPARENT = [255, 255, 255, 0]

// Alternating red and transparent columns. Each downscaled pixel covers one
// opaque and one transparent source pixel. A straight-alpha resize drags the
// transparent pixels' white RGB into every result color.
function stripeFrames() {
    const frames = Buffer.alloc(SOURCE_SIZE * SOURCE_SIZE * 4 * 2)

    for (let frame = 0; frame < 2; frame += 1) {
        for (let y = 0; y < SOURCE_SIZE; y += 1) {
            for (let x = 0; x < SOURCE_SIZE; x += 1) {
                const offset = (frame * SOURCE_SIZE * SOURCE_SIZE + y * SOURCE_SIZE + x) * 4
                frames.set(x % 2 === 0 ? SOURCE_RED : SOURCE_TRANSPARENT, offset)
            }
        }
    }

    return frames
}

async function encodeStripeGif(dir) {
    const rawPath = join(dir, 'stripes.raw')
    const gifPath = join(dir, 'stripes.gif')
    await writeFile(rawPath, stripeFrames())
    await execFile(
        'ffmpeg',
        [
            '-nostdin',
            '-v',
            'error',
            '-y',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgba',
            '-s',
            `${SOURCE_SIZE}x${SOURCE_SIZE}`,
            '-i',
            rawPath,
            '-filter_complex',
            '[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none:alpha_threshold=128',
            '-loop',
            '0',
            gifPath,
        ],
        {stdio: ['ignore', 'pipe', 'pipe']},
    )

    return await readFile(gifPath)
}

async function decodeCenterPixel(avifPath) {
    const {stdout} = await execFile(
        'ffmpeg',
        [
            '-nostdin',
            '-v',
            'error',
            '-i',
            avifPath,
            '-filter_complex',
            '[0:v:0][0:v:1]alphamerge,format=rgba',
            '-frames:v',
            '1',
            '-f',
            'rawvideo',
            '-pix_fmt',
            'rgba',
            'pipe:1',
        ],
        {encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']},
    )

    const offset = ((PREVIEW_SIZE / 2) * PREVIEW_SIZE + PREVIEW_SIZE / 2) * 4

    return {r: stdout[offset], g: stdout[offset + 1], b: stdout[offset + 2], a: stdout[offset + 3]}
}

test('keeps transparent pixel color out of downscaled edges', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myoc-animated-alpha-'))

    try {
        const gif = await encodeStripeGif(dir)
        const preview = await createAnimatedAvifPreview(gif, {maxBytes: 5_000_000, maxLongEdge: PREVIEW_SIZE})

        assert.ok(preview, 'expected an animated preview')
        assert.equal(preview.width, PREVIEW_SIZE)
        assert.equal(preview.height, PREVIEW_SIZE)

        const avifPath = join(dir, 'preview.avif')
        await writeFile(avifPath, preview.bytes)
        const {r, g, b, a} = await decodeCenterPixel(avifPath)

        // The center pixel covers one red and one transparent column: 50 percent alpha.
        assert.ok(a >= 110 && a <= 145, `alpha ${a} outside the 50 percent band`)

        const black = {r: Math.round((r * a) / 255), g: Math.round((g * a) / 255), b: Math.round((b * a) / 255)}
        assert.ok(Math.abs(black.r - 110) <= 15, `red ${black.r} is off 110 over black`)
        assert.ok(black.g <= 15, `green ${black.g} over black; transparent color bled into the red`)
        assert.ok(black.b <= 15, `blue ${black.b} over black; transparent color bled into the red`)

        const white = {
            r: Math.round((r * a) / 255 + 255 * (1 - a / 255)),
            g: Math.round((g * a) / 255 + 255 * (1 - a / 255)),
            b: Math.round((b * a) / 255 + 255 * (1 - a / 255)),
        }
        assert.ok(Math.abs(white.r - 237) <= 15, `red ${white.r} is off 237 over white`)
        assert.ok(Math.abs(white.g - 132) <= 15, `green ${white.g} is off 132 over white`)
        assert.ok(Math.abs(white.b - 132) <= 15, `blue ${white.b} is off 132 over white`)
    } finally {
        await rm(dir, {force: true, recursive: true})
    }
})
