import {beforeEach, describe, expect, it, vi} from 'vitest'
import {getCurrentUser} from '../../lib/auth/session'
import {InvalidRecentMediaCursorError, type RecentMediaPage} from '../../lib/recentMedia'
import {InvalidRecentFeedCursorError, RecentFeedGenerationExpiredError} from '../../lib/recentMedia/reader'
import {getConfiguredRecentMediaPage} from '../../lib/recentMedia/service'
import {createMockDb} from '../../test/mockD1'
import type {Bindings} from '../../types/bindings'
import {recentMediaRoutes} from './recentMedia'

vi.mock('../../lib/auth/session', () => ({
    getCurrentUser: vi.fn(),
}))

vi.mock('../../lib/recentMedia/service', () => ({
    getConfiguredRecentMediaPage: vi.fn(),
}))

const mockedGetCurrentUser = vi.mocked(getCurrentUser)
const mockedGetConfiguredRecentMediaPage = vi.mocked(getConfiguredRecentMediaPage)

const emptyPage: RecentMediaPage = {
    items: [],
    nextCursor: null,
    nextPosition: null,
    publicRootUrl: null,
    generation: null,
    publishedAt: null,
}

function requestEnv(db: D1Database, overrides: Record<string, unknown> = {}): Bindings {
    return {
        DB: db,
        RECENT_FEED_PUBLIC_BASE_URL: 'https://feed.example',
        ...overrides,
    } as unknown as Bindings
}

beforeEach(() => {
    mockedGetCurrentUser.mockReset()
    mockedGetConfiguredRecentMediaPage.mockReset()
    mockedGetConfiguredRecentMediaPage.mockResolvedValue(emptyPage)
})

describe('GET /recent-media', () => {
    it('rejects invalid query parameters before account or feed lookup', async () => {
        const {db} = createMockDb()

        const response = await recentMediaRoutes.request('https://example.com/?limit=0', {}, requestEnv(db))

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Recent media query is invalid'})
        expect(mockedGetCurrentUser).not.toHaveBeenCalled()
        expect(mockedGetConfiguredRecentMediaPage).not.toHaveBeenCalled()
    })

    it('uses anonymous account defaults when both visibility filters are omitted', async () => {
        const {db} = createMockDb()
        mockedGetCurrentUser.mockResolvedValue(null)

        const response = await recentMediaRoutes.request('https://example.com/', {}, requestEnv(db))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            items: [],
            nextCursor: null,
            nextPosition: null,
            publicRootUrl: null,
            generation: null,
            publishedAt: null,
        })
        expect(mockedGetCurrentUser).toHaveBeenCalledTimes(1)
        expect(mockedGetConfiguredRecentMediaPage).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                limit: 24,
                showNsfw: false,
                showUnapproved: true,
            }),
        )
    })

    it('uses account defaults when one visibility filter is omitted', async () => {
        const {db} = createMockDb()
        mockedGetCurrentUser.mockResolvedValue({
            displayNsfwMedia: true,
            showUnapprovedMedia: false,
        } as Awaited<ReturnType<typeof getCurrentUser>>)

        const nsfwDefaultResponse = await recentMediaRoutes.request('https://example.com/?unapproved=false&limit=3', {}, requestEnv(db))
        expect(nsfwDefaultResponse.status).toBe(200)
        expect(mockedGetConfiguredRecentMediaPage).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({limit: 3, showNsfw: true, showUnapproved: false}),
        )

        const unapprovedDefaultResponse = await recentMediaRoutes.request('https://example.com/?nsfw=false&limit=4', {}, requestEnv(db))
        expect(unapprovedDefaultResponse.status).toBe(200)
        expect(mockedGetConfiguredRecentMediaPage).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({limit: 4, showNsfw: false, showUnapproved: false}),
        )
    })

    it('uses explicit visibility filters and cursor values without account lookup', async () => {
        const {db} = createMockDb()

        const response = await recentMediaRoutes.request(
            'https://example.com/?cursor=cursor-value&generation=generation-value&limit=2&nsfw=true&unapproved=true',
            {},
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(mockedGetCurrentUser).not.toHaveBeenCalled()
        expect(mockedGetConfiguredRecentMediaPage).toHaveBeenCalledWith(expect.anything(), {
            cursor: 'cursor-value',
            generation: 'generation-value',
            limit: 2,
            showNsfw: true,
            showUnapproved: true,
        })

        await recentMediaRoutes.request('https://example.com/?nsfw=false&unapproved=false', {}, requestEnv(db))
        expect(mockedGetConfiguredRecentMediaPage).toHaveBeenLastCalledWith(expect.anything(), {
            cursor: undefined,
            generation: undefined,
            limit: 24,
            showNsfw: false,
            showUnapproved: false,
        })
    })

    it('maps invalid media and feed cursors to bad requests', async () => {
        const {db} = createMockDb()
        const errors = [new InvalidRecentMediaCursorError(), new InvalidRecentFeedCursorError()]

        for (const error of errors) {
            mockedGetConfiguredRecentMediaPage.mockRejectedValueOnce(error)

            const response = await recentMediaRoutes.request('https://example.com/?nsfw=true&unapproved=true', {}, requestEnv(db))

            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({error: 'Recent media cursor is invalid'})
        }
    })

    it('maps expired generations to a 410 response', async () => {
        const {db} = createMockDb()
        mockedGetConfiguredRecentMediaPage.mockRejectedValueOnce(new RecentFeedGenerationExpiredError())

        const response = await recentMediaRoutes.request('https://example.com/?nsfw=true&unapproved=true', {}, requestEnv(db))

        expect(response.status).toBe(410)
        expect(await response.json()).toEqual({
            error: 'This recent media list has expired',
            code: 'recent-generation-expired',
        })
    })

    it('rethrows unexpected feed errors', async () => {
        const {db} = createMockDb()
        const error = new Error('feed unavailable')
        mockedGetConfiguredRecentMediaPage.mockRejectedValueOnce(error)

        const response = await recentMediaRoutes.request('https://example.com/?nsfw=true&unapproved=true', {}, requestEnv(db))

        expect(response.status).toBe(500)
    })
})

describe('GET /recent-media/state', () => {
    it('returns the authoritative state and public object URL', async () => {
        const {db} = createMockDb({
            firstResults: [
                {
                    generation: 'generation-1',
                    publishedAt: '2026-08-26T12:00:00.000Z',
                    rootKey: 'generations/v1/generation-1.json',
                    unsafePending: 1,
                },
            ],
        })

        const response = await recentMediaRoutes.request('https://example.com/state', {}, requestEnv(db))

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('public, max-age=5, must-revalidate')
        expect(await response.json()).toEqual({
            generation: 'generation-1',
            publishedAt: '2026-08-26T12:00:00.000Z',
            publicRootUrl: 'https://feed.example/generations/v1/generation-1.json',
            unsafePending: true,
        })
        expect(db.prepare).toHaveBeenCalledTimes(1)
    })

    it('returns empty state when no authoritative generation exists', async () => {
        const {db} = createMockDb({firstResults: [null]})

        const response = await recentMediaRoutes.request('https://example.com/state', {}, requestEnv(db))

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            generation: null,
            publishedAt: null,
            publicRootUrl: null,
            unsafePending: false,
        })
    })

    it('serializes a safe state with a non-urgent pending flag', async () => {
        const {db} = createMockDb({
            firstResults: [
                {
                    generation: 'generation-2',
                    publishedAt: '2026-08-26T13:00:00.000Z',
                    rootKey: 'generations/v1/generation-2.json',
                    unsafePending: 0,
                },
            ],
        })

        const response = await recentMediaRoutes.request(
            'https://example.com/state',
            {},
            requestEnv(db, {RECENT_FEED_PUBLIC_BASE_URL: 'not-a-url'}),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            generation: 'generation-2',
            publishedAt: '2026-08-26T13:00:00.000Z',
            publicRootUrl: null,
            unsafePending: false,
        })
    })
})
