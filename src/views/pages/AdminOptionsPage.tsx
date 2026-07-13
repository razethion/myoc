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
                <div class="flex flex-wrap gap-3">
                    {data.jobs.map((job, index) => (
                        <form action={`/api/admin/jobs/${job.name}/run`} method="post">
                            <input name="csrfToken" type="hidden" value={csrfToken} />
                            <button class={`btn ${index === 0 ? 'btn-primary' : 'btn-outline'}`} type="submit">
                                Run {job.label}
                            </button>
                        </form>
                    ))}
                </div>
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

function JsonSummary({summary}: {summary: AdminJobSummary}) {
    return <pre class="max-w-xl whitespace-pre-wrap break-words text-xs">{JSON.stringify(summary, null, 2)}</pre>
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
