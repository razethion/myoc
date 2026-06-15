import {Hono} from 'hono'
import {csrfProtection} from '../lib/http/csrf'
import {adminRoutes} from './api/admin'
import {authRoutes} from './api/auth'
import {characterRoutes} from './api/characters'
import {searchRoutes} from './api/search'
import {userRoutes} from './api/users'
import type {Bindings} from '../types/bindings'

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

apiRoutes.use('*', csrfProtection)

apiRoutes.route('/', authRoutes)
apiRoutes.route('/admin', adminRoutes)
apiRoutes.route('/characters', characterRoutes)
apiRoutes.route('/search', searchRoutes)
apiRoutes.route('/users', userRoutes)
