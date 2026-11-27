<script lang="ts">
import type {SearchPageData} from '@myoc/contracts/search'
import {onMount} from 'svelte'

const LAST_SEEN_VERSION_STORAGE_KEY = 'myoc:lastSeenVersion'

let {shell}: {shell: SearchPageData['shell']} = $props()
let viewer = $derived(shell.viewer)
let showVersionNotification = $state(initialVersionNotificationState())

type MenuIcon = keyof typeof MENU_ICONS

type MenuItem = {
    label: string
    href: string
    icon: MenuIcon
    external?: boolean
}

type MenuGroup = {
    title: string
    items: MenuItem[]
}

// Heroicons v2 outline paths (stroke-width 1.5, 24x24 viewBox).
const MENU_ICONS = {
    clock: ['M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z'],
    userCircle: [
        'M17.982 18.725A7.488 7.488 0 0 0 12 15.75a7.488 7.488 0 0 0-5.982 2.975m11.963 0a9 9 0 1 0-11.963 0m11.963 0A8.966 8.966 0 0 1 12 21a8.966 8.966 0 0 1-5.982-2.275M15 9.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    ],
    trophy: [
        'M16.5 18.75h-9m9 0a3 3 0 0 1 3 3h-15a3 3 0 0 1 3-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 0 1-.982-3.172M9.497 14.25a7.454 7.454 0 0 0 .981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 0 0 7.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M7.73 9.728a6.726 6.726 0 0 0 2.748 1.35m8.272-6.842V4.5c0 2.108-.966 3.99-2.48 5.228m2.48-5.492a46.32 46.32 0 0 1 2.916.52 6.003 6.003 0 0 1-5.395 4.972m0 0a6.726 6.726 0 0 1-2.749 1.35m0 0a6.772 6.772 0 0 1-3.044 0',
    ],
    documentChartBar: [
        'M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25M9 16.5v.75m3-3v3M15 12v5.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z',
    ],
    sparkles: [
        'M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z',
    ],
    user: [
        'M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z',
    ],
    settings: [
        'M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.111-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z',
        'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    ],
    flag: [
        'M3 3v1.5M3 21v-6m0 0 2.77-.693a9 9 0 0 1 6.208.682l.108.054a9 9 0 0 0 6.086.71l3.114-.732a48.524 48.524 0 0 1-.005-10.499l-3.11.732a9 9 0 0 1-6.085-.711l-.108-.054a9 9 0 0 0-6.208-.682L3 4.5M3 15V4.5',
    ],
    question: [
        'M8.625 9.75a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z',
    ],
    shield: [
        'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z',
    ],
    logout: [
        'M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9',
    ],
} as const

const CHARACTERS_ITEM: MenuItem = {label: 'Characters', href: '/characters', icon: 'userCircle'}
const RECENT_UPLOADS_ITEM: MenuItem = {label: 'Recent uploads', href: '/recent', icon: 'clock'}
const SIZE_CHART_ITEM: MenuItem = {label: 'Size Chart', href: '/size-chart', icon: 'documentChartBar'}
const LEADERBOARD_ITEM: MenuItem = {label: 'Leaderboard', href: '/leaderboard', icon: 'trophy'}

const WHATS_NEW_ITEM: MenuItem = {label: "What's New", href: '/whats-new', icon: 'sparkles'}

const REPORT_ISSUE_ITEM: MenuItem = {
    label: 'Report issue',
    href: 'https://github.com/razethion/myoc/issues',
    icon: 'flag',
    external: true,
}

const ASK_QUESTION_ITEM: MenuItem = {
    label: 'Ask a question',
    href: 'https://github.com/razethion/myoc/discussions',
    icon: 'question',
    external: true,
}

function initialVersionNotificationState(): boolean {
    return shell.showVersionNotification
}

// Sections are ordered by how often people use them: personal pages first,
// browsing next, then help and admin, with logout last.
function viewerGroups(viewer: NonNullable<SearchPageData['shell']['viewer']>): MenuGroup[] {
    const groups: MenuGroup[] = [
        {
            title: 'Account',
            items: [
                CHARACTERS_ITEM,
                {label: 'View Profile', href: viewer.profileUrl, icon: 'user'},
                {label: 'Settings', href: '/settings', icon: 'settings'},
            ],
        },
        {
            title: 'Browse',
            items: [RECENT_UPLOADS_ITEM, SIZE_CHART_ITEM, LEADERBOARD_ITEM],
        },
        {
            title: 'Help',
            items: [WHATS_NEW_ITEM, REPORT_ISSUE_ITEM, ASK_QUESTION_ITEM],
        },
    ]

    if (viewer.canModerateImages) {
        groups.push({title: 'Moderation', items: [{label: 'Admin', href: '/admin', icon: 'shield'}]})
    }

    return groups
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

{#snippet menuIcon(name: MenuIcon)}
    <svg aria-hidden="true" class="h-5 w-5 shrink-0 opacity-70" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        {#each MENU_ICONS[name] as d}
            <path d={d} stroke-linecap="round" stroke-linejoin="round"></path>
        {/each}
    </svg>
{/snippet}

{#snippet menuItem(item: MenuItem)}
    <li>
        {#if item.external}
            <a href={item.href} rel="noreferrer" target="_blank">
                {@render menuIcon(item.icon)}
                {item.label}
            </a>
        {:else}
            <a href={item.href}>
                {@render menuIcon(item.icon)}
                {item.label}
            </a>
        {/if}
    </li>
{/snippet}

{#snippet menuGroup(group: MenuGroup)}
    <li class="my-1"><hr class="border-base-300" /></li>
    <li class="menu-title"><span>{group.title}</span></li>
    {#each group.items as item}
        {@render menuItem(item)}
    {/each}
{/snippet}

<header class="sticky top-0 z-50 border-b border-base-300 bg-base-200/95 px-4 py-2 sm:px-6">
    <div class="navbar min-h-0 p-0">
        <div class="flex-1">
            <a class="font-display text-2xl" href="/">MyOC</a>
        </div>

        <div class="mx-3 hidden w-full max-w-md flex-none md:block">{@render searchForm()}</div>
        <div class="flex-none">
            {#if viewer}
                <details class="dropdown dropdown-end">
                    <summary aria-label="Open account menu" class="btn btn-ghost btn-circle avatar">
                        <div class="w-10 rounded-full">
                            <img alt={`${viewer.username} avatar`} src={viewer.avatarUrl} />
                        </div>
                    </summary>

                    <ul class="menu dropdown-content rounded-box z-50 mt-3 w-64 border border-base-300 bg-base-200 p-2 shadow-xl">
                        <li class="pointer-events-none px-3 py-2">
                            <div class="flex min-w-0 items-center gap-3 p-0">
                                <div class="avatar">
                                    <div class="w-10 rounded-full"><img alt="" src={viewer.avatarUrl} /></div>
                                </div>
                                <div class="min-w-0">
                                    <div class="truncate text-sm font-semibold">{viewer.username}</div>
                                    <div class="truncate text-xs text-base-content/60">Signed in</div>
                                </div>
                            </div>
                        </li>
                        {#each viewerGroups(viewer) as group}
                            {@render menuGroup(group)}
                        {/each}
                        <li class="my-1"><hr class="border-base-300" /></li>
                        <li>
                            <button class="text-error" form="logout-form" type="submit">
                                {@render menuIcon('logout')}
                                Logout
                            </button>
                        </li>
                    </ul>
                    <form action="/logout" id="logout-form" method="post">
                        <input name="csrfToken" type="hidden" value={viewer.csrfToken} />
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
                        <ul class="menu dropdown-content rounded-box z-50 mt-3 w-60 border border-base-300 bg-base-200 p-2 shadow-xl">
                            <li class="menu-title"><span>Explore</span></li>
                            {#each [CHARACTERS_ITEM, RECENT_UPLOADS_ITEM, SIZE_CHART_ITEM, LEADERBOARD_ITEM] as item}
                                {@render menuItem(item)}
                            {/each}
                            {@render menuGroup({title: 'Updates', items: [WHATS_NEW_ITEM]})}
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
