export const GALLERY_MAX_IMAGES_PER_ROW = 5

export function chunkGalleryItems<T>(
    items: T[],
    maxItemsPerRow = GALLERY_MAX_IMAGES_PER_ROW,
): T[][] {
    if (items.length === 0) {
        return []
    }

    const chunks: T[][] = []

    for (let index = 0; index < items.length; index += maxItemsPerRow) {
        chunks.push(items.slice(index, index + maxItemsPerRow))
    }

    return chunks
}
