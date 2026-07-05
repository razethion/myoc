import type {CurrentUser} from '../../lib/auth/session'
import {APP_VERSION, RELEASE_NOTES} from '../../lib/releases'
import {profilePhotoUrl} from '../../lib/media/url'

type NavbarProps = {
    currentUser?: CurrentUser | null
    guestInitial?: string
    mediaBaseUrl: string
}

const LAST_SEEN_VERSION_STORAGE_KEY = 'myoc:lastSeenVersion'
const CURRENT_RELEASE = RELEASE_NOTES.find((release) => release.version === APP_VERSION)

export function Navbar({currentUser, guestInitial = 'R', mediaBaseUrl}: NavbarProps) {
    const avatarName = currentUser?.username ?? guestInitial
    const avatarLetter = avatarName.trim().charAt(0).toUpperCase() || 'R'
    const avatarUrl = currentUser?.profilePhotoKey
        ? profilePhotoUrl(mediaBaseUrl, currentUser.id, currentUser.profilePhotoKey)
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(avatarLetter)}&background=ccc&color=000`
    const search = (
        <form action="/search" class="w-full" method="get">
            <label class="input input-bordered w-full">
                <svg class="h-4 w-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                     xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" stroke-linecap="round"
                          stroke-linejoin="round" stroke-width="2"/>
                </svg>
                <input class="grow" maxLength={80} name="q" placeholder="Search characters, artists, tags..." type="search"/>
            </label>
        </form>
    )

    const shouldShowVersionNotification = Boolean(currentUser && currentUser.lastSeenVersion !== APP_VERSION)

    return (
        <header class="sticky top-0 z-50 border-b border-base-300 bg-base-200/95 px-4 py-2 sm:px-6">
            <div class="navbar min-h-0 p-0">
                <div class="flex-1">
                    <a class="font-display text-2xl" href="/">MyOC</a>
                </div>

                <div class="mx-3 hidden w-full max-w-md flex-none md:block">
                    {search}
                </div>
                <div class="flex-none">
                    {currentUser ? (
                        <details class="dropdown dropdown-end">
                            <summary aria-label="Open account menu" class="btn btn-ghost btn-circle avatar">
                                <div class="w-10 rounded-full">
                                    <img alt={`${currentUser.username} profile`} data-profile-photo-image
                                         src={avatarUrl}/>
                                </div>
                            </summary>

                            <ul class="menu dropdown-content bg-base-100 rounded-box z-50 mt-3 w-64 p-2 shadow">
                                <li class="pointer-events-none px-3 py-2">
                                    <div class="flex min-w-0 items-center gap-3 p-0">
                                        <div class="avatar">
                                            <div class="w-10 rounded-full">
                                                <img alt="" data-profile-photo-image src={avatarUrl}/>
                                            </div>
                                        </div>
                                        <div class="min-w-0">
                                            <div class="truncate text-sm font-semibold">{currentUser.username}</div>
                                            <div class="truncate text-xs text-base-content/60">Signed in</div>
                                        </div>
                                    </div>
                                </li>
                                <li class="my-1">
                                    <hr class="border-base-300"/>
                                </li>
                                <li class="menu-title"><span>Account</span></li>
                                <li><a href={`/u/${encodeURIComponent(currentUser.username)}`}>View Profile</a></li>
                                <li><a href="/settings">Settings</a></li>
                                <li class="my-1">
                                    <hr class="border-base-300"/>
                                </li>
                                <li class="menu-title"><span>Library</span></li>
                                <li><a href="/characters">Characters</a></li>
                                <li><a href="/size-chart">Size Chart</a></li>
                                <li class="my-1">
                                    <hr class="border-base-300"/>
                                </li>
                                <li class="menu-title"><span>Updates</span></li>
                                <li><a href="/whats-new">What's New</a></li>
                                <li class="my-1">
                                    <hr class="border-base-300"/>
                                </li>
                                <li class="menu-title"><span>Help</span></li>
                                <li>
                                    <a
                                        href="https://github.com/razethion/myoc/issues"
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        Report issue
                                    </a>
                                </li>
                                <li>
                                    <a
                                        href="https://github.com/razethion/myoc/discussions"
                                        rel="noreferrer"
                                        target="_blank"
                                    >
                                        Ask a question
                                    </a>
                                </li>
                                {currentUser.role === 'admin' && (
                                    <>
                                        <li class="my-1">
                                            <hr class="border-base-300"/>
                                        </li>
                                        <li class="menu-title"><span>Moderation</span></li>
                                        <li><a href="/admin">Admin</a></li>
                                    </>
                                )}
                                <li class="my-1">
                                    <hr class="border-base-300"/>
                                </li>
                                <li>
                                    <button class="text-error" form="logout-form" type="submit">Logout</button>
                                </li>
                            </ul>
                            <form action="/api/logout" id="logout-form" method="post">
                                <input name="csrfToken" type="hidden" value={currentUser.csrfToken} />
                            </form>
                        </details>
                    ) : (
                        <div class="flex items-center gap-2">
                            <a class="btn btn-ghost btn-sm sm:btn-md" href="/login">Login</a>
                            <a class="btn btn-primary btn-sm sm:btn-md" href="/register">Create account</a>
                        </div>
                    )}
                </div>
            </div>

            <div class="mt-2 md:hidden">
                {search}
            </div>

            <VersionNotification
                csrfToken={currentUser?.csrfToken ?? null}
                isAuthenticated={Boolean(currentUser)}
                showInitially={shouldShowVersionNotification}
            />
        </header>
    )
}

function VersionNotification({
                                 csrfToken,
                                 isAuthenticated,
                                 showInitially,
                             }: {
    csrfToken: string | null
    isAuthenticated: boolean
    showInitially: boolean
}) {
    const isImportantRelease = Boolean(CURRENT_RELEASE?.important)
    const notificationClass = isImportantRelease
        ? 'alert alert-warning alert-dash alert-vertical sm:alert-horizontal mt-2 w-full text-sm'
        : 'mt-2 rounded border border-primary/35 bg-primary/10 px-3 py-2 text-sm'
    const actions = (
        <div class="flex items-center justify-center gap-2 sm:justify-end">
            <a class="btn btn-primary btn-xs" href="/whats-new" data-version-notification-link>What's
                new</a>
            <button
                aria-label="Dismiss version notification"
                class="btn btn-ghost btn-xs btn-square"
                data-version-notification-dismiss
                type="button"
            >
                x
            </button>
        </div>
    )

    return (
        <>
            <div
                class={`${notificationClass} ${showInitially ? '' : 'hidden'}`}
                data-authenticated={isAuthenticated ? 'true' : 'false'}
                data-version-notification
            >
                {isImportantRelease ? (
                    <>
                        <div class="min-w-0 text-center sm:text-left">
                            <p class="font-semibold">New in v{APP_VERSION}</p>
                            <p class="text-xs font-semibold">This change requires user interaction</p>
                        </div>
                        {actions}
                    </>
                ) : (
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p class="font-semibold">New in v{APP_VERSION}</p>
                        {actions}
                    </div>
                )}
            </div>
            <VersionNotificationScript csrfToken={csrfToken} isAuthenticated={isAuthenticated}/>
        </>
    )
}

function VersionNotificationScript({
                                       csrfToken,
                                       isAuthenticated,
                                   }: {
    csrfToken: string | null
    isAuthenticated: boolean
}) {
    const script = `
(function () {
    const appVersion = ${JSON.stringify(APP_VERSION)};
    const storageKey = ${JSON.stringify(LAST_SEEN_VERSION_STORAGE_KEY)};
    const isAuthenticated = ${JSON.stringify(isAuthenticated)};
    const csrfToken = ${JSON.stringify(csrfToken)};
    const notification = document.querySelector('[data-version-notification]');

    function markLocalSeen() {
        try {
            window.localStorage.setItem(storageKey, appVersion);
        } catch {}
    }

    async function markRemoteSeen() {
        if (!isAuthenticated || !csrfToken) return;

        try {
            await fetch('/api/users/me/release-view', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                },
                body: JSON.stringify({version: appVersion}),
            });
        } catch {}
    }

    function hideNotification() {
        if (notification) {
            notification.classList.add('hidden');
        }
    }

    if (window.location.pathname === '/whats-new') {
        markLocalSeen();
        hideNotification();
        return;
    }

    if (!isAuthenticated && notification) {
        try {
            if (window.localStorage.getItem(storageKey) !== appVersion) {
                notification.classList.remove('hidden');
            }
        } catch {
            notification.classList.remove('hidden');
        }
    }

    const link = document.querySelector('[data-version-notification-link]');
    if (link) {
        link.addEventListener('click', () => {
            markLocalSeen();
            void markRemoteSeen();
        });
    }

    const dismiss = document.querySelector('[data-version-notification-dismiss]');
    if (dismiss) {
        dismiss.addEventListener('click', () => {
            markLocalSeen();
            void markRemoteSeen();
            hideNotification();
        });
    }
})();
`

    return <script dangerouslySetInnerHTML={{__html: script}}/>
}
