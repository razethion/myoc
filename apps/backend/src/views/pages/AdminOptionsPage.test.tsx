import {describe, expect, it} from 'vitest'
import type {AdminJobSummary, AdminOptionsData} from '../../lib/admin/jobs'
import {AdminOptionsPage} from './AdminOptionsPage'

function renderAdminOptionsPage(data: AdminOptionsData): string {
    return AdminOptionsPage({csrfToken: 'csrf-token', data, feedback: null}).toString()
}

function renderSizeChartSummary(summary: AdminJobSummary): string {
    return renderAdminOptionsPage({
        jobs: [] as unknown as AdminOptionsData['jobs'],
        runs: [
            {
                id: 'size-chart-summary-run',
                jobName: 'size-chart-image-backfill',
                label: 'Size Chart Image Backfill',
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
    it('renders the size chart backfill action and progress', () => {
        const html = renderAdminOptionsPage({
            jobs: [{name: 'size-chart-image-backfill', label: 'Size Chart Image Backfill'}] as unknown as AdminOptionsData['jobs'],
            runs: [
                {
                    id: 'size-chart-run',
                    jobName: 'size-chart-image-backfill',
                    label: 'Size Chart Image Backfill',
                    triggerSource: 'manual',
                    triggeredByUserId: 'admin-user',
                    triggeredByUsername: 'admin_user',
                    cron: null,
                    status: 'running',
                    startedAt: '2026-09-06 12:00:00',
                    finishedAt: null,
                    durationMs: null,
                    summary: {
                        totalImages: 10,
                        processedImages: 6,
                        replacedImages: 5,
                        skippedImages: 0,
                        failedImages: 1,
                        lastError: 'One source image is missing.',
                    },
                    errorMessage: null,
                },
            ],
            errors: [],
        })

        expect(html).toContain('action="/admin/admin-options/jobs/size-chart-image-backfill/run"')
        expect(html).toContain('Run Size Chart Image Backfill')
        expect(html).toContain('6 of 10 images processed')
        expect(html).toContain('5 replaced')
        expect(html).toContain('1 failed')
        expect(html).toContain('Last error: One source image is missing.')
    })

    it('renders GIF preview backfill progress', () => {
        const html = renderAdminOptionsPage({
            jobs: [{name: 'gif-preview-backfill', label: 'GIF Preview Backfill'}] as unknown as AdminOptionsData['jobs'],
            runs: [
                {
                    id: 'gif-preview-run',
                    jobName: 'gif-preview-backfill',
                    label: 'GIF Preview Backfill',
                    triggerSource: 'manual',
                    triggeredByUserId: 'admin-user',
                    triggeredByUsername: 'admin_user',
                    cron: null,
                    status: 'running',
                    startedAt: '2026-11-19 12:00:00',
                    finishedAt: null,
                    durationMs: null,
                    summary: {
                        totalVariants: 4,
                        processedVariants: 2,
                        regeneratedPreviews: 2,
                        regeneratedBlurs: 0,
                        skippedVariants: 0,
                        failedVariants: 0,
                        lastError: null,
                    },
                    errorMessage: null,
                },
            ],
            errors: [],
        })

        expect(html).toContain('action="/admin/admin-options/jobs/gif-preview-backfill/run"')
        expect(html).toContain('Run GIF Preview Backfill')
        expect(html).toContain('2 of 4 variants processed')
        expect(html).toContain('2 previews')
    })

    it('renders a safe fallback for incomplete size chart progress', () => {
        const html = renderSizeChartSummary({status: 'building'} as unknown as AdminJobSummary)

        expect(html).toContain('&quot;status&quot;: &quot;building&quot;')
    })

    it('renders empty size chart progress without an error', () => {
        const html = renderSizeChartSummary({
            totalImages: 0,
            processedImages: 0,
            replacedImages: 0,
            skippedImages: 0,
            failedImages: 0,
            lastError: null,
        })

        expect(html).toContain('0 of 0 images processed')
        expect(html).not.toContain('Last error:')
        expect(html).not.toContain('failed</span>')
    })
})
