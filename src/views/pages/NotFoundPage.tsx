import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type NotFoundPageProps = {
    currentUser?: CurrentUser | null
    guestInitial?: string
    mediaBaseUrl: string
    message?: string
}

function NotFoundStyles() {
    return (
        <style>{`
            .not-found-field {
                position: relative;
                isolation: isolate;
                overflow: hidden;
                background:
                    radial-gradient(circle at 16% 20%, color-mix(in oklab, var(--color-primary) 22%, transparent), transparent 30%),
                    radial-gradient(circle at 78% 28%, color-mix(in oklab, var(--color-secondary) 20%, transparent), transparent 28%),
                    linear-gradient(135deg, color-mix(in oklab, var(--color-base-200) 78%, black), var(--color-base-100));
            }

            .not-found-field::before {
                content: "";
                position: absolute;
                inset: 0;
                z-index: -1;
                background:
                    linear-gradient(var(--color-base-300) 1px, transparent 1px),
                    linear-gradient(90deg, var(--color-base-300) 1px, transparent 1px);
                background-size: 44px 44px;
                opacity: 0.28;
                mask-image: radial-gradient(circle at center, black, transparent 72%);
            }

            .not-found-code {
                text-shadow:
                    0 0 34px color-mix(in oklab, var(--color-primary) 42%, transparent),
                    0 0 80px color-mix(in oklab, var(--color-secondary) 25%, transparent);
            }
        `}</style>
    )
}

export function NotFoundPage({
    currentUser,
    guestInitial = 'R',
    mediaBaseUrl,
    message = 'The page you are looking for does not exist or has been moved.',
}: NotFoundPageProps) {
    return (
        <BaseLayout head={<NotFoundStyles/>} title="404 | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main class="not-found-field flex min-h-[calc(100vh-4rem)] items-center px-4 py-16 sm:px-6 lg:px-8">
                <section class="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
                    <div>
                        <p class="text-sm font-semibold uppercase tracking-[0.35em] text-primary">Not Found</p>
                        <h1 class="not-found-code mt-4 text-8xl font-black leading-none sm:text-9xl">404</h1>
                        <p class="mt-6 max-w-xl text-lg leading-8 text-base-content/75">{message}</p>
                        <div class="mt-8 flex flex-col gap-3 sm:flex-row">
                            <a class="btn btn-primary" href="/">Go Home</a>
                            {currentUser ? (
                                <a class="btn btn-outline" href="/characters">Manage Characters</a>
                            ) : (
                                <a class="btn btn-outline" href="/login">Log In</a>
                            )}
                        </div>
                    </div>

                    <div aria-hidden="true" class="rounded-box border border-base-300 bg-base-200/70 p-5 shadow-2xl">
                        <div class="rounded-box border border-base-300 bg-base-100 p-4">
                            <div class="mb-4 flex items-center gap-2">
                                <span class="h-3 w-3 rounded-full bg-error"></span>
                                <span class="h-3 w-3 rounded-full bg-warning"></span>
                                <span class="h-3 w-3 rounded-full bg-success"></span>
                            </div>
                            <div class="grid gap-3">
                                <div class="h-5 w-2/3 rounded bg-base-300"></div>
                                <div class="h-5 w-1/2 rounded bg-base-300"></div>
                                <div class="mt-2 grid grid-cols-3 gap-3">
                                    <div class="aspect-square rounded bg-base-300"></div>
                                    <div class="aspect-square rounded border border-dashed border-primary bg-primary/10"></div>
                                    <div class="aspect-square rounded bg-base-300"></div>
                                </div>
                                <div class="h-5 w-3/4 rounded bg-base-300"></div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
        </BaseLayout>
    )
}
