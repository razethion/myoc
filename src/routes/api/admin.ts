import {Hono} from 'hono'
import {requireAdminApiUser} from '../../lib/auth/authorization'
import type {Bindings} from '../../types/bindings'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

adminRoutes.get('/', async (c) => {
    const authorization = await requireAdminApiUser(c)

    if ('response' in authorization) {
        return authorization.response
    }

    return c.json({ok: true})
})
