import sharp from 'sharp'

/**
 * @param {Buffer} sourceBytes
 * @param {{limitInputPixels: number, maxLongEdge: number, quality: number}} options
 * @returns {Promise<{bytes: Buffer, height: number, width: number}>}
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
