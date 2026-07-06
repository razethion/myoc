export function mediaUrlForKey(baseUrl: string, key: string): string {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')

    return `${normalizedBaseUrl}/${encodedKey}`
}

export function profilePhotoObjectKey(userId: string, profilePhotoKey: string): string {
    return `users/${userId}/profile/${profilePhotoKey}.webp`
}

export function profilePhotoUrl(baseUrl: string, userId: string, profilePhotoKey: string): string {
    return mediaUrlForKey(baseUrl, profilePhotoObjectKey(userId, profilePhotoKey))
}

export function characterProfileImageObjectKey(
    userId: string,
    characterId: string,
    profileImageKey: string,
): string {
    return `characters/${userId}/${characterId}/profile/${profileImageKey}.webp`
}

export function characterProfileImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    profileImageKey: string,
): string {
    return mediaUrlForKey(baseUrl, characterProfileImageObjectKey(userId, characterId, profileImageKey))
}

export function characterFolderImageObjectKey(
    userId: string,
    folderId: string,
    folderImageKey: string,
): string {
    return `characters/${userId}/folders/${folderId}/image/${folderImageKey}.webp`
}

export function characterFolderImageUrl(
    baseUrl: string,
    userId: string,
    folderId: string,
    folderImageKey: string,
): string {
    return mediaUrlForKey(baseUrl, characterFolderImageObjectKey(userId, folderId, folderImageKey))
}

export function characterMediaImageObjectKey(
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
    contentType: string | null | undefined = 'image/png',
): string {
    return `characters/${userId}/${characterId}/media/${mediaId}/${rating}/${imageKey}.${extensionForImageContentType(contentType)}`
}

export function characterMediaPreviewImageObjectKey(
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
): string {
    return `characters/${userId}/${characterId}/media/${mediaId}/${rating}/preview/${imageKey}.webp`
}

export function characterMediaNsfwBlurImageObjectKey(
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
): string {
    return `characters/${userId}/${characterId}/media/${mediaId}/nsfw/blur/${imageKey}.webp`
}

export function characterHeightChartImageObjectKey(
    userId: string,
    characterId: string,
    imageKey: string,
    contentType: string | null | undefined = 'image/png',
): string {
    return `characters/${userId}/${characterId}/height-chart/${imageKey}.${extensionForImageContentType(contentType)}`
}

export function characterHeightChartImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    imageKey: string,
    contentType: string | null | undefined = 'image/png',
): string {
    return mediaUrlForKey(baseUrl, characterHeightChartImageObjectKey(userId, characterId, imageKey, contentType))
}

export function characterMediaImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
    contentType: string | null | undefined = 'image/png',
): string {
    return mediaUrlForKey(baseUrl, characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, rating, contentType))
}

export function characterMediaPreviewImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
): string {
    return mediaUrlForKey(baseUrl, characterMediaPreviewImageObjectKey(userId, characterId, mediaId, imageKey, rating))
}

export function characterMediaNsfwBlurImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
): string {
    return mediaUrlForKey(baseUrl, characterMediaNsfwBlurImageObjectKey(userId, characterId, mediaId, imageKey))
}

export function extensionForImageContentType(contentType: string | null | undefined): string {
    switch ((contentType ?? 'image/png').toLowerCase()) {
        case 'image/jpeg':
            return 'jpg'
        case 'image/gif':
            return 'gif'
        case 'image/webp':
            return 'webp'
        case 'image/avif':
            return 'avif'
        case 'image/png':
        default:
            return 'png'
    }
}
