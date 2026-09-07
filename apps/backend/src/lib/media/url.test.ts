import {describe, expect, it} from 'vitest'
import {
    characterFolderImageObjectKey,
    characterFolderImageUrl,
    characterHeightChartImageObjectKey,
    characterHeightChartImageUrl,
    characterMediaImageObjectKey,
    characterMediaImageUrl,
    characterMediaNsfwBlurImageObjectKey,
    characterMediaNsfwBlurImageUrl,
    characterMediaPreviewImageObjectKey,
    characterMediaPreviewImageUrl,
    characterProfileImageObjectKey,
    characterProfileImageUrl,
    profilePhotoObjectKey,
    profilePhotoUrl,
} from './url'

describe('media object keys', () => {
    it('builds profile and character keys with their expected folder paths', () => {
        expect(profilePhotoObjectKey('user-1', 'avatar')).toBe('users/user-1/profile/avatar.webp')
        expect(characterProfileImageObjectKey('user-1', 'char-2', 'portrait')).toBe('characters/user-1/char-2/profile/portrait.webp')
        expect(characterFolderImageObjectKey('user-1', 'folder-3', 'cover')).toBe('characters/user-1/folders/folder-3/image/cover.webp')
    })

    it('uses the content type extension for media and height chart keys', () => {
        expect(characterMediaImageObjectKey('u', 'c', 'm', 'original', 'sfw', 'image/jpeg')).toBe('characters/u/c/media/m/sfw/original.jpg')
        expect(characterMediaPreviewImageObjectKey('u', 'c', 'm', 'preview', 'nsfw', 'IMAGE/GIF')).toBe(
            'characters/u/c/media/m/nsfw/preview/preview.gif',
        )
        expect(characterMediaNsfwBlurImageObjectKey('u', 'c', 'm', 'blur', 'image/avif')).toBe('characters/u/c/media/m/nsfw/blur/blur.avif')
        expect(characterHeightChartImageObjectKey('u', 'c', 'chart', 'image/webp')).toBe('characters/u/c/height-chart/chart.webp')
    })

    it('falls back to PNG for null, undefined, and unknown content types', () => {
        expect(characterMediaImageObjectKey('u', 'c', 'm', 'one', 'sfw', null)).toMatch(/\/one\.png$/)
        expect(characterMediaImageObjectKey('u', 'c', 'm', 'two', 'sfw', undefined)).toMatch(/\/two\.png$/)
        expect(characterHeightChartImageObjectKey('u', 'c', 'three', 'image/bmp')).toMatch(/\/three\.png$/)
    })

    it('uses the documented defaults for source, preview, blur, and chart images', () => {
        expect(characterMediaImageObjectKey('u', 'c', 'm', 'source', 'sfw')).toMatch(/\/source\.png$/)
        expect(characterMediaPreviewImageObjectKey('u', 'c', 'm', 'preview', 'sfw')).toMatch(/\/preview\.webp$/)
        expect(characterMediaNsfwBlurImageObjectKey('u', 'c', 'm', 'blur')).toMatch(/\/blur\.webp$/)
        expect(characterHeightChartImageObjectKey('u', 'c', 'chart')).toMatch(/\/chart\.png$/)
    })
})

describe('media URLs', () => {
    it('removes trailing slashes from the base and encodes each key segment', () => {
        expect(profilePhotoUrl('https://media.example///', 'user one', 'avatar v1')).toBe(
            'https://media.example/users/user%20one/profile/avatar%20v1.webp',
        )
        expect(characterProfileImageUrl('https://media.example/', 'u', 'c', 'portrait#1')).toBe(
            'https://media.example/characters/u/c/profile/portrait%231.webp',
        )
    })

    it('returns URLs for folder, chart, original, preview, and blur images', () => {
        const baseUrl = 'https://media.example'
        expect(characterFolderImageUrl(baseUrl, 'u', 'f', 'cover')).toBe('https://media.example/characters/u/folders/f/image/cover.webp')
        expect(characterHeightChartImageUrl(baseUrl, 'u', 'c', 'chart', 'image/jpeg')).toBe(
            'https://media.example/characters/u/c/height-chart/chart.jpg',
        )
        expect(characterHeightChartImageUrl(baseUrl, 'u', 'c', 'default-chart')).toBe(
            'https://media.example/characters/u/c/height-chart/default-chart.png',
        )
        expect(characterMediaImageUrl(baseUrl, 'u', 'c', 'm', 'original', 'sfw', 'image/png')).toBe(
            'https://media.example/characters/u/c/media/m/sfw/original.png',
        )
        expect(characterMediaImageUrl(baseUrl, 'u', 'c', 'm', 'default-original', 'sfw')).toBe(
            'https://media.example/characters/u/c/media/m/sfw/default-original.png',
        )
        expect(characterMediaPreviewImageUrl(baseUrl, 'u', 'c', 'm', 'preview', 'nsfw')).toBe(
            'https://media.example/characters/u/c/media/m/nsfw/preview/preview.webp',
        )
        expect(characterMediaNsfwBlurImageUrl(baseUrl, 'u', 'c', 'm', 'blur')).toBe(
            'https://media.example/characters/u/c/media/m/nsfw/blur/blur.webp',
        )
    })
})
