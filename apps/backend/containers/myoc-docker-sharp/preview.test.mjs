import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {createAvifBlur, createAvifPreview, createGalleryAvifOutputs, createSquareAvif} from './preview.mjs'

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
