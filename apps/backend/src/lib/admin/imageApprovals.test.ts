import {describe, expect, it} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../../test/d1'
import {getImageApprovalData, getImageApprovalHistory, getImageApprovalPendingCount, isValidImageApprovalAction} from './imageApprovals'

const mediaBaseUrl = 'https://m.myoc.art'
const db = useTestDatabase()

describe('getImageApprovalData', () => {
    it('reuses an active reviewer lease and maps an NSFW-only approval item', async () => {
        const lease = {
            media_id: 'media-1',
            lease_expires_at: '2099-07-12 08:30:00',
        }
        await seedUser({id: 'reviewer-1', username: 'reviewer_1', role: 'moderator'})
        await seedUser({id: 'owner-1', username: 'owner_name'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: 'Character One'})
        await seedMedia({
            id: 'media-1',
            userId: 'owner-1',
            characterId: 'character-1',
            sfwImageKey: null,
            nsfwImageKey: 'nsfw-key',
            nsfwContentType: null,
            nsfwArtist: 'NSFW Artist',
            nsfwReviewStatus: 'approved',
            nsfwReviewedAt: '2026-07-12 08:00:00',
            createdAt: '2026-07-12 07:00:00',
            updatedAt: '2026-07-12 08:01:00',
        })
        await seedMedia({
            id: 'media-2',
            userId: 'owner-1',
            characterId: 'character-1',
            sfwImageKey: 'second-sfw-key',
        })
        await db
            .prepare(
                `INSERT INTO admin_image_review_queue (
                    media_id, created_at, queued_at, lease_id, leased_by_user_id, leased_at, lease_expires_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
                lease.media_id,
                '2026-07-12 07:00:00',
                '2026-07-12 07:00:00',
                'lease-1',
                'reviewer-1',
                '2026-07-12 08:00:00',
                lease.lease_expires_at,
            )
            .run()

        const data = await getImageApprovalData(db, mediaBaseUrl, 'reviewer-1')

        expect(data.pendingCount).toBe(2)
        expect(data.leaseExpiresAt).toBe(lease.lease_expires_at)
        expect(data.current).toMatchObject({
            id: 'media-1',
            user: {
                id: 'owner-1',
                profileUrl: '/u/owner_name',
            },
            character: {
                id: 'character-1',
                url: '/u/owner_name/Character%20One',
            },
            sfw: null,
            nsfw: {
                rating: 'nsfw',
                imageKey: 'nsfw-key',
                contentType: 'image/png',
                imageUrl: `${mediaBaseUrl}/characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png`,
                fullImageUrl: `${mediaBaseUrl}/characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png`,
                previewImageUrl: null,
                objectKey: 'characters/owner-1/character-1/media/media-1/nsfw/nsfw-key.png',
                homepageAllowed: false,
                needsReview: true,
            },
        })
        await expect(
            db
                .prepare(
                    `SELECT lease_id, leased_by_user_id, leased_at, lease_expires_at
                     FROM admin_image_review_queue
                     WHERE media_id = ?`,
                )
                .bind(lease.media_id)
                .first(),
        ).resolves.toEqual({
            lease_id: 'lease-1',
            leased_by_user_id: 'reviewer-1',
            leased_at: '2026-07-12 08:00:00',
            lease_expires_at: lease.lease_expires_at,
        })
    })
})

describe('getImageApprovalPendingCount', () => {
    it('returns zero when no media needs review', async () => {
        await expect(getImageApprovalPendingCount(db)).resolves.toBe(0)
    })
})

describe('getImageApprovalHistory', () => {
    it('uses page one by default when history is empty', async () => {
        const history = await getImageApprovalHistory(db)

        expect(history).toEqual({
            items: [],
            page: 1,
            pageSize: 50,
            hasPrevious: false,
            hasNext: false,
        })
    })

    it('truncates fractional page numbers and reports when more history is available', async () => {
        await seedUser({id: 'owner-1', username: 'owner'})
        await seedUser({id: 'moderator-1', username: 'mod', role: 'moderator'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: 'Character One'})
        await seedMedia({id: 'media-1', userId: 'owner-1', characterId: 'character-1'})
        await db.batch(
            Array.from({length: 101}, (_, index) => {
                const eventNumber = 100 - index
                return db
                    .prepare(
                        `INSERT INTO character_media_review_events (
                            id, media_id, image_rating, action, homepage_allowed, moderator_id, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    )
                    .bind(
                        `event-${eventNumber.toString().padStart(3, '0')}`,
                        'media-1',
                        'sfw',
                        'approve_sfw_homepage',
                        Number(eventNumber === 50),
                        'moderator-1',
                        '2026-07-12 08:00:00',
                    )
            }),
        )

        const history = await getImageApprovalHistory(db, 2.9)

        expect(history.page).toBe(2)
        expect(history.items).toHaveLength(50)
        expect(history.items[0]).toMatchObject({
            id: 'event-050',
            mediaId: 'media-1',
            homepageAllowed: true,
        })
        expect(history.hasPrevious).toBe(true)
        expect(history.hasNext).toBe(true)
    })
})

describe('isValidImageApprovalAction', () => {
    it.each([
        'approve_sfw_homepage',
        'approve_sfw_no_homepage',
        'mark_nsfw',
        'report_sfw',
        'approve_nsfw',
        'mark_sfw_homepage',
        'mark_sfw_no_homepage',
        'report_nsfw',
    ])('accepts %s', (action) => {
        expect(isValidImageApprovalAction(action)).toBe(true)
    })

    it.each(['approve_everything', '', null, 42])('rejects %s', (action) => {
        expect(isValidImageApprovalAction(action)).toBe(false)
    })
})
