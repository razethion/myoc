import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {createAvifPreview} from './preview.mjs'

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

test('retains a Display P3 source ICC profile in the AVIF preview', async () => {
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
