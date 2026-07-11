import {describe, expect, it} from 'vitest'
import {apiRoutes} from '../api'
import {createMockDb} from '../../test/mockD1'
import {createMockR2Bucket} from '../../test/mockR2'

const mediaPublicBaseUrl = 'https://m.myoc.art'

function requestEnv(db: D1Database) {
    return {
        DB: db,
        MEDIA_BUCKET: createMockR2Bucket(),
        MEDIA_PUBLIC_BASE_URL: mediaPublicBaseUrl,
    }
}

function sizeChartJson() {
    return JSON.stringify({
        version: 1,
        height: {
            meters: 1.82,
        },
        image: {
            key: 'height-chart-image',
            contentType: 'image/png',
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

describe('GET /api/search/size-chart-characters/by-id', () => {
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
            '/api/search/size-chart-characters/legacy-character-id/image?key=height-chart-image',
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
            '/api/search/size-chart-characters/legacy-character-id/image?key=height-chart-image',
        )
        expect(body.items[1]?.id).toBe('legacy-character-id')
    })
})
