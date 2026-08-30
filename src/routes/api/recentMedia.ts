import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {ErrorResponseSchema, responseSchema} from '../../lib/http/responseSchemas'
import {RECENT_MEDIA_MAX_PAGE_SIZE, RECENT_MEDIA_PAGE_SIZE, RecentMediaPageSchema} from '../../lib/recentMedia'
import {getRecentFeedConfig, recentFeedPublicObjectUrl} from '../../lib/recentMedia/config'
import {getGeneratedRecentMediaPage, InvalidRecentFeedCursorError, RecentFeedGenerationExpiredError} from '../../lib/recentMedia/reader'
import type {Bindings} from '../../types/bindings'

const RecentMediaQuerySchema = z.object({
    cursor: z.string().max(512).optional(),
    generation: z.string().max(128).optional(),
    limit: z.coerce.number().int().min(1).max(RECENT_MEDIA_MAX_PAGE_SIZE).default(RECENT_MEDIA_PAGE_SIZE),
    nsfw: z.enum(['true', 'false']).optional(),
    unapproved: z.literal('false').optional(),
})
const RecentMediaExpiredResponseSchema = responseSchema({
    error: z.string(),
    code: z.literal('recent-generation-expired'),
})
const RecentMediaStateResponseSchema = responseSchema({
    generation: z.string().nullable(),
    publishedAt: z.string().nullable(),
    publicRootUrl: z.string().url().nullable(),
    unsafePending: z.boolean(),
})

export const recentMediaRoutes = new Hono<{Bindings: Bindings}>()

recentMediaRoutes.get('/', async (c) => {
    const query = RecentMediaQuerySchema.safeParse(c.req.query())

    if (!query.success) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Recent media query is invalid'}, 400)
    }

    try {
        const needsAccountDefaults = query.data.nsfw === undefined
        const currentUser = needsAccountDefaults ? await getCurrentUser(c) : null
        const page = await getGeneratedRecentMediaPage(c.env, {
            cursor: query.data.cursor,
            generation: query.data.generation,
            limit: query.data.limit,
            showNsfw: query.data.nsfw === undefined ? Boolean(currentUser?.displayNsfwMedia) : query.data.nsfw === 'true',
            showUnapproved: false,
        })

        return jsonResponse(c, RecentMediaPageSchema, page)
    } catch (error) {
        if (error instanceof InvalidRecentFeedCursorError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        if (error instanceof RecentFeedGenerationExpiredError) {
            return jsonResponse(c, RecentMediaExpiredResponseSchema, {error: error.message, code: 'recent-generation-expired'}, 410)
        }

        throw error
    }
})

recentMediaRoutes.get('/state', async (c) => {
    const state = await getAuthoritativeRecentFeedState(c.env.DB)
    const config = getRecentFeedConfig(c.env)

    c.header('Cache-Control', 'public, max-age=5, must-revalidate')

    return jsonResponse(
        c,
        RecentMediaStateResponseSchema,
        state
            ? {
                  generation: state.generation,
                  publishedAt: state.publishedAt,
                  publicRootUrl: recentFeedPublicObjectUrl(config.publicBaseUrl, state.rootKey),
                  unsafePending: state.unsafePending === 1,
              }
            : {generation: null, publishedAt: null, publicRootUrl: null, unsafePending: false},
    )
})

type AuthoritativeRecentFeedState = {
    generation: string
    publishedAt: string
    rootKey: string
    unsafePending: number
}

async function getAuthoritativeRecentFeedState(db: D1Database): Promise<AuthoritativeRecentFeedState | null> {
    return await db
        .prepare(
            `SELECT state.generation,
                    state.root_key AS rootKey,
                    state.published_at AS publishedAt,
                    EXISTS (
                        SELECT 1
                        FROM recent_feed_dirty_hours AS dirty
                        WHERE dirty.revision > state.published_revision
                          AND dirty.urgent = 1
                    ) AS unsafePending
             FROM recent_feed_state AS state
             WHERE state.singleton = 1
               AND state.generation IS NOT NULL
               AND state.root_key IS NOT NULL
               AND state.published_at IS NOT NULL`,
        )
        .bind()
        .first<AuthoritativeRecentFeedState>()
}
