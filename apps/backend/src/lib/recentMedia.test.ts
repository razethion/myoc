import {beforeEach, describe, expect, it} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import {
    normalizeRecentMediaLimit,
    RECENT_MEDIA_MAX_PAGE_SIZE,
    RECENT_MEDIA_PAGE_SIZE,
    RecentMediaPageSchema,
    RecentMediaStateSchema,
} from './recentMedia'
import {
    getRecentMediaPage,
    getRecentMediaState,
    InvalidRecentFeedCursorError,
    type RecentFeedQueryEnv,
    resetRecentFeedHeadCache,
} from './recentMedia/query'

const db = useTestDatabase()
const mediaBaseUrl = 'https://media.example.com'
const env: RecentFeedQueryEnv = {
    DB: db,
    MEDIA_PUBLIC_BASE_URL: mediaBaseUrl,
    RECENT_FEED_CURSOR_SECRET: 'test-secret-with-at-least-thirty-two-characters',
}

beforeEach(() => {
    resetRecentFeedHeadCache()
})

function requireFirst<T>(values: T[], label: string): T {
    const value = values[0]
    if (value === undefined) {
        throw new Error(`Expected ${label}`)
    }
    return value
}

async function seedFeedOwner(): Promise<void> {
    await seedUser({id: 'user-1'})
    await seedCharacter({id: 'character-1', userId: 'user-1'})
}

describe('recent media direct query', () => {
    it('publishes approved media and includes unapproved media on request', async () => {
        await seedFeedOwner()
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

        const approvedPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: false})
        const unapprovedPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: true})

        expect(approvedPage.items.map((item) => item.id)).toEqual(['approved-media'])
        expect(unapprovedPage.items.map((item) => item.id)).toEqual(['approved-media', 'pending-media', 'changed-after-approval'])
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

        const sfwPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: false})
        const nsfwPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: false})
        const sfwItem = requireFirst(sfwPage.items, 'the SFW item')
        const nsfwItem = requireFirst(nsfwPage.items, 'the NSFW item')

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
        await seedFeedOwner()
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

        const sfwPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: false})
        const nsfwPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: true})
        const sfwItem = requireFirst(sfwPage.items, 'the SFW item')
        const nsfwItem = requireFirst(nsfwPage.items, 'the NSFW item')

        expect(sfwItem.originalSrc).toContain('/sfw/')
        expect(nsfwItem.originalSrc).toContain('/nsfw/')
    })

    it('publishes NSFW-only media only when the request permits it', async () => {
        await seedFeedOwner()
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

        const sfwPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: false})
        const nsfwPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: false})

        expect(sfwPage.items).toEqual([])
        expect(requireFirst(nsfwPage.items, 'the NSFW item')).toMatchObject({
            id: 'nsfw-only',
            user: {avatarUrl: null},
        })
    })

    it('uses safe dimensions when stored media dimensions are unavailable', async () => {
        await seedFeedOwner()
        await seedMedia({
            id: 'media-without-dimensions',
            userId: 'user-1',
            characterId: 'character-1',
            sfwWidth: null,
            sfwHeight: null,
            sfwPreviewImageKey: 'sfw-preview',
            nsfwImageKey: 'nsfw-original',
            nsfwWidth: null,
            nsfwHeight: null,
            nsfwPreviewImageKey: 'nsfw-preview',
        })

        const sfwPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: true})
        const nsfwPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: true})

        expect(requireFirst(sfwPage.items, 'the SFW item')).toMatchObject({width: 1, height: 1})
        expect(requireFirst(nsfwPage.items, 'the NSFW item')).toMatchObject({width: 1, height: 1})
    })

    it('shows an eligible variant when the other variant has no preview', async () => {
        await seedFeedOwner()
        await seedMedia({
            id: 'nsfw-preview-only',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: null,
            nsfwImageKey: 'nsfw-original',
            nsfwPreviewImageKey: 'nsfw-preview',
        })
        await seedMedia({
            id: 'sfw-preview-only',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'sfw-preview',
            nsfwImageKey: 'nsfw-original',
            nsfwPreviewImageKey: null,
        })

        const sfwPage = await getRecentMediaPage(env, {showNsfw: false, showUnapproved: true})
        const allPage = await getRecentMediaPage(env, {showNsfw: true, showUnapproved: true})

        expect(sfwPage.items.map((item) => item.id)).toEqual(['sfw-preview-only'])
        expect(allPage.items.map((item) => [item.id, item.originalSrc.includes('/nsfw/')])).toEqual([
            ['sfw-preview-only', false],
            ['nsfw-preview-only', true],
        ])
    })

    it('returns an empty page and neutral state when the source is empty', async () => {
        await expect(getRecentMediaPage(env)).resolves.toEqual({items: [], nextCursor: null, head: null})
        await expect(getRecentMediaState(env)).resolves.toEqual({head: null, newCount: 0})
    })

    it('pages items by keyset cursor with an ID tie-break', async () => {
        await seedFeedOwner()
        for (const [id, createdAt] of [
            ['same-z', '2026-08-25 12:00:00'],
            ['same-y', '2026-08-25 12:00:00'],
            ['same-x', '2026-08-25 12:00:00'],
            ['older', '2026-08-25 11:00:00'],
        ] as const) {
            await seedMedia({id, userId: 'user-1', characterId: 'character-1', sfwPreviewImageKey: `${id}-preview`, createdAt})
        }

        const firstPage = await getRecentMediaPage(env, {limit: 2})
        expect(firstPage.items.map((item) => item.id)).toEqual(['same-z', 'same-y'])
        expect(firstPage.nextCursor).toBeTypeOf('string')
        expect(firstPage.head).toBeTypeOf('string')

        const secondPage = await getRecentMediaPage(env, {limit: 2, cursor: firstPage.nextCursor})
        expect(secondPage.items.map((item) => item.id)).toEqual(['same-x', 'older'])
        expect(secondPage.nextCursor).toBeNull()
    })

    it('pins the head to the newest item on the first page', async () => {
        await seedFeedOwner()
        await seedMedia({
            id: 'first',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'first-preview',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })
        await seedMedia({
            id: 'second',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'second-preview',
            createdAt: '2026-08-25 12:01:00',
            updatedAt: '2026-08-25 12:01:00',
        })

        const page = await getRecentMediaPage(env, {limit: 1})
        expect(page.items.map((item) => item.id)).toEqual(['second'])

        const state = await getRecentMediaState(env)
        expect(page.head).toBe(state.head)
        await expect(getRecentMediaState(env, {cursor: page.head})).resolves.toMatchObject({newCount: 0})
    })

    it('rejects cursors from another variant or tampered payloads', async () => {
        await seedFeedOwner()
        for (const [id, createdAt] of [
            ['first', '2026-08-25 12:03:00'],
            ['second', '2026-08-25 12:02:00'],
            ['third', '2026-08-25 12:01:00'],
        ] as const) {
            await seedMedia({id, userId: 'user-1', characterId: 'character-1', sfwPreviewImageKey: `${id}-preview`, createdAt})
        }

        const page = await getRecentMediaPage(env, {showNsfw: true, limit: 2})
        const cursor = page.nextCursor
        expect(cursor).toBeTypeOf('string')

        await expect(getRecentMediaPage(env, {showNsfw: false, limit: 2, cursor})).rejects.toThrow(InvalidRecentFeedCursorError)
        await expect(getRecentMediaPage(env, {showNsfw: true, limit: 2, cursor: `${cursor?.slice(0, -3)}aaa`})).rejects.toThrow(
            InvalidRecentFeedCursorError,
        )
        await expect(getRecentMediaPage(env, {showNsfw: true, limit: 2, cursor: 'not-a-cursor'})).rejects.toThrow(
            InvalidRecentFeedCursorError,
        )
    })

    it('reports the head cursor and counts uploads newer than a pinned cursor', async () => {
        await seedFeedOwner()
        await seedMedia({
            id: 'older-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'older-preview',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })

        const page = await getRecentMediaPage(env)
        const head = page.head
        expect(head).toBeTypeOf('string')
        await expect(getRecentMediaState(env, {cursor: head})).resolves.toEqual({head, newCount: 0})

        await seedMedia({
            id: 'newer-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'newer-preview',
            createdAt: '2026-08-25 12:05:00',
            updatedAt: '2026-08-25 12:05:00',
        })
        resetRecentFeedHeadCache()

        const updatedState = await getRecentMediaState(env, {cursor: head})
        expect(updatedState.newCount).toBe(1)
        expect(updatedState.head).not.toBe(head)

        await expect(getRecentMediaState(env)).resolves.toMatchObject({newCount: 0})
    })

    it('rejects requests without a usable cursor secret', async () => {
        await expect(getRecentMediaPage({...env, RECENT_FEED_CURSOR_SECRET: undefined})).rejects.toThrow(
            'Recent feed cursor secret is not configured',
        )
        await expect(getRecentMediaPage({...env, RECENT_FEED_CURSOR_SECRET: 'too-short'})).rejects.toThrow(
            'Recent feed cursor secret is not configured',
        )
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

    it('parses direct feed page and state responses', () => {
        expect(RecentMediaPageSchema.parse({items: [], nextCursor: null, head: null})).toEqual({
            items: [],
            nextCursor: null,
            head: null,
        })
        expect(RecentMediaStateSchema.parse({head: null, newCount: 3})).toEqual({head: null, newCount: 3})
        expect(() => RecentMediaStateSchema.parse({head: null, newCount: -1})).toThrow()
    })
})
