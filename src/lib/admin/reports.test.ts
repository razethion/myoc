import {describe, expect, it} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {getAdminReportsData} from './reports'

const mediaBaseUrl = 'https://m.myoc.art'

describe('getAdminReportsData', () => {
    it('normalizes, sorts, and limits reported image variants', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    createReportedMediaRow({
                        id: 'media-b',
                        sfw_image_key: 'sfw-key',
                        nsfw_image_key: 'nsfw-key',
                        sfw_preview_image_key: null,
                        nsfw_preview_image_key: 'nsfw-preview-key',
                        sfw_content_type: 'image/jpeg',
                        nsfw_content_type: 'image/webp',
                        sfw_review_status: 'reported',
                        nsfw_review_status: 'reported',
                        sfw_reviewed_at: '2026-06-10 12:00:00',
                        nsfw_reviewed_at: '2026-06-10 12:00:00',
                        sfw_reported_by_username: 'sfw_mod',
                        nsfw_reported_by_username: 'nsfw_mod',
                    }),
                    createReportedMediaRow({
                        id: 'media-a',
                        sfw_reviewed_at: '2026-06-10 12:00:00',
                    }),
                    createReportedMediaRow({
                        id: 'media-c',
                        sfw_image_key: null,
                        nsfw_image_key: 'nsfw-no-date-key',
                        nsfw_content_type: null,
                        sfw_review_status: 'pending',
                        nsfw_review_status: 'reported',
                        sfw_reviewed_at: null,
                        nsfw_reviewed_at: null,
                    }),
                ],
            ],
        })

        const data = await getAdminReportsData(db, mediaBaseUrl)

        expect(boundStatements[0]?.binds).toEqual([100])
        expect(data.reports.map((report) => report.id)).toEqual(['media-c:nsfw', 'media-a:sfw', 'media-b:nsfw', 'media-b:sfw'])
        expect(data.reports.find((report) => report.id === 'media-c:nsfw')).toEqual(
            expect.objectContaining({
                imageUrl: 'https://m.myoc.art/characters/owner-1/character-1/media/media-c/nsfw/nsfw-no-date-key.png',
                previewImageUrl: null,
                reportedAt: '',
            }),
        )
        expect(data.reports.find((report) => report.id === 'media-b:nsfw')).toEqual(
            expect.objectContaining({
                objectKey: 'characters/owner-1/character-1/media/media-b/nsfw/nsfw-key.webp',
                previewImageUrl: 'https://m.myoc.art/characters/owner-1/character-1/media/media-b/nsfw/preview/nsfw-preview-key.webp',
                reportedByUsername: 'nsfw_mod',
            }),
        )
        expect(data.reports.find((report) => report.id === 'media-b:sfw')).toEqual(
            expect.objectContaining({
                objectKey: 'characters/owner-1/character-1/media/media-b/sfw/sfw-key.jpg',
                previewImageUrl: null,
                reportedByUsername: 'sfw_mod',
            }),
        )
    })

    it('returns an empty report list when D1 omits results', async () => {
        const db = {
            prepare: () => ({
                bind: () => ({
                    all: async () => ({}),
                }),
            }),
        } as unknown as D1Database

        await expect(getAdminReportsData(db, mediaBaseUrl)).resolves.toEqual({reports: []})
    })
})

function createReportedMediaRow(overrides: Record<string, unknown> = {}) {
    return {
        id: 'media-1',
        user_id: 'owner-1',
        username: 'uploader',
        character_id: 'character-1',
        character_name: 'Quartz',
        sfw_image_key: 'sfw-key',
        nsfw_image_key: null,
        sfw_preview_image_key: 'sfw-preview-key',
        nsfw_preview_image_key: null,
        sfw_content_type: 'image/png',
        nsfw_content_type: null,
        sfw_review_status: 'reported',
        nsfw_review_status: 'pending',
        sfw_reviewed_at: '2026-06-10 12:00:00',
        nsfw_reviewed_at: null,
        sfw_reported_by_username: 'admin_user',
        nsfw_reported_by_username: null,
        ...overrides,
    }
}
