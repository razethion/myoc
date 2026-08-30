import {describe, expect, it} from 'vitest'
import {writeAscii, writeUint16Le, writeUint32Be} from '../../test/binaryWriters'
import {
    createAvifFile,
    createBigEndianExifOrientationJpegFile,
    createExifOrientationJpegFile,
    createGifFile,
    createJpegFile,
} from '../../test/imageFixtures'
import {readGalleryImageDimensions, readGalleryImageMetadata} from './imageMetadata'

async function readFileBytes(file: File): Promise<Uint8Array> {
    return new Uint8Array(await file.arrayBuffer())
}

describe('gallery image metadata', () => {
    it.each([
        {contentType: 'image/gif', file: createGifFile(320, 180), expected: {width: 320, height: 180}},
        {contentType: 'image/jpeg', file: createJpegFile(640, 360), expected: {width: 640, height: 360}},
        {contentType: 'image/avif', file: createAvifFile(800, 600), expected: {width: 800, height: 600}},
    ])('reads dimensions from $contentType files', async ({contentType, file, expected}) => {
        await expect(readFileBytes(file).then((bytes) => readGalleryImageDimensions(bytes, contentType))).resolves.toEqual(expected)
    })

    it.each([createExifOrientationJpegFile(1200, 800), createBigEndianExifOrientationJpegFile(1200, 800)])(
        'uses EXIF orientation for display dimensions',
        async (file) => {
            const bytes = await readFileBytes(file)

            expect(readGalleryImageMetadata(bytes, file.type)).toEqual({
                width: 1200,
                height: 800,
                displayWidth: 800,
                displayHeight: 1200,
                exifOrientation: 6,
            })
        },
    )

    it('rejects malformed GIF and JPEG data', () => {
        expect(readGalleryImageDimensions(new Uint8Array(9), 'image/gif')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array(10), 'image/gif')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array(4), 'image/jpeg')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array([0xff, 0xd8, 0, 0]), 'image/jpeg')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBeNull()
        expect(readGalleryImageDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1]), 'image/jpeg')).toBeNull()
    })

    it('ignores malformed EXIF data and keeps valid JPEG dimensions', async () => {
        const bytes = await readFileBytes(createExifOrientationJpegFile(640, 360))
        bytes.set([0x58, 0x58], 12)

        expect(readGalleryImageMetadata(bytes, 'image/jpeg')).toEqual({
            width: 640,
            height: 360,
            displayWidth: 640,
            displayHeight: 360,
            exifOrientation: null,
        })
    })

    it.each([
        {name: 'non-EXIF APP1 payload', mutate: (bytes: Uint8Array) => bytes.set([0x58, 0x58], 6)},
        {name: 'invalid TIFF magic', mutate: (bytes: Uint8Array) => bytes.set([0, 0], 14)},
        {name: 'short first IFD offset', mutate: (bytes: Uint8Array) => bytes.fill(0, 16, 20)},
        {
            name: 'truncated IFD entries',
            mutate: (bytes: Uint8Array) => {
                writeUint16Le(bytes, 20, 2)
                writeUint16Le(bytes, 22, 0x010f)
            },
        },
        {name: 'invalid orientation type', mutate: (bytes: Uint8Array) => writeUint16Le(bytes, 24, 2)},
        {name: 'invalid orientation value', mutate: (bytes: Uint8Array) => writeUint16Le(bytes, 30, 9)},
    ])('ignores $name and keeps valid JPEG dimensions', async ({mutate}) => {
        const bytes = await readFileBytes(createExifOrientationJpegFile(640, 360))
        mutate(bytes)

        expect(readGalleryImageMetadata(bytes, 'image/jpeg')).toEqual({
            width: 640,
            height: 360,
            displayWidth: 640,
            displayHeight: 360,
            exifOrientation: null,
        })
    })

    it('rejects invalid AVIF box sizes and zero dimensions', async () => {
        const invalidBox = await readFileBytes(createAvifFile())
        invalidBox[3] = invalidBox.byteLength + 1

        const zeroWidth = await readFileBytes(createAvifFile())
        zeroWidth.fill(0, 40, 44)

        expect(readGalleryImageDimensions(invalidBox, 'image/avif')).toBeNull()
        expect(readGalleryImageDimensions(zeroWidth, 'image/avif')).toBeNull()
    })

    it('reads AVIF boxes with extended and end-of-file sizes', () => {
        expect(readGalleryImageDimensions(createIspeBox(320, 180, 'extended'), 'image/avif')).toEqual({width: 320, height: 180})
        expect(readGalleryImageDimensions(createIspeBox(640, 360, 'to-end'), 'image/avif')).toEqual({width: 640, height: 360})
    })

    it.each([
        {name: 'missing extended size', bytes: createBox('free', new Uint8Array(), 1)},
        {name: 'unsupported 64-bit size', bytes: createUnsupportedExtendedSizeBox()},
        {name: 'short ispe payload', bytes: createBox('ispe', new Uint8Array(4))},
        {name: 'unrecognized box', bytes: createBox('free', new Uint8Array())},
        {name: 'empty container', bytes: createBox('iprp', new Uint8Array())},
        {name: 'excessive nesting', bytes: createNestedAvifBox(9)},
    ])('rejects AVIF data with $name', ({bytes}) => {
        expect(readGalleryImageDimensions(bytes, 'image/avif')).toBeNull()
    })

    it.each(['image/bmp', 'constructor', 'toString'])('rejects unsupported content type %s', (contentType) => {
        expect(readGalleryImageDimensions(new Uint8Array(32), contentType)).toBeNull()
        expect(readGalleryImageMetadata(new Uint8Array(32), contentType)).toBeNull()
    })
})

function createBox(type: string, content: Uint8Array, declaredSize = content.byteLength + 8): Uint8Array {
    const bytes = new Uint8Array(content.byteLength + 8)
    writeUint32Be(bytes, 0, declaredSize)
    writeAscii(bytes, 4, type)
    bytes.set(content, 8)
    return bytes
}

function createIspeBox(width: number, height: number, sizeType: 'extended' | 'to-end'): Uint8Array {
    const content = new Uint8Array(12)
    writeUint32Be(content, 4, width)
    writeUint32Be(content, 8, height)

    if (sizeType === 'to-end') {
        return createBox('ispe', content, 0)
    }

    const bytes = new Uint8Array(28)
    writeUint32Be(bytes, 0, 1)
    writeAscii(bytes, 4, 'ispe')
    writeUint32Be(bytes, 8, 0)
    writeUint32Be(bytes, 12, bytes.byteLength)
    bytes.set(content, 16)
    return bytes
}

function createUnsupportedExtendedSizeBox(): Uint8Array {
    const bytes = new Uint8Array(16)
    writeUint32Be(bytes, 0, 1)
    writeAscii(bytes, 4, 'free')
    writeUint32Be(bytes, 8, 1)
    return bytes
}

function createNestedAvifBox(depth: number): Uint8Array {
    let bytes = createBox('free', new Uint8Array())

    for (let index = 0; index < depth; index += 1) {
        bytes = createBox('ipco', bytes)
    }

    return bytes
}
