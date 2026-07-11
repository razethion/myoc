import {describe, expect, it, vi} from 'vitest'
import {normalizeSearchOffset, normalizeSearchQuery, SEARCH_QUERY_MAX_LENGTH, searchUsers} from './search'

function createRecordingDb(): {db: D1Database; binds: unknown[][]} {
    const binds: unknown[][] = []
    const db = {
        prepare: vi.fn(() => ({
            bind: vi.fn((...values: unknown[]) => {
                binds.push(values)

                return {
                    all: vi.fn(async () => ({results: []})),
                    first: vi.fn(async () => ({count: 0})),
                }
            }),
        })),
    }

    return {
        db: db as unknown as D1Database,
        binds,
    }
}

describe('normalizeSearchQuery', () => {
    it('trims, collapses whitespace, and caps query length', () => {
        const result = normalizeSearchQuery(`  raz\n\t${'x'.repeat(SEARCH_QUERY_MAX_LENGTH)}  `)

        expect(result.query).toHaveLength(SEARCH_QUERY_MAX_LENGTH)
        expect(result.query.startsWith('raz x')).toBe(true)
        expect(result.wasTruncated).toBe(true)
    })
})

describe('normalizeSearchOffset', () => {
    it('rejects invalid or unsafe offsets', () => {
        expect(normalizeSearchOffset('-1')).toBe(0)
        expect(normalizeSearchOffset('not-a-number')).toBe(0)
        expect(normalizeSearchOffset('10abc')).toBe(0)
        expect(normalizeSearchOffset('999999')).toBe(1000)
    })
})

describe('searchUsers', () => {
    it('escapes SQL LIKE wildcard characters in user input', async () => {
        const {db, binds} = createRecordingDb()

        await searchUsers(db, 'https://m.myoc.art', '%_\\')

        expect(binds[0]).toContain('%\\%\\_\\\\%')
        expect(binds[1]).toContain('%\\%\\_\\\\%')
    })
})
