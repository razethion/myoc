import type {AdminJobRun, AdminJobSummary, AdminOptionsData} from '../../lib/admin/jobs'

type AdminOptionsPageProps = {
    csrfToken: string
    data: AdminOptionsData
    feedback: AdminOptionsFeedback | null
}

export type AdminOptionsFeedback = {
    jobLabel: string | null
    status: 'error' | 'started' | 'success'
}

const statusBadgeClasses: Record<AdminJobRun['status'], string> = {
    error: 'badge-error',
    running: 'badge-info',
    success: 'badge-success',
}

const recentFeedVariantLabels: Record<string, string> = {
    'n0-u0': 'Approved SFW',
    'n0-u1': 'All SFW',
    'n1-u0': 'Approved including NSFW',
    'n1-u1': 'All including NSFW',
}

export function AdminOptionsPage({csrfToken, data, feedback}: AdminOptionsPageProps) {
    return (
        <div class="p-4 sm:p-6">
            <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 class="text-2xl font-bold">Admin Options</h2>
                </div>
            </div>

            {feedback ? <AdminJobFeedback feedback={feedback} /> : null}

            <section class="rounded border border-base-300 bg-base-200 p-4">
                <p class="mb-3 text-sm text-base-content/70">
                    Recent page regeneration rebuilds /recent in the background. Thumbnail regeneration and character media preview
                    regeneration run as separate background jobs. Thumbnails use saved originals. If an original is missing, the job saves
                    the current thumbnail as its source. Starting a running job again does not create a duplicate.
                </p>
                <div class="flex flex-wrap gap-3">
                    {data.jobs.map((job, index) => (
                        <form action={`/admin/admin-options/jobs/${job.name}/run`} class="flex flex-wrap items-center gap-2" method="post">
                            <input name="csrfToken" type="hidden" value={csrfToken} />
                            <button class={`btn ${index === 0 ? 'btn-primary' : 'btn-outline'}`} type="submit">
                                Run {job.label}
                            </button>
                            {job.name === 'media-preview-regeneration' ? (
                                <button
                                    class="btn btn-outline"
                                    formaction={`/admin/admin-options/jobs/${job.name}/run?onlyInvalid=true`}
                                    type="submit"
                                >
                                    Repair missing or non-AVIF previews and blurs
                                </button>
                            ) : null}
                        </form>
                    ))}
                </div>
            </section>

            <section class="mt-6">
                <h3 class="mb-3 text-xl font-bold">Error Log</h3>

                {data.errors.length > 0 ? (
                    <div class="overflow-x-auto rounded border border-base-300">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Recorded</th>
                                    <th>Source</th>
                                    <th>Code</th>
                                    <th>Message</th>
                                    <th>References</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.errors.map((entry) => (
                                    <tr>
                                        <td class="whitespace-nowrap font-mono text-xs">{formatTimestamp(entry.createdAt)}</td>
                                        <td class="whitespace-nowrap">{entry.sourceLabel}</td>
                                        <td>
                                            <span class="badge badge-error badge-sm">{entry.errorCode}</span>
                                        </td>
                                        <td class="min-w-64 max-w-xl whitespace-pre-wrap break-words text-sm text-error">
                                            {entry.errorMessage}
                                        </td>
                                        <td class="min-w-64 font-mono text-xs">
                                            {entry.jobId ? <div class="break-all">Job: {entry.jobId}</div> : null}
                                            {entry.taskId ? <div class="break-all">Task: {entry.taskId}</div> : null}
                                            {!entry.jobId && !entry.taskId ? <span>-</span> : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div class="rounded border border-dashed border-base-300 bg-base-200 p-8 text-center">
                        <h4 class="text-lg font-bold">No processing errors</h4>
                    </div>
                )}
            </section>

            <section class="mt-6">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h3 class="text-xl font-bold">Job History</h3>
                    <a class="btn btn-sm btn-outline" href="/admin/admin-options">
                        Refresh
                    </a>
                </div>

                {data.runs.length > 0 ? (
                    <div class="overflow-x-auto rounded border border-base-300">
                        <table class="table table-sm">
                            <thead>
                                <tr>
                                    <th>Started</th>
                                    <th>Job</th>
                                    <th>Source</th>
                                    <th>Status</th>
                                    <th>Duration</th>
                                    <th>Summary</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.runs.map((run) => (
                                    <tr>
                                        <td class="whitespace-nowrap font-mono text-xs">{formatTimestamp(run.startedAt)}</td>
                                        <td class="whitespace-nowrap">{run.label}</td>
                                        <td>{formatRunSource(run)}</td>
                                        <td>
                                            <span class={`badge ${statusBadgeClasses[run.status]}`}>{run.status}</span>
                                        </td>
                                        <td class="whitespace-nowrap">{formatDuration(run.durationMs)}</td>
                                        <td class="min-w-64">
                                            <RunSummary run={run} />
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div class="rounded border border-dashed border-base-300 bg-base-200 p-8 text-center">
                        <h4 class="text-lg font-bold">No job runs</h4>
                    </div>
                )}
            </section>
        </div>
    )
}

function AdminJobFeedback({feedback}: {feedback: AdminOptionsFeedback}) {
    const jobName = feedback.jobLabel ?? 'Admin job'
    const alertClass = feedback.status === 'error' ? 'alert-error' : feedback.status === 'started' ? 'alert-info' : 'alert-success'
    const message =
        feedback.status === 'error'
            ? `${jobName} failed. Check Job History for details.`
            : feedback.status === 'started'
              ? `${jobName} started. Refresh Job History to check progress.`
              : `${jobName} finished.`

    return (
        <div class={`alert mb-4 ${alertClass}`}>
            <span>{message}</span>
        </div>
    )
}

function RunSummary({run}: {run: AdminJobRun}) {
    if (run.errorMessage) {
        return <p class="max-w-xl whitespace-pre-wrap break-words text-sm text-error">{run.errorMessage}</p>
    }

    if (!run.summary) {
        return <span class="text-sm text-base-content/60">Pending</span>
    }

    if (run.jobName === 'd1-backup') {
        return <D1BackupSummary summary={run.summary} />
    }

    if (run.jobName === 'leaderboard-refresh') {
        return <LeaderboardRefreshSummary summary={run.summary} />
    }

    if (run.jobName === 'media-preview-regeneration' || run.jobName === 'thumbnail-regeneration') {
        return <MediaPreviewRegenerationSummary summary={run.summary} thumbnails={run.jobName === 'thumbnail-regeneration'} />
    }

    if (run.jobName === 'recent-feed-regeneration') {
        return <RecentFeedRegenerationSummary summary={run.summary} />
    }

    return <R2CleanupSummary summary={run.summary} />
}

function D1BackupSummary({summary}: {summary: AdminJobSummary}) {
    if (!('compressedBytes' in summary) || !('rows' in summary)) {
        return <JsonSummary summary={summary} />
    }

    return (
        <dl class="grid gap-1 text-xs">
            <div>
                <dt class="font-semibold">Object</dt>
                <dd class="break-all font-mono">{summary.key}</dd>
            </div>
            <div>
                <dt class="sr-only">Stats</dt>
                <dd class="flex flex-wrap gap-x-3 gap-y-1">
                    <span>{summary.rows} rows</span>
                    <span>{formatBytes(summary.compressedBytes)}</span>
                </dd>
            </div>
        </dl>
    )
}

function R2CleanupSummary({summary}: {summary: AdminJobSummary}) {
    if (!('scanned' in summary)) {
        return <JsonSummary summary={summary} />
    }

    return (
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{summary.scanned} scanned</span>
            <span>{summary.deleted} deleted</span>
            <span>{summary.errors} errors</span>
            {summary.stoppedAtDeleteLimit ? <span class="text-warning">delete limit reached</span> : null}
            {summary.stoppedAtScanLimit ? <span class="text-warning">scan limit reached</span> : null}
        </div>
    )
}

function LeaderboardRefreshSummary({summary}: {summary: AdminJobSummary}) {
    if (!('rankedUsersByCharacters' in summary) || !('rankedTopUsers' in summary)) {
        return <JsonSummary summary={summary} />
    }

    return (
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            <span>{summary.recognizedObjects} objects</span>
            <span>{formatBytes(summary.totalManagedBytes)}</span>
            <span>{formatCurrency(summary.totalMonthlyStorageCostUsd)}/mo</span>
            <span>{summary.rankedTopUsers} users ranked</span>
            <span>{summary.rankedCharactersByData} characters ranked</span>
        </div>
    )
}

function MediaPreviewRegenerationSummary({summary, thumbnails}: {summary: AdminJobSummary; thumbnails: boolean}) {
    if (!('totalVariants' in summary) || !('processedVariants' in summary)) {
        return <JsonSummary summary={summary} />
    }

    const progressMaximum = Math.max(1, summary.totalVariants)

    return (
        <div class="grid gap-2 text-xs">
            <progress class="progress" max={progressMaximum} value={Math.min(summary.processedVariants, progressMaximum)} />
            <div class="flex flex-wrap gap-x-3 gap-y-1">
                <span>
                    {summary.processedVariants} of {summary.totalVariants} {thumbnails ? 'thumbnails' : 'variants'} processed
                </span>
                <span>
                    {summary.regeneratedPreviews} {thumbnails ? 'thumbnails replaced' : 'previews'}
                </span>
                {thumbnails ? null : <span>{summary.regeneratedBlurs} blurs</span>}
                <span>{summary.skippedVariants} skipped</span>
                {summary.failedVariants > 0 ? <span class="text-error">{summary.failedVariants} failed</span> : null}
            </div>
            {summary.lastError ? <p class="max-w-xl whitespace-pre-wrap break-words text-error">Last error: {summary.lastError}</p> : null}
        </div>
    )
}

function RecentFeedRegenerationSummary({summary}: {summary: AdminJobSummary}) {
    if (!('status' in summary)) {
        return <JsonSummary summary={summary} />
    }

    return (
        <div class="grid gap-1 text-xs">
            <span>Status: {formatRecentFeedStatus(summary.status)}</span>
            {summary.bootstrapRows === undefined ? null : <span>{summary.bootstrapRows} items processed</span>}
            {summary.objectsWritten === undefined ? null : <span>{summary.objectsWritten} feed objects written</span>}
            {summary.itemCounts ? (
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                    {Object.entries(summary.itemCounts).map(([variant, count]) => (
                        <span>
                            {recentFeedVariantLabels[variant] ?? 'Unknown feed'}: {count} items
                        </span>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function JsonSummary({summary}: {summary: AdminJobSummary}) {
    return <pre class="max-w-xl whitespace-pre-wrap break-words text-xs">{JSON.stringify(summary, null, 2)}</pre>
}

function formatRecentFeedStatus(status: string): string {
    return `${status.slice(0, 1).toUpperCase()}${status.slice(1)}`
}

function formatCurrency(value: number): string {
    if (!Number.isFinite(value)) {
        return '$0.00'
    }

    return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`
}

function formatRunSource(run: AdminJobRun): string {
    if (run.triggerSource === 'cron') {
        return run.cron ? `Cron ${run.cron}` : 'Cron'
    }

    return run.triggeredByUsername ? `@${run.triggeredByUsername}` : 'Manual'
}

function formatTimestamp(value: string): string {
    return `${value} UTC`
}

function formatDuration(value: number | null): string {
    if (value === null) {
        return '-'
    }

    if (value < 1000) {
        return `${value} ms`
    }

    return `${(value / 1000).toFixed(1)} s`
}

function formatBytes(value: number): string {
    if (!Number.isFinite(value)) {
        return 'Unknown size'
    }

    const units = ['B', 'KB', 'MB', 'GB']
    let size = value
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024
        unitIndex += 1
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
