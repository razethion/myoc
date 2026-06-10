type NavbarProps = {
    currentUser?: {
        username: string
        avatarUrl: string
    }
    guestInitial?: string
}

export function Navbar({currentUser, guestInitial = 'R'}: NavbarProps) {
    const avatarLetter = guestInitial.trim().charAt(0).toUpperCase() || 'R'
    const avatarUrl = currentUser?.avatarUrl ?? `https://ui-avatars.com/api/?name=${avatarLetter}&background=ff0000&color=ffffff`

    return (
        <div class="navbar sticky top-0 z-50 border-b border-base-300 bg-base-200/95 px-4 backdrop-blur sm:px-6">
            <div class="flex-1">
                <a class="text-xl font-bold" href="/">MyOC</a>
            </div>

            <div class="mx-3 hidden w-full max-w-md flex-none sm:block">
                <label class="input input-bordered w-full">
                    <svg class="h-4 w-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                         xmlns="http://www.w3.org/2000/svg">
                        <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" stroke-linecap="round"
                              stroke-linejoin="round" stroke-width="2"/>
                    </svg>
                    <input class="grow" placeholder="Search characters, artists, tags..." type="search"/>
                </label>
            </div>

            <div class="flex-none">
                <details class="dropdown dropdown-end">
                    <summary class="btn btn-ghost btn-circle avatar">
                        <div class="w-10 rounded-full">
                            <img alt={currentUser ? `${currentUser.username} profile` : `${avatarLetter} profile`}
                                 src={avatarUrl}/>
                        </div>
                    </summary>

                    <ul class="menu dropdown-content bg-base-100 rounded-box z-50 mt-3 w-56 p-2 shadow">
                        <li><a href="/characters">Characters</a></li>
                        <li><a href="/settings">Settings</a></li>
                        <div class="divider my-1"></div>
                        <li><a class="text-error" href="/logout">Logout</a></li>
                    </ul>
                </details>
            </div>
        </div>
    )
}
