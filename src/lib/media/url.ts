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
