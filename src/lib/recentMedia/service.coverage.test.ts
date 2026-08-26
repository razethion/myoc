import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {Bindings} from '../../types/bindings'
import type {RecentMediaPage} from '../recentMedia'

const mocks = vi.hoisted(() => ({
    getGeneratedRecentMediaPage: vi.fn(),
    getRecentFeedConfig: vi.fn(),
    getRecentMediaPage: vi.fn(),
    isRecentFeedCursor: vi.fn(),
}))

vi.mock('../recentMedia', () => ({
    getRecentMediaPage: mocks.getRecentMediaPage,
}))

vi.mock('./config', () => ({
    getRecentFeedConfig: mocks.getRecentFeedConfig,
}))

vi.mock('./reader', () => ({
    getGeneratedRecentMediaPage: mocks.getGeneratedRecentMediaPage,
    isRecentFeedCursor: mocks.isRecentFeedCursor,
    RecentFeedGenerationExpiredError: class RecentFeedGenerationExpiredError extends Error {
        constructor() {
            super('This recent media list has expired')
        }
    },
}))

import {RecentFeedGenerationExpiredError} from './reader'
import {getConfiguredRecentMediaPage} from './service'

const environment = {
    CACHE: 'cache',
    DB: 'db',
    MEDIA_PUBLIC_BASE_URL: 'https://media.example',
} as unknown as Bindings

function page(ids: string[] = []): RecentMediaPage {
    return {
        generation: null,
        items: ids.map((id) => ({id}) as RecentMediaPage['items'][number]),
        nextCursor: null,
        nextPosition: null,
        publicRootUrl: null,
        publishedAt: null,
    }
}

function configure(readMode: 'd1' | 'shadow' | 'r2', cursorSecret: string | null = null): void {
    mocks.getRecentFeedConfig.mockReturnValue({readMode, cursorSecret})
}

describe('configured recent media service coverage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.isRecentFeedCursor.mockReturnValue(false)
        mocks.getRecentMediaPage.mockResolvedValue(page(['d1-item']))
        mocks.getGeneratedRecentMediaPage.mockResolvedValue(page(['generated-item']))
        configure('d1')
    })

    it('uses D1 with default options', async () => {
        const result = await getConfiguredRecentMediaPage(environment)

        expect(result).toEqual(page(['d1-item']))
        expect(mocks.getRecentMediaPage).toHaveBeenCalledWith('cache', 'db', 'https://media.example', {})
        expect(mocks.getGeneratedRecentMediaPage).not.toHaveBeenCalled()
    })

    it('expires D1 cursors and generations', async () => {
        mocks.isRecentFeedCursor.mockReturnValueOnce(true).mockReturnValueOnce(false)

        await expect(getConfiguredRecentMediaPage(environment, {cursor: 'r1.cursor'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
        await expect(getConfiguredRecentMediaPage(environment, {generation: 'generation-1'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
    })

    it('expires shadow cursors and generations', async () => {
        configure('shadow', 'secret')
        mocks.isRecentFeedCursor.mockReturnValueOnce(true).mockReturnValueOnce(false)

        await expect(getConfiguredRecentMediaPage(environment, {cursor: 'r1.cursor'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
        await expect(getConfiguredRecentMediaPage(environment, {generation: 'generation-1'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
    })

    it('compares a shadow page when generated reading succeeds', async () => {
        configure('shadow', 'secret')
        mocks.getRecentMediaPage.mockResolvedValue(page(['same-item']))
        mocks.getGeneratedRecentMediaPage.mockResolvedValue(page(['same-item']))
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        await expect(getConfiguredRecentMediaPage(environment, {showNsfw: true, showUnapproved: false})).resolves.toEqual(
            page(['same-item']),
        )

        expect(log).toHaveBeenCalledWith(
            JSON.stringify({
                event: 'recent-feed-shadow-compare',
                matches: true,
                d1Count: 1,
                generatedCount: 1,
                showNsfw: true,
                showUnapproved: false,
            }),
        )
        log.mockRestore()
    })

    it('logs a shadow mismatch and skips comparison when not eligible', async () => {
        configure('shadow', 'secret')
        mocks.getRecentMediaPage.mockResolvedValue(page(['d1-item']))
        mocks.getGeneratedRecentMediaPage.mockResolvedValue(page(['generated-item']))
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        await getConfiguredRecentMediaPage(environment, {showNsfw: false})
        expect(log).toHaveBeenCalledWith(expect.stringContaining('"matches":false'))

        log.mockClear()
        await getConfiguredRecentMediaPage(environment, {cursor: 'legacy-cursor'})
        expect(log).not.toHaveBeenCalled()
        expect(mocks.getGeneratedRecentMediaPage).toHaveBeenCalledTimes(1)

        configure('shadow')
        await getConfiguredRecentMediaPage(environment)
        expect(mocks.getGeneratedRecentMediaPage).toHaveBeenCalledTimes(1)
        log.mockRestore()
    })

    it('warns when a shadow generated read fails', async () => {
        configure('shadow', 'secret')
        const error = new Error('generated read failed')
        mocks.getGeneratedRecentMediaPage.mockRejectedValue(error)
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

        await expect(getConfiguredRecentMediaPage(environment)).resolves.toEqual(page(['d1-item']))
        expect(warning).toHaveBeenCalledWith('Recent feed shadow read failed', {error})
        warning.mockRestore()
    })

    it('uses generated pages for R2 and accepts generated cursors', async () => {
        configure('r2')
        mocks.isRecentFeedCursor.mockReturnValueOnce(false).mockReturnValueOnce(true)

        await expect(getConfiguredRecentMediaPage(environment)).resolves.toEqual(page(['generated-item']))
        await expect(getConfiguredRecentMediaPage(environment, {cursor: 'r1.cursor'})).resolves.toEqual(page(['generated-item']))
        expect(mocks.getGeneratedRecentMediaPage).toHaveBeenCalledTimes(2)
    })

    it('expires a legacy cursor in R2 mode', async () => {
        configure('r2')

        await expect(getConfiguredRecentMediaPage(environment, {cursor: 'legacy-cursor'})).rejects.toBeInstanceOf(
            RecentFeedGenerationExpiredError,
        )
    })
})
