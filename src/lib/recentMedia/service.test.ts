import {describe, expect, it} from 'vitest'
import type {Bindings} from '../../types/bindings'
import {RecentFeedGenerationExpiredError} from './reader'
import {getConfiguredRecentMediaPage} from './service'

describe('configured recent media service', () => {
    it('expires a legacy D1 cursor after R2 cutover', async () => {
        await expect(
            getConfiguredRecentMediaPage(
                {
                    RECENT_FEED_READ_MODE: 'r2',
                } as unknown as Bindings,
                {cursor: 'WyIyMDI2LTA4LTI1IDEyOjAwOjAwIiwibWVkaWEtMSJd'},
            ),
        ).rejects.toBeInstanceOf(RecentFeedGenerationExpiredError)
    })

    it('expires an R2 cursor after a D1 rollback', async () => {
        await expect(
            getConfiguredRecentMediaPage(
                {
                    RECENT_FEED_READ_MODE: 'd1',
                } as unknown as Bindings,
                {cursor: 'r1.payload.signature'},
            ),
        ).rejects.toBeInstanceOf(RecentFeedGenerationExpiredError)
    })
})
