<script lang="ts">
import type {SearchPageData} from '@myoc/contracts/search'
import {onMount} from 'svelte'

const LAST_SEEN_VERSION_STORAGE_KEY = 'myoc:lastSeenVersion'

let {shell}: {shell: SearchPageData['shell']} = $props()
let showVersionNotification = $state(initialVersionNotificationState())

function initialVersionNotificationState(): boolean {
    return shell.showVersionNotification
}

onMount(() => {
    if (shell.viewer || window.location.pathname === '/whats-new') {
        return
    }

    try {
        showVersionNotification = window.localStorage.getItem(LAST_SEEN_VERSION_STORAGE_KEY) !== shell.appVersion
    } catch {
        showVersionNotification = true
    }
})

function markLocalSeen(): void {
    try {
        window.localStorage.setItem(LAST_SEEN_VERSION_STORAGE_KEY, shell.appVersion)
    } catch {
        // Local storage is optional. The notice can still close for this page view.
    }
}

async function markRemoteSeen(): Promise<void> {
    if (!shell.viewer) {
        return
    }

    try {
        await fetch('/api/users/me/release-view', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-csrf-token': shell.viewer.csrfToken,
            },
            body: JSON.stringify({version: shell.appVersion}),
        })
    } catch {
        // The notice is not important enough to interrupt navigation.
    }
}

function markReleaseSeen(): void {
    markLocalSeen()
    showVersionNotification = false
    void markRemoteSeen()
}
</script>

{#snippet searchForm()}
    <form action="/search" class="w-full" method="get">
        <label class="input input-bordered w-full">
            <svg aria-hidden="true" class="h-4 w-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
            </svg>
            <input class="grow" maxlength="80" name="q" placeholder="Search characters, artists, tags..." type="search" />
        </label>
    </form>
{/snippet}

<header class="sticky top-0 z-50 border-b border-base-300 bg-base-200/95 px-4 py-2 sm:px-6">
    <div class="navbar min-h-0 p-0">
        <div class="flex-1">
            <a class="font-display text-2xl" href="/">MyOC</a>
        </div>

        <div class="mx-3 hidden w-full max-w-md flex-none md:block">{@render searchForm()}</div>
        <div class="flex-none">
            {#if shell.viewer}
                <details class="dropdown dropdown-end">
                    <summary aria-label="Open account menu" class="btn btn-ghost btn-circle avatar">
                        <div class="w-10 rounded-full">
                            <img alt={`${shell.viewer.username} avatar`} src={shell.viewer.avatarUrl} />
                        </div>
                    </summary>

                    <ul class="menu dropdown-content rounded-box z-50 mt-3 w-64 bg-base-100 p-2 shadow">
                        <li class="pointer-events-none px-3 py-2">
                            <div class="flex min-w-0 items-center gap-3 p-0">
                                <div class="avatar">
                                    <div class="w-10 rounded-full"><img alt="" src={shell.viewer.avatarUrl} /></div>
                                </div>
                                <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold">{shell.viewer.username}</div>
                                    <div class="truncate text-xs text-base-content/60">Signed in</div>
                                </div>
                            </div>
                        </li>
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li class="menu-title"><span>Account</span></li>
                        <li><a href={shell.viewer.profileUrl}>View Profile</a></li>
                        <li><a href="/settings">Settings</a></li>
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li class="menu-title"><span>Library</span></li>
                        <li><a href="/recent">Recent uploads</a></li>
                        <li><a href="/leaderboard">Leaderboard</a></li>
                        <li><a href="/characters">Characters</a></li>
                        <li><a href="/size-chart">Size Chart</a></li>
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li class="menu-title"><span>Updates</span></li>
                        <li><a href="/whats-new">What's New</a></li>
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li class="menu-title"><span>Help</span></li>
                        <li><a href="https://github.com/razethion/myoc/issues" rel="noreferrer" target="_blank">Report issue</a></li>
                        <li><a href="https://github.com/razethion/myoc/discussions" rel="noreferrer" target="_blank">Ask a question</a></li>
                        {#if shell.viewer.canModerateImages}
                            <li class="my-1"><hr class="border-base-300" /></li>
                            <li class="menu-title"><span>Moderation</span></li>
                            <li><a href="/admin">Admin</a></li>
                        {/if}
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li><button class="text-error" form="logout-form" type="submit">Logout</button></li>
                    </ul>
                    <form action="/logout" id="logout-form" method="post">
                        <input name="csrfToken" type="hidden" value={shell.viewer.csrfToken} />
                    </form>
                </details>
            {:else}
                <div class="flex items-center gap-2">
                    <details class="dropdown dropdown-end">
                        <summary aria-label="Open navigation menu" class="btn btn-ghost btn-square btn-sm sm:btn-md">
                            <svg aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path d="M4 6h16M4 12h16M4 18h16" stroke-linecap="round" stroke-width="2"></path>
                            </svg>
                        </summary>
                        <ul class="menu dropdown-content rounded-box z-50 mt-3 w-52 bg-base-100 p-2 shadow">
                            <li class="menu-title"><span>Explore</span></li>
                            <li><a href="/recent">Recent uploads</a></li>
                            <li><a href="/leaderboard">Leaderboard</a></li>
                            <li><a href="/characters">Characters</a></li>
                            <li><a href="/size-chart">Size Chart</a></li>
                            <li class="my-1"><hr class="border-base-300" /></li>
                            <li><a href="/whats-new">What's New</a></li>
                        </ul>
                    </details>
                    <a class="btn btn-ghost btn-sm sm:btn-md" href="/login">Login</a>
                    <a class="btn btn-primary btn-sm sm:btn-md" href="/register">Create account</a>
                </div>
            {/if}
        </div>
    </div>

    <div class="mt-2 md:hidden">{@render searchForm()}</div>

    {#if showVersionNotification}
        {#if shell.importantRelease}
            <div class="alert alert-warning alert-dash alert-vertical mt-2 w-full text-sm sm:alert-horizontal" role="status">
                <div class="min-w-0 text-center sm:text-left">
                    <p class="font-semibold">New in v{shell.appVersion}</p>
                    <p class="text-xs font-semibold">This change requires user interaction</p>
                </div>
                <div class="flex items-center justify-center gap-2 sm:justify-end">
                    <a class="btn btn-primary btn-xs" href="/whats-new" onclick={markReleaseSeen}>What's new</a>
                    <button aria-label="Dismiss version notification" class="btn btn-ghost btn-xs btn-square" onclick={markReleaseSeen} type="button">x</button>
                </div>
            </div>
        {:else}
            <div class="mt-2 rounded border border-primary/35 bg-primary/10 px-3 py-2 text-sm" role="status">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p class="font-semibold">New in v{shell.appVersion}</p>
                    <div class="flex items-center justify-center gap-2 sm:justify-end">
                        <a class="btn btn-primary btn-xs" href="/whats-new" onclick={markReleaseSeen}>What's new</a>
                        <button aria-label="Dismiss version notification" class="btn btn-ghost btn-xs btn-square" onclick={markReleaseSeen} type="button">x</button>
                    </div>
                </div>
            </div>
        {/if}
    {/if}
</header>
