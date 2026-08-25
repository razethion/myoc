import type {CurrentUser} from '../../lib/auth/session'
import {chunkGalleryItems} from '../../lib/gallery'
import type {RecentMediaItem, RecentMediaPage as RecentMediaPageData} from '../../lib/recentMedia'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type RecentMediaPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    page: RecentMediaPageData
    showNsfw: boolean
    showUnapproved: boolean
}

function CreditAvatar({alt, initial, url}: {alt: string; initial: string; url: string | null}) {
    if (url) {
        return (
            <div class="avatar shrink-0">
                <div class="h-9 w-9 rounded-full">
                    <img alt={alt} loading="lazy" src={url} />
                </div>
            </div>
        )
    }

    return (
        <div class="avatar avatar-placeholder shrink-0">
            <div class="h-9 w-9 rounded-full bg-neutral text-neutral-content">
                <span class="text-sm font-bold">{initial}</span>
            </div>
        </div>
    )
}

function MediaCredit({item, owner = false, overlay = false}: {item: RecentMediaItem; owner?: boolean; overlay?: boolean}) {
    const href = owner ? item.user.href : item.character.href
    const name = owner ? item.user.username : item.character.name
    const label = owner ? 'Uploader' : 'Character'
    const avatarUrl = owner ? item.user.avatarUrl : item.character.avatarUrl
    const initial = owner ? item.user.initial : item.character.name.charAt(0).toUpperCase()
    const alignment = owner ? 'recent-media-owner-credit flex-row-reverse text-right' : ''
    const color = overlay ? 'pointer-events-auto text-neutral-content drop-shadow-md' : 'text-base-content'
    const labelColor = overlay ? 'text-neutral-content/75' : 'text-base-content/70'

    return (
        <a class={`flex min-w-0 max-w-full items-center gap-2 ${alignment} ${color}`} href={href}>
            <CreditAvatar alt={`${name} avatar`} initial={initial} url={avatarUrl} />
            <span class="min-w-0">
                <span class={`block text-xs ${labelColor}`}>{label}</span>
                <span class="block truncate font-semibold">{name}</span>
            </span>
        </a>
    )
}

function RecentMediaCard({item}: {item: RecentMediaItem}) {
    const aspect = item.width / item.height
    const style = `--media-aspect:${aspect};--media-width:${item.width};--media-height:${item.height};`

    return (
        <article
            class="recent-media-tile card card-border group relative min-w-0 overflow-hidden bg-base-200 md:block md:border-0"
            data-media-id={item.id}
            style={style}
        >
            <a
                aria-label={`View ${item.character.name}'s character page`}
                class="recent-media-image-shell relative block overflow-hidden bg-base-300"
                href={item.character.href}
            >
                <div aria-hidden="true" class="skeleton absolute inset-0 rounded-none" data-media-skeleton></div>
                <img
                    alt={item.alt}
                    class="absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity motion-reduce:transition-none"
                    data-original-src={item.originalSrc}
                    data-recent-media-image
                    decoding="async"
                    height={item.height}
                    loading="lazy"
                    src={item.previewSrc}
                    width={item.width}
                />
            </a>

            <div class="card-body p-3 md:hidden" data-mobile-credits>
                <div class="grid grid-cols-2 items-center gap-3">
                    <MediaCredit item={item} />
                    <MediaCredit item={item} owner />
                </div>
            </div>

            <div
                class="pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden translate-y-1 bg-linear-to-t from-neutral/90 via-neutral/50 to-transparent p-3 pt-12 opacity-0 transition md:flex md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:translate-y-0 md:group-hover:opacity-100 motion-reduce:transition-none"
                data-desktop-credits
            >
                <div class="recent-media-overlay-credits flex w-full items-end justify-between gap-3">
                    <MediaCredit item={item} overlay />
                    <MediaCredit item={item} overlay owner />
                </div>
            </div>
        </article>
    )
}

function RecentMediaStyles() {
    return (
        <style>{`
            .recent-media-image-shell {
                aspect-ratio: var(--media-width) / var(--media-height);
            }

            @media (min-width: 768px) {
                .recent-media-row {
                    align-items: stretch;
                    display: flex;
                    gap: 0.5rem;
                    width: 100%;
                }

                .recent-media-tile {
                    aspect-ratio: var(--media-width) / var(--media-height);
                    container-type: inline-size;
                    flex: var(--media-aspect) 1 0;
                }

                .recent-media-row .recent-media-tile:only-child {
                    flex: 0 1 min(100%, 34rem);
                }

                .recent-media-image-shell {
                    aspect-ratio: auto;
                    inset: 0;
                    position: absolute;
                }
            }

            @container (max-width: 15rem) {
                .recent-media-overlay-credits {
                    align-items: stretch;
                    flex-direction: column;
                }

                .recent-media-owner-credit {
                    align-self: flex-end;
                }
            }
        `}</style>
    )
}

function RecentMediaScript() {
    const script = `
        const recentFeed = document.querySelector('[data-recent-feed]');
        const recentSentinel = document.querySelector('[data-recent-sentinel]');
        const recentLoadButton = document.querySelector('[data-recent-load-more]');
        const recentLoading = document.querySelector('[data-recent-loading]');
        const recentError = document.querySelector('[data-recent-error]');
        const recentErrorMessage = document.querySelector('[data-recent-error-message]');
        const recentEnd = document.querySelector('[data-recent-end]');
        const recentEmpty = document.querySelector('[data-recent-empty]');
        const recentNsfwButton = document.querySelector('[data-recent-filter-nsfw]');
        const recentUnapprovedButton = document.querySelector('[data-recent-filter-unapproved]');
        const recentState = {
            cursor: recentFeed?.dataset.nextCursor || '',
            inFlight: false,
            hasMore: recentFeed?.dataset.hasMore === 'true',
            showNsfw: recentFeed?.dataset.showNsfw === 'true',
            showUnapproved: recentFeed?.dataset.showUnapproved !== 'false',
        };

        function recentElement(tagName, className, text) {
            const element = document.createElement(tagName);
            if (className) element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        }

        function bindRecentImage(image) {
            if (!image || image.dataset.imageBound === 'true') return;
            image.dataset.imageBound = 'true';
            const skeleton = image.parentElement?.querySelector('[data-media-skeleton]');

            const reveal = () => {
                image.classList.remove('opacity-0');
                skeleton?.classList.add('hidden');
            };

            image.addEventListener('load', reveal);
            image.addEventListener('error', () => {
                const originalSrc = image.dataset.originalSrc;
                if (originalSrc && image.dataset.fallbackAttempted !== 'true' && image.src !== originalSrc) {
                    image.dataset.fallbackAttempted = 'true';
                    image.src = originalSrc;
                    return;
                }
                reveal();
            });

            if (image.complete && image.naturalWidth > 0) reveal();
        }

        function recentAvatar(url, initial, alt) {
            const avatar = recentElement('div', url ? 'avatar shrink-0' : 'avatar avatar-placeholder shrink-0');
            const frame = recentElement('div', url ? 'h-9 w-9 rounded-full' : 'h-9 w-9 rounded-full bg-neutral text-neutral-content');

            if (url) {
                const image = document.createElement('img');
                image.alt = alt;
                image.loading = 'lazy';
                image.src = url;
                frame.append(image);
            } else {
                frame.append(recentElement('span', 'text-sm font-bold', initial || 'U'));
            }

            avatar.append(frame);
            return avatar;
        }

        function recentCredit(label, name, href, avatarUrl, initial, owner, overlay) {
            const alignment = owner ? ' recent-media-owner-credit flex-row-reverse text-right' : '';
            const color = overlay ? ' pointer-events-auto text-neutral-content drop-shadow-md' : ' text-base-content';
            const labelColor = overlay ? ' text-neutral-content/75' : ' text-base-content/70';
            const link = recentElement('a', 'flex min-w-0 max-w-full items-center gap-2' + alignment + color);
            link.href = href;
            link.append(recentAvatar(avatarUrl, initial, name + ' avatar'));
            const text = recentElement('span', 'min-w-0');
            text.append(recentElement('span', 'block text-xs' + labelColor, label));
            text.append(recentElement('span', 'block truncate font-semibold', name));
            link.append(text);
            return link;
        }

        function createRecentMediaCard(item) {
            const width = Math.max(1, Number(item.width) || 1);
            const height = Math.max(1, Number(item.height) || 1);
            const tile = recentElement('article', 'recent-media-tile card card-border group relative min-w-0 overflow-hidden bg-base-200 md:block md:border-0');
            tile.dataset.mediaId = item.id;
            tile.style.setProperty('--media-aspect', String(width / height));
            tile.style.setProperty('--media-width', String(width));
            tile.style.setProperty('--media-height', String(height));

            const imageLink = recentElement('a', 'recent-media-image-shell relative block overflow-hidden bg-base-300');
            imageLink.href = item.character.href;
            imageLink.setAttribute('aria-label', "View " + item.character.name + "'s character page");
            const skeleton = recentElement('div', 'skeleton absolute inset-0 rounded-none');
            skeleton.dataset.mediaSkeleton = '';
            skeleton.setAttribute('aria-hidden', 'true');
            const image = document.createElement('img');
            image.alt = item.alt;
            image.className = 'absolute inset-0 h-full w-full object-contain opacity-0 transition-opacity motion-reduce:transition-none';
            image.dataset.originalSrc = item.originalSrc;
            image.dataset.recentMediaImage = '';
            image.decoding = 'async';
            image.height = height;
            image.loading = 'lazy';
            image.src = item.previewSrc;
            image.width = width;
            imageLink.append(skeleton, image);
            tile.append(imageLink);

            const mobileCredits = recentElement('div', 'card-body p-3 md:hidden');
            mobileCredits.dataset.mobileCredits = '';
            const mobileCreditGrid = recentElement('div', 'grid grid-cols-2 items-center gap-3');
            mobileCreditGrid.append(recentCredit('Character', item.character.name, item.character.href, item.character.avatarUrl, item.character.name.charAt(0).toUpperCase(), false, false));
            mobileCreditGrid.append(recentCredit('Uploader', item.user.username, item.user.href, item.user.avatarUrl, item.user.initial, true, false));
            mobileCredits.append(mobileCreditGrid);
            tile.append(mobileCredits);

            const overlay = recentElement('div', 'pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden translate-y-1 bg-linear-to-t from-neutral/90 via-neutral/50 to-transparent p-3 pt-12 opacity-0 transition md:flex md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:translate-y-0 md:group-hover:opacity-100 motion-reduce:transition-none');
            overlay.dataset.desktopCredits = '';
            const overlayCredits = recentElement('div', 'recent-media-overlay-credits flex w-full items-end justify-between gap-3');
            overlayCredits.append(recentCredit('Character', item.character.name, item.character.href, item.character.avatarUrl, item.character.name.charAt(0).toUpperCase(), false, true));
            overlayCredits.append(recentCredit('Uploader', item.user.username, item.user.href, item.user.avatarUrl, item.user.initial, true, true));
            overlay.append(overlayCredits);
            tile.append(overlay);
            bindRecentImage(image);

            return tile;
        }

        function appendRecentItems(items) {
            if (!recentFeed) return;

            for (const item of items) {
                let row = recentFeed.lastElementChild;
                if (!row || !row.matches('[data-recent-row]') || row.childElementCount >= 5) {
                    row = recentElement('div', 'recent-media-row contents md:flex');
                    row.dataset.recentRow = '';
                    recentFeed.append(row);
                }
                row.append(createRecentMediaCard(item));
            }
        }

        function updateRecentFilterButtons() {
            if (recentNsfwButton) {
                recentNsfwButton.textContent = recentState.showNsfw ? 'Hide NSFW media' : 'Show NSFW media';
                recentNsfwButton.setAttribute('aria-pressed', recentState.showNsfw ? 'true' : 'false');
                recentNsfwButton.classList.toggle('btn-active', recentState.showNsfw);
            }

            if (recentUnapprovedButton) {
                recentUnapprovedButton.textContent = recentState.showUnapproved ? 'Hide unapproved' : 'Show unapproved';
                recentUnapprovedButton.setAttribute('aria-pressed', recentState.showUnapproved ? 'true' : 'false');
                recentUnapprovedButton.classList.toggle('btn-active', recentState.showUnapproved);
            }
        }

        function setRecentLoading(loading) {
            recentState.inFlight = loading;
            recentFeed?.setAttribute('aria-busy', loading ? 'true' : 'false');
            recentLoading?.classList.toggle('hidden', !loading);
            recentLoadButton?.classList.toggle('hidden', loading || !recentState.hasMore);
            if (recentLoadButton) recentLoadButton.disabled = loading;
            if (recentNsfwButton) recentNsfwButton.disabled = loading;
            if (recentUnapprovedButton) recentUnapprovedButton.disabled = loading;
        }

        function updateRecentEndState() {
            const isEmpty = !recentFeed || recentFeed.childElementCount === 0;
            recentSentinel?.classList.toggle('hidden', !recentState.hasMore);
            recentEnd?.classList.toggle('hidden', recentState.hasMore || isEmpty);
            recentEmpty?.classList.toggle('hidden', !isEmpty);
        }

        async function requestRecentMediaPage(cursor, showNsfw, showUnapproved) {
            const params = new URLSearchParams({
                limit: '24',
                nsfw: showNsfw ? 'true' : 'false',
                unapproved: showUnapproved ? 'true' : 'false',
            });
            if (cursor) params.set('cursor', cursor);
            const response = await fetch('/api/recent-media?' + params.toString(), {headers: {accept: 'application/json'}});
            const body = await response.json().catch(() => ({}));

            if (!response.ok) throw new Error(body.error || 'Could not load uploads.');
            if (!Array.isArray(body.items)) throw new Error('The recent uploads response was invalid.');
            if (body.items.length === 0 && body.nextCursor) throw new Error('Recent uploads pagination returned no media.');

            return body;
        }

        async function persistUnapprovedPreference(showUnapproved) {
            if (recentFeed?.dataset.persistUnapproved !== 'true') return;
            const csrfToken = recentFeed.dataset.csrfToken;
            const response = await fetch('/api/users/me/recent-media-preference', {
                method: 'POST',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                },
                body: JSON.stringify({showUnapproved}),
            });
            const body = await response.json().catch(() => ({}));

            if (!response.ok) throw new Error(body.error || 'Could not save your unapproved media preference.');
        }

        async function applyRecentFilters(showNsfw, showUnapproved, persistUnapproved) {
            if (recentState.inFlight) return;
            setRecentLoading(true);
            recentError?.classList.add('hidden');

            try {
                const body = await requestRecentMediaPage('', showNsfw, showUnapproved);
                if (persistUnapproved) await persistUnapprovedPreference(showUnapproved);

                recentFeed?.replaceChildren();
                appendRecentItems(body.items);
                recentState.showNsfw = showNsfw;
                recentState.showUnapproved = showUnapproved;
                recentState.cursor = typeof body.nextCursor === 'string' ? body.nextCursor : '';
                recentState.hasMore = Boolean(recentState.cursor);
                if (recentLoadButton) recentLoadButton.textContent = 'Load more';
                updateRecentFilterButtons();
                updateRecentEndState();
            } catch (error) {
                if (recentErrorMessage) recentErrorMessage.textContent = error instanceof Error ? error.message : 'Could not update the feed.';
                recentError?.classList.remove('hidden');
            } finally {
                setRecentLoading(false);
            }
        }

        async function loadRecentMedia() {
            if (recentState.inFlight || !recentState.hasMore || !recentState.cursor) return;
            setRecentLoading(true);
            recentError?.classList.add('hidden');

            try {
                const body = await requestRecentMediaPage(recentState.cursor, recentState.showNsfw, recentState.showUnapproved);

                appendRecentItems(body.items);
                recentState.cursor = typeof body.nextCursor === 'string' ? body.nextCursor : '';
                recentState.hasMore = Boolean(recentState.cursor);
                updateRecentEndState();
            } catch (error) {
                recentState.hasMore = true;
                if (recentErrorMessage) recentErrorMessage.textContent = error instanceof Error ? error.message : 'Could not load more uploads.';
                recentError?.classList.remove('hidden');
                recentLoadButton?.classList.remove('hidden');
                if (recentLoadButton) recentLoadButton.textContent = 'Try again';
            } finally {
                setRecentLoading(false);
            }
        }

        document.querySelectorAll('[data-recent-media-image]').forEach(bindRecentImage);
        recentLoadButton?.addEventListener('click', () => {
            recentLoadButton.textContent = 'Load more';
            loadRecentMedia();
        });
        recentNsfwButton?.addEventListener('click', () => {
            applyRecentFilters(!recentState.showNsfw, recentState.showUnapproved, false);
        });
        recentUnapprovedButton?.addEventListener('click', () => {
            applyRecentFilters(recentState.showNsfw, !recentState.showUnapproved, true);
        });

        if ('IntersectionObserver' in window && recentSentinel) {
            const observer = new IntersectionObserver((entries) => {
                if (entries.some((entry) => entry.isIntersecting)) loadRecentMedia();
            }, {rootMargin: '1000px 0px'});
            observer.observe(recentSentinel);
        }

        updateRecentFilterButtons();
        updateRecentEndState();
    `

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function RecentMediaPage({currentUser, guestInitial, mediaBaseUrl, page, showNsfw, showUnapproved}: RecentMediaPageProps) {
    const rows = chunkGalleryItems(page.items)
    const hasMore = Boolean(page.nextCursor)

    return (
        <BaseLayout title="Recently uploaded media | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />
            <RecentMediaStyles />
            <main class="w-full px-3 py-6 sm:px-5 lg:px-6">
                <header class="mb-5 border-b border-base-300 pb-5">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p class="text-sm font-semibold uppercase tracking-widest text-primary">Explore</p>
                            <h1 class="mt-1 text-4xl font-bold sm:text-5xl">Recently uploaded</h1>
                        </div>
                        <fieldset class="flex flex-wrap gap-2">
                            <legend class="sr-only">Media filters</legend>
                            <button
                                aria-controls="recent-media-feed"
                                aria-pressed={showNsfw ? 'true' : 'false'}
                                class={`btn btn-sm ${showNsfw ? 'btn-active' : ''}`}
                                data-recent-filter-nsfw
                                type="button"
                            >
                                {showNsfw ? 'Hide NSFW media' : 'Show NSFW media'}
                            </button>
                            <button
                                aria-controls="recent-media-feed"
                                aria-pressed={showUnapproved ? 'true' : 'false'}
                                class={`btn btn-sm ${showUnapproved ? 'btn-active' : ''}`}
                                data-recent-filter-unapproved
                                type="button"
                            >
                                {showUnapproved ? 'Hide unapproved' : 'Show unapproved'}
                            </button>
                        </fieldset>
                    </div>
                </header>

                <section
                    aria-busy="false"
                    aria-label="Recently uploaded character media"
                    class="mx-auto grid max-w-xl gap-5 md:max-w-none md:gap-2"
                    data-has-more={hasMore ? 'true' : 'false'}
                    data-next-cursor={page.nextCursor ?? ''}
                    data-csrf-token={currentUser?.csrfToken ?? ''}
                    data-persist-unapproved={currentUser ? 'true' : 'false'}
                    data-recent-feed
                    data-show-nsfw={showNsfw ? 'true' : 'false'}
                    data-show-unapproved={showUnapproved ? 'true' : 'false'}
                    id="recent-media-feed"
                >
                    {rows.map((row) => (
                        <div class="recent-media-row contents md:flex" data-recent-row>
                            {row.map((item) => (
                                <RecentMediaCard item={item} />
                            ))}
                        </div>
                    ))}
                </section>

                <div
                    class={`card card-border mx-auto mt-10 max-w-lg bg-base-200 text-center ${page.items.length === 0 ? '' : 'hidden'}`}
                    data-recent-empty
                >
                    <div class="card-body">
                        <h2 class="card-title justify-center">No uploads found</h2>
                        <p>No character media matches these filters.</p>
                    </div>
                </div>

                <div class={`mt-6 min-h-12 items-center justify-center gap-3 ${hasMore ? 'flex' : 'hidden'}`} data-recent-sentinel>
                    <span class="loading loading-spinner loading-md hidden" data-recent-loading></span>
                    <button class="btn btn-sm" data-recent-load-more type="button">
                        Load more
                    </button>
                </div>
                <div class="mt-3 hidden text-center text-error" data-recent-error role="status">
                    <p data-recent-error-message>Could not load more uploads.</p>
                </div>
                <p
                    class={`mt-6 text-center text-sm text-base-content/60 ${hasMore || page.items.length === 0 ? 'hidden' : ''}`}
                    data-recent-end
                >
                    You’re all caught up.
                </p>
            </main>
            <RecentMediaScript />
        </BaseLayout>
    )
}
