import {describe, expect, it} from 'vitest'
import {safeLocalRedirectPath} from './redirect'

describe('safeLocalRedirectPath', () => {
    it('allows a local path when no blocking rules are supplied', () => {
        expect(safeLocalRedirectPath('/search?q=demo#results', 'https://example.com/settings')).toBe('/search?q=demo#results')
    })
})
