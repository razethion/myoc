import { Hono } from 'hono'
import { HomePage } from '../views/pages/HomePage'

export const pageRoutes = new Hono()

function getRandomLetter(): string {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    return letters[Math.floor(Math.random() * letters.length)]
}

pageRoutes.get('/', (c) => {
    return c.html(<HomePage guestInitial={getRandomLetter()} />)
})
