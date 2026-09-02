<script lang="ts">
import type {SearchCharacterResult, SearchResults, SearchUserResult} from '@myoc/contracts/search'

type SearchType = 'users' | 'characters'

type SearchPageResponse<T> = {
    items: T[]
    nextOffset: number | null
    hasMore: boolean
}

let {results}: {results: SearchResults} = $props()
const initialUsers = getInitialUsers()
const initialCharacters = getInitialCharacters()
let userItems = $state([...initialUsers.items])
let characterItems = $state([...initialCharacters.items])
let userPagination = $state({
    nextOffset: initialUsers.nextOffset,
    hasMore: initialUsers.hasMore,
    loading: false,
})
let characterPagination = $state({
    nextOffset: initialCharacters.nextOffset,
    hasMore: initialCharacters.hasMore,
    loading: false,
})
let errorMessage = $state('')

const hasQuery = $derived(results.query.length > 0)

function getInitialUsers() {
    return results.users
}

function getInitialCharacters() {
    return results.characters
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

async function fetchSearchPage<T>(type: SearchType, offset: number): Promise<SearchPageResponse<T>> {
    const params = new URLSearchParams({
        type,
        q: results.query,
        offset: String(offset),
    })
    const response = await fetch(`/api/search?${params.toString()}`, {
        headers: {accept: 'application/json'},
    })
    const body: unknown = await response.json().catch(() => ({}))

    if (!isRecord(body)) {
        throw new Error('Could not load more results.')
    }

    if (!response.ok) {
        throw new Error(typeof body.error === 'string' ? body.error : 'Could not load more results.')
    }

    if (body.query !== results.query) {
        throw new Error('Search results changed. Refresh and try again.')
    }

    if (!Array.isArray(body.items)) {
        throw new Error('Search returned invalid results.')
    }

    if (body.items.length === 0 && body.hasMore === true) {
        throw new Error('Search pagination returned no results.')
    }

    const nextOffset = typeof body.nextOffset === 'number' && Number.isFinite(body.nextOffset) ? body.nextOffset : null

    return {
        items: body.items as T[],
        nextOffset,
        hasMore: body.hasMore === true && nextOffset !== null,
    }
}

async function loadMoreUsers(): Promise<void> {
    if (userPagination.loading || !userPagination.hasMore || userPagination.nextOffset === null) {
        return
    }

    userPagination.loading = true
    errorMessage = ''

    try {
        const page = await fetchSearchPage<SearchUserResult>('users', userPagination.nextOffset)
        userItems.push(...page.items)
        userPagination.nextOffset = page.nextOffset
        userPagination.hasMore = page.hasMore
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Could not load more results.'
    } finally {
        userPagination.loading = false
    }
}

async function loadMoreCharacters(): Promise<void> {
    if (characterPagination.loading || !characterPagination.hasMore || characterPagination.nextOffset === null) {
        return
    }

    characterPagination.loading = true
    errorMessage = ''

    try {
        const page = await fetchSearchPage<SearchCharacterResult>('characters', characterPagination.nextOffset)
        characterItems.push(...page.items)
        characterPagination.nextOffset = page.nextOffset
        characterPagination.hasMore = page.hasMore
    } catch (error) {
        errorMessage = error instanceof Error ? error.message : 'Could not load more results.'
    } finally {
        characterPagination.loading = false
    }
}
</script>

<main class="container mx-auto px-3 py-4 sm:px-0">
    <section class="mb-6">
        <div class="flex flex-col gap-4 border-b border-base-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
                <p class="text-sm font-semibold uppercase tracking-widest text-primary">Search</p>
                <h1 class="mt-1 text-4xl font-bold sm:text-5xl">
                    {hasQuery ? `Results for "${results.query}"` : 'Search MyOC'}
                </h1>
                <p class="mt-2 max-w-2xl text-sm opacity-70 sm:text-base">Browse matching profiles and character pages.</p>
            </div>

            <div class="flex flex-wrap gap-2">
                <span class="badge badge-primary badge-lg">{pluralize(results.users.total, 'user')}</span>
                <span class="badge badge-secondary badge-lg">{pluralize(results.characters.total, 'character')}</span>
            </div>
        </div>

        <form action="/search" class="mt-5 flex flex-col gap-3 sm:flex-row" method="get">
            <label class="input input-bordered flex-1">
                <svg aria-hidden="true" class="h-4 w-4 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></path>
                </svg>
                <input class="grow" maxlength="80" name="q" placeholder="Search characters, artists, tags..." type="search" value={results.query} />
            </label>
            <button class="btn btn-primary" type="submit">Search</button>
        </form>

        {#if results.wasTruncated}
            <div class="alert alert-warning mt-4" role="alert"><span>Search query was shortened to 80 characters.</span></div>
        {/if}

        {#if errorMessage}
            <div class="alert alert-error mt-4" role="alert"><span>{errorMessage}</span></div>
        {/if}
    </section>

    {#if !hasQuery}
        <section class="rounded-box border border-base-300 bg-base-200 p-8 text-center text-base-content/70">
            <p>Enter a username or character name to start searching.</p>
        </section>
    {:else}
        <section class="grid gap-8 lg:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.6fr)]">
            <section aria-labelledby="users-heading">
                <div class="mb-3 flex items-center justify-between gap-3"><h2 class="text-2xl font-bold" id="users-heading">Users</h2></div>

                <div class="grid gap-3">
                    {#each userItems as user (user.id)}
                        <a class="group flex items-center gap-3 rounded border border-base-300 bg-base-200 p-3 transition hover:border-primary hover:bg-base-300" href={user.profileUrl}>
                            <img alt={`${user.username} avatar`} class="h-16 w-16 rounded object-cover" src={user.profilePhotoUrl} />
                            <div class="min-w-0 flex-1">
                                <h3 class="truncate text-lg font-bold leading-tight">{user.username}</h3>
                                {#if user.bio}<p class="mt-1 line-clamp-2 text-sm text-base-content/70">{user.bio}</p>{/if}
                                <div class="mt-2 flex flex-wrap gap-2"><span class="badge badge-outline">{pluralize(user.characterCount, 'character')}</span></div>
                            </div>
                        </a>
                    {/each}
                </div>

                {#if userItems.length === 0}
                    <div class="rounded border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">No matching users.</div>
                {/if}

                {#if userPagination.hasMore}
                    <div class="mt-4 flex justify-center">
                        <button class="btn btn-outline" disabled={userPagination.loading} onclick={loadMoreUsers} type="button">
                            {#if userPagination.loading}<span aria-hidden="true" class="loading loading-spinner loading-sm"></span> Loading...{:else}Load more users{/if}
                        </button>
                    </div>
                {/if}
            </section>

            <section aria-labelledby="characters-heading">
                <div class="mb-3 flex items-center justify-between gap-3"><h2 class="text-2xl font-bold" id="characters-heading">Characters</h2></div>

                <div class="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
                    {#each characterItems as character (character.id)}
                        <a aria-label={`View ${character.name}`} class="group block" href={character.characterUrl}>
                            <figure>
                                <img alt={`${character.name} character thumbnail`} class="aspect-square w-full rounded object-cover transition group-hover:brightness-110" src={character.profileImageUrl} />
                                <figcaption class="mt-2">
                                    <p class="truncate text-center font-bold">{character.name}</p>
                                    <p class="truncate text-center text-sm opacity-60">by {character.ownerUsername}</p>
                                </figcaption>
                            </figure>
                        </a>
                    {/each}
                </div>

                {#if characterItems.length === 0}
                    <div class="rounded border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">No matching characters.</div>
                {/if}

                {#if characterPagination.hasMore}
                    <div class="mt-6 flex justify-center">
                        <button class="btn btn-outline" disabled={characterPagination.loading} onclick={loadMoreCharacters} type="button">
                            {#if characterPagination.loading}<span aria-hidden="true" class="loading loading-spinner loading-sm"></span> Loading...{:else}Load more characters{/if}
                        </button>
                    </div>
                {/if}
            </section>
        </section>
    {/if}
</main>
