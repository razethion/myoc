import { Navbar } from '../components/Navbar'
import { BaseLayout } from '../layouts/BaseLayout'
import type {CurrentUser} from '../../lib/auth/session'
import {characterMediaImageUrl, characterProfileImageUrl} from '../../lib/media/url'

export type HomePageStats = {
    users: number
    characters: number
    mediaItems: number
}

export type HomePageDiscoverCharacter = {
    id: string
    userId: string
    name: string
    ownerUsername: string
    profileImageKey: string
    previewMediaId: string
    previewImageKey: string
    previewContentType: string | null
    previewArtist: string
    imageCount: number
}

const productPillars = [
    {
        eyebrow: 'Original files',
        title: 'Built around the art, not thumbnails',
        body: 'Upload full-resolution character media and keep the gallery presentation focused on the actual asset. No watermark-heavy previews, no compressed reference sheets, no forced layout gimmicks.',
        accent: 'from-cyan-300/24 to-blue-500/8',
    },
    {
        eyebrow: 'Character-first',
        title: 'Profiles that behave like organized libraries',
        body: 'Separate characters, folders, references, variants, outfits, commissions, sketches, and older work without turning every profile into a maintenance project.',
        accent: 'from-emerald-300/20 to-lime-500/8',
    },
    {
        eyebrow: 'Creator control',
        title: 'Simple ownership and visibility tools',
        body: 'Handle NSFW preferences, character transfers, profile updates, and gallery ordering with direct controls that stay out of the way until you need them.',
        accent: 'from-fuchsia-300/20 to-rose-500/8',
    },
]

const workflowSteps = [
    {
        step: '01',
        title: 'Create a clean character profile',
        body: 'Start with the character, then group media by folder, tab, or purpose so visitors land in the right context immediately.'
    },
    {
        step: '02',
        title: 'Upload gallery media at real resolution',
        body: 'Keep source dimensions available for detail inspection while presenting a fast, responsive browsing experience.'
    },
    {
        step: '03',
        title: 'Arrange the profile like a reference desk',
        body: 'Put primary references first, move supporting art into dedicated tabs, and keep older work available without making it the headline.'
    },
]

const differentiators = [
    {
        title: 'No custom-CSS arms race',
        body: 'Profiles stay consistent and readable, so the media is the focus instead of a fragile theme.'
    },
    {
        title: 'Designed for reference browsing',
        body: 'Character pages support practical organization patterns: main refs, alternate outfits, detail crops, tabs, and folders.'
    },
    {
        title: 'Modern media delivery',
        body: 'The app is built on a current stack with direct asset URLs, responsive pages, and infrastructure that can scale with the gallery.'
    },
    {
        title: 'Preference-aware galleries',
        body: 'Content controls let viewers decide what they want visible while allowing artists to host the work their characters need.'
    },
    {
        title: 'Source available',
        body: 'MyOC is source available. Inspect how the gallery works and follow development in public.',
        href: 'https://github.com/razethion/myoc',
        linkLabel: 'View the code on GitHub',
    },
]

const LEARN_MORE_SECTION_ID = 'platform'

type HomePageProps = {
    currentUser?: CurrentUser | null
    discoverCharacters: HomePageDiscoverCharacter[]
    guestInitial: string
    mediaBaseUrl: string
    siteUrl: string
    stats: HomePageStats
}

const HOME_PAGE_TITLE = 'MyOC | High-Resolution Character Gallery'
const HOME_PAGE_DESCRIPTION = 'Easily share character art without losing quality. No more fuss. Keep all your character assets organized in a simple gallery built around original-resolution files.'
const HOME_PAGE_KEYWORDS = 'character art gallery, original character gallery, OC gallery, character reference, character media, art portfolio, furry character gallery'
const HOME_PAGE_IMAGE_PATH = '/assets/myocbanner.webp'
const HOME_PAGE_IMAGE_ALT = 'Easily share character art without losing quality. No fuss.'

function absoluteUrl(siteUrl: string, path: string): string {
    return new URL(path, siteUrl).toString()
}

function formatCount(value: number): string {
    return Math.max(0, value).toLocaleString('en-US')
}

function characterUrl(character: HomePageDiscoverCharacter): string {
    return `/u/${encodeURIComponent(character.ownerUsername)}/${encodeURIComponent(character.name)}`
}

function HomePageHead({siteUrl}: { siteUrl: string }) {
    const canonicalUrl = absoluteUrl(siteUrl, '/')
    const imageUrl = absoluteUrl(siteUrl, HOME_PAGE_IMAGE_PATH)
    const structuredData = {
        '@context': 'https://schema.org',
        '@graph': [
            {
                '@type': 'WebSite',
                '@id': `${canonicalUrl}#website`,
                name: 'MyOC',
                url: canonicalUrl,
                description: HOME_PAGE_DESCRIPTION,
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
                description: HOME_PAGE_DESCRIPTION,
                image: imageUrl,
            },
        ],
    }

    return (
        <>
            <meta content={HOME_PAGE_DESCRIPTION} name="description"/>
            <meta content={HOME_PAGE_KEYWORDS} name="keywords"/>
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" name="robots"/>
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" name="googlebot"/>
            <meta content="MyOC" name="application-name"/>
            <meta content="MyOC" name="apple-mobile-web-app-title"/>
            <meta content="#0f172a" name="theme-color"/>
            <meta content="dark light" name="color-scheme"/>
            <meta content="telephone=no" name="format-detection"/>
            <meta content="strict-origin-when-cross-origin" name="referrer"/>
            <link href={canonicalUrl} rel="canonical"/>

            <meta content={HOME_PAGE_TITLE} property="og:title"/>
            <meta content={HOME_PAGE_DESCRIPTION} property="og:description"/>
            <meta content="website" property="og:type"/>
            <meta content={canonicalUrl} property="og:url"/>
            <meta content="MyOC" property="og:site_name"/>
            <meta content={imageUrl} property="og:image"/>
            <meta content="1200" property="og:image:width"/>
            <meta content="630" property="og:image:height"/>
            <meta content="image/webp" property="og:image:type"/>
            <meta content={HOME_PAGE_IMAGE_ALT} property="og:image:alt"/>
            <meta content="en_US" property="og:locale"/>

            <meta content="summary_large_image" name="twitter:card"/>
            <meta content={HOME_PAGE_TITLE} name="twitter:title"/>
            <meta content={HOME_PAGE_DESCRIPTION} name="twitter:description"/>
            <meta content={imageUrl} name="twitter:image"/>
            <meta content={HOME_PAGE_IMAGE_ALT} name="twitter:image:alt"/>

            <script
                dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}}
                type="application/ld+json"
            ></script>
            <HomePageStyles/>
        </>
    )
}

function HomePageStyles() {
    return (
        <style>{`
            .hero-prism {
                isolation: isolate;
                background:
                    linear-gradient(135deg, rgba(255, 0, 170, 0.22), transparent 38%),
                    linear-gradient(225deg, rgba(0, 210, 255, 0.24), transparent 40%),
                    linear-gradient(315deg, rgba(60, 255, 40, 0.16), transparent 46%),
                    var(--color-base-100);
            }

            .glass-preview-card {
                background:
                    linear-gradient(135deg, rgba(255, 0, 170, 0.045), transparent 34%),
                    linear-gradient(315deg, rgba(0, 210, 255, 0.06), transparent 46%),
                    linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent 38%),
                    rgba(255, 255, 255, 0.01);
                border: 1px solid rgba(165, 243, 252, 0.36);
                box-shadow:
                    0 24px 80px rgba(0, 210, 255, 0.08),
                    inset 0 1px 0 rgba(255, 255, 255, 0.22),
                    inset 0 -1px 0 rgba(255, 0, 170, 0.08);
                backdrop-filter: blur(1px) saturate(145%);
                -webkit-backdrop-filter: blur(1px) saturate(145%);
            }

            .home-depth {
                background:
                    radial-gradient(circle at 12% 8%, rgba(34, 211, 238, 0.12), transparent 30rem),
                    radial-gradient(circle at 88% 28%, rgba(244, 114, 182, 0.10), transparent 28rem),
                    linear-gradient(180deg, var(--color-base-100), var(--color-base-200) 46%, var(--color-base-100));
            }

            .stat-ribbon {
                background:
                    linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)),
                    rgba(0, 0, 0, 0.16);
                border: 1px solid rgba(165, 243, 252, 0.28);
                box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
            }

            .product-card {
                background:
                    linear-gradient(135deg, rgba(255, 255, 255, 0.055), transparent 42%),
                    var(--color-base-100);
                border: 1px solid var(--color-base-300);
            }

            .workflow-card {
                background:
                    linear-gradient(180deg, rgba(255, 255, 255, 0.055), transparent),
                    var(--color-base-200);
            }

            .discover-card {
                background:
                    linear-gradient(135deg, rgba(34, 211, 238, 0.08), transparent 42%),
                    var(--color-base-100);
            }

            .discover-card img {
                transition: transform 260ms ease;
            }

            .discover-card:hover img {
                transform: scale(1.04);
            }

            .home-loading-media {
                overflow: hidden;
                position: relative;
            }

            .home-loading-image {
                display: block;
                opacity: 1;
                transition:
                    opacity 160ms ease,
                    transform 260ms ease;
            }

            .home-loading-media.image-loading .home-loading-image {
                opacity: 0.35;
            }

            .home-image-loader {
                align-items: center;
                background: color-mix(in oklab, var(--color-base-300) 65%, transparent);
                display: none;
                inset: 0;
                justify-content: center;
                pointer-events: none;
                position: absolute;
                z-index: 20;
            }

            .home-loading-media.image-loading .home-image-loader {
                display: flex;
            }

            .hero-prism::before {
                content: "";
                position: absolute;
                inset: 0;
                z-index: 1;
                pointer-events: none;
                background:
                    linear-gradient(var(--color-base-300) 1px, transparent 1px),
                    linear-gradient(90deg, var(--color-base-300) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(0, 0, 0, 0.16) 0%, rgba(0, 0, 0, 0.24) 36%, rgba(0, 0, 0, 0.12) 100%);
                background-size: 56px 56px, 56px 56px, auto;
                opacity: 0.52;
            }

            @media (max-width: 1023px) {
                .hero-prism::before {
                    background:
                        linear-gradient(var(--color-base-300) 1px, transparent 1px),
                        linear-gradient(90deg, var(--color-base-300) 1px, transparent 1px),
                        linear-gradient(180deg, rgba(0, 0, 0, 0.10) 0%, rgba(0, 0, 0, 0.42) 100%);
                    background-size: 48px 48px, 48px 48px, auto;
                }
            }
        `}</style>
    )
}

function HomeImageLoader({size = 'loading-lg'}: { size?: string }) {
    return (
        <div aria-hidden="true" class="home-image-loader" data-gallery-image-loader>
            <span class={`loading loading-spinner ${size} text-base-content`}></span>
        </div>
    )
}

function HomePageImageLoadingScript() {
    const script = `
function setHomeImageLoading(image, isLoading) {
    const media = image.closest('.home-loading-media');
    if (!media) return;
    media.classList.toggle('image-loading', Boolean(isLoading));
    const loader = media.querySelector('[data-gallery-image-loader]');
    if (loader) loader.hidden = !isLoading;
}

function refreshHomeImageLoading(image) {
    setHomeImageLoading(image, !(image.complete && image.naturalWidth > 0));
}

function initHomeImageLoading() {
    document.querySelectorAll('.home-loading-image').forEach((image) => {
        if (image.dataset.loadingBound === 'true') {
            refreshHomeImageLoading(image);
            return;
        }
        image.dataset.loadingBound = 'true';
        image.addEventListener('load', () => setHomeImageLoading(image, false));
        image.addEventListener('error', () => setHomeImageLoading(image, false));
        refreshHomeImageLoading(image);
    });
}

initHomeImageLoading();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function HomePage({currentUser, discoverCharacters, guestInitial, mediaBaseUrl, siteUrl, stats}: HomePageProps) {
    const platformStats = [
        {
            label: 'users trust MyOC',
            value: formatCount(stats.users),
        },
        {
            label: 'characters hosted',
            value: formatCount(stats.characters),
        },
        {
            label: 'gallery items stored',
            value: formatCount(stats.mediaItems),
        },
    ]
    const hasDiscoverCharacters = discoverCharacters.length > 0

    return (
        <BaseLayout head={<HomePageHead siteUrl={siteUrl}/>} title={HOME_PAGE_TITLE}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main>
                <section class="hero-prism relative overflow-hidden border-b border-base-300 bg-base-100">
                    <div class="relative z-20 mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:px-8">
                        <div>
                            <span class="badge badge-primary badge-lg">High-resolution character gallery</span>
                            <h1 class="mt-6 text-5xl font-black leading-[0.95] sm:text-6xl">Share character art without losing quality.</h1>
                            <p class="mt-6 max-w-xl text-lg leading-8 opacity-80">
                                No more fuss. Keep all your character assets organized in a simple gallery built around original-resolution files.
                            </p>
                            <div class="mt-8 flex flex-col gap-3 sm:flex-row">
                                <a class="btn btn-primary btn-lg" href="/register">Get started</a>
                                <a class="btn btn-outline btn-lg" href={`#${LEARN_MORE_SECTION_ID}`}>Learn more</a>
                            </div>
                            <div class="stat-ribbon mt-10 grid gap-4 rounded-3xl p-4 sm:grid-cols-3">
                                {platformStats.map((stat) => (
                                    <div class="rounded-2xl border border-base-300/70 bg-base-100/50 p-4">
                                        <p class="text-3xl font-black tracking-tight">{stat.value}</p>
                                        <p class="mt-1 text-xs font-semibold uppercase tracking-[0.2em] opacity-65">{stat.label}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div class="glass-preview-card rounded-3xl p-4">
                            <div class="relative">
                                <div class="home-loading-media image-loading aspect-4/5 w-full rounded-2xl bg-base-300">
                                    <img
                                        alt="Character artwork preview"
                                        class="home-loading-image h-full w-full object-cover"
                                        decoding="async"
                                        src="/assets/razfalling.png"
                                    />
                                    <HomeImageLoader/>
                                </div>
                                <div class="absolute bottom-3 right-3 w-32 rounded-2xl border border-cyan-100/30 bg-base-100/80 p-2 shadow-xl backdrop-blur-md sm:bottom-4 sm:right-4 sm:w-56">
                                    <div
                                        aria-hidden="true"
                                        class="aspect-square rounded-xl bg-no-repeat"
                                        style="background-image: url('/assets/razfalling.png'); background-size: 4000px 5000px; background-position: -2500px -2500px;"
                                    ></div>
                                    <p class="mt-2 text-center text-xs font-semibold">Detail at 100%</p>
                                </div>
                            </div>
                            <div class="mt-4 flex items-center justify-between gap-4">
                                <div>
                                    <p class="font-semibold">credit: NU_M00N</p>
                                    <p class="text-sm opacity-70">4000 x 5000 / original file</p>
                                </div>
                                <span class="badge badge-success">Full-res</span>
                            </div>
                        </div>
                    </div>
                </section>

                <div class="home-depth">
                    {hasDiscoverCharacters && (
                        <section class="px-4 py-20 sm:px-6 lg:px-8">
                            <div class="mx-auto max-w-7xl">
                                <div class="mb-10 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
                                    <div class="max-w-3xl">
                                        <p class="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Discover</p>
                                        <h2 class="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Characters with galleries worth browsing.</h2>
                                        <p class="mt-4 text-lg leading-8 opacity-75">
                                            See just how far you can go with MyOC.
                                        </p>
                                    </div>
                                    <a class="btn btn-outline" href="/search">Search all profiles</a>
                                </div>

                                <div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                                    {discoverCharacters.map((character) => {
                                        const previewUrl = characterMediaImageUrl(
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
                                            <a class="discover-card group overflow-hidden rounded-3xl border border-base-300 shadow-xl" href={characterUrl(character)}>
                                                <div class="home-loading-media image-loading aspect-4/3 bg-base-300">
                                                    <img
                                                        alt={`${character.name} gallery preview by ${artist}`}
                                                        class="home-loading-image h-full w-full object-cover"
                                                        decoding="async"
                                                        loading="lazy"
                                                        src={previewUrl}
                                                    />
                                                    <div class="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 to-transparent p-4 text-white">
                                                        <p class="text-xs font-bold uppercase tracking-[0.2em] text-white/70">Featured gallery</p>
                                                        <p class="mt-1 text-sm font-semibold">{formatCount(character.imageCount)} images</p>
                                                    </div>
                                                    <HomeImageLoader/>
                                                </div>
                                                <div class="flex items-center gap-4 p-5">
                                                    <div
                                                        class="home-loading-media image-loading h-14 w-14 shrink-0 rounded-2xl bg-base-300 ring-1 ring-base-300">
                                                        <img
                                                            alt={`${character.name} profile image`}
                                                            class="home-loading-image h-full w-full object-cover"
                                                            decoding="async"
                                                            loading="lazy"
                                                            src={profileImageUrl}
                                                        />
                                                        <HomeImageLoader size="loading-sm"/>
                                                    </div>
                                                    <div class="min-w-0">
                                                        <h3 class="truncate text-xl font-black">{character.name}</h3>
                                                        <p class="truncate text-sm opacity-70">by @{character.ownerUsername}</p>
                                                    </div>
                                                </div>
                                            </a>
                                        )
                                    })}
                                </div>
                            </div>
                        </section>
                    )}

                    <section class="px-4 py-20 sm:px-6 lg:px-8" id={LEARN_MORE_SECTION_ID}>
                        <div class="mx-auto max-w-7xl">
                            <div class="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
                                <div>
                                    <p class="text-sm font-semibold uppercase tracking-[0.25em] text-primary">A sharper gallery platform</p>
                                    <h2 class="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Professional character pages without the bloat.</h2>
                                </div>
                                <p class="text-lg leading-8 opacity-75">
                                    MyOC is for artists, commissioners, roleplayers, and character owners who need a durable home for visual references. It keeps the product surface small, the media quality high, and the organization model obvious.
                                </p>
                            </div>

                            <div class="mt-10 grid gap-5 lg:grid-cols-3">
                                {productPillars.map((pillar) => (
                                    <article class="product-card overflow-hidden rounded-3xl shadow-xl">
                                        <div class={`h-2 bg-linear-to-r ${pillar.accent}`}></div>
                                        <div class="p-6">
                                            <p class="text-xs font-bold uppercase tracking-[0.22em] text-primary">{pillar.eyebrow}</p>
                                            <h3 class="mt-4 text-2xl font-black leading-tight">{pillar.title}</h3>
                                            <p class="mt-4 leading-7 opacity-75">{pillar.body}</p>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section class="px-4 pb-20 sm:px-6 lg:px-8">
                        <div class="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
                            <div
                                class="rounded-3xl border border-base-300 bg-base-100/75 p-6 shadow-xl backdrop-blur lg:sticky lg:top-24">
                                <span class="badge badge-secondary badge-lg">Workflow</span>
                                <h2 class="mt-5 text-3xl font-black tracking-tight sm:text-4xl">From loose uploads to a usable reference system.</h2>
                                <p class="mt-4 leading-7 opacity-75">
                                    Most galleries stop at image hosting. MyOC treats each character as the unit of organization, then gives you enough structure to keep growing without rebuilding the profile every few months.
                                </p>
                                <div class="mt-6 flex flex-col gap-3 sm:flex-row lg:flex-col xl:flex-row">
                                    <a class="btn btn-primary" href="/register">Start a gallery</a>
                                    <a class="btn btn-ghost" href="/search">Explore profiles</a>
                                </div>
                            </div>

                            <div class="grid gap-5">
                                {workflowSteps.map((item) => (
                                    <article class="workflow-card rounded-3xl border border-base-300 p-6 shadow-lg">
                                        <div class="flex flex-col gap-5 sm:flex-row">
                                            <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 text-2xl font-black text-primary">
                                                {item.step}
                                            </div>
                                            <div>
                                                <h3 class="text-2xl font-black">{item.title}</h3>
                                                <p class="mt-3 leading-7 opacity-75">{item.body}</p>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        </div>
                    </section>

                    <section class="px-4 pb-20 sm:px-6 lg:px-8">
                        <div class="mx-auto max-w-7xl overflow-hidden rounded-4xl border border-base-300 bg-base-100 shadow-2xl">
                            <div class="grid lg:grid-cols-[1fr_1.2fr]">
                                <div class="border-b border-base-300 bg-base-200 p-8 lg:border-b-0 lg:border-r">
                                    <p class="text-sm font-semibold uppercase tracking-[0.25em] text-primary">Why it feels different</p>
                                    <h2 class="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Focused enough to stay fast. Flexible enough to be useful.</h2>
                                    <p class="mt-4 leading-7 opacity-75">
                                        The goal is not to become a social network, writing platform, or theming engine. The goal is to make character art easy to store, browse, and hand off.
                                    </p>
                                </div>
                                <div class="grid gap-px bg-base-300 sm:grid-cols-2">
                                    {differentiators.map((item) => (
                                        <article class="bg-base-100 p-6">
                                            <div class="mb-5 h-1.5 w-14 rounded-full bg-linear-to-r from-primary via-secondary to-accent"></div>
                                            <h3 class="text-xl font-black">{item.title}</h3>
                                            <p class="mt-3 leading-7 opacity-75">{item.body}</p>
                                            {'href' in item && (
                                                <a class="btn btn-outline btn-sm mt-5" href={item.href} rel="noreferrer"
                                                   target="_blank">{item.linkLabel}</a>
                                            )}
                                        </article>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="px-4 pb-24 sm:px-6 lg:px-8">
                        <div class="mx-auto max-w-7xl rounded-4xl border border-cyan-100/20 bg-neutral p-8 text-neutral-content shadow-2xl sm:p-10 lg:p-12">
                            <div class="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                                <div>
                                    <p class="text-sm font-semibold uppercase tracking-[0.25em] text-cyan-200">Ready for serious character archives</p>
                                    <h2 class="mt-3 text-4xl font-black tracking-tight sm:text-5xl">Give every character a gallery that can grow with them.</h2>
                                    <p class="mt-5 max-w-2xl text-lg leading-8 text-neutral-content/75">
                                        Build a clean public profile, preserve image detail, and keep the reference material organized enough for artists, friends, and future owners to understand.
                                    </p>
                                </div>
                                <div class="rounded-3xl border border-white/10 bg-white/5 p-6">
                                    <div class="grid gap-3 text-center sm:grid-cols-3">
                                        {platformStats.map((stat) => (
                                            <div class="rounded-2xl bg-black/20 p-4">
                                                <p class="text-2xl font-black">{stat.value}</p>
                                                <p class="mt-1 text-[0.65rem] font-bold uppercase tracking-[0.18em] text-neutral-content/60">{stat.label}</p>
                                            </div>
                                        ))}
                                    </div>
                                    <a class="btn btn-primary mt-6 w-full" href="/register">Create your MyOC gallery</a>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>
            <HomePageImageLoadingScript/>
        </BaseLayout>
    )
}
