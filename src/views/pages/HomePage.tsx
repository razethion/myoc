import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import type {CurrentUser} from '../../lib/auth/session'
import {absoluteUrl} from '../meta'

export type HomePageStats = {
    users: number
    characters: number
    mediaItems: number
}

type HomePageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    siteUrl: string
    stats: HomePageStats
}

const HOME_PAGE_TITLE = 'MyOC | High-Resolution Character Gallery'
const HOME_PAGE_KEYWORDS = 'character art gallery, original character gallery, OC gallery, character reference, character media, art portfolio, furry character gallery'
const HOME_PAGE_IMAGE_PATH = '/assets/myocbanner.webp'
const HOME_PAGE_IMAGE_ALT = 'Easily share character art without losing quality. No fuss.'
const HOME_PAGE_HERO_IMAGE_PATH = '/assets/razfalling.webp'
const HOME_PAGE_HERO_IMAGE_ALT = 'Red dragon character art floating against a purple sky'

function formatCount(value: number): string {
    return Math.max(0, value).toLocaleString('en-US')
}

export function homePageDescription(stats: HomePageStats): string {
    return `Hosting over ${formatCount(stats.mediaItems)} images`
}

function HomePageHead({siteUrl, stats}: { siteUrl: string; stats: HomePageStats }) {
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
            <meta content={description} name="description"/>
            <meta content={HOME_PAGE_KEYWORDS} name="keywords"/>
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" name="robots"/>
            <meta content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1"
                  name="googlebot"/>
            <meta content="MyOC" name="application-name"/>
            <meta content="MyOC" name="apple-mobile-web-app-title"/>
            <meta content="#0f172a" name="theme-color"/>
            <meta content="dark light" name="color-scheme"/>
            <meta content="telephone=no" name="format-detection"/>
            <meta content="strict-origin-when-cross-origin" name="referrer"/>
            <link href={canonicalUrl} rel="canonical"/>

            <meta content={HOME_PAGE_TITLE} property="og:title"/>
            <meta content={description} property="og:description"/>
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
            <meta content={description} name="twitter:description"/>
            <meta content={imageUrl} name="twitter:image"/>
            <meta content={HOME_PAGE_IMAGE_ALT} name="twitter:image:alt"/>

            <script
                dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}}
                type="application/ld+json"
            ></script>
            <HomePageMotionStyles/>
        </>
    )
}

function HomePageMotionStyles() {
    return (
        <style>{`
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

            @keyframes home-scan {
                from {
                    transform: translateY(-100%);
                }

                to {
                    transform: translateY(100%);
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
                animation: home-float var(--home-float-duration, 7s) ease-in-out infinite;
            }

            .home-gallery-scan::after {
                background: linear-gradient(180deg, transparent, color-mix(in oklab, var(--color-base-content) 20%, transparent), transparent);
                content: "";
                inset: 0;
                opacity: 0.18;
                pointer-events: none;
                position: absolute;
                transform: translateY(-100%);
                animation: home-scan 5.5s ease-in-out infinite;
            }

            .home-hero-grid {
                animation: home-grid-drift 28s linear infinite;
            }

            @media (prefers-reduced-motion: reduce) {
                .home-reveal,
                .home-float,
                .home-gallery-scan::after,
                .home-hero-grid {
                    animation: none;
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
        `}</style>
    )
}

function HeroGridBackdrop() {
    return (
        <svg
            aria-hidden="true"
            class="home-hero-grid pointer-events-none absolute -inset-16 z-0 h-[calc(100%+8rem)] w-[calc(100%+8rem)]"
            preserveAspectRatio="none"
        >
            <defs>
                <pattern height="64" id="home-hero-grid-pattern" patternUnits="userSpaceOnUse" width="64">
                    <path d="M 64 0 H 0 V 64" fill="none" stroke="rgba(0, 195, 255, 0.19)" stroke-width="1"/>
                </pattern>
            </defs>
            <rect fill="url(#home-hero-grid-pattern)" height="100%" width="100%"/>
        </svg>
    )
}

function HomeSearchForm() {
    return (
        <form action="/search"
              class="home-hero-search home-reveal mt-5 w-full [animation-delay:120ms] lg:mt-6"
              method="get">
            <label class="input flex w-full min-w-0 items-center gap-3 lg:input-lg">
                <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                     xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" stroke-linecap="round"
                          stroke-linejoin="round" stroke-width="2"/>
                </svg>
                <input class="min-w-0 grow" maxLength={80} name="q"
                       placeholder="Search characters, artists, accounts..."
                       type="search"/>
            </label>
        </form>
    )
}

function HomeStats({stats}: { stats: HomePageStats }) {
    return (
        <div
            class="stats stats-vertical w-full min-w-0 border border-base-300 bg-base-100/70 shadow backdrop-blur sm:stats-horizontal">
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.users)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Users</div>
            </div>
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div
                    class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.characters)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Characters</div>
            </div>
            <div class="home-hero-stat stat min-w-0 place-items-center px-4 py-3 text-center lg:py-4">
                <div
                    class="stat-value max-w-full truncate text-3xl lg:text-4xl">{formatCount(stats.mediaItems)}</div>
                <div class="stat-title text-xs uppercase tracking-wide">Images</div>
            </div>
        </div>
    )
}

function HeroDragonArt() {
    return (
        <div class="home-reveal relative min-h-0 [animation-delay:140ms] lg:h-full lg:min-h-0"
             data-home-gallery-wall>
            <figure
                class="home-float home-gallery-scan relative aspect-4/5 w-full overflow-hidden rounded-lg bg-base-200 shadow-2xl shadow-base-300/40 [--home-float-duration:9s] [--home-float-x:0.35rem] [--home-float-y:-0.65rem] [--home-rotate:-1deg] lg:absolute lg:inset-0 lg:aspect-auto">
                <img
                    alt={HOME_PAGE_HERO_IMAGE_ALT}
                    class="h-full w-full object-contain object-center lg:object-cover"
                    decoding="async"
                    fetchpriority="high"
                    loading="eager"
                    src={HOME_PAGE_HERO_IMAGE_PATH}
                />
                <figcaption
                    class="home-hero-art-card absolute bottom-1 left-3 z-10 max-w-60 rounded-lg border border-base-300 bg-base-100/85 p-3 shadow-xl backdrop-blur sm:bottom-3 sm:left-4 lg:bottom-6 lg:left-8 lg:p-4">
                    <p class="text-xs font-bold uppercase text-base-content/60">credit</p>
                    <p class="mt-1 text-lg font-black">@NU_M00N</p>
                </figcaption>
            </figure>
        </div>
    )
}

function HeroSection({stats}: { stats: HomePageStats }) {
    return (
        <section
            class="home-hero-section relative isolate overflow-visible bg-base-100 px-4 py-10 sm:px-6 sm:py-14 lg:h-[calc(100dvh-4rem)] lg:overflow-hidden lg:px-8 lg:py-8">
            <HeroGridBackdrop/>
            <div
                class="relative z-10 mx-auto grid h-full max-w-7xl gap-8 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:items-center xl:gap-12">
                <div>
                    <h1 class="home-hero-title font-display home-reveal mt-4 text-5xl leading-none [animation-delay:60ms] sm:text-6xl xl:text-7xl">Easy
                        maintenance. Easy browsing.</h1>
                    <p class="home-hero-lead home-reveal mt-5 max-w-2xl text-base leading-7 text-base-content/75 [animation-delay:90ms] lg:text-lg lg:leading-8">
                        Easily build and share a high-quality character media gallery. No BS.
                    </p>
                    <HomeSearchForm/>
                    <div
                        class="home-hero-actions home-reveal mt-4 flex flex-col gap-3 [animation-delay:160ms] sm:flex-row sm:items-center lg:mt-5">
                        <div class="aura aura-gold aura-lg w-full sm:w-auto">
                            <a class="btn btn-primary h-auto min-h-10 w-full whitespace-normal text-center sm:w-auto lg:btn-lg"
                               href="/register">Start a gallery</a>
                        </div>
                        <a class="btn btn-outline h-auto min-h-10 w-full whitespace-normal text-center sm:w-auto lg:btn-lg"
                           href="/search">Explore profiles</a>
                    </div>
                    <div class="home-hero-stats home-reveal mt-5 [animation-delay:220ms] lg:mt-6">
                        <HomeStats stats={stats}/>
                    </div>
                </div>
                <HeroDragonArt/>
            </div>
        </section>
    )
}

export function HomePage({currentUser, guestInitial, mediaBaseUrl, siteUrl, stats}: HomePageProps) {
    return (
        <BaseLayout head={<HomePageHead siteUrl={siteUrl} stats={stats}/>} title={HOME_PAGE_TITLE}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main>
                <HeroSection stats={stats}/>
            </main>
        </BaseLayout>
    )
}
