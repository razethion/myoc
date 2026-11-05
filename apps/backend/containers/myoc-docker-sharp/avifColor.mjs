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

// D50-adapted colorants for the other CICP-representable spaces.
const REC2020_PRIMARIES = {
    r: [0.673459, 0.279033, -0.001931],
    g: [0.165661, 0.675338, 0.029979],
    b: [0.1251, 0.045629, 0.797162],
}

const BT601_525_PRIMARIES = {
    r: [0.416279, 0.22167, 0.013652],
    g: [0.393183, 0.703274, 0.091349],
    b: [0.154758, 0.075056, 0.720209],
}

const BT601_625_PRIMARIES = {
    r: [0.455232, 0.232277, 0.01454],
    g: [0.367584, 0.707814, 0.104902],
    b: [0.141403, 0.059909, 0.705769],
}

const BT470M_PRIMARIES = {
    r: [0.634444, 0.310993, -0.001183],
    g: [0.185125, 0.591482, 0.055516],
    b: [0.144651, 0.097525, 0.770878],
}

const PRIMARIES_SPACES = [
    {name: 'srgb', primaries: 1, transfer: 13, xyz: SRGB_PRIMARIES},
    {name: 'display-p3', primaries: 12, transfer: 13, xyz: P3_PRIMARIES},
    {name: 'rec2020', primaries: 9, transfer: 14, xyz: REC2020_PRIMARIES},
    {name: 'bt601-525', primaries: 6, transfer: 6, xyz: BT601_525_PRIMARIES},
    {name: 'bt601-625', primaries: 5, transfer: 5, xyz: BT601_625_PRIMARIES},
    {name: 'bt470m', primaries: 4, transfer: 4, xyz: BT470M_PRIMARIES},
]

function iccTags(icc) {
    const tagCount = icc.readUInt32BE(128)
    const tags = {}
    for (let i = 0; i < tagCount; i++) {
        const off = 132 + i * 12
        tags[icc.toString('latin1', off, off + 4)] = {offset: icc.readUInt32BE(off + 4)}
    }
    return tags
}

/**
 * Read the rXYZ/gXYZ/bXYZ colorants from an ICC profile.
 *
 * @param {Buffer} icc
 */
function iccPrimaries(icc) {
    try {
        const tags = iccTags(icc)
        const xyz = (signature) => {
            const tag = tags[signature]
            if (!tag) return null
            const base = tag.offset + 8
            return [icc.readInt32BE(base) / 65536, icc.readInt32BE(base + 4) / 65536, icc.readInt32BE(base + 8) / 65536]
        }
        return {r: xyz('rXYZ'), g: xyz('gXYZ'), b: xyz('bXYZ')}
    } catch {
        return null
    }
}

const SRGB_PARA = {g: 2.4, a: 0.9478673, b: 0.0521327, c: 0.0773994, d: 0.04045}
const REC2020_PARA = {g: 0.45, a: 1.0992968, b: 0, c: 4.5, d: 0.018054, e: -0.0992968, f: 0}

function near(value, expected, tolerance = 0.002) {
    return Math.abs(value - expected) <= tolerance
}

function paraCurve(icc, offset) {
    const fn = icc.readUInt16BE(offset + 8)
    const param = (index) => icc.readInt32BE(offset + 12 + index * 4) / 65536
    if (fn === 0) {
        const gamma = param(0)
        return Math.abs(gamma - 1) < 0.05 ? {gamma: 1, kind: 'linear'} : {gamma, kind: 'gamma'}
    }
    if (fn === 1 || fn === 2) return {gamma: param(0), kind: 'gamma'}
    if (fn !== 3 && fn !== 4) return {gamma: null, kind: 'unknown'}
    const g = param(0)
    const a = param(1)
    const b = param(2)
    const c = param(3)
    const d = param(4)
    const isSrgb = near(g, SRGB_PARA.g) && near(a, SRGB_PARA.a) && near(b, SRGB_PARA.b) && near(c, SRGB_PARA.c) && near(d, SRGB_PARA.d)
    if (isSrgb) return {gamma: null, kind: 'srgb'}
    if (fn === 4) {
        const e = param(5)
        const f = param(6)
        const isRec2020 =
            near(g, REC2020_PARA.g) &&
            near(a, REC2020_PARA.a) &&
            near(b, REC2020_PARA.b) &&
            near(c, REC2020_PARA.c) &&
            near(d, REC2020_PARA.d) &&
            near(e, REC2020_PARA.e) &&
            near(f, REC2020_PARA.f)
        if (isRec2020) return {gamma: null, kind: 'rec2020'}
    }
    return {gamma: g, kind: 'gamma'}
}

function curvCurve(icc, offset) {
    const count = icc.readUInt32BE(offset + 8)
    if (count === 0) return {gamma: 1, kind: 'linear'}
    if (count !== 1) return {gamma: null, kind: 'sampled'}
    const gamma = icc.readUInt16BE(offset + 12) / 256
    return Math.abs(gamma - 1) < 0.05 ? {gamma: 1, kind: 'linear'} : {gamma, kind: 'gamma'}
}

/**
 * Read the tone reproduction curve from an ICC profile. Parametric curves are
 * matched against the sRGB coefficients rather than trusting function type 3/4
 * alone, which also describes other curves such as Rec.2020.
 *
 * @param {Buffer} icc
 */
function iccTransfer(icc) {
    try {
        const tags = iccTags(icc)
        const tag = tags.rTRC ?? tags.gTRC ?? tags.bTRC
        if (!tag) return {gamma: null, kind: 'unknown'}
        const type = icc.toString('latin1', tag.offset, tag.offset + 4)
        if (type === 'para') return paraCurve(icc, tag.offset)
        if (type === 'curv') return curvCurve(icc, tag.offset)
        return {gamma: null, kind: 'unknown'}
    } catch {
        return {gamma: null, kind: 'unknown'}
    }
}

function primariesDistance(actual, expected) {
    if (!actual) return Number.POSITIVE_INFINITY
    let distance = 0
    for (const channel of ['r', 'g', 'b']) {
        const values = actual[channel]
        if (!values) return Number.POSITIVE_INFINITY
        for (let i = 0; i < 3; i++) {
            distance = Math.max(distance, Math.abs(values[i] - expected[channel][i]))
        }
    }
    return distance
}

const SRGB_FALLBACK = {primaries: 1, transfer: 13, matrix: 6, fullRange: true, keepIcc: false}

function nearGamma(trc, value) {
    return trc.kind === 'gamma' && trc.gamma !== null && Math.abs(trc.gamma - value) < 0.15
}

function transferCode(trc) {
    if (trc.kind === 'srgb') return 13
    if (trc.kind === 'rec2020') return 14
    if (trc.kind === 'linear') return 8
    if (nearGamma(trc, 2.2)) return 4
    // CICP has no gamma-2.6 code, and sampled or unknown curves cannot be named
    // safely. Mark the transfer unspecified and leave the ICC authoritative.
    return 2
}

function bestPrimariesMatch(primaries) {
    let best = null
    let bestDistance = Number.POSITIVE_INFINITY
    for (const space of PRIMARIES_SPACES) {
        const distance = primariesDistance(primaries, space.xyz)
        if (distance < bestDistance) {
            best = space
            bestDistance = distance
        }
    }
    return bestDistance <= 0.01 ? best : null
}

/**
 * Map a source ICC profile to CICP values so the AVIF declares its real color space.
 * Display P3, Rec.2020 and the BT.601/BT.470 spaces are preserved; unknown
 * profiles (Adobe RGB, ProPhoto, Apple RGB) fall back to sRGB conversion.
 *
 * CICP primaries 11 (DCI-P3) and 12 (Display P3) share chromaticities but not
 * white points, so the transfer curve alone cannot identify DCI-P3. The
 * colorants match Display P3, and a gamma-2.6 curve is declared as unspecified
 * transfer rather than claiming the DCI white point.
 *
 * @param {Buffer | undefined} icc
 */
export function resolveCicp(icc) {
    if (!icc) return SRGB_FALLBACK
    const match = bestPrimariesMatch(iccPrimaries(icc))
    if (!match) return SRGB_FALLBACK
    const trc = iccTransfer(icc)
    return {
        primaries: match.primaries,
        transfer: transferCode(trc),
        matrix: 6,
        fullRange: true,
        keepIcc: true,
    }
}

function readBox(buf, off, end) {
    if (off + 8 > end) return null
    let size = buf.readUInt32BE(off)
    const type = buf.toString('latin1', off + 4, off + 8)
    let header = 8
    if (size === 1) {
        if (off + 16 > end) return null
        size = Number(buf.readBigUInt64BE(off + 8))
        header = 16
    } else if (size === 0) {
        size = end - off
    }
    if (size < header || size > end - off) return null
    return {off, size, header, type}
}

function findBox(buf, start, end, type) {
    let off = start
    while (off + 8 <= end) {
        const box = readBox(buf, off, end)
        if (!box) return null
        if (box.type === type) return box
        off += box.size
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
    const wide = version === 2
    const itemIdSize = wide ? 4 : 2
    let p = ilocOff + 12
    const offsetSize = buf[p] >> 4
    const lengthSize = buf[p] & 0x0f
    p += 1
    const baseOffsetSize = buf[p] >> 4
    const indexSize = version >= 1 ? buf[p] & 0x0f : 0
    p += 1
    const itemCount = wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p)
    p += itemIdSize
    for (let i = 0; i < itemCount; i++) {
        p += itemIdSize
        let method = 0
        if (version >= 1) {
            method = buf[p] >> 4
            p += 2
        }
        p += 2 // data_reference_index
        if (baseOffsetSize > 0) {
            writeUInt(buf, p, readUInt(buf, p, baseOffsetSize) + delta, baseOffsetSize)
            p += baseOffsetSize
        }
        const extentCount = buf.readUInt16BE(p)
        p += 2
        for (let j = 0; j < extentCount; j++) {
            p += indexSize
            // base_offset_size == 0 stores absolute file offsets, so shift them too.
            if (baseOffsetSize === 0 && method === 0) {
                writeUInt(buf, p, readUInt(buf, p, offsetSize) + delta, offsetSize)
            }
            p += offsetSize + lengthSize
        }
    }
}

function readAssociations(buf, offset, count, size) {
    const associations = []
    let p = offset
    for (let j = 0; j < count; j++) {
        associations.push(size === 2 ? buf.readUInt16BE(p) : buf[p])
        p += size
    }
    return {associations, next: p}
}

function readIpmaEntries(buf, ipma, version, associationSize) {
    const entryCount = buf.readUInt32BE(ipma.off + 12)
    const itemIdSize = version === 0 ? 2 : 4
    let p = ipma.off + 16
    const entries = []
    for (let i = 0; i < entryCount; i++) {
        const itemId = version === 0 ? buf.readUInt16BE(p) : buf.readUInt32BE(p)
        p += itemIdSize
        const count = buf[p]
        p += 1
        const read = readAssociations(buf, p, count, associationSize)
        entries.push({itemId, associations: read.associations})
        p = read.next
    }
    return entries
}

function writeIpma(version, flags, associationSize, entries) {
    const header = Buffer.alloc(16)
    header.write('ipma', 4, 'latin1')
    header.writeUInt8(version, 8)
    header.writeUIntBE(flags, 9, 3)
    header.writeUInt32BE(entries.length, 12)
    const parts = [header]
    for (const entry of entries) {
        const itemIdSize = version === 0 ? 2 : 4
        const body = Buffer.alloc(itemIdSize + 1 + entry.associations.length * associationSize)
        if (version === 0) body.writeUInt16BE(entry.itemId, 0)
        else body.writeUInt32BE(entry.itemId, 0)
        body.writeUInt8(entry.associations.length, itemIdSize)
        let q = itemIdSize + 1
        for (const association of entry.associations) {
            if (associationSize === 2) body.writeUInt16BE(association, q)
            else body.writeUInt8(association, q)
            q += associationSize
        }
        parts.push(body)
    }
    const result = Buffer.concat(parts)
    result.writeUInt32BE(result.length, 0)
    return result
}

function addAssociation(buf, ipma, newIndex, primaryId) {
    const version = buf[ipma.off + 8]
    const flags = buf.readUIntBE(ipma.off + 9, 3)
    const associationSize = flags & 1 ? 2 : 1
    const entries = readIpmaEntries(buf, ipma, version, associationSize)
    const target = entries.find((entry) => entry.itemId === primaryId)
    if (!target) return null
    target.associations.push(newIndex)
    return writeIpma(version, flags, associationSize, entries)
}

function readIpcoChildren(buf, ipco) {
    const children = []
    let offset = ipco.off + ipco.header
    while (offset + 8 <= ipco.off + ipco.size) {
        const box = readBox(buf, offset, ipco.off + ipco.size)
        if (!box) return null
        children.push(box)
        offset += box.size
    }
    return children
}

function countProperties(buf, ipco) {
    const children = readIpcoChildren(buf, ipco)
    return children ? children.length : -1
}

function buildNclx(cicp) {
    const nclx = Buffer.alloc(19)
    nclx.writeUInt32BE(19, 0)
    nclx.write('colr', 4, 'latin1')
    nclx.write('nclx', 8, 'latin1')
    nclx.writeUInt16BE(cicp.primaries, 12)
    nclx.writeUInt16BE(cicp.transfer, 14)
    nclx.writeUInt16BE(cicp.matrix, 16)
    nclx.writeUInt8(cicp.fullRange ? 0x80 : 0, 18)
    return nclx
}

function rebuildIprp(buf, ipco, ipma, newIndex, primaryId, nclx) {
    const children = buf.subarray(ipco.off + ipco.header, ipco.off + ipco.size)
    const newIpco = Buffer.alloc(ipco.header + children.length + nclx.length)
    if (ipco.header === 16) {
        newIpco.writeUInt32BE(1, 0)
        newIpco.writeBigUInt64BE(BigInt(newIpco.length), 8)
    } else {
        newIpco.writeUInt32BE(newIpco.length, 0)
    }
    newIpco.write('ipco', 4, 'latin1')
    children.copy(newIpco, ipco.header)
    nclx.copy(newIpco, ipco.header + children.length)
    const newIpma = addAssociation(buf, ipma, newIndex, primaryId)
    if (!newIpma) return null
    const newIprp = Buffer.alloc(8 + newIpco.length + newIpma.length)
    newIprp.writeUInt32BE(newIprp.length, 0)
    newIprp.write('iprp', 4, 'latin1')
    newIpco.copy(newIprp, 8)
    newIpma.copy(newIprp, 8 + newIpco.length)
    return newIprp
}

function rebuildMeta(buf, meta, iprp, newIprp) {
    const before = buf.subarray(meta.off + 12, iprp.off)
    const after = buf.subarray(iprp.off + iprp.size, meta.off + meta.size)
    const newMeta = Buffer.alloc(meta.size + (newIprp.length - iprp.size))
    newMeta.writeUInt32BE(newMeta.length, 0)
    newMeta.write('meta', 4, 'latin1')
    buf.copy(newMeta, 8, meta.off + 8, meta.off + 12)
    before.copy(newMeta, 12)
    newIprp.copy(newMeta, 12 + before.length)
    after.copy(newMeta, 12 + before.length + newIprp.length)
    return newMeta
}

/**
 * Add an nclx (CICP) color box to an AVIF so browsers interpret the pixels in the
 * declared color space instead of falling back to sRGB.
 *
 * @param {Buffer} buf
 * @param {{primaries: number, transfer: number, matrix: number, fullRange: boolean}} cicp
 */
export function addNclx(buf, cicp) {
    try {
        return addNclxUnsafe(buf, cicp)
    } catch {
        return buf
    }
}

function addNclxUnsafe(buf, cicp) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return buf
    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    const ipco = iprp && findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipco')
    const ipma = iprp && findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipma')
    const pitm = findBox(buf, meta.off + 12, meta.off + meta.size, 'pitm')
    const iloc = findBox(buf, meta.off + 12, meta.off + meta.size, 'iloc')
    if (!ipco || !ipma || !pitm || !iloc) return buf
    const primaryId = buf[pitm.off + 8] === 0 ? buf.readUInt16BE(pitm.off + 12) : buf.readUInt32BE(pitm.off + 12)
    const nclx = buildNclx(cicp)
    const propertyCount = countProperties(buf, ipco)
    if (propertyCount < 0) return buf
    const newIprp = rebuildIprp(buf, ipco, ipma, propertyCount + 1, primaryId, nclx)
    if (!newIprp) return buf
    const newMeta = rebuildMeta(buf, meta, iprp, newIprp)
    const out = Buffer.concat([buf.subarray(0, meta.off), newMeta, buf.subarray(meta.off + meta.size)])
    const newIloc = findBox(out, meta.off + 12, meta.off + newMeta.length, 'iloc')
    if (newIloc) adjustIlocBaseOffset(out, newIloc.off, newMeta.length - meta.size)
    return out
}

/**
 * Repair the color declaration of an existing AVIF in place.
 *
 * The pixels are not touched. If the file already carries a CICP box it is left
 * alone. If it carries an ICC profile whose colorants map to a CICP primaries
 * code, an nclx box is added next to the profile. Profiles without a CICP code
 * (Adobe RGB, ProPhoto, Apple RGB) are reported and left unchanged.
 *
 * @param {Buffer} buf
 * @returns {{bytes: Buffer, changed: boolean, reason: string, cicp?: {primaries: number, transfer: number, matrix: number, fullRange: boolean}}}
 */
function readColorProperties(buf, ipco, ipma, primaryId) {
    const children = readIpcoChildren(buf, ipco)
    if (!children) return {icc: null, hasNclx: false, malformed: true}
    const version = buf[ipma.off + 8]
    const flags = buf.readUIntBE(ipma.off + 9, 3)
    const associationSize = flags & 1 ? 2 : 1
    const entries = readIpmaEntries(buf, ipma, version, associationSize)
    const entry = entries.find((item) => item.itemId === primaryId)
    if (!entry) return {icc: null, hasNclx: false, unsupported: true}
    let icc = null
    let hasNclx = false
    for (const association of entry.associations) {
        const index = associationSize === 2 ? association & 0x7fff : association & 0x7f
        const child = children[index - 1]
        if (child?.type !== 'colr') continue
        const colorType = buf.toString('latin1', child.off + 8, child.off + 12)
        if (colorType === 'nclx') hasNclx = true
        else if (colorType === 'prof' || colorType === 'rICC') icc = buf.subarray(child.off + 12, child.off + child.size)
    }
    return {icc, hasNclx}
}

function readIlocInfo(buf, meta) {
    const iloc = findBox(buf, meta.off + 12, meta.off + meta.size, 'iloc')
    if (!iloc) return null
    const version = buf[iloc.off + 8]
    const wide = version === 2
    const itemIdSize = wide ? 4 : 2
    let p = iloc.off + 12
    const offsetSize = buf[p] >> 4
    const lengthSize = buf[p] & 0x0f
    p += 1
    const baseOffsetSize = buf[p] >> 4
    const indexSize = version >= 1 ? buf[p] & 0x0f : 0
    p += 1
    const itemCount = wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p)
    p += itemIdSize
    const items = []
    for (let i = 0; i < itemCount; i++) {
        const itemId = wide ? buf.readUInt32BE(p) : buf.readUInt16BE(p)
        p += itemIdSize
        let method = 0
        if (version >= 1) {
            method = buf[p] >> 4
            p += 2
        }
        p += 2 // data_reference_index
        let base = 0
        if (baseOffsetSize > 0) {
            base = readUInt(buf, p, baseOffsetSize)
            p += baseOffsetSize
        }
        const extentCount = buf.readUInt16BE(p)
        p += 2
        const extents = []
        for (let j = 0; j < extentCount; j++) {
            p += indexSize
            const extentOffset = readUInt(buf, p, offsetSize)
            p += offsetSize
            const extentLength = readUInt(buf, p, lengthSize)
            p += lengthSize
            extents.push({offset: base + extentOffset, length: extentLength})
        }
        items.push({itemId, method, extents})
    }
    return {items, itemCount}
}

function readPrimaryPayload(buf, meta, primaryId) {
    const info = readIlocInfo(buf, meta)
    if (!info) return null
    const item = info.items.find((entry) => entry.itemId === primaryId)
    if (item?.method !== 0 || item.extents.length === 0) return null
    const parts = []
    for (const extent of item.extents) {
        if (extent.offset + extent.length > buf.length) return null
        parts.push(buf.subarray(extent.offset, extent.offset + extent.length))
    }
    return Buffer.concat(parts)
}

class BitReader {
    constructor(buf) {
        this.buf = buf
        this.pos = 0
    }

    bit() {
        if (this.pos >= this.buf.length * 8) throw new Error('bitstream exhausted')
        const value = (this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1
        this.pos += 1
        return value
    }

    bits(count) {
        let value = 0
        for (let i = 0; i < count; i++) value = (value << 1) | this.bit()
        return value
    }
}

function readLeb128(buf, p) {
    let size = 0
    let shift = 0
    while (true) {
        if (p >= buf.length) return null
        const byte = buf[p++]
        size |= (byte & 0x7f) << shift
        if (!(byte & 0x80)) break
        shift += 7
    }
    return {size, next: p}
}

function parseObus(buf) {
    let p = 0
    const obus = []
    while (p < buf.length) {
        const header = buf[p++]
        const type = (header >> 3) & 0x0f
        const extension = (header >> 2) & 1
        const hasSize = (header >> 1) & 1
        if (extension) p += 1
        let size
        if (hasSize) {
            const leb = readLeb128(buf, p)
            if (!leb) return null
            size = leb.size
            p = leb.next
        } else {
            size = buf.length - p
        }
        if (size < 0 || p + size > buf.length) return null
        obus.push({type, payload: buf.subarray(p, p + size)})
        p += size
    }
    return obus
}

function readAv1ColorConfig(payload) {
    const obus = parseObus(payload)
    if (!obus) return null
    const sequence = obus.find((obu) => obu.type === 1)
    if (!sequence) return null
    const reader = new BitReader(sequence.payload)
    const seqProfile = reader.bits(3)
    reader.bit() // still_picture
    const reduced = reader.bit()
    if (!reduced) return null
    reader.bits(5) // seq_level_idx
    const widthBits = reader.bits(4)
    const heightBits = reader.bits(4)
    reader.bits(widthBits + 1)
    reader.bits(heightBits + 1)
    reader.bit() // use_128x128_superblock
    reader.bit() // enable_filter_intra
    reader.bit() // enable_intra_edge_filter
    reader.bit() // enable_superres
    reader.bit() // enable_cdef
    reader.bit() // enable_restoration
    const highBitdepth = reader.bit()
    if (seqProfile === 2 && highBitdepth) reader.bit() // twelve_bit
    const monochrome = seqProfile !== 1 ? reader.bit() : 0
    const descriptionPresent = reader.bit()
    let colorPrimaries = 2
    let transferCharacteristics = 2
    let matrixCoefficients = 2
    if (descriptionPresent) {
        colorPrimaries = reader.bits(8)
        transferCharacteristics = reader.bits(8)
        matrixCoefficients = reader.bits(8)
    }
    let fullRange
    if (monochrome) fullRange = reader.bit() === 1
    else if (colorPrimaries === 1 && transferCharacteristics === 13 && matrixCoefficients === 0) fullRange = true
    else fullRange = reader.bit() === 1
    return {matrix: matrixCoefficients, fullRange}
}

function unchanged(buf, reason) {
    return {bytes: buf, changed: false, reason}
}

export function repairAvifColor(buf) {
    try {
        return repairAvifColorUnsafe(buf)
    } catch {
        return unchanged(buf, 'unsupported-layout')
    }
}

function repairAvifColorUnsafe(buf) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return unchanged(buf, 'not-avif')

    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    const ipco = iprp && findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipco')
    const ipma = iprp && findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipma')
    const pitm = findBox(buf, meta.off + 12, meta.off + meta.size, 'pitm')
    if (!ipco || !ipma || !pitm) return unchanged(buf, 'unsupported-layout')

    const primaryId = buf[pitm.off + 8] === 0 ? buf.readUInt16BE(pitm.off + 12) : buf.readUInt32BE(pitm.off + 12)
    const properties = readColorProperties(buf, ipco, ipma, primaryId)
    if (properties.malformed || properties.unsupported) return unchanged(buf, 'unsupported-layout')
    if (properties.hasNclx) return unchanged(buf, 'already-declared')
    if (!properties.icc) return unchanged(buf, 'no-profile')

    const payload = readPrimaryPayload(buf, meta, primaryId)
    if (!payload) return unchanged(buf, 'unsupported-layout')
    const av1 = readAv1ColorConfig(payload)
    if (!av1) return unchanged(buf, 'unsupported-layout')

    const cicp = resolveCicp(properties.icc)
    if (!cicp.keepIcc) return unchanged(buf, 'unsupported-profile')
    const declared = {...cicp, matrix: av1.matrix, fullRange: av1.fullRange}

    const out = addNclx(buf, declared)
    if (out === buf) return unchanged(buf, 'unsupported-layout')
    return {bytes: out, changed: true, reason: 'repaired', cicp: declared}
}
