import {Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {createWorkerEnv} from '../../test/workerBindings'
import type {Bindings} from '../../types/bindings'
import {recentMediaRoutes} from './recentMedia'

const app = new Hono<{Bindings: Bindings}>().route('/api/recent-media', recentMediaRoutes)

describe('recent media API', () => {
    it('rejects requests for unapproved public media', async () => {
        const response = await app.request('https://example.com/api/recent-media?unapproved=true', {}, createWorkerEnv())

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Recent media query is invalid'})
    })
})
