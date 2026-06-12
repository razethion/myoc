import type {CurrentUser} from '../../lib/auth/session'
import {profilePhotoUrl} from '../../lib/media/url'

type NavbarProps = {
    currentUser?: CurrentUser | null
    guestInitial?: string
    mediaBaseUrl: string
}

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

    return (
        <header class="sticky top-0 z-50 border-b border-base-300 bg-base-200/95 px-4 py-2 backdrop-blur sm:px-6">
            <div class="navbar min-h-0 p-0">
                <div class="flex-1">
                    <a class="text-xl font-bold" href="/">MyOC</a>
                </div>

                <div class="mx-3 hidden w-full max-w-md flex-none md:block">
                    {search}
                </div>

                <div class="flex-none">
                    {currentUser ? (
                        <details class="dropdown dropdown-end">
                            <summary class="btn btn-ghost btn-circle avatar">
                                <div class="w-10 rounded-full">
                                    <img alt={`${currentUser.username} profile`} data-profile-photo-image
                                         src={avatarUrl}/>
                                </div>
                            </summary>

                            <ul class="menu dropdown-content bg-base-100 rounded-box z-50 mt-3 w-56 p-2 shadow">
                                <li><a href={`/u/${encodeURIComponent(currentUser.username)}`}>Profile</a></li>
                                <li><a href="/characters">Characters</a></li>
                                <li><a href="/settings">Settings</a></li>
                                <div class="divider my-1"></div>
                                <li><button class="text-error" form="logout-form" type="submit">Logout</button></li>
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
        </header>
    )
}
