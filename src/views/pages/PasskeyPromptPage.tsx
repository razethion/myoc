import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type PasskeyPromptPageProps = {
    currentUser: CurrentUser
    mediaBaseUrl: string
    returnTo: string
}

export function PasskeyPromptPage({currentUser, mediaBaseUrl, returnTo}: PasskeyPromptPageProps) {
    return (
        <BaseLayout title="Set Up A Passkey | MyOC">
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl}/>

            <main class="container mx-auto flex min-h-[calc(100vh-5rem)] max-w-2xl items-center px-3 py-10 sm:px-0">
                <section class="card card-border w-full bg-base-200">
                    <div class="card-body gap-5">
                        <div>
                            <p class="badge badge-primary">Account Security</p>
                            <h1 class="mt-4 text-3xl font-bold sm:text-4xl">Set up a passkey</h1>
                            <p class="mt-3 text-base-content/70">
                                Passkeys make signing in faster and protect your account without relying on a password.
                            </p>
                        </div>

                        <div class="alert alert-info">
                            <span>You only need to answer this once.</span>
                        </div>

                        <form action="/api/users/me/passkey-prompt-response" class="card-actions justify-end gap-2"
                              method="post">
                            <input name="csrfToken" type="hidden" value={currentUser.csrfToken}/>
                            <input name="returnTo" type="hidden" value={returnTo}/>
                            <button class="btn btn-ghost" name="choice" type="submit" value="later">
                                Maybe Another Time
                            </button>
                            <button class="btn btn-primary" name="choice" type="submit" value="setup">
                                Set Up Now
                            </button>
                        </form>
                    </div>
                </section>
            </main>
        </BaseLayout>
    )
}
