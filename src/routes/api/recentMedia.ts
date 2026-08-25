import {Hono} from 'hono'
import {z} from 'zod'
import {getCurrentUser} from '../../lib/auth/session'
import {getRecentMediaPage, InvalidRecentMediaCursorError, RECENT_MEDIA_MAX_PAGE_SIZE, RECENT_MEDIA_PAGE_SIZE} from '../../lib/recentMedia'
import type {Bindings} from '../../types/bindings'

const RecentMediaQuerySchema = z.object({
    cursor: z.string().max(256).optional(),
    limit: z.coerce.number().int().min(1).max(RECENT_MEDIA_MAX_PAGE_SIZE).default(RECENT_MEDIA_PAGE_SIZE),
    nsfw: z.enum(['true', 'false']).optional(),
    unapproved: z.enum(['true', 'false']).optional(),
})

export const recentMediaRoutes = new Hono<{Bindings: Bindings}>()

recentMediaRoutes.get('/', async (c) => {
    const query = RecentMediaQuerySchema.safeParse(c.req.query())

    if (!query.success) {
        return c.json({error: 'Recent media query is invalid'}, 400)
    }

    try {
        const needsAccountDefaults = query.data.nsfw === undefined || query.data.unapproved === undefined
        const currentUser = needsAccountDefaults ? await getCurrentUser(c) : null
        const page = await getRecentMediaPage(c.env.CACHE, c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, {
            cursor: query.data.cursor,
            limit: query.data.limit,
            showNsfw: query.data.nsfw === undefined ? Boolean(currentUser?.displayNsfwMedia) : query.data.nsfw === 'true',
            showUnapproved:
                query.data.unapproved === undefined ? currentUser?.showUnapprovedMedia !== false : query.data.unapproved === 'true',
        })

        return c.json(page)
    } catch (error) {
        if (error instanceof InvalidRecentMediaCursorError) {
            return c.json({error: error.message}, 400)
        }

        throw error
    }
})
