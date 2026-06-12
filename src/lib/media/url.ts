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

export function characterMediaImageObjectKey(
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
): string {
    return `characters/${userId}/${characterId}/media/${mediaId}/${rating}/${imageKey}.png`
}

export function characterMediaImageUrl(
    baseUrl: string,
    userId: string,
    characterId: string,
    mediaId: string,
    imageKey: string,
    rating: 'sfw' | 'nsfw',
): string {
    return mediaUrlForKey(baseUrl, characterMediaImageObjectKey(userId, characterId, mediaId, imageKey, rating))
}
