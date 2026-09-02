import {describe, expect, it} from 'vitest'
import {serializeJsonForHtmlScript} from './scriptJson'

describe('serializeJsonForHtmlScript', () => {
    it('escapes characters that can break out of an HTML script element', () => {
        const value = {
            text: '</script><script>attack()</script>&>\u2028\u2029',
        }

        const serialized = serializeJsonForHtmlScript(value)

        expect(serialized).not.toMatch(/[<>&\u2028\u2029]/u)
        expect(serialized).toContain('\\u003c/script\\u003e\\u003cscript\\u003e')
        expect(JSON.parse(serialized)).toEqual(value)
    })
})
