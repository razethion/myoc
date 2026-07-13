import {describe, expect, it, vi} from 'vitest'
import {createMockDb} from '../test/mockD1'
import {createMockKVNamespace} from '../test/mockKV'
import {createMockR2Bucket} from '../test/mockR2'
import {getLeaderboardSnapshot, LEADERBOARD_CACHE_KEY, refreshLeaderboard} from './leaderboard'

describe('refreshLeaderboard', () => {
    it('stores daily leaderboard rankings in KV', async () => {
        const {db} = createMockDb({
            firstResults: [
                {
                    total_users: 3,
                    total_characters: 4,
                    total_images: 6,
                },
            ],
            allResults: [
                [
                    {
                        id: 'user-1',
                        username: 'alice',
                        profile_photo_key: null,
                        character_count: 3,
                    },
                    {
                        id: 'user-2',
                        username: 'bob',
                        profile_photo_key: 'bob-photo',
                        character_count: 1,
                    },
                ],
                [
                    {
                        id: 'user-2',
                        username: 'bob',
                        profile_photo_key: 'bob-photo',
                        image_count: 4,
                    },
                    {
                        id: 'user-1',
                        username: 'alice',
                        profile_photo_key: null,
                        image_count: 2,
                    },
                ],
                [
                    {
                        id: 'user-1',
                        username: 'alice',
                        profile_photo_key: null,
                        character_count: 3,
                        image_count: 2,
                    },
                    {
                        id: 'user-2',
                        username: 'bob',
                        profile_photo_key: 'bob-photo',
                        character_count: 1,
                        image_count: 4,
                    },
                ],
                [
                    {
                        id: 'user-1',
                        username: 'alice',
                        profile_photo_key: null,
                    },
                    {
                        id: 'user-2',
                        username: 'bob',
                        profile_photo_key: 'bob-photo',
                    },
                ],
                [
                    {
                        id: 'char-1',
                        user_id: 'user-1',
                        name: 'Aster',
                        profile_image_key: 'aster-profile',
                        owner_username: 'alice',
                    },
                    {
                        id: 'char-2',
                        user_id: 'user-2',
                        name: 'Beryl',
                        profile_image_key: 'beryl-profile',
                        owner_username: 'bob',
                    },
                ],
            ],
        })
        const bucket = createMockR2Bucket()
        const cache = createMockKVNamespace()

        await bucket.put('users/user-1/profile/alice-photo.webp', bytes(100))
        await bucket.put('characters/user-1/folders/folder-1/image/folder-image.webp', bytes(300))
        await bucket.put('characters/user-1/char-1/profile/aster-profile.webp', bytes(200))
        await bucket.put('characters/user-1/char-1/media/media-1/sfw/full.png', bytes(1024 * 1024))
        await bucket.put('characters/user-1/char-1/media/media-1/sfw/preview/preview.webp', bytes(100))
        await bucket.put('characters/user-1/char-1/height-chart/chart.png', bytes(500))
        await bucket.put('characters/user-2/char-2/media/media-2/nsfw/full.png', bytes(2 * 1024 * 1024))
        await bucket.put('characters/user-2/char-2/media/media-2/nsfw/preview/preview.webp', bytes(1024))
        await bucket.put('characters/user-2/char-2/media/media-2/nsfw/blur/blur.webp', bytes(512))
        await bucket.put('characters/user-1/char-1/scratch/stale.webp', bytes(10))

        const summary = await refreshLeaderboard(
            {
                DB: db,
                MEDIA_BUCKET: bucket,
                CACHE: cache,
            },
            new Date('2026-07-12T10:00:00Z'),
        )

        expect(summary).toEqual(
            expect.objectContaining({
                generatedAt: '2026-07-12T10:00:00.000Z',
                key: LEADERBOARD_CACHE_KEY,
                rankedTopUsers: 2,
                recognizedObjects: 9,
                scannedObjects: 10,
                skippedUnknownObjects: 1,
                totalManagedBytes: 3_148_464,
            }),
        )
        expect(cache.put).toHaveBeenCalledTimes(1)

        const [key, value] = vi.mocked(cache.put).mock.calls[0] ?? []
        expect(key).toBe(LEADERBOARD_CACHE_KEY)

        const snapshot = JSON.parse(String(value))

        expect(snapshot.topUsers).toEqual([
            expect.objectContaining({rank: 1, username: 'alice', characterCount: 3, imageCount: 2, bytes: 1_049_776}),
            expect.objectContaining({rank: 2, username: 'bob', characterCount: 1, imageCount: 4, bytes: 2_098_688}),
        ])
        expect(snapshot).toEqual(
            expect.objectContaining({
                totalUsers: 3,
                totalCharacters: 4,
                totalImages: 6,
                totalManagedBytes: 3_148_464,
            }),
        )
        expect(snapshot.usersByCharacters).toEqual([
            expect.objectContaining({rank: 1, username: 'alice', characterCount: 3}),
            expect.objectContaining({rank: 2, username: 'bob', characterCount: 1}),
        ])
        expect(snapshot.usersByImages).toEqual([
            expect.objectContaining({rank: 1, username: 'bob', imageCount: 4}),
            expect.objectContaining({rank: 2, username: 'alice', imageCount: 2}),
        ])
        expect(snapshot.usersByData).toEqual([
            expect.objectContaining({rank: 1, username: 'bob', bytes: 2_098_688}),
            expect.objectContaining({rank: 2, username: 'alice', bytes: 1_049_776}),
        ])
        expect(snapshot.charactersByData).toEqual([
            expect.objectContaining({rank: 1, name: 'Beryl', ownerUsername: 'bob', bytes: 2_098_688}),
            expect.objectContaining({rank: 2, name: 'Aster', ownerUsername: 'alice', bytes: 1_049_376}),
        ])
        expect(snapshot.charactersByData[0].monthlyStorageCostUsd).toBeCloseTo((2_098_688 / (1024 * 1024 * 1024)) * 0.015)
        await expect(getLeaderboardSnapshot(cache)).resolves.toEqual(snapshot)
    })
})

describe('getLeaderboardSnapshot', () => {
    it('ignores malformed KV payloads', async () => {
        const cache = createMockKVNamespace({
            values: {
                [LEADERBOARD_CACHE_KEY]: {
                    version: 2,
                },
            },
        })

        await expect(getLeaderboardSnapshot(cache)).resolves.toBeNull()
    })
})

function bytes(size: number): Uint8Array {
    return new Uint8Array(size)
}
