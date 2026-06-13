import { Navbar } from '../components/Navbar'
import { BaseLayout } from '../layouts/BaseLayout'
import type {CurrentUser} from '../../lib/auth/session'

const features = [
    {
        label: 'Quality',
        title: 'Original image fidelity',
        body: 'Store full quality, uncompressed imagery while preserving the original color space so artwork stays true to the uploaded file.'
    },
    {
        label: 'Controls',
        title: 'Content preferences',
        body: 'Use content controls to filter the gallery and only see the kinds of media you want visible while browsing.'
    },
    {
        label: 'Organize',
        title: 'Characters and folders',
        body: 'Keep media sorted with simple character pages and folder management for references, outfits, sketches, commissions, and variants.'
    },
    {
        label: 'Transfers',
        title: 'Character transfers',
        body: 'Transfer characters cleanly when ownership changes, keeping the relevant media and asset organization attached.'
    },
    {
        label: 'Layout',
        title: 'Gallery ordering',
        body: 'Arrange gallery items in the order that makes sense for each character, from primary references to alternate outfits, detail shots, and older work.'
    },
    {
        label: 'Usability',
        title: 'Modern infrastructure',
        body: 'MyOC is built on modern infrastructure, including a scalable backend and a fast, responsive frontend.'
    }
]

const questions = [
    {
        badgeClass: 'badge-primary',
        title: 'Why use MyOC?',
        body: 'MyOC is a gallery for character media and assets. It allows you to do so simply, effectively, and without unnecessary extra gimmicks.'
    },
    {
        badgeClass: 'badge-secondary',
        title: 'Does it preserve image quality?',
        body: 'Yes. The focus is original-resolution uploads and clear previews, so high-detail artwork can be inspected instead of flattened into low-quality thumbnails.'
    },
    {
        badgeClass: 'badge-accent',
        title: "What's wrong with <other gallery site>?",
        body: "MyOC does one thing: display media. No literature, no custom CSS, no gimmicks. Other sites do not retain quality, add watermarks, or have not been updated in years."
    },
    {
        badgeClass: 'badge-accent',
        title: 'Do you allow NSFW content?',
        body: 'Yes, as long as it falls within our acceptable use policy. MyOC will never ban users for NSFW content.'
    }
]

const QUESTIONS_SECTION_ID = 'questions'

type HomePageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    siteUrl: string
}

const HOME_PAGE_TITLE = 'MyOC | High-Resolution Character Gallery'
const HOME_PAGE_DESCRIPTION = 'Easily share character art without losing quality. No more fuss. Keep all your character assets organized in a simple gallery built around original-resolution files.'
const HOME_PAGE_KEYWORDS = 'character art gallery, original character gallery, OC gallery, character reference, character media, art portfolio, furry character gallery'
const HOME_PAGE_IMAGE_PATH = '/assets/myocbanner.webp'
const HOME_PAGE_IMAGE_ALT = 'Easily share character art without losing quality. No fuss.'

function absoluteUrl(siteUrl: string, path: string): string {
    return new URL(path, siteUrl).toString()
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

export function HomePage({currentUser, guestInitial, mediaBaseUrl, siteUrl}: HomePageProps) {
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
                                <a class="btn btn-outline btn-lg" href={`#${QUESTIONS_SECTION_ID}`}>Learn more</a>
                            </div>
                        </div>

                        <div class="glass-preview-card rounded-3xl p-4">
                            <div class="relative">
                                <img alt="Character artwork preview" class="aspect-4/5 w-full rounded-2xl object-cover" src="/assets/razfalling.png" />
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

                <section class="bg-base-100 px-4 py-16 sm:px-6 lg:px-8">
                    <div class="mx-auto max-w-7xl">
                        <div class="mb-8 max-w-2xl">
                            <p class="text-sm font-semibold uppercase tracking-widest text-primary">Site features</p>
                            <h2 class="mt-2 text-3xl font-black sm:text-4xl">Built for character media libraries</h2>
                            <p class="mt-4 leading-7 opacity-75">
                                Practical tools for storing and arranging character assets without adding extra complexity to the gallery experience.
                            </p>
                        </div>

                        <div class="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
                            {features.map((feature) => (
                                <article class="card border border-base-300 bg-base-200 shadow">
                                    <div class="card-body">
                                        <span class="badge badge-primary badge-outline w-fit">{feature.label}</span>
                                        <h3 class="card-title">{feature.title}</h3>
                                        <p class="leading-7 opacity-80">{feature.body}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>

                <section class="bg-base-200 px-4 py-16 sm:px-6 lg:px-8" id={QUESTIONS_SECTION_ID}>
                    <div class="mx-auto max-w-7xl">
                        <div class="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                            <div>
                                <p class="text-sm font-semibold uppercase tracking-widest text-primary">Product basics</p>
                                <h2 class="mt-2 text-3xl font-black sm:text-4xl">Quick answers</h2>
                            </div>
                            <p class="max-w-xl leading-7 opacity-75">
                                MyOC has one job: deliver original-quality media to users who want it, with a simple interface and no gimmicks.
                            </p>
                        </div>

                        <div class="grid gap-5 md:grid-cols-2">
                            {questions.map((question) => (
                                <article class="card border border-base-300 bg-base-100 shadow">
                                    <div class="card-body">
                                        <span class={`badge ${question.badgeClass} badge-outline w-fit`}>Q</span>
                                        <h3 class="card-title">{question.title}</h3>
                                        <p class="leading-7 opacity-80">{question.body}</p>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                </section>
            </main>
        </BaseLayout>
    )
}
