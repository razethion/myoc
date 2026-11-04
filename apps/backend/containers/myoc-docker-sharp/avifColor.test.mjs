import assert from 'node:assert/strict'
import {unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import {addNclx, repairAvifColor, resolveCicp} from './avifColor.mjs'

function findBox(buf, start, end, type) {
    let off = start
    while (off + 8 <= end) {
        const size = buf.readUInt32BE(off)
        const boxType = buf.toString('latin1', off + 4, off + 8)
        if (boxType === type) return {off, size}
        off += size
    }
    return null
}

function colorBoxes(buf) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return []
    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    if (!iprp) return []
    const ipco = findBox(buf, iprp.off + 8, iprp.off + iprp.size, 'ipco')
    if (!ipco) return []
    const boxes = []
    let off = ipco.off + 8
    while (off + 8 <= ipco.off + ipco.size) {
        const size = buf.readUInt32BE(off)
        if (buf.toString('latin1', off + 4, off + 8) === 'colr') {
            boxes.push({
                type: buf.toString('latin1', off + 8, off + 12),
                primaries: buf.readUInt16BE(off + 12),
                transfer: buf.readUInt16BE(off + 14),
            })
        }
        off += size
    }
    return boxes
}

function findNclx(buf) {
    return colorBoxes(buf).find((box) => box.type === 'nclx') ?? null
}

/**
 * Build a minimal ICC v2 RGB profile from D50-adapted colorants and a gamma curve.
 *
 * @param {{colorants: {r: number[], g: number[], b: number[]}, gamma: number}} options
 */
function makeIcc({colorants, gamma}) {
    const xyzTag = (values) => {
        const buffer = Buffer.alloc(20)
        buffer.write('XYZ ', 0, 'latin1')
        buffer.writeInt32BE(Math.round(values[0] * 65536), 8)
        buffer.writeInt32BE(Math.round(values[1] * 65536), 12)
        buffer.writeInt32BE(Math.round(values[2] * 65536), 16)
        return buffer
    }
    const curvTag = (value) => {
        const buffer = Buffer.alloc(14)
        buffer.write('curv', 0, 'latin1')
        buffer.writeUInt32BE(1, 8)
        buffer.writeUInt16BE(Math.round(value * 256), 12)
        return buffer
    }
    const descriptionText = 'Test profile'
    const description = Buffer.alloc(4 + 4 + 4 + descriptionText.length + 1 + 4 + 4 + 4 + 67)
    description.write('desc', 0, 'latin1')
    description.writeUInt32BE(descriptionText.length + 1, 8)
    description.write(descriptionText, 12, 'latin1')
    const copyrightText = 'Public domain'
    const copyright = Buffer.alloc(4 + 4 + copyrightText.length + 1)
    copyright.write('text', 0, 'latin1')
    copyright.write(copyrightText, 8, 'latin1')
    const tagDefs = [
        ['desc', description],
        ['cprt', copyright],
        ['wtpt', xyzTag([0.9642, 1.0, 0.8249])],
        ['rXYZ', xyzTag(colorants.r)],
        ['gXYZ', xyzTag(colorants.g)],
        ['bXYZ', xyzTag(colorants.b)],
        ['rTRC', curvTag(gamma)],
        ['gTRC', curvTag(gamma)],
        ['bTRC', curvTag(gamma)],
    ]
    const tagCount = tagDefs.length
    let cursor = 128 + 4 + tagCount * 12
    const size = cursor + tagDefs.reduce((sum, [, buffer]) => sum + buffer.length, 0)
    const profile = Buffer.alloc(size)
    profile.writeUInt32BE(size, 0)
    profile.writeUInt32BE(0x02100000, 8)
    profile.write('mntr', 12, 'latin1')
    profile.write('RGB ', 16, 'latin1')
    profile.write('XYZ ', 20, 'latin1')
    profile.write('acsp', 36, 'latin1')
    profile.writeUInt32BE(0, 64)
    profile.writeInt32BE(Math.round(0.9642 * 65536), 68)
    profile.writeInt32BE(65536, 72)
    profile.writeInt32BE(Math.round(0.8249 * 65536), 76)
    profile.writeUInt32BE(tagCount, 128)
    let tableOffset = 132
    for (const [signature, buffer] of tagDefs) {
        profile.write(signature, tableOffset, 'latin1')
        profile.writeUInt32BE(cursor, tableOffset + 4)
        profile.writeUInt32BE(buffer.length, tableOffset + 8)
        buffer.copy(profile, cursor)
        cursor += buffer.length
        tableOffset += 12
    }
    return profile
}

async function avifFromNamedProfile(name) {
    const source = await sharp({
        create: {background: {b: 32, g: 64, r: 255}, channels: 3, height: 80, width: 100},
    })
        .withIccProfile(name)
        .png()
        .toBuffer()

    return await sharp(source).keepIccProfile().avif({chromaSubsampling: '4:4:4', effort: 4, quality: 60}).toBuffer()
}

async function avifFromProfile(profile) {
    const path = join(tmpdir(), `myoc-repair-icc-${process.pid}-${Math.random().toString(16).slice(2)}.icc`)
    writeFileSync(path, profile)
    try {
        const source = await sharp({
            create: {background: {b: 32, g: 64, r: 255}, channels: 3, height: 80, width: 100},
        })
            .withIccProfile(path)
            .png()
            .toBuffer()

        return await sharp(source).keepIccProfile().avif({chromaSubsampling: '4:4:4', effort: 4, quality: 60}).toBuffer()
    } finally {
        unlinkSync(path)
    }
}

const P3_COLORANTS = {
    r: [0.5151214599609375, 0.2411956787109375, 0],
    g: [0.2919769287109375, 0.6922454833984375, 0.0418243408203125],
    b: [0.1571044921875, 0.066558837890625, 0.7830810546875],
}

const NON_CICP_COLORANTS = {
    r: [0.7, 0.2, 0.1],
    g: [0.1, 0.8, 0.1],
    b: [0.1, 0.1, 0.7],
}

test('repairs a Display P3 AVIF that has an ICC profile but no CICP box', async () => {
    const source = await avifFromNamedProfile('p3')
    assert.equal(findNclx(source), null)

    const result = repairAvifColor(source)

    assert.equal(result.changed, true)
    assert.equal(result.reason, 'repaired')
    const nclx = findNclx(result.bytes)
    assert.equal(nclx.primaries, 12)
    assert.equal(nclx.transfer, 13)
    assert.ok(colorBoxes(result.bytes).some((box) => box.type === 'prof' || box.type === 'rICC'))
})

test('repairs a DCI-P3 AVIF with the DCI transfer characteristic', async () => {
    const profile = makeIcc({colorants: P3_COLORANTS, gamma: 2.6})
    const source = await avifFromProfile(profile)

    const result = repairAvifColor(source)

    assert.equal(result.changed, true)
    const nclx = findNclx(result.bytes)
    assert.equal(nclx.primaries, 11)
    assert.equal(nclx.transfer, 2)
})

test('repairs an sRGB AVIF by declaring primaries 1', async () => {
    const source = await avifFromNamedProfile('srgb')

    const result = repairAvifColor(source)

    assert.equal(result.changed, true)
    const nclx = findNclx(result.bytes)
    assert.equal(nclx.primaries, 1)
    assert.equal(nclx.transfer, 13)
})

function mdatPayload(buf) {
    const box = findBox(buf, 0, buf.length, 'mdat')
    return box ? buf.subarray(box.off + 8, box.off + box.size) : null
}

test('does not touch the compressed pixels when repairing', async () => {
    const source = await avifFromNamedProfile('p3')

    const result = repairAvifColor(source)

    assert.equal(result.changed, true)
    assert.ok(mdatPayload(source))
    assert.deepEqual(mdatPayload(result.bytes), mdatPayload(source))
})

test('leaves an AVIF with no ICC profile alone', async () => {
    const source = await sharp({
        create: {background: {b: 32, g: 64, r: 255}, channels: 3, height: 80, width: 100},
    })
        .avif({chromaSubsampling: '4:4:4', effort: 4, quality: 60})
        .toBuffer()

    const result = repairAvifColor(source)

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'no-profile')
    assert.deepEqual(result.bytes, source)
})

test('is idempotent once the CICP box exists', async () => {
    const source = await avifFromNamedProfile('p3')
    const repaired = addNclx(
        source,
        resolveCicp(
            await sharp(source)
                .metadata()
                .then((metadata) => metadata.icc),
        ),
    )

    const result = repairAvifColor(repaired)

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'already-declared')
    assert.deepEqual(result.bytes, repaired)
})

test('reports a profile whose primaries have no CICP code', async () => {
    const profile = makeIcc({colorants: NON_CICP_COLORANTS, gamma: 2.2})
    const source = await avifFromProfile(profile)
    assert.ok(colorBoxes(source).some((box) => box.type === 'prof' || box.type === 'rICC'))

    const result = repairAvifColor(source)

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'unsupported-profile')
    assert.deepEqual(result.bytes, source)
})

test('reports non-AVIF input', () => {
    const result = repairAvifColor(Buffer.from('not an avif'))

    assert.equal(result.changed, false)
    assert.equal(result.reason, 'not-avif')
})
