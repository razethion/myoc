import type {CurrentUser} from '../../lib/auth/session'
import {APP_VERSION, type ReleaseNote} from '../../lib/releases'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type WhatsNewPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    releases: ReleaseNote[]
}

function WhatsNewStyles() {
    return (
        <style>{`
            .whats-new-shell {
                background:
                    linear-gradient(135deg, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent 28rem),
                    linear-gradient(225deg, color-mix(in oklab, var(--color-secondary) 10%, transparent), transparent 26rem),
                    var(--color-base-100);
            }

            .whats-new-list::before {
                content: "";
                position: absolute;
                bottom: 0.5rem;
                left: 0.6875rem;
                top: 0.5rem;
                width: 2px;
                background: linear-gradient(
                    to bottom,
                    var(--color-primary),
                    color-mix(in oklab, var(--color-base-content) 22%, transparent)
                );
            }

            .whats-new-dot {
                box-shadow: 0 0 0 6px var(--color-base-100);
            }

            @media (min-width: 640px) {
                .whats-new-list::before {
                    left: 1.1875rem;
                }

                .whats-new-dot {
                    box-shadow: 0 0 0 8px var(--color-base-100);
                }
            }
        `}</style>
    )
}

function ReleaseBlock({release, isCurrent}: { release: ReleaseNote, isCurrent: boolean }) {
    return (
        <li class="relative grid gap-4 pl-10 sm:pl-14">
            <span
                class={`whats-new-dot absolute left-1.5 top-6 h-3 w-3 rounded-full sm:left-4 ${release.important ? 'bg-warning' : 'bg-primary'}`}></span>
            <article class="rounded-lg border border-base-300 bg-base-200/90 p-5 shadow-xl sm:p-6">
                <div
                    class="flex flex-col gap-3 border-b border-base-300 pb-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p class="text-sm font-semibold uppercase tracking-[0.22em] text-primary">{release.releasedOn}</p>
                        <h2 class="mt-2 text-2xl font-black leading-tight sm:text-3xl">{release.title}</h2>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        {release.important ? <span class="badge badge-warning">Important!</span> : null}
                        {isCurrent ? <span class="badge badge-primary">Current</span> : null}
                        <span class="badge badge-outline">v{release.version}</span>
                    </div>
                </div>

                <p class="mt-4 leading-7 text-base-content/75">{release.summary}</p>
                {release.important ? (
                    <div class="alert alert-warning alert-dash mt-5" role="alert">
                        <span>This change requires user interaction. Review the notes before continuing.</span>
                    </div>
                ) : null}
                <ul class="mt-5 grid gap-3">
                    {release.changes.map((change) => (
                        <li class="flex gap-3 rounded border border-base-300 bg-base-100/80 p-3">
                            <span aria-hidden="true" class="mt-1 h-2 w-2 shrink-0 rounded-full bg-secondary"></span>
                            <span>{change}</span>
                        </li>
                    ))}
                </ul>
            </article>
        </li>
    )
}

export function WhatsNewPage({currentUser, guestInitial, mediaBaseUrl, releases}: WhatsNewPageProps) {
    return (
        <BaseLayout head={<WhatsNewStyles/>} title="What's New | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main class="whats-new-shell min-h-[calc(100vh-4rem)] px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
                <section class="mx-auto max-w-5xl">
                    <div class="border-b border-base-300 pb-8">
                        <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <p class="text-sm font-semibold uppercase tracking-[0.28em] text-primary">Release
                                    Notes</p>
                                <h1 class="mt-3 text-4xl font-black tracking-tight sm:text-5xl">What's new</h1>
                                <p class="mt-4 max-w-2xl text-lg leading-8 text-base-content/75">
                                    Follow MyOC updates as they happen.
                                </p>
                            </div>
                            <div class="rounded-lg border border-base-300 bg-base-200 px-4 py-3"
                                 data-app-version={APP_VERSION}>
                                <p class="text-xs font-bold uppercase tracking-[0.22em] text-base-content/60">Current
                                    version</p>
                                <p class="mt-1 text-xl font-black">v{APP_VERSION}</p>
                            </div>
                        </div>
                    </div>

                    <ol class="whats-new-list relative mt-10 grid gap-7">
                        {releases.map((release, index) => (
                            <ReleaseBlock isCurrent={index === 0} release={release}/>
                        ))}
                    </ol>
                </section>
            </main>
        </BaseLayout>
    )
}
