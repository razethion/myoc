import {describe, expect, it, vi} from 'vitest'
import {seedCharacter, seedMedia, seedUser, useTestDatabase} from '../test/d1'
import {createMockKVNamespace} from '../test/mockKV'
import {createMockR2Bucket} from '../test/mockR2'
import {getLeaderboardSnapshot, refreshLeaderboard} from './leaderboard'

const LEADERBOARD_CACHE_KEY = 'leaderboard:daily:v1'
const db = useTestDatabase()

describe('refreshLeaderboard', () => {
    it('stores daily leaderboard rankings in KV', async () => {
        await seedUser({id: 'user-1', username: 'alice'})
        await seedUser({id: 'user-2', username: 'bob', profilePhotoKey: 'bob-photo'})
        await seedUser({id: 'user-3', username: 'inactive'})
        await seedCharacter({id: 'char-1', userId: 'user-1', name: 'Aster', profileImageKey: 'aster-profile'})
        await seedCharacter({id: 'char-2', userId: 'user-2', name: 'Beryl', profileImageKey: 'beryl-profile'})
        await seedCharacter({id: 'char-3', userId: 'user-1', name: 'Cinder'})
        await seedCharacter({id: 'char-4', userId: 'user-1', name: 'Dahlia'})
        await seedMedia({id: 'media-1', userId: 'user-1', characterId: 'char-1', sfwImageKey: 'alice-sfw-1'})
        await seedMedia({id: 'media-3', userId: 'user-1', characterId: 'char-3', sfwImageKey: 'alice-sfw-2'})
        await seedMedia({
            id: 'media-2',
            userId: 'user-2',
            characterId: 'char-2',
            sfwImageKey: 'bob-sfw-1',
            nsfwImageKey: 'bob-nsfw-1',
        })
        await seedMedia({
            id: 'media-4',
            userId: 'user-2',
            characterId: 'char-2',
            sfwImageKey: 'bob-sfw-2',
            nsfwImageKey: 'bob-nsfw-2',
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
        const snapshot = await getLeaderboardSnapshot(cache)
        expect(snapshot).not.toBeNull()
        if (!snapshot) {
            throw new Error('Leaderboard snapshot was not stored')
        }

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
        const largestCharacter = snapshot.charactersByData[0]
        if (!largestCharacter) {
            throw new Error('Leaderboard snapshot has no character rankings')
        }
        expect(largestCharacter.monthlyStorageCostUsd).toBeCloseTo((2_098_688 / (1024 * 1024 * 1024)) * 0.015)
    })

    it('reads all R2 listing pages', async () => {
        const bucket = createMockR2Bucket()
        vi.mocked(bucket.list).mockImplementation(async (options) => {
            if (options?.prefix === 'users/' && !options.cursor) {
                return {
                    objects: [],
                    truncated: true,
                    cursor: 'next-page',
                    delimitedPrefixes: [],
                }
            }

            if (options?.prefix === 'users/' && options.cursor === 'next-page') {
                return {
                    objects: [
                        {
                            key: 'users/alice/profile/photo.webp',
                            size: 10,
                        } as R2Object,
                    ],
                    truncated: false,
                    delimitedPrefixes: [],
                }
            }

            if (options?.prefix === 'characters/') {
                return {objects: [], truncated: false, delimitedPrefixes: []}
            }

            throw new Error(`Unexpected R2 list options: ${JSON.stringify(options)}`)
        })

        const summary = await refreshLeaderboard({DB: db, MEDIA_BUCKET: bucket, CACHE: createMockKVNamespace()})

        expect(summary).toMatchObject({scannedObjects: 1, recognizedObjects: 1, totalManagedBytes: 10})
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
