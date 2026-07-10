import {Hono} from 'hono'
import {characterHeightChartImageObjectKey, characterProfileImageUrl} from '../../lib/media/url'
import {
    normalizeSearchOffset,
    normalizeSearchQuery,
    searchCharacters,
    searchUsers,
} from '../../lib/search'
import type {Bindings} from '../../types/bindings'

export const searchRoutes = new Hono<{ Bindings: Bindings }>()

type SizeChartCharacterSearchRow = {
    id: string
    size_chart_id: string
    name: string
    user_id: string
    username: string
    profile_image_key: string
    height_chart_json: string
}

type SizeChartJson = {
    version: 1
    height: {
        meters: number
    }
    image: null | {
        key: string
        contentType: string
        naturalWidth: number
        naturalHeight: number
    }
    calibration: {
        headYPercent: number
        footYPercent: number
        footIsVirtual: boolean
        nameTagXPercent: number
    }
}

const SIZE_CHART_ID_SELECT_SQL = 'lower(hex(characters.size_chart_id)) AS size_chart_id'
const SIZE_CHART_ID_LOOKUP_SQL = 'lower(hex(characters.size_chart_id))'

searchRoutes.get('/', async (c) => {
    const type = c.req.query('type')
    const {query, wasTruncated} = normalizeSearchQuery(c.req.query('q'))
    const offset = normalizeSearchOffset(c.req.query('offset'))

    if (type !== 'users' && type !== 'characters') {
        return c.json({error: 'Search type must be users or characters'}, 400)
    }

    const results = type === 'users'
        ? await searchUsers(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, query, undefined, offset)
        : await searchCharacters(c.env.DB, c.env.MEDIA_PUBLIC_BASE_URL, query, undefined, offset)

    return c.json({
        type,
        query,
        wasTruncated,
        items: results.items,
        total: results.total,
        nextOffset: results.nextOffset,
        hasMore: results.hasMore,
    })
})

searchRoutes.get('/size-chart-characters', async (c) => {
    const {query, wasTruncated} = normalizeSearchQuery(c.req.query('q'))

    if (!query) {
        return c.json({
            query,
            wasTruncated,
            items: [],
        })
    }

    const terms = createSizeChartSearchTerms(query)
    const where = terms.map(() => `(lower(users.username) LIKE ? ESCAPE '\\' OR lower(characters.name) LIKE ? ESCAPE '\\')`).join(' AND ')
    const bindings = terms.flatMap((term) => [term.contains, term.contains])
    const result = await c.env.DB.prepare(
        `SELECT characters.id,
                ${SIZE_CHART_ID_SELECT_SQL},
                characters.name,
                characters.user_id,
                characters.profile_image_key,
                characters.height_chart_json,
                users.username
         FROM characters
                  INNER JOIN users ON users.id = characters.user_id
         WHERE ${where}
         ORDER BY CASE WHEN characters.height_chart_json <> '' THEN 0 ELSE 1 END,
                  CASE
                      WHEN lower(users.username || ' ' || characters.name) = ? THEN 0
                      WHEN lower(characters.name) = ? THEN 1
                      WHEN lower(users.username) = ? THEN 2
                      WHEN lower(characters.name) LIKE ? ESCAPE '\\' THEN 3
                      WHEN lower(users.username) LIKE ? ESCAPE '\\' THEN 4
                      ELSE 5
                      END,
                  lower(users.username),
                  lower(characters.name)
         LIMIT 40`,
    )
        .bind(
            ...bindings,
            query.toLowerCase(),
            query.toLowerCase(),
            query.toLowerCase(),
            `${escapeSizeChartLike(query.toLowerCase())}%`,
            `${escapeSizeChartLike(query.toLowerCase())}%`,
        )
        .all<SizeChartCharacterSearchRow>()

    const items = (result.results ?? [])
        .map((row) => toSizeChartCharacterSearchResult(row, c.env.MEDIA_PUBLIC_BASE_URL))
        .sort((a, b) => Number(b.hasSizeChart) - Number(a.hasSizeChart))
        .slice(0, 20)

    return c.json({
        query,
        wasTruncated,
        items,
    })
})

searchRoutes.get('/size-chart-characters/by-id', async (c) => {
    const ids = normalizeSizeChartIds(c.req.query('ids'))

    if (ids.length === 0) {
        return c.json({items: []})
    }

    const sizeChartIds = ids
        .filter(isSizeChartId)
        .map((id) => id.toLowerCase())
    const where = [
        `characters.id IN (${ids.map(() => '?').join(', ')})`,
        ...(sizeChartIds.length > 0
            ? [`${SIZE_CHART_ID_LOOKUP_SQL} IN (${sizeChartIds.map(() => '?').join(', ')})`]
            : []),
    ].join(' OR ')

    const result = await c.env.DB.prepare(
        `SELECT characters.id,
                ${SIZE_CHART_ID_SELECT_SQL},
                characters.name,
                characters.user_id,
                characters.profile_image_key,
                characters.height_chart_json,
                users.username
         FROM characters
                  INNER JOIN users ON users.id = characters.user_id
         WHERE ${where}
         LIMIT 30`,
    )
        .bind(...ids, ...sizeChartIds)
        .all<SizeChartCharacterSearchRow>()

    const itemsById = new Map<string, ReturnType<typeof toSizeChartCharacterSearchResult>>()

    for (const row of result.results ?? []) {
        const item = toSizeChartCharacterSearchResult(row, c.env.MEDIA_PUBLIC_BASE_URL)
        itemsById.set(row.id, item)

        itemsById.set(row.size_chart_id, item)
    }

    return c.json({
        items: ids
            .map((id) => itemsById.get(id))
            .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    })
})

searchRoutes.get('/size-chart-characters/:characterId/image', async (c) => {
    const characterId = c.req.param('characterId')
    const imageKey = c.req.query('key') ?? ''
    const character = await c.env.DB.prepare(
        `SELECT id,
                user_id,
                height_chart_json
         FROM characters
         WHERE id = ?
         LIMIT 1`,
    )
        .bind(characterId)
        .first<{ id: string; user_id: string; height_chart_json: string }>()

    const heightChart = parseSizeChartJson(character?.height_chart_json)

    if (!character || !heightChart?.image || heightChart.image.key !== imageKey) {
        return c.body(null, 404)
    }

    const object = await c.env.MEDIA_BUCKET.get(characterHeightChartImageObjectKey(
        character.user_id,
        character.id,
        heightChart.image.key,
        heightChart.image.contentType,
    ))

    if (!object?.body) {
        return c.body(null, 404)
    }

    return new Response(object.body, {
        headers: {
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Content-Type': heightChart.image.contentType,
        },
    })
})

function createSizeChartSearchTerms(query: string): { contains: string }[] {
    return query
        .toLowerCase()
        .split(/\s+/)
        .map((term) => term.trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((term) => ({contains: `%${escapeSizeChartLike(term)}%`}))
}

function escapeSizeChartLike(value: string): string {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

function normalizeSizeChartIds(value: string | null | undefined): string[] {
    if (!value) {
        return []
    }

    const seen = new Set<string>()
    const ids: string[] = []

    for (const id of value.split(',')) {
        const trimmed = id.trim()
        const normalized = isSizeChartId(trimmed) ? trimmed.toLowerCase() : trimmed

        if (!normalized || normalized.length > 64 || seen.has(normalized)) {
            continue
        }

        seen.add(normalized)
        ids.push(normalized)

        if (ids.length >= 30) {
            break
        }
    }

    return ids
}

function isSizeChartId(value: string): boolean {
    return /^[0-9a-f]{12}$/i.test(value)
}

function toSizeChartCharacterSearchResult(row: SizeChartCharacterSearchRow, mediaBaseUrl: string) {
    const heightChart = parseSizeChartJson(row.height_chart_json)
    const hasSizeChart = Boolean(heightChart?.image)

    return {
        id: row.id,
        sizeChartId: row.size_chart_id,
        name: row.name,
        ownerId: row.user_id,
        ownerUsername: row.username,
        profileImageUrl: characterProfileImageUrl(mediaBaseUrl, row.user_id, row.id, row.profile_image_key),
        hasSizeChart,
        heightChart: heightChart?.image
            ? {
                ...heightChart,
                image: {
                    ...heightChart.image,
                    url: `/api/search/size-chart-characters/${encodeURIComponent(row.id)}/image?key=${encodeURIComponent(heightChart.image.key)}`,
                },
            }
            : null,
    }
}

function parseSizeChartJson(value: string | null | undefined): SizeChartJson | null {
    if (!value) {
        return null
    }

    try {
        const parsed = JSON.parse(value) as unknown

        if (!parsed || typeof parsed !== 'object') {
            return null
        }

        const chart = parsed as Record<string, unknown>
        const height = chart.height && typeof chart.height === 'object' ? chart.height as Record<string, unknown> : null
        const calibration = chart.calibration && typeof chart.calibration === 'object' ? chart.calibration as Record<string, unknown> : null
        const image = chart.image && typeof chart.image === 'object' ? chart.image as Record<string, unknown> : null

        if (!height || !calibration || !image) {
            return null
        }

        const meters = Number(height.meters)
        const headYPercent = Number(calibration.headYPercent)
        const footYPercent = Number(calibration.footYPercent)
        const nameTagXPercent = Number(calibration.nameTagXPercent ?? 50)
        const naturalWidth = Number(image.naturalWidth)
        const naturalHeight = Number(image.naturalHeight)
        const key = typeof image.key === 'string' ? image.key : ''

        if (!key || !Number.isFinite(meters) || !Number.isFinite(headYPercent) || !Number.isFinite(footYPercent) || !Number.isFinite(nameTagXPercent) || !Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) {
            return null
        }

        return {
            version: 1,
            height: {
                meters,
            },
            image: {
                key,
                contentType: typeof image.contentType === 'string' ? image.contentType : 'image/png',
                naturalWidth,
                naturalHeight,
            },
            calibration: {
                headYPercent,
                footYPercent,
                footIsVirtual: Boolean(calibration.footIsVirtual),
                nameTagXPercent,
            },
        }
    } catch {
        return null
    }
}
