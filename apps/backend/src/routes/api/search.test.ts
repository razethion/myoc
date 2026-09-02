import {describe, expect, it} from 'vitest'
import {fallbackAvatarDataUrl} from '../../lib/media/avatar'
import {seedCharacter, seedUser, useTestDatabase} from '../../test/d1'
import {createMockR2Bucket} from '../../test/mockR2'
import {apiRoutes} from '../api'

const mediaPublicBaseUrl = 'https://m.myoc.art'
const db = useTestDatabase()

function requestEnv(mediaBucket = createMockR2Bucket()) {
    return {
        DB: db,
        MEDIA_BUCKET: mediaBucket,
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    }
}

function sizeChartJson(options: {key?: string; contentType?: string} = {}) {
    const key = options.key ?? 'height-chart-image'
    const contentType = options.contentType ?? 'image/png'

    return JSON.stringify({
        version: 1,
        height: {meters: 1.82},
        image: {key, contentType, naturalWidth: 320, naturalHeight: 640},
        calibration: {
            headYPercent: 4,
            footYPercent: 96,
            footIsVirtual: false,
            nameTagXPercent: 50,
        },
    })
}

describe('GET /api/search', () => {
    it('returns the initial SvelteKit search page data', async () => {
        await seedUser({id: 'owner-1', username: 'Alice', bio: 'Makes tiny dragons'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: 'Tiny Dragon'})

        const response = await requestSearch('/search/page?q=Alice')
        const body = (await response.json()) as {
            shell: {viewer: unknown; appVersion: string}
            results: {query: string; users: {total: number}; characters: {total: number}}
        }

        expect(response.status).toBe(200)
        expect(body.shell.viewer).toBeNull()
        expect(body.shell.appVersion).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/)
        expect(body.results).toMatchObject({
            query: 'Alice',
            users: {total: 1},
            characters: {total: 1},
        })
    })

    it('rejects unsupported search types', async () => {
        const response = await requestSearch('/search?type=folders&q=test')

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({error: 'Search type must be users or characters'})
    })

    it('returns paged user search results from saved users and characters', async () => {
        for (const suffix of ['', '2', '3', '4', '5', '6']) {
            await seedUser({
                id: `user-${suffix || '1'}`,
                username: `Alice${suffix}`,
                bio: suffix ? `Another Alice ${suffix}` : 'Makes tiny dragons',
            })
        }
        await seedCharacter({id: 'alice-character-1', userId: 'user-1', name: 'Tiny Dragon'})
        await seedCharacter({id: 'alice-character-2', userId: 'user-1', name: 'Large Dragon'})

        const firstResponse = await requestSearch('/search?type=users&q=Alice')
        const firstBody = (await firstResponse.json()) as {
            total: number
            nextOffset: number | null
            hasMore: boolean
            items: Array<{id: string}>
        }
        expect(firstBody).toMatchObject({total: 6, nextOffset: 4, hasMore: true})
        expect(firstBody.items.map((item) => item.id)).toEqual(['user-1', 'user-2', 'user-3', 'user-4'])

        const response = await requestSearch('/search?type=users&q=Alice&offset=3')
        const body = (await response.json()) as {
            type: string
            query: string
            total: number
            nextOffset: number | null
            hasMore: boolean
            items: Array<{
                id: string
                username: string
                characterCount: number
                profilePhotoUrl: string
                profileUrl: string
            }>
        }

        expect(response.status).toBe(200)
        expect(body).toMatchObject({
            type: 'users',
            query: 'Alice',
            total: 6,
            nextOffset: null,
            hasMore: false,
        })
        expect(body.items.map((item) => item.id)).toEqual(['user-4', 'user-5', 'user-6'])
        expect(body.items[0]).toMatchObject({
            username: 'Alice4',
            characterCount: 0,
            profilePhotoUrl: fallbackAvatarDataUrl('Alice4'),
            profileUrl: '/u/Alice4',
        })
    })

    it('pages character search results in stable order', async () => {
        await seedUser({id: 'owner-1', username: 'maker'})
        for (let index = 0; index < 10; index += 1) {
            await seedCharacter({
                id: `character-${index}`,
                userId: 'owner-1',
                name: `Paged Character ${index.toString().padStart(2, '0')}`,
            })
        }

        const firstResponse = await requestSearch('/search?type=characters&q=Paged')
        const firstBody = (await firstResponse.json()) as {
            total: number
            nextOffset: number | null
            hasMore: boolean
            items: Array<{id: string}>
        }
        expect(firstBody).toMatchObject({total: 10, nextOffset: 8, hasMore: true})
        expect(firstBody.items.map((item) => item.id)).toEqual(Array.from({length: 8}, (_, index) => `character-${index}`))

        const secondResponse = await requestSearch('/search?type=characters&q=Paged&offset=8')
        const secondBody = (await secondResponse.json()) as typeof firstBody
        expect(secondBody).toMatchObject({total: 10, nextOffset: null, hasMore: false})
        expect(secondBody.items.map((item) => item.id)).toEqual(['character-8', 'character-9'])
    })

    it('normalizes long character searches before querying D1', async () => {
        const longQuery = 'Razeth '.repeat(20)
        const normalizedQuery = longQuery.replace(/\s+/g, ' ').trim().slice(0, 80)
        await seedUser({id: 'owner-1', username: 'Alice'})
        await seedCharacter({id: 'character-1', userId: 'owner-1', name: normalizedQuery, profileImageKey: 'profile-key'})

        const response = await requestSearch(`/search?type=characters&q=${encodeURIComponent(longQuery)}`)
        const body = (await response.json()) as {
            query: string
            wasTruncated: boolean
            total: number
            items: Array<{id: string; name: string; ownerUsername: string; profileImageUrl: string}>
        }

        expect(response.status).toBe(200)
        expect(body.query).toBe(normalizedQuery)
        expect(body.wasTruncated).toBe(true)
        expect(body.total).toBe(1)
        expect(body.items).toEqual([
            expect.objectContaining({
                id: 'character-1',
                name: normalizedQuery,
                ownerUsername: 'Alice',
                profileImageUrl: `${mediaPublicBaseUrl}/characters/owner-1/character-1/profile/profile-key.webp`,
            }),
        ])
    })
})

describe('GET /api/search/size-chart-characters', () => {
    it('returns an empty result for blank searches', async () => {
        const response = await requestSearch('/search/size-chart-characters?q=%20%20')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({query: '', wasTruncated: false, items: []})
    })

    it('treats LIKE wildcards literally and prioritizes usable height charts', async () => {
        await seedUser({id: 'owner-1', username: 'maker'})
        await seedCharacter({
            id: 'with-chart',
            userId: 'owner-1',
            name: 'Alpha_Beta',
            profileImageKey: 'profile-with',
            heightChartJson: sizeChartJson({key: 'chart-key'}),
        })
        await seedCharacter({
            id: 'invalid-chart',
            userId: 'owner-1',
            name: 'Alpha_Broken',
            profileImageKey: 'profile-invalid',
            heightChartJson: '{"image":{}}',
        })
        await seedCharacter({
            id: 'without-chart',
            userId: 'owner-1',
            name: 'Alpha_Other',
            profileImageKey: 'profile-without',
        })
        await seedCharacter({
            id: 'wildcard-decoy',
            userId: 'owner-1',
            name: 'AlphaXBeta',
            profileImageKey: 'profile-decoy',
        })

        const response = await requestSearch('/search/size-chart-characters?q=Alpha_')
        const body = (await response.json()) as {
            items: Array<{
                id: string
                hasSizeChart: boolean
                heightChart: null | {image: {url: string}}
            }>
        }

        expect(response.status).toBe(200)
        expect(body.items.map((item) => item.id)).toEqual(['with-chart', 'invalid-chart', 'without-chart'])
        expect(body.items[0]?.hasSizeChart).toBe(true)
        expect(body.items[0]?.heightChart?.image.url).toBe(`${mediaPublicBaseUrl}/characters/owner-1/with-chart/height-chart/chart-key.png`)
        expect(body.items[1]?.heightChart).toBeNull()
        expect(body.items[2]?.heightChart).toBeNull()

        const percentResponse = await requestSearch('/search/size-chart-characters?q=%25')
        const percentBody = (await percentResponse.json()) as {items: unknown[]}
        expect(percentBody.items).toEqual([])
    })

    it('uses chart defaults and ignores malformed stored chart data', async () => {
        await seedUser({id: 'owner-1', username: 'maker'})
        await seedCharacter({
            id: 'default-content-type',
            userId: 'owner-1',
            name: 'Default Chart',
            profileImageKey: 'profile-default',
            heightChartJson: JSON.stringify({
                version: 1,
                height: {meters: 1.8},
                image: {key: 'default-chart', naturalWidth: 300, naturalHeight: 600},
                calibration: {headYPercent: 5, footYPercent: 95, footIsVirtual: false},
            }),
        })
        await seedCharacter({
            id: 'scalar-chart',
            userId: 'owner-1',
            name: 'Scalar Chart',
            profileImageKey: 'profile-scalar',
            heightChartJson: 'null',
        })
        await seedCharacter({
            id: 'malformed-chart',
            userId: 'owner-1',
            name: 'Malformed Chart',
            profileImageKey: 'profile-malformed',
            heightChartJson: '{bad json',
        })

        const response = await requestSearch('/search/size-chart-characters?q=Chart')
        const body = (await response.json()) as {
            items: Array<{
                id: string
                heightChart: null | {image: {contentType: string}; calibration: {nameTagXPercent: number}}
            }>
        }

        expect(response.status).toBe(200)
        const defaultChart = body.items.find((item) => item.id === 'default-content-type')
        expect(defaultChart?.heightChart?.image.contentType).toBe('image/png')
        expect(defaultChart?.heightChart?.calibration.nameTagXPercent).toBe(50)
        expect(body.items.find((item) => item.id === 'scalar-chart')?.heightChart).toBeNull()
        expect(body.items.find((item) => item.id === 'malformed-chart')?.heightChart).toBeNull()
    })
})

describe('GET /api/search/size-chart-characters/by-id', () => {
    it('returns no items when every supplied ID is blank or invalid', async () => {
        const response = await requestSearch(`/search/size-chart-characters/by-id?ids=,%20,${'x'.repeat(65)}`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({items: []})
    })

    it('resolves legacy character IDs', async () => {
        await seedPackedCharacter('legacy-character-id', 'abcdef123456')

        const response = await requestSearch('/search/size-chart-characters/by-id?ids=legacy-character-id')
        const body = (await response.json()) as {
            items: Array<{id: string; sizeChartId: string; heightChart: {image: {url: string}}}>
        }

        expect(response.status).toBe(200)
        expect(body.items).toHaveLength(1)
        expect(body.items[0]?.id).toBe('legacy-character-id')
        expect(body.items[0]?.sizeChartId).toBe('abcdef123456')
        expect(body.items[0]?.heightChart.image.url).toBe(
            `${mediaPublicBaseUrl}/characters/owner-id/legacy-character-id/height-chart/height-chart-image.png`,
        )
    })

    it('resolves both a legacy character ID and its packed size chart ID', async () => {
        await seedPackedCharacter('legacy-character-id', 'abcdef123456')

        const response = await requestSearch('/search/size-chart-characters/by-id?ids=abcdef123456,legacy-character-id')
        const body = (await response.json()) as {items: Array<{id: string; sizeChartId: string}>}

        expect(response.status).toBe(200)
        expect(body.items).toEqual([
            expect.objectContaining({id: 'legacy-character-id', sizeChartId: 'abcdef123456'}),
            expect.objectContaining({id: 'legacy-character-id', sizeChartId: 'abcdef123456'}),
        ])
    })

    it('normalizes duplicate packed size chart IDs', async () => {
        await seedPackedCharacter('packed-character', 'abcdef123456')

        const response = await requestSearch('/search/size-chart-characters/by-id?ids=ABCDEF123456,abcdef123456')
        const body = (await response.json()) as {items: Array<{id: string}>}

        expect(response.status).toBe(200)
        expect(body.items.map((item) => item.id)).toEqual(['packed-character'])
    })

    it('limits ID lookups to the first 99 normalized IDs', async () => {
        const ids = Array.from({length: 100}, (_, index) => `character-${index}`)
        await seedUser({id: 'owner-id', username: 'owner'})
        await seedCharacter({id: 'character-99', userId: 'owner-id', name: 'Excluded Character'})

        const response = await requestSearch(`/search/size-chart-characters/by-id?ids=${ids.join(',')}`)

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({items: []})
    })

    it('handles 99 packed IDs without exceeding the D1 parameter limit', async () => {
        const ids = Array.from({length: 99}, (_, index) => (index + 1).toString(16).padStart(12, '0'))
        const lastId = ids.at(-1)
        if (!lastId) {
            throw new Error('Packed ID fixture is empty')
        }
        await seedPackedCharacter('last-packed-character', lastId)

        const response = await requestSearch(`/search/size-chart-characters/by-id?ids=${ids.join(',')}`)
        const body = (await response.json()) as {items: Array<{id: string; sizeChartId: string}>}

        expect(response.status).toBe(200)
        expect(body.items).toEqual([expect.objectContaining({id: 'last-packed-character', sizeChartId: lastId})])
    })
})

async function requestSearch(path: string): Promise<Response> {
    return apiRoutes.request(`https://example.com${path}`, {headers: {accept: 'application/json'}}, requestEnv())
}

async function seedPackedCharacter(characterId: string, sizeChartId: string): Promise<void> {
    await seedUser({id: 'owner-id', username: 'owner'})
    await seedCharacter({
        id: characterId,
        userId: 'owner-id',
        name: 'Vyn',
        profileImageKey: 'profile-key',
        sizeChartId: hexBytes(sizeChartId),
        heightChartJson: sizeChartJson(),
    })
}

function hexBytes(value: string): Uint8Array {
    if (!/^[0-9a-f]{12}$/i.test(value)) {
        throw new Error(`Invalid packed size chart ID fixture: ${value}`)
    }

    const bytes = new Uint8Array(6)
    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
    }
    return bytes
}
