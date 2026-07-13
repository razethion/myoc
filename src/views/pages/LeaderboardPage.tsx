import type {Child} from 'hono/jsx'
import type {CurrentUser} from '../../lib/auth/session'
import type {
    LeaderboardCharacterDataEntry,
    LeaderboardSnapshot,
    LeaderboardUserCharacterEntry,
    LeaderboardUserDataEntry,
    LeaderboardUserImageEntry,
} from '../../lib/leaderboard'
import {characterProfileImageUrl, profilePhotoUrl} from '../../lib/media/url'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type LeaderboardPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
    snapshot: LeaderboardSnapshot | null
}

const LEADERBOARD_TITLE = 'Leaderboard | MyOC'
const BYTES_PER_KB = 1024
const BYTES_PER_MB = BYTES_PER_KB * 1024
const BYTES_PER_GB = BYTES_PER_MB * 1024

export function LeaderboardPage({currentUser, guestInitial, mediaBaseUrl, snapshot}: LeaderboardPageProps) {
    return (
        <BaseLayout title={LEADERBOARD_TITLE}>
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />
            <main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
                <header class="border-b border-base-300 pb-6">
                    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                        <div>
                            <p class="text-sm font-semibold uppercase text-primary">Leaderboard</p>
                            <h1 class="mt-2 text-4xl font-bold sm:text-5xl">Daily rankings</h1>
                            <p>This is just for fun, and not meant to shame or target anyone! MyOC is free to use.</p>
                        </div>
                        {snapshot ? (
                            <div class="flex flex-wrap gap-2">
                                <span class="badge badge-outline badge-lg">Updated {formatGeneratedAt(snapshot.generatedAt)}</span>
                            </div>
                        ) : null}
                    </div>
                </header>

                {snapshot ? <LeaderboardContent mediaBaseUrl={mediaBaseUrl} snapshot={snapshot} /> : <EmptyLeaderboard />}
            </main>
        </BaseLayout>
    )
}

function LeaderboardContent({mediaBaseUrl, snapshot}: {mediaBaseUrl: string; snapshot: LeaderboardSnapshot}) {
    return (
        <>
            <div class="mt-6 grid gap-4 sm:grid-cols-2">
                <div class="stats w-full border border-base-300 bg-base-200">
                    <div class="stat">
                        <div class="stat-title">Total data stored</div>
                        <div class="stat-value text-3xl">{formatBytes(snapshot.totalManagedBytes)}</div>
                        <div class="stat-desc">
                            {formatCurrency(monthlyStorageCost(snapshot.totalManagedBytes, snapshot.costPerGbMonthUsd))}/mo
                        </div>
                    </div>
                </div>
                <div class="stats w-full border border-base-300 bg-base-200">
                    <div class="stat">
                        <div class="stat-title">Total characters</div>
                        <div class="stat-value text-3xl">{snapshot.totalCharacters.toLocaleString('en-US')}</div>
                        <div class="stat-desc">created profiles</div>
                    </div>
                </div>
                <div class="stats w-full border border-base-300 bg-base-200">
                    <div class="stat">
                        <div class="stat-title">Total users</div>
                        <div class="stat-value text-3xl">{snapshot.totalUsers.toLocaleString('en-US')}</div>
                        <div class="stat-desc">registered accounts</div>
                    </div>
                </div>
                <div class="stats w-full border border-base-300 bg-base-200">
                    <div class="stat">
                        <div class="stat-title">Total images</div>
                        <div class="stat-value text-3xl">{snapshot.totalImages.toLocaleString('en-US')}</div>
                        <div class="stat-desc">uploaded character images</div>
                    </div>
                </div>
            </div>

            <div class="mt-8 grid gap-8 xl:grid-cols-2">
                <MetricSection title="Users with the most characters">
                    <UserCharacterTable items={snapshot.usersByCharacters} mediaBaseUrl={mediaBaseUrl} />
                </MetricSection>
                <MetricSection title="Users with the most images">
                    <UserImageTable items={snapshot.usersByImages} mediaBaseUrl={mediaBaseUrl} />
                </MetricSection>
                <MetricSection title="Users consuming the most data">
                    <UserDataTable items={snapshot.usersByData} mediaBaseUrl={mediaBaseUrl} />
                </MetricSection>
                <MetricSection title="Characters with the most data uploaded">
                    <CharacterDataTable items={snapshot.charactersByData} mediaBaseUrl={mediaBaseUrl} />
                </MetricSection>
            </div>
        </>
    )
}

function MetricSection({children, title}: {children: Child; title: string}) {
    return (
        <section class="overflow-hidden rounded border border-base-300 bg-base-200">
            <div class="border-b border-base-300 px-4 py-3">
                <h2 class="text-xl font-bold">{title}</h2>
            </div>
            {children}
        </section>
    )
}

function UserCharacterTable({items, mediaBaseUrl}: {items: LeaderboardUserCharacterEntry[]; mediaBaseUrl: string}) {
    return (
        <LeaderboardTable emptyLabel="No character rankings yet.">
            {items.map((item) => (
                <tr>
                    <th class="w-12">{item.rank}</th>
                    <td>
                        <UserCell mediaBaseUrl={mediaBaseUrl} user={item} />
                    </td>
                    <td class="text-right font-semibold">{item.characterCount.toLocaleString('en-US')}</td>
                </tr>
            ))}
        </LeaderboardTable>
    )
}

function UserImageTable({items, mediaBaseUrl}: {items: LeaderboardUserImageEntry[]; mediaBaseUrl: string}) {
    return (
        <LeaderboardTable emptyLabel="No image rankings yet.">
            {items.map((item) => (
                <tr>
                    <th class="w-12">{item.rank}</th>
                    <td>
                        <UserCell mediaBaseUrl={mediaBaseUrl} user={item} />
                    </td>
                    <td class="text-right font-semibold">{item.imageCount.toLocaleString('en-US')}</td>
                </tr>
            ))}
        </LeaderboardTable>
    )
}

function UserDataTable({items, mediaBaseUrl}: {items: LeaderboardUserDataEntry[]; mediaBaseUrl: string}) {
    return (
        <StorageTable emptyLabel="No user storage rankings yet.">
            {items.map((item) => (
                <tr>
                    <th class="w-12">{item.rank}</th>
                    <td>
                        <UserCell mediaBaseUrl={mediaBaseUrl} user={item} />
                    </td>
                    <td class="text-right font-semibold">{formatBytes(item.bytes)}</td>
                    <td class="text-right">{formatCurrency(item.monthlyStorageCostUsd)}/mo</td>
                </tr>
            ))}
        </StorageTable>
    )
}

function CharacterDataTable({items, mediaBaseUrl}: {items: LeaderboardCharacterDataEntry[]; mediaBaseUrl: string}) {
    return (
        <StorageTable emptyLabel="No character storage rankings yet.">
            {items.map((item) => (
                <tr>
                    <th class="w-12">{item.rank}</th>
                    <td>
                        <CharacterCell character={item} mediaBaseUrl={mediaBaseUrl} />
                    </td>
                    <td class="text-right font-semibold">{formatBytes(item.bytes)}</td>
                    <td class="text-right">{formatCurrency(item.monthlyStorageCostUsd)}/mo</td>
                </tr>
            ))}
        </StorageTable>
    )
}

function LeaderboardTable({children, emptyLabel}: {children: Child[]; emptyLabel: string}) {
    if (children.length === 0) {
        return <EmptyMetric label={emptyLabel} />
    }

    return (
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>User</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    )
}

function StorageTable({children, emptyLabel}: {children: Child[]; emptyLabel: string}) {
    if (children.length === 0) {
        return <EmptyMetric label={emptyLabel} />
    }

    return (
        <div class="overflow-x-auto">
            <table class="table table-sm">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th class="text-right">Data</th>
                        <th class="text-right">Storage Cost</th>
                    </tr>
                </thead>
                <tbody>{children}</tbody>
            </table>
        </div>
    )
}

function UserCell({mediaBaseUrl, user}: {mediaBaseUrl: string; user: {userId: string; username: string; profilePhotoKey: string | null}}) {
    const avatarUrl = user.profilePhotoKey
        ? profilePhotoUrl(mediaBaseUrl, user.userId, user.profilePhotoKey)
        : fallbackAvatarUrl(user.username)

    return (
        <a class="flex min-w-48 items-center gap-3" href={`/u/${encodeURIComponent(user.username)}`}>
            <div class="avatar">
                <div class="h-10 w-10 rounded">
                    <img alt={`${user.username} avatar`} src={avatarUrl} />
                </div>
            </div>
            <span class="font-semibold">{user.username}</span>
        </a>
    )
}

function CharacterCell({character, mediaBaseUrl}: {character: LeaderboardCharacterDataEntry; mediaBaseUrl: string}) {
    return (
        <a
            class="flex min-w-56 items-center gap-3"
            href={`/u/${encodeURIComponent(character.ownerUsername)}/${encodeURIComponent(character.name)}`}
        >
            <div class="avatar">
                <div class="h-10 w-10 rounded">
                    <img
                        alt={`${character.name} character thumbnail`}
                        src={characterProfileImageUrl(mediaBaseUrl, character.userId, character.characterId, character.profileImageKey)}
                    />
                </div>
            </div>
            <span class="min-w-0">
                <span class="block truncate font-semibold">{character.name}</span>
                <span class="block truncate text-xs text-base-content/60">by {character.ownerUsername}</span>
            </span>
        </a>
    )
}

function EmptyMetric({label}: {label: string}) {
    return (
        <div class="p-6 text-center text-sm text-base-content/60">
            <p>{label}</p>
        </div>
    )
}

function EmptyLeaderboard() {
    return (
        <section class="mt-8 rounded border border-dashed border-base-300 bg-base-200 p-8 text-center text-base-content/70">
            <h2 class="text-xl font-bold text-base-content">No leaderboard snapshot</h2>
            <p class="mt-2 text-sm">Run the Leaderboard Refresh admin job or wait for the next daily refresh.</p>
        </section>
    )
}

function fallbackAvatarUrl(name: string): string {
    const initial = name.trim().charAt(0).toUpperCase() || 'M'
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(initial)}&background=ccc&color=000`
}

function formatGeneratedAt(value: string): string {
    const date = new Date(value)

    if (Number.isNaN(date.getTime())) {
        return value
    }

    return `${date.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
    })} UTC`
}

function monthlyStorageCost(bytes: number, costPerGbMonthUsd: number): number {
    return (Math.max(0, bytes) / BYTES_PER_GB) * costPerGbMonthUsd
}

function formatCurrency(value: number): string {
    if (!Number.isFinite(value)) {
        return '$0.00'
    }

    return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`
}

function formatBytes(bytes: number): string {
    const safeBytes = Math.max(0, bytes)

    if (safeBytes >= BYTES_PER_GB) {
        return `${(safeBytes / BYTES_PER_GB).toFixed(2)} GB`
    }

    if (safeBytes >= BYTES_PER_MB) {
        return `${(safeBytes / BYTES_PER_MB).toFixed(1)} MB`
    }

    if (safeBytes > 0) {
        return `${(safeBytes / BYTES_PER_KB).toFixed(1)} KB`
    }

    return '0 MB'
}
