import {Hono} from 'hono'
import {
    normalizeSearchOffset,
    normalizeSearchQuery,
    searchCharacters,
    searchUsers,
} from '../../lib/search'
import type {Bindings} from '../../types/bindings'

export const searchRoutes = new Hono<{ Bindings: Bindings }>()

searchRoutes.get('/', async (c) => {
    const type = c.req.query('type')
    const {query, wasTruncated} = normalizeSearchQuery(c.req.query('q'))
    const offset = normalizeSearchOffset(c.req.query('offset'))

    if (type !== 'users' && type !== 'characters') {
        return c.json({error: 'Search type must be users or characters'}, 400)
    }

    const results = type === 'users'
        ? await searchUsers(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, query, undefined, offset)
        : await searchCharacters(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, query, undefined, offset)

    return c.json({
        type,
        query,
        wasTruncated,
        items: results.items,
        total: results.total,
        nextOffset: results.nextOffset,
        hasMore: results.hasMore,
    })
})
