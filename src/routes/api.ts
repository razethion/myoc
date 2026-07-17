import {Hono} from 'hono'
import {csrfProtection} from '../lib/http/csrf'
import type {Bindings} from '../types/bindings'
import {adminRoutes} from './api/admin'
import {characterRoutes} from './api/characters'
import {searchRoutes} from './api/search'
import {securityRoutes} from './api/security'
import {userRoutes} from './api/users'

export const apiRoutes = new Hono<{Bindings: Bindings}>()

apiRoutes.use('*', csrfProtection)

apiRoutes.route('/admin', adminRoutes)
apiRoutes.route('/characters', characterRoutes)
apiRoutes.route('/search', searchRoutes)
apiRoutes.route('/security', securityRoutes)
apiRoutes.route('/users', userRoutes)
