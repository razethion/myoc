import sharp from 'sharp'
import {AnimatedPreviewTooLargeError, createAnimatedAvifPreview, isGifSource} from './animatedAvif.mjs'
import {addNclx, resolveCicp} from './avifColor.mjs'

async function encodeAvif(pipeline, cicp, options) {
    const bytes = await (cicp.keepIcc ? pipeline.keepIccProfile() : pipeline).avif(options).toBuffer()
    return addNclx(bytes, cicp)
}

/**
 * @param {import('sharp').SharpInput} sourceBytes
 * @param {{limitInputPixels: number, maxLongEdge: number, quality: number}} options
 */
export async function createAvifPreview(sourceBytes, options) {
    // nosemgrep: javascript.express.file.sharp-express.sharp-express -- sourceBytes is an in-memory Buffer from a validated fetch.
    const image = sharp(sourceBytes, {
        limitInputPixels: options.limitInputPixels,
    }).rotate()

    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0

    if (width < 1 || height < 1) {
        throw new Error('Source image dimensions could not be read')
    }

    const longEdge = Math.max(width, height)
    const scale = Math.min(1, options.maxLongEdge / longEdge)
    const previewWidth = Math.max(1, Math.round(width * scale))
    const previewHeight = Math.max(1, Math.round(height * scale))
    const animated = await animatedPreviewForSource(sourceBytes, options)

    if (animated) {
        return {...animated, animated: true}
    }

    const cicp = resolveCicp(metadata.icc)
    const bytes = await encodeAvif(image.resize(previewWidth, previewHeight, {fit: 'fill'}), cicp, {
        chromaSubsampling: '4:4:4',
        effort: 4,
        quality: options.quality,
    })

    return {
        animated: false,
        bytes,
        height: previewHeight,
        width: previewWidth,
    }
}

async function animatedPreviewForSource(sourceBytes, options) {
    if (!options.animatedPreviews || !isGifSource(sourceBytes)) {
        return null
    }

    try {
        return await createAnimatedAvifPreview(sourceBytes, {
            maxBytes: options.maxBytes,
            maxLongEdge: options.maxLongEdge,
        })
    } catch (error) {
        if (!(error instanceof AnimatedPreviewTooLargeError)) {
            console.warn('Animated AVIF preview failed; using a static preview', {
                error: error instanceof Error ? error.message : String(error),
            })
        }
        return null
    }
}

/**
 * @param {import('sharp').SharpInput} sourceBytes
 * @param {{limitInputPixels: number, maxWidth: number, quality: number, sigma: number}} options
 */
export async function createAvifBlur(sourceBytes, options) {
    // nosemgrep: javascript.express.file.sharp-express.sharp-express -- sourceBytes is a bounded request body from the Worker.
    const image = sharp(sourceBytes, {
        limitInputPixels: options.limitInputPixels,
    }).rotate()
    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0

    // Sharp rejects an image without positive dimensions before metadata resolves.
    /* node:coverage ignore next 3 */
    if (width < 1 || height < 1) {
        throw new Error('Preview image dimensions could not be read')
    }

    const scale = Math.min(1, options.maxWidth / width)
    const blurWidth = Math.max(1, Math.round(width * scale))
    const blurHeight = Math.max(1, Math.round(height * scale))
    const cicp = resolveCicp(metadata.icc)
    const bytes = await encodeAvif(image.resize(blurWidth, blurHeight, {fit: 'fill'}).blur(options.sigma), cicp, {
        chromaSubsampling: '4:4:4',
        effort: 4,
        quality: options.quality,
    })

    return {
        bytes,
        height: blurHeight,
        width: blurWidth,
    }
}

/**
 * Convert one lossless square crop to an AVIF image.
 *
 * @param {import('sharp').SharpInput} sourceBytes
 * @param {{limitInputPixels: number, quality: number, size: number}} options
 */
export async function createSquareAvif(sourceBytes, options) {
    // nosemgrep: javascript.express.file.sharp-express.sharp-express -- sourceBytes is a bounded request body from the Worker.
    const image = sharp(sourceBytes, {
        limitInputPixels: options.limitInputPixels,
    }).rotate()
    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0

    if (width !== options.size || height !== options.size) {
        throw new Error(`Square image source must be ${options.size}x${options.size} pixels`)
    }

    const cicp = resolveCicp(metadata.icc)
    const bytes = await encodeAvif(image.resize(options.size, options.size, {fit: 'fill'}), cicp, {
        chromaSubsampling: '4:4:4',
        effort: 4,
        quality: options.quality,
    })

    return {
        bytes,
        height: options.size,
        width: options.size,
    }
}

/**
 * Create all gallery outputs from one source buffer.
 *
 * @param {import('sharp').SharpInput} sourceBytes
 * @param {{blur: boolean, blurMaxWidth: number, blurQuality: number, blurSigma: number, limitInputPixels: number, maxLongEdge: number, previewQuality: number}} options
 */
export async function createGalleryAvifOutputs(sourceBytes, options) {
    // nosemgrep: javascript.express.file.sharp-express.sharp-express -- sourceBytes is a bounded request body from the Worker.
    const image = sharp(sourceBytes, {
        animated: false,
        limitInputPixels: options.limitInputPixels,
    }).rotate()
    const metadata = await image.metadata()
    const width = metadata.autoOrient?.width ?? metadata.width ?? 0
    const height = metadata.autoOrient?.height ?? metadata.height ?? 0

    // Sharp rejects an image without positive dimensions before metadata resolves.
    /* node:coverage ignore next 3 */
    if (width < 1 || height < 1) {
        throw new Error('Gallery image dimensions could not be read')
    }

    const longEdge = Math.max(width, height)
    const previewScale = Math.min(1, options.maxLongEdge / longEdge)
    const staticPreviewWidth = Math.max(1, Math.round(width * previewScale))
    const staticPreviewHeight = Math.max(1, Math.round(height * previewScale))
    const cicp = resolveCicp(metadata.icc)
    const previewPipeline = image.clone().resize(staticPreviewWidth, staticPreviewHeight, {fit: 'fill'})
    const animated = await animatedPreviewForSource(sourceBytes, {
        animatedPreviews: options.animatedPreviews,
        maxBytes: options.previewMaxBytes,
        maxLongEdge: options.maxLongEdge,
    })
    const previewBytes =
        animated?.bytes ??
        (await encodeAvif(previewPipeline.clone(), cicp, {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.previewQuality,
        }))
    const previewWidth = animated?.width ?? staticPreviewWidth
    const previewHeight = animated?.height ?? staticPreviewHeight

    if (!options.blur) {
        return {
            blur: null,
            preview: {animated: Boolean(animated), bytes: previewBytes, height: previewHeight, width: previewWidth},
        }
    }

    const blurScale = Math.min(1, options.blurMaxWidth / previewWidth)
    const blurWidth = Math.max(1, Math.round(previewWidth * blurScale))
    const blurHeight = Math.max(1, Math.round(previewHeight * blurScale))
    const blurBytes = await encodeAvif(previewPipeline.clone().resize(blurWidth, blurHeight, {fit: 'fill'}).blur(options.blurSigma), cicp, {
        chromaSubsampling: '4:4:4',
        effort: 4,
        quality: options.blurQuality,
    })

    return {
        blur: {bytes: blurBytes, height: blurHeight, width: blurWidth},
        preview: {animated: Boolean(animated), bytes: previewBytes, height: previewHeight, width: previewWidth},
    }
}
