import { Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { Bindings } from '../types/env'
import { hashSessionToken } from './sessions'
import { User } from '../types/user'

export async function getCurrentUser(
    c: Context<{ Bindings: Bindings }>
): Promise<User | null> {
    const sessionToken = getCookie(c, 'session')

    if (!sessionToken) {
        return null
    }

    const sessionHash = await hashSessionToken(sessionToken)

    const user = await c.env.DB
        .prepare(`
            SELECT
                users.id,
                users.email,
                users.username,
                users.bio,
                users.profile_photo_key
            FROM sessions
                     JOIN users ON users.id = sessions.user_id
            WHERE sessions.session_hash = ?
              AND sessions.expires_at > CURRENT_TIMESTAMP
            LIMIT 1
        `)
        .bind(sessionHash)
        .first<User>()

    return user ?? null
}