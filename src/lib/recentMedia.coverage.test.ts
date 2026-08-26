import {describe, expect, it, vi} from 'vitest'
import {createMockDb} from '../test/mockD1'
import {
    getRecentMediaPage,
    InvalidRecentMediaCursorError,
    normalizeRecentMediaLimit,
    queryRecentMediaSourceRows,
    queryRecentMediaSourceRowsPage,
    type RecentMediaRow,
    recentMediaHour,
    recentMediaItemsFromRows,
} from './recentMedia'

const mediaBaseUrl = 'https://media.example.test'

function row(overrides: Partial<RecentMediaRow> = {}): RecentMediaRow {
    return {
        id: 'media-1',
        user_id: 'user-1',
        character_id: 'character-1',
        sfw_image_key: 'sfw-original',
        sfw_preview_image_key: 'sfw-preview',
        sfw_content_type: 'image/png',
        sfw_width: 1200,
        sfw_height: 1600,
        sfw_preview_width: 600,
        sfw_preview_height: 800,
        sfw_review_status: 'approved',
        sfw_approved_at: '2026-08-23 13:00:00',
        nsfw_image_key: null,
        nsfw_preview_image_key: null,
        nsfw_content_type: null,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_review_status: 'pending',
        nsfw_approved_at: null,
        created_at: '2026-08-23 12:00:00',
        updated_at: '2026-08-23 12:00:00',
        character_name: 'Quartz Dragon',
        character_profile_image_key: 'character-profile',
        owner_username: 'demo_owner',
        owner_profile_photo_key: 'owner-profile',
        ...overrides,
    }
}

function cursor(value: unknown): string {
    return btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

describe('recent media coverage', () => {
    it('normalizes every limit boundary', () => {
        expect(normalizeRecentMediaLimit(undefined)).toBe(24)
        expect(normalizeRecentMediaLimit(0)).toBe(24)
        expect(normalizeRecentMediaLimit(-1)).toBe(1)
        expect(normalizeRecentMediaLimit(1)).toBe(1)
        expect(normalizeRecentMediaLimit(30)).toBe(30)
        expect(normalizeRecentMediaLimit(31)).toBe(30)
        expect(normalizeRecentMediaLimit(1.5)).toBe(24)
    })

    it('continues after cache failures and rejects invalid cached data', async () => {
        const {db} = createMockDb({allResults: [[]]})
        const cache = {
            get: vi.fn().mockRejectedValueOnce(new Error('read failure')).mockResolvedValueOnce({items: 'not-an-array'}),
            put: vi.fn().mockRejectedValue(new Error('write failure')),
        } as unknown as KVNamespace

        await expect(getRecentMediaPage(cache, db, mediaBaseUrl)).resolves.toMatchObject({items: []})
        await expect(getRecentMediaPage(cache, db, mediaBaseUrl, {limit: 1})).resolves.toMatchObject({items: []})
        expect(db.prepare).toHaveBeenCalledTimes(2)
    })

    it('filters variants and creates each fallback value', () => {
        const nsfwOnly = row({
            sfw_image_key: null,
            sfw_preview_image_key: null,
            nsfw_image_key: 'nsfw-original',
            nsfw_preview_image_key: 'nsfw-preview',
            nsfw_content_type: 'image/webp',
            nsfw_width: null,
            nsfw_height: null,
            nsfw_preview_width: null,
            nsfw_preview_height: null,
            nsfw_review_status: 'approved',
            nsfw_approved_at: '2026-08-23 13:00:00',
        })
        const staleSfw = row({id: 'stale', sfw_approved_at: '2026-08-23 11:59:59'})
        const zeroSize = row({
            id: 'zero',
            sfw_preview_width: 0,
            sfw_preview_height: 0,
            owner_username: ' ',
            owner_profile_photo_key: null,
        })
        const sfwOriginalSize = row({id: 'sfw-original-size', sfw_preview_width: null, sfw_preview_height: null})
        const sfwNoSize = row({id: 'sfw-no-size', sfw_preview_width: null, sfw_preview_height: null, sfw_width: null, sfw_height: null})
        const nsfwOriginalSize = row({
            id: 'nsfw-original-size',
            nsfw_image_key: 'nsfw-original',
            nsfw_preview_image_key: 'nsfw-preview',
            nsfw_preview_width: null,
            nsfw_preview_height: null,
            nsfw_width: 1000,
            nsfw_height: 1400,
        })

        expect(recentMediaItemsFromRows([nsfwOnly], mediaBaseUrl, false, true)).toEqual([])
        expect(recentMediaItemsFromRows([nsfwOnly], mediaBaseUrl, true, false)[0]).toMatchObject({
            width: 1,
            height: 1,
            previewSrc: expect.stringContaining('/nsfw/preview/'),
        })
        expect(recentMediaItemsFromRows([staleSfw], mediaBaseUrl, false, false)).toEqual([])

        const item = recentMediaItemsFromRows([zeroSize], mediaBaseUrl, false, true)[0]
        expect(item).toMatchObject({width: 1, height: 1, user: {avatarUrl: null, initial: 'U'}})
        expect(recentMediaItemsFromRows([sfwOriginalSize], mediaBaseUrl, false, true)[0]).toMatchObject({width: 1200, height: 1600})
        expect(recentMediaItemsFromRows([sfwNoSize], mediaBaseUrl, false, true)[0]).toMatchObject({width: 1, height: 1})
        expect(recentMediaItemsFromRows([nsfwOriginalSize], mediaBaseUrl, true, true)[0]).toMatchObject({width: 1000, height: 1400})
    })

    it('reports an ineligible query row instead of returning a broken URL', async () => {
        const {db} = createMockDb({allResults: [[row({sfw_image_key: null})]]})

        await expect(getRecentMediaPage(undefined, db, mediaBaseUrl)).rejects.toThrow('ineligible media variant')
    })

    it('queries source rows for all hours and returns an empty list when D1 omits results', async () => {
        const allHours = createMockDb({allResults: [[row()]]})
        const oneHour = createMockDb({allResults: [[row()]]})

        await expect(queryRecentMediaSourceRows(allHours.db)).resolves.toHaveLength(1)
        await expect(queryRecentMediaSourceRows(oneHour.db, '2026-08-23T12')).resolves.toHaveLength(1)
        expect(allHours.boundStatements[0]?.binds).toEqual([])
        expect(allHours.boundStatements[0]?.sql).not.toContain('WHERE character_media.created_at')
        expect(oneHour.boundStatements[0]?.binds).toEqual(['2026-08-23 12:00:00', '2026-08-23 13:00:00'])
        expect(oneHour.boundStatements[0]?.sql).toContain('WHERE character_media.created_at >= ?')

        const missingResults = {
            prepare: vi.fn(() => ({bind: vi.fn(() => ({all: vi.fn(async () => ({}))}))})),
        } as unknown as D1Database
        await expect(getRecentMediaPage(undefined, missingResults, mediaBaseUrl)).resolves.toMatchObject({items: []})
        await expect(queryRecentMediaSourceRows(missingResults)).resolves.toEqual([])
        await expect(queryRecentMediaSourceRows(missingResults, '2026-08-23T12')).resolves.toEqual([])
    })

    it('validates source hours and pages source rows with and without a cursor', async () => {
        await expect(queryRecentMediaSourceRows(createMockDb().db, '2026/08/23')).rejects.toThrow('hour is invalid')
        await expect(queryRecentMediaSourceRows(createMockDb().db, '2026-99-99T99')).rejects.toThrow('hour is invalid')

        for (const limit of [0, 1.5, 5001]) {
            await expect(queryRecentMediaSourceRowsPage(createMockDb().db, null, limit)).rejects.toThrow('page limit is invalid')
        }

        const firstPage = createMockDb({allResults: [[row()]]})
        const cursorPage = createMockDb({allResults: [[row()]]})
        await expect(queryRecentMediaSourceRowsPage(firstPage.db, null, 2)).resolves.toHaveLength(1)
        await expect(
            queryRecentMediaSourceRowsPage(cursorPage.db, {createdAt: '2026-08-23 12:00:00', id: 'media-1'}, 2),
        ).resolves.toHaveLength(1)
        expect(firstPage.boundStatements[0]?.binds).toEqual([2])
        expect(cursorPage.boundStatements[0]?.binds).toEqual(['2026-08-23 12:00:00', '2026-08-23 12:00:00', 'media-1', 2])

        const missingResults = {
            prepare: vi.fn(() => ({bind: vi.fn(() => ({all: vi.fn(async () => ({}))}))})),
        } as unknown as D1Database
        await expect(queryRecentMediaSourceRowsPage(missingResults, null, 2)).resolves.toEqual([])
    })

    it('reads valid cursors and rejects each invalid cursor shape before D1 runs', async () => {
        const valid = createMockDb({allResults: [[]]})
        await expect(
            getRecentMediaPage(undefined, valid.db, mediaBaseUrl, {cursor: cursor(['2026-08-23 12:00:00', 'media-1'])}),
        ).resolves.toMatchObject({items: []})
        expect(valid.boundStatements).toHaveLength(1)

        const invalidValues = [
            'a'.repeat(257),
            'not+a+cursor',
            'a',
            cursor([]),
            cursor(['at', 'id', 'extra']),
            cursor([1, 'id']),
            cursor(['at', 1]),
            cursor(['', 'id']),
            cursor(['a'.repeat(65), 'id']),
            cursor(['at', '']),
            cursor(['at', 'a'.repeat(129)]),
        ]

        for (const value of invalidValues) {
            const {boundStatements, db} = createMockDb()
            await expect(getRecentMediaPage(undefined, db, mediaBaseUrl, {cursor: value})).rejects.toBeInstanceOf(
                InvalidRecentMediaCursorError,
            )
            expect(boundStatements).toEqual([])
        }
    })

    it('reads the hour prefix from a source row', () => {
        expect(recentMediaHour(row())).toBe('2026-08-23T12')
    })
})
