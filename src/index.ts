import { Hono } from 'hono'
import { authRoutes } from './routes/auth'
import { Bindings } from './types/env'

const app = new Hono<{ Bindings: Bindings }>()

app.route('/api/auth', authRoutes)

app.get('/api/health', async (c) => {
  const result = await c.env.DB
      .prepare('SELECT COUNT(*) AS count FROM users')
      .first<{ count: number }>()

  return c.json({
    status: 'ok',
    userCount: result?.count ?? 0
  })
})

export default app