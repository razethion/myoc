import type {CurrentUser} from '../../lib/auth/session'
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

type RecentMediaGroup = {
    key: string
    items: [RecentMediaItem, ...RecentMediaItem[]]
}

const RECENT_DESKTOP_MIN_TILES_PER_ROW = 4
const RECENT_MAX_TILES_PER_ROW = 5

function recentMediaGroupKey(item: RecentMediaItem): string {
    return item.groupId
}

function groupSequentialRecentMediaItems(items: RecentMediaItem[]): RecentMediaGroup[] {
    const groups: RecentMediaGroup[] = []

    for (const item of items) {
        const key = recentMediaGroupKey(item)
        const lastGroup = groups.at(-1)

        if (lastGroup?.key === key) {
            lastGroup.items.push(item)
        } else {
            groups.push({key, items: [item]})
        }
    }

    return groups
}

function chunkRecentMediaGroups(groups: RecentMediaGroup[]): RecentMediaGroup[][] {
    if (groups.length === 0) return []

    const rowCount = Math.max(1, Math.ceil(groups.length / RECENT_MAX_TILES_PER_ROW))
    const minimumRowSize = Math.floor(groups.length / rowCount)
    if (minimumRowSize < RECENT_DESKTOP_MIN_TILES_PER_ROW && groups.length > RECENT_MAX_TILES_PER_ROW) {
        return [groups.slice(0, RECENT_MAX_TILES_PER_ROW), ...chunkRecentMediaGroups(groups.slice(RECENT_MAX_TILES_PER_ROW))]
    }
    const largerRowCount = groups.length % rowCount
    const rows: RecentMediaGroup[][] = []
    let groupIndex = 0

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        const rowSize = minimumRowSize + (rowIndex < largerRowCount ? 1 : 0)
        rows.push(groups.slice(groupIndex, groupIndex + rowSize))
        groupIndex += rowSize
    }

    return rows
}

function RecentStackToggle({count, item}: {count: number; item: RecentMediaItem}) {
    const moreCount = count - 1
    const uploadLabel = moreCount === 1 ? 'upload' : 'uploads'

    return (
        <button
            aria-expanded="false"
            aria-label={`Show ${moreCount} more ${uploadLabel} for ${item.character.name} by ${item.user.username}`}
            class="btn btn-neutral absolute inset-x-3 top-3 z-20 h-auto min-h-12 min-w-0 justify-between gap-2 px-3 py-2 opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
            data-recent-stack-toggle
            type="button"
        >
            <span class="min-w-0 truncate text-left font-bold" data-recent-stack-action>
                Show {moreCount} more {uploadLabel}
            </span>
            <svg
                aria-hidden="true"
                class="h-5 w-5 shrink-0"
                data-recent-stack-indicator
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path d="M5 12h14" stroke-linecap="round" stroke-width="2" />
                <path
                    class="transition-opacity motion-reduce:transition-none"
                    d="M12 5v14"
                    data-recent-stack-indicator-vertical
                    stroke-linecap="round"
                    stroke-width="2"
                />
            </svg>
        </button>
    )
}

function CreditAvatar({alt, initial, url}: {alt: string; initial: string; url: string | null}) {
    if (url) {
        return (
            <div class="avatar shrink-0">
                <div class="h-9 w-9 rounded-full">
                    <img alt={alt} class="h-9 w-9 object-cover" height="36" loading="lazy" src={url} width="36" />
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
    const linkClass = owner
        ? overlay
            ? 'recent-media-owner-credit pointer-events-auto flex min-w-0 max-w-full flex-row-reverse items-center gap-2 text-right text-neutral-content drop-shadow-md'
            : 'recent-media-owner-credit flex min-w-0 max-w-full flex-row-reverse items-center gap-2 text-right text-base-content'
        : overlay
          ? 'pointer-events-auto flex min-w-0 max-w-full items-center gap-2 text-neutral-content drop-shadow-md'
          : 'flex min-w-0 max-w-full items-center gap-2 text-base-content'
    const labelClass = overlay ? 'block text-xs text-neutral-content/75' : 'block text-xs text-base-content/70'

    return (
        <a class={linkClass} href={href}>
            <CreditAvatar alt={`${name} avatar`} initial={initial} url={avatarUrl} />
            <span class="min-w-0">
                <span class={labelClass}>{label}</span>
                <span class="block truncate font-semibold">{name}</span>
            </span>
        </a>
    )
}

function RecentMediaCard({
    inStack = false,
    item,
    stackId,
    stackSize = 1,
}: {
    inStack?: boolean
    item: RecentMediaItem
    stackId?: string
    stackSize?: number
}) {
    const aspect = item.width / item.height
    const style = `--media-aspect:${aspect};--media-width:${item.width};--media-height:${item.height};`
    const groupKey = recentMediaGroupKey(item)

    return (
        <article
            class="recent-media-tile card card-border group relative min-w-0 overflow-hidden bg-base-200 md:block md:border-0"
            data-character-name={item.character.name}
            data-media-id={item.id}
            data-recent-entry={inStack ? undefined : true}
            data-stack-id={stackId}
            data-upload-key={groupKey}
            data-uploader-name={item.user.username}
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
                    data-preview-src={item.previewSrc}
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

            {stackSize > 1 ? <RecentStackToggle count={stackSize} item={item} /> : null}
        </article>
    )
}

function serializeRecentMediaItems(items: RecentMediaItem[]): string {
    return JSON.stringify(items).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e')
}

function RecentMediaGroupCard({group}: {group: RecentMediaGroup}) {
    if (group.items.length === 1) {
        return <RecentMediaCard item={group.items[0]} />
    }

    const firstItem = group.items[0]
    const stackId = `recent-stack-${firstItem.id}`
    const aspect = firstItem.width / firstItem.height
    const style = `--media-aspect:${aspect};--media-width:${firstItem.width};--media-height:${firstItem.height};`

    return (
        <div
            class="recent-media-tile relative min-w-0"
            data-character-name={firstItem.character.name}
            data-recent-stack
            data-recent-entry
            data-stack-id={stackId}
            data-upload-key={group.key}
            data-uploader-name={firstItem.user.username}
            style={style}
        >
            <div class="h-full w-full md:absolute md:inset-0" data-recent-stack-content>
                <RecentMediaCard inStack item={firstItem} stackId={stackId} stackSize={group.items.length} />
            </div>
            <script
                data-recent-stack-items
                dangerouslySetInnerHTML={{__html: serializeRecentMediaItems(group.items.slice(1))}}
                type="application/json"
            ></script>
        </div>
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
        const recentStackDefaultButton = document.querySelector('[data-recent-stack-default]');
        const recentUpdate = document.querySelector('[data-recent-update]');
        const recentUpdateMessage = document.querySelector('[data-recent-update-message]');
        const recentRefreshButton = document.querySelector('[data-recent-refresh]');
        const recentStackDefaultKey = 'myoc:recent-media:expand-groups';
        const recentBlockCacheLimit = 8;
        const recentDirectPageSize = 24;
        const recentManifestCacheLimit = 256;
        const recentDesktopMinTilesPerRow = ${RECENT_DESKTOP_MIN_TILES_PER_ROW};
        const recentMaximumTilesPerRow = ${RECENT_MAX_TILES_PER_ROW};
        const recentStateVerificationTtlMs = 5000;
        const recentFeedSchemaVersion = 1;

        function readRecentStackDefault() {
            try {
                return localStorage.getItem(recentStackDefaultKey) === 'true';
            } catch {
                return false;
            }
        }

        function persistRecentStackDefault(expanded) {
            try {
                localStorage.setItem(recentStackDefaultKey, expanded ? 'true' : 'false');
            } catch {
                // Keep the preference for this page when browser storage is unavailable.
            }
        }

        const recentState = {
            directBlockCache: new Map(),
            directManifestCache: new Map(),
            directPosition: readRecentDirectPosition(recentFeed?.dataset.nextPosition),
            directRoot: null,
            directRootUrl: readRecentRootUrl(recentFeed?.dataset.publicRootUrl),
            entries: [],
            expandGroupsByDefault: readRecentStackDefault(),
            generation: recentFeed?.dataset.generation || '',
            availableGeneration: '',
            autoLoadFrame: 0,
            generationExpired: false,
            inFlight: false,
            hasMore: recentFeed?.dataset.hasMore === 'true',
            itemIds: new Set(),
            layoutGroups: [],
            mediaOrigin: readRecentMediaOrigin(recentFeed?.dataset.mediaOrigin),
            nextLayoutGroupId: 0,
            renderedEntryCount: 0,
            sentinelNear: false,
            stateInFlight: null,
            statePollId: 0,
            stateVerifiedAt: 0,
            showNsfw: recentFeed?.dataset.showNsfw === 'true',
            showUnapproved: recentFeed?.dataset.showUnapproved !== 'false',
            stackGroups: new Map(),
        };

        function recentGenerationExpiredError() {
            const error = new Error('This upload list expired. Refresh it to keep browsing.');
            error.code = 'recent-generation-expired';
            return error;
        }

        function readRecentDirectPosition(value) {
            if (value === undefined || value === null || value === '') return null;
            if (typeof value !== 'number' && (typeof value !== 'string' || !/^\\d+$/.test(value))) return null;
            const position = Number(value);
            return Number.isSafeInteger(position) && position >= 0 ? position : null;
        }

        function readRecentRootUrl(value) {
            if (!value) return '';
            try {
                const url = new URL(value);
                if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return '';
                if (!/^\\/generations\\/v1\\/roots\\/[A-Za-z0-9._-]+\\.json$/.test(url.pathname)) return '';
                return url.href;
            } catch {
                return '';
            }
        }

        function readRecentMediaOrigin(value) {
            if (!value) return '';
            try {
                const url = new URL(value);
                return url.protocol === 'https:' ? url.origin : '';
            } catch {
                return '';
            }
        }

        function recentFeedVariant() {
            return 'n' + (recentState.showNsfw ? '1' : '0') + '-u' + (recentState.showUnapproved ? '1' : '0');
        }

        function isRecentRecord(value) {
            return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
        }

        function isRecentCount(value, allowZero = true) {
            return Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
        }

        function isRecentInternalHref(value) {
            return typeof value === 'string'
                && value.startsWith('/')
                && !value.startsWith('//')
                && !value.includes('\\\\')
                && !/[\\u0000-\\u001f]/.test(value);
        }

        function isRecentImageUrl(value) {
            if (typeof value !== 'string' || !recentState.mediaOrigin) return false;
            try {
                const url = new URL(value);
                return url.protocol === 'https:'
                    && url.origin === recentState.mediaOrigin
                    && !url.username
                    && !url.password;
            } catch {
                return false;
            }
        }

        function isRecentMediaItem(item) {
            return isRecentRecord(item)
                && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128
                && typeof item.groupId === 'string' && item.groupId.length > 0 && item.groupId.length <= 512
                && typeof item.alt === 'string' && item.alt.length <= 1000
                && Number.isFinite(item.width)
                && item.width > 0
                && Number.isFinite(item.height)
                && item.height > 0
                && isRecentImageUrl(item.previewSrc)
                && isRecentImageUrl(item.originalSrc)
                && isRecentRecord(item.character)
                && typeof item.character.name === 'string' && item.character.name.length > 0 && item.character.name.length <= 256
                && isRecentInternalHref(item.character.href)
                && isRecentImageUrl(item.character.avatarUrl)
                && isRecentRecord(item.user)
                && typeof item.user.username === 'string' && item.user.username.length > 0 && item.user.username.length <= 128
                && isRecentInternalHref(item.user.href)
                && (item.user.avatarUrl === null || isRecentImageUrl(item.user.avatarUrl))
                && typeof item.user.initial === 'string' && item.user.initial.length <= 8;
        }

        function recentFeedKeyMatches(key, prefix) {
            return typeof key === 'string'
                && key.startsWith(prefix)
                && key.endsWith('.json')
                && !key.includes('..')
                && !key.includes('\\\\')
                && /^[A-Za-z0-9:_./-]+$/.test(key);
        }

        function validateRecentReferences(references, labelName, labelPattern, keyPrefix, maximumLength) {
            if (!Array.isArray(references) || references.length > maximumLength) {
                throw new Error('The recent uploads manifest was invalid.');
            }

            let previousLabel = '';
            let itemCount = 0;
            const labels = new Set();
            for (const reference of references) {
                const label = reference?.[labelName];
                if (!isRecentRecord(reference)
                    || typeof label !== 'string'
                    || !labelPattern.test(label)
                    || labels.has(label)
                    || (previousLabel && previousLabel <= label)
                    || !isRecentCount(reference.itemCount, false)
                    || !recentFeedKeyMatches(reference.key, keyPrefix + label + '/')) {
                    throw new Error('The recent uploads manifest was invalid.');
                }
                labels.add(label);
                previousLabel = label;
                itemCount += reference.itemCount;
                if (!Number.isSafeInteger(itemCount)) throw new Error('The recent uploads manifest was invalid.');
            }
            return itemCount;
        }

        function validateRecentBlockReferences(references, variant, hour) {
            if (!Array.isArray(references) || references.length > 4096) {
                throw new Error('The recent uploads manifest was invalid.');
            }
            let itemCount = 0;
            const keys = new Set();
            for (const reference of references) {
                if (!isRecentRecord(reference)
                    || !isRecentCount(reference.itemCount, false)
                    || keys.has(reference.key)
                    || !recentFeedKeyMatches(reference.key, 'generations/v1/blocks/' + variant + '/' + hour + '/')) {
                    throw new Error('The recent uploads manifest was invalid.');
                }
                keys.add(reference.key);
                itemCount += reference.itemCount;
                if (!Number.isSafeInteger(itemCount)) throw new Error('The recent uploads manifest was invalid.');
            }
            return itemCount;
        }

        function recentFeedObjectUrl(key) {
            if (!recentState.directRootUrl) throw new Error('The recent uploads source was invalid.');
            const rootUrl = new URL(recentState.directRootUrl);
            const objectUrl = new URL('/' + key, rootUrl.origin);
            if (objectUrl.origin !== rootUrl.origin) throw new Error('The recent uploads source was invalid.');
            return objectUrl.href;
        }

        async function fetchRecentFeedJson(url, cacheManifest = true) {
            if (cacheManifest && recentState.directManifestCache.has(url)) {
                const cached = recentState.directManifestCache.get(url);
                recentState.directManifestCache.delete(url);
                recentState.directManifestCache.set(url, cached);
                return cached;
            }

            const response = await fetch(url, {
                credentials: 'omit',
                headers: {accept: 'application/json'},
                mode: 'cors',
            });
            if (response.status === 404 || response.status === 410) throw recentGenerationExpiredError();
            if (!response.ok) throw new Error('Could not load uploads.');
            if (response.url && new URL(response.url).origin !== new URL(url).origin) {
                throw new Error('The recent uploads source was invalid.');
            }
            const contentType = response.headers.get('content-type');
            if (!contentType?.toLowerCase().includes('application/json')) {
                throw new Error('The recent uploads response was invalid.');
            }
            const contentLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(contentLength) && contentLength > 2_000_000) {
                throw new Error('The recent uploads manifest was too large.');
            }
            const text = await response.text();
            if (text.length > 2_000_000) throw new Error('The recent uploads manifest was too large.');
            let body;
            try {
                body = JSON.parse(text);
            } catch {
                throw new Error('The recent uploads manifest was invalid.');
            }
            if (cacheManifest) {
                recentState.directManifestCache.delete(url);
                recentState.directManifestCache.set(url, body);
                while (recentState.directManifestCache.size > recentManifestCacheLimit) {
                    const oldestKey = recentState.directManifestCache.keys().next().value;
                    if (typeof oldestKey !== 'string') break;
                    recentState.directManifestCache.delete(oldestKey);
                }
            }
            return body;
        }

        async function readRecentRoot() {
            if (recentState.directRoot) return recentState.directRoot;
            const root = await fetchRecentFeedJson(recentState.directRootUrl);
            const variant = recentFeedVariant();
            const variantRoot = root?.variants?.[variant];
            if (!isRecentRecord(root)
                || root.schemaVersion !== recentFeedSchemaVersion
                || root.generation !== recentState.generation
                || !isRecentRecord(variantRoot)
                || !isRecentCount(variantRoot.itemCount)) {
                throw new Error('The recent uploads root was invalid.');
            }
            const count = validateRecentReferences(
                variantRoot.years,
                'year',
                /^\\d{4}$/,
                'generations/v1/manifests/' + variant + '/years/',
                100,
            );
            if (count !== variantRoot.itemCount) throw new Error('The recent uploads root count was invalid.');
            recentState.directRoot = root;
            return root;
        }

        async function readRecentYear(reference, variant) {
            const manifest = await fetchRecentFeedJson(recentFeedObjectUrl(reference.key));
            if (!isRecentRecord(manifest)
                || manifest.schemaVersion !== recentFeedSchemaVersion
                || manifest.variant !== variant
                || manifest.year !== reference.year
                || manifest.itemCount !== reference.itemCount) {
                throw new Error('The recent uploads year manifest was invalid.');
            }
            const count = validateRecentReferences(
                manifest.months,
                'month',
                new RegExp('^' + reference.year + '-(?:0[1-9]|1[0-2])$'),
                'generations/v1/manifests/' + variant + '/months/',
                12,
            );
            if (count !== manifest.itemCount) throw new Error('The recent uploads year count was invalid.');
            return manifest;
        }

        async function readRecentMonth(reference, variant, year) {
            const manifest = await fetchRecentFeedJson(recentFeedObjectUrl(reference.key));
            if (!isRecentRecord(manifest)
                || manifest.schemaVersion !== recentFeedSchemaVersion
                || manifest.variant !== variant
                || manifest.month !== reference.month
                || !reference.month.startsWith(year + '-')
                || manifest.itemCount !== reference.itemCount) {
                throw new Error('The recent uploads month manifest was invalid.');
            }
            const count = validateRecentReferences(
                manifest.days,
                'day',
                new RegExp('^' + reference.month + '-(?:0[1-9]|[12][0-9]|3[01])$'),
                'generations/v1/manifests/' + variant + '/days/',
                31,
            );
            if (count !== manifest.itemCount) throw new Error('The recent uploads month count was invalid.');
            return manifest;
        }

        async function readRecentDay(reference, variant, month) {
            const manifest = await fetchRecentFeedJson(recentFeedObjectUrl(reference.key));
            if (!isRecentRecord(manifest)
                || manifest.schemaVersion !== recentFeedSchemaVersion
                || manifest.variant !== variant
                || manifest.day !== reference.day
                || !reference.day.startsWith(month + '-')
                || manifest.itemCount !== reference.itemCount
                || !Array.isArray(manifest.hours)
                || manifest.hours.length > 24) {
                throw new Error('The recent uploads day manifest was invalid.');
            }

            let previousHour = '';
            let count = 0;
            const hours = new Set();
            for (const hour of manifest.hours) {
                if (!isRecentRecord(hour)
                    || typeof hour.hour !== 'string'
                    || !new RegExp('^' + reference.day + 'T(?:[01][0-9]|2[0-3])$').test(hour.hour)
                    || hours.has(hour.hour)
                    || (previousHour && previousHour <= hour.hour)
                    || !isRecentCount(hour.itemCount, false)) {
                    throw new Error('The recent uploads day manifest was invalid.');
                }
                const blockCount = validateRecentBlockReferences(hour.blocks, variant, hour.hour);
                if (blockCount !== hour.itemCount) throw new Error('The recent uploads hour count was invalid.');
                hours.add(hour.hour);
                previousHour = hour.hour;
                count += hour.itemCount;
                if (!Number.isSafeInteger(count)) throw new Error('The recent uploads day manifest was invalid.');
            }
            if (count !== manifest.itemCount) throw new Error('The recent uploads day count was invalid.');
            return manifest;
        }

        async function readRecentBlock(reference, variant, hour) {
            const url = recentFeedObjectUrl(reference.key);
            if (recentState.directBlockCache.has(url)) {
                const cached = recentState.directBlockCache.get(url);
                recentState.directBlockCache.delete(url);
                recentState.directBlockCache.set(url, cached);
                return cached;
            }
            const block = await fetchRecentFeedJson(url, false);
            if (!isRecentRecord(block)
                || block.schemaVersion !== recentFeedSchemaVersion
                || block.variant !== variant
                || block.hour !== hour
                || !Array.isArray(block.items)
                || block.items.length !== reference.itemCount
                || !block.items.every(isRecentMediaItem)) {
                throw new Error('The recent uploads block was invalid.');
            }
            recentState.directBlockCache.set(url, block);
            while (recentState.directBlockCache.size > recentBlockCacheLimit) {
                const oldestKey = recentState.directBlockCache.keys().next().value;
                if (typeof oldestKey !== 'string') break;
                recentState.directBlockCache.delete(oldestKey);
            }
            return block;
        }

        async function collectRecentReferences(references, position, limit, loadChild, collectChild) {
            const requests = [];
            let offset = position;
            let remaining = limit;
            for (const reference of references) {
                if (remaining === 0) break;
                if (offset >= reference.itemCount) {
                    offset -= reference.itemCount;
                    continue;
                }
                const childOffset = offset;
                const childLimit = Math.min(remaining, reference.itemCount - childOffset);
                requests.push((async () => collectChild(await loadChild(reference), childOffset, childLimit))());
                remaining -= childLimit;
                offset = 0;
            }
            return (await Promise.all(requests)).flat();
        }

        async function collectRecentBlocks(hour, position, limit, variant) {
            return collectRecentReferences(
                hour.blocks,
                position,
                limit,
                (reference) => readRecentBlock(reference, variant, hour.hour),
                (block, offset, remaining) => block.items.slice(offset, offset + remaining),
            );
        }

        async function collectRecentHours(day, position, limit, variant) {
            return collectRecentReferences(
                day.hours,
                position,
                limit,
                async (hour) => hour,
                (hour, offset, remaining) => collectRecentBlocks(hour, offset, remaining, variant),
            );
        }

        async function collectRecentDays(month, position, limit, variant) {
            return collectRecentReferences(
                month.days,
                position,
                limit,
                (reference) => readRecentDay(reference, variant, month.month),
                (day, offset, remaining) => collectRecentHours(day, offset, remaining, variant),
            );
        }

        async function collectRecentMonths(year, position, limit, variant) {
            return collectRecentReferences(
                year.months,
                position,
                limit,
                (reference) => readRecentMonth(reference, variant, year.year),
                (month, offset, remaining) => collectRecentDays(month, offset, remaining, variant),
            );
        }

        async function loadRecentDirectPage() {
            if (!recentState.directRootUrl || recentState.directPosition === null) return null;
            const root = await readRecentRoot();
            const variant = recentFeedVariant();
            const variantRoot = root.variants[variant];
            const position = recentState.directPosition;
            if (position > variantRoot.itemCount) throw new Error('The recent uploads position was invalid.');
            const items = await collectRecentReferences(
                variantRoot.years,
                position,
                recentDirectPageSize,
                (reference) => readRecentYear(reference, variant),
                (year, offset, remaining) => collectRecentMonths(year, offset, remaining, variant),
            );
            if (items.length === 0 && position < variantRoot.itemCount) {
                throw new Error('Recent uploads pagination returned no media.');
            }
            const nextPosition = position + items.length;
            return {
                items,
                nextPosition: nextPosition < variantRoot.itemCount ? nextPosition : null,
            };
        }

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

        function recentAvatar(url, initial, alt, deferImage) {
            const avatar = recentElement('div', url ? 'avatar shrink-0' : 'avatar avatar-placeholder shrink-0');
            const frame = recentElement('div', url ? 'h-9 w-9 rounded-full' : 'h-9 w-9 rounded-full bg-neutral text-neutral-content');

            if (url) {
                const image = document.createElement('img');
                image.alt = alt;
                image.className = 'h-9 w-9';
                image.dataset.deferredSrc = url;
                image.height = 36;
                image.loading = 'lazy';
                if (!deferImage) image.src = url;
                image.width = 36;
                frame.append(image);
            } else {
                frame.append(recentElement('span', 'text-sm font-bold', initial || 'U'));
            }

            avatar.append(frame);
            return avatar;
        }

        function recentCredit(label, name, href, avatarUrl, initial, owner, overlay, deferImage) {
            const alignment = owner ? ' recent-media-owner-credit flex-row-reverse text-right' : '';
            const color = overlay ? ' pointer-events-auto text-neutral-content drop-shadow-md' : ' text-base-content';
            const labelColor = overlay ? ' text-neutral-content/75' : ' text-base-content/70';
            const link = recentElement('a', 'flex min-w-0 max-w-full items-center gap-2' + alignment + color);
            link.href = href;
            link.append(recentAvatar(avatarUrl, initial, name + ' avatar', deferImage));
            const text = recentElement('span', 'min-w-0');
            text.append(recentElement('span', 'block text-xs' + labelColor, label));
            text.append(recentElement('span', 'block truncate font-semibold', name));
            link.append(text);
            return link;
        }

        function recentUploadKey(item) {
            return item.groupId;
        }

        function setRecentStackCardState(card, collapsed, index) {
            const hidden = collapsed && index > 0;

            if (collapsed) delete card.dataset.recentEntry;
            else card.dataset.recentEntry = '';
            card.inert = hidden;
            if (hidden) {
                card.setAttribute('aria-hidden', 'true');
            } else {
                card.removeAttribute('aria-hidden');
                card.querySelectorAll('[data-deferred-src]').forEach((image) => {
                    if (!image.getAttribute('src')) image.src = image.dataset.deferredSrc;
                });
            }
        }

        function createRecentStackToggle() {
            const button = recentElement('button', 'btn btn-neutral absolute inset-x-3 top-3 z-20 h-auto min-h-12 min-w-0 justify-between gap-2 px-3 py-2 opacity-90 transition-opacity hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none');
            button.dataset.recentStackToggle = '';
            button.type = 'button';
            const action = recentElement('span', 'min-w-0 truncate text-left font-bold');
            action.dataset.recentStackAction = '';
            const indicator = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            indicator.dataset.recentStackIndicator = '';
            indicator.setAttribute('aria-hidden', 'true');
            indicator.setAttribute('class', 'h-5 w-5 shrink-0');
            indicator.setAttribute('fill', 'none');
            indicator.setAttribute('stroke', 'currentColor');
            indicator.setAttribute('viewBox', '0 0 24 24');
            const horizontalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            horizontalPath.setAttribute('d', 'M5 12h14');
            horizontalPath.setAttribute('stroke-linecap', 'round');
            horizontalPath.setAttribute('stroke-width', '2');
            const verticalPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            verticalPath.dataset.recentStackIndicatorVertical = '';
            verticalPath.setAttribute('class', 'transition-opacity motion-reduce:transition-none');
            verticalPath.setAttribute('d', 'M12 5v14');
            verticalPath.setAttribute('stroke-linecap', 'round');
            verticalPath.setAttribute('stroke-width', '2');
            indicator.append(horizontalPath, verticalPath);
            button.append(action, indicator);
            return button;
        }

        function recentStackCards(stack) {
            return recentState.stackGroups.get(stack.dataset.stackId)?.cards || [];
        }

        function updateRecentStack(stack) {
            const cards = recentStackCards(stack);
            const record = recentState.stackGroups.get(stack.dataset.stackId);
            const count = record ? 1 + record.items.length : cards.length;
            const expanded = record?.expanded === true;
            let button = cards[0]?.querySelector('[data-recent-stack-toggle]');

            if (!button && cards[0]) {
                button = createRecentStackToggle();
                cards[0].append(button);
            }

            if (button) {
                const action = button.querySelector('[data-recent-stack-action]');
                const indicatorVertical = button.querySelector('[data-recent-stack-indicator-vertical]');
                const moreCount = Math.max(1, count - 1);
                const uploadLabel = moreCount === 1 ? 'upload' : 'uploads';
                button.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                button.setAttribute(
                    'aria-label',
                    expanded
                        ? 'Hide ' + moreCount + ' ' + uploadLabel + ' for ' + stack.dataset.characterName + ' by ' + stack.dataset.uploaderName
                        : 'Show ' + moreCount + ' more ' + uploadLabel + ' for ' + stack.dataset.characterName + ' by ' + stack.dataset.uploaderName,
                );
                if (action) action.textContent = expanded
                    ? 'Hide ' + moreCount + ' ' + uploadLabel
                    : 'Show ' + moreCount + ' more ' + uploadLabel;
                indicatorVertical?.classList.toggle('opacity-0', expanded);
            }
        }

        function createRecentMediaCard(item, deferImage) {
            const width = Math.max(1, Number(item.width) || 1);
            const height = Math.max(1, Number(item.height) || 1);
            const tile = recentElement('article', 'recent-media-tile card card-border group relative min-w-0 overflow-hidden bg-base-200 md:block md:border-0');
            tile.dataset.mediaId = item.id;
            tile.dataset.uploadKey = recentUploadKey(item);
            tile.dataset.characterName = item.character.name;
            tile.dataset.recentEntry = '';
            tile.dataset.uploaderName = item.user.username;
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
            image.dataset.previewSrc = item.previewSrc;
            image.dataset.deferredSrc = item.previewSrc;
            image.dataset.recentMediaImage = '';
            image.decoding = 'async';
            image.height = height;
            image.loading = 'lazy';
            if (!deferImage) image.src = item.previewSrc;
            image.width = width;
            imageLink.append(skeleton, image);
            tile.append(imageLink);

            const mobileCredits = recentElement('div', 'card-body p-3 md:hidden');
            mobileCredits.dataset.mobileCredits = '';
            const mobileCreditGrid = recentElement('div', 'grid grid-cols-2 items-center gap-3');
            mobileCreditGrid.append(recentCredit('Character', item.character.name, item.character.href, item.character.avatarUrl, item.character.name.charAt(0).toUpperCase(), false, false, deferImage));
            mobileCreditGrid.append(recentCredit('Uploader', item.user.username, item.user.href, item.user.avatarUrl, item.user.initial, true, false, deferImage));
            mobileCredits.append(mobileCreditGrid);
            tile.append(mobileCredits);

            const overlay = recentElement('div', 'pointer-events-none absolute inset-x-0 bottom-0 z-10 hidden translate-y-1 bg-linear-to-t from-neutral/90 via-neutral/50 to-transparent p-3 pt-12 opacity-0 transition md:flex md:group-focus-within:translate-y-0 md:group-focus-within:opacity-100 md:group-hover:translate-y-0 md:group-hover:opacity-100 motion-reduce:transition-none');
            overlay.dataset.desktopCredits = '';
            const overlayCredits = recentElement('div', 'recent-media-overlay-credits flex w-full items-end justify-between gap-3');
            overlayCredits.append(recentCredit('Character', item.character.name, item.character.href, item.character.avatarUrl, item.character.name.charAt(0).toUpperCase(), false, true, deferImage));
            overlayCredits.append(recentCredit('Uploader', item.user.username, item.user.href, item.user.avatarUrl, item.user.initial, true, true, deferImage));
            overlay.append(overlayCredits);
            tile.append(overlay);
            bindRecentImage(image);

            return tile;
        }

        function registerRecentStack(stack, items, expanded = false) {
            const record = {
                cards: Array.from(stack.querySelectorAll('[data-recent-stack-content] > [data-media-id]')),
                detachedCards: document.createDocumentFragment(),
                expanded: false,
                id: stack.dataset.stackId,
                items,
                key: stack.dataset.uploadKey,
                kind: 'stack',
                stack,
            };
            recentState.stackGroups.set(record.id, record);
            updateRecentStack(stack);
            if (expanded) applyRecentStackExpanded(record, true);
            return record;
        }

        function createRecentStack(firstCard, key, items, requestedStackId) {
            const previousParent = firstCard.parentNode;
            const previousNextSibling = firstCard.nextSibling;
            const stackId = requestedStackId || 'recent-stack-' + firstCard.dataset.mediaId;
            const stack = recentElement('div', 'recent-media-tile relative min-w-0');
            stack.dataset.recentStack = '';
            stack.dataset.recentEntry = '';
            stack.dataset.stackId = stackId;
            stack.dataset.uploadKey = key;
            stack.dataset.characterName = firstCard.dataset.characterName;
            stack.dataset.uploaderName = firstCard.dataset.uploaderName;
            stack.style.setProperty('--media-aspect', firstCard.style.getPropertyValue('--media-aspect'));
            stack.style.setProperty('--media-width', firstCard.style.getPropertyValue('--media-width'));
            stack.style.setProperty('--media-height', firstCard.style.getPropertyValue('--media-height'));

            const content = recentElement('div', 'h-full w-full md:absolute md:inset-0');
            content.dataset.recentStackContent = '';
            firstCard.dataset.stackId = stackId;
            setRecentStackCardState(firstCard, true, 0);
            content.append(firstCard);
            stack.append(content);
            const record = registerRecentStack(stack, items, recentState.expandGroupsByDefault);
            if (previousParent) previousParent.insertBefore(stack, previousNextSibling);
            return record;
        }

        function createRecentRow(layoutGroupId) {
            const row = recentElement('div', 'recent-media-row min-w-0 max-w-full contents md:flex');
            row.dataset.recentRow = '';
            row.dataset.recentLayoutGroup = layoutGroupId;
            return row;
        }

        function recentLayoutNodes(entries) {
            return entries.flatMap((entry) =>
                entry.kind === 'stack' && entry.expanded ? entry.cards : [entry.kind === 'stack' ? entry.stack : entry.node],
            );
        }

        function recentMinimumTilesPerRow() {
            if (window.innerWidth >= 1280) return recentDesktopMinTilesPerRow;
            if (window.innerWidth >= 1024) return 3;
            if (window.innerWidth >= 768) return 2;
            return 1;
        }

        function recentRowSizes(itemCount, minimumRowSize = recentMinimumTilesPerRow()) {
            if (itemCount === 0) return [];
            const rowCount = Math.max(1, Math.ceil(itemCount / recentMaximumTilesPerRow));
            const balancedMinimum = Math.floor(itemCount / rowCount);
            if (balancedMinimum < minimumRowSize && itemCount > recentMaximumTilesPerRow) {
                return [recentMaximumTilesPerRow, ...recentRowSizes(itemCount - recentMaximumTilesPerRow, minimumRowSize)];
            }
            const largerRowCount = itemCount % rowCount;
            return Array.from(
                {length: rowCount},
                (_, rowIndex) => balancedMinimum + (rowIndex < largerRowCount ? 1 : 0),
            );
        }

        function recentCanFillRows(itemCount, minimumRowSize = recentMinimumTilesPerRow()) {
            if (itemCount === 0) return false;
            return Math.ceil(itemCount / recentMaximumTilesPerRow) <= Math.floor(itemCount / minimumRowSize);
        }

        function recentRowMatches(row, nodes) {
            return row.childElementCount === nodes.length && nodes.every((node, index) => row.children[index] === node);
        }

        function renderRecentLayoutGroup(group) {
            if (!recentFeed) return;
            const nodes = recentLayoutNodes(group.entries);
            const rows = Array.from(recentFeed.querySelectorAll(':scope > [data-recent-row]'))
                .filter((row) => row.dataset.recentLayoutGroup === group.id);
            const fixedRowSizes = Array.isArray(group.fixedRowSizes) ? group.fixedRowSizes : [];
            const fixedNodeCount = fixedRowSizes.reduce((total, size) => total + size, 0);
            const rowSizes = fixedNodeCount <= nodes.length
                ? [...fixedRowSizes, ...recentRowSizes(nodes.length - fixedNodeCount)]
                : recentRowSizes(nodes.length);
            let nodeIndex = 0;
            let insertionRow = rows.at(-1) || null;

            for (let rowIndex = 0; rowIndex < rowSizes.length; rowIndex += 1) {
                const rowSize = rowSizes[rowIndex];
                const targetNodes = nodes.slice(nodeIndex, nodeIndex + rowSize);
                const row = rows[rowIndex] || createRecentRow(group.id);
                if (!row.isConnected) {
                    if (insertionRow?.isConnected) insertionRow.after(row);
                    else recentFeed.append(row);
                }
                if (!recentRowMatches(row, targetNodes)) row.replaceChildren(...targetNodes);
                const rowSizeValue = String(targetNodes.length);
                if (row.dataset.recentRowSize !== rowSizeValue) row.dataset.recentRowSize = rowSizeValue;
                insertionRow = row;
                nodeIndex += rowSize;
            }

            rows.slice(rowSizes.length).forEach((row) => row.remove());
        }

        function stabilizeRecentStackLayout(record, button) {
            if (!recentFeed || !button) return recentState.layoutGroups.find((group) => group.entries.includes(record));
            const clickedRow = button.closest('[data-recent-row]');
            const layoutGroup = recentState.layoutGroups.find((group) => group.entries.includes(record));
            const layoutGroupIndex = recentState.layoutGroups.indexOf(layoutGroup);
            if (!clickedRow || !layoutGroup || layoutGroupIndex < 0) return layoutGroup;

            const targetRows = Array.from(recentFeed.querySelectorAll(':scope > [data-recent-row]'))
                .filter((row) => row.dataset.recentLayoutGroup === layoutGroup.id);
            const clickedRowIndex = targetRows.indexOf(clickedRow);
            if (clickedRowIndex < 0) return layoutGroup;

            const groupsToMerge = recentState.layoutGroups.slice(layoutGroupIndex);
            const mergedGroupIds = new Set(groupsToMerge.map((group) => group.id));
            layoutGroup.entries = groupsToMerge.flatMap((group) => group.entries);
            layoutGroup.fixedRowSizes = targetRows
                .slice(0, clickedRowIndex + 1)
                .map((row) => row.childElementCount);
            recentFeed.querySelectorAll(':scope > [data-recent-row]').forEach((row) => {
                if (mergedGroupIds.has(row.dataset.recentLayoutGroup)) row.dataset.recentLayoutGroup = layoutGroup.id;
            });
            recentState.layoutGroups.splice(layoutGroupIndex, groupsToMerge.length, layoutGroup);
            return layoutGroup;
        }

        function reconcileRecentRows() {
            if (!recentFeed) return;
            const focusedElement = document.activeElement;
            const restoreFocus = focusedElement instanceof HTMLElement && recentFeed.contains(focusedElement);
            recentState.layoutGroups.forEach(renderRecentLayoutGroup);
            if (restoreFocus && focusedElement.isConnected && document.activeElement !== focusedElement) {
                focusedElement.focus({preventScroll: true});
            }
        }

        function replaceRecentEntry(currentEntry, replacementEntry) {
            const entryIndex = recentState.entries.indexOf(currentEntry);
            if (entryIndex >= 0) recentState.entries[entryIndex] = replacementEntry;
            for (const group of recentState.layoutGroups) {
                const groupIndex = group.entries.indexOf(currentEntry);
                if (groupIndex >= 0) group.entries[groupIndex] = replacementEntry;
            }
        }

        function commitRecentPendingRows(force = false) {
            if (!recentFeed) return;
            const pendingEntries = recentState.entries.slice(recentState.renderedEntryCount);
            const pendingNodes = recentLayoutNodes(pendingEntries);
            const minimumRowSize = recentMinimumTilesPerRow();
            if (!force && !recentCanFillRows(pendingNodes.length, minimumRowSize)) return;

            if (pendingEntries.length > 0) {
                const lastGroup = recentState.layoutGroups.at(-1);
                if (force && !recentCanFillRows(pendingNodes.length, minimumRowSize) && lastGroup) {
                    lastGroup.entries.push(...pendingEntries);
                    renderRecentLayoutGroup(lastGroup);
                } else {
                    const group = {id: String(recentState.nextLayoutGroupId++), entries: pendingEntries};
                    recentState.layoutGroups.push(group);
                    renderRecentLayoutGroup(group);
                }
            }
            recentState.renderedEntryCount = recentState.entries.length;
        }

        function hydrateRecentStack(record) {
            const hydratedItemCount = record.cards.length - 1;
            record.items.slice(hydratedItemCount).forEach((item) => {
                const card = createRecentMediaCard(item, false);
                card.dataset.stackId = record.id;
                record.cards.push(card);
            });
        }

        function evictCollapsedStackCards(currentId) {
            for (const record of recentState.stackGroups.values()) {
                if (record.id === currentId || record.expanded || record.cards.length === 1) continue;
                record.detachedCards.replaceChildren();
                record.cards = [record.cards[0]];
            }
        }

        function applyRecentStackExpanded(record, expanded) {
            if (record.expanded === expanded) return false;
            if (expanded) hydrateRecentStack(record);
            record.expanded = expanded;
            if (expanded) {
                record.stack.dataset.stackExpanded = 'true';
                delete record.stack.dataset.recentEntry;
                record.cards.forEach((card, index) => setRecentStackCardState(card, false, index));
            } else {
                delete record.stack.dataset.stackExpanded;
                record.stack.dataset.recentEntry = '';
                record.cards.forEach((card, index) => setRecentStackCardState(card, true, index));
                const content = record.stack.querySelector('[data-recent-stack-content]');
                content?.replaceChildren(record.cards[0]);
                record.detachedCards.replaceChildren(...record.cards.slice(1));
            }
            updateRecentStack(record.stack);
            return true;
        }

        function setRecentStackExpanded(record, expanded) {
            const button = record.cards[0]?.querySelector('[data-recent-stack-toggle]');
            const anchorTop = button?.getBoundingClientRect().top;
            const layoutGroup = stabilizeRecentStackLayout(record, button);
            if (!applyRecentStackExpanded(record, expanded)) return;
            if (!expanded) evictCollapsedStackCards(record.id);
            if (layoutGroup) renderRecentLayoutGroup(layoutGroup);
            else reconcileRecentRows();
            if (button?.isConnected && Number.isFinite(anchorTop)) {
                const offset = button.getBoundingClientRect().top - anchorTop;
                if (Math.abs(offset) >= 1) window.scrollBy(0, offset);
            }
            button?.focus({preventScroll: true});
        }

        function setAllRecentStacksExpanded(expanded) {
            let changed = false;
            for (const record of recentState.stackGroups.values()) {
                changed = applyRecentStackExpanded(record, expanded) || changed;
            }
            if (!expanded) evictCollapsedStackCards('');
            if (changed) reconcileRecentRows();
        }

        function appendRecentItems(items) {
            if (!recentFeed) return false;
            let renderedLayoutChanged = false;

            for (const item of items) {
                if (!item || typeof item.id !== 'string' || recentState.itemIds.has(item.id)) continue;
                recentState.itemIds.add(item.id);
                const key = recentUploadKey(item);
                const lastEntry = recentState.entries.at(-1);

                if (lastEntry?.kind === 'stack' && lastEntry.key === key) {
                    lastEntry.items.push(item);
                    if (lastEntry.expanded) {
                        hydrateRecentStack(lastEntry);
                        renderedLayoutChanged = true;
                    }
                    updateRecentStack(lastEntry.stack);
                    continue;
                }

                if (lastEntry?.kind === 'card' && lastEntry.key === key) {
                    const stackEntry = createRecentStack(lastEntry.node, key, [item]);
                    replaceRecentEntry(lastEntry, stackEntry);
                    renderedLayoutChanged = renderedLayoutChanged || stackEntry.expanded;
                    continue;
                }

                const card = createRecentMediaCard(item, false);
                recentState.entries.push({key, kind: 'card', node: card});
            }

            return renderedLayoutChanged;
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

            if (recentStackDefaultButton) {
                const expanded = recentState.expandGroupsByDefault;
                recentStackDefaultButton.textContent = expanded ? 'Collapse uploads' : 'Expand uploads';
                recentStackDefaultButton.setAttribute('aria-pressed', expanded ? 'true' : 'false');
                recentStackDefaultButton.setAttribute(
                    'aria-label',
                    expanded ? 'Collapse multiple uploads by default' : 'Expand multiple uploads by default',
                );
                recentStackDefaultButton.classList.toggle('btn-active', expanded);
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
            if (recentStackDefaultButton) recentStackDefaultButton.disabled = loading;
            if (recentRefreshButton) recentRefreshButton.disabled = loading;
            updateRecentEndState();
        }

        function updateRecentEndState() {
            const isEmpty = !recentFeed || recentFeed.childElementCount === 0;
            recentSentinel?.classList.toggle('hidden', !recentState.hasMore);
            recentEnd?.classList.toggle('hidden', recentState.hasMore || isEmpty);
            recentEmpty?.classList.toggle('hidden', !isEmpty || recentState.inFlight || recentState.hasMore);
        }

        function scheduleRecentAutoLoad() {
            if (recentState.autoLoadFrame || recentState.inFlight || !recentState.hasMore || !recentState.sentinelNear) return;
            recentState.autoLoadFrame = window.requestAnimationFrame(() => {
                recentState.autoLoadFrame = 0;
                if (!recentState.inFlight && recentState.hasMore && recentState.sentinelNear) {
                    void loadRecentMedia();
                }
            });
        }

        async function requestRecentMediaPage(showNsfw, showUnapproved) {
            const params = new URLSearchParams({
                limit: '24',
                nsfw: showNsfw ? 'true' : 'false',
                unapproved: showUnapproved ? 'true' : 'false',
            });
            const response = await fetch('/api/recent-media?' + params.toString(), {headers: {accept: 'application/json'}});
            const body = await response.json().catch(() => ({}));

            if (!response.ok) {
                const error = new Error(body.error || 'Could not load uploads.');
                if (response.status === 410) error.code = 'recent-generation-expired';
                throw error;
            }
            if (!Array.isArray(body.items)) throw new Error('The recent uploads response was invalid.');

            return body;
        }

        function hideRecentUpdate() {
            recentUpdate?.classList.add('hidden');
            recentState.availableGeneration = '';
            recentState.generationExpired = false;
        }

        function showRecentUpdate(expired) {
            recentState.generationExpired = expired;
            if (recentUpdateMessage) {
                recentUpdateMessage.textContent = expired
                    ? 'This upload list expired. Refresh it to keep browsing.'
                    : 'New uploads are available.';
            }
            if (recentRefreshButton) recentRefreshButton.textContent = expired ? 'Refresh uploads' : 'Show new uploads';
            recentUpdate?.classList.remove('hidden');
        }

        function adoptRecentPageSource(body) {
            recentState.generation = typeof body.generation === 'string' ? body.generation : '';
            recentState.directBlockCache.clear();
            recentState.directManifestCache.clear();
            recentState.directRoot = null;
            recentState.stateVerifiedAt = 0;

            const rootUrl = readRecentRootUrl(body.publicRootUrl);
            const position = readRecentDirectPosition(body.nextPosition);
            const hasDirectPage = Boolean(recentState.generation && rootUrl && position !== null);
            recentState.directRootUrl = hasDirectPage ? rootUrl : '';
            recentState.directPosition = hasDirectPage ? position : null;
            recentState.hasMore = hasDirectPage;

            if (recentFeed) {
                recentFeed.dataset.generation = recentState.generation;
                recentFeed.dataset.nextPosition = recentState.directPosition === null ? '' : String(recentState.directPosition);
                recentFeed.dataset.publicRootUrl = recentState.directRootUrl;
            }
        }

        async function appendRecentDirectPagesUntilRowsAreReady() {
            let renderedLayoutChanged = false;
            do {
                const body = await loadRecentDirectPage();
                if (!body) throw new Error('Could not load uploads.');
                renderedLayoutChanged = appendRecentItems(body.items) || renderedLayoutChanged;
                recentState.directPosition = readRecentDirectPosition(body.nextPosition);
                recentState.hasMore = recentState.directPosition !== null;
                const pendingEntries = recentState.entries.slice(recentState.renderedEntryCount);
                const pendingCount = recentLayoutNodes(pendingEntries).length;
                if (!recentState.hasMore || recentCanFillRows(pendingCount)) break;
            } while (true);

            if (recentFeed) {
                recentFeed.dataset.nextPosition = recentState.directPosition === null
                    ? ''
                    : String(recentState.directPosition);
            }
            return renderedLayoutChanged;
        }

        async function replaceRecentPage(body) {
            recentState.entries = [];
            recentState.layoutGroups = [];
            recentState.nextLayoutGroupId = 0;
            recentState.renderedEntryCount = 0;
            recentState.stackGroups.clear();
            recentState.itemIds.clear();
            recentFeed?.replaceChildren();
            adoptRecentPageSource(body);
            appendRecentItems(body.items);
            commitRecentPendingRows(!recentState.hasMore);
            if (recentFeed?.childElementCount === 0 && recentState.hasMore) {
                const renderedLayoutChanged = await appendRecentDirectPagesUntilRowsAreReady();
                commitRecentPendingRows(!recentState.hasMore);
                if (renderedLayoutChanged) reconcileRecentRows();
            }
            hideRecentUpdate();
            if (recentLoadButton) recentLoadButton.textContent = 'Load more';
            updateRecentEndState();
        }

        async function requestRecentMediaState() {
            if (!recentState.generation) return null;
            if (recentState.stateInFlight) return await recentState.stateInFlight;
            const requestedGeneration = recentState.generation;
            const request = (async () => {
                const response = await fetch('/api/recent-media/state', {headers: {accept: 'application/json'}});
                const body = await response.json().catch(() => ({}));
                if (requestedGeneration !== recentState.generation) return null;
                if (!response.ok || typeof body.generation !== 'string' || typeof body.unsafePending !== 'boolean') return null;
                return body;
            })();
            recentState.stateInFlight = request;
            try {
                return await request;
            } finally {
                if (recentState.stateInFlight === request) recentState.stateInFlight = null;
            }
        }

        async function checkRecentMediaState() {
            if (!recentState.generation || document.visibilityState === 'hidden') return;
            try {
                const body = await requestRecentMediaState();
                if (!body) return;
                if (body.unsafePending || body.generation !== recentState.generation) {
                    recentState.availableGeneration = body.generation;
                    showRecentUpdate(body.unsafePending);
                } else {
                    recentState.stateVerifiedAt = Date.now();
                }
            } catch {
                // Keep the pinned list when the optional update check is unavailable.
            }
        }

        async function verifyRecentDirectState() {
            if (Date.now() - recentState.stateVerifiedAt < recentStateVerificationTtlMs) return;
            const body = await requestRecentMediaState();
            if (!body) throw new Error('Could not confirm the current upload list.');
            if (body.unsafePending || body.generation !== recentState.generation) {
                recentState.availableGeneration = body.generation;
                showRecentUpdate(true);
                throw recentGenerationExpiredError();
            }
            recentState.stateVerifiedAt = Date.now();
        }

        function stopRecentStatePolling() {
            if (recentState.statePollId) window.clearTimeout(recentState.statePollId);
            recentState.statePollId = 0;
        }

        function scheduleRecentStatePoll() {
            if (!recentState.generation || document.visibilityState === 'hidden') return;
            const delay = 51000 + Math.floor(Math.random() * 18001);
            recentState.statePollId = window.setTimeout(async () => {
                await checkRecentMediaState();
                scheduleRecentStatePoll();
            }, delay);
        }

        function startRecentStatePolling() {
            stopRecentStatePolling();
            if (!recentState.generation || document.visibilityState === 'hidden') return;
            checkRecentMediaState();
            scheduleRecentStatePoll();
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
                const body = await requestRecentMediaPage(showNsfw, showUnapproved);
                if (persistUnapproved) await persistUnapprovedPreference(showUnapproved);

                recentState.showNsfw = showNsfw;
                recentState.showUnapproved = showUnapproved;
                await replaceRecentPage(body);
                updateRecentFilterButtons();
                startRecentStatePolling();
            } catch (error) {
                if (recentErrorMessage) recentErrorMessage.textContent = error instanceof Error ? error.message : 'Could not update the feed.';
                recentError?.classList.remove('hidden');
            } finally {
                setRecentLoading(false);
            }
        }

        async function loadRecentMedia() {
            if (recentState.inFlight || !recentState.hasMore) return;
            if (!recentState.directRootUrl || recentState.directPosition === null) return;
            setRecentLoading(true);
            recentError?.classList.add('hidden');

            try {
                await verifyRecentDirectState();
                const renderedLayoutChanged = await appendRecentDirectPagesUntilRowsAreReady();
                commitRecentPendingRows(!recentState.hasMore);
                if (renderedLayoutChanged) reconcileRecentRows();
                updateRecentEndState();
            } catch (error) {
                if (error?.code === 'recent-generation-expired') {
                    recentState.hasMore = false;
                    updateRecentEndState();
                    showRecentUpdate(true);
                    return;
                }
                recentState.hasMore = true;
                if (recentErrorMessage) recentErrorMessage.textContent = error instanceof Error ? error.message : 'Could not load more uploads.';
                recentError?.classList.remove('hidden');
                recentLoadButton?.classList.remove('hidden');
                if (recentLoadButton) recentLoadButton.textContent = 'Try again';
            } finally {
                setRecentLoading(false);
            }
        }

        const initialRecentRows = Array.from(recentFeed?.querySelectorAll(':scope > [data-recent-row]') || []);
        if (initialRecentRows.length > 0) {
            const layoutGroup = {id: String(recentState.nextLayoutGroupId++), entries: []};
            initialRecentRows.forEach((row) => {
                row.dataset.recentLayoutGroup = layoutGroup.id;
                row.querySelectorAll(':scope > [data-recent-entry]').forEach((entry) => {
                    entry.querySelectorAll('[data-media-id]').forEach((card) => {
                        if (card.dataset.mediaId) recentState.itemIds.add(card.dataset.mediaId);
                    });
                    let recentEntry;
                    if (entry.matches('[data-recent-stack]')) {
                        const data = entry.querySelector('[data-recent-stack-items]');
                        let items = [];
                        try {
                            const parsed = JSON.parse(data?.textContent || '[]');
                            if (Array.isArray(parsed)) items = parsed;
                        } catch {
                            items = [];
                        }
                        items.forEach((item) => {
                            if (item && typeof item.id === 'string') recentState.itemIds.add(item.id);
                        });
                        data?.remove();
                        recentEntry = registerRecentStack(entry, items, recentState.expandGroupsByDefault);
                    } else {
                        recentEntry = {key: entry.dataset.uploadKey, kind: 'card', node: entry};
                    }
                    recentState.entries.push(recentEntry);
                    layoutGroup.entries.push(recentEntry);
                });
            });
            recentState.layoutGroups.push(layoutGroup);
        }
        recentState.renderedEntryCount = recentState.entries.length;
        if (recentState.expandGroupsByDefault || window.innerWidth < 1280) reconcileRecentRows();
        document.querySelectorAll('[data-recent-media-image]').forEach(bindRecentImage);
        recentFeed?.addEventListener('click', (event) => {
            const button = event.target.closest('[data-recent-stack-toggle]');
            const owner = button?.closest('[data-stack-id]');
            const record = recentState.stackGroups.get(owner?.dataset.stackId);
            if (button && record) setRecentStackExpanded(record, !record.expanded);
        });
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
        recentStackDefaultButton?.addEventListener('click', () => {
            recentState.expandGroupsByDefault = !recentState.expandGroupsByDefault;
            persistRecentStackDefault(recentState.expandGroupsByDefault);
            setAllRecentStacksExpanded(recentState.expandGroupsByDefault);
            updateRecentFilterButtons();
        });
        recentRefreshButton?.addEventListener('click', async () => {
            if (recentState.inFlight) return;
            setRecentLoading(true);
            recentError?.classList.add('hidden');
            try {
                const body = await requestRecentMediaPage(recentState.showNsfw, recentState.showUnapproved);
                await replaceRecentPage(body);
                startRecentStatePolling();
            } catch (error) {
                if (recentErrorMessage) recentErrorMessage.textContent = error instanceof Error ? error.message : 'Could not refresh uploads.';
                recentError?.classList.remove('hidden');
            } finally {
                setRecentLoading(false);
            }
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') stopRecentStatePolling();
            else startRecentStatePolling();
        });

        if ('IntersectionObserver' in window && recentSentinel) {
            const observer = new IntersectionObserver((entries) => {
                const entry = entries.at(-1);
                recentState.sentinelNear = Boolean(entry?.isIntersecting);
                if (recentState.sentinelNear) scheduleRecentAutoLoad();
            }, {rootMargin: '400px 0px'});
            observer.observe(recentSentinel);
        }
        window.addEventListener('scroll', scheduleRecentAutoLoad, {passive: true});
        for (const breakpoint of ['(min-width: 768px)', '(min-width: 1024px)', '(min-width: 1280px)']) {
            window.matchMedia(breakpoint).addEventListener('change', reconcileRecentRows);
        }

        updateRecentFilterButtons();
        updateRecentEndState();
        startRecentStatePolling();
    `

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function RecentMediaPage({currentUser, guestInitial, mediaBaseUrl, page, showNsfw, showUnapproved}: RecentMediaPageProps) {
    const rows = chunkRecentMediaGroups(groupSequentialRecentMediaItems(page.items))
    const hasMore = Boolean(page.generation && page.publicRootUrl && page.nextPosition !== null)

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
                                class={showNsfw ? 'btn btn-sm btn-active' : 'btn btn-sm'}
                                data-recent-filter-nsfw
                                type="button"
                            >
                                {showNsfw ? 'Hide NSFW media' : 'Show NSFW media'}
                            </button>
                            <button
                                aria-controls="recent-media-feed"
                                aria-label="Expand multiple uploads by default"
                                aria-pressed="false"
                                class="btn btn-sm"
                                data-recent-stack-default
                                type="button"
                            >
                                Expand uploads
                            </button>
                        </fieldset>
                    </div>
                </header>

                <div class="alert mb-5 hidden sm:alert-horizontal" data-recent-update role="status">
                    <span data-recent-update-message>New uploads are available.</span>
                    <button class="btn btn-sm" data-recent-refresh type="button">
                        Show new uploads
                    </button>
                </div>

                <section
                    aria-busy="false"
                    aria-label="Recently uploaded character media"
                    class="mx-auto grid max-w-xl gap-5 md:max-w-none md:gap-2"
                    data-has-more={hasMore ? 'true' : 'false'}
                    data-generation={page.generation ?? ''}
                    data-media-origin={mediaBaseUrl}
                    data-next-position={page.nextPosition ?? ''}
                    data-public-root-url={page.publicRootUrl ?? ''}
                    data-recent-feed
                    data-show-nsfw={showNsfw ? 'true' : 'false'}
                    data-show-unapproved={showUnapproved ? 'true' : 'false'}
                    id="recent-media-feed"
                >
                    {rows.map((row) => (
                        <div
                            class="recent-media-row min-w-0 max-w-full contents md:flex"
                            data-recent-layout-group="0"
                            data-recent-row
                            data-recent-row-size={row.length}
                        >
                            {row.map((group) => (
                                <RecentMediaGroupCard group={group} />
                            ))}
                        </div>
                    ))}
                </section>

                <div
                    class={
                        page.items.length === 0 && !hasMore
                            ? 'card card-border mx-auto mt-10 max-w-lg bg-base-200 text-center'
                            : 'card card-border mx-auto mt-10 hidden max-w-lg bg-base-200 text-center'
                    }
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
