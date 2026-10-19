import {type Context, Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser} from '../../lib/auth/session'
import {jsonResponse} from '../../lib/http/jsonResponse'
import {ErrorResponseSchema} from '../../lib/http/responseSchemas'
import {RECENT_MEDIA_MAX_PAGE_SIZE, RECENT_MEDIA_PAGE_SIZE, RecentMediaPageSchema, RecentMediaStateSchema} from '../../lib/recentMedia'
import {getRecentMediaPage, getRecentMediaState, InvalidRecentFeedCursorError} from '../../lib/recentMedia/query'
import type {Bindings} from '../../types/bindings'

const RecentMediaQuerySchema = z.object({
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(RECENT_MEDIA_MAX_PAGE_SIZE).default(RECENT_MEDIA_PAGE_SIZE),
    nsfw: z.enum(['true', 'false']).optional(),
    unapproved: z.enum(['true', 'false']).optional(),
})

export const recentMediaRoutes = new Hono<{Bindings: Bindings}>()

recentMediaRoutes.get('/', async (c) => {
    const query = RecentMediaQuerySchema.safeParse(c.req.query())

    if (!query.success) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Recent media query is invalid'}, 400)
    }

    try {
        const settings = await resolveRecentMediaSettings(c, query.data)
        const page = await getRecentMediaPage(c.env, {
            cursor: query.data.cursor,
            limit: query.data.limit,
            showNsfw: settings.showNsfw,
            showUnapproved: settings.showUnapproved,
        })

        return jsonResponse(c, RecentMediaPageSchema, page)
    } catch (error) {
        if (error instanceof InvalidRecentFeedCursorError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

recentMediaRoutes.get('/state', async (c) => {
    const query = RecentMediaQuerySchema.pick({cursor: true, nsfw: true, unapproved: true}).safeParse(c.req.query())

    if (!query.success) {
        return jsonResponse(c, ErrorResponseSchema, {error: 'Recent media query is invalid'}, 400)
    }

    try {
        const settings = await resolveRecentMediaSettings(c, query.data)
        const state = await getRecentMediaState(c.env, {
            cursor: query.data.cursor,
            showNsfw: settings.showNsfw,
            showUnapproved: settings.showUnapproved,
        })

        c.header('Cache-Control', 'no-store')

        return jsonResponse(c, RecentMediaStateSchema, state)
    } catch (error) {
        if (error instanceof InvalidRecentFeedCursorError) {
            return jsonResponse(c, ErrorResponseSchema, {error: error.message}, 400)
        }

        throw error
    }
})

async function resolveRecentMediaSettings(
    c: Context<{Bindings: Bindings}>,
    query: {nsfw?: 'true' | 'false'; unapproved?: 'true' | 'false'},
): Promise<{showNsfw: boolean; showUnapproved: boolean}> {
    const needsAccountDefaults = query.nsfw === undefined || query.unapproved === undefined
    const currentUser = needsAccountDefaults ? await getCurrentUser(c) : null

    return {
        showNsfw: query.nsfw === undefined ? Boolean(currentUser?.displayNsfwMedia) : query.nsfw === 'true',
        showUnapproved: query.unapproved === undefined ? currentUser?.showUnapprovedMedia !== false : query.unapproved === 'true',
    }
}
