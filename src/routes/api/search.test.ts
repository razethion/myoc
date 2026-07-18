import {describe, expect, it} from 'vitest'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'
import {apiRoutes} from '../api'

const mediaPublicBaseUrl = 'https://m.myoc.art'

function requestEnv(db: D1Database, mediaBucket = createMockR2Bucket()) {
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
        height: {
            meters: 1.82,
        },
        image: {
            key,
            contentType,
            naturalWidth: 320,
            naturalHeight: 640,
        },
        calibration: {
            headYPercent: 4,
            footYPercent: 96,
            footIsVirtual: false,
            nameTagXPercent: 50,
        },
    })
}

describe('GET /api/search', () => {
    it('rejects unsupported search types', async () => {
        const {db} = createMockDb()

        const response = await apiRoutes.request(
            'https://example.com/search?type=folders&q=test',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toEqual({
            error: 'Search type must be users or characters',
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('returns paged user search results', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'user-1',
                        username: 'Alice',
                        bio: 'Makes tiny dragons',
                        profile_photo_key: null,
                        character_count: 2,
                    },
                ],
            ],
            firstResults: [{count: 1}],
        })

        const response = await apiRoutes.request(
            'https://example.com/search?type=users&q=Alice&offset=3',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.binds.at(-1)).toBe(3)
        expect(await response.json()).toEqual({
            type: 'users',
            query: 'Alice',
            wasTruncated: false,
            total: 1,
            nextOffset: null,
            hasMore: false,
            items: [
                {
                    id: 'user-1',
                    username: 'Alice',
                    bio: 'Makes tiny dragons',
                    profilePhotoUrl: 'https://ui-avatars.com/api/?name=A&background=ccc&color=000',
                    profileUrl: '/u/Alice',
                    characterCount: 2,
                },
            ],
        })
    })

    it('returns paged character search results', async () => {
        const longQuery = 'Razeth '.repeat(20)
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'character-1',
                        name: 'Razeth',
                        profile_image_key: 'profile-key',
                        user_id: 'owner-1',
                        username: 'Alice',
                    },
                ],
            ],
            firstResults: [{count: 1}],
        })

        const response = await apiRoutes.request(
            `https://example.com/search?type=characters&q=${encodeURIComponent(longQuery)}`,
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.binds.at(-2)).toBe(9)
        expect(await response.json()).toEqual({
            type: 'characters',
            query: 'Razeth Razeth Razeth Razeth Razeth Razeth Razeth Razeth Razeth Razeth Razeth Raz',
            wasTruncated: true,
            total: 1,
            nextOffset: null,
            hasMore: false,
            items: [
                {
                    id: 'character-1',
                    name: 'Razeth',
                    ownerId: 'owner-1',
                    ownerUsername: 'Alice',
                    profileImageUrl: `${mediaPublicBaseUrl}/characters/owner-1/character-1/profile/profile-key.webp`,
                    characterUrl: '/u/Alice/Razeth',
                },
            ],
        })
    })
})

describe('GET /api/search/size-chart-characters', () => {
    it('returns an empty result without querying D1 for blank searches', async () => {
        const {db} = createMockDb()

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters?q=%20%20',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            query: '',
            wasTruncated: false,
            items: [],
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('escapes LIKE terms and prioritizes characters with height chart images', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'without-chart',
                        size_chart_id: '111111111111',
                        name: 'Alpha Beta',
                        user_id: 'owner-1',
                        username: 'maker',
                        profile_image_key: 'profile-without',
                        height_chart_json: '',
                    },
                    {
                        id: 'with-chart',
                        size_chart_id: '222222222222',
                        name: 'Alpha% Beta_',
                        user_id: 'owner-2',
                        username: 'artist',
                        profile_image_key: 'profile-with',
                        height_chart_json: sizeChartJson({key: 'chart/key'}),
                    },
                    {
                        id: 'invalid-chart',
                        size_chart_id: '333333333333',
                        name: 'Alpha Beta Broken',
                        user_id: 'owner-3',
                        username: 'artist',
                        profile_image_key: 'profile-invalid',
                        height_chart_json: '{"image":{}}',
                    },
                ],
            ],
        })

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters?q=Alpha%25%20Beta_',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.sql).toContain("LIKE ? ESCAPE '\\'")
        expect(boundStatements[0]?.binds.slice(0, 4)).toEqual(['%alpha\\%%', '%alpha\\%%', '%beta\\_%', '%beta\\_%'])

        const body = (await response.json()) as {
            items: {
                id: string
                hasSizeChart: boolean
                heightChart: null | {
                    image: {
                        url: string
                    }
                }
            }[]
        }

        expect(body.items.map((item) => item.id)).toEqual(['with-chart', 'without-chart', 'invalid-chart'])
        expect(body.items[0]?.hasSizeChart).toBe(true)
        expect(body.items[0]?.heightChart?.image.url).toBe(`${mediaPublicBaseUrl}/characters/owner-2/with-chart/height-chart/chart/key.png`)
        expect(body.items[1]?.heightChart).toBeNull()
        expect(body.items[2]?.heightChart).toBeNull()
    })

    it('uses default chart image metadata and ignores malformed chart JSON', async () => {
        const {db} = createMockDb({
            allResults: [
                [
                    {
                        id: 'default-content-type',
                        size_chart_id: '111111111111',
                        name: 'Default Chart',
                        user_id: 'owner-1',
                        username: 'maker',
                        profile_image_key: 'profile-default',
                        height_chart_json: JSON.stringify({
                            version: 1,
                            height: {
                                meters: 1.8,
                            },
                            image: {
                                key: 'default-chart',
                                naturalWidth: 300,
                                naturalHeight: 600,
                            },
                            calibration: {
                                headYPercent: 5,
                                footYPercent: 95,
                                footIsVirtual: false,
                            },
                        }),
                    },
                    {
                        id: 'scalar-chart',
                        size_chart_id: '222222222222',
                        name: 'Scalar Chart',
                        user_id: 'owner-2',
                        username: 'maker',
                        profile_image_key: 'profile-scalar',
                        height_chart_json: 'null',
                    },
                    {
                        id: 'malformed-chart',
                        size_chart_id: '333333333333',
                        name: 'Malformed Chart',
                        user_id: 'owner-3',
                        username: 'maker',
                        profile_image_key: 'profile-malformed',
                        height_chart_json: '{bad json',
                    },
                ],
            ],
        })

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters?q=Chart',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)

        const body = (await response.json()) as {
            items: {
                id: string
                heightChart: null | {
                    image: {
                        contentType: string
                    }
                    calibration: {
                        nameTagXPercent: number
                    }
                }
            }[]
        }

        expect(body.items[0]?.id).toBe('default-content-type')
        expect(body.items[0]?.heightChart?.image.contentType).toBe('image/png')
        expect(body.items[0]?.heightChart?.calibration.nameTagXPercent).toBe(50)
        expect(body.items[1]?.heightChart).toBeNull()
        expect(body.items[2]?.heightChart).toBeNull()
    })
})

describe('GET /api/search/size-chart-characters/by-id', () => {
    it('returns no items when every supplied ID is blank or invalid', async () => {
        const {db} = createMockDb()

        const response = await apiRoutes.request(
            `https://example.com/search/size-chart-characters/by-id?ids=,%20,${'x'.repeat(65)}`,
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            items: [],
        })
        expect(db.prepare).not.toHaveBeenCalled()
    })

    it('resolves legacy character IDs', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'legacy-character-id',
                        size_chart_id: 'abcdef123456',
                        name: 'Vyn',
                        user_id: 'owner-id',
                        username: 'owner',
                        profile_image_key: 'profile-key',
                        height_chart_json: sizeChartJson(),
                    },
                ],
            ],
        })

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters/by-id?ids=legacy-character-id',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.sql).toContain('characters.id IN (?)')
        expect(boundStatements[0]?.sql).not.toContain('lower(hex(characters.size_chart_id)) IN')
        expect(boundStatements[0]?.binds).toEqual(['legacy-character-id'])

        const body = (await response.json()) as {
            items: {
                id: string
                sizeChartId: string
                heightChart: {
                    image: {
                        url: string
                    }
                }
            }[]
        }

        expect(body.items).toHaveLength(1)
        expect(body.items[0]?.id).toBe('legacy-character-id')
        expect(body.items[0]?.sizeChartId).toBe('abcdef123456')
        expect(body.items[0]?.heightChart.image.url).toBe(
            `${mediaPublicBaseUrl}/characters/owner-id/legacy-character-id/height-chart/height-chart-image.png`,
        )
    })

    it('resolves legacy character IDs and packed size chart IDs', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'legacy-character-id',
                        size_chart_id: 'abcdef123456',
                        name: 'Vyn',
                        user_id: 'owner-id',
                        username: 'owner',
                        profile_image_key: 'profile-key',
                        height_chart_json: sizeChartJson(),
                    },
                ],
            ],
        })

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters/by-id?ids=abcdef123456,legacy-character-id',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.sql).toContain('characters.size_chart_id')
        expect(boundStatements[0]?.sql).toContain('lower(hex(characters.size_chart_id))')
        expect(boundStatements[0]?.binds).toEqual(['abcdef123456', 'legacy-character-id', 'abcdef123456'])

        const body = (await response.json()) as {
            items: {
                id: string
                sizeChartId: string
                heightChart: {
                    image: {
                        url: string
                    }
                }
            }[]
        }

        expect(body.items).toHaveLength(2)
        expect(body.items[0]?.id).toBe('legacy-character-id')
        expect(body.items[0]?.sizeChartId).toBe('abcdef123456')
        expect(body.items[0]?.heightChart.image.url).toBe(
            `${mediaPublicBaseUrl}/characters/owner-id/legacy-character-id/height-chart/height-chart-image.png`,
        )
        expect(body.items[1]?.id).toBe('legacy-character-id')
    })

    it('normalizes duplicate packed size chart IDs before querying', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [[]],
        })

        const response = await apiRoutes.request(
            'https://example.com/search/size-chart-characters/by-id?ids=ABCDEF123456,abcdef123456,legacy-id',
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.binds).toEqual(['abcdef123456', 'legacy-id', 'abcdef123456'])
        expect(await response.json()).toEqual({
            items: [],
        })
    })

    it('limits ID lookups to the first 99 normalized IDs', async () => {
        const ids = Array.from({length: 100}, (_, index) => `character-${index}`)
        const {db, boundStatements} = createMockDb({
            allResults: [[]],
        })

        const response = await apiRoutes.request(
            `https://example.com/search/size-chart-characters/by-id?ids=${ids.join(',')}`,
            {
                headers: {
                    accept: 'application/json',
                },
            },
            requestEnv(db),
        )

        expect(response.status).toBe(200)
        expect(boundStatements[0]?.binds).toEqual(ids.slice(0, 99))
        expect(await response.json()).toEqual({
            items: [],
        })
    })
})
