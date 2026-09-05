import {describe, expect, it} from 'vitest'
import type {AdminOptionsData} from '../../lib/admin/jobs'
import {AdminOptionsPage} from './AdminOptionsPage'

function renderAdminOptionsPage(data: AdminOptionsData): string {
    return AdminOptionsPage({csrfToken: 'csrf-token', data, feedback: null}).toString()
}

describe('AdminOptionsPage', () => {
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
