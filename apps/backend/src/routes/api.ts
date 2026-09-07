import {Hono} from 'hono'
import {csrfProtection} from '../lib/http/csrf'
import type {Bindings} from '../types/bindings'
import {adminRoutes} from './api/admin'
import {characterRoutes} from './api/characters'
import {imageUploadBatchRoutes, imageUploadRoutes} from './api/imageUploads'
import {recentMediaRoutes} from './api/recentMedia'
import {searchRoutes} from './api/search'
import {securityRoutes} from './api/security'
import {userRoutes} from './api/users'

export const apiRoutes = new Hono<{Bindings: Bindings}>()

apiRoutes.use('*', csrfProtection)

apiRoutes.route('/admin', adminRoutes)
apiRoutes.route('/characters', characterRoutes)
apiRoutes.route('/image-uploads', imageUploadRoutes)
apiRoutes.route('/image-upload-batches', imageUploadBatchRoutes)
apiRoutes.route('/recent-media', recentMediaRoutes)
apiRoutes.route('/search', searchRoutes)
apiRoutes.route('/security', securityRoutes)
apiRoutes.route('/users', userRoutes)
