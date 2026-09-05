import sharp from 'sharp'

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
    const bytes = await image
        .resize(previewWidth, previewHeight, {fit: 'fill'})
        .keepIccProfile()
        .avif({
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        })
        .toBuffer()

    return {
        bytes,
        height: previewHeight,
        width: previewWidth,
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
    const bytes = await image
        .resize(blurWidth, blurHeight, {fit: 'fill'})
        .blur(options.sigma)
        .keepIccProfile()
        .avif({
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        })
        .toBuffer()

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

    const bytes = await image
        .resize(options.size, options.size, {fit: 'fill'})
        .keepIccProfile()
        .avif({
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        })
        .toBuffer()

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
    const previewWidth = Math.max(1, Math.round(width * previewScale))
    const previewHeight = Math.max(1, Math.round(height * previewScale))
    const previewPipeline = image.clone().resize(previewWidth, previewHeight, {fit: 'fill'}).keepIccProfile()
    const previewBytes = await previewPipeline
        .clone()
        .avif({
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.previewQuality,
        })
        .toBuffer()

    if (!options.blur) {
        return {
            blur: null,
            preview: {bytes: previewBytes, height: previewHeight, width: previewWidth},
        }
    }

    const blurScale = Math.min(1, options.blurMaxWidth / previewWidth)
    const blurWidth = Math.max(1, Math.round(previewWidth * blurScale))
    const blurHeight = Math.max(1, Math.round(previewHeight * blurScale))
    const blurBytes = await previewPipeline
        .clone()
        .resize(blurWidth, blurHeight, {fit: 'fill'})
        .blur(options.blurSigma)
        .avif({
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.blurQuality,
        })
        .toBuffer()

    return {
        blur: {bytes: blurBytes, height: blurHeight, width: blurWidth},
        preview: {bytes: previewBytes, height: previewHeight, width: previewWidth},
    }
}
