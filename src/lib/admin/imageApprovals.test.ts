import {describe, expect, it, vi} from 'vitest'
import {createMockDb, sqlFragment} from '../../test/mockD1'
import {getImageApprovalData, getImageApprovalHistory, getImageApprovalPendingCount, isValidImageApprovalAction} from './imageApprovals'

const mediaBaseUrl = 'https://m.myoc.art'

describe('getImageApprovalData', () => {
    it('reuses an active reviewer lease and maps an NSFW-only approval item', async () => {
        const lease = {
            media_id: 'media-1',
            lease_expires_at: '2026-07-12 08:30:00',
        }
        const {db, boundStatements} = createMockDb({
            firstResults: [
                lease,
                {count: 2},
                createApprovalRow({
                    sfw_image_key: null,
                    sfw_preview_image_key: null,
                    nsfw_image_key: 'nsfw-key',
                    nsfw_preview_image_key: null,
                    nsfw_content_type: null,
                    nsfw_review_status: 'approved',
                    nsfw_reviewed_at: '2026-07-12 08:00:00',
                    updated_at: '2026-07-12 07:59:00',
                }),
            ],
        })

        const data = await getImageApprovalData(db, mediaBaseUrl, 'reviewer-1')

        expect(data.pendingCount).toBe(2)
        expect(data.leaseExpiresAt).toBe(lease.lease_expires_at)
        expect(data.current).toMatchObject({
            id: 'media-1',
            user: {
                id: 'owner-1',
                profileUrl: '/u/owner%20name',
            },
            character: {
                id: 'character-1',
                url: '/u/owner%20name/Character%20One',
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
                needsReview: false,
            },
        })
        expect(boundStatements.some((statement) => normalizedSql(statement.sql).includes('SET lease_id = ?'))).toBe(false)
    })

    it('releases a newly acquired lease when the leased media row no longer exists', async () => {
        const {db, boundStatements} = createMockDb({
            firstResults: [
                null,
                {
                    media_id: 'missing-media',
                    lease_expires_at: '2026-07-12 08:30:00',
                },
                {count: 1},
                null,
            ],
        })

        const data = await getImageApprovalData(db, mediaBaseUrl, 'reviewer-1')

        expect(data).toEqual({
            current: null,
            pendingCount: 1,
            leaseExpiresAt: null,
        })
        const release = boundStatements.find((statement) =>
            normalizedSql(statement.sql).includes('SET lease_id = NULL, leased_by_user_id = NULL'),
        )
        expect(release?.binds).toEqual(['missing-media', 'reviewer-1'])
    })
})

describe('getImageApprovalPendingCount', () => {
    it('falls back to zero when D1 returns no count row', async () => {
        const {db} = createMockDb({
            firstResults: [null],
        })

        await expect(getImageApprovalPendingCount(db)).resolves.toBe(0)
    })
})

describe('getImageApprovalHistory', () => {
    it('uses page one by default and tolerates an empty D1 all response', async () => {
        const boundStatements: Array<{sql: string; binds: unknown[]}> = []
        const db = {
            prepare: vi.fn((sql: string) => ({
                bind: vi.fn((...binds: unknown[]) => {
                    boundStatements.push({sql, binds})
                    return {
                        all: vi.fn(async () => ({})),
                    }
                }),
            })),
        } as unknown as D1Database

        const history = await getImageApprovalHistory(db)

        expect(history).toEqual({
            items: [],
            page: 1,
            pageSize: 50,
            hasPrevious: false,
            hasNext: false,
        })
        expect(boundStatements[0]?.binds).toEqual([51, 0])
    })

    it('truncates fractional page numbers and reports when more history is available', async () => {
        const rows = Array.from({length: 51}, (_, index) =>
            createHistoryRow({
                id: `event-${index + 1}`,
                media_id: `media-${index + 1}`,
                homepage_allowed: index === 0 ? 1 : 0,
            }),
        )
        const {db} = createMockDb({
            allResults: [rows],
        })

        const history = await getImageApprovalHistory(db, 2.9)

        expect(history.page).toBe(2)
        expect(history.items).toHaveLength(50)
        expect(history.items[0]).toMatchObject({
            id: 'event-1',
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

function createApprovalRow(
    overrides: Partial<{
        id: string
        user_id: string
        username: string
        email: string
        character_id: string
        character_name: string
        sfw_image_key: string | null
        nsfw_image_key: string | null
        sfw_preview_image_key: string | null
        nsfw_preview_image_key: string | null
        sfw_content_type: string | null
        nsfw_content_type: string | null
        sfw_artist: string
        nsfw_artist: string
        sfw_width: number | null
        sfw_height: number | null
        sfw_byte_size: number | null
        nsfw_width: number | null
        nsfw_height: number | null
        nsfw_byte_size: number | null
        sfw_review_status: string
        sfw_reviewed_at: string | null
        sfw_approved_at: string | null
        sfw_homepage_allowed: number
        nsfw_review_status: string
        nsfw_reviewed_at: string | null
        nsfw_approved_at: string | null
        created_at: string
        updated_at: string
    }> = {},
) {
    return {
        id: 'media-1',
        user_id: 'owner-1',
        username: 'owner name',
        email: 'owner@example.test',
        character_id: 'character-1',
        character_name: 'Character One',
        sfw_image_key: 'sfw-key',
        nsfw_image_key: null,
        sfw_preview_image_key: 'sfw-preview-key',
        nsfw_preview_image_key: null,
        sfw_content_type: 'image/webp',
        nsfw_content_type: null,
        sfw_artist: 'SFW Artist',
        nsfw_artist: 'NSFW Artist',
        sfw_width: 800,
        sfw_height: 600,
        sfw_byte_size: 1024,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_byte_size: null,
        sfw_review_status: 'pending',
        sfw_reviewed_at: null,
        sfw_approved_at: null,
        sfw_homepage_allowed: 1,
        nsfw_review_status: 'pending',
        nsfw_reviewed_at: null,
        nsfw_approved_at: null,
        created_at: '2026-07-12 07:00:00',
        updated_at: '2026-07-12 07:30:00',
        ...overrides,
    }
}

function createHistoryRow(
    overrides: Partial<{
        id: string
        media_id: string
        image_rating: 'sfw' | 'nsfw'
        action: string
        homepage_allowed: number
        moderator_username: string
        owner_username: string
        character_name: string
        created_at: string
    }> = {},
) {
    return {
        id: 'event-1',
        media_id: 'media-1',
        image_rating: 'sfw',
        action: 'approve_sfw_homepage',
        homepage_allowed: 1,
        moderator_username: 'mod',
        owner_username: 'owner',
        character_name: 'Character One',
        created_at: '2026-07-12 08:00:00',
        ...overrides,
    }
}

function normalizedSql(sql: string | undefined): string {
    return sqlFragment(sql ?? '')
        .replace(/\s+/g, ' ')
        .trim()
}
