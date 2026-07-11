import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type ProductVisionPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
}

const PRODUCT_VISION_POINTS = [
    {
        title: 'View character art easily',
        body:
            'Character profiles should make accessing artwork quick, easy, and simple. The product should be so' +
            'easy to use that anybody can stand up their profile in a matter of minutes with no guidance.',
    },
    {
        title: 'Manage characters easily',
        body:
            'Character owners should be able to maintain their characater gallery easily and intuitively. The UX should' +
            'be easy to understand, work reliably, and leave little room for interpretation on behaviour.',
    },
    {
        title: 'High quality media should stay high quality',
        body:
            'People should be able to rely on the product as a representative gallery, without worrying about their ' +
            'art becoming pixellated junk. Images might be initially served compressed for delivery purposes, but the' +
            'full-resolution unaltered image should always be displayed to users in the end.',
    },
    {
        title: 'Extra features come second',
        body:
            'Extra features are nice, but should not take away from any other product goals, and ideally they' +
            'bolster the existing product goals. For example, character height charts are a nice-to-have, but do' +
            'not interfere with making a character gallery or making the site easy to browse.',
    },
]

const PRODUCT_VISION_IS = [
    'A focused place to host and share character art.',
    'A gallery-first profile system for owners who want simple maintenance.',
    'A tool for sending clean character references to friends, artists, and collaborators.',
    'A product that should stay easy to browse even as profiles grow.',
]

const PRODUCT_VISION_IS_NOT = [
    'A social network built around feeds, popularity, or engagement loops.',
    'A marketplace, trading hub, or character economy platform.',
    'A custom website builder where every profile needs hand-tuned design work.',
    'A replacement for every possible lore, writing, or worldbuilding tool.',
]

export function ProductVisionPage({currentUser, guestInitial, mediaBaseUrl}: ProductVisionPageProps) {
    return (
        <BaseLayout title="Product Vision | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />
            <main class="min-h-[calc(100vh-4rem)] bg-base-100 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
                <section class="mx-auto max-w-6xl">
                    <div class="border-b border-base-content/10 pb-8">
                        <p class="text-sm font-bold uppercase text-base-content/55">Product Vision</p>
                        <h1 class="font-display mt-4 max-w-4xl text-4xl leading-tight sm:text-5xl">
                            Making character art easy to store and share.
                        </h1>
                        <p class="mt-5 max-w-3xl text-base leading-7 text-base-content/70 sm:text-lg sm:leading-8">
                            MyOC has a clear and focused vision for what we want the site to be.
                        </p>
                    </div>

                    <div class="grid border-l border-t border-base-content/10 md:grid-cols-2">
                        {PRODUCT_VISION_POINTS.map((point) => (
                            <article class="border-b border-r border-base-content/10 p-6">
                                <h2 class="text-lg font-bold leading-7">{point.title}</h2>
                                <p class="mt-3 text-sm leading-6 text-base-content/65">{point.body}</p>
                            </article>
                        ))}
                    </div>

                    <section class="grid gap-8 border-b border-base-content/10 py-10">
                        <div>
                            <h2 class="font-display mt-3 text-3xl leading-tight">I've been in your shoes.</h2>
                            <p class="mt-3">
                                Maybe you use another gallery site like toyhou.se, or maybe you keep all your character photos in a photo
                                gallery like google photos, or maybe you keep your art in a cloud storage provider like Google Drive or
                                Dropbox.
                            </p>
                            <p class="mt-3">Those solutions might work, but they all have their own issues.</p>
                            <p class="mt-3">
                                Toyhou.se is focused on dozens of features, character trading, lore, CSS, etc. It's no doubt a powerful
                                platform, but not everybody wants that kind of featureset, and it can be hard for somebody that doesn't
                                understand toyhou.se to browse a heavily customized CSS profile.
                            </p>
                            <p class="mt-3">
                                Google Photos is usable with albums, but those images aren't perfectly lossless, and sharing albums isn't
                                the most straight-forward process either.
                            </p>
                            <p class="mt-3">
                                Cloud storage providers are usable, but aren't designed to display your art the way it deserves to be. Plus,
                                many of them badger you into making an account just to view the media in full resolution.
                            </p>
                            <h2 class="font-display mt-3 text-3xl leading-tight">It shouldn't be this hard.</h2>
                            <p class="mt-3">
                                MyOC was born out of the desire to <i>just show people my character art</i>. I stood up a super basic
                                gallery site just for myself so I could send a simple link to artists when I bought commissions, and it was
                                perfect. I liked it so much that I turned it into a product anybody can use...and you're looking at it.
                            </p>
                        </div>
                    </section>

                    <section class="grid gap-6 py-10 lg:grid-cols-2">
                        <div class="border border-base-content/10 p-6">
                            <h2 class="font-display text-3xl leading-tight">What MyOC is</h2>
                            <ul class="mt-5 grid gap-3 text-sm leading-6 text-base-content/70">
                                {PRODUCT_VISION_IS.map((item) => (
                                    <li class="flex gap-3">
                                        <span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 bg-primary"></span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div class="border border-base-content/10 p-6">
                            <h2 class="font-display text-3xl leading-tight">What MyOC isn't</h2>
                            <ul class="mt-5 grid gap-3 text-sm leading-6 text-base-content/70">
                                {PRODUCT_VISION_IS_NOT.map((item) => (
                                    <li class="flex gap-3">
                                        <span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 bg-base-content/35"></span>
                                        <span>{item}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                </section>
            </main>
        </BaseLayout>
    )
}
