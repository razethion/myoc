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

/**
 * Read the tone reproduction curve from an ICC profile so the transfer
 * characteristics match the primaries (e.g. DCI-P3 vs Display P3).
 *
 * @param {Buffer} icc
 */
function iccTransfer(icc) {
    try {
        const tags = iccTags(icc)
        const tag = tags.rTRC ?? tags.gTRC ?? tags.bTRC
        if (!tag) return {gamma: null, kind: 'unknown'}
        const offset = tag.offset
        const type = icc.toString('latin1', offset, offset + 4)
        if (type === 'para') {
            const fn = icc.readUInt16BE(offset + 8)
            if (fn === 3 || fn === 4) return {gamma: null, kind: 'srgb'}
            return {gamma: icc.readInt32BE(offset + 12) / 65536, kind: 'gamma'}
        }
        if (type === 'curv') {
            const count = icc.readUInt32BE(offset + 8)
            if (count === 0) return {gamma: 1, kind: 'linear'}
            if (count === 1) {
                const gamma = icc.readUInt16BE(offset + 12) / 256
                return Math.abs(gamma - 1) < 0.05 ? {gamma: 1, kind: 'linear'} : {gamma, kind: 'gamma'}
            }
            return {gamma: null, kind: 'sampled'}
        }
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

const SRGB_FALLBACK = {primaries: 1, transfer: 13, matrix: 0, fullRange: true, keepIcc: false}

function nearGamma(trc, value) {
    return trc.kind === 'gamma' && trc.gamma !== null && Math.abs(trc.gamma - value) < 0.15
}

function transferCode(trc, fallback) {
    if (trc.kind === 'srgb') return 13
    if (trc.kind === 'linear') return 8
    if (nearGamma(trc, 2.2)) return 4
    // CICP has no gamma-2.6 transfer code. Mark the transfer unspecified and
    // leave the ICC profile authoritative instead of claiming sRGB.
    if (nearGamma(trc, 2.6)) return 2
    return fallback
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
        transfer: transferCode(trc, match.transfer),
        matrix: 0,
        fullRange: true,
        keepIcc: true,
    }
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

function skipExtents(offset, count, offsetSize, lengthSize, indexSize) {
    let p = offset
    for (let j = 0; j < count; j++) {
        p += indexSize + offsetSize + lengthSize
    }
    return p
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
        p += itemIdSize + (version >= 1 ? 2 : 0) + 2
        if (baseOffsetSize > 0) {
            writeUInt(buf, p, readUInt(buf, p, baseOffsetSize) + delta, baseOffsetSize)
            p += baseOffsetSize
        }
        const extentCount = buf.readUInt16BE(p)
        p += 2
        p = skipExtents(p, extentCount, offsetSize, lengthSize, indexSize)
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
    const target = entries.find((entry) => entry.itemId === primaryId) ?? entries[0]
    target.associations.push(newIndex)
    return writeIpma(version, flags, associationSize, entries)
}

function countProperties(buf, ipco) {
    let count = 0
    let offset = ipco.off + ipco.header
    while (offset + 8 <= ipco.off + ipco.size) {
        let size = buf.readUInt32BE(offset)
        if (size === 1) size = Number(buf.readBigUInt64BE(offset + 8))
        else if (size === 0) size = ipco.off + ipco.size - offset
        count += 1
        offset += size
    }
    return count
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
    const newIprp = rebuildIprp(buf, ipco, ipma, countProperties(buf, ipco) + 1, primaryId, nclx)
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
function readColorProperties(buf, ipco) {
    let icc = null
    let hasNclx = false
    let offset = ipco.off + ipco.header
    while (offset + 8 <= ipco.off + ipco.size) {
        let size = buf.readUInt32BE(offset)
        if (size === 1) size = Number(buf.readBigUInt64BE(offset + 8))
        else if (size === 0) size = ipco.off + ipco.size - offset
        if (buf.toString('latin1', offset + 4, offset + 8) === 'colr') {
            const colorType = buf.toString('latin1', offset + 8, offset + 12)
            if (colorType === 'nclx') hasNclx = true
            else if (colorType === 'prof' || colorType === 'rICC') icc = buf.subarray(offset + 12, offset + size)
        }
        offset += size
    }
    return {icc, hasNclx}
}

function unchanged(buf, reason) {
    return {bytes: buf, changed: false, reason}
}

export function repairAvifColor(buf) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return unchanged(buf, 'not-avif')

    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    const ipco = iprp && findBox(buf, iprp.off + iprp.header, iprp.off + iprp.size, 'ipco')
    if (!ipco) return unchanged(buf, 'no-properties')

    const {icc, hasNclx} = readColorProperties(buf, ipco)
    if (hasNclx) return unchanged(buf, 'already-declared')
    if (!icc) return unchanged(buf, 'no-profile')

    const cicp = resolveCicp(icc)
    if (!cicp.keepIcc) return unchanged(buf, 'unsupported-profile')

    const out = addNclx(buf, cicp)
    if (out === buf) return unchanged(buf, 'unsupported-layout')
    return {bytes: out, changed: true, reason: 'repaired', cicp}
}
