import {describe, expect, it} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import {queryRecentMediaSourceRows} from './recentMedia'

const db = useTestDatabase()

describe('recent media publication source', () => {
    it('returns only media with a current approval', async () => {
        await seedUser({id: 'user-1'})
        await seedCharacter({id: 'character-1', userId: 'user-1'})
        await seedMedia({
            id: 'approved-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'approved-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 12:00:00',
            createdAt: '2026-08-25 12:00:00',
            updatedAt: '2026-08-25 12:00:00',
        })
        await seedMedia({
            id: 'pending-media',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'pending-preview',
            sfwReviewStatus: 'pending',
            createdAt: '2026-08-25 11:00:00',
            updatedAt: '2026-08-25 11:00:00',
        })
        await seedMedia({
            id: 'changed-after-approval',
            userId: 'user-1',
            characterId: 'character-1',
            sfwPreviewImageKey: 'changed-preview',
            sfwReviewStatus: 'approved',
            sfwApprovedAt: '2026-08-25 09:00:00',
            createdAt: '2026-08-25 10:00:00',
            updatedAt: '2026-08-25 10:00:00',
        })

        const rows = await queryRecentMediaSourceRows(db)

        expect(rows.map((row) => row.id)).toEqual(['approved-media'])
    })
})
