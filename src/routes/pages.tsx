import { Hono } from 'hono'
import { getCurrentUser } from '../lib/auth/session'
import type {UserSocialLink} from '../lib/socialLinks'
import type { Bindings } from '../types/bindings'
import { AuthPage } from '../views/pages/AuthPage'
import { HomePage } from '../views/pages/HomePage'
import {UserSettingsPage} from '../views/pages/UserSettingsPage'

export const pageRoutes = new Hono<{ Bindings: Bindings }>()

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters[Math.floor(Math.random() * letters.length)]
}

pageRoutes.get('/', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <HomePage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
        />,
    )
})

pageRoutes.get('/login', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <AuthPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            mode="login"
        />,
    )
})

pageRoutes.get('/register', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(
        <AuthPage
            currentUser={currentUser}
            guestInitial={getRandomLetter()}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            mode="register"
        />,
    )
})

pageRoutes.get('/settings', async (c) => {
    const currentUser = await getCurrentUser(c)

    if (!currentUser) {
        return c.redirect('/login')
    }

    const socialLinks = await getUserSocialLinks(c.env.DB, currentUser.id)

    return c.html(
        <UserSettingsPage
            currentUser={currentUser}
            mediaBaseUrl={c.env.MEDIA_PUBLIC_BASE_URL}
            socialLinks={socialLinks}
        />,
    )
})

async function getUserSocialLinks(db: D1Database, userId: string): Promise<UserSocialLink[]> {
    const result = await db.prepare(
        `SELECT platform, label, url
         FROM user_social_links
         WHERE user_id = ?
         ORDER BY platform`,
    )
        .bind(userId)
        .all<UserSocialLink>()

    return result.results ?? []
}
