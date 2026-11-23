import {execFile as execFileCallback} from 'node:child_process'
import {mkdtemp, readFile, rm, unlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {promisify} from 'node:util'

const execFile = promisify(execFileCallback)

/** @internal */
export const ANIMATED_AVIF_CRF = 6
/** @internal */
export const ANIMATED_AVIF_FALLBACK_CRF = 12
const ANIMATED_AVIF_CPU_USED = 6
const ANIMATED_AVIF_TIMEOUT_MS = 300_000
const ANIMATED_AVIF_PROBE_TIMEOUT_MS = 30_000
const ANIMATED_AVIF_TRANSPARENCY_PROBE_MAX_BYTES = 16 * 1024 * 1024

// swscale converts RGB to YUV with BT.601 coefficients when the source has no
// colour metadata. Tagging that output BT.709 shifts hues. Force the matrix the
// tag claims. Browsers decode AVIF as limited-range BT.709, so encode to match.
const RGB_TO_YUV = 'out_color_matrix=bt709:out_range=tv'
const COLOR_PARAMS = 'colorspace=bt709:color_primaries=bt709:color_trc=iec61966-2-1'
// Alpha is coverage, not colour. Tagging it BT.709 invites decoders to apply a
// transfer curve to the plane.
const ALPHA_PARAMS = 'colorspace=unknown:color_primaries=unknown:color_trc=unknown'

export class AnimatedPreviewTooLargeError extends Error {}

export function isGifSource(sourceBytes) {
    const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes)

    if (bytes.length < 6) {
        return false
    }

    const signature = bytes.subarray(0, 6).toString('latin1')
    return signature === 'GIF87a' || signature === 'GIF89a'
}

/** @internal */
export function isAvifSource(sourceBytes) {
    const bytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : Buffer.from(sourceBytes)

    if (bytes.length < 12) {
        return false
    }

    if (bytes.subarray(4, 8).toString('latin1') !== 'ftyp') {
        return false
    }

    const brand = bytes.subarray(8, 12).toString('latin1')
    return brand === 'avif' || brand === 'avis'
}

/**
 * @param {string} json
 * @returns {{width: number, height: number, frames: number}}
 * @internal
 */
export function parseGifProbe(json) {
    const data = JSON.parse(json)
    const video = Array.isArray(data.streams) ? data.streams.find((stream) => stream.codec_type === 'video') : null

    if (!video) {
        throw new Error('GIF probe returned no video stream')
    }

    return {
        width: Number.parseInt(video.width ?? '0', 10),
        height: Number.parseInt(video.height ?? '0', 10),
        frames: Number.parseInt(video.tags?.count_frames ?? video.nb_read_frames ?? video.nb_frames ?? '0', 10),
    }
}

/** @internal */
export function scaleAnimatedDimensions(width, height, maxLongEdge) {
    const scale = Math.min(1, maxLongEdge / Math.max(width, height))
    const scaledWidth = Math.round(width * scale) & ~1
    const scaledHeight = Math.round(height * scale) & ~1

    return {
        width: Math.max(2, scaledWidth),
        height: Math.max(2, scaledHeight),
    }
}

/**
 * alphaextract must run before scale: scale negotiates a format without an
 * alpha channel, which leaves alphaextract unable to choose a format.
 *
 * Transparent pixels carry arbitrary RGB. A straight-alpha resize drags that
 * RGB into nearby edges, so the transparent stream scales in premultiplied
 * space. premultiply weights color by alpha before lanczos, and blend divide
 * divides by the scaled alpha to restore straight color. FFmpeg's own
 * unpremultiply filter collapses color to gray during negotiation, so this
 * graph uses blend instead.
 * @internal
 */
export function buildAnimatedFilterGraph(width, height, transparent) {
    const color = `[0:v]scale=${width}:${height}:flags=lanczos:${RGB_TO_YUV},format=yuv420p,setparams=${COLOR_PARAMS}`

    if (!transparent) {
        return color
    }

    return [
        '[0:v]format=rgba,split=2[b0][b1]',
        '[b1]alphaextract[ap]',
        '[b0]format=gbrp[bg]',
        '[bg][ap]premultiply[pm]',
        `[pm]scale=${width}:${height}:flags=lanczos[ps]`,
        `[0:v]format=rgba,alphaextract,scale=${width}:${height}:flags=lanczos,format=gray,split=2[ag1][ag2]`,
        '[ag1]format=gbrp[ag3]',
        `[ps][ag3]blend=all_mode=divide,scale=${width}:${height}:flags=neighbor:${RGB_TO_YUV},format=yuv420p,setparams=${COLOR_PARAMS}[c]`,
        `[ag2]setparams=${ALPHA_PARAMS}[a]`,
    ].join(';')
}

/**
 * @param {Buffer} sourceBytes
 * @param {{execFile?: Function, maxBytes: number, maxLongEdge: number}} options
 * @returns {Promise<{bytes: Buffer, height: number, width: number} | null>}
 */
export async function createAnimatedAvifPreview(sourceBytes, options) {
    const run = options.execFile ?? execFile
    if (!isGifSource(sourceBytes)) {
        return null
    }

    const tempDir = await mkdtemp(join(tmpdir(), 'myoc-animated-avif-'))
    const inputPath = join(tempDir, 'source.gif')
    const outputPath = join(tempDir, 'preview.avif')

    try {
        await writeFile(inputPath, sourceBytes)
        const probe = await probeGif(inputPath, run)

        if (probe.frames <= 1 || probe.width < 1 || probe.height < 1) {
            return null
        }

        const dimensions = scaleAnimatedDimensions(probe.width, probe.height, options.maxLongEdge)
        const transparent = await detectTransparency(inputPath, run)
        let bytes = await encodeAnimatedAvif(inputPath, outputPath, dimensions, ANIMATED_AVIF_CRF, transparent, run)

        if (bytes.byteLength > options.maxBytes) {
            bytes = await encodeAnimatedAvif(inputPath, outputPath, dimensions, ANIMATED_AVIF_FALLBACK_CRF, transparent, run)
        }

        if (bytes.byteLength > options.maxBytes) {
            throw new AnimatedPreviewTooLargeError('Animated AVIF preview is too large')
        }

        return {
            bytes,
            height: dimensions.height,
            width: dimensions.width,
        }
    } finally {
        await rm(tempDir, {force: true, recursive: true})
    }
}

async function probeGif(inputPath, run) {
    const {stdout} = await run(
        'ffprobe',
        ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-show_format', '-count_frames', inputPath],
        {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: ANIMATED_AVIF_PROBE_TIMEOUT_MS,
        },
    )

    return parseGifProbe(stdout)
}

async function detectTransparency(inputPath, run) {
    try {
        const {stdout} = await run(
            'ffmpeg',
            [
                '-nostdin',
                '-v',
                'error',
                '-i',
                inputPath,
                '-filter_complex',
                'format=rgba,alphaextract,signalstats,metadata=print:file=-',
                '-f',
                'null',
                '-',
            ],
            {
                encoding: 'utf8',
                maxBuffer: ANIMATED_AVIF_TRANSPARENCY_PROBE_MAX_BYTES,
                stdio: ['ignore', 'pipe', 'pipe'],
                timeout: ANIMATED_AVIF_PROBE_TIMEOUT_MS,
            },
        )

        for (const line of stdout.split('\n')) {
            const match = /^lavfi\.signalstats\.YMIN=(.+)$/.exec(line.trim())

            if (match && Number(match[1]) < 255) {
                return true
            }
        }

        return false
    } catch (error) {
        // A failed probe must not drop alpha. Encode with alpha unless the
        // complete animation proves every frame is opaque.
        console.warn('Alpha probe failed; preserving alpha', {
            error: error instanceof Error ? error.message : String(error),
        })
        return true
    }
}

async function encodeAnimatedAvif(inputPath, outputPath, dimensions, crf, transparent, run) {
    const graph = buildAnimatedFilterGraph(dimensions.width, dimensions.height, transparent)
    const args = transparent
        ? [
              '-nostdin',
              '-y',
              '-i',
              inputPath,
              '-filter_complex',
              graph,
              '-map',
              '[c]',
              '-map',
              '[a]',
              '-c:v',
              'libaom-av1',
              '-crf',
              String(crf),
              '-cpu-used',
              String(ANIMATED_AVIF_CPU_USED),
              '-row-mt',
              '1',
              '-usage',
              'realtime',
              '-fps_mode',
              'passthrough',
              '-f',
              'avif',
              outputPath,
          ]
        : [
              '-nostdin',
              '-y',
              '-i',
              inputPath,
              '-filter_complex',
              `${graph}[c]`,
              '-map',
              '[c]',
              '-c:v',
              'libaom-av1',
              '-crf',
              String(crf),
              '-cpu-used',
              String(ANIMATED_AVIF_CPU_USED),
              '-row-mt',
              '1',
              '-usage',
              'realtime',
              '-fps_mode',
              'passthrough',
              '-f',
              'avif',
              outputPath,
          ]

    await unlink(outputPath).catch(() => {})
    await run('ffmpeg', args, {stdio: ['ignore', 'pipe', 'pipe'], timeout: ANIMATED_AVIF_TIMEOUT_MS})

    return await readFile(outputPath)
}

/**
 * Decode frame zero of an animated AVIF as PNG. Sharp cannot decode AVIF
 * sequences, so blur generation falls back to this still frame.
 * @param {Buffer} sourceBytes
 * @param {{execFile?: Function}} options
 * @returns {Promise<Buffer>}
 */
export async function extractFirstFramePng(sourceBytes, options = {}) {
    const run = options.execFile ?? execFile

    const tempDir = await mkdtemp(join(tmpdir(), 'myoc-animated-frame-'))
    const inputPath = join(tempDir, 'source.avif')
    const outputPath = join(tempDir, 'frame.png')

    try {
        await writeFile(inputPath, sourceBytes)
        await run('ffmpeg', ['-nostdin', '-y', '-i', inputPath, '-map', '0:v:0', '-frames:v', '1', '-c:v', 'png', outputPath], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: ANIMATED_AVIF_PROBE_TIMEOUT_MS,
        })

        return await readFile(outputPath)
    } finally {
        await rm(tempDir, {force: true, recursive: true})
    }
}
