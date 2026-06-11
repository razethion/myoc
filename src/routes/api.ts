import {Hono} from 'hono'
import {csrfProtection} from '../lib/http/csrf'
import {authRoutes} from './api/auth'
import {userRoutes} from './api/users'
import type {Bindings} from '../types/bindings'

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

apiRoutes.use('*', csrfProtection)

apiRoutes.route('/', authRoutes)
apiRoutes.route('/users', userRoutes)
