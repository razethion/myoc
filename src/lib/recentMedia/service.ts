import type {Bindings} from '../../types/bindings'
import {getRecentMediaPage, type RecentMediaOptions, type RecentMediaPage} from '../recentMedia'
import {getRecentFeedConfig} from './config'
import {getGeneratedRecentMediaPage, isRecentFeedCursor, RecentFeedGenerationExpiredError} from './reader'

export type ConfiguredRecentMediaOptions = RecentMediaOptions & {
    generation?: string | null
}

export async function getConfiguredRecentMediaPage(env: Bindings, options: ConfiguredRecentMediaOptions = {}): Promise<RecentMediaPage> {
    const config = getRecentFeedConfig(env)
    const generatedCursor = isRecentFeedCursor(options.cursor)

    if (config.readMode === 'd1') {
        if (generatedCursor || options.generation) {
            throw new RecentFeedGenerationExpiredError()
        }

        return await getRecentMediaPage(env.CACHE, env.DB, env.MEDIA_PUBLIC_BASE_URL, options)
    }

    if (config.readMode === 'shadow') {
        if (generatedCursor || options.generation) {
            throw new RecentFeedGenerationExpiredError()
        }

        const page = await getRecentMediaPage(env.CACHE, env.DB, env.MEDIA_PUBLIC_BASE_URL, options)

        if (!options.cursor && config.cursorSecret) {
            try {
                const generated = await getGeneratedRecentMediaPage(env, options)
                logShadowDifference(page, generated, options)
            } catch (error) {
                console.warn('Recent feed shadow read failed', {error})
            }
        }

        return page
    }

    if (options.cursor && !generatedCursor) {
        throw new RecentFeedGenerationExpiredError()
    }

    return await getGeneratedRecentMediaPage(env, options)
}

function logShadowDifference(d1Page: RecentMediaPage, generatedPage: RecentMediaPage, options: ConfiguredRecentMediaOptions): void {
    const d1Ids = d1Page.items.map((item) => item.id)
    const generatedIds = generatedPage.items.map((item) => item.id)

    console.log(
        JSON.stringify({
            event: 'recent-feed-shadow-compare',
            matches: JSON.stringify(d1Ids) === JSON.stringify(generatedIds),
            d1Count: d1Ids.length,
            generatedCount: generatedIds.length,
            showNsfw: options.showNsfw === true,
            showUnapproved: options.showUnapproved !== false,
        }),
    )
}
