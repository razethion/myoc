import { Hono } from 'hono'
import { getCurrentUser } from '../lib/auth/session'
import type { Bindings } from '../types/bindings'
import { AuthPage } from '../views/pages/AuthPage'
import { HomePage } from '../views/pages/HomePage'

export const pageRoutes = new Hono<{ Bindings: Bindings }>()

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters[Math.floor(Math.random() * letters.length)]
}

pageRoutes.get('/', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(<HomePage currentUser={currentUser} guestInitial={getRandomLetter()} />)
})

pageRoutes.get('/login', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(<AuthPage currentUser={currentUser} guestInitial={getRandomLetter()} mode="login" />)
})

pageRoutes.get('/register', async (c) => {
    const currentUser = await getCurrentUser(c)

    return c.html(<AuthPage currentUser={currentUser} guestInitial={getRandomLetter()} mode="register" />)
})
