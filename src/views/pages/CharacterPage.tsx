import type {CurrentUser} from '../../lib/auth/session'
import {chunkGalleryItems, shouldForceGalleryRowFullWidth} from '../../lib/gallery'
import {
    characterMediaImageUrl,
    characterMediaNsfwBlurImageUrl,
    characterMediaPreviewImageUrl,
    characterProfileImageUrl,
    profilePhotoUrl,
} from '../../lib/media/url'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import {absoluteUrl, compactDescription} from '../meta'
import type {ProfilePageUser} from './ProfilePage'

export type CharacterPageCharacter = {
    id: string
    userId: string
    name: string
    profileImageKey: string
    description: string
    hasHeightChart: boolean
}

export type CharacterPageMedia = {
    id: string
    sfwImageKey: string | null
    nsfwImageKey: string | null
    sfwPreviewImageKey: string | null
    nsfwPreviewImageKey: string | null
    nsfwBlurImageKey: string | null
    sfwContentType: string | null
    nsfwContentType: string | null
    sfwArtist: string
    nsfwArtist: string
    sfwWidth: number | null
    sfwHeight: number | null
    sfwPreviewWidth: number | null
    sfwPreviewHeight: number | null
    nsfwWidth: number | null
    nsfwHeight: number | null
    nsfwPreviewWidth: number | null
    nsfwPreviewHeight: number | null
}

type CharacterPageGalleryTab = {
    id: string
    name: string
    rows: {
        id: string
        mediaIds: string[]
        forceFullWidth: boolean
    }[]
}

type CharacterPageProps = {
    currentUser?: CurrentUser | null
    profileUser: ProfilePageUser
    character: CharacterPageCharacter
    media: CharacterPageMedia[]
    galleryTabs: CharacterPageGalleryTab[]
    mediaBaseUrl: string
    metaDescriptionFallback: string
    siteUrl: string
}

function displayGalleryTabName(name: string): string {
    return name === 'default' ? 'Default' : name
}

type DisplayMedia = CharacterPageMedia & {
    artist: string
    imageAlt: string
    displayHeight: number
    displayPreviewUrl: string | null
    displayUrl: string
    displayWidth: number
    isNsfw: boolean
    isNsfwHidden: boolean
    nsfwArtist: string
    nsfwDisplayHeight: number | null
    nsfwDisplayPreviewUrl: string | null
    nsfwDisplayUrl: string | null
    nsfwDisplayWidth: number | null
    nsfwImageAlt: string | null
    safeDisplayHeight: number | null
    safeDisplayIsNsfwHidden: boolean
    safeDisplayPreviewUrl: string | null
    safeDisplayTitle: string | null
    safeDisplayUrl: string | null
    safeDisplayWidth: number | null
    safeImageAlt: string | null
}

function safeJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

function profileImageFor(user: ProfilePageUser, mediaBaseUrl: string): string {
    if (user.profilePhotoKey) {
        return profilePhotoUrl(mediaBaseUrl, user.id, user.profilePhotoKey)
    }

    const letter = user.username.trim().charAt(0).toUpperCase() || 'U'
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=ccc&color=000`
}

function encodeLayoutValue(layout: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(layout))
    let binary = ''

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte)
    })

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function sizeChartUrlForCharacter(characterId: string): string {
    const layout = {
        version: 1,
        selectedId: characterId,
        characters: [
            {
                id: characterId,
                xPct: 50,
                flipped: false,
                layer: 1,
            },
        ],
    }

    return `/size-chart?layout=${encodeLayoutValue(layout)}`
}

function characterPageUrl(profileUser: ProfilePageUser, character: CharacterPageCharacter): string {
    return `/u/${encodeURIComponent(profileUser.username)}/${encodeURIComponent(character.name)}`
}

function characterPageDescription(character: CharacterPageCharacter, fallback: string): string {
    return compactDescription(character.description, fallback)
}

function hiddenNsfwPlaceholderUrl(): string {
    return 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 9%22%3E%3Crect width=%2216%22 height=%229%22 fill=%22%23232323%22/%3E%3C/svg%3E'
}

function CharacterPageHead({
    character,
    imageUrl,
    metaDescriptionFallback,
    pageTitle,
    profileUser,
    siteUrl,
}: {
    character: CharacterPageCharacter
    imageUrl: string
    metaDescriptionFallback: string
    pageTitle: string
    profileUser: ProfilePageUser
    siteUrl: string
}) {
    const canonicalUrl = absoluteUrl(siteUrl, characterPageUrl(profileUser, character))
    const description = characterPageDescription(character, metaDescriptionFallback)
    const imageAlt = `${character.name} thumbnail`
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'CreativeWork',
        name: character.name,
        url: canonicalUrl,
        description,
        image: imageUrl,
        creator: {
            '@type': 'Person',
            name: profileUser.username,
            url: absoluteUrl(siteUrl, `/u/${encodeURIComponent(profileUser.username)}`),
        },
    }

    return (
        <>
            <meta content={description} name="description" />
            <link href={canonicalUrl} rel="canonical" />

            <meta content={pageTitle} property="og:title" />
            <meta content={description} property="og:description" />
            <meta content="article" property="og:type" />
            <meta content={canonicalUrl} property="og:url" />
            <meta content="MyOC" property="og:site_name" />
            <meta content={imageUrl} property="og:image" />
            <meta content="512" property="og:image:width" />
            <meta content="512" property="og:image:height" />
            <meta content="image/webp" property="og:image:type" />
            <meta content={imageAlt} property="og:image:alt" />

            <meta content="summary" name="twitter:card" />
            <meta content={pageTitle} name="twitter:title" />
            <meta content={description} name="twitter:description" />
            <meta content={imageUrl} name="twitter:image" />
            <meta content={imageAlt} name="twitter:image:alt" />

            <script dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}} type="application/ld+json"></script>
        </>
    )
}

function displayMediaFor(
    media: CharacterPageMedia,
    character: CharacterPageCharacter,
    mediaBaseUrl: string,
    displayNsfwMedia: boolean,
): DisplayMedia | null {
    const hasSfw = Boolean(media.sfwImageKey)
    const hasNsfw = Boolean(media.nsfwImageKey)
    const useNsfw = Boolean(hasNsfw && (displayNsfwMedia || !hasSfw))
    const isNsfwHidden = useNsfw && !displayNsfwMedia
    const imageKey = useNsfw ? media.nsfwImageKey : media.sfwImageKey

    if (!imageKey) {
        return null
    }

    const width = useNsfw ? media.nsfwWidth : media.sfwWidth
    const height = useNsfw ? media.nsfwHeight : media.sfwHeight
    const previewImageKey = useNsfw ? media.nsfwPreviewImageKey : media.sfwPreviewImageKey
    const artist = (useNsfw ? media.nsfwArtist : media.sfwArtist) || media.sfwArtist || media.nsfwArtist || 'Unknown artist'
    const sfwArtist = media.sfwArtist || media.nsfwArtist || 'Unknown artist'
    const nsfwArtist = media.nsfwArtist || media.sfwArtist || 'Unknown artist'
    const rating = useNsfw ? 'nsfw' : 'sfw'
    const sfwDisplayPreviewUrl = media.sfwPreviewImageKey
        ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.sfwPreviewImageKey, 'sfw')
        : null
    const sfwDisplayUrl = media.sfwImageKey
        ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.sfwImageKey, 'sfw', media.sfwContentType)
        : null
    const sfwImageAlt = media.sfwImageKey
        ? sfwArtist === 'Unknown artist'
            ? 'Character media by an unknown artist'
            : `Character media by ${sfwArtist}`
        : null
    const nsfwDisplayPreviewUrl = media.nsfwPreviewImageKey
        ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwPreviewImageKey, 'nsfw')
        : null
    const nsfwDisplayUrl = media.nsfwImageKey
        ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwImageKey, 'nsfw', media.nsfwContentType)
        : null
    const nsfwImageAlt = media.nsfwImageKey
        ? nsfwArtist === 'Unknown artist'
            ? 'Character media by an unknown artist'
            : `Character media by ${nsfwArtist}`
        : null
    const hiddenWidth = media.nsfwPreviewWidth ?? media.nsfwWidth
    const hiddenHeight = media.nsfwPreviewHeight ?? media.nsfwHeight
    const hiddenDisplayUrl = media.nsfwBlurImageKey
        ? characterMediaNsfwBlurImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwBlurImageKey)
        : hiddenNsfwPlaceholderUrl()
    const safeDisplayUrl = sfwDisplayUrl ?? hiddenDisplayUrl
    const safeDisplayPreviewUrl = sfwDisplayUrl ? sfwDisplayPreviewUrl : null
    const safeDisplayWidth = sfwDisplayUrl ? media.sfwWidth : hiddenWidth
    const safeDisplayHeight = sfwDisplayUrl ? media.sfwHeight : hiddenHeight
    const safeDisplayTitle = sfwDisplayUrl ? sfwArtist : nsfwArtist
    const safeImageAlt = sfwImageAlt ?? nsfwImageAlt ?? 'Hidden NSFW media'
    const safeDisplayIsNsfwHidden = !sfwDisplayUrl && Boolean(hiddenDisplayUrl)

    if (isNsfwHidden) {
        if (!safeDisplayUrl) {
            return null
        }

        return {
            ...media,
            artist,
            imageAlt: safeImageAlt,
            displayHeight: safeDisplayHeight && safeDisplayHeight > 0 ? safeDisplayHeight : 1,
            displayPreviewUrl: safeDisplayPreviewUrl,
            displayUrl: safeDisplayUrl,
            displayWidth: safeDisplayWidth && safeDisplayWidth > 0 ? safeDisplayWidth : 1,
            isNsfw: true,
            isNsfwHidden: true,
            nsfwArtist,
            nsfwDisplayHeight: media.nsfwHeight && media.nsfwHeight > 0 ? media.nsfwHeight : null,
            nsfwDisplayPreviewUrl,
            nsfwDisplayUrl,
            nsfwDisplayWidth: media.nsfwWidth && media.nsfwWidth > 0 ? media.nsfwWidth : null,
            nsfwImageAlt,
            safeDisplayHeight: safeDisplayHeight && safeDisplayHeight > 0 ? safeDisplayHeight : null,
            safeDisplayIsNsfwHidden,
            safeDisplayPreviewUrl,
            safeDisplayTitle,
            safeDisplayUrl,
            safeDisplayWidth: safeDisplayWidth && safeDisplayWidth > 0 ? safeDisplayWidth : null,
            safeImageAlt,
        }
    }

    return {
        ...media,
        artist,
        imageAlt: artist === 'Unknown artist' ? 'Character media by an unknown artist' : `Character media by ${artist}`,
        displayHeight: height && height > 0 ? height : 1,
        displayPreviewUrl: previewImageKey
            ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, previewImageKey, rating)
            : null,
        displayUrl: characterMediaImageUrl(
            mediaBaseUrl,
            character.userId,
            character.id,
            media.id,
            imageKey,
            rating,
            useNsfw ? media.nsfwContentType : media.sfwContentType,
        ),
        displayWidth: width && width > 0 ? width : 1,
        isNsfw: useNsfw,
        isNsfwHidden: false,
        nsfwArtist,
        nsfwDisplayHeight: media.nsfwHeight && media.nsfwHeight > 0 ? media.nsfwHeight : null,
        nsfwDisplayPreviewUrl,
        nsfwDisplayUrl,
        nsfwDisplayWidth: media.nsfwWidth && media.nsfwWidth > 0 ? media.nsfwWidth : null,
        nsfwImageAlt,
        safeDisplayHeight: safeDisplayHeight && safeDisplayHeight > 0 ? safeDisplayHeight : null,
        safeDisplayIsNsfwHidden,
        safeDisplayPreviewUrl,
        safeDisplayTitle,
        safeDisplayUrl,
        safeDisplayWidth: safeDisplayWidth && safeDisplayWidth > 0 ? safeDisplayWidth : null,
        safeImageAlt,
    }
}

function CharacterPageStyles() {
    return (
        <style>{`
            .justified-gallery {
                display: flex;
                flex-direction: column;
                gap: 0.5rem;
                width: 100%;
            }

            .justified-row {
                align-items: stretch;
                display: flex;
                gap: 0.5rem;
                width: 100%;
            }

            .gallery-media {
                aspect-ratio: var(--media-width) / var(--media-height);
                background: var(--color-base-300);
                container-type: inline-size;
                flex: var(--media-aspect) 1 0;
                min-width: 0;
                overflow: hidden;
                position: relative;
                -webkit-touch-callout: none;
                user-select: none;
            }

            .justified-row:not(.row-force-full-width) {
                justify-content: flex-start;
            }

            .justified-row:not(.row-force-full-width) .gallery-media:only-child {
                flex: 0 1 min(100%, 34rem);
            }

            .justified-row.row-force-full-width .gallery-media:only-child {
                flex: 1 1 100%;
                max-width: none;
                width: 100%;
            }

            .gallery-image {
                display: block;
                height: 100%;
                object-fit: contain;
                opacity: 1;
                pointer-events: none;
                transition: opacity 160ms ease;
                user-select: none;
                width: 100%;
                -webkit-user-drag: none;
            }

            .gallery-media.gallery-media-openable {
                cursor: zoom-in;
            }

            .gallery-media.image-loading .gallery-image {
                opacity: 0.35;
            }

            .gallery-media.gallery-media-openable:focus-visible {
                outline: 2px solid currentColor;
                outline-offset: 3px;
            }

            .nsfw-media-warning {
                align-items: center;
                background: rgba(0, 0, 0, 0.18);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 0.5rem;
                pointer-events: none;
                position: absolute;
                text-align: center;
            }

            .nsfw-media-badge {
                align-items: center;
                aspect-ratio: 1;
                background: rgba(255, 60, 60, 0.37);
                border-radius: 0.5rem;
                box-shadow: 0 0.3rem 0.85rem rgba(0, 0, 0, 0.1);
                color: #000;
                display: flex;
                flex-direction: column;
                font-size: clamp(0.62rem, 12cqw, 0.9rem);
                font-weight: 800;
                gap: 0.08rem;
                height: clamp(2.25rem, 44cqw, 3.5rem);
                justify-content: center;
                line-height: 1;
                max-height: 72%;
                max-width: 72%;
                width: clamp(2.25rem, 44cqw, 3.5rem);
            }

            .nsfw-media-badge svg {
                height: 42%;
                width: 42%;
            }

            .gallery-tab-panel[hidden] {
                display: none;
            }

            .gallery-lightbox-shell {
                border-radius: 0;
                display: grid;
                grid-template-rows: auto minmax(18rem, 1fr) auto;
                height: 100dvh;
                max-height: 100dvh;
                position: relative;
                width: 100vw;
            }

            .gallery-lightbox-toolbar {
                align-items: center;
                border-bottom: 1px solid color-mix(in oklab, var(--color-base-content) 18%, transparent);
                display: flex;
                flex-wrap: wrap;
                gap: 0.5rem;
                justify-content: space-between;
                min-width: 0;
                padding: 0.75rem;
            }

            .gallery-lightbox-title {
                min-width: 12rem;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .gallery-lightbox-viewer-wrap {
                background:
                    linear-gradient(45deg, color-mix(in oklab, var(--color-base-300) 88%, black) 25%, transparent 25%),
                    linear-gradient(-45deg, color-mix(in oklab, var(--color-base-300) 88%, black) 25%, transparent 25%),
                    linear-gradient(45deg, transparent 75%, color-mix(in oklab, var(--color-base-300) 88%, black) 75%),
                    linear-gradient(-45deg, transparent 75%, color-mix(in oklab, var(--color-base-300) 88%, black) 75%);
                background-color: var(--color-base-200);
                background-position: 0 0, 0 0.5rem, 0.5rem -0.5rem, -0.5rem 0;
                background-size: 1rem 1rem;
                min-height: 0;
                position: relative;
            }

            .gallery-lightbox-viewer {
                height: 100%;
                min-height: 18rem;
                touch-action: none;
                width: 100%;
            }

            .gallery-lightbox-viewer.is-color-picking {
                cursor: crosshair;
            }

            .gallery-lightbox-gif-overlay {
                display: block;
                height: 100%;
                object-fit: fill;
                pointer-events: none;
                user-select: none;
                width: 100%;
            }

            .gallery-lightbox-footer {
                align-items: center;
                border-top: 1px solid color-mix(in oklab, var(--color-base-content) 18%, transparent);
                display: flex;
                flex-wrap: wrap;
                gap: 0.75rem;
                justify-content: space-between;
                min-width: 0;
                padding: 0.75rem;
            }

            .gallery-lightbox-credit {
                min-width: 0;
            }

            .gallery-color-preview {
                background: var(--color-base-300);
                border: 1px solid color-mix(in oklab, var(--color-base-content) 25%, transparent);
                height: 5rem;
                image-rendering: pixelated;
                width: 5rem;
            }

            .gallery-color-swatch {
                background: var(--picked-color, transparent);
                border: 1px solid color-mix(in oklab, var(--color-base-content) 30%, transparent);
                display: inline-block;
                height: 1.25rem;
                width: 1.25rem;
            }

            .gallery-lightbox-empty-state {
                align-items: center;
                background: color-mix(in oklab, var(--color-base-100) 78%, transparent);
                display: none;
                inset: 0;
                justify-content: center;
                padding: 1rem;
                position: absolute;
                text-align: center;
            }

            .gallery-lightbox-viewer-wrap.viewer-unavailable .gallery-lightbox-empty-state {
                display: flex;
            }

            .gallery-fullscreen-loader {
                align-items: center;
                background: rgb(0 0 0 / 92%);
                display: flex;
                flex-direction: column;
                gap: 1rem;
                inset: 0;
                justify-content: center;
                padding: 1.5rem;
                position: fixed;
                text-align: center;
                z-index: 80;
            }

            .gallery-fullscreen-loader[hidden] {
                display: none;
            }

            .gallery-lightbox-shell .gallery-fullscreen-loader {
                position: absolute;
                z-index: 10;
            }

            .gallery-fullscreen-loader progress {
                accent-color: var(--color-white);
                appearance: none;
                background-color: color-mix(in oklab, var(--color-white) 28%, transparent);
                border: 1px solid color-mix(in oklab, var(--color-white) 72%, transparent);
                border-radius: 999px;
                color: var(--color-white);
                height: 1rem;
                overflow: hidden;
                width: min(22rem, 80vw);
            }

            .gallery-fullscreen-loader progress::-moz-progress-bar {
                background-color: var(--color-white);
            }

            .gallery-fullscreen-loader progress::-webkit-progress-bar {
                background-color: color-mix(in oklab, var(--color-white) 28%, transparent);
            }

            .gallery-fullscreen-loader progress::-webkit-progress-value {
                background-color: var(--color-white);
            }

            @media (max-width: 640px) {
                .gallery-lightbox-shell {
                    height: 100dvh;
                    width: 100vw;
                }

                .gallery-lightbox-toolbar,
                .gallery-lightbox-footer {
                    align-items: stretch;
                }

                .gallery-lightbox-title {
                    flex-basis: 100%;
                }
            }
        `}</style>
    )
}

function LockIcon() {
    return (
        <svg aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M16 10V7a4 4 0 0 0-8 0v3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
            <path d="M6 10h12v10H6V10Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
        </svg>
    )
}

function SettingsLink({characterId}: {characterId: string}) {
    return (
        <a
            aria-label="Content settings"
            class="btn btn-square btn-ghost absolute right-0 top-0"
            href={`/edit/${encodeURIComponent(characterId)}`}
            title="Settings"
        >
            <span class="sr-only">Content settings</span>
            <svg
                aria-hidden="true"
                class="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065Z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                />
                <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
            </svg>
        </a>
    )
}

function GalleryImage({allowNsfwToggle, deferMediaLoad, media}: {allowNsfwToggle: boolean; deferMediaLoad: boolean; media: DisplayMedia}) {
    const aspect = media.displayWidth / media.displayHeight
    const style = `--media-width:${media.displayWidth};--media-height:${media.displayHeight};--media-aspect:${aspect};`
    const revealWidth = media.nsfwDisplayWidth ?? media.displayWidth
    const revealHeight = media.nsfwDisplayHeight ?? media.displayHeight
    const displayPreviewUrl = media.displayPreviewUrl
    const displayUrl = media.displayUrl
    const nsfwDisplayPreviewUrl = media.nsfwDisplayPreviewUrl
    const nsfwDisplayUrl = media.nsfwDisplayUrl
    const safeDisplayPreviewUrl = media.safeDisplayPreviewUrl
    const safeDisplayUrl = media.safeDisplayUrl
    const initialSrc = displayPreviewUrl ?? displayUrl
    const hasOriginalUrl = Boolean(displayUrl)
    const canToggleNsfw = Boolean(allowNsfwToggle && nsfwDisplayUrl && safeDisplayUrl)
    const bookmarkId = `${media.id}:${media.isNsfw && !media.isNsfwHidden ? 'nsfw' : 'sfw'}`

    return (
        <div
            class={`gallery-media ${deferMediaLoad ? '' : 'image-loading'} rounded ${media.isNsfwHidden ? 'nsfw-media' : ''}`}
            data-nsfw-alt={canToggleNsfw ? media.nsfwImageAlt : undefined}
            data-nsfw-height={canToggleNsfw ? String(revealHeight) : undefined}
            data-nsfw-preview-url={canToggleNsfw && nsfwDisplayPreviewUrl ? nsfwDisplayPreviewUrl : undefined}
            data-nsfw-title={canToggleNsfw ? media.nsfwArtist : undefined}
            data-nsfw-toggle-target={canToggleNsfw ? 'true' : undefined}
            data-nsfw-url={canToggleNsfw ? nsfwDisplayUrl : undefined}
            data-nsfw-bookmark-id={canToggleNsfw ? `${media.id}:nsfw` : undefined}
            data-nsfw-width={canToggleNsfw ? String(revealWidth) : undefined}
            data-safe-alt={canToggleNsfw ? media.safeImageAlt : undefined}
            data-safe-height={canToggleNsfw && media.safeDisplayHeight ? String(media.safeDisplayHeight) : undefined}
            data-safe-hidden={canToggleNsfw ? String(media.safeDisplayIsNsfwHidden) : undefined}
            data-safe-preview-url={canToggleNsfw && safeDisplayPreviewUrl ? safeDisplayPreviewUrl : undefined}
            data-safe-title={canToggleNsfw ? media.safeDisplayTitle : undefined}
            data-safe-url={canToggleNsfw ? safeDisplayUrl : undefined}
            data-safe-bookmark-id={canToggleNsfw ? `${media.id}:sfw` : undefined}
            data-safe-width={canToggleNsfw && media.safeDisplayWidth ? String(media.safeDisplayWidth) : undefined}
            style={style}
        >
            <img
                alt={media.imageAlt}
                class="gallery-image"
                crossOrigin="anonymous"
                data-bookmark-id={bookmarkId}
                data-deferred-original-url={deferMediaLoad && hasOriginalUrl ? displayUrl : undefined}
                data-deferred-preview-src={deferMediaLoad && displayPreviewUrl ? displayPreviewUrl : undefined}
                data-deferred-src={deferMediaLoad ? initialSrc : undefined}
                data-nsfw-displayed={media.isNsfw && !media.isNsfwHidden ? 'true' : 'false'}
                data-nsfw-hidden={media.isNsfwHidden ? 'true' : 'false'}
                data-original-url={!deferMediaLoad && hasOriginalUrl ? displayUrl : undefined}
                data-title={media.artist}
                decoding="async"
                draggable={false}
                height={media.displayHeight}
                loading="lazy"
                src={!deferMediaLoad ? initialSrc : undefined}
                width={media.displayWidth}
            />
            {media.isNsfwHidden || media.safeDisplayIsNsfwHidden ? (
                <div aria-hidden="true" class="nsfw-media-warning" hidden={!media.isNsfwHidden}>
                    <div class="nsfw-media-badge">
                        <LockIcon />
                        <span>18+</span>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

function CharacterPageScript({
    allowNsfwToggle,
    defaultTabName,
    persistNsfwTogglePreference,
}: {
    allowNsfwToggle: boolean
    defaultTabName: string
    persistNsfwTogglePreference: boolean
}) {
    const script = `
const defaultTabName = ${safeJson(defaultTabName)};
const allowNsfwToggle = ${safeJson(allowNsfwToggle)};
const persistNsfwTogglePreference = ${safeJson(persistNsfwTogglePreference)};
const guestNsfwStorageKey = 'myoc:guest-display-nsfw-media';
const galleryImageMaxRetries = 3;
const galleryOriginalMaxRetries = 3;
const galleryOriginalIdleTimeout = 30000;
let galleryLightboxViewer = null;
let galleryLightboxColorPicking = false;
let galleryColorSampleImage = null;
let galleryColorSampleLoader = null;
let galleryColorSampleSrc = '';
let galleryCurrentLightboxBookmarkId = '';
let galleryLightboxObjectUrl = '';
let galleryLightboxRequestId = 0;
let galleryActiveOriginalRequest = null;
let gallerySuppressNextCloseBookmarkReset = false;
let galleryContextMenuImage = null;
let galleryContextMenuLongPressTimer = 0;
const galleryColorSampleCanvas = document.createElement('canvas');
galleryColorSampleCanvas.width = 1;
galleryColorSampleCanvas.height = 1;

function openLightbox(image, original, options = {}) {
    if (!original?.src) return;
    const lightbox = document.getElementById('gallery-lightbox');
    const lightboxTitle = document.getElementById('lightbox-title');
    const lightboxCredit = document.getElementById('lightbox-credit');
    const downloadLink = document.getElementById('lightbox-download');
    const src = original.src;
    const downloadSrc = original.sourceUrl || original.src;
    const title = image.dataset.title || 'Unknown artist';
    const dimensions = getGalleryImageDimensions(image);
    const width = Number(original.width || dimensions.width);
    const height = Number(original.height || dimensions.height);
    const bookmarkId = image.dataset.bookmarkId || mediaBookmarkIdFromUrl(downloadSrc);

    if (!lightbox || !src) return;

    const requestId = ++galleryLightboxRequestId;
    galleryCurrentLightboxBookmarkId = bookmarkId;
    lightbox.dataset.bookmarkId = bookmarkId;
    lightboxTitle.textContent = 'Image viewer';
    lightboxCredit.textContent = title;
    downloadLink.href = downloadSrc;
    downloadLink.download = sanitizeDownloadName(title, downloadSrc);
    resetLightboxColorState();
    if (!options.restoreBookmark) {
        updateGalleryBookmarkHash({image: bookmarkId, zoom: null, x: null, y: null}, {mode: 'push'});
    }
    if (!lightbox.open) {
        lightbox.showModal();
    }
    if (galleryLightboxObjectUrl && galleryLightboxObjectUrl !== src) {
        releaseGalleryLightboxObjectUrl();
    }
    galleryLightboxObjectUrl = original.objectUrl || '';
    setGalleryFullscreenLoaderStatus('Rendering image…');
    window.requestAnimationFrame(() => {
        if (requestId !== galleryLightboxRequestId || !lightbox.open || galleryLightboxObjectUrl !== original.objectUrl) return;
        window.requestAnimationFrame(() => {
            if (requestId !== galleryLightboxRequestId || !lightbox.open || galleryLightboxObjectUrl !== original.objectUrl) return;
            createLightboxViewer(src, width, height, downloadSrc, requestId);
        });
    });
}

function createLightboxViewer(src, width, height, sourceUrl = src, requestId = galleryLightboxRequestId) {
    if (requestId !== galleryLightboxRequestId) return;
    closeLightboxViewer({preserveObjectUrl: true, resetBookmark: false});

    const viewerElement = document.getElementById('lightbox-viewer');
    const viewerWrap = document.getElementById('lightbox-viewer-wrap');
    if (!viewerElement || typeof window.OpenSeadragon !== 'function') {
        if (viewerWrap) viewerWrap.classList.add('viewer-unavailable');
        setLightboxColorStatus('Viewer unavailable');
        setGalleryFullscreenLoaderVisible(false);
        releaseGalleryLightboxObjectUrl();
        return;
    }

    if (viewerWrap) viewerWrap.classList.remove('viewer-unavailable');
    viewerElement.innerHTML = '';
    const shouldUseHtmlOverlay = isGifImageUrl(sourceUrl);

    let viewer;
    try {
        viewer = window.OpenSeadragon({
            id: 'lightbox-viewer',
            prefixUrl: '/vendor/openseadragon/images/',
            drawer: 'html',
            crossOriginPolicy: 'Anonymous',
            ajaxWithCredentials: false,
            tileSources: {
                type: 'image',
                url: src,
                width,
                height,
                buildPyramid: false,
                crossOriginPolicy: 'Anonymous',
                ajaxWithCredentials: false,
            },
            showNavigator: true,
            navigatorPosition: 'BOTTOM_RIGHT',
            navigatorAutoFade: false,
            showNavigationControl: false,
            animationTime: 0.18,
            blendTime: 0,
            constrainDuringPan: true,
            imageLoaderLimit: 1,
            maxImageCacheCount: 1,
            preload: false,
            visibilityRatio: 1,
            minZoomImageRatio: 0.7,
            maxZoomPixelRatio: 8,
            gestureSettingsMouse: {
                clickToZoom: false,
                dblClickToZoom: true,
                dragToPan: true,
                scrollToZoom: true,
            },
            gestureSettingsTouch: {
                clickToZoom: false,
                dblClickToZoom: true,
                dragToPan: true,
                pinchToZoom: true,
            },
        });
    } catch {
        if (viewerWrap) viewerWrap.classList.add('viewer-unavailable');
        setLightboxColorStatus('Image unavailable');
        setGalleryFullscreenLoaderVisible(false);
        releaseGalleryLightboxObjectUrl();
        return;
    }

    galleryLightboxViewer = viewer;
    const isCurrentViewer = () => galleryLightboxViewer === viewer && requestId === galleryLightboxRequestId;
    let viewerFrameDrawn = false;
    const revealViewer = () => {
        if (!isCurrentViewer() || viewerFrameDrawn) return;
        viewerFrameDrawn = true;
        setGalleryFullscreenLoaderProgressComplete();
        window.requestAnimationFrame(() => {
            if (isCurrentViewer()) setGalleryFullscreenLoaderVisible(false);
        });
    };

    viewer.addHandler('tile-drawn', revealViewer);

    viewer.addHandler('open', () => {
        if (!isCurrentViewer()) return;
        if (shouldUseHtmlOverlay) {
            addGifLightboxOverlay(viewer, src, width, height);
        }
        viewer.viewport.goHome(true);
        setGalleryFullscreenLoaderStatus('Rendering image…');
    });
    viewer.addHandler('open-failed', () => {
        if (!isCurrentViewer()) return;
        if (viewerWrap) viewerWrap.classList.add('viewer-unavailable');
        setLightboxColorStatus('Image unavailable');
        setGalleryFullscreenLoaderVisible(false);
    });
    if (typeof viewer.bookmarkUrl === 'function') {
        viewer.bookmarkUrl({
            preserveHashParams: () => ({
                tab: getActiveGalleryTabName(),
                image: galleryCurrentLightboxBookmarkId,
            }),
            requiredHashParam: 'image',
        });
    }

    viewerElement.dataset.imageSrc = src;
    viewerElement.dataset.imageWidth = String(width);
    viewerElement.dataset.imageHeight = String(height);
    prepareLightboxColorSampler(src);
}

function isGifImageUrl(src) {
    try {
        return new URL(src, window.location.href).pathname.toLowerCase().endsWith('.gif');
    } catch {
        return /[.]gif(?:$|[?#])/i.test(String(src));
    }
}

function releaseGalleryLightboxObjectUrl() {
    if (!galleryLightboxObjectUrl) return;
    URL.revokeObjectURL(galleryLightboxObjectUrl);
    galleryLightboxObjectUrl = '';
}

function addGifLightboxOverlay(viewer, src, width, height) {
    if (!viewer || typeof viewer.addOverlay !== 'function' || !window.OpenSeadragon?.Rect) return;

    const image = document.createElement('img');
    image.alt = '';
    image.className = 'gallery-lightbox-gif-overlay';
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.id = 'lightbox-gif';
    image.src = src;

    const location = viewer.viewport.imageToViewportRectangle(new window.OpenSeadragon.Rect(0, 0, width, height));
    viewer.addOverlay({
        element: image,
        location,
    });
    image.parentElement?.style.setProperty('pointer-events', 'none');
}

function closeLightboxViewer(options = {}) {
    const resetBookmark = options.resetBookmark !== false;
    const updateHistory = options.updateHistory !== false;
    setLightboxColorPicking(false);
    const viewer = galleryLightboxViewer;
    galleryLightboxViewer = null;
    if (viewer) {
        try {
            viewer.close();
        } catch {}
        try {
            viewer.destroy();
        } catch {}
    }
    const viewerElement = document.getElementById('lightbox-viewer');
    if (viewerElement) {
        viewerElement.innerHTML = '';
        delete viewerElement.dataset.imageSrc;
        delete viewerElement.dataset.imageWidth;
        delete viewerElement.dataset.imageHeight;
    }
    galleryColorSampleImage = null;
    galleryColorSampleSrc = '';
    if (!options.preserveObjectUrl) releaseGalleryLightboxObjectUrl();
    if (resetBookmark) {
        galleryCurrentLightboxBookmarkId = '';
        const lightbox = document.getElementById('gallery-lightbox');
        if (lightbox) delete lightbox.dataset.bookmarkId;
        if (updateHistory) {
            updateGalleryBookmarkHash({image: null, zoom: null, x: null, y: null}, {mode: options.historyMode || 'replace'});
        }
    }
}

function initLightboxControls() {
    const lightbox = document.getElementById('gallery-lightbox');
    const zoomInButton = document.getElementById('lightbox-zoom-in');
    const zoomOutButton = document.getElementById('lightbox-zoom-out');
    const resetButton = document.getElementById('lightbox-reset');
    const colorButton = document.getElementById('lightbox-color-picker');
    const copyColorButton = document.getElementById('lightbox-color-copy');
    const closeButton = document.getElementById('lightbox-close');
    const viewerElement = document.getElementById('lightbox-viewer');

    if (!lightbox || lightbox.dataset.controlsBound === 'true') return;
    lightbox.dataset.controlsBound = 'true';

    zoomInButton?.addEventListener('click', () => zoomLightbox(1.35));
    zoomOutButton?.addEventListener('click', () => zoomLightbox(0.74));
    resetButton?.addEventListener('click', () => {
        if (galleryLightboxViewer) galleryLightboxViewer.viewport.goHome();
    });
    colorButton?.addEventListener('click', () => setLightboxColorPicking(!galleryLightboxColorPicking));
    copyColorButton?.addEventListener('click', () => copyLightboxPickedColor());
    closeButton?.addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('close', () => {
        galleryLightboxRequestId += 1;
        const shouldUpdateHistory = !gallerySuppressNextCloseBookmarkReset;
        gallerySuppressNextCloseBookmarkReset = false;
        closeLightboxViewer({
            historyMode: 'push',
            resetBookmark: true,
            updateHistory: shouldUpdateHistory,
        });
        setGalleryFullscreenLoaderVisible(false);
    });

    viewerElement?.addEventListener('pointermove', (event) => {
        if (!galleryLightboxColorPicking) return;
        event.preventDefault();
        event.stopPropagation();
        previewLightboxColor(event);
    }, {capture: true});
    viewerElement?.addEventListener('click', (event) => {
        if (!galleryLightboxColorPicking) return;
        event.preventDefault();
        event.stopPropagation();
        pickLightboxColor(event);
    }, {capture: true});
}

function zoomLightbox(ratio) {
    if (!galleryLightboxViewer) return;
    galleryLightboxViewer.viewport.zoomBy(ratio);
    galleryLightboxViewer.viewport.applyConstraints();
}

function setLightboxColorPicking(isPicking) {
    galleryLightboxColorPicking = Boolean(isPicking && galleryLightboxViewer);
    if (!galleryLightboxColorPicking) cancelLightboxColorSampler();
    const button = document.getElementById('lightbox-color-picker');
    const viewerElement = document.getElementById('lightbox-viewer');
    button?.classList.toggle('btn-active', galleryLightboxColorPicking);
    button?.setAttribute('aria-pressed', galleryLightboxColorPicking ? 'true' : 'false');
    viewerElement?.classList.toggle('is-color-picking', galleryLightboxColorPicking);
    setLightboxGifOverlayVisible(!galleryLightboxColorPicking);

    if (galleryLightboxViewer) {
        galleryLightboxViewer.setMouseNavEnabled(!galleryLightboxColorPicking);
    }

    if (galleryLightboxColorPicking && !galleryColorSampleImage) {
        loadLightboxColorSampler();
    }
}

function resetLightboxColorState() {
    cancelLightboxColorSampler();
    galleryColorSampleImage = null;
    galleryColorSampleSrc = '';
    setLightboxColorPicking(false);
    setLightboxColorPickerAvailable(true);
    setLightboxColorStatus('Pick a pixel');
    setLightboxPickedColor('');
    clearLightboxColorPreview();
}

function prepareLightboxColorSampler(src) {
    cancelLightboxColorSampler();
    galleryColorSampleImage = null;
    galleryColorSampleSrc = src;

    setLightboxColorPickerAvailable(true);
    setLightboxColorStatus('Pick a pixel');
}

function cancelLightboxColorSampler() {
    if (!galleryColorSampleLoader) return;
    galleryColorSampleLoader.onload = null;
    galleryColorSampleLoader.onerror = null;
    galleryColorSampleLoader.src = '';
    galleryColorSampleLoader = null;
}

function loadLightboxColorSampler() {
    const src = galleryColorSampleSrc;
    if (!src || galleryColorSampleImage || galleryColorSampleLoader) return;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    galleryColorSampleLoader = image;
    setLightboxColorStatus('Preparing color picker');
    image.onload = () => {
        if (galleryColorSampleLoader === image) galleryColorSampleLoader = null;
        if (galleryColorSampleSrc !== src) return;

        try {
            const context = galleryColorSampleCanvas.getContext('2d', {willReadFrequently: true});
            context.clearRect(0, 0, 1, 1);
            context.drawImage(image, 0, 0, 1, 1, 0, 0, 1, 1);
            context.getImageData(0, 0, 1, 1);
            galleryColorSampleImage = image;
            setLightboxColorStatus('Pick a pixel');
        } catch {
            galleryColorSampleImage = null;
            setLightboxColorPickerAvailable(false);
            setLightboxColorStatus('Color sampling unavailable');
        }
    };
    image.onerror = () => {
        if (galleryColorSampleLoader === image) galleryColorSampleLoader = null;
        if (galleryColorSampleSrc !== src) return;
        galleryColorSampleImage = null;
        setLightboxColorPickerAvailable(false);
        setLightboxColorStatus('Color sampling unavailable');
    };
    image.src = src;
}

function setLightboxColorPickerAvailable(isAvailable) {
    const button = document.getElementById('lightbox-color-picker');
    if (!button) return;

    button.disabled = !isAvailable;
    button.setAttribute('aria-disabled', isAvailable ? 'false' : 'true');
    if (!isAvailable) {
        setLightboxColorPicking(false);
    }
}

function lightboxImagePointFromEvent(event) {
    if (!galleryLightboxViewer || !window.OpenSeadragon) return null;
    const viewerElement = document.getElementById('lightbox-viewer');
    const tiledImage = galleryLightboxViewer.world.getItemAt(0);
    if (!viewerElement || !tiledImage) return null;

    const rect = viewerElement.getBoundingClientRect();
    const viewerPoint = new window.OpenSeadragon.Point(event.clientX - rect.left, event.clientY - rect.top);
    const viewportPoint = galleryLightboxViewer.viewport.pointFromPixel(viewerPoint);
    const imagePoint = tiledImage.viewportToImageCoordinates(viewportPoint);
    const width = Number(viewerElement.dataset.imageWidth || galleryColorSampleImage?.naturalWidth || 1);
    const height = Number(viewerElement.dataset.imageHeight || galleryColorSampleImage?.naturalHeight || 1);

    if (imagePoint.x < 0 || imagePoint.y < 0 || imagePoint.x >= width || imagePoint.y >= height) {
        return null;
    }

    return {
        x: Math.max(0, Math.min(width - 1, Math.floor(imagePoint.x))),
        y: Math.max(0, Math.min(height - 1, Math.floor(imagePoint.y))),
        width,
        height,
    };
}

function previewLightboxColor(event) {
    const point = lightboxImagePointFromEvent(event);
    if (!point || !galleryColorSampleImage) return;
    drawLightboxColorPreview(point);
}

function pickLightboxColor(event) {
    const point = lightboxImagePointFromEvent(event);
    if (!point || !galleryColorSampleImage) {
        setLightboxColorStatus('Pick inside the image');
        return;
    }

    try {
        const color = sampleLightboxColor(point.x, point.y);
        setLightboxPickedColor(color);
        drawLightboxColorPreview(point);
        setLightboxColorStatus('Color selected');
        setLightboxColorPicking(false);
    } catch {
        setLightboxColorStatus('Color sampling unavailable');
    }
}

function setLightboxGifOverlayVisible(isVisible) {
    const overlay = document.querySelector('.gallery-lightbox-gif-overlay');
    if (overlay) {
        overlay.hidden = !isVisible;
    }
}

function sampleLightboxColor(x, y) {
    const context = galleryColorSampleCanvas.getContext('2d', {willReadFrequently: true});
    context.clearRect(0, 0, 1, 1);
    context.drawImage(galleryColorSampleImage, x, y, 1, 1, 0, 0, 1, 1);
    const data = context.getImageData(0, 0, 1, 1).data;

    return rgbToHex(data[0], data[1], data[2]);
}

function drawLightboxColorPreview(point) {
    const preview = document.getElementById('lightbox-color-preview');
    if (!preview || !galleryColorSampleImage) return;

    const context = preview.getContext('2d');
    const radius = 6;
    const sx = Math.max(0, Math.min(point.width - (radius * 2 + 1), point.x - radius));
    const sy = Math.max(0, Math.min(point.height - (radius * 2 + 1), point.y - radius));
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, preview.width, preview.height);
    context.drawImage(galleryColorSampleImage, sx, sy, radius * 2 + 1, radius * 2 + 1, 0, 0, preview.width, preview.height);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect((preview.width / 2) - 4, (preview.height / 2) - 4, 8, 8);
    context.strokeStyle = '#000000';
    context.lineWidth = 1;
    context.strokeRect((preview.width / 2) - 5, (preview.height / 2) - 5, 10, 10);
}

function clearLightboxColorPreview() {
    const preview = document.getElementById('lightbox-color-preview');
    if (!preview) return;

    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
}

function setLightboxPickedColor(color) {
    const swatch = document.getElementById('lightbox-color-swatch');
    const copyButton = document.getElementById('lightbox-color-copy');
    const copyValue = document.getElementById('lightbox-color-copy-value');
    if (swatch) {
        if (color) {
            swatch.style.setProperty('--picked-color', color);
        } else {
            swatch.style.removeProperty('--picked-color');
        }
    }
    if (copyButton) {
        copyButton.disabled = !color;
        copyButton.dataset.color = color || '';
        copyButton.setAttribute('aria-label', color ? 'Copy ' + color : 'No color selected');
    }
    if (copyValue) {
        copyValue.textContent = color || 'No color selected';
    }
}

function setLightboxColorStatus(status) {
    const value = document.getElementById('lightbox-color-status');
    if (value) value.textContent = status;
}

function copyLightboxPickedColor() {
    const copyButton = document.getElementById('lightbox-color-copy');
    const color = copyButton?.dataset.color || '';
    if (!color) return;

    if (!navigator.clipboard?.writeText) {
        setLightboxColorStatus('Copy unavailable');
        return;
    }

    navigator.clipboard
        .writeText(color)
        .then(() => setLightboxColorStatus('Copied ' + color))
        .catch(() => setLightboxColorStatus('Copy unavailable'));
}

function rgbToHex(red, green, blue) {
    return '#' + [red, green, blue].map((value) => Number(value).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function sanitizeDownloadName(title, src) {
    let extension = 'png';
    try {
        const path = new URL(src, window.location.href).pathname;
        const match = path.match(/\\.([a-z0-9]+)$/i);
        if (match) extension = match[1].toLowerCase();
    } catch {}

    const baseName = String(title || 'myoc-gallery-image')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'myoc-gallery-image';

    return baseName + '.' + extension;
}

function parseGalleryBookmarkHash() {
    const rawHash = window.location.hash.replace(/^#/, '');
    if (!rawHash) return {};

    if (!rawHash.includes('=')) {
        return {tab: decodeURIComponent(rawHash)};
    }

    const params = new URLSearchParams(rawHash);
    return {
        tab: params.get('tab') || '',
        image: params.get('image') || '',
        zoom: parseBookmarkNumber(params.get('zoom')),
        x: parseBookmarkNumber(params.get('x')),
        y: parseBookmarkNumber(params.get('y')),
    };
}

function parseBookmarkNumber(value) {
    if (value === null || value === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function buildGalleryBookmarkHash(values) {
    const params = new URLSearchParams();
    if (values.tab) params.set('tab', values.tab);
    if (values.image) params.set('image', values.image);
    if (Number.isFinite(values.zoom)) params.set('zoom', String(values.zoom));
    if (Number.isFinite(values.x)) params.set('x', String(values.x));
    if (Number.isFinite(values.y)) params.set('y', String(values.y));
    const hash = params.toString();
    return hash ? '#' + hash : '';
}

function updateGalleryBookmarkHash(updates, options = {}) {
    const current = parseGalleryBookmarkHash();
    const next = {
        tab: current.tab || getActiveGalleryTabName() || defaultTabName,
        image: current.image || '',
        zoom: current.zoom,
        x: current.x,
        y: current.y,
        ...updates,
    };

    ['image', 'zoom', 'x', 'y'].forEach((key) => {
        if (next[key] === null) {
            delete next[key];
        }
    });

    const url = window.location.pathname + window.location.search + buildGalleryBookmarkHash(next);
    if (url !== window.location.pathname + window.location.search + window.location.hash) {
        const mode = options.mode === 'push' ? 'pushState' : 'replaceState';
        history[mode](null, '', url);
    }
}

function getActiveGalleryTabName() {
    const checkedInput = document.querySelector('input[name="gallery-sort"]:checked');
    if (checkedInput?.value) return checkedInput.value;
    const visiblePanel = Array.from(document.querySelectorAll('[data-gallery-tab-panel]')).find((panel) => !panel.hidden);
    return visiblePanel?.dataset.galleryTabPanel || defaultTabName;
}

function mediaBookmarkIdFromUrl(src) {
    try {
        const parts = new URL(src, window.location.href).pathname.split('/');
        const mediaIndex = parts.indexOf('media');
        if (mediaIndex !== -1 && parts[mediaIndex + 1] && parts[mediaIndex + 2]) {
            return parts[mediaIndex + 1] + ':' + parts[mediaIndex + 2];
        }
    } catch {}
    return '';
}

function showGalleryTab(tabId) {
    const normalizedTabId = tabId || defaultTabName;
    document.querySelectorAll('[data-gallery-tab-panel]').forEach((panel) => {
        const shouldShow = panel.dataset.galleryTabPanel === normalizedTabId;
        if (shouldShow) {
            activateGalleryTabPanel(panel);
        }
        panel.hidden = !shouldShow;
    });
    document.querySelectorAll('input[name="gallery-sort"]').forEach((input) => {
        input.checked = input.value === normalizedTabId;
    });
}

function activateGalleryTabPanel(panel) {
    if (panel.dataset.galleryTabActivated === 'true') return;

    panel.dataset.galleryTabActivated = 'true';
    initGalleryImageLoading(panel);
    panel.querySelectorAll('.gallery-image[data-deferred-src]').forEach((image) => {
        const media = image.closest('.gallery-media');
        const initialSrc = image.dataset.deferredSrc;
        const previewSrc = image.dataset.deferredPreviewSrc;
        const originalUrl = image.dataset.deferredOriginalUrl;

        delete image.dataset.deferredSrc;
        delete image.dataset.deferredPreviewSrc;
        delete image.dataset.deferredOriginalUrl;

        if (media && media.dataset.nsfwToggleTarget === 'true') {
            setGalleryMediaNsfwDisplay(media, getNsfwToggleDisplayState());
            return;
        }

        setGalleryMediaImageSource(image, previewSrc || initialSrc, originalUrl || initialSrc);
    });
    initLightbox(panel);
}

function initGallerySortOptions() {
    const sortInputs = Array.from(document.querySelectorAll('input[name="gallery-sort"]'));
    const validSortValues = sortInputs.map((input) => input.value);
    const bookmark = parseGalleryBookmarkHash();
    const requestedSort = bookmark.tab || defaultTabName;
    const initialSort = validSortValues.includes(requestedSort) ? requestedSort : defaultTabName;
    sortInputs.forEach((input) => {
        input.checked = input.value === initialSort;
    });
    if (!window.location.hash && initialSort) updateGalleryBookmarkHash({tab: initialSort});
    sortInputs.forEach((input) => {
        input.addEventListener('change', () => {
            if (!input.checked) return;
            showGalleryTab(input.value);
            updateGalleryBookmarkHash({tab: input.value, image: null, zoom: null, x: null, y: null});
        });
    });
    return initialSort;
}

function initLightbox(root = document) {
    root.querySelectorAll('.gallery-image').forEach((image) => {
        const interactionTarget = image.closest('.gallery-media') || image;
        if (interactionTarget.dataset.lightboxBound === 'true') return;
        interactionTarget.dataset.lightboxBound = 'true';
        updateGalleryImageOpenState(image);
        interactionTarget.addEventListener('click', (event) => {
            if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
                event.preventDefault();
                return;
            }
            if (image.dataset.longPressTriggered === 'true') {
                delete image.dataset.longPressTriggered;
                return;
            }
            requestGalleryImageAction(image, 'open');
        });
        interactionTarget.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            requestGalleryImageAction(image, 'open');
        });
        interactionTarget.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            clearGalleryLongPressTimer();
            showGalleryContextMenu(image, event.clientX, event.clientY);
        });
        interactionTarget.addEventListener('dragstart', (event) => event.preventDefault());
        bindGalleryLongPress(interactionTarget, image);
    });
}

function findGalleryImageByBookmarkId(bookmarkId) {
    return Array.from(document.querySelectorAll('.gallery-image')).find((image) => image.dataset.bookmarkId === bookmarkId);
}

function initGalleryFullscreenLoader() {
    const loader = document.getElementById('gallery-fullscreen-loader');
    const shell = document.querySelector('.gallery-lightbox-shell');
    if (!loader || !shell || shell.querySelector('.gallery-modal-fullscreen-loader')) return;

    const modalLoader = loader.cloneNode(true);
    modalLoader.removeAttribute('id');
    modalLoader.classList.add('gallery-modal-fullscreen-loader');
    modalLoader.hidden = true;
    modalLoader.setAttribute('aria-hidden', 'true');
    modalLoader.setAttribute('aria-busy', 'false');
    shell.append(modalLoader);
}

function getGalleryFullscreenLoaders() {
    return Array.from(document.querySelectorAll('[data-gallery-fullscreen-loader]'));
}

function setGalleryFullscreenLoaderVisible(isVisible) {
    getGalleryFullscreenLoaders().forEach((loader) => {
        loader.hidden = !isVisible;
        loader.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        loader.setAttribute('aria-busy', isVisible ? 'true' : 'false');
    });
}

function setGalleryFullscreenLoaderProgress(loadedBytes, totalBytes) {
    const total = Number(totalBytes) || 0;
    const loaded = Math.max(0, Number(loadedBytes) || 0);
    getGalleryFullscreenLoaders().forEach((loader) => {
        const progress = loader.querySelector('[data-gallery-loader-progress]');
        const label = loader.querySelector('[data-gallery-loader-progress-label]');
        if (!(progress instanceof HTMLProgressElement)) return;

        progress.hidden = total <= 0;
        if (total <= 0) {
            if (label) label.textContent = 'Downloading full-resolution image…';
            return;
        }

        const downloadProgress = Math.min(99, (loaded / total) * 99);
        progress.max = 100;
        progress.value = downloadProgress;
        if (label) label.textContent = Math.round(downloadProgress) + '%';
    });
}

function setGalleryFullscreenLoaderProgressComplete() {
    getGalleryFullscreenLoaders().forEach((loader) => {
        const progress = loader.querySelector('[data-gallery-loader-progress]');
        const label = loader.querySelector('[data-gallery-loader-progress-label]');
        if (!(progress instanceof HTMLProgressElement)) return;

        progress.hidden = false;
        progress.max = 100;
        progress.value = 100;
        if (label) label.textContent = '100%';
    });
}

function setGalleryFullscreenLoaderStatus(status) {
    getGalleryFullscreenLoaders().forEach((loader) => {
        const statusElement = loader.querySelector('[data-gallery-loader-status]');
        if (statusElement) statusElement.textContent = status;
    });
}

function openBookmarkedGalleryImageFromHash() {
    const bookmark = parseGalleryBookmarkHash();
    const lightbox = document.getElementById('gallery-lightbox');
    if (!bookmark.image) {
        setGalleryFullscreenLoaderVisible(false);
        if (lightbox?.open) {
            gallerySuppressNextCloseBookmarkReset = true;
            lightbox.close();
        }
        return;
    }

    if (lightbox?.open && lightbox.dataset.bookmarkId === bookmark.image) return;

    setGalleryFullscreenLoaderVisible(true);
    if (bookmark.image.endsWith(':nsfw') && allowNsfwToggle) {
        setNsfwMediaDisplay(true);
    }

    const image = findGalleryImageByBookmarkId(bookmark.image);
    if (!image) {
        setGalleryFullscreenLoaderVisible(false);
        return;
    }

    const panel = image.closest('[data-gallery-tab-panel]');
    if (panel?.dataset.galleryTabPanel) {
        showGalleryTab(panel.dataset.galleryTabPanel);
        if (!bookmark.tab) {
            updateGalleryBookmarkHash({tab: panel.dataset.galleryTabPanel});
        }
    }

    requestGalleryImageAction(image, 'open', {restoreBookmark: true, showBookmarkLoader: true});
}

function initGalleryBookmarkOpening() {
    openBookmarkedGalleryImageFromHash();
    window.addEventListener('hashchange', openBookmarkedGalleryImageFromHash);
    window.addEventListener('popstate', openBookmarkedGalleryImageFromHash);
}

function getGalleryOriginalUrl(image) {
    return image.dataset.originalUrl || '';
}

function getGalleryImageDimensions(image) {
    return {
        height: Number(image.getAttribute('height')) || image.naturalHeight || image.height || 1,
        width: Number(image.getAttribute('width')) || image.naturalWidth || image.width || 1,
    };
}

function updateGalleryImageOpenState(image) {
    const isInteractive = image.dataset.nsfwHidden !== 'true' && Boolean(getGalleryOriginalUrl(image));
    const interactionTarget = image.closest('.gallery-media') || image;
    interactionTarget.classList.toggle('gallery-media-openable', isInteractive);
    image.removeAttribute('role');
    image.removeAttribute('aria-label');
    image.removeAttribute('tabindex');

    if (isInteractive) {
        interactionTarget.setAttribute('role', 'button');
        interactionTarget.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
        interactionTarget.tabIndex = 0;
        interactionTarget.removeAttribute('aria-disabled');
        return;
    }

    interactionTarget.removeAttribute('role');
    interactionTarget.removeAttribute('aria-label');
    interactionTarget.removeAttribute('tabindex');
    interactionTarget.setAttribute('aria-disabled', 'true');
}

function setGalleryImageLoading(image, isLoading) {
    const media = image.closest('.gallery-media');
    if (!media) return;
    media.classList.toggle('image-loading', Boolean(isLoading));
    updateGalleryImageOpenState(image);
}

function clearGalleryLongPressTimer() {
    if (galleryContextMenuLongPressTimer) {
        window.clearTimeout(galleryContextMenuLongPressTimer);
        galleryContextMenuLongPressTimer = 0;
    }
}

function bindGalleryLongPress(interactionTarget, image) {
    let startX = 0;
    let startY = 0;

    interactionTarget.addEventListener('pointerdown', (event) => {
        if (event.pointerType !== 'touch') return;
        clearGalleryLongPressTimer();
        delete image.dataset.longPressTriggered;
        startX = event.clientX;
        startY = event.clientY;
        galleryContextMenuLongPressTimer = window.setTimeout(() => {
            image.dataset.longPressTriggered = 'true';
            galleryContextMenuLongPressTimer = 0;
            showGalleryContextMenu(image, event.clientX, event.clientY);
        }, 600);
    });
    interactionTarget.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'touch') return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) {
            clearGalleryLongPressTimer();
        }
    });
    interactionTarget.addEventListener('pointerup', clearGalleryLongPressTimer);
    interactionTarget.addEventListener('pointercancel', clearGalleryLongPressTimer);
}

function hideGalleryContextMenu() {
    const menu = document.getElementById('gallery-context-menu');
    if (!menu) return;
    menu.hidden = true;
    menu.classList.add('hidden');
    galleryContextMenuImage = null;
}

function showGalleryContextMenu(image, clientX, clientY) {
    const menu = document.getElementById('gallery-context-menu');
    if (!menu || image.dataset.nsfwHidden === 'true' || !getGalleryOriginalUrl(image)) return;

    galleryContextMenuImage = image;
    menu.hidden = false;
    menu.classList.remove('hidden');
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';

    window.requestAnimationFrame(() => {
        if (galleryContextMenuImage !== image) return;
        const margin = 8;
        const left = Math.min(Math.max(margin, clientX), window.innerWidth - menu.offsetWidth - margin);
        const top = Math.min(Math.max(margin, clientY), window.innerHeight - menu.offsetHeight - margin);
        menu.style.left = String(left) + 'px';
        menu.style.top = String(top) + 'px';
        menu.style.visibility = '';
        menu.querySelector('button')?.focus();
    });
}

function initGalleryContextMenu() {
    const menu = document.getElementById('gallery-context-menu');
    if (!menu || menu.dataset.bound === 'true') return;
    menu.dataset.bound = 'true';

    menu.querySelectorAll('[data-gallery-context-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const image = galleryContextMenuImage;
            const action = button.dataset.galleryContextAction;
            hideGalleryContextMenu();
            if (!image || !action) return;

            if (action === 'open') {
                window.open(getGalleryOriginalUrl(image), '_blank', 'noopener,noreferrer');
                return;
            }

            requestGalleryImageAction(image, action);
        });
    });
    document.addEventListener('pointerdown', (event) => {
        if (!menu.contains(event.target)) hideGalleryContextMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideGalleryContextMenu();
    });
    document.addEventListener('scroll', hideGalleryContextMenu, true);
}

function loadGalleryOriginalImage(image, onLoad, onError) {
    const originalSrc = getGalleryOriginalUrl(image);
    if (!originalSrc) {
        onError?.();
        return;
    }

    const existingRequest = image.galleryOriginalRequest;
    if (existingRequest?.src === originalSrc) {
        existingRequest.callbacks.push(onLoad);
        existingRequest.errorCallbacks.push(onError);
        return existingRequest;
    }

    galleryActiveOriginalRequest?.cancel();
    existingRequest?.cancel();
    let resolveBlob;
    const blobPromise = new Promise((resolve) => {
        resolveBlob = resolve;
    });
    const request = {
        blobPromise,
        callbacks: [onLoad],
        errorCallbacks: [onError],
        retryCount: 0,
        resolveBlob,
        settled: false,
        src: originalSrc,
    };
    image.galleryOriginalRequest = request;
    galleryActiveOriginalRequest = request;

    const clearIdleTimeout = () => {
        if (request.idleTimer) {
            window.clearTimeout(request.idleTimer);
            request.idleTimer = 0;
        }
    };

    const resetIdleTimeout = () => {
        clearIdleTimeout();
        request.idleTimer = window.setTimeout(() => request.controller?.abort(), galleryOriginalIdleTimeout);
    };

    const finish = (loaded, objectUrl, width, height) => {
        if (request.settled) return;
        request.settled = true;
        clearIdleTimeout();
        if (request.objectUrl === objectUrl) {
            request.objectUrl = '';
        }
        if (galleryActiveOriginalRequest === request) {
            galleryActiveOriginalRequest = null;
        }
        if (image.galleryOriginalRequest === request) {
            delete image.galleryOriginalRequest;
        }

        const isCurrent = getGalleryOriginalUrl(image) === request.src;
        if (loaded && isCurrent) {
            const dimensions = getGalleryImageDimensions(image);
            const original = {
                height: height || dimensions.height,
                objectUrl,
                sourceUrl: request.src,
                src: objectUrl,
                width: width || dimensions.width,
            };
            request.callbacks.forEach((callback) => callback(original));
        } else if (isCurrent) {
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            request.errorCallbacks.forEach((callback) => callback?.());
        } else if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
        }
    };

    request.cancel = () => {
        if (request.settled) return;
        request.settled = true;
        clearIdleTimeout();
        if (galleryActiveOriginalRequest === request) {
            galleryActiveOriginalRequest = null;
        }
        request.controller?.abort();
        request.reader?.cancel();
        if (request.objectUrl) {
            URL.revokeObjectURL(request.objectUrl);
            request.objectUrl = '';
        }
        request.resolveBlob(null);
        if (image.galleryOriginalRequest === request) {
            delete image.galleryOriginalRequest;
        }
    };

    const startAttempt = () => {
        request.controller = new AbortController();
        setGalleryFullscreenLoaderStatus(request.retryCount ? 'Retrying full-resolution image…' : 'Downloading full-resolution image…');
        setGalleryFullscreenLoaderProgress(0, 0);
        resetIdleTimeout();
        fetch(request.src, {cache: 'no-store', credentials: 'omit', mode: 'cors', signal: request.controller.signal})
            .then(async (response) => {
                if (!response.ok) throw new Error('Image download failed');
                resetIdleTimeout();
                const totalBytes = Number(response.headers.get('content-length')) || 0;
                if (!response.body) {
                    const blob = await response.blob();
                    clearIdleTimeout();
                    setGalleryFullscreenLoaderProgress(blob.size, blob.size);
                    return {blob, totalBytes: blob.size};
                }

                const reader = response.body.getReader();
                request.reader = reader;
                const chunks = [];
                let loadedBytes = 0;
                while (true) {
                    const result = await reader.read();
                    if (result.done) break;
                    chunks.push(result.value);
                    loadedBytes += result.value.byteLength;
                    setGalleryFullscreenLoaderProgress(loadedBytes, totalBytes);
                    resetIdleTimeout();
                }

                clearIdleTimeout();
                return {
                    blob: new Blob(chunks, {type: response.headers.get('content-type') || 'application/octet-stream'}),
                    totalBytes: totalBytes || loadedBytes,
                };
            })
            .then(({blob, totalBytes}) => {
                if (request.settled) return;
                const objectUrl = URL.createObjectURL(blob);
                request.objectUrl = objectUrl;
                request.resolveBlob(blob);
                setGalleryFullscreenLoaderProgress(totalBytes, totalBytes);
                setGalleryFullscreenLoaderStatus('Opening image viewer…');
                finish(true, objectUrl, 0, 0);
            })
            .catch(() => {
                clearIdleTimeout();
                if (request.settled) return;
                if (request.retryCount < galleryOriginalMaxRetries) {
                    request.retryCount += 1;
                    startAttempt();
                    return;
                }
                request.resolveBlob(null);
                finish(false, request.objectUrl || '', 0, 0);
            });
    };

    startAttempt();
    return request;
}

function requestGalleryImageAction(image, action, options = {}) {
    if (image.dataset.nsfwHidden === 'true' || !getGalleryOriginalUrl(image)) {
        if (options.showBookmarkLoader) setGalleryFullscreenLoaderVisible(false);
        return;
    }
    setGalleryFullscreenLoaderVisible(true);
    setGalleryFullscreenLoaderProgress(0, 0);
    setGalleryFullscreenLoaderStatus('Preparing full-resolution image…');
    if (action === 'open' && galleryLightboxViewer) {
        galleryLightboxRequestId += 1;
        closeLightboxViewer({resetBookmark: false, updateHistory: false});
    }

    const originalSrc = getGalleryOriginalUrl(image);
    const request = loadGalleryOriginalImage(
        image,
        (original) => {
            if (action === 'open') {
                openLightbox(image, original, options);
            } else if (action === 'download') {
                downloadGalleryOriginal(original.src, image.dataset.title, original.sourceUrl).finally(() => {
                    setGalleryFullscreenLoaderVisible(false);
                    URL.revokeObjectURL(original.src);
                });
            }
        },
        () => {
            setGalleryFullscreenLoaderVisible(false);
            setGalleryFullscreenLoaderStatus('Unable to load the full-resolution image');
        },
    );
    if (action === 'copy') {
        copyGalleryOriginal(request, originalSrc).finally(() => {
            setGalleryFullscreenLoaderVisible(false);
            if (request?.objectUrl) {
                URL.revokeObjectURL(request.objectUrl);
                request.objectUrl = '';
            }
        });
    }
}

async function downloadGalleryOriginal(src, title, fallbackSrc = src) {
    try {
        const link = document.createElement('a');
        link.download = sanitizeDownloadName(title || 'myoc-gallery-image', src);
        link.href = src;
        link.click();
    } catch {
        window.open(fallbackSrc, '_blank', 'noopener,noreferrer');
    }
}

function getGalleryClipboardMimeType(src) {
    try {
        const pathname = new URL(src, window.location.href).pathname.toLowerCase();
        if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
        if (pathname.endsWith('.gif')) return 'image/gif';
        if (pathname.endsWith('.webp')) return 'image/webp';
        if (pathname.endsWith('.avif')) return 'image/avif';
    } catch {}
    return 'image/png';
}

async function copyGalleryOriginal(request, fallbackSrc = request?.src) {
    try {
        if (!request?.blobPromise || !navigator.clipboard?.write || typeof window.ClipboardItem !== 'function') {
            throw new Error('Image copy unavailable');
        }
        const mimeType = getGalleryClipboardMimeType(request.src);
        const item = new window.ClipboardItem({
            [mimeType]: request.blobPromise.then((blob) => {
                if (!blob) throw new Error('Copy failed');
                return blob;
            }),
        });
        await navigator.clipboard.write([item]);
    } catch {
        await navigator.clipboard?.writeText(fallbackSrc);
    }
}

function resetGalleryImageRetry(image, src) {
    image.dataset.imageRetryBaseSrc = src;
    image.dataset.imageRetryCount = '0';
    image.dataset.imageRetrySourceVersion = image.dataset.sourceVersion || '';
}

function finishGalleryImageLoad(image) {
    delete image.dataset.imageRetryCount;
    delete image.dataset.imageRetryBaseSrc;
    delete image.dataset.imageRetrySourceVersion;
    setGalleryImageLoading(image, false);
}

function retryGalleryImageLoad(image) {
    const baseSrc = image.dataset.imageRetryBaseSrc || image.src;
    const sourceVersion = image.dataset.imageRetrySourceVersion || '';

    if (sourceVersion !== (image.dataset.sourceVersion || '')) {
        return;
    }

    const retryCount = Number(image.dataset.imageRetryCount || '0');
    if (retryCount >= galleryImageMaxRetries) {
        setGalleryImageLoading(image, false);
        return;
    }

    const nextRetryCount = retryCount + 1;
    image.dataset.imageRetryCount = String(nextRetryCount);
    setGalleryImageLoading(image, true);
    image.removeAttribute('src');
    image.src = baseSrc;
}

function refreshGalleryImageLoading(image) {
    setGalleryImageLoading(image, !(image.complete && image.naturalWidth > 0));
}

function initGalleryImageLoading(root = document) {
    root.querySelectorAll('.gallery-image').forEach((image) => {
        if (image.dataset.loadingBound === 'true') {
            refreshGalleryImageLoading(image);
            return;
        }
        image.dataset.loadingBound = 'true';
        resetGalleryImageRetry(image, image.currentSrc || image.src);
        image.addEventListener('load', () => finishGalleryImageLoad(image));
        image.addEventListener('error', () => retryGalleryImageLoad(image));
        refreshGalleryImageLoading(image);
    });
}

function setGalleryImageSource(image, src) {
    if (image.src === src) {
        resetGalleryImageRetry(image, src);
        if (image.complete && image.naturalWidth === 0) {
            retryGalleryImageLoad(image);
            return;
        }
        refreshGalleryImageLoading(image);
        updateGalleryImageOpenState(image);
        return;
    }
    resetGalleryImageRetry(image, src);
    setGalleryImageLoading(image, true);
    image.src = src;
    refreshGalleryImageLoading(image);
    updateGalleryImageOpenState(image);
}

function cancelGalleryOriginalLoad(image) {
    const request = image.galleryOriginalRequest;
    request?.cancel();
    if (request) setGalleryFullscreenLoaderVisible(false);
}

function setGalleryMediaImageSource(image, previewSrc, originalSrc) {
    if (!previewSrc && !originalSrc) return;
    cancelGalleryOriginalLoad(image);
    image.dataset.sourceVersion = String(Number(image.dataset.sourceVersion || '0') + 1);
    if (originalSrc) {
        image.dataset.originalUrl = originalSrc;
    } else {
        delete image.dataset.originalUrl;
    }
    setGalleryImageSource(image, previewSrc || originalSrc);
}

function setNsfwToggleButtons(displayNsfwMedia) {
    document.querySelectorAll('[data-display-nsfw-media]').forEach((button) => {
        button.textContent = displayNsfwMedia ? 'Hide 18+ media' : 'Load 18+ media';
        button.dataset.displayNsfwMedia = displayNsfwMedia ? 'true' : 'false';
        button.setAttribute('aria-pressed', displayNsfwMedia ? 'true' : 'false');
    });
}

function isDisplayingNsfwMedia() {
    return Array.from(document.querySelectorAll('[data-nsfw-toggle-target="true"] .gallery-image'))
        .some((image) => image.dataset.nsfwDisplayed === 'true');
}

function getNsfwToggleDisplayState() {
    const button = document.querySelector('[data-display-nsfw-media]');
    if (!button) return isDisplayingNsfwMedia();
    return button.dataset.displayNsfwMedia === 'true';
}

function setGalleryMediaNsfwDisplay(media, displayNsfwMedia) {
    const image = media.querySelector('.gallery-image');
    const imageUrl = displayNsfwMedia ? media.dataset.nsfwUrl : media.dataset.safeUrl;
    if (!image || !imageUrl) return;

    const previewUrl = displayNsfwMedia ? media.dataset.nsfwPreviewUrl : media.dataset.safePreviewUrl;
    const bookmarkId = displayNsfwMedia ? media.dataset.nsfwBookmarkId : media.dataset.safeBookmarkId;
    const width = Number((displayNsfwMedia ? media.dataset.nsfwWidth : media.dataset.safeWidth) || image.width || 1);
    const height = Number((displayNsfwMedia ? media.dataset.nsfwHeight : media.dataset.safeHeight) || image.height || 1);
    const title = displayNsfwMedia ? media.dataset.nsfwTitle : media.dataset.safeTitle;
    const alt = displayNsfwMedia ? media.dataset.nsfwAlt : media.dataset.safeAlt;
    const isHidden = displayNsfwMedia ? false : media.dataset.safeHidden === 'true';
    const warning = media.querySelector('.nsfw-media-warning');

    setGalleryMediaImageSource(image, previewUrl || imageUrl, imageUrl);
    image.alt = alt || image.alt;
    image.dataset.title = title || image.dataset.title || image.alt;
    image.dataset.bookmarkId = bookmarkId || image.dataset.bookmarkId || '';
    image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
    image.dataset.nsfwDisplayed = displayNsfwMedia ? 'true' : 'false';
    image.dataset.nsfwHidden = isHidden ? 'true' : 'false';
    image.width = width;
    image.height = height;
    media.style.setProperty('--media-width', String(width));
    media.style.setProperty('--media-height', String(height));
    media.style.setProperty('--media-aspect', String(width / height));

    if (isHidden) {
        media.classList.add('nsfw-media');
        if (warning) warning.hidden = false;
    } else {
        media.classList.remove('nsfw-media');
        if (warning) warning.hidden = true;
    }
    updateGalleryImageOpenState(image);
}

function setNsfwMediaDisplay(displayNsfwMedia) {
    document.querySelectorAll('[data-nsfw-toggle-target="true"]').forEach((media) => {
        setGalleryMediaNsfwDisplay(media, displayNsfwMedia);
    });

    setNsfwToggleButtons(displayNsfwMedia);
    initLightbox();
}

function initNsfwToggle() {
    if (!allowNsfwToggle) return;
    const buttons = Array.from(document.querySelectorAll('[data-display-nsfw-media]'));
    if (buttons.length === 0) return;

    buttons.forEach((button) => {
        button.addEventListener('click', () => {
            const shouldDisplay = button.dataset.displayNsfwMedia !== 'true';
            if (persistNsfwTogglePreference) {
                try {
                    localStorage.setItem(guestNsfwStorageKey, shouldDisplay ? 'true' : 'false');
                } catch {}
            }
            setNsfwMediaDisplay(shouldDisplay);
        });
    });

    if (persistNsfwTogglePreference) {
        try {
            if (localStorage.getItem(guestNsfwStorageKey) === 'true') {
                setNsfwMediaDisplay(true);
                return;
            }
        } catch {}
    }

    setNsfwToggleButtons(isDisplayingNsfwMedia());
}

const initialGalleryTabName = initGallerySortOptions();
initGalleryImageLoading();
initLightboxControls();
initGalleryContextMenu();
initLightbox();
initGalleryFullscreenLoader();
showGalleryTab(initialGalleryTabName);
initNsfwToggle();
initGalleryBookmarkOpening();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function CharacterPage({
    currentUser,
    profileUser,
    character,
    media,
    galleryTabs,
    mediaBaseUrl,
    metaDescriptionFallback,
    siteUrl,
}: CharacterPageProps) {
    const displayNsfwMedia = Boolean(currentUser?.displayNsfwMedia)
    const allowNsfwToggle = media.some((item) => Boolean(item.nsfwImageKey))
    const mediaById = new Map(media.map((item) => [item.id, displayMediaFor(item, character, mediaBaseUrl, displayNsfwMedia)]))
    const tabs =
        galleryTabs.length > 0
            ? galleryTabs
            : [
                  {
                      id: 'default',
                      name: 'default',
                      rows: [
                          {
                              id: 'default-row',
                              mediaIds: media.map((item) => item.id),
                              forceFullWidth: false,
                          },
                      ],
                  },
              ]
    const defaultTabName = tabs[0]?.name ?? 'default'
    const ownerProfileImageUrl = profileImageFor(profileUser, mediaBaseUrl)
    const characterThumbnailUrl = characterProfileImageUrl(mediaBaseUrl, profileUser.id, character.id, character.profileImageKey)
    const pageTitle = `${character.name} | MyOC`
    const canEdit = currentUser?.id === profileUser.id

    return (
        <BaseLayout
            head={
                <>
                    <CharacterPageHead
                        character={character}
                        imageUrl={characterThumbnailUrl}
                        metaDescriptionFallback={metaDescriptionFallback}
                        pageTitle={pageTitle}
                        profileUser={profileUser}
                        siteUrl={siteUrl}
                    />
                    <CharacterPageStyles />
                </>
            }
            title={pageTitle}
        >
            <Navbar
                currentUser={currentUser}
                guestInitial={profileUser.username.trim().charAt(0).toUpperCase() || 'R'}
                mediaBaseUrl={mediaBaseUrl}
            />
            <main class="container mx-auto px-3 py-4 sm:px-4 lg:px-6">
                <header class="relative mb-8 pr-12 sm:pr-14">
                    {canEdit ? <SettingsLink characterId={character.id} /> : null}

                    <div class="flex flex-col gap-5 border-b border-base-300 pb-6 lg:flex-row lg:items-end lg:justify-between">
                        <div class="flex min-w-0 items-center gap-4 sm:gap-5">
                            <div class="avatar shrink-0">
                                <div class="w-24 rounded-box bg-base-300 ring-1 ring-base-content/15 sm:w-32">
                                    <img
                                        alt={`${character.name} portrait`}
                                        class="h-full w-full object-contain"
                                        decoding="async"
                                        height="128"
                                        loading="lazy"
                                        src={characterThumbnailUrl}
                                        width="128"
                                    />
                                </div>
                            </div>

                            <div class="min-w-0">

                                <h1 class="mt-2 wrap-break-word text-2xl font-bold tracking-tight sm:text-5xl">{character.name}</h1>
                                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/70">
                                    <span aria-hidden="true">by</span>
                                    <a
                                        class="inline-flex min-w-0 items-center gap-2 font-semibold text-base-content transition-colors hover:text-base-content/70"
                                        href={`/u/${encodeURIComponent(profileUser.username)}`}
                                    >
                                        <span class="avatar shrink-0">
                                            <div class="h-8 w-8 rounded-full ring-1 ring-base-content/10">
                                                <img
                                                    alt={`${profileUser.username} avatar`}
                                                    class="h-full w-full object-cover"
                                                    decoding="async"
                                                    height="28"
                                                    loading="lazy"
                                                    src={ownerProfileImageUrl}
                                                    width="28"
                                                />
                                            </div>
                                        </span>
                                        <span class="truncate">{profileUser.username}</span>
                                    </a>
                                </div>
                            </div>
                        </div>

                        {character.hasHeightChart || allowNsfwToggle ? (
                            <div class="flex flex-wrap gap-2 lg:justify-end">
                                {character.hasHeightChart ? (
                                    <a class="btn btn-primary btn-sm" href={sizeChartUrlForCharacter(character.id)}>
                                        View in Size Chart
                                    </a>
                                ) : null}
                                {allowNsfwToggle ? (
                                    <button
                                        aria-pressed={displayNsfwMedia ? 'true' : 'false'}
                                        class="btn btn-outline btn-sm"
                                        data-display-nsfw-media={displayNsfwMedia ? 'true' : 'false'}
                                        type="button"
                                    >
                                        {displayNsfwMedia ? 'Hide 18+ media' : 'Load 18+ media'}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    {character.description ? (
                        <div class="pt-5">
                            <p class="whitespace-pre-wrap text-base leading-7 text-base-content/70">{character.description}</p>
                        </div>
                    ) : null}
                </header>

                <section aria-labelledby="gallery-heading" class="mb-5">
                    <div class="flex flex-col gap-3 border-b border-base-300 pb-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <h2 class="mt-1 text-2xl font-semibold" id="gallery-heading">
                                Gallery
                            </h2>
                        </div>

                        {tabs.length > 1 ? (
                            <div aria-label="Gallery sort options" class="tabs tabs-border max-w-full gap-1 overflow-x-auto" role="tablist">
                                {tabs.map((tab, index) => (
                                    <label class="shrink-0 cursor-pointer">
                                        <input
                                            checked={index === 0}
                                            class="peer sr-only"
                                            name="gallery-sort"
                                            type="radio"
                                            value={tab.name}
                                        />
                                        <span class="tab inline-flex border-b-2 border-transparent px-3 peer-checked:border-base-content peer-checked:font-semibold">
                                            {displayGalleryTabName(tab.name)}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </section>

                {tabs.map((tab, tabIndex) => {
                    const visualRows =
                        tab.rows.length > 0
                            ? tab.rows.flatMap((row, rowIndex) => {
                                  const rowMedia = row.mediaIds
                                      .map((mediaId) => mediaById.get(mediaId))
                                      .filter((item): item is DisplayMedia => Boolean(item))

                                  return chunkGalleryItems(rowMedia).map((mediaItems, index) => ({
                                      forceFullWidth:
                                          shouldForceGalleryRowFullWidth(row, rowIndex, tab.rows.length) &&
                                          rowMedia.length === 1 &&
                                          mediaItems.length === 1 &&
                                          index === 0,
                                      mediaItems,
                                  }))
                              })
                            : chunkGalleryItems([...mediaById.values()].filter((item): item is DisplayMedia => Boolean(item))).map(
                                  (mediaItems) => ({
                                      forceFullWidth: false,
                                      mediaItems,
                                  }),
                              )

                    return (
                        <section class="gallery-tab-panel justified-gallery" data-gallery-tab-panel={tab.name} hidden={tabIndex > 0}>
                            {visualRows.map((row) => (
                                <div class={`justified-row ${row.forceFullWidth ? 'row-force-full-width' : ''}`}>
                                    {row.mediaItems.map((item) => (
                                        <GalleryImage
                                            allowNsfwToggle={allowNsfwToggle}
                                            deferMediaLoad={tabs.length > 1 && tabIndex > 0}
                                            media={item}
                                        />
                                    ))}
                                </div>
                            ))}
                        </section>
                    )
                })}

                {media.length === 0 ? (
                    <section class="rounded-box border border-base-300 bg-base-200 p-8 text-center text-base-content/70">
                        <p>No gallery media has been added for this character yet.</p>
                    </section>
                ) : null}
            </main>

            <dialog class="modal backdrop:bg-black/75" id="gallery-lightbox">
                <div class="modal-box gallery-lightbox-shell max-w-none border border-base-content/20 bg-base-200 p-0 shadow-2xl">
                    <div class="gallery-lightbox-toolbar">
                        <h2 class="gallery-lightbox-title text-base font-semibold" id="lightbox-title">
                            <span class="sr-only">Selected gallery item</span>
                        </h2>
                        <div class="flex flex-wrap items-center gap-2">
                            <div class="tooltip tooltip-bottom" data-tip="Zoom in">
                                <button aria-label="Zoom in" class="btn btn-square btn-sm" id="lightbox-zoom-in" type="button">
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                    </svg>
                                </button>
                            </div>
                            <div class="tooltip tooltip-bottom" data-tip="Zoom out">
                                <button aria-label="Zoom out" class="btn btn-square btn-sm" id="lightbox-zoom-out" type="button">
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="M5 12h14" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                    </svg>
                                </button>
                            </div>
                            <div class="tooltip tooltip-bottom" data-tip="Fit image">
                                <button aria-label="Fit image" class="btn btn-square btn-sm" id="lightbox-reset" type="button">
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                        />
                                    </svg>
                                </button>
                            </div>
                            <div class="tooltip tooltip-bottom" data-tip="Pick color">
                                <button
                                    aria-label="Pick color"
                                    aria-pressed="false"
                                    class="btn btn-square btn-sm"
                                    id="lightbox-color-picker"
                                    type="button"
                                >
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="m2 22 1-1h3l9-9" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                        <path d="M3 21v-3l9-9" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                        <path d="m15 6 3-3 3 3-3 3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                        <path d="m11 10 3 3 6-6-3-3-6 6Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                    </svg>
                                </button>
                            </div>
                            <div class="tooltip tooltip-bottom" data-tip="Download">
                                <a aria-label="Download image" class="btn btn-square btn-sm" href="/" id="lightbox-download">
                                    <span class="sr-only">Download image</span>
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="M12 3v12M7 10l5 5 5-5" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                        <path d="M5 21h14" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                    </svg>
                                </a>
                            </div>
                            <div class="tooltip tooltip-bottom" data-tip="Close">
                                <button aria-label="Close" class="btn btn-square btn-sm" id="lightbox-close" type="button">
                                    <svg
                                        aria-hidden="true"
                                        class="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="gallery-lightbox-viewer-wrap" id="lightbox-viewer-wrap">
                        <div
                            aria-label="Gallery image viewer"
                            class="gallery-lightbox-viewer"
                            id="lightbox-viewer"
                            role="application"
                        ></div>
                        <div class="gallery-lightbox-empty-state">
                            <p class="text-sm text-base-content/70">This image could not be loaded in the viewer.</p>
                        </div>
                    </div>
                    <div class="gallery-lightbox-footer">
                        <div class="gallery-lightbox-credit">
                            <p class="text-xs uppercase tracking-wide text-base-content/60">Artist</p>
                            <p class="truncate text-sm font-medium" id="lightbox-credit">
                                Unknown artist
                            </p>
                        </div>
                        <div class="flex items-center gap-3">
                            <canvas
                                aria-label="Color zoom preview"
                                class="gallery-color-preview rounded"
                                height="80"
                                id="lightbox-color-preview"
                                width="80"
                            ></canvas>
                            <div class="flex min-w-0 items-center gap-2 text-sm">
                                <span aria-hidden="true" class="gallery-color-swatch rounded" id="lightbox-color-swatch"></span>
                                <button
                                    aria-label="No color selected"
                                    class="btn btn-xs min-w-32 justify-start font-mono"
                                    disabled
                                    id="lightbox-color-copy"
                                    type="button"
                                >
                                    <svg
                                        aria-hidden="true"
                                        class="h-3.5 w-3.5 shrink-0"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <rect
                                            height="14"
                                            rx="2"
                                            ry="2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                            width="14"
                                            x="8"
                                            y="8"
                                        />
                                        <path
                                            d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                            stroke-width="2"
                                        />
                                    </svg>
                                    <span id="lightbox-color-copy-value">No color selected</span>
                                </button>
                                <span class="truncate text-xs text-base-content/70" id="lightbox-color-status">
                                    Pick a pixel
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <div
                aria-label="Image actions"
                class="fixed z-50 hidden min-w-52 rounded-box border border-base-content/20 bg-base-200 p-2 shadow-2xl"
                id="gallery-context-menu"
                role="menu"
            >
                <ul class="menu menu-sm w-full p-0">
                    <li>
                        <button data-gallery-context-action="download" role="menuitem" type="button">
                            Download original
                        </button>
                    </li>
                    <li>
                        <button data-gallery-context-action="copy" role="menuitem" type="button">
                            Copy original image
                        </button>
                    </li>
                    <li>
                        <button data-gallery-context-action="open" role="menuitem" type="button">
                            Open original in new window
                        </button>
                    </li>
                </ul>
            </div>

            <div
                aria-busy="true"
                aria-hidden="true"
                aria-live="polite"
                class="gallery-fullscreen-loader text-neutral-content"
                data-gallery-fullscreen-loader
                hidden
                id="gallery-fullscreen-loader"
                role="status"
            >
                <span class="loading loading-spinner loading-lg" aria-hidden="true"></span>
                <p data-gallery-loader-status>Preparing full-resolution image…</p>
                <progress class="progress progress-primary" data-gallery-loader-progress hidden max="100" value="0"></progress>
                <span class="text-sm" data-gallery-loader-progress-label>
                    Downloading full-resolution image…
                </span>
            </div>

            <script src="/vendor/openseadragon/openseadragon.min.js"></script>
            <script src="/vendor/openseadragon/openseadragon-bookmark-url.js"></script>
            <CharacterPageScript
                allowNsfwToggle={allowNsfwToggle}
                defaultTabName={defaultTabName}
                persistNsfwTogglePreference={!currentUser}
            />
        </BaseLayout>
    )
}
