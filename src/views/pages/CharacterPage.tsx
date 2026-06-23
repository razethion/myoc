import type {CurrentUser} from '../../lib/auth/session'
import {characterMediaImageUrl, characterProfileImageUrl, profilePhotoUrl} from '../../lib/media/url'
import type {ProfilePageUser} from './ProfilePage'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

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
    sfwContentType: string | null
    nsfwContentType: string | null
    sfwArtist: string
    nsfwArtist: string
    sfwWidth: number | null
    sfwHeight: number | null
    nsfwWidth: number | null
    nsfwHeight: number | null
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
}

function displayGalleryTabName(name: string): string {
    return name === 'default' ? 'Default' : name
}

type DisplayMedia = CharacterPageMedia & {
    artist: string
    imageAlt: string
    displayHeight: number
    displayUrl: string
    displayWidth: number
    isNsfw: boolean
    isNsfwHidden: boolean
    nsfwArtist: string
    nsfwDisplayHeight: number | null
    nsfwDisplayUrl: string | null
    nsfwDisplayWidth: number | null
    nsfwImageAlt: string | null
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

function displayMediaFor(
    media: CharacterPageMedia,
    character: CharacterPageCharacter,
    mediaBaseUrl: string,
    displayNsfwMedia: boolean,
): DisplayMedia | null {
    const hasSfw = Boolean(media.sfwImageKey)
    const hasNsfw = Boolean(media.nsfwImageKey)
    const useNsfw = Boolean(hasNsfw && (displayNsfwMedia || !hasSfw))
    const imageKey = useNsfw ? media.nsfwImageKey : media.sfwImageKey

    if (!imageKey) {
        return null
    }

    const width = useNsfw ? media.nsfwWidth : media.sfwWidth
    const height = useNsfw ? media.nsfwHeight : media.sfwHeight
    const artist = (useNsfw ? media.nsfwArtist : media.sfwArtist) || media.sfwArtist || media.nsfwArtist || 'Unknown artist'
    const nsfwArtist = media.nsfwArtist || media.sfwArtist || 'Unknown artist'

    return {
        ...media,
        artist,
        imageAlt: artist === 'Unknown artist' ? 'Character media by an unknown artist' : `Character media by ${artist}`,
        displayHeight: height && height > 0 ? height : 1,
        displayUrl: characterMediaImageUrl(
            mediaBaseUrl,
            character.userId,
            character.id,
            media.id,
            imageKey,
            useNsfw ? 'nsfw' : 'sfw',
            useNsfw ? media.nsfwContentType : media.sfwContentType,
        ),
        displayWidth: width && width > 0 ? width : 1,
        isNsfw: useNsfw,
        isNsfwHidden: useNsfw && !displayNsfwMedia,
        nsfwArtist,
        nsfwDisplayHeight: media.nsfwHeight && media.nsfwHeight > 0 ? media.nsfwHeight : null,
        nsfwDisplayUrl: media.nsfwImageKey
            ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwImageKey, 'nsfw', media.nsfwContentType)
            : null,
        nsfwDisplayWidth: media.nsfwWidth && media.nsfwWidth > 0 ? media.nsfwWidth : null,
        nsfwImageAlt: media.nsfwImageKey
            ? (nsfwArtist === 'Unknown artist' ? 'Character media by an unknown artist' : `Character media by ${nsfwArtist}`)
            : null,
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
                cursor: zoom-in;
                display: block;
                height: 100%;
                object-fit: contain;
                opacity: 1;
                transition: opacity 160ms ease;
                width: 100%;
            }

            .gallery-media.image-loading .gallery-image {
                opacity: 0.35;
            }

            .gallery-image-loader {
                align-items: center;
                background: color-mix(in oklab, var(--color-base-300) 65%, transparent);
                display: none;
                inset: 0;
                justify-content: center;
                pointer-events: none;
                position: absolute;
                z-index: 4;
            }

            .gallery-media.image-loading .gallery-image-loader {
                display: flex;
            }

            .gallery-image:focus-visible {
                outline: 2px solid currentColor;
                outline-offset: 3px;
            }

            .nsfw-media .gallery-image {
                cursor: default;
                filter: blur(28px) saturate(1.35);
                transform: scale(1.04);
            }

            .nsfw-media-warning {
                align-items: center;
                background: rgba(0, 0, 0, 0.28);
                display: flex;
                inset: 0;
                justify-content: center;
                padding: 1rem;
                pointer-events: none;
                position: absolute;
                text-align: center;
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

function GalleryImage({allowGuestNsfwReveal, media}: { allowGuestNsfwReveal: boolean; media: DisplayMedia }) {
    const aspect = media.displayWidth / media.displayHeight
    const style = `--media-width:${media.displayWidth};--media-height:${media.displayHeight};--media-aspect:${aspect};`
    const revealWidth = media.nsfwDisplayWidth ?? media.displayWidth
    const revealHeight = media.nsfwDisplayHeight ?? media.displayHeight

    return (
        <div
            class={`gallery-media image-loading rounded ${media.isNsfwHidden ? 'nsfw-media' : ''}`}
            data-nsfw-alt={allowGuestNsfwReveal ? media.nsfwImageAlt : undefined}
            data-nsfw-height={allowGuestNsfwReveal && media.nsfwDisplayUrl ? String(revealHeight) : undefined}
            data-nsfw-reveal-target={allowGuestNsfwReveal && media.nsfwDisplayUrl ? 'true' : undefined}
            data-nsfw-title={allowGuestNsfwReveal && media.nsfwDisplayUrl ? media.nsfwArtist : undefined}
            data-nsfw-url={allowGuestNsfwReveal && media.nsfwDisplayUrl ? media.nsfwDisplayUrl : undefined}
            data-nsfw-width={allowGuestNsfwReveal && media.nsfwDisplayUrl ? String(revealWidth) : undefined}
            style={style}
        >
            <img
                alt={media.imageAlt}
                class="gallery-image"
                data-nsfw-hidden={media.isNsfwHidden ? 'true' : 'false'}
                data-title={media.artist}
                decoding="async"
                height={media.displayHeight}
                loading="lazy"
                src={media.displayUrl}
                tabIndex={media.isNsfwHidden ? undefined : 0}
                width={media.displayWidth}
            />
            <div aria-hidden="true" class="gallery-image-loader" data-gallery-image-loader>
                <span class="loading loading-spinner loading-lg text-base-content"></span>
            </div>
            {media.isNsfwHidden ? (
                <div aria-hidden="true" class="nsfw-media-warning">
                    <div>
                        <div class="mx-auto flex h-11 w-11 items-center justify-center rounded bg-base-100/35 text-base-content/80 backdrop-blur-md">
                            <LockIcon/>
                        </div>
                        <p class="mt-3 text-xs font-medium text-base-content/80 sm:text-sm">
                            {allowGuestNsfwReveal ? 'Use the 18+ media button to display this media.' : 'Change your account settings to display this media.'}
                        </p>
                    </div>
                </div>
            ) : null}
        </div>
    )
}

function CharacterPageScript({allowGuestNsfwReveal, defaultTabName}: { allowGuestNsfwReveal: boolean; defaultTabName: string }) {
    const script = `
const defaultTabName = ${safeJson(defaultTabName)};
const allowGuestNsfwReveal = ${safeJson(allowGuestNsfwReveal)};
const guestNsfwStorageKey = 'myoc:guest-display-nsfw-media';

function openLightbox(image) {
    if (image.dataset.nsfwHidden === 'true') return;
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
        panel.hidden = panel.dataset.galleryTabPanel !== normalizedTabId;
    });
    document.querySelectorAll('input[name="gallery-sort"]').forEach((input) => {
        input.checked = input.value === normalizedTabId;
    });
}

function initGallerySortOptions() {
    const sortInputs = Array.from(document.querySelectorAll('input[name="gallery-sort"]'));
    const validSortValues = sortInputs.map((input) => input.value);
    const requestedSort = decodeURIComponent(window.location.hash.replace('#', ''));
    const initialSort = validSortValues.includes(requestedSort) ? requestedSort : defaultTabName;
    showGalleryTab(initialSort);
    if (!window.location.hash && initialSort) history.replaceState(null, '', '#' + encodeURIComponent(initialSort));
    sortInputs.forEach((input) => {
        input.addEventListener('change', () => {
            if (!input.checked) return;
            showGalleryTab(input.value);
            history.replaceState(null, '', '#' + encodeURIComponent(input.value));
        });
    });
}

function initLightbox() {
    document.querySelectorAll('.gallery-image').forEach((image) => {
        if (image.dataset.nsfwHidden === 'true') return;
        if (image.dataset.lightboxBound === 'true') return;
        image.dataset.lightboxBound = 'true';
        image.setAttribute('role', 'button');
        image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
        image.addEventListener('click', () => openLightbox(image));
        image.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            openLightbox(image);
        });
    });
}

function setGalleryImageLoading(image, isLoading) {
    const media = image.closest('.gallery-media');
    if (!media) return;
    media.classList.toggle('image-loading', Boolean(isLoading));
    const loader = media.querySelector('[data-gallery-image-loader]');
    if (loader) loader.hidden = !isLoading;
}

function refreshGalleryImageLoading(image) {
    setGalleryImageLoading(image, !(image.complete && image.naturalWidth > 0));
}

function initGalleryImageLoading() {
    document.querySelectorAll('.gallery-image').forEach((image) => {
        if (image.dataset.loadingBound === 'true') {
            refreshGalleryImageLoading(image);
            return;
        }
        image.dataset.loadingBound = 'true';
        image.addEventListener('load', () => setGalleryImageLoading(image, false));
        image.addEventListener('error', () => setGalleryImageLoading(image, false));
        refreshGalleryImageLoading(image);
    });
}

function setGalleryImageSource(image, src) {
    if (image.src === src) {
        refreshGalleryImageLoading(image);
        return;
    }
    setGalleryImageLoading(image, true);
    image.src = src;
    refreshGalleryImageLoading(image);
}

function displayGuestNsfwMedia() {
    document.querySelectorAll('[data-nsfw-reveal-target="true"]').forEach((media) => {
        const image = media.querySelector('.gallery-image');
        const nsfwUrl = media.dataset.nsfwUrl;
        if (!image || !nsfwUrl) return;
        if (!media.dataset.sfwUrl) media.dataset.sfwUrl = image.src;
        if (!media.dataset.sfwAlt) media.dataset.sfwAlt = image.alt;
        if (!media.dataset.sfwTitle) media.dataset.sfwTitle = image.dataset.title || image.alt;
        if (!media.dataset.sfwWidth) media.dataset.sfwWidth = String(image.width || 1);
        if (!media.dataset.sfwHeight) media.dataset.sfwHeight = String(image.height || 1);
        if (!media.dataset.wasNsfwHidden) media.dataset.wasNsfwHidden = image.dataset.nsfwHidden || 'false';
        const warning = media.querySelector('.nsfw-media-warning');
        if (warning && !media.dataset.nsfwWarningHtml) media.dataset.nsfwWarningHtml = warning.outerHTML;

        const width = Number(media.dataset.nsfwWidth || image.width || 1);
        const height = Number(media.dataset.nsfwHeight || image.height || 1);
        setGalleryImageSource(image, nsfwUrl);
        image.alt = media.dataset.nsfwAlt || image.alt;
        image.dataset.title = media.dataset.nsfwTitle || image.dataset.title || image.alt;
        image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
        image.dataset.nsfwHidden = 'false';
        image.tabIndex = 0;
        image.width = width;
        image.height = height;
        media.style.setProperty('--media-width', String(width));
        media.style.setProperty('--media-height', String(height));
        media.style.setProperty('--media-aspect', String(width / height));
        media.classList.remove('nsfw-media');
        media.querySelectorAll('.nsfw-media-warning').forEach((warning) => warning.remove());
    });
    document.querySelectorAll('[data-display-guest-nsfw]').forEach((button) => {
        button.textContent = 'Hide 18+ media';
        button.dataset.displayGuestNsfw = 'true';
    });
    initLightbox();
}

function hideGuestNsfwMedia() {
    document.querySelectorAll('[data-nsfw-reveal-target="true"]').forEach((media) => {
        const image = media.querySelector('.gallery-image');
        if (!image || !media.dataset.sfwUrl) return;

        const width = Number(media.dataset.sfwWidth || image.width || 1);
        const height = Number(media.dataset.sfwHeight || image.height || 1);
        setGalleryImageSource(image, media.dataset.sfwUrl);
        image.alt = media.dataset.sfwAlt || image.alt;
        image.dataset.title = media.dataset.sfwTitle || image.dataset.title || image.alt;
        image.setAttribute('aria-label', 'Open ' + (image.dataset.title || image.alt));
        image.dataset.nsfwHidden = media.dataset.wasNsfwHidden || 'false';
        image.width = width;
        image.height = height;
        media.style.setProperty('--media-width', String(width));
        media.style.setProperty('--media-height', String(height));
        media.style.setProperty('--media-aspect', String(width / height));

        if (image.dataset.nsfwHidden === 'true') {
            image.tabIndex = -1;
            image.removeAttribute('tabindex');
            media.classList.add('nsfw-media');
            if (media.dataset.nsfwWarningHtml && !media.querySelector('.nsfw-media-warning')) {
                media.insertAdjacentHTML('beforeend', media.dataset.nsfwWarningHtml);
            }
        }
    });
    document.querySelectorAll('[data-display-guest-nsfw]').forEach((button) => {
        button.textContent = 'Display 18+ media';
        button.dataset.displayGuestNsfw = 'false';
    });
}

function initGuestNsfwReveal() {
    if (!allowGuestNsfwReveal) return;
    const button = document.querySelector('[data-display-guest-nsfw]');
    if (!button) return;
    button.addEventListener('click', () => {
        const shouldDisplay = button.dataset.displayGuestNsfw !== 'true';
        try {
            localStorage.setItem(guestNsfwStorageKey, shouldDisplay ? 'true' : 'false');
        } catch {}
        if (shouldDisplay) {
            displayGuestNsfwMedia();
            return;
        }
        hideGuestNsfwMedia();
    });
    try {
        if (localStorage.getItem(guestNsfwStorageKey) === 'true') {
            displayGuestNsfwMedia();
        }
    } catch {}
}

initGallerySortOptions();
initGalleryImageLoading();
initLightbox();
initGuestNsfwReveal();
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
}: CharacterPageProps) {
    const displayNsfwMedia = Boolean(currentUser?.displayNsfwMedia)
    const allowGuestNsfwReveal = !currentUser && media.some((item) => Boolean(item.nsfwImageKey))
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
    const canEdit = currentUser?.id === profileUser.id

    return (
        <BaseLayout head={<CharacterPageStyles/>} title={`${character.name} | MyOC`}>
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
                         src={characterProfileImageUrl(mediaBaseUrl, profileUser.id, character.id, character.profileImageKey)}
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

                {allowGuestNsfwReveal ? (
                    <div class="mb-6 flex justify-center">
                        <button class="btn btn-xs btn-outline rounded-full" data-display-guest-nsfw type="button">
                            Display 18+ media
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

                {tabs.map((tab, tabIndex) => (
                    <section class="gallery-tab-panel justified-gallery" data-gallery-tab-panel={tab.name} hidden={tabIndex > 0}>
                        {tab.rows.map((row, rowIndex) => {
                            const rowMedia = row.mediaIds
                                .map((mediaId) => mediaById.get(mediaId))
                                .filter((item): item is DisplayMedia => Boolean(item))

                            if (rowMedia.length === 0) {
                                return null
                            }

                            const isLastRow = rowIndex === tab.rows.length - 1

                            return (
                                <div class={`justified-row ${isLastRow ? 'last-row' : ''} ${isLastRow && character.galleryFullsizeLastRow ? 'last-row-full' : ''}`}>
                                    {rowMedia.map((item) => <GalleryImage allowGuestNsfwReveal={allowGuestNsfwReveal} media={item}/>)}
                                </div>
                            )
                        })}
                    </section>
                ))}

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

            <CharacterPageScript allowGuestNsfwReveal={allowGuestNsfwReveal} defaultTabName={defaultTabName}/>
        </BaseLayout>
    )
}
