import type {CurrentUser} from '../../lib/auth/session'
import type {SearchCharacterResult, SearchResults, SearchUserResult} from '../../lib/search'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type SearchPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    results: SearchResults
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

function UserResultCard({user}: { user: SearchUserResult }) {
    return (
        <a class="group flex items-center gap-3 rounded border border-base-300 bg-base-200 p-3 transition hover:border-primary hover:bg-base-300"
           href={user.profileUrl}>
            <img alt={`${user.username} avatar`} class="h-16 w-16 rounded object-cover"
                 src={user.profilePhotoUrl}/>
            <div class="min-w-0 flex-1">
                <h3 class="truncate text-lg font-bold leading-tight">{user.username}</h3>
                {user.bio ? <p class="mt-1 line-clamp-2 text-sm text-base-content/70">{user.bio}</p> : null}
                <div class="mt-2 flex flex-wrap gap-2">
                    <span class="badge badge-outline">{pluralize(user.characterCount, 'character')}</span>
                </div>
            </div>
        </a>
    )
}

function CharacterResultCard({character}: { character: SearchCharacterResult }) {
    return (
        <a aria-label={`View ${character.name}`} class="group block" href={character.characterUrl}>
            <figure>
                <img alt={`${character.name} character thumbnail`}
                     class="aspect-square w-full rounded object-cover transition group-hover:brightness-110"
                     src={character.profileImageUrl}/>
                <figcaption class="mt-2">
                    <p class="truncate text-center font-bold">{character.name}</p>
                    <p class="truncate text-center text-sm opacity-60">by {character.ownerUsername}</p>
                </figcaption>
            </figure>
        </a>
    )
}

function SearchPageScript({results}: { results: SearchResults }) {
    const queryJson = safeScriptJson(results.query)
    const script = `
        const searchQuery = ${queryJson};
        const loadMoreState = {
            users: {
                nextOffset: ${JSON.stringify(results.users.nextOffset)},
                hasMore: ${JSON.stringify(results.users.hasMore)},
                inFlight: false,
            },
            characters: {
                nextOffset: ${JSON.stringify(results.characters.nextOffset)},
                hasMore: ${JSON.stringify(results.characters.hasMore)},
                inFlight: false,
            },
        };

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        }

        function pluralizeClient(count, singular, plural) {
            return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
        }

        function showSearchAlert(message) {
            const alert = document.querySelector('[data-search-alert]');
            const messageTarget = document.querySelector('[data-search-alert-message]');
            if (!alert || !messageTarget) return;
            messageTarget.textContent = message;
            alert.classList.remove('hidden');
        }

        function renderUser(user) {
            return '<a class="group flex items-center gap-3 rounded border border-base-300 bg-base-200 p-3 transition hover:border-primary hover:bg-base-300" href="' + escapeHtml(user.profileUrl) + '">' +
                '<img alt="' + escapeHtml(user.username) + ' profile photo" class="h-16 w-16 rounded object-cover" src="' + escapeHtml(user.profilePhotoUrl) + '"/>' +
                '<div class="min-w-0 flex-1">' +
                '<h3 class="truncate text-lg font-bold leading-tight">' + escapeHtml(user.username) + '</h3>' +
                (user.bio ? '<p class="mt-1 line-clamp-2 text-sm text-base-content/70">' + escapeHtml(user.bio) + '</p>' : '') +
                '<div class="mt-2 flex flex-wrap gap-2"><span class="badge badge-outline">' + escapeHtml(pluralizeClient(Number(user.characterCount || 0), 'character')) + '</span></div>' +
                '</div></a>';
        }

        function renderCharacter(character) {
            return '<a aria-label="View ' + escapeHtml(character.name) + '" class="group block" href="' + escapeHtml(character.characterUrl) + '">' +
                '<figure>' +
                '<img alt="' + escapeHtml(character.name) + ' character thumbnail" class="aspect-square w-full rounded object-cover transition group-hover:brightness-110" src="' + escapeHtml(character.profileImageUrl) + '"/>' +
                '<figcaption class="mt-2">' +
                '<p class="truncate text-center font-bold">' + escapeHtml(character.name) + '</p>' +
                '<p class="truncate text-center text-sm opacity-60">by ' + escapeHtml(character.ownerUsername) + '</p>' +
                '</figcaption></figure></a>';
        }

        function updateLoadMoreButton(type, button) {
            const state = loadMoreState[type];
            if (!state || !state.hasMore || state.nextOffset === null) {
                button.classList.add('hidden');
                button.disabled = true;
                return;
            }

            button.classList.remove('hidden');
            button.disabled = false;
        }

        document.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-load-more]');
            if (!button) return;

            const type = button.dataset.loadMore;
            const state = loadMoreState[type];
            const container = document.querySelector('[data-results-list="' + type + '"]');
            if (!state || !container || state.inFlight || !state.hasMore || state.nextOffset === null) return;

            state.inFlight = true;
            const originalLabel = button.textContent;
            button.disabled = true;
            button.textContent = 'Loading...';

            try {
                const params = new URLSearchParams({
                    type,
                    q: searchQuery,
                    offset: String(state.nextOffset),
                });
                const response = await fetch('/api/search?' + params.toString(), {
                    headers: { accept: 'application/json' },
                });
                const body = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(body.error || 'Could not load more results.');
                }

                const items = Array.isArray(body.items) ? body.items : [];

                if (body.query !== searchQuery) {
                    throw new Error('Search results changed. Refresh and try again.');
                }

                if (items.length === 0 && body.hasMore) {
                    throw new Error('Search pagination returned no results.');
                }

                container.insertAdjacentHTML('beforeend', items.map(type === 'users' ? renderUser : renderCharacter).join(''));
                state.nextOffset = body.nextOffset ?? null;
                state.hasMore = Boolean(body.hasMore && state.nextOffset !== null);
                updateLoadMoreButton(type, button);
            } catch (error) {
                showSearchAlert(error instanceof Error ? error.message : 'Could not load more results.');
                button.disabled = false;
            } finally {
                state.inFlight = false;
                button.textContent = originalLabel;
                updateLoadMoreButton(type, button);
            }
        });
    `

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

function safeScriptJson(value: string): string {
    return JSON.stringify(value)
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

export function SearchPage({currentUser, guestInitial, mediaBaseUrl, results}: SearchPageProps) {
    const hasQuery = results.query.length > 0

    return (
        <BaseLayout title={hasQuery ? `Search: ${results.query} | MyOC` : 'Search | MyOC'}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>
            <main class="container mx-auto px-3 py-4 sm:px-0">
                <section class="mb-6">
                    <div class="flex flex-col gap-4 border-b border-base-300 pb-5 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p class="text-sm font-semibold uppercase tracking-widest text-primary">Search</p>
                            <h1 class="mt-1 text-4xl font-bold sm:text-5xl">
                                {hasQuery ? <>Results for &quot;{results.query}&quot;</> : 'Search MyOC'}
                            </h1>
                            <p class="mt-2 max-w-2xl text-sm opacity-70 sm:text-base">
                                Browse matching profiles and character pages.
                            </p>
                        </div>

                        <div class="flex flex-wrap gap-2">
                            <span class="badge badge-primary badge-lg">{pluralize(results.users.total, 'user')}</span>
                            <span class="badge badge-secondary badge-lg">{pluralize(results.characters.total, 'character')}</span>
                        </div>
                    </div>

                    <form action="/search" class="mt-5 flex flex-col gap-3 sm:flex-row" method="get">
                        <label class="input input-bordered flex-1">
                            <svg aria-hidden="true" class="h-4 w-4 opacity-60" fill="none" stroke="currentColor"
                                 viewBox="0 0 24 24"
                                 xmlns="http://www.w3.org/2000/svg">
                                <path d="M21 21l-4.35-4.35M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14z"
                                      stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                            </svg>
                            <input class="grow" maxLength={80} name="q" placeholder="Search characters, artists, tags..."
                                   type="search" value={results.query}/>
                        </label>
                        <button class="btn btn-primary" type="submit">Search</button>
                    </form>

                    {results.wasTruncated ? (
                        <div class="alert alert-warning mt-4">
                            <span>Search query was shortened to {80} characters.</span>
                        </div>
                    ) : null}

                    <div class="alert alert-error mt-4 hidden" data-search-alert>
                        <span data-search-alert-message></span>
                    </div>
                </section>

                {!hasQuery ? (
                    <section class="rounded-box border border-base-300 bg-base-200 p-8 text-center text-base-content/70">
                        <p>Enter a username or character name to start searching.</p>
                    </section>
                ) : (
                    <section class="grid gap-8 lg:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.6fr)]">
                        <section aria-labelledby="users-heading">
                            <div class="mb-3 flex items-center justify-between gap-3">
                                <h2 id="users-heading" class="text-2xl font-bold">Users</h2>
                            </div>

                            <div class="grid gap-3" data-results-list="users">
                                {results.users.items.map((user) => <UserResultCard user={user}/>)}
                            </div>

                            {results.users.items.length === 0 ? (
                                <div class="rounded border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">
                                    No matching users.
                                </div>
                            ) : null}

                            <div class="mt-4 flex justify-center">
                                <button class={`btn btn-outline ${results.users.hasMore ? '' : 'hidden'}`} data-load-more="users"
                                        type="button">Load more users</button>
                            </div>
                        </section>

                        <section aria-labelledby="characters-heading">
                            <div class="mb-3 flex items-center justify-between gap-3">
                                <h2 id="characters-heading" class="text-2xl font-bold">Characters</h2>
                            </div>

                            <div class="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4" data-results-list="characters">
                                {results.characters.items.map((character) => <CharacterResultCard character={character}/>)}
                            </div>

                            {results.characters.items.length === 0 ? (
                                <div class="rounded border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">
                                    No matching characters.
                                </div>
                            ) : null}

                            <div class="mt-6 flex justify-center">
                                <button class={`btn btn-outline ${results.characters.hasMore ? '' : 'hidden'}`}
                                        data-load-more="characters" type="button">Load more characters</button>
                            </div>
                        </section>
                    </section>
                )}
            </main>
            <SearchPageScript results={results}/>
        </BaseLayout>
    )
}
