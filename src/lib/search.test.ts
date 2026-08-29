import {describe, expect, it} from 'vitest'
import {seedUser, useTestDatabase} from '../test/d1'
import {normalizeSearchOffset, normalizeSearchQuery, searchUsers} from './search'

const SEARCH_QUERY_MAX_LENGTH = 80
const db = useTestDatabase()

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
    it('treats SQL LIKE wildcard characters as literal user input', async () => {
        await seedUser({id: 'literal-user', username: 'literal_user', bio: 'Contains the literal %_\\ sequence.'})
        await seedUser({id: 'wildcard-decoy', username: 'wildcard_decoy', bio: 'Contains other wildcard-shaped text.'})

        const results = await searchUsers(db, 'https://m.myoc.art', '%_\\')

        expect(results.items.map((user) => user.id)).toEqual(['literal-user'])
        expect(results.total).toBe(1)
    })
})
