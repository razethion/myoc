import assert from 'node:assert/strict'
import {unlinkSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import {createAvifBlur, createAvifPreview, createGalleryAvifOutputs, createSquareAvif} from './preview.mjs'

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

function findNclx(buf) {
    const meta = findBox(buf, 0, buf.length, 'meta')
    if (!meta) return null
    const iprp = findBox(buf, meta.off + 12, meta.off + meta.size, 'iprp')
    if (!iprp) return null
    const ipco = findBox(buf, iprp.off + 8, iprp.off + iprp.size, 'ipco')
    if (!ipco) return null
    let off = ipco.off + 8
    while (off + 8 <= ipco.off + ipco.size) {
        const size = buf.readUInt32BE(off)
        const boxType = buf.toString('latin1', off + 4, off + 8)
        if (boxType === 'colr' && buf.toString('latin1', off + 8, off + 12) === 'nclx') {
            return {
                primaries: buf.readUInt16BE(off + 12),
                transfer: buf.readUInt16BE(off + 14),
                matrix: buf.readUInt16BE(off + 16),
            }
        }
        off += size
    }
    return null
}

/**
 * Build a minimal ICC v2 RGB profile from D50-adapted colorants and a gamma curve.
 *
 * @param {{colorants: {r: number[], g: number[], b: number[]}, gamma: number}} options
 */
function makeIcc({colorants, gamma, para}) {
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
    const paraTag = ({fn, params}) => {
        const buffer = Buffer.alloc(12 + 4 * params.length)
        buffer.write('para', 0, 'latin1')
        buffer.writeUInt16BE(fn, 8)
        for (const [index, value] of params.entries()) {
            buffer.writeInt32BE(Math.round(value * 65536), 12 + index * 4)
        }
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
        ['rTRC', para ? paraTag(para) : curvTag(gamma)],
        ['gTRC', para ? paraTag(para) : curvTag(gamma)],
        ['bTRC', para ? paraTag(para) : curvTag(gamma)],
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

async function sourceWithIcc(profile) {
    const path = join(tmpdir(), `myoc-icc-${process.pid}-${Math.random().toString(16).slice(2)}.icc`)
    writeFileSync(path, profile)
    try {
        return await sharp({
            create: {background: {b: 32, g: 64, r: 255}, channels: 3, height: 80, width: 100},
        })
            .withIccProfile(path)
            .png()
            .toBuffer()
    } finally {
        unlinkSync(path)
    }
}

const previewOptions = {
    limitInputPixels: 200_000_000,
    maxLongEdge: 1600,
    quality: 60,
}

test('creates a quality 60 AVIF within the preview size limit', async () => {
    const source = await sharp({
        create: {
            background: {alpha: 0.5, b: 40, g: 120, r: 240},
            channels: 4,
            height: 2000,
            width: 3000,
        },
    })
        .png()
        .toBuffer()

    const result = await createAvifPreview(source, previewOptions)
    const metadata = await sharp(result.bytes).metadata()

    assert.equal(result.width, 1600)
    assert.equal(result.height, 1067)
    assert.equal(metadata.format, 'heif')
    assert.equal(metadata.compression, 'av1')
    assert.equal(metadata.width, 1600)
    assert.equal(metadata.height, 1067)
    assert.equal(metadata.hasAlpha, true)
})

test('declares a Display P3 source as Display P3 in the AVIF preview', async () => {
    const source = await sharp({
        create: {
            background: {b: 32, g: 64, r: 255},
            channels: 3,
            height: 80,
            width: 100,
        },
    })
        .withIccProfile('p3')
        .png()
        .toBuffer()
    const sourceMetadata = await sharp(source).metadata()

    const result = await createAvifPreview(source, previewOptions)
    const previewMetadata = await sharp(result.bytes).metadata()

    assert.equal(sourceMetadata.hasProfile, true)
    assert.equal(previewMetadata.hasProfile, true)
    assert.deepEqual(previewMetadata.icc, sourceMetadata.icc)

    const nclx = findNclx(result.bytes)
    assert.ok(nclx, 'expected an nclx color box')
    assert.equal(nclx.primaries, 12)
    assert.equal(nclx.transfer, 13)
    assert.equal(nclx.matrix, 6)
})

test('decodes an opaque preview after adding nclx', async () => {
    const source = await sharp({
        create: {background: {b: 32, g: 64, r: 255}, channels: 3, height: 80, width: 100},
    })
        .withIccProfile('p3')
        .png()
        .toBuffer()

    const result = await createAvifPreview(source, previewOptions)
    const raw = await sharp(result.bytes).raw().toBuffer()

    assert.equal(raw.length, result.width * result.height * 3)
})

test('decodes a transparent preview after adding nclx', async () => {
    const source = await sharp({
        create: {background: {alpha: 0.5, b: 32, g: 64, r: 255}, channels: 4, height: 80, width: 100},
    })
        .withIccProfile('p3')
        .png()
        .toBuffer()

    const result = await createAvifPreview(source, previewOptions)
    const raw = await sharp(result.bytes).raw().toBuffer()

    assert.equal(raw.length, result.width * result.height * 4)
})

test('does not enlarge a source that is within the preview size limit', async () => {
    const source = await sharp({
        create: {
            background: {b: 30, g: 20, r: 10},
            channels: 3,
            height: 480,
            width: 640,
        },
    })
        .jpeg()
        .toBuffer()

    const result = await createAvifPreview(source, previewOptions)

    assert.equal(result.width, 640)
    assert.equal(result.height, 480)
})

test('creates a blurred AVIF within the blur width limit', async () => {
    const source = await sharp({
        create: {
            background: {b: 20, g: 80, r: 220},
            channels: 3,
            height: 800,
            width: 1200,
        },
    })
        .png()
        .toBuffer()

    const result = await createAvifBlur(source, {
        limitInputPixels: 200_000_000,
        maxWidth: 960,
        quality: 60,
        sigma: 250,
    })
    const metadata = await sharp(result.bytes).metadata()

    assert.equal(result.width, 960)
    assert.equal(result.height, 640)
    assert.equal(metadata.format, 'heif')
    assert.equal(metadata.compression, 'av1')
    assert.equal(metadata.width, 960)
    assert.equal(metadata.height, 640)
})

test('creates a 512 pixel square AVIF from a lossless crop', async () => {
    const source = await sharp({
        create: {background: {b: 10, g: 20, r: 30}, channels: 3, height: 512, width: 512},
    })
        .png()
        .toBuffer()
    const result = await createSquareAvif(source, {limitInputPixels: 200_000_000, quality: 75, size: 512})
    const metadata = await sharp(result.bytes).metadata()

    assert.equal(result.width, 512)
    assert.equal(result.height, 512)
    assert.equal(metadata.format, 'heif')
    assert.equal(metadata.width, 512)
    assert.equal(metadata.height, 512)
})

test('rejects a crop with incorrect square dimensions', async () => {
    const source = await sharp({
        create: {background: {b: 10, g: 20, r: 30}, channels: 3, height: 511, width: 512},
    })
        .png()
        .toBuffer()

    await assert.rejects(
        createSquareAvif(source, {limitInputPixels: 200_000_000, quality: 75, size: 512}),
        /Square image source must be 512x512 pixels/,
    )
})

test('creates gallery preview and blur outputs from one decode graph', async () => {
    const source = await sharp({
        create: {background: {b: 20, g: 80, r: 220}, channels: 3, height: 1600, width: 2400},
    })
        .png()
        .toBuffer()
    const options = {
        blur: true,
        blurMaxWidth: 960,
        blurQuality: 60,
        blurSigma: 250,
        limitInputPixels: 200_000_000,
        maxLongEdge: 1600,
        previewQuality: 60,
    }
    const result = await createGalleryAvifOutputs(source, options)

    assert.equal(result.preview.width, 1600)
    assert.equal(result.preview.height, 1067)
    assert.equal(result.blur?.width, 960)
    assert.equal(result.blur?.height, 640)
    assert.equal((await sharp(result.preview.bytes).metadata()).format, 'heif')
    assert.equal((await sharp(result.blur?.bytes).metadata()).format, 'heif')

    const withoutBlur = await createGalleryAvifOutputs(source, {...options, blur: false})
    assert.equal(withoutBlur.blur, null)
})

test('declares a Rec.2020 source as Rec.2020 in the AVIF preview', async () => {
    const source = await sourceWithIcc(
        makeIcc({
            colorants: {
                b: [0.1251, 0.045629, 0.797162],
                g: [0.165661, 0.675338, 0.029979],
                r: [0.673459, 0.279033, -0.001931],
            },
            para: {fn: 4, params: [0.45, 1.0992968, 0, 4.5, 0.018054, -0.0992968, 0]},
        }),
    )
    const result = await createAvifPreview(source, previewOptions)
    const previewMetadata = await sharp(result.bytes).metadata()

    assert.equal(previewMetadata.hasProfile, true)
    const nclx = findNclx(result.bytes)
    assert.ok(nclx, 'expected an nclx color box')
    assert.equal(nclx.primaries, 9)
    assert.equal(nclx.transfer, 14)
    assert.equal(nclx.matrix, 6)
})

test('declares a P3 source with a 2.6 gamma as Display P3 primaries', async () => {
    const source = await sourceWithIcc(
        makeIcc({
            colorants: {
                b: [0.157104, 0.066559, 0.783081],
                g: [0.291977, 0.692245, 0.041824],
                r: [0.515121, 0.241196, 0],
            },
            gamma: 2.6,
        }),
    )
    const result = await createAvifPreview(source, previewOptions)
    const previewMetadata = await sharp(result.bytes).metadata()

    assert.equal(previewMetadata.hasProfile, true)
    const nclx = findNclx(result.bytes)
    assert.ok(nclx, 'expected an nclx color box')
    assert.equal(nclx.primaries, 12)
    assert.equal(nclx.transfer, 2)
    assert.equal(nclx.matrix, 6)
})

test('converts an Adobe RGB source to sRGB in the AVIF preview', async () => {
    const source = await sourceWithIcc(
        makeIcc({
            colorants: {
                b: [0.149234, 0.063227, 0.744851],
                g: [0.205264, 0.625669, 0.060885],
                r: [0.609722, 0.311104, 0.019474],
            },
            gamma: 2.2,
        }),
    )
    const result = await createAvifPreview(source, previewOptions)
    const previewMetadata = await sharp(result.bytes).metadata()

    assert.equal(previewMetadata.hasProfile, false)
    const nclx = findNclx(result.bytes)
    assert.ok(nclx, 'expected an nclx color box')
    assert.equal(nclx.primaries, 1)
    assert.equal(nclx.transfer, 13)
    assert.equal(nclx.matrix, 6)
})
