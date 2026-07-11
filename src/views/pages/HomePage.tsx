import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import type {CurrentUser} from '../../lib/auth/session'
import {characterMediaImageUrl, characterMediaPreviewImageUrl, characterProfileImageUrl} from '../../lib/media/url'
import {absoluteUrl} from '../meta'

export type HomePageStats = {
    users: number
    characters: number
    mediaItems: number
}

export type HomePageGalleryImage = {
    id: string
    alt: string
    fallbackSrc?: string | null
    height: number
    href: string
    src: string
    width: number
}

export type HomePageDiscoverCharacter = {
    id: string
    userId: string
    name: string
    ownerUsername: string
    profileImageKey: string
    previewMediaId: string
    previewImageKey: string
    previewThumbnailImageKey: string | null
    previewContentType: string | null
    previewArtist: string
    imageCount: number
}

export type HomePageHeightChartCharacter = {
    id: string
    name: string
    ownerUsername: string
    heightMeters: number
    image: {
        naturalHeight: number
        naturalWidth: number
        url: string
    }
    calibration: {
        footIsVirtual: boolean
        footYPercent: number
        headYPercent: number
    }
}

type HomePageProps = {
    currentUser?: CurrentUser | null
    discoverCharacters: HomePageDiscoverCharacter[]
    galleryImages: HomePageGalleryImage[]
    guestInitial: string
    heightChartCharacters: HomePageHeightChartCharacter[]
    mediaBaseUrl: string
    siteUrl: string
    stats: HomePageStats
}

const HOME_PAGE_TITLE = 'MyOC | High-Resolution Character Gallery'
const HOME_PAGE_KEYWORDS =
    'character art gallery, original character gallery, OC gallery, character reference, character media, art portfolio, furry character gallery'
const HOME_PAGE_IMAGE_PATH = '/assets/myocbanner.webp'
const HOME_PAGE_IMAGE_ALT = 'Easily share character art without losing quality. No fuss.'
const HOME_PAGE_HERO_IMAGE_PATH = '/assets/razfalling.webp'
const HOME_PAGE_HERO_IMAGE_ALT = 'Red dragon character art floating against a purple sky'
const HOME_PAGE_GALLERY_SLOT_COUNT = 48
const HOME_PAGE_INCHES_PER_METER = 39.37007874015748
const HOME_PAGE_SIZE_CHART_VERTICAL_PAD = 18
const HOME_PAGE_SIZE_CHART_HEIGHT = 620
const HOME_PAGE_SIZE_CHART_HEADROOM_METERS = 0.18
const HOME_PAGE_SIZE_CHART_BOTTOM_ROOM_METERS = 0.04
const HOME_PAGE_FEATURE_BLOCKS = [
    {
        title: 'Simple content preferences',
        body: 'Toggle your media preferences as you please. Only see what you want to see.',
    },
    {
        title: 'Adult content friendly',
        body: "And on that note, we know not everybody is an angel. We don't mind.",
    },
    {
        title: 'No CSS arms race',
        body: "Sorry if that's your thing, but it isn't ours. Everyone shares the same profile.",
    },
    {
        title: 'Control visibility',
        body: 'Private accounts. Plain and simple. (Coming soon)',
    },
    {
        title: "Uptime? Yeah I've got time.",
        body: "MyOC runs on serverless infrastructure, backed by Cloudflare. We don't go down unless they do.",
    },
    {
        title: 'Source-available (nerd)',
        body: 'We always welcome contributions to our project. Judge my code on github @ razethion/myoc',
    },
    {
        title: 'One clear goal',
        body: 'Make character galleries simple and beautiful. We plan to keep it that way.',
    },
    {
        title: 'Fandom-run',
        body: 'Created and maintained by character owners, just like you.',
    },
]
const HOME_PAGE_GALLERY_FALLBACK_ASPECTS = [
    '1 / 1',
    '4 / 5',
    '5 / 4',
    '3 / 4',
    '1 / 1',
    '2 / 3',
    '4 / 3',
    '5 / 7',
    '1 / 1',
    '3 / 5',
    '6 / 5',
    '4 / 5',
    '1 / 1',
    '5 / 6',
    '3 / 4',
    '7 / 5',
    '2 / 3',
    '1 / 1',
    '5 / 4',
    '4 / 7',
    '6 / 5',
    '3 / 4',
    '7 / 5',
    '1 / 1',
    '2 / 3',
    '5 / 4',
    '4 / 5',
    '6 / 5',
    '3 / 5',
    '1 / 1',
    '5 / 6',
    '7 / 4',
    '4 / 5',
    '1 / 1',
    '2 / 3',
    '6 / 5',
    '5 / 7',
    '7 / 5',
    '3 / 4',
    '1 / 1',
    '5 / 4',
    '4 / 7',
    '1 / 1',
    '3 / 5',
    '6 / 5',
    '4 / 5',
    '5 / 6',
    '7 / 4',
]

function formatCount(value: number): string {
    return Math.max(0, value).toLocaleString('en-US')
}

function characterUrl(character: HomePageDiscoverCharacter): string {
    return `/u/${encodeURIComponent(character.ownerUsername)}/${encodeURIComponent(character.name)}`
}

export function homePageDescription(stats: HomePageStats): string {
    return `Hosting over ${formatCount(stats.mediaItems)} images`
}

function HomePageHead({siteUrl, stats}: {siteUrl: string; stats: HomePageStats}) {
    const canonicalUrl = absoluteUrl(siteUrl, '/')
    const imageUrl = absoluteUrl(siteUrl, HOME_PAGE_IMAGE_PATH)
    const description = homePageDescription(stats)
    const structuredData = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebSite',
                '@id': `${canonicalUrl}#website`,
                name: 'MyOC',
                url: canonicalUrl,
                description,
                potentialAction: {
                    '@type': 'SearchAction',
                    target: `${absoluteUrl(siteUrl, '/search')}?q={search_term_string}`,
                    'query-input': 'required name=search_term_string',
                },
            },
            {
                '@type': 'WebApplication',
                '@id': `${canonicalUrl}#app`,
                name: 'MyOC',
                url: canonicalUrl,
                applicationCategory: 'MultimediaApplication',
                operatingSystem: 'Any',
                description,
                image: imageUrl,
            },
        ],
    }

    return (
        <>
            <meta content={description} name="description" />
            <meta content={HOME_PAGE_KEYWORDS} name="keywords" />
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" name="robots" />
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" name="googlebot" />
            <meta content="MyOC" name="application-name" />
            <meta content="MyOC" name="apple-mobile-web-app-title" />
            <meta content="#0f172a" name="theme-color" />
            <meta content="dark light" name="color-scheme" />
            <meta content="telephone=no" name="format-detection" />
            <meta content="strict-origin-when-cross-origin" name="referrer" />
            <link href={canonicalUrl} rel="canonical" />

            <meta content={HOME_PAGE_TITLE} property="og:title" />
            <meta content={description} property="og:description" />
            <meta content="website" property="og:type" />
            <meta content={canonicalUrl} property="og:url" />
            <meta content="MyOC" property="og:site_name" />
            <meta content={imageUrl} property="og:image" />
            <meta content="1200" property="og:image:width" />
            <meta content="630" property="og:image:height" />
            <meta content="image/webp" property="og:image:type" />
            <meta content={HOME_PAGE_IMAGE_ALT} property="og:image:alt" />
            <meta content="en_US" property="og:locale" />

            <meta content="summary_large_image" name="twitter:card" />
            <meta content={HOME_PAGE_TITLE} name="twitter:title" />
            <meta content={description} name="twitter:description" />
            <meta content={imageUrl} name="twitter:image" />
            <meta content={HOME_PAGE_IMAGE_ALT} name="twitter:image:alt" />

            <script dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}} type="application/ld+json"></script>
            <HomePageMotionStyles />
        </>
    )
}

function HomePageMotionStyles() {
    return (
        <style
            dangerouslySetInnerHTML={{
                __html: `
            @keyframes home-fade-up {
                from {
                    opacity: 0;
                    transform: translate3d(0, 1.5rem, 0);
                }

                to {
                    opacity: 1;
                    transform: translate3d(0, 0, 0);
                }
            }

            @keyframes home-float {
                0%, 100% {
                    transform: translate3d(0, 0, 0) rotate(var(--home-rotate, 0deg));
                }

                50% {
                    transform: translate3d(var(--home-float-x, 0.5rem), var(--home-float-y, -0.75rem), 0) rotate(var(--home-rotate, 0deg));
                }
            }

            @keyframes home-grid-drift {
                from {
                    transform: translate3d(-4rem, -4rem, 0);
                }

                to {
                    transform: translate3d(0, 0, 0);
                }
            }

            .home-reveal {
                animation: home-fade-up 520ms ease both;
            }

            .home-float {
                animation: none;
            }

            .home-hero-grid {
                animation: home-grid-drift 28s linear infinite;
            }

            .home-approved-gallery-tile {
                contain: layout paint;
                content-visibility: auto;
                transition: border-color 180ms ease;
            }

            .home-approved-gallery-tile.is-loaded {
                border-color: transparent;
            }

            .home-approved-gallery-tile img {
                opacity: 0;
                transition: opacity 300ms ease;
            }

            .home-approved-gallery-tile.is-loaded img {
                opacity: 1;
            }

            .home-size-chart-panel {
                background: #000;
                height: max(18rem, calc(100vw * 620 / 760));
                overflow: hidden;
                position: relative;
                width: 100%;
            }

            .home-size-chart-plot {
                background: #000;
                height: 100%;
                overflow: hidden;
                position: relative;
                width: 100%;
            }

            .home-size-chart-grid-line {
                background: rgb(255 255 255 / 0.28);
                height: 1px;
                left: 0;
                position: absolute;
                right: 0;
                transform: translateY(-50%);
            }

            .home-size-chart-zero-line {
                background: rgb(255 255 255 / 0.52);
            }

            .home-size-chart-character {
                display: block;
                height: calc(var(--home-chart-image-height, 0) * 1%);
                left: calc(var(--home-chart-x, 50) * 1%);
                max-width: none;
                object-fit: contain;
                pointer-events: none;
                position: absolute;
                top: calc(var(--home-chart-image-top, 0) * 1%);
                transform: translateX(-50%);
                user-select: none;
                width: auto;
                z-index: var(--home-chart-layer, 1);
            }

            .home-size-chart-character.is-positioned {
                opacity: 0;
                transform: translate3d(-5rem, 0, 0);
                transition: opacity 480ms ease, transform 680ms cubic-bezier(0.16, 1, 0.3, 1);
                transition-delay: var(--home-chart-enter-delay, 0ms);
            }

            .home-size-chart-plot.is-visible .home-size-chart-character.is-positioned {
                opacity: 1;
                transform: translate3d(0, 0, 0);
            }

            .home-size-chart-empty {
                align-items: center;
                color: rgb(255 255 255 / 0.58);
                display: flex;
                font-size: 1rem;
                font-weight: 800;
                height: 100%;
                justify-content: center;
                padding: 1rem;
                text-align: center;
                text-transform: uppercase;
            }

            @media (min-width: 1024px) {
                .home-size-chart-panel {
                    height: 100%;
                    min-height: clamp(32rem, 62vh, 44rem);
                }

                .home-float {
                    animation: home-float var(--home-float-duration, 7s) ease-in-out infinite;
                }
            }

            @media (prefers-reduced-motion: reduce) {
                .home-reveal,
                .home-float,
                .home-hero-grid {
                    animation: none;
                }

                .home-size-chart-character.is-positioned {
                    opacity: 1;
                    transform: translate3d(0, 0, 0);
                    transition: none;
                    transition-delay: 0ms;
                }

                .home-approved-gallery-tile img {
                    transition: none;
                }
            }

            @media (min-width: 1024px) and (max-height: 760px) {
                .home-hero-section {
                    padding-bottom: 1.25rem;
                    padding-top: 1.25rem;
                }

                .home-hero-title {
                    font-size: clamp(3rem, 8vh, 4.25rem);
                }

                .home-hero-lead,
                .home-hero-search,
                .home-hero-actions,
                .home-hero-stats {
                    margin-top: 1rem;
                }

                .home-hero-stat {
                    padding-bottom: 0.5rem;
                    padding-top: 0.5rem;
                }

                .home-hero-art-card {
                    bottom: 1rem;
                    padding: 0.75rem;
                }
            }

            @media (min-width: 1024px) and (max-height: 680px) {
                .home-hero-stat-desc,
                .home-hero-art-card {
                    display: none;
                }
            }
        `,
            }}
        ></style>
    )
}

function niceStep(rawStep: number, candidates: number[]): number {
    const fallback = candidates[candidates.length - 1]

    return candidates.find((candidate) => candidate >= rawStep) ?? fallback ?? rawStep
}

function gridStep(maxMeters: number): number {
    const maxFeet = (maxMeters * HOME_PAGE_INCHES_PER_METER) / 12
    const stepFeet = maxFeet <= 18 ? 1 : niceStep(maxFeet / 14, [2, 5, 10, 20, 50, 100, 200, 500])

    return (stepFeet * 12) / HOME_PAGE_INCHES_PER_METER
}

function gridLines(maxMeters: number): number[] {
    const lines = []
    const stepMeters = gridStep(maxMeters)

    for (let meters = 0; meters <= maxMeters + 0.001; meters += stepMeters) {
        lines.push(meters)
    }

    return lines
}

function measuredPixels(character: HomePageHeightChartCharacter): number {
    return Math.max(1, ((character.calibration.footYPercent - character.calibration.headYPercent) / 100) * character.image.naturalHeight)
}

function roundChartMaxMeters(maxMeters: number): number {
    const maxFeet = (maxMeters * HOME_PAGE_INCHES_PER_METER) / 12

    return Math.max(60 / HOME_PAGE_INCHES_PER_METER, (Math.ceil(maxFeet) * 12) / HOME_PAGE_INCHES_PER_METER)
}

function characterFootPixels(character: HomePageHeightChartCharacter): number {
    return (character.calibration.footYPercent / 100) * character.image.naturalHeight
}

function characterTopMeters(character: HomePageHeightChartCharacter): number {
    return (characterFootPixels(character) / measuredPixels(character)) * character.heightMeters
}

function characterBottomMeters(character: HomePageHeightChartCharacter): number {
    return ((characterFootPixels(character) - character.image.naturalHeight) / measuredPixels(character)) * character.heightMeters
}

function chartCharacterXPct(index: number, count: number): number {
    if (count === 1) {
        return 50
    }

    return index === 0 ? 33 : 67
}

function chartLayout(characters: HomePageHeightChartCharacter[]) {
    const plotHeight = Math.max(120, HOME_PAGE_SIZE_CHART_HEIGHT - HOME_PAGE_SIZE_CHART_VERTICAL_PAD * 2)
    const chartMin = Math.min(
        0,
        ...characters.map((character) => characterBottomMeters(character) - HOME_PAGE_SIZE_CHART_BOTTOM_ROOM_METERS),
    )
    const chartMax = roundChartMaxMeters(
        Math.max(
            60 / HOME_PAGE_INCHES_PER_METER,
            ...characters.map((character) => character.heightMeters),
            ...characters.map((character) => characterTopMeters(character) + HOME_PAGE_SIZE_CHART_HEADROOM_METERS),
        ),
    )
    const pxPerMeter = plotHeight / Math.max(0.01, chartMax - chartMin)
    const zeroY = HOME_PAGE_SIZE_CHART_HEIGHT - HOME_PAGE_SIZE_CHART_VERTICAL_PAD - (0 - chartMin) * pxPerMeter
    const items = characters.map((character, index) => {
        const scale = (character.heightMeters * pxPerMeter) / measuredPixels(character)
        const imageWidth = Math.max(24, character.image.naturalWidth * scale)
        const imageHeight = Math.max(24, character.image.naturalHeight * scale)
        const top = zeroY - characterFootPixels(character) * scale

        return {
            character,
            imageWidth,
            imageHeight,
            top,
            layer: characters.length - index,
            xPct: chartCharacterXPct(index, characters.length),
        }
    })

    return {chartMax, chartMin, items, pxPerMeter, zeroY}
}

function chartY(meters: number, layout: ReturnType<typeof chartLayout>): number {
    return HOME_PAGE_SIZE_CHART_HEIGHT - HOME_PAGE_SIZE_CHART_VERTICAL_PAD - (meters - layout.chartMin) * layout.pxPerMeter
}

function chartPercent(value: number): string {
    return ((value / HOME_PAGE_SIZE_CHART_HEIGHT) * 100).toFixed(4)
}

function HomeHeightChartPreview({characters}: {characters: HomePageHeightChartCharacter[]}) {
    const displayCharacters = characters
        .slice()
        .sort((a, b) => b.heightMeters - a.heightMeters)
        .slice(0, 2)
    const layout = chartLayout(displayCharacters)

    return (
        <div class="home-size-chart-panel">
            <div class="home-size-chart-plot" data-home-size-chart-plot="true">
                {displayCharacters.length > 0 ? (
                    <>
                        {gridLines(layout.chartMax).map((meters) => (
                            <div
                                class={`home-size-chart-grid-line${meters === 0 ? ' home-size-chart-zero-line' : ''}`}
                                style={`top:${chartPercent(chartY(meters, layout))}%`}
                            />
                        ))}
                        {layout.items
                            .slice()
                            .sort((a, b) => a.layer - b.layer)
                            .map((item, index) => (
                                <img
                                    alt=""
                                    aria-hidden="true"
                                    class="home-size-chart-character"
                                    data-home-chart-width-ratio={(item.imageWidth / HOME_PAGE_SIZE_CHART_HEIGHT).toFixed(6)}
                                    data-home-chart-x-pct={item.xPct}
                                    data-home-size-chart-character="true"
                                    decoding="async"
                                    loading="lazy"
                                    src={item.character.image.url}
                                    style={`--home-chart-enter-delay:${index * 110}ms;--home-chart-image-height:${chartPercent(item.imageHeight)};--home-chart-image-top:${chartPercent(item.top)};--home-chart-layer:${item.layer};--home-chart-x:${item.xPct};`}
                                />
                            ))}
                    </>
                ) : (
                    <div class="home-size-chart-empty">Height chart preview unavailable</div>
                )}
            </div>
        </div>
    )
}

function HomeHeightChartScript() {
    return (
        <script
            dangerouslySetInnerHTML={{
                __html: `
            (function () {
                function clamp(value, min, max) {
                    return Math.min(Math.max(value, min), max);
                }

                function layoutPlot(plot) {
                    var height = Math.max(1, plot.clientHeight || 0);
                    var width = Math.max(1, plot.clientWidth || 0);
                    var characters = plot.querySelectorAll('[data-home-size-chart-character]');

                    characters.forEach(function (character) {
                        var xPct = clamp(Number(character.dataset.homeChartXPct), 0, 100);
                        var widthRatio = Number(character.dataset.homeChartWidthRatio);

                        if (!Number.isFinite(xPct) || !Number.isFinite(widthRatio) || widthRatio <= 0) {
                            return;
                        }

                        var imageWidth = Math.max(24, widthRatio * height);
                        var maxLeft = Math.max(0, width - imageWidth);
                        var targetCenter = width * (xPct / 100);
                        var left = clamp(targetCenter - imageWidth / 2, 0, maxLeft);

                        character.style.left = left + 'px';
                        character.style.width = imageWidth + 'px';
                        character.classList.add('is-positioned');
                    });
                }

                function layoutCharts() {
                    document.querySelectorAll('[data-home-size-chart-plot]').forEach(layoutPlot);
                }

                function revealPlot(plot) {
                    plot.classList.add('is-visible');
                }

                function initRevealObserver() {
                    var plots = document.querySelectorAll('[data-home-size-chart-plot]');

                    if (!('IntersectionObserver' in window)) {
                        plots.forEach(revealPlot);
                        return;
                    }

                    var revealObserver = new IntersectionObserver(function (entries) {
                        entries.forEach(function (entry) {
                            if (!entry.isIntersecting) {
                                return;
                            }

                            revealPlot(entry.target);
                            revealObserver.unobserve(entry.target);
                        });
                    }, {rootMargin: '0px 0px -12% 0px', threshold: 0.18});

                    plots.forEach(function (plot) {
                        revealObserver.observe(plot);
                    });
                }

                function init() {
                    layoutCharts();
                    initRevealObserver();

                    if ('ResizeObserver' in window) {
                        var observer = new ResizeObserver(layoutCharts);
                        document.querySelectorAll('[data-home-size-chart-plot]').forEach(function (plot) {
                            observer.observe(plot);
                        });
                    } else {
                        window.addEventListener('resize', layoutCharts);
                    }

                    window.addEventListener('load', layoutCharts);
                }

                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', init);
                } else {
                    init();
                }
            })();
        `,
            }}
        ></script>
    )
}

function DiscoverGalleriesSection({characters, mediaBaseUrl}: {characters: HomePageDiscoverCharacter[]; mediaBaseUrl: string}) {
    if (characters.length === 0) {
        return null
    }

    return (
        <section class="bg-base-100 px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div class="mx-auto max-w-7xl">
                <div class="grid gap-8 border-b border-base-content/10 pb-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1fr)] lg:items-end">
                    <div>
                        <p class="text-sm font-bold uppercase text-base-content/55">Discover</p>
                        <h2 class="font-display mt-4 text-4xl leading-tight sm:text-5xl">Galleries worth browsing.</h2>
                    </div>
                    <div class="max-w-2xl lg:justify-self-end">
                        <p class="text-base leading-7 text-base-content/70 lg:text-lg lg:leading-8">
                            Browse real character galleries with approved preview art, clear ownership, and enough media to actually
                            explore.
                        </p>
                        <a class="btn btn-outline mt-5 h-auto min-h-10 whitespace-normal text-center" href="/search">
                            Search all profiles
                        </a>
                    </div>
                </div>

                <div class="grid grid-cols-2 border-l border-t border-base-content/10 lg:grid-cols-3">
                    {characters.map((character) => {
                        const previewUrl = character.previewThumbnailImageKey
                            ? characterMediaPreviewImageUrl(
                                  mediaBaseUrl,
                                  character.userId,
                                  character.id,
                                  character.previewMediaId,
                                  character.previewThumbnailImageKey,
                                  'sfw',
                              )
                            : characterMediaImageUrl(
                                  mediaBaseUrl,
                                  character.userId,
                                  character.id,
                                  character.previewMediaId,
                                  character.previewImageKey,
                                  'sfw',
                                  character.previewContentType,
                              )
                        const profileImageUrl = characterProfileImageUrl(
                            mediaBaseUrl,
                            character.userId,
                            character.id,
                            character.profileImageKey,
                        )
                        const artist = character.previewArtist || 'Unknown artist'

                        return (
                            <a
                                class="group border-b border-r border-base-content/10 bg-base-100 transition-colors hover:bg-base-200/80"
                                href={characterUrl(character)}
                            >
                                <figure class="relative aspect-4/3 overflow-hidden bg-black">
                                    <img
                                        alt={`${character.name} gallery preview by ${artist}`}
                                        class="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
                                        decoding="async"
                                        loading="lazy"
                                        src={previewUrl}
                                    />
                                    <figcaption class="absolute inset-x-0 bottom-0 bg-black/85 p-2 text-white sm:p-4">
                                        <p class="text-[0.65rem] font-bold uppercase tracking-wide text-white/70 sm:text-xs">
                                            Featured gallery
                                        </p>
                                        <p class="mt-1 text-xs font-semibold sm:text-sm">{formatCount(character.imageCount)} images</p>
                                    </figcaption>
                                </figure>
                                <div class="flex min-w-0 items-center gap-2 p-3 sm:gap-4 sm:p-5">
                                    <img
                                        alt={`${character.name} portrait`}
                                        class="h-10 w-10 shrink-0 rounded-lg bg-base-300 object-cover sm:h-14 sm:w-14"
                                        decoding="async"
                                        loading="lazy"
                                        src={profileImageUrl}
                                    />
                                    <div class="min-w-0">
                                        <h3 class="truncate text-sm font-bold sm:text-xl">{character.name}</h3>
                                        <p class="truncate text-sm text-base-content/65">by @{character.ownerUsername}</p>
                                    </div>
                                </div>
                            </a>
                        )
                    })}
                </div>
            </div>
        </section>
    )
}

function HeightChartFeatureSection({characters}: {characters: HomePageHeightChartCharacter[]}) {
    return (
        <section class="relative isolate overflow-hidden bg-base-100">
            <div class="grid lg:min-h-176 lg:grid-cols-2">
                <div class="relative lg:min-h-full">
                    <HomeHeightChartPreview characters={characters} />
                </div>
                <div class="relative z-20 flex px-4 py-16 sm:px-6 lg:items-center lg:px-8 lg:py-24">
                    <div class="max-w-xl">
                        <p class="text-sm font-bold uppercase text-base-content/55">Height Charts</p>
                        <h2 class="font-display mt-4 text-4xl leading-tight sm:text-5xl">How do you stack up?</h2>
                        <p class="mt-5 text-base leading-7 text-base-content/75 lg:text-lg lg:leading-8">
                            Quickly and easily see your characters compared to others.
                        </p>
                        <dl class="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
                            <div>
                                <dt class="font-bold">Easy calibration</dt>
                                <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                    No need to be pixel pefect. Tell us exactly where your characters' head and feet are, and we'll do the
                                    rest... that is, once you decide how tall your characters are ;)
                                </dd>
                            </div>
                            <div>
                                <dt class="font-bold">Searchable and Scalable</dt>
                                <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                    Stack any of your characters up against any of your other characters... or your friends characters... or
                                    even your enemies!
                                </dd>
                            </div>
                            <div>
                                <dt class="font-bold">Save and share</dt>
                                <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                    Save charts as an image, or share the link to your layout with others.
                                </dd>
                            </div>
                        </dl>
                        <div class="mt-8 flex justify-start">
                            <a class="btn btn-outline h-auto min-h-10 whitespace-normal text-center" href="/size-chart">
                                Open size chart
                            </a>
                        </div>
                    </div>
                </div>
            </div>
            <HomeHeightChartScript />
        </section>
    )
}

function AdditionalFeaturesSection() {
    return (
        <section class="bg-base-200 px-4 py-14 sm:px-6 lg:px-8 lg:py-18">
            <div class="mx-auto max-w-7xl">
                <div class="grid gap-8 border-b border-base-content/10 pb-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] lg:items-end">
                    <div>
                        <p class="text-sm font-bold uppercase text-base-content/55">OTHER FEATURES</p>
                        <h2 class="font-display mt-3 text-3xl leading-tight sm:text-4xl">
                            And more and more and more and more and more and...
                        </h2>
                    </div>
                    <p class="max-w-2xl text-sm leading-6 text-base-content/70 lg:justify-self-end">
                        Designed to be simple and easy to use, not bloated with junk.
                    </p>
                </div>
                <div class="grid border-l border-t border-base-content/10 sm:grid-cols-2 lg:grid-cols-4">
                    {HOME_PAGE_FEATURE_BLOCKS.map((feature) => (
                        <article class="border-b border-r border-base-content/10 p-6">
                            <div class="flex items-baseline justify-between gap-4">
                                <h3 class="text-base font-bold leading-6">{feature.title}</h3>
                            </div>
                            <p class="mt-3 text-sm leading-6 text-base-content/65">{feature.body}</p>
                        </article>
                    ))}
                </div>
            </div>
        </section>
    )
}

function HomeCallToActionSection() {
    return (
        <section class="border-t border-base-content/10 bg-base-100 px-4 py-12 sm:px-6 lg:px-8">
            <div class="mx-auto flex max-w-5xl flex-col items-stretch gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-5">
                <a class="btn btn-outline h-auto min-h-10 whitespace-normal text-center sm:justify-self-end" href="/product-vision">
                    Product Vision
                </a>
                <a class="btn btn-primary btn-lg h-auto min-h-14 whitespace-normal px-8 text-center sm:btn-xl sm:min-w-72" href="/register">
                    Start your profile
                </a>
                <a class="btn btn-outline h-auto min-h-10 whitespace-normal text-center sm:justify-self-start" href="/site-policies">
                    Site Policies
                </a>
            </div>
        </section>
    )
}

function HomeApprovedGalleryScript() {
    return (
        <script
            dangerouslySetInnerHTML={{
                __html: `
            (function () {
                var galleries = document.querySelectorAll('[data-home-approved-gallery]');
                var tileQueue = [];
                var tileQueueRunning = false;
                var tileLoadDelay = 65;
                var galleryLoadingStarted = false;

                function loadTile(tile) {
                    if (tile.dataset.loaded === 'true') {
                        return;
                    }

                    tile.dataset.loaded = 'true';
                    var image = tile.querySelector('img[data-src]');

                    if (!image) {
                        tile.classList.add('is-loaded');
                        return;
                    }

                    function markLoaded() {
                        window.requestAnimationFrame(function () {
                            window.requestAnimationFrame(function () {
                                tile.classList.add('is-loaded');
                            });
                        });
                    }

                    image.addEventListener('load', function () {
                        markLoaded();
                    }, {once: true});

                    image.addEventListener('error', function () {
                        var fallbackSrc = image.dataset.fallbackSrc;

                        if (fallbackSrc && image.src !== fallbackSrc) {
                            image.src = fallbackSrc;
                            image.removeAttribute('data-fallback-src');
                            return;
                        }

                        markLoaded();
                    });

                    image.src = image.dataset.src;
                    image.removeAttribute('data-src');

                    if (image.complete) {
                        markLoaded();
                    }
                }

                function processTileQueue() {
                    if (tileQueue.length === 0) {
                        tileQueueRunning = false;
                        return;
                    }

                    tileQueueRunning = true;
                    var tile = tileQueue.shift();
                    loadTile(tile);

                    window.setTimeout(processTileQueue, tileLoadDelay);
                }

                function enqueueTile(tile) {
                    if (tile.dataset.loaded === 'true' || tile.dataset.queued === 'true') {
                        return;
                    }

                    tile.dataset.queued = 'true';
                    tileQueue.push(tile);

                    if (!tileQueueRunning) {
                        processTileQueue();
                    }
                }

                function tileIsNearViewport(tile) {
                    var rect = tile.getBoundingClientRect();
                    var viewportHeight = window.innerHeight || document.documentElement.clientHeight;
                    var preloadMargin = 400;

                    return rect.top < viewportHeight + preloadMargin && rect.bottom > -preloadMargin;
                }

                function loadVisibleTiles() {
                    galleries.forEach(function (gallery) {
                        gallery.querySelectorAll('[data-gallery-tile]').forEach(function (tile) {
                            if (tileIsNearViewport(tile)) {
                                enqueueTile(tile);
                            }
                        });
                    });
                }

                if (galleries.length === 0) {
                    return;
                }

                function startGalleryLoading() {
                    if (galleryLoadingStarted) {
                        return;
                    }

                    galleryLoadingStarted = true;

                    if (!('IntersectionObserver' in window)) {
                        window.addEventListener('scroll', loadVisibleTiles, {passive: true});
                        window.addEventListener('resize', loadVisibleTiles);
                        loadVisibleTiles();
                        return;
                    }

                    var imageObserver = new IntersectionObserver(function (entries) {
                        entries.forEach(function (entry) {
                            if (entry.isIntersecting) {
                                enqueueTile(entry.target);
                                imageObserver.unobserve(entry.target);
                            }
                        });
                    }, {rootMargin: '400px 0px', threshold: 0.01});

                    galleries.forEach(function (gallery) {
                        gallery.querySelectorAll('[data-gallery-tile]').forEach(function (tile) {
                            imageObserver.observe(tile);
                        });
                    });
                }

                if ((window.scrollY || document.documentElement.scrollTop) > 0) {
                    startGalleryLoading();
                } else {
                    window.addEventListener('scroll', startGalleryLoading, {once: true, passive: true});
                }
            })();
        `,
            }}
        ></script>
    )
}

function HomeApprovedGalleryTile({image, index}: {image?: HomePageGalleryImage; index: number}) {
    const aspectRatio = image
        ? `${Math.max(1, image.width)} / ${Math.max(1, image.height)}`
        : HOME_PAGE_GALLERY_FALLBACK_ASPECTS[index % HOME_PAGE_GALLERY_FALLBACK_ASPECTS.length]
    const tileClass =
        'home-approved-gallery-tile relative mb-2 block break-inside-avoid overflow-hidden rounded-lg border border-white bg-black'
    const tileContent = (
        <>
            <div aria-hidden="true" class="absolute inset-0 bg-black"></div>
            {image ? (
                <img
                    alt={image.alt}
                    class="relative z-10 h-full w-full object-contain"
                    data-fallback-src={image.fallbackSrc ?? undefined}
                    data-src={image.src}
                    decoding="async"
                    height={image.height}
                    loading="lazy"
                    width={image.width}
                />
            ) : null}
        </>
    )

    if (image) {
        return (
            <a aria-label={image.alt} class={tileClass} data-gallery-tile href={image.href} style={`aspect-ratio:${aspectRatio}`}>
                {tileContent}
            </a>
        )
    }

    return (
        <figure class={tileClass} data-gallery-tile style={`aspect-ratio:${aspectRatio}`}>
            {tileContent}
        </figure>
    )
}

function GalleryFeatureSection({galleryImages}: {galleryImages: HomePageGalleryImage[]}) {
    const displayImages =
        galleryImages.length > 0
            ? Array.from({length: HOME_PAGE_GALLERY_SLOT_COUNT}, (_, index) => galleryImages[index % galleryImages.length])
            : []

    return (
        <section class="relative isolate overflow-hidden bg-[#141414] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div class="relative mx-auto grid max-w-7xl gap-10 lg:grid-cols-2 lg:items-center">
                <div class="relative z-20 max-w-xl">
                    <p class="text-sm font-bold uppercase text-base-content/55">Gallery Management</p>
                    <h2 class="font-display mt-4 text-4xl leading-tight sm:text-5xl">Your art, front and center.</h2>
                    <p class="mt-5 text-base leading-7 text-base-content/75 lg:text-lg lg:leading-8">
                        Display your character's full resolution art instantly, with no cropped thumbs or extra clicks.
                    </p>
                    <dl class="mt-8 grid gap-5 sm:grid-cols-3 lg:grid-cols-1">
                        <div>
                            <dt class="font-bold">Quality first</dt>
                            <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                Instantly see the gallery as it should be, and get served the original quality media seconds later.
                            </dd>
                        </div>
                        <div>
                            <dt class="font-bold">Totally Tabular</dt>
                            <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                Divide your art into multiple sub-galleries for easy organization. Or don't, I'm not your dad.
                            </dd>
                        </div>
                        <div>
                            <dt class="font-bold">Easy setup</dt>
                            <dd class="mt-2 text-sm leading-6 text-base-content/65">
                                Choose exactly how you want your gallery arranged; display one piec.
                            </dd>
                        </div>
                    </dl>
                </div>
                <div class="relative -mx-4 mt-8 max-h-[50vh] overflow-hidden sm:-mx-6 lg:mx-0 lg:mt-0 lg:max-h-none lg:min-h-160 lg:overflow-visible">
                    <div
                        class="home-approved-gallery relative -left-8 -top-6 w-[calc(100%+4rem)] max-w-none columns-4 gap-2 lg:absolute lg:left-0 lg:top-1/2 lg:z-0 lg:w-[calc(50vw+24rem)] lg:-translate-y-1/2 lg:columns-6 xl:w-[calc(50vw+34rem)] 2xl:w-[calc(50vw+42rem)]"
                        data-home-approved-gallery
                    >
                        {Array.from({length: HOME_PAGE_GALLERY_SLOT_COUNT}, (_, index) => (
                            <HomeApprovedGalleryTile image={displayImages[index]} index={index} />
                        ))}
                    </div>
                </div>
            </div>
            <HomeApprovedGalleryScript />
        </section>
    )
}

function HeroGridBackdrop() {
    return (
        <div aria-hidden="true" class="pointer-events-none absolute inset-0 z-0 overflow-hidden">
            <svg
                aria-hidden="true"
                class="home-hero-grid absolute -inset-16 h-[calc(100%+8rem)] w-[calc(100%+8rem)]"
                preserveAspectRatio="none"
            >
                <defs>
                    <pattern height="64" id="home-hero-grid-pattern" patternUnits="userSpaceOnUse" width="64">
                        <path d="M 64 0 H 0 V 64" fill="none" stroke="rgba(0, 195, 255, 0.19)" stroke-width="1" />
                    </pattern>
                </defs>
                <rect fill="url(#home-hero-grid-pattern)" height="100%" width="100%" />
            </svg>
        </div>
    )
}

function HomeSearchForm() {
    return (
        <form action="/search" class="home-hero-search home-reveal mt-5 w-full [animation-delay:120ms] lg:mt-6" method="get">
            <label class="input flex w-full min-w-0 items-center gap-3 lg:input-lg">
                <svg
                    aria-hidden="true"
                    class="h-5 w-5 opacity-70"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                    />
                </svg>
                <input class="min-w-0 grow" maxLength={80} name="q" placeholder="Search characters, artists, accounts..." type="search" />
            </label>
        </form>
    )
}

function HomeStats({stats}: {stats: HomePageStats}) {
    return (
        <div class="stats stats-vertical w-full min-w-0 border border-base-300 bg-base-100/70 sm:stats-horizontal">
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.users)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Users</div>
            </div>
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.characters)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Characters</div>
            </div>
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.mediaItems)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Images</div>
            </div>
        </div>
    )
}

function HeroDragonArt() {
    return (
        <div
            class="home-reveal relative z-20 aspect-4/5 w-full [animation-delay:140ms] lg:h-full lg:min-h-0 lg:aspect-auto"
            data-home-gallery-wall
        >
            <figure class="home-float absolute inset-0 overflow-visible bg-transparent [--home-float-duration:9s] [--home-float-x:0.35rem] [--home-float-y:-0.65rem] [--home-rotate:-1deg] lg:overflow-hidden lg:rounded-lg lg:bg-base-200">
                <img
                    alt={HOME_PAGE_HERO_IMAGE_ALT}
                    class="h-full w-full object-contain object-center lg:object-cover"
                    decoding="async"
                    fetchpriority="high"
                    loading="eager"
                    src={HOME_PAGE_HERO_IMAGE_PATH}
                />
                <figcaption class="home-hero-art-card absolute bottom-1 left-3 z-10 max-w-60 rounded-lg border border-base-300 bg-base-100/85 p-3 sm:bottom-3 sm:left-4 lg:bottom-6 lg:left-8 lg:p-4">
                    <p class="text-xs font-bold uppercase text-base-content/60">credit</p>
                    <p class="mt-1 text-lg font-black">@NU_M00N</p>
                </figcaption>
            </figure>
        </div>
    )
}

function HeroSection({stats}: {stats: HomePageStats}) {
    return (
        <section class="home-hero-section relative isolate overflow-visible bg-base-100 px-4 pt-10 pb-8 sm:px-6 sm:pt-14 sm:pb-8 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:px-8 lg:py-8">
            <HeroGridBackdrop />
            <div class="relative z-10 mx-auto grid max-w-7xl gap-8 lg:h-full lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center xl:gap-12">
                <div>
                    <h1 class="home-hero-title font-display home-reveal mt-4 text-5xl leading-none [animation-delay:60ms] sm:text-6xl xl:text-7xl">
                        Easy maintenance. Easy browsing.
                    </h1>
                    <p class="home-hero-lead home-reveal mt-5 max-w-2xl text-base leading-7 text-base-content/75 [animation-delay:90ms] lg:text-lg lg:leading-8">
                        Easily build and share a high-quality character media gallery. No BS.
                    </p>
                    <HomeSearchForm />
                    <div class="home-hero-actions home-reveal mt-4 flex flex-col gap-3 [animation-delay:160ms] sm:flex-row sm:items-center lg:mt-5">
                        <div class="full sm:w-auto">
                            <a
                                class="btn btn-primary h-auto min-h-10 w-full whitespace-normal text-center sm:w-auto lg:btn-lg"
                                href="/register"
                            >
                                Start a gallery
                            </a>
                        </div>
                        <a class="btn btn-outline h-auto min-h-10 w-full whitespace-normal text-center sm:w-auto lg:btn-lg" href="/search">
                            Explore profiles
                        </a>
                    </div>
                    <div class="home-hero-stats home-reveal mt-5 [animation-delay:220ms] lg:mt-6">
                        <HomeStats stats={stats} />
                    </div>
                </div>
                <HeroDragonArt />
            </div>
        </section>
    )
}

export function HomePage({
    currentUser,
    discoverCharacters,
    galleryImages,
    guestInitial,
    heightChartCharacters,
    mediaBaseUrl,
    siteUrl,
    stats,
}: HomePageProps) {
    return (
        <BaseLayout head={<HomePageHead siteUrl={siteUrl} stats={stats} />} title={HOME_PAGE_TITLE}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />
            <main>
                <HeroSection stats={stats} />
                <DiscoverGalleriesSection characters={discoverCharacters} mediaBaseUrl={mediaBaseUrl} />
                <GalleryFeatureSection galleryImages={galleryImages} />
                <HeightChartFeatureSection characters={heightChartCharacters} />
                <AdditionalFeaturesSection />
                <HomeCallToActionSection />
            </main>
        </BaseLayout>
    )
}
