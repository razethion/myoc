import {describe, expect, it} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {getAdminReportsData} from './reports'

const mediaBaseUrl = 'https://m.myoc.art'
const db = useTestDatabase()

describe('getAdminReportsData', () => {
    it('normalizes and sorts reported variants with incomplete legacy metadata', async () => {
        await seedUser({id: 'owner-1', username: 'uploader'})
        await seedUser({id: 'sfw-moderator', username: 'sfw_mod', role: 'moderator'})
        await seedUser({id: 'nsfw-moderator', username: 'nsfw_mod', role: 'moderator'})
        await seedUser({id: 'admin-moderator', username: 'admin_user', role: 'admin'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: 'Quartz'})
        await seedMedia({
            id: 'media-b',
            userId: 'owner-1',
            characterId: 'character-1',
            sfwImageKey: 'sfw-key',
            nsfwImageKey: 'nsfw-key',
            sfwContentType: 'image/jpeg',
            nsfwContentType: 'image/webp',
            nsfwPreviewImageKey: 'nsfw-preview-key',
            nsfwPreviewWidth: 800,
            nsfwPreviewHeight: 600,
            nsfwPreviewByteSize: 512,
            sfwReviewStatus: 'reported',
            nsfwReviewStatus: 'reported',
            sfwReviewedAt: '2026-06-10 12:00:00',
            nsfwReviewedAt: '2026-06-10 12:00:00',
        })
        await seedMedia({
            id: 'media-a',
            userId: 'owner-1',
            characterId: 'character-1',
            sfwImageKey: 'sfw-key',
            sfwPreviewImageKey: 'sfw-preview-key',
            sfwPreviewWidth: 800,
            sfwPreviewHeight: 600,
            sfwPreviewByteSize: 512,
            sfwReviewStatus: 'reported',
            sfwReviewedAt: '2026-06-10 12:00:00',
        })
        await seedMedia({
            id: 'media-c',
            userId: 'owner-1',
            characterId: 'character-1',
            sfwImageKey: null,
            nsfwImageKey: 'nsfw-no-date-key',
            nsfwContentType: null,
            nsfwReviewStatus: 'reported',
        })
        await db.batch([
            reviewEvent('event-b-sfw', 'media-b', 'sfw', 'report_sfw', 'sfw-moderator'),
            reviewEvent('event-b-nsfw', 'media-b', 'nsfw', 'report_nsfw', 'nsfw-moderator'),
            reviewEvent('event-a-sfw', 'media-a', 'sfw', 'report_sfw', 'admin-moderator'),
        ])

        const data = await getAdminReportsData(db, mediaBaseUrl)

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

    it('returns at most 100 reported image variants in stable order', async () => {
        await seedUser({id: 'owner-1', username: 'uploader'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: 'Quartz'})
        const statement = db.prepare(
            `INSERT INTO character_media (
                id,
                user_id,
                character_id,
                sfw_image_key,
                sfw_width,
                sfw_height,
                sfw_byte_size,
                sfw_review_status,
                sfw_reviewed_at,
                sfw_content_type
            ) VALUES (?, 'owner-1', 'character-1', ?, 1, 1, 1, 'reported', '2026-06-10 12:00:00', 'image/png')`,
        )
        const inserts = Array.from({length: 101}, (_, index) => {
            const id = `media-${index.toString().padStart(3, '0')}`
            return statement.bind(id, `${id}-key`)
        })
        await db.batch(inserts.slice(0, 100))
        await db.batch(inserts.slice(100))

        const data = await getAdminReportsData(db, mediaBaseUrl)

        expect(data.reports).toHaveLength(100)
        expect(data.reports.at(0)?.id).toBe('media-000:sfw')
        expect(data.reports.at(-1)?.id).toBe('media-099:sfw')
    })

    it('returns an empty report list when no media is reported', async () => {
        await expect(getAdminReportsData(db, mediaBaseUrl)).resolves.toEqual({reports: []})
    })
})

function reviewEvent(id: string, mediaId: string, rating: 'sfw' | 'nsfw', action: string, moderatorId: string) {
    return db
        .prepare(
            `INSERT INTO character_media_review_events (
                id, media_id, image_rating, action, homepage_allowed, moderator_id, created_at
            ) VALUES (?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(id, mediaId, rating, action, moderatorId, '2026-06-10 12:00:00')
}
