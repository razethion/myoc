import {describe, expect, it} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import {
    normalizeRecentMediaLimit,
    queryRecentMediaSourceRows,
    queryRecentMediaSourceRowsPage,
    RECENT_MEDIA_MAX_PAGE_SIZE,
    RECENT_MEDIA_PAGE_SIZE,
    RecentMediaPageSchema,
    recentMediaHour,
    recentMediaItemsFromRows,
} from './recentMedia'

const db = useTestDatabase()

function requireFirst<T>(values: T[], label: string): T {
    const value = values[0]
    if (value === undefined) {
        throw new Error(`Expected ${label}`)
    }
    return value
}

describe('recent media publication source', () => {
    it('publishes media with previews for approved and unapproved variants', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        await seedMedia({
            id: 'approved-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'approved-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:00:00',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })
        await seedMedia({
            id: 'pending-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'pending-preview',
            sfwReviewStatus: 'pending',
            createdAt: '2026-08-25 11:00:00',
            updatedAt: '2026-08-25 11:00:00',
        })
        await seedMedia({
            id: 'changed-after-approval',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'changed-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 09:00:00',
            createdAt: '2026-08-25 10:00:00',
            updatedAt: '2026-08-25 10:00:00',
        })

        const rows = await queryRecentMediaSourceRows(db)

        expect(rows.map((row) => row.id)).toEqual(['approved-media', 'pending-media', 'changed-after-approval'])
        expect(recentMediaItemsFromRows(rows, 'https://m.example.com', false, false).map((item) => item.id)).toEqual(['approved-media'])
        expect(recentMediaItemsFromRows(rows, 'https://m.example.com', false, true).map((item) => item.id)).toEqual([
            'approved-media',
            'pending-media',
            'changed-after-approval',
        ])
    })

    it('selects the requested eligible variant and returns presentation details', async () => {
        await seedUser({id: 'user-1', username: 'owner_name', profilePhotoKey: 'profile-photo'})
        await seedCharacter({id: 'character-1', userId: 'user-1', name: 'Hero Rival', profileImageKey: 'character-profile'})
        await seedMedia({
            id: 'mixed-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwImageKey: 'sfw-original',
            sfwPreviewImageKey: 'sfw-preview',
            sfwContentType: 'image/jpeg',
            sfwPreviewWidth: 320,
            sfwPreviewHeight: 240,
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:00:00',
            nsfwImageKey: 'nsfw-original',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwContentType: 'image/webp',
            nsfwWidth: 900,
            nsfwHeight: 700,
            nsfwReviewStatus: 'approved',
            nsfwApprovedAt: '2026-08-25 12:00:00',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })

        const row = requireFirst(await queryRecentMediaSourceRows(db), 'the seeded media row')
        const sfwItem = requireFirst(recentMediaItemsFromRows([row], 'https://media.example.com/', false, false), 'the SFW item')
        const nsfwItem = requireFirst(recentMediaItemsFromRows([row], 'https://media.example.com/', true, false), 'the NSFW item')

        expect(sfwItem).toMatchObject({
            id: 'mixed-media',
            groupId: '["user-1","character-1"]',
            alt: 'Hero Rival character art',
            width: 320,
            height: 240,
            previewSrc: 'https://media.example.com/characters/user-1/character-1/media/mixed-media/sfw/preview/sfw-preview.webp',
            originalSrc: 'https://media.example.com/characters/user-1/character-1/media/mixed-media/sfw/sfw-original.jpg',
            character: {
                name: 'Hero Rival',
                href: '/u/owner_name/Hero%20Rival',
                avatarUrl: 'https://media.example.com/characters/user-1/character-1/profile/character-profile.webp',
            },
            user: {
                username: 'owner_name',
                href: '/u/owner_name',
                avatarUrl: 'https://media.example.com/users/user-1/profile/profile-photo.webp',
                initial: 'O',
            },
        })
        expect(nsfwItem).toMatchObject({
            width: 900,
            height: 700,
            previewSrc: 'https://media.example.com/characters/user-1/character-1/media/mixed-media/nsfw/preview/nsfw-preview.webp',
            originalSrc: 'https://media.example.com/characters/user-1/character-1/media/mixed-media/nsfw/nsfw-original.webp',
        })
    })

    it('uses SFW media when NSFW media is not approved', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        await seedMedia({
            id: 'pending-nsfw',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'sfw-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:00:00',
            nsfwImageKey: 'nsfw-original',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwReviewStatus: 'pending',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })

        const rows = await queryRecentMediaSourceRows(db)
        const sfwItem = requireFirst(recentMediaItemsFromRows(rows, 'https://media.example.com', true, false), 'the SFW item')
        const nsfwItem = requireFirst(recentMediaItemsFromRows(rows, 'https://media.example.com', true, true), 'the NSFW item')

        expect(sfwItem.originalSrc).toContain('/sfw/')
        expect(nsfwItem.originalSrc).toContain('/nsfw/')
    })

    it('publishes NSFW-only media only when the request permits it', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        await seedMedia({
            id: 'nsfw-only',
            userId: 'user-1',
            characterId: 'character-1',
            sfwImageKey: null,
            nsfwImageKey: 'nsfw-original',
            nsfwPreviewImageKey: 'nsfw-preview',
            nsfwReviewStatus: 'approved',
            nsfwApprovedAt: '2026-08-25 12:00:00',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })

        const rows = await queryRecentMediaSourceRows(db)

        expect(recentMediaItemsFromRows(rows, 'https://media.example.com', false, false)).toEqual([])
        expect(recentMediaItemsFromRows(rows, 'https://media.example.com', true, false)[0]).toMatchObject({
            id: 'nsfw-only',
            user: {avatarUrl: null},
        })
    })

    it('filters source rows to one UTC hour', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        for (const [id, createdAt] of [
            ['before', '2026-08-25 11:59:59'],
            ['start', '2026-08-25 12:00:00'],
            ['end', '2026-08-25 12:59:59'],
            ['after', '2026-08-25 13:00:00'],
        ] as const) {
            await seedMedia({id, userId: 'user-1', characterId: 'character-1', sfwPreviewImageKey: `${id}-preview`, createdAt})
        }

        const rows = await queryRecentMediaSourceRows(db, '2026-08-25T12')

        expect(rows.map((row) => row.id)).toEqual(['end', 'start'])
        expect(rows.map(recentMediaHour)).toEqual(['2026-08-25T12', '2026-08-25T12'])
    })

    it.each(['2026-08-25 12', '2026-13-01T00'])('rejects invalid source hour %s', async (hour) => {
        await expect(queryRecentMediaSourceRows(db, hour)).rejects.toThrow('Recent media hour is invalid')
    })

    it('pages source rows by timestamp and ID', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        for (const [id, createdAt] of [
            ['same-z', '2026-08-25 12:00:00'],
            ['same-y', '2026-08-25 12:00:00'],
            ['same-x', '2026-08-25 12:00:00'],
            ['older', '2026-08-25 11:00:00'],
        ] as const) {
            await seedMedia({id, userId: 'user-1', characterId: 'character-1', sfwPreviewImageKey: `${id}-preview`, createdAt})
        }

        const firstPage = await queryRecentMediaSourceRowsPage(db, null, 2)
        const secondPage = await queryRecentMediaSourceRowsPage(
            db,
            {createdAt: firstPage.at(-1)?.created_at ?? '', id: firstPage.at(-1)?.id ?? ''},
            2,
        )

        expect(firstPage.map((row) => row.id)).toEqual(['same-z', 'same-y'])
        expect(secondPage.map((row) => row.id)).toEqual(['same-x', 'older'])
    })

    it.each([0, 1.5, 5001])('rejects invalid source page limit %s', async (limit) => {
        await expect(queryRecentMediaSourceRowsPage(db, null, limit)).rejects.toThrow('Recent media source page limit is invalid')
    })
})

describe('recent media request values', () => {
    it.each([
        [undefined, RECENT_MEDIA_PAGE_SIZE],
        [0, RECENT_MEDIA_PAGE_SIZE],
        [1.5, RECENT_MEDIA_PAGE_SIZE],
        [-2, 1],
        [12, 12],
        [RECENT_MEDIA_MAX_PAGE_SIZE + 1, RECENT_MEDIA_MAX_PAGE_SIZE],
    ])('normalizes page limit %s to %s', (limit, expected) => {
        expect(normalizeRecentMediaLimit(limit)).toBe(expected)
    })

    it('defaults optional page metadata', () => {
        expect(RecentMediaPageSchema.parse({items: [], nextCursor: null})).toEqual({
            items: [],
            nextCursor: null,
            nextPosition: null,
            publicRootUrl: null,
            generation: null,
            publishedAt: null,
        })
    })
})
