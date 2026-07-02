import type {CurrentUser} from '../../lib/auth/session'
import {chunkGalleryItems} from '../../lib/gallery'
import {
    characterMediaImageUrl,
    characterMediaNsfwBlurImageUrl,
    characterMediaPreviewImageUrl,
    characterProfileImageUrl,
    profilePhotoUrl,
} from '../../lib/media/url'
import type {ProfilePageUser} from './ProfilePage'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import {absoluteUrl, compactDescription} from '../meta'

export type CharacterPageCharacter = {
    id: string
    userId: string
    name: string
    profileImageKey: string
    description: string
    galleryFullsizeLastRow: boolean
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

export type CharacterPageGalleryTab = {
    id: string
    name: string
    rows: {
        id: string
        mediaIds: string[]
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

    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '')
}

function sizeChartUrlForCharacter(characterId: string): string {
    const layout = {
        version: 1,
        selectedId: characterId,
        characters: [{
            id: characterId,
            xPct: 50,
            flipped: false,
            layer: 1,
        }],
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
            <meta content={description} name="description"/>
            <link href={canonicalUrl} rel="canonical"/>

            <meta content={pageTitle} property="og:title"/>
            <meta content={description} property="og:description"/>
            <meta content="article" property="og:type"/>
            <meta content={canonicalUrl} property="og:url"/>
            <meta content="MyOC" property="og:site_name"/>
            <meta content={imageUrl} property="og:image"/>
            <meta content="512" property="og:image:width"/>
            <meta content="512" property="og:image:height"/>
            <meta content="image/webp" property="og:image:type"/>
            <meta content={imageAlt} property="og:image:alt"/>

            <meta content="summary" name="twitter:card"/>
            <meta content={pageTitle} name="twitter:title"/>
            <meta content={description} name="twitter:description"/>
            <meta content={imageUrl} name="twitter:image"/>
            <meta content={imageAlt} name="twitter:image:alt"/>

            <script
                dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}}
                type="application/ld+json"
            ></script>
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
        ? (sfwArtist === 'Unknown artist' ? 'Character media by an unknown artist' : `Character media by ${sfwArtist}`)
        : null
    const nsfwDisplayPreviewUrl = media.nsfwPreviewImageKey
        ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwPreviewImageKey, 'nsfw')
        : null
    const nsfwDisplayUrl = media.nsfwImageKey
        ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwImageKey, 'nsfw', media.nsfwContentType)
        : null
    const nsfwImageAlt = media.nsfwImageKey
        ? (nsfwArtist === 'Unknown artist' ? 'Character media by an unknown artist' : `Character media by ${nsfwArtist}`)
        : null
    const hiddenWidth = media.nsfwPreviewWidth ?? media.nsfwWidth
    const hiddenHeight = media.nsfwPreviewHeight ?? media.nsfwHeight
    const hiddenDisplayUrl = media.nsfwBlurImageKey
        ? characterMediaNsfwBlurImageUrl(
            mediaBaseUrl,
            character.userId,
            character.id,
            media.id,
            media.nsfwBlurImageKey,
        )
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
            }

            .justified-row.last-row:not(.last-row-full) {
                justify-content: flex-start;
            }

            .justified-row.last-row:not(.last-row-full) .gallery-media:only-child {
                flex: 0 1 min(100%, 34rem);
            }

            .gallery-image {
                cursor: default;
                display: block;
                height: 100%;
                object-fit: contain;
                opacity: 1;
                transition: opacity 160ms ease;
                width: 100%;
            }

            .gallery-image.gallery-image-openable {
                cursor: zoom-in;
            }

            .gallery-media.image-loading:not(.fullres-loading) .gallery-image {
                opacity: 0.35;
            }

            .gallery-image-loader {
                align-items: center;
                background: color-mix(in oklab, var(--color-base-100) 76%, transparent);
                border: 1px solid color-mix(in oklab, var(--color-base-content) 28%, transparent);
                border-radius: 999px;
                box-shadow: 0 0.35rem 1rem rgba(0, 0, 0, 0.28);
                color: var(--color-base-content);
                column-gap: 0.4rem;
                display: none;
                justify-content: center;
                min-height: 1.875rem;
                padding: 0.3rem 0.55rem;
                pointer-events: none;
                position: absolute;
                left: 0.5rem;
                top: 0.5rem;
                z-index: 4;
            }

            .gallery-media.fullres-loading .gallery-image-loader {
                display: flex;
            }

            .gallery-image-loader-spinner {
                animation: gallery-loader-spin 760ms linear infinite;
                border: 2px solid color-mix(in oklab, currentColor 22%, transparent);
                border-top-color: currentColor;
                border-radius: 999px;
                flex: 0 0 auto;
                height: 0.9rem;
                width: 0.9rem;
            }

            @keyframes gallery-loader-spin {
                to {
                    transform: rotate(360deg);
                }
            }

            .gallery-image:focus-visible {
                outline: 2px solid currentColor;
                outline-offset: 3px;
            }

            .nsfw-media .gallery-image {
                cursor: default;
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
        `}</style>
    )
}

function LockIcon() {
    return (
        <svg aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"
             xmlns="http://www.w3.org/2000/svg">
            <path d="M16 10V7a4 4 0 0 0-8 0v3" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
            <path d="M6 10h12v10H6V10Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
        </svg>
    )
}

function SettingsLink({characterId}: { characterId: string }) {
    return (
        <a aria-label="Content settings" class="btn btn-square btn-ghost absolute right-3 top-4 sm:right-0"
           href={`/edit/${encodeURIComponent(characterId)}`} title="Settings">
            <svg aria-hidden="true" class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                 xmlns="http://www.w3.org/2000/svg">
                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065Z"
                      stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke-linecap="round" stroke-linejoin="round"
                      stroke-width="2"/>
            </svg>
        </a>
    )
}

function GalleryImage({
                          allowNsfwToggle,
                          deferMediaLoad,
                          media,
                      }: {
    allowNsfwToggle: boolean
    deferMediaLoad: boolean
    media: DisplayMedia
}) {
    const aspect = media.displayWidth / media.displayHeight
    const style = `--media-width:${media.displayWidth};--media-height:${media.displayHeight};--media-aspect:${aspect};`
    const revealWidth = media.nsfwDisplayWidth ?? media.displayWidth
    const revealHeight = media.nsfwDisplayHeight ?? media.displayHeight
    const initialSrc = media.displayPreviewUrl ?? media.displayUrl
    const hasFullresPending = Boolean(media.displayPreviewUrl && media.displayPreviewUrl !== media.displayUrl)
    const canToggleNsfw = Boolean(allowNsfwToggle && media.nsfwDisplayUrl && media.safeDisplayUrl)

    return (
        <div
            class={`gallery-media ${deferMediaLoad ? '' : 'image-loading'} ${!deferMediaLoad && hasFullresPending ? 'fullres-loading' : ''} rounded ${media.isNsfwHidden ? 'nsfw-media' : ''}`}
            data-nsfw-alt={canToggleNsfw ? media.nsfwImageAlt : undefined}
            data-nsfw-height={canToggleNsfw ? String(revealHeight) : undefined}
            data-nsfw-preview-url={canToggleNsfw && media.nsfwDisplayPreviewUrl ? media.nsfwDisplayPreviewUrl : undefined}
            data-nsfw-title={canToggleNsfw ? media.nsfwArtist : undefined}
            data-nsfw-toggle-target={canToggleNsfw ? 'true' : undefined}
            data-nsfw-url={canToggleNsfw ? media.nsfwDisplayUrl : undefined}
            data-nsfw-width={canToggleNsfw ? String(revealWidth) : undefined}
            data-safe-alt={canToggleNsfw ? media.safeImageAlt : undefined}
            data-safe-height={canToggleNsfw && media.safeDisplayHeight ? String(media.safeDisplayHeight) : undefined}
            data-safe-hidden={canToggleNsfw ? String(media.safeDisplayIsNsfwHidden) : undefined}
            data-safe-preview-url={canToggleNsfw && media.safeDisplayPreviewUrl ? media.safeDisplayPreviewUrl : undefined}
            data-safe-title={canToggleNsfw ? media.safeDisplayTitle : undefined}
            data-safe-url={canToggleNsfw ? media.safeDisplayUrl : undefined}
            data-safe-width={canToggleNsfw && media.safeDisplayWidth ? String(media.safeDisplayWidth) : undefined}
            style={style}
        >
            <img
                alt={media.imageAlt}
                class="gallery-image"
                data-deferred-fullres-src={deferMediaLoad && hasFullresPending ? media.displayUrl : undefined}
                data-deferred-preview-src={deferMediaLoad && media.displayPreviewUrl ? media.displayPreviewUrl : undefined}
                data-deferred-src={deferMediaLoad ? initialSrc : undefined}
                data-fullres-src={!deferMediaLoad && hasFullresPending ? media.displayUrl : undefined}
                data-nsfw-displayed={media.isNsfw && !media.isNsfwHidden ? 'true' : 'false'}
                data-nsfw-hidden={media.isNsfwHidden ? 'true' : 'false'}
                data-preview-src={!deferMediaLoad ? media.displayPreviewUrl ?? undefined : undefined}
                data-title={media.artist}
                decoding="async"
                height={media.displayHeight}
                loading={hasFullresPending ? 'eager' : 'lazy'}
                src={!deferMediaLoad ? initialSrc : undefined}
                width={media.displayWidth}
            />
            <div aria-hidden="true" class="gallery-image-loader" data-gallery-image-loader>
                <span class="gallery-image-loader-spinner"></span>
            </div>
            {media.isNsfwHidden || media.safeDisplayIsNsfwHidden ? (
                <div aria-hidden="true" class="nsfw-media-warning" hidden={!media.isNsfwHidden}>
                    <div class="nsfw-media-badge">
                        <LockIcon/>
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
const galleryFullresQueue = [];
let galleryFullresActive = 0;
let galleryPreviewGateReady = false;
const galleryFullresConcurrency = 4;
const galleryFullresWaitingForPreviews = new Set();
const galleryImageMaxRetries = 3;
const galleryFullresMaxRetries = 3;

function openLightbox(image) {
    if (!isGalleryImageOpenable(image)) return;
    const lightbox = document.getElementById('gallery-lightbox');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxTitle = document.getElementById('lightbox-title');
    lightboxImage.src = image.src;
    lightboxImage.alt = image.alt;
    lightboxTitle.textContent = image.dataset.title || image.alt;
    lightbox.showModal();
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
        const fullresSrc = image.dataset.deferredFullresSrc;

        delete image.dataset.deferredSrc;
        delete image.dataset.deferredPreviewSrc;
        delete image.dataset.deferredFullresSrc;

        if (media && media.dataset.nsfwToggleTarget === 'true') {
            setGalleryMediaNsfwDisplay(media, getNsfwToggleDisplayState());
            return;
        }

        setProgressiveGalleryImageSource(image, previewSrc || initialSrc, fullresSrc || initialSrc, Boolean(previewSrc));
    });
    initLightbox(panel);
}

function initGallerySortOptions() {
    const sortInputs = Array.from(document.querySelectorAll('input[name="gallery-sort"]'));
    const validSortValues = sortInputs.map((input) => input.value);
    const requestedSort = decodeURIComponent(window.location.hash.replace('#', ''));
    const initialSort = validSortValues.includes(requestedSort) ? requestedSort : defaultTabName;
    sortInputs.forEach((input) => {
        input.checked = input.value === initialSort;
    });
    if (!window.location.hash && initialSort) history.replaceState(null, '', '#' + encodeURIComponent(initialSort));
    sortInputs.forEach((input) => {
        input.addEventListener('change', () => {
            if (!input.checked) return;
            showGalleryTab(input.value);
            history.replaceState(null, '', '#' + encodeURIComponent(input.value));
        });
    });
    return initialSort;
}

function initLightbox(root = document) {
    root.querySelectorAll('.gallery-image').forEach((image) => {
        if (image.dataset.lightboxBound === 'true') return;
        image.dataset.lightboxBound = 'true';
        updateGalleryImageOpenState(image);
        image.addEventListener('click', () => openLightbox(image));
        image.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openLightbox(image);
        });
    });
}

function isGalleryImageOpenable(image) {
    if (image.dataset.nsfwHidden === 'true') return false;
    const fullresSrc = image.dataset.fullresSrc;
    if (!fullresSrc) return image.complete && image.naturalWidth > 0;
    return image.dataset.fullresLoadedFor === fullresSrc;
}

function updateGalleryImageOpenState(image) {
    const isOpenable = isGalleryImageOpenable(image);
    image.classList.toggle('gallery-image-openable', isOpenable);

    if (isOpenable) {
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
        image.tabIndex = 0;
        image.removeAttribute('aria-disabled');
        return;
    }

    image.removeAttribute('role');
    image.removeAttribute('aria-label');
    image.setAttribute('aria-disabled', 'true');
    image.tabIndex = -1;
}

function setGalleryImageLoading(image, isLoading) {
    const media = image.closest('.gallery-media');
    if (!media) return;
    media.classList.toggle('image-loading', Boolean(isLoading));
    updateGalleryImageLoader(media);
    updateGalleryImageOpenState(image);
}

function setGalleryFullresLoading(image, isLoading) {
    const media = image.closest('.gallery-media');
    if (!media) return;
    media.classList.toggle('fullres-loading', Boolean(isLoading));
    updateGalleryImageLoader(media);
    updateGalleryImageOpenState(image);
}

function updateGalleryImageLoader(media) {
    const loader = media.querySelector('[data-gallery-image-loader]');
    if (loader) {
        loader.hidden = !media.classList.contains('fullres-loading');
    }
}

function retryImageUrl(src, attempt) {
    const url = new URL(src, window.location.href);
    url.searchParams.set('myoc_retry', String(attempt));
    url.searchParams.set('myoc_retry_nonce', String(Date.now()));
    return url.toString();
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
    if (image.dataset.fullresLoadingFor) {
        return;
    }

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
    image.src = retryImageUrl(baseSrc, nextRetryCount);
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

function cancelGalleryFullresLoad(image) {
    if (typeof image.galleryFullresCancel === 'function') {
        image.galleryFullresCancel(false);
    }
}

function setProgressiveGalleryImageSource(image, previewSrc, fullresSrc, waitForPreview = false) {
    const nextSrc = previewSrc || fullresSrc;
    if (!nextSrc) return;

    cancelGalleryFullresLoad(image);
    image.dataset.sourceVersion = String(Number(image.dataset.sourceVersion || '0') + 1);

    if (previewSrc) {
        image.dataset.previewSrc = previewSrc;
    } else {
        delete image.dataset.previewSrc;
    }

    if (fullresSrc && fullresSrc !== nextSrc) {
        image.dataset.fullresSrc = fullresSrc;
        setGalleryFullresLoading(image, true);
    } else {
        delete image.dataset.fullresSrc;
        setGalleryFullresLoading(image, false);
    }

    delete image.dataset.fullresLoadedFor;
    delete image.dataset.fullresQueuedFor;
    delete image.dataset.fullresLoadingFor;
    setGalleryImageSource(image, nextSrc);
    queueGalleryFullresLoadAfterPreview(image, waitForPreview);
}

function queueGalleryFullresLoadAfterPreview(image, waitForPreview = false) {
    const fullresSrc = image.dataset.fullresSrc;
    if (!fullresSrc) {
        setGalleryFullresLoading(image, false);
        return;
    }

    const previewSrc = image.dataset.previewSrc;
    if (waitForPreview && previewSrc && previewSrc !== fullresSrc) {
        const sourceVersion = image.dataset.sourceVersion || '';
        const queueAfterPreview = () => {
            if (
                image.dataset.fullresSrc === fullresSrc
                && image.dataset.sourceVersion === sourceVersion
            ) {
                queueGalleryFullresLoad(image);
            }
        };

        if (image.complete) {
            queueAfterPreview();
            return;
        }

        image.addEventListener('load', queueAfterPreview, {once: true});
        image.addEventListener('error', queueAfterPreview, {once: true});
        return;
    }

    queueGalleryFullresLoad(image);
}

function queueGalleryFullresLoad(image) {
    const fullresSrc = image.dataset.fullresSrc;
    if (!fullresSrc) {
        setGalleryFullresLoading(image, false);
        return;
    }

    if (image.dataset.fullresLoadedFor === fullresSrc || image.dataset.fullresQueuedFor === fullresSrc || image.dataset.fullresLoadingFor === fullresSrc) {
        return;
    }

    if (!galleryPreviewGateReady) {
        image.dataset.fullresQueuedFor = fullresSrc;
        galleryFullresWaitingForPreviews.add(image);
        return;
    }

    image.dataset.fullresQueuedFor = fullresSrc;
    setGalleryFullresLoading(image, true);
    galleryFullresQueue.push(image);
    runGalleryFullresQueue();
}

function runGalleryFullresQueue() {
    while (galleryFullresActive < galleryFullresConcurrency && galleryFullresQueue.length > 0) {
        const image = galleryFullresQueue.shift();
        if (!image) continue;
        galleryFullresActive += 1;
        loadGalleryFullresImage(image).finally(() => {
            galleryFullresActive -= 1;
            runGalleryFullresQueue();
        });
    }
}

function loadGalleryFullresImage(image) {
    return new Promise((resolve) => {
        const fullresSrc = image.dataset.fullresSrc;
        const sourceVersion = image.dataset.sourceVersion || '';

        if (!fullresSrc) {
            setGalleryFullresLoading(image, false);
            resolve();
            return;
        }

        if (image.dataset.fullresLoadedFor === fullresSrc) {
            setGalleryFullresLoading(image, false);
            resolve();
            return;
        }

        delete image.dataset.fullresQueuedFor;
        image.dataset.fullresLoadingFor = fullresSrc;
        setGalleryFullresLoading(image, true);

        const isCurrentRequest = () => image.dataset.fullresSrc === fullresSrc && (image.dataset.sourceVersion || '') === sourceVersion;
        let retryCount = 0;
        let settled = false;

        const finish = (loaded, loadedSrc) => {
            if (settled) {
                return;
            }

            settled = true;
            if (image.galleryFullresCancel === finish) {
                delete image.galleryFullresCancel;
            }
            if (isCurrentRequest()) {
                if (loaded && loadedSrc) {
                    resetGalleryImageRetry(image, loadedSrc);
                    image.src = loadedSrc;
                    image.dataset.fullresLoadedFor = fullresSrc;
                }
                delete image.dataset.fullresLoadingFor;
                setGalleryFullresLoading(image, false);
                updateGalleryImageOpenState(image);
            }
            resolve();
        };

        const startAttempt = (src) => {
            if (settled) {
                return;
            }

            if (!isCurrentRequest()) {
                finish(false);
                return;
            }

            const requestSrc = src;
            const preloader = new Image();
            preloader.decoding = 'async';
            preloader.onload = () => finish(true, requestSrc);
            preloader.onerror = () => {
                if (!isCurrentRequest()) {
                    finish(false);
                    return;
                }

                if (retryCount < galleryFullresMaxRetries) {
                    retryCount += 1;
                    startAttempt(retryImageUrl(fullresSrc, retryCount));
                    return;
                }

                finish(false);
            };
            preloader.src = requestSrc;
        };

        image.galleryFullresCancel = finish;
        startAttempt(fullresSrc);
    });
}

function initGalleryFullresLoading(root = document) {
    galleryPreviewGateReady = true;
    root.querySelectorAll('.gallery-image[data-fullres-src]').forEach((image) => {
        galleryFullresWaitingForPreviews.add(image);
    });
    const waitingImages = Array.from(galleryFullresWaitingForPreviews);
    galleryFullresWaitingForPreviews.clear();
    waitingImages.forEach((image) => queueGalleryFullresLoadAfterPreview(image));
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
    const width = Number((displayNsfwMedia ? media.dataset.nsfwWidth : media.dataset.safeWidth) || image.width || 1);
    const height = Number((displayNsfwMedia ? media.dataset.nsfwHeight : media.dataset.safeHeight) || image.height || 1);
    const title = displayNsfwMedia ? media.dataset.nsfwTitle : media.dataset.safeTitle;
    const alt = displayNsfwMedia ? media.dataset.nsfwAlt : media.dataset.safeAlt;
    const isHidden = displayNsfwMedia ? false : media.dataset.safeHidden === 'true';
    const warning = media.querySelector('.nsfw-media-warning');

    setProgressiveGalleryImageSource(image, previewUrl || imageUrl, imageUrl, Boolean(previewUrl));
    image.alt = alt || image.alt;
    image.dataset.title = title || image.dataset.title || image.alt;
    image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
    image.dataset.nsfwDisplayed = displayNsfwMedia ? 'true' : 'false';
    image.dataset.nsfwHidden = isHidden ? 'true' : 'false';
    image.width = width;
    image.height = height;
    media.style.setProperty('--media-width', String(width));
    media.style.setProperty('--media-height', String(height));
    media.style.setProperty('--media-aspect', String(width / height));

    if (isHidden) {
        image.tabIndex = -1;
        image.removeAttribute('tabindex');
        media.classList.add('nsfw-media');
        if (warning) warning.hidden = false;
    } else {
        media.classList.remove('nsfw-media');
        if (warning) warning.hidden = true;
        updateGalleryImageOpenState(image);
    }
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
initGalleryFullresLoading();
initLightbox();
showGalleryTab(initialGalleryTabName);
initNsfwToggle();
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
    const mediaById = new Map(media.map((item) => [
        item.id,
        displayMediaFor(item, character, mediaBaseUrl, displayNsfwMedia),
    ]))
    const tabs = galleryTabs.length > 0 ? galleryTabs : [{
        id: 'default',
        name: 'default',
        rows: [{
            id: 'default-row',
            mediaIds: media.map((item) => item.id),
        }],
    }]
    const defaultTabName = tabs[0]?.name ?? 'default'
    const ownerProfileImageUrl = profileImageFor(profileUser, mediaBaseUrl)
    const characterThumbnailUrl = characterProfileImageUrl(mediaBaseUrl, profileUser.id, character.id, character.profileImageKey)
    const pageTitle = `${character.name} | MyOC`
    const canEdit = currentUser?.id === profileUser.id

    return (
        <BaseLayout
            head={(
                <>
                    <CharacterPageHead
                        character={character}
                        imageUrl={characterThumbnailUrl}
                        metaDescriptionFallback={metaDescriptionFallback}
                        pageTitle={pageTitle}
                        profileUser={profileUser}
                        siteUrl={siteUrl}
                    />
                    <CharacterPageStyles/>
                </>
            )}
            title={pageTitle}
        >
            <Navbar
                currentUser={currentUser}
                guestInitial={profileUser.username.trim().charAt(0).toUpperCase() || 'R'}
                mediaBaseUrl={mediaBaseUrl}
            />
            <main class="container relative mx-auto px-3 py-4 sm:px-0">
                {canEdit ? <SettingsLink characterId={character.id}/> : null}

                <div class="mb-4 flex justify-center">
                    <a class="flex items-center gap-3" href={`/u/${encodeURIComponent(profileUser.username)}`}>
                        <img
                            alt={`${profileUser.username} profile photo`}
                            class="h-12 w-12 rounded object-cover"
                            decoding="async"
                            height="48"
                            loading="lazy"
                            src={ownerProfileImageUrl}
                            width="48"
                        />
                        <span class="text-lg font-light">{profileUser.username}</span>
                    </a>
                </div>

                <div class="mb-4 flex justify-center">
                    <img alt={`${character.name} profile image`}
                         class="h-28 w-28 rounded object-cover sm:h-32 sm:w-32"
                         decoding="async"
                         height="128"
                         loading="lazy"
                         src={characterThumbnailUrl}
                         width="128"/>
                </div>

                <h1 class="mb-4 break-words text-center text-5xl font-bold sm:text-6xl">{character.name}</h1>
                {character.description ? (
                    <p class="mx-auto mb-6 max-w-3xl whitespace-pre-wrap text-center font-light">{character.description}</p>
                ) : null}

                {character.hasHeightChart ? (
                    <div class="mb-6 flex justify-center">
                        <a class="btn btn-sm btn-outline rounded-full" href={sizeChartUrlForCharacter(character.id)}>
                            View in Size Chart
                        </a>
                    </div>
                ) : null}

                {allowNsfwToggle ? (
                    <div class="mb-6 flex justify-center">
                        <button aria-pressed={displayNsfwMedia ? 'true' : 'false'}
                                class="btn btn-xs btn-outline rounded-full"
                                data-display-nsfw-media={displayNsfwMedia ? 'true' : 'false'} type="button">
                            {displayNsfwMedia ? 'Hide 18+ media' : 'Load 18+ media'}
                        </button>
                    </div>
                ) : null}

                {tabs.length > 1 ? (
                    <fieldset aria-label="Gallery sort options" class="mb-6 flex flex-wrap justify-center gap-2">
                        {tabs.map((tab, index) => (
                            <label class="cursor-pointer">
                                <input checked={index === 0} class="peer sr-only" name="gallery-sort" type="radio" value={tab.name}/>
                                <span
                                    class="btn btn-sm btn-outline rounded-full peer-checked:border-white peer-checked:bg-white peer-checked:text-black">{displayGalleryTabName(tab.name)}</span>
                            </label>
                        ))}
                    </fieldset>
                ) : null}

                {tabs.map((tab, tabIndex) => {
                    const visualRows = tab.rows.flatMap((row) => {
                        const rowMedia = row.mediaIds
                            .map((mediaId) => mediaById.get(mediaId))
                            .filter((item): item is DisplayMedia => Boolean(item))

                        return chunkGalleryItems(rowMedia)
                    })

                    return (
                        <section class="gallery-tab-panel justified-gallery" data-gallery-tab-panel={tab.name}
                                 hidden={tabIndex > 0}>
                            {visualRows.map((rowMedia, rowIndex) => {
                                const isLastRow = rowIndex === visualRows.length - 1

                                return (
                                    <div
                                        class={`justified-row ${isLastRow ? 'last-row' : ''} ${isLastRow && character.galleryFullsizeLastRow ? 'last-row-full' : ''}`}>
                                        {rowMedia.map((item) => <GalleryImage
                                            allowNsfwToggle={allowNsfwToggle}
                                            deferMediaLoad={tabs.length > 1 && tabIndex > 0}
                                            media={item}
                                        />)}
                                    </div>
                                )
                            })}
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
                <div class="modal-box max-w-6xl border border-base-content/20 bg-base-200 p-0 shadow-2xl">
                    <img alt="" class="max-h-[80vh] w-full object-contain" id="lightbox-image"/>
                    <div class="space-y-2 p-4">
                        <h2 class="text-xl font-semibold" id="lightbox-title"></h2>
                    </div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button>close</button>
                </form>
            </dialog>

            <CharacterPageScript
                allowNsfwToggle={allowNsfwToggle}
                defaultTabName={defaultTabName}
                persistNsfwTogglePreference={!currentUser}
            />
        </BaseLayout>
    )
}
