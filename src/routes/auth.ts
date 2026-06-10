import { Hono } from 'hono'
import bcrypt from 'bcryptjs'

type Bindings = {
    DB: D1Database
}

export const authRoutes = new Hono<{ Bindings: Bindings }>()

function isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function isValidUsername(username: string): boolean {
    return /^[a-z0-9_-]{3,32}$/.test(username)
}

function isValidPassword(password: string): boolean {
    return password.length >= 12 && password.length <= 128
}

authRoutes.post('/register', async (c) => {
    const body = await c.req.json()

    const email = body.email?.trim().toLowerCase()
    const username = body.username?.trim().toLowerCase()
    const password = body.password

    if (!email || !username || !password) {
        return c.json(
            {
                error: 'Missing required fields'
            },
            400
        )
    }

    if (!isValidEmail(email)) {
        return c.json(
            {
                error: 'Invalid email address'
            },
            400
        )
    }

    if (!isValidUsername(username)) {
        return c.json(
            {
                error:
                    'Username must be 3-32 characters and contain only lowercase letters, numbers, underscores, or hyphens'
            },
            400
        )
    }

    if (!isValidPassword(password)) {
        return c.json(
            {
                error: 'Password must be between 12 and 128 characters'
            },
            400
        )
    }

    const existingUser = await c.env.DB
        .prepare(`
      SELECT id
      FROM users
      WHERE email = ?
         OR username = ?
    `)
        .bind(email, username)
        .first()

    if (existingUser) {
        return c.json(
            {
                error: 'Email or username already exists'
            },
            409
        )
    }

    const passwordHash = await bcrypt.hash(password, 12)

    const id = crypto.randomUUID()

    await c.env.DB
        .prepare(`
            INSERT INTO users (
                id,
                email,
                username,
                password_hash,
                bio
            )
            VALUES (?, ?, ?, ?, ?)
        `)
        .bind(
            id,
            email,
            username,
            passwordHash,
            ''
        )
        .run()

    return c.json({
        success: true,
        userId: id
    })
})