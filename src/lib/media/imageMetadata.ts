import {getPngDimensions} from './png'
import {getWebpDimensions} from './webp'

export type ImageDimensions = {
    width: number
    height: number
}

export type GalleryImageMetadata = ImageDimensions & {
    displayWidth: number
    displayHeight: number
    exifOrientation: number | null
}

type JpegSegment = {
    marker: number
    payloadStart: number
    payloadEnd: number
}

type ExifTiffHeader = {
    littleEndian: boolean
    ifdStart: number
}

type IsobmffBox = {
    type: string
    contentStart: number
    end: number
}

const ISOBMFF_MAX_DEPTH = 8
const IMAGE_DIMENSION_READERS = new Map<string, (value: Uint8Array) => ImageDimensions | null>([
    ['image/avif', readAvifDimensions],
    ['image/gif', readGifDimensions],
    ['image/jpeg', readJpegDimensions],
    ['image/png', getPngDimensions],
    ['image/webp', getWebpDimensions],
])

export function readGalleryImageDimensions(bytes: Uint8Array, contentType: string): ImageDimensions | null {
    return IMAGE_DIMENSION_READERS.get(contentType)?.(bytes) ?? null
}

export function readGalleryImageMetadata(bytes: Uint8Array, contentType: string): GalleryImageMetadata | null {
    const dimensions = readGalleryImageDimensions(bytes, contentType)

    if (!dimensions) {
        return null
    }

    const exifOrientation = contentType === 'image/jpeg' ? readJpegExifOrientation(bytes) : null
    const swapsDimensions = exifOrientation !== null && exifOrientation >= 5 && exifOrientation <= 8

    return {
        width: dimensions.width,
        height: dimensions.height,
        displayWidth: swapsDimensions ? dimensions.height : dimensions.width,
        displayHeight: swapsDimensions ? dimensions.width : dimensions.height,
        exifOrientation,
    }
}

function readGifDimensions(bytes: Uint8Array): ImageDimensions | null {
    if (bytes.length < 10) {
        return null
    }

    const signature = readAscii(bytes, 0, 6)

    if (signature !== 'GIF87a' && signature !== 'GIF89a') {
        return null
    }

    return {
        width: readUint16(bytes, 6, true),
        height: readUint16(bytes, 8, true),
    }
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
    return scanJpegSegments(bytes, (segment) => {
        if (!isJpegSofMarker(segment.marker) || segment.payloadStart + 5 > segment.payloadEnd) {
            return null
        }

        return {
            height: readUint16(bytes, segment.payloadStart + 1, false),
            width: readUint16(bytes, segment.payloadStart + 3, false),
        }
    })
}

function readJpegExifOrientation(bytes: Uint8Array): number | null {
    return scanJpegSegments(bytes, (segment) => {
        if (segment.marker !== 0xe1) {
            return null
        }

        return readExifOrientationFromApp1(bytes, segment.payloadStart, segment.payloadEnd)
    })
}

function scanJpegSegments<T>(bytes: Uint8Array, readValue: (segment: JpegSegment) => T | null): T | null {
    if (!hasJpegSignature(bytes)) {
        return null
    }

    let offset = 2

    while (offset + 2 <= bytes.length) {
        const marker = readJpegMarker(bytes, offset)

        if (marker === null || marker === 0xd9 || marker === 0xda) {
            return null
        }

        const segment = readJpegSegment(bytes, offset, marker)

        if (!segment) {
            return null
        }

        const value = readValue(segment)

        if (value !== null) {
            return value
        }

        offset = segment.payloadEnd
    }

    return null
}

function hasJpegSignature(bytes: Uint8Array): boolean {
    return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8
}

function readJpegMarker(bytes: Uint8Array, offset: number): number | null {
    return bytes[offset] === 0xff ? byteAt(bytes, offset + 1) : null
}

function readJpegSegment(bytes: Uint8Array, offset: number, marker: number): JpegSegment | null {
    const lengthOffset = offset + 2

    if (lengthOffset + 2 > bytes.length) {
        return null
    }

    const length = readUint16(bytes, lengthOffset, false)
    const payloadEnd = lengthOffset + length

    if (length < 2 || payloadEnd > bytes.length) {
        return null
    }

    return {
        marker,
        payloadStart: lengthOffset + 2,
        payloadEnd,
    }
}

function isJpegSofMarker(marker: number): boolean {
    return (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
    )
}

function readExifOrientationFromApp1(bytes: Uint8Array, start: number, end: number): number | null {
    const header = readExifTiffHeader(bytes, start, end)

    if (!header) {
        return null
    }

    return findExifOrientation(bytes, header.ifdStart, end, header.littleEndian)
}

function readExifTiffHeader(bytes: Uint8Array, start: number, end: number): ExifTiffHeader | null {
    if (end - start < 32 || readAscii(bytes, start, 6) !== 'Exif\0\0') {
        return null
    }

    const tiffStart = start + 6
    const byteOrder = readAscii(bytes, tiffStart, 2)

    if (byteOrder !== 'II' && byteOrder !== 'MM') {
        return null
    }

    const littleEndian = byteOrder === 'II'

    if (readUint16(bytes, tiffStart + 2, littleEndian) !== 42) {
        return null
    }

    const firstIfdOffset = readUint32(bytes, tiffStart + 4, littleEndian)
    const ifdStart = tiffStart + firstIfdOffset

    return firstIfdOffset >= 8 && ifdStart + 2 <= end ? {littleEndian, ifdStart} : null
}

function findExifOrientation(bytes: Uint8Array, ifdStart: number, end: number, littleEndian: boolean): number | null {
    const entryCount = readUint16(bytes, ifdStart, littleEndian)

    for (let index = 0; index < entryCount; index += 1) {
        const entryOffset = ifdStart + 2 + index * 12

        if (entryOffset + 12 > end) {
            return null
        }

        if (readUint16(bytes, entryOffset, littleEndian) !== 0x0112) {
            continue
        }

        return readExifOrientationEntry(bytes, entryOffset, littleEndian)
    }

    return null
}

function readExifOrientationEntry(bytes: Uint8Array, entryOffset: number, littleEndian: boolean): number | null {
    const type = readUint16(bytes, entryOffset + 2, littleEndian)
    const valueCount = readUint32(bytes, entryOffset + 4, littleEndian)

    if (type !== 3 || valueCount < 1) {
        return null
    }

    const orientation = readUint16(bytes, entryOffset + 8, littleEndian)
    return orientation >= 1 && orientation <= 8 ? orientation : null
}

function readAvifDimensions(bytes: Uint8Array): ImageDimensions | null {
    return findIsobmffImageSpatialExtents(bytes, 0, bytes.length, 0)
}

function findIsobmffImageSpatialExtents(bytes: Uint8Array, start: number, end: number, depth: number): ImageDimensions | null {
    if (depth > ISOBMFF_MAX_DEPTH) {
        return null
    }

    let offset = start

    while (offset + 8 <= end) {
        const box = readIsobmffBox(bytes, offset, end)

        if (!box) {
            return null
        }

        if (box.type === 'ispe') {
            return readIspeDimensions(bytes, box)
        }

        const childDimensions = readIsobmffChildDimensions(bytes, box, depth)

        if (childDimensions) {
            return childDimensions
        }

        offset = box.end
    }

    return null
}

function readIsobmffBox(bytes: Uint8Array, offset: number, end: number): IsobmffBox | null {
    const boxStart = offset
    let boxSize = readUint32Be(bytes, offset)
    const type = readAscii(bytes, offset + 4, 4)
    let contentStart = offset + 8

    if (boxSize === 1) {
        const extendedSize = readIsobmffExtendedSize(bytes, contentStart, end)

        if (extendedSize === null) {
            return null
        }

        boxSize = extendedSize
        contentStart += 8
    } else if (boxSize === 0) {
        boxSize = end - boxStart
    }

    const boxEnd = boxStart + boxSize

    if (boxSize < contentStart - boxStart || boxEnd > end) {
        return null
    }

    return {type, contentStart, end: boxEnd}
}

function readIsobmffExtendedSize(bytes: Uint8Array, offset: number, end: number): number | null {
    if (offset + 8 > end) {
        return null
    }

    const high = readUint32Be(bytes, offset)
    const low = readUint32Be(bytes, offset + 4)
    return high === 0 ? low : null
}

function readIspeDimensions(bytes: Uint8Array, box: IsobmffBox): ImageDimensions | null {
    if (box.contentStart + 12 > box.end) {
        return null
    }

    const width = readUint32Be(bytes, box.contentStart + 4)
    const height = readUint32Be(bytes, box.contentStart + 8)
    return width > 0 && height > 0 ? {width, height} : null
}

function readIsobmffChildDimensions(bytes: Uint8Array, box: IsobmffBox, depth: number): ImageDimensions | null {
    if (box.type !== 'meta' && box.type !== 'iprp' && box.type !== 'ipco') {
        return null
    }

    const childStart = box.type === 'meta' ? box.contentStart + 4 : box.contentStart

    if (childStart >= box.end) {
        return null
    }

    return findIsobmffImageSpatialExtents(bytes, childStart, box.end, depth + 1)
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let value = ''

    for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(byteAt(bytes, offset + index))
    }

    return value
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
    return (
        byteAt(bytes, offset) * 0x1000000 +
        ((byteAt(bytes, offset + 1) << 16) >>> 0) +
        ((byteAt(bytes, offset + 2) << 8) >>> 0) +
        byteAt(bytes, offset + 3)
    )
}

function readUint16(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
    if (littleEndian) {
        return byteAt(bytes, offset) | (byteAt(bytes, offset + 1) << 8)
    }

    return (byteAt(bytes, offset) << 8) | byteAt(bytes, offset + 1)
}

function readUint32(bytes: Uint8Array, offset: number, littleEndian: boolean): number {
    if (littleEndian) {
        return (
            byteAt(bytes, offset) +
            byteAt(bytes, offset + 1) * 0x100 +
            byteAt(bytes, offset + 2) * 0x10000 +
            byteAt(bytes, offset + 3) * 0x1000000
        )
    }

    return readUint32Be(bytes, offset)
}

function byteAt(bytes: Uint8Array, offset: number): number {
    return bytes[offset] as number
}
