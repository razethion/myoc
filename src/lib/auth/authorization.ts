import type {Context} from 'hono'
import type {Bindings} from '../../types/bindings'
import {type CurrentUser, getCurrentUser, isAdminUser} from './session'

type AuthorizedUser = {
    currentUser: CurrentUser
}

type AuthorizationFailure = {
    response: Response
}

export async function requireAdminApiUser(
    c: Context<{
        Bindings: Bindings
    }>,
): Promise<AuthorizedUser | AuthorizationFailure> {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return {response: c.json({error: 'Authentication required'}, 401)}
    }

    if (!isAdminUser(currentUser)) {
        return {response: c.json({error: 'Admin access required'}, 403)}
    }

    return {currentUser}
}
