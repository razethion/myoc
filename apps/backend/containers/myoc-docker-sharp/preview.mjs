import sharp from 'sharp'

const SRGB_PRIMARIES = {
    r: [0.43603515625, 0.222442626953125, 0.0139007568359375],
    g: [0.385101318359375, 0.7169342041015625, 0.097076416015625],
    b: [0.14306640625, 0.0606231689453125, 0.71392822265625],
}

const P3_PRIMARIES = {
    r: [0.5151214599609375, 0.2411956787109375, 0],
    g: [0.2919769287109375, 0.6922454833984375, 0.0418243408203125],
    b: [0.1571044921875, 0.066558837890625, 0.7830810546875],
}

/**
 * Read the rXYZ/gXYZ/bXYZ colorants from an ICC profile.
 *
 * @param {Buffer} icc
 */
function iccPrimaries(icc) {
    try {
        const tagCount = icc.readUInt32BE(128)
        const tags = {}
        for (let i = 0; i < tagCount; i++) {
            const off = 132 + i * 12
            tags[icc.toString('latin1', off, off + 4)] = {offset: icc.readUInt32BE(off + 4)}
        }
        const xyz = (signature) => {
            const tag = tags[signature]
            if (!tag) return null
            const base = tag.offset + 8
            return [
                icc.readInt32BE(base) / 65536,
                icc.readInt32BE(base + 4) / 65536,
                icc.readInt32BE(base + 8) / 65536,
            ]
        }
        return {r: xyz('rXYZ'), g: xyz('gXYZ'), b: xyz('bXYZ')}
    } catch {
        return null
    }
}

function matchesPrimaries(actual, expected) {
    if (!actual) return false
    return ['r', 'g', 'b'].every((channel) => {
        const values = actual[channel]
        return values && values.every((value, i) => Math.abs(value - expected[channel][i]) < 0.02)
    })
}

/**
 * Map a source ICC profile to CICP values so the AVIF declares its real color space.
 * Unknown profiles fall back to sRGB conversion.
 *
 * @param {Buffer | undefined} icc
 */
function resolveCicp(icc) {
    if (!icc) return {primaries: 1, transfer: 13, matrix: 0, fullRange: true, keepIcc: false}
    const primaries = iccPrimaries(icc)
    if (matchesPrimaries(primaries, P3_PRIMARIES)) {
        return {primaries: 12, transfer: 13, matrix: 0, fullRange: true, keepIcc: true}
    }
    if (matchesPrimaries(primaries, SRGB_PRIMARIES)) {
        return {primaries: 1, transfer: 13, matrix: 0, fullRange: true, keepIcc: true}
    }
    return {primaries: 1, transfer: 13, matrix: 0, fullRange: true, keepIcc: false}
}

function findBox(buf, start, end, type) {
    let off = start
    while (off + 8 <= end) {
        let size = buf.readUInt32BE(off)
        const boxType = buf.toString('latin1', off + 4, off + 8)
        let header = 8
        if (size === 1) {
            size = Number(buf.readBigUInt64BE(off + 8))
            header = 16
        } else if (size === 0) {
            size = end - off
        }
        if (boxType === type) return {off, size, header}
        off += size
    }
    return null
}

function readUInt(buf, off, size) {
    if (size === 4) return buf.readUInt32BE(off)
    if (size === 8) return Number(buf.readBigUInt64BE(off))
    if (size === 2) return buf.readUInt16BE(off)
    if (size === 1) return buf.readUInt8(off)
    throw new Error(`Unsupported integer size ${size}`)
}

function writeUInt(buf, off, value, size) {
    if (size === 4) buf.writeUInt32BE(value, off)
    else if (size === 8) buf.writeBigUInt64BE(BigInt(value), off)
    else if (size === 2) buf.writeUInt16BE(value, off)
    else if (size === 1) buf.writeUInt8(value, off)
    else throw new Error(`Unsupported integer size ${size}`)
}

function adjustIlocBaseOffset(buf, ilocOff, delta) {
    const version = buf[ilocOff + 8]
    let p = ilocOff + 12
    const offsetSize = buf[p] >> 4
    const lengthSize = buf[p] & 0x0f
    p += 1
    const baseOffsetSize = buf[p] >> 4
    const indexSize = version >= 1 ? buf[p] & 0x0f : 0
    p += 1
    const itemCount = version === 2 ? buf.readUInt32BE(p) : buf.readUInt16BE(p)
    p += version === 2 ? 4 : 2
    for (let i = 0; i < itemCount; i++) {
        p += version === 2 ? 4 : 2
        if (version >= 1) p += 2
        p += 2
        if (baseOffsetSize > 0) {
            const baseOffset = readUInt(buf, p, baseOffsetSize)
            writeUInt(buf, p, baseOffset + delta, baseOffsetSize)
            p += baseOffsetSize
        }
        const extentCount = buf.readUInt16BE(p)
        p += 2
        for (let j = 0; j < extentCount; j++) {
            if (version >= 1 && indexSize > 0) p += indexSize
            p += offsetSize
            p += lengthSize
        }
    }
}

function addAssociation(buf, ipma, newIndex, primaryId) {
    const version = buf[ipma.off + 8]
    const flags = buf.readUIntBE(ipma.off + 9, 3)
    const entryCount = buf.readUInt32BE(ipma.off + 12)
    const associationSize = flags & 1 ? 2 : 1
    let p = ipma.off + 16
    const entries = []
    for (let i = 0; i < entryCount; i++) {
        const itemIdSize = version === 0 ? 2 : 4
        const itemId = version === 0 ? buf.readUInt16BE(p) : buf.readUInt32BE(p)
        p += itemIdSize
        const associationCount = buf[p]
        p += 1
        const associations = []
        for (let j = 0; j < associationCount; j++) {
            if (associationSize === 2) {
                associations.push(buf.readUInt16BE(p))
                p += 2
            } else {
                associations.push(buf[p])
                p += 1
            }
        }
        entries.push({itemId, associations})
    }
    const target = entries.find((entry) => entry.itemId === primaryId) ?? entries[0]
    target.associations.push(newIndex)
    const header = Buffer.alloc(16)
    header.write('ipma', 4, 'latin1')
    header.writeUInt8(version, 8)
    header.writeUIntBE(flags, 9, 3)
    header.writeUInt32BE(entryCount, 12)
    const parts = [header]
    for (const entry of entries) {
        const itemIdSize = version === 0 ? 2 : 4
        const body = Buffer.alloc(itemIdSize + 1 + entry.associations.length * associationSize)
        if (version === 0) body.writeUInt16BE(entry.itemId, 0)
        else body.writeUInt32BE(entry.itemId, 0)
        body.writeUInt8(entry.associations.length, itemIdSize)
        let q = itemIdSize + 1
        for (const association of entry.associations) {
            if (associationSize === 2) {
                body.writeUInt16BE(association, q)
                q += 2
            } else {
                body.writeUInt8(association, q)
                q += 1
            }
        }
        parts.push(body)
    }
    const result = Buffer.concat(parts)
    result.writeUInt32BE(result.length, 0)
    return result
}

/**
 * Add an nclx (CICP) color box to an AVIF so browsers interpret the pixels in the
 * declared color space instead of falling back to sRGB.
 *
 * @param {Buffer} buf
 * @param {{primaries: number, transfer: number, matrix: number, fullRange: boolean}} cicp
 */
function addNclx(buf, cicp) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return buf
    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    if (!iprp) return buf
    const ipco = findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipco')
    const ipma = findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipma')
    const pitm = findBox(buf, meta.off + 12, meta.off + meta.size, 'pitm')
    const iloc = findBox(buf, meta.off + 12, meta.off + meta.size, 'iloc')
    if (!ipco || !ipma || !pitm || !iloc) return buf
    const pitmVersion = buf[pitm.off + 8]
    const primaryId = pitmVersion === 0 ? buf.readUInt16BE(pitm.off + 12) : buf.readUInt32BE(pitm.off + 12)
    let propertyCount = 0
    let p = ipco.off + ipco.header
    while (p + 8 <= ipco.off + ipco.size) {
        let size = buf.readUInt32BE(p)
        if (size === 1) size = Number(buf.readBigUInt64BE(p + 8))
        else if (size === 0) size = ipco.off + ipco.size - p
        propertyCount += 1
        p += size
    }
    const newIndex = propertyCount + 1
    const nclx = Buffer.alloc(19)
    nclx.writeUInt32BE(19, 0)
    nclx.write('colr', 4, 'latin1')
    nclx.write('nclx', 8, 'latin1')
    nclx.writeUInt16BE(cicp.primaries, 12)
    nclx.writeUInt16BE(cicp.transfer, 14)
    nclx.writeUInt16BE(cicp.matrix, 16)
    nclx.writeUInt8(cicp.fullRange ? 0x80 : 0, 18)
    const ipcoChildren = buf.subarray(ipco.off + ipco.header, ipco.off + ipco.size)
    const newIpcoSize = ipco.size + nclx.length
    const newIpco = Buffer.alloc(newIpcoSize)
    newIpco.writeUInt32BE(newIpcoSize, 0)
    newIpco.write('ipco', 4, 'latin1')
    ipcoChildren.copy(newIpco, 8)
    nclx.copy(newIpco, 8 + ipcoChildren.length)
    const newIpma = addAssociation(buf, ipma, newIndex, primaryId)
    const newIprpSize = 8 + newIpco.length + newIpma.length
    const newIprp = Buffer.alloc(newIprpSize)
    newIprp.writeUInt32BE(newIprpSize, 0)
    newIprp.write('iprp', 4, 'latin1')
    newIpco.copy(newIprp, 8)
    newIpma.copy(newIprp, 8 + newIpco.length)
    const beforeIprp = buf.subarray(meta.off + 12, iprp.off)
    const afterIprp = buf.subarray(iprp.off + iprp.size, meta.off + meta.size)
    const newMetaSize = meta.size + (newIprp.length - iprp.size)
    const newMeta = Buffer.alloc(newMetaSize)
    newMeta.writeUInt32BE(newMetaSize, 0)
    newMeta.write('meta', 4, 'latin1')
    buf.copy(newMeta, 8, meta.off + 8, meta.off + 12)
    beforeIprp.copy(newMeta, 12)
    newIprp.copy(newMeta, 12 + beforeIprp.length)
    afterIprp.copy(newMeta, 12 + beforeIprp.length + newIprp.length)
    const out = Buffer.concat([buf.subarray(0, meta.off), newMeta, buf.subarray(meta.off + meta.size)])
    const delta = newMeta.length - meta.size
    const newIloc = findBox(out, meta.off + 12, meta.off + newMetaSize, 'iloc')
    if (newIloc) adjustIlocBaseOffset(out, newIloc.off, delta)
    return out
}

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
    const cicp = resolveCicp(metadata.icc)
    const bytes = await encodeAvif(
        image.resize(previewWidth, previewHeight, {fit: 'fill'}),
        cicp,
        {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        },
    )

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
    const cicp = resolveCicp(metadata.icc)
    const bytes = await encodeAvif(
        image.resize(blurWidth, blurHeight, {fit: 'fill'}).blur(options.sigma),
        cicp,
        {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        },
    )

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
    const bytes = await encodeAvif(
        image.resize(options.size, options.size, {fit: 'fill'}),
        cicp,
        {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.quality,
        },
    )

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
    const cicp = resolveCicp(metadata.icc)
    const previewPipeline = image.clone().resize(previewWidth, previewHeight, {fit: 'fill'})
    const previewBytes = await encodeAvif(
        previewPipeline.clone(),
        cicp,
        {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.previewQuality,
        },
    )

    if (!options.blur) {
        return {
            blur: null,
            preview: {bytes: previewBytes, height: previewHeight, width: previewWidth},
        }
    }

    const blurScale = Math.min(1, options.blurMaxWidth / previewWidth)
    const blurWidth = Math.max(1, Math.round(previewWidth * blurScale))
    const blurHeight = Math.max(1, Math.round(previewHeight * blurScale))
    const blurBytes = await encodeAvif(
        previewPipeline.clone().resize(blurWidth, blurHeight, {fit: 'fill'}).blur(options.blurSigma),
        cicp,
        {
            chromaSubsampling: '4:4:4',
            effort: 4,
            quality: options.blurQuality,
        },
    )

    return {
        blur: {bytes: blurBytes, height: blurHeight, width: blurWidth},
        preview: {bytes: previewBytes, height: previewHeight, width: previewWidth},
    }
}
