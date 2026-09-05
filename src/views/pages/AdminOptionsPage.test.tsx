import {describe, expect, it} from 'vitest'
import type {AdminJobSummary, AdminOptionsData} from '../../lib/admin/jobs'
import {AdminOptionsPage} from './AdminOptionsPage'

function renderAdminOptionsPage(data: AdminOptionsData): string {
    return AdminOptionsPage({csrfToken: 'csrf-token', data, feedback: null}).toString()
}

function renderRecentFeedSummary(summary: AdminJobSummary): string {
    return renderAdminOptionsPage({
        jobs: [] as unknown as AdminOptionsData['jobs'],
        runs: [
            {
                id: 'recent-summary-run',
                jobName: 'recent-feed-regeneration',
                label: 'Recent Page Regeneration',
                triggerSource: 'manual',
                triggeredByUserId: 'admin-user',
                triggeredByUsername: 'admin_user',
                cron: null,
                status: 'running',
                startedAt: '2026-09-05 12:00:00',
                finishedAt: null,
                durationMs: null,
                summary,
                errorMessage: null,
            },
        ],
        errors: [],
    })
}

describe('AdminOptionsPage', () => {
    it('renders the recent page action and publication progress', () => {
        const html = renderAdminOptionsPage({
            jobs: [{name: 'recent-feed-regeneration', label: 'Recent Page Regeneration'}] as unknown as AdminOptionsData['jobs'],
            runs: [
                {
                    id: 'recent-run',
                    jobName: 'recent-feed-regeneration',
                    label: 'Recent Page Regeneration',
                    triggerSource: 'manual',
                    triggeredByUserId: 'admin-user',
                    triggeredByUsername: 'admin_user',
                    cron: null,
                    status: 'running',
                    startedAt: '2026-09-05 12:00:00',
                    finishedAt: null,
                    durationMs: null,
                    summary: {
                        status: 'building',
                        bootstrapRows: 250,
                        objectsWritten: 12,
                        itemCounts: {'n0-u0': 10, 'n0-u1': 9, 'n1-u0': 8, 'n1-u1': 7},
                    },
                    errorMessage: null,
                },
            ],
            errors: [],
        })

        expect(html).toContain('action="/admin/admin-options/jobs/recent-feed-regeneration/run"')
        expect(html).toContain('Run Recent Page Regeneration')
        expect(html).toContain('Status: Building')
        expect(html).toContain('250 items processed')
        expect(html).toContain('12 feed objects written')
        expect(html).toContain('Approved SFW: 10 items')
        expect(html).toContain('All SFW: 9 items')
        expect(html).toContain('Approved including NSFW: 8 items')
        expect(html).toContain('All including NSFW: 7 items')
        expect(html).not.toContain('n0-u0')
        expect(html).not.toContain('variants processed')
    })

    it('renders recent page status without unavailable progress values', () => {
        const html = renderRecentFeedSummary({status: 'current'})

        expect(html).toContain('Status: Current')
        expect(html).not.toContain('items processed')
        expect(html).not.toContain('feed objects written')
        expect(html).not.toContain('n0-u0:')
    })

    it('uses a readable label for an unknown feed in stored progress', () => {
        const html = renderRecentFeedSummary({status: 'building', itemCounts: {'legacy-feed': 2}} as unknown as AdminJobSummary)

        expect(html).toContain('Unknown feed: 2 items')
        expect(html).not.toContain('legacy-feed')
    })

    it('renders an unexpected recent page summary as JSON', () => {
        const html = renderRecentFeedSummary({
            scanned: 1,
            recognized: 1,
            skippedUnknown: 0,
            skippedRecent: 0,
            keptReferenced: 1,
            deleted: 0,
            errors: 0,
            stoppedAtDeleteLimit: false,
            stoppedAtScanLimit: false,
        })

        expect(html).toContain('scanned')
        expect(html).not.toContain('Status:')
    })

    it('renders job and task references when present and a dash when neither reference is available', () => {
        const html = renderAdminOptionsPage({
            jobs: [] as unknown as AdminOptionsData['jobs'],
            runs: [],
            errors: [
                {
                    source: 'image-processing',
                    sourceLabel: 'Image Processing',
                    messageId: 'message-both',
                    jobId: 'job-both',
                    taskId: 'task-both',
                    errorCode: 'both_failed',
                    errorMessage: 'Both references failed.',
                    createdAt: '2026-09-05 12:00:00',
                },
                {
                    source: 'image-processing',
                    sourceLabel: 'Image Processing',
                    messageId: 'message-job',
                    jobId: 'job-only',
                    taskId: null,
                    errorCode: 'job_failed',
                    errorMessage: 'Job reference failed.',
                    createdAt: '2026-09-05 12:01:00',
                },
                {
                    source: 'media-preview-regeneration',
                    sourceLabel: 'Media Preview Regeneration',
                    messageId: 'message-task',
                    jobId: null,
                    taskId: 'task-only',
                    errorCode: 'task_failed',
                    errorMessage: 'Task reference failed.',
                    createdAt: '2026-09-05 12:02:00',
                },
                {
                    source: 'media-preview-regeneration',
                    sourceLabel: 'Media Preview Regeneration',
                    messageId: 'message-none',
                    jobId: null,
                    taskId: null,
                    errorCode: 'unknown_failure',
                    errorMessage: 'No reference failed.',
                    createdAt: '2026-09-05 12:03:00',
                },
            ],
        })

        expect(html).toContain('Job: job-both')
        expect(html).toContain('Task: task-both')
        expect(html).toContain('Job: job-only')
        expect(html).toContain('Task: task-only')
        expect(html).toContain('<span>-</span>')
        expect(html).not.toContain('Task: job-only')
        expect(html).not.toContain('Job: task-only')
    })
})
