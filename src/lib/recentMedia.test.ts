import {afterEach, describe, expect, it} from 'vitest'
import {createMockDb} from '../test/mockD1'
import {createMockKVNamespace} from '../test/mockKV'
import {resetWorkerBindings} from '../test/workerBindings'
import {getRecentMediaPage, InvalidRecentMediaCursorError, RECENT_MEDIA_PAGE_SIZE} from './recentMedia'

const mediaBaseUrl = 'https://m.myoc.art'
const RECENT_MEDIA_CACHE_TTL_SECONDS = 2 * 60

afterEach(async () => {
    await resetWorkerBindings()
})

function recentMediaRow(index: number, overrides: Record<string, unknown> = {}) {
    const id = `media-${String(index).padStart(2, '0')}`

    return {
        id,
        user_id: 'user-1',
        character_id: 'character-1',
        sfw_image_key: `original-${id}`,
        sfw_preview_image_key: `preview-${id}`,
        sfw_content_type: 'image/png',
        sfw_artist: 'Demo Artist',
        sfw_width: 1200,
        sfw_height: 1600,
        sfw_preview_width: 600,
        sfw_preview_height: 800,
        sfw_review_status: 'pending',
        sfw_approved_at: null,
        nsfw_image_key: null,
        nsfw_preview_image_key: null,
        nsfw_content_type: null,
        nsfw_width: null,
        nsfw_height: null,
        nsfw_preview_width: null,
        nsfw_preview_height: null,
        nsfw_review_status: 'pending',
        nsfw_approved_at: null,
        created_at: `2026-08-23 12:${String(59 - index).padStart(2, '0')}:00`,
        updated_at: `2026-08-23 12:${String(59 - index).padStart(2, '0')}:00`,
        character_name: 'Quartz Dragon',
        character_profile_image_key: 'character-profile',
        owner_username: 'demo_owner',
        owner_profile_photo_key: 'owner-profile',
        ...overrides,
    }
}

describe('recent media feed', () => {
    it('returns newest uploads with a stable cursor and caches each query for two minutes', async () => {
        const rows = Array.from({length: RECENT_MEDIA_PAGE_SIZE + 1}, (_, index) => recentMediaRow(index))
        const {db, boundStatements} = createMockDb({allResults: [rows]})
        const cache = createMockKVNamespace()

        const firstPage = await getRecentMediaPage(cache, db, mediaBaseUrl)
        const cachedPage = await getRecentMediaPage(cache, db, mediaBaseUrl)

        expect(firstPage.items).toHaveLength(RECENT_MEDIA_PAGE_SIZE)
        expect(firstPage.items[0]).toEqual({
            id: 'media-00',
            alt: 'Quartz Dragon character art',
            width: 600,
            height: 800,
            previewSrc: 'https://m.myoc.art/characters/user-1/character-1/media/media-00/sfw/preview/preview-media-00.webp',
            originalSrc: 'https://m.myoc.art/characters/user-1/character-1/media/media-00/sfw/original-media-00.png',
            character: {
                name: 'Quartz Dragon',
                href: '/u/demo_owner/Quartz%20Dragon',
                avatarUrl: 'https://m.myoc.art/characters/user-1/character-1/profile/character-profile.webp',
            },
            user: {
                username: 'demo_owner',
                href: '/u/demo_owner',
                avatarUrl: 'https://m.myoc.art/users/user-1/profile/owner-profile.webp',
                initial: 'D',
            },
        })
        expect(firstPage.nextCursor).toBeTruthy()
        expect(cachedPage).toEqual(firstPage)
        expect(db.prepare).toHaveBeenCalledTimes(1)
        expect(boundStatements[0]?.binds).toEqual([RECENT_MEDIA_PAGE_SIZE + 1])
        expect(boundStatements[0]?.sql).toContain('ORDER BY character_media.created_at DESC, character_media.id DESC')
        expect(cache.get).toHaveBeenCalledWith('recent-media:v3:24:n0:u1:first', {
            type: 'json',
            cacheTtl: RECENT_MEDIA_CACHE_TTL_SECONDS,
        })
        expect(cache.put).toHaveBeenCalledWith('recent-media:v3:24:n0:u1:first', JSON.stringify(firstPage), {
            expirationTtl: RECENT_MEDIA_CACHE_TTL_SECONDS,
        })
    })

    it('prefers NSFW variants and falls back to approved SFW media when unapproved uploads are hidden', async () => {
        const row = recentMediaRow(0, {
            sfw_review_status: 'approved',
            sfw_approved_at: '2026-08-23 13:00:00',
            nsfw_image_key: 'nsfw-original',
            nsfw_preview_image_key: 'nsfw-preview',
            nsfw_content_type: 'image/webp',
            nsfw_width: 1000,
            nsfw_height: 1400,
            nsfw_preview_width: 500,
            nsfw_preview_height: 700,
        })
        const visibleUnapproved = createMockDb({allResults: [[row]]})
        const hiddenUnapproved = createMockDb({allResults: [[row]]})

        const nsfwPage = await getRecentMediaPage(createMockKVNamespace(), visibleUnapproved.db, mediaBaseUrl, {
            showNsfw: true,
            showUnapproved: true,
        })
        const approvedPage = await getRecentMediaPage(createMockKVNamespace(), hiddenUnapproved.db, mediaBaseUrl, {
            showNsfw: true,
            showUnapproved: false,
        })

        expect(nsfwPage.items[0]?.previewSrc).toContain('/nsfw/preview/nsfw-preview.webp')
        expect(nsfwPage.items[0]?.width).toBe(500)
        expect(approvedPage.items[0]?.previewSrc).toContain('/sfw/preview/preview-media-00.webp')
        expect(hiddenUnapproved.boundStatements[0]?.sql).toContain("character_media.nsfw_review_status = 'approved'")
        expect(hiddenUnapproved.boundStatements[0]?.sql).toContain("character_media.sfw_review_status = 'approved'")
    })

    it('uses both upload time and media id for keyset pagination', async () => {
        const firstRows = Array.from({length: RECENT_MEDIA_PAGE_SIZE + 1}, (_, index) => recentMediaRow(index))
        const first = createMockDb({allResults: [firstRows]})
        const firstPage = await getRecentMediaPage(createMockKVNamespace(), first.db, mediaBaseUrl)
        const next = createMockDb({allResults: [[recentMediaRow(24)]]})

        const secondPage = await getRecentMediaPage(createMockKVNamespace(), next.db, mediaBaseUrl, {
            cursor: firstPage.nextCursor,
        })

        expect(secondPage.items.map((item) => item.id)).toEqual(['media-24'])
        expect(secondPage.nextCursor).toBeNull()
        expect(next.boundStatements[0]?.binds).toEqual([
            '2026-08-23 12:36:00',
            '2026-08-23 12:36:00',
            'media-23',
            RECENT_MEDIA_PAGE_SIZE + 1,
        ])
        expect(next.boundStatements[0]?.sql).toContain('character_media.created_at = ? AND character_media.id < ?')
    })

    it('rejects malformed cursors before querying D1', async () => {
        const {db} = createMockDb()

        await expect(getRecentMediaPage(createMockKVNamespace(), db, mediaBaseUrl, {cursor: 'not+a+cursor'})).rejects.toBeInstanceOf(
            InvalidRecentMediaCursorError,
        )
        expect(db.prepare).not.toHaveBeenCalled()
    })
})
