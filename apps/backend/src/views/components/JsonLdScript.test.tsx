import {describe, expect, it} from 'vitest'
import {JsonLdScript} from './JsonLdScript'

describe('JsonLdScript', () => {
    it('keeps hostile text inside one JSON-LD script element', () => {
        const scriptInjection = ['</scr', 'ipt><scr', 'ipt data-json-ld-xss>attack()</scr', 'ipt>'].join('')
        const value = {
            description: scriptInjection,
        }

        const html = JsonLdScript({value}).toString()
        const scriptContent = html.match(/^<script type="application\/ld\+json">(.+)<\/script>$/)?.[1]

        expect(html.match(/<script\b/g)).toHaveLength(1)
        expect(html).not.toContain('<script data-json-ld-xss>')
        expect(scriptContent).toContain('\\u003c/script\\u003e\\u003cscript data-json-ld-xss\\u003e')
        expect(JSON.parse(scriptContent ?? '')).toEqual(value)
    })
})
