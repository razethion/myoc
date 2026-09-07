import {describe, expect, it} from 'vitest'
import {fallbackAvatarDataUrl} from './avatar'

describe('fallbackAvatarDataUrl', () => {
    it('creates a local SVG avatar from the first character', () => {
        const dataUrl = fallbackAvatarDataUrl('nova')
        const svg = decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1))

        expect(dataUrl.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
        expect(svg).toContain('>N</text>')
        expect(svg).toContain('fill="#ccc"')
        expect(svg).toContain('fill="#000"')
    })

    it('escapes markup and uses the requested fallback initial', () => {
        const escapedSvg = decodeURIComponent(fallbackAvatarDataUrl('<').split(',', 2)[1] ?? '')
        const fallbackSvg = decodeURIComponent(fallbackAvatarDataUrl('', 'r').split(',', 2)[1] ?? '')

        expect(escapedSvg).toContain('>&lt;</text>')
        expect(escapedSvg).not.toContain('><</text>')
        expect(fallbackSvg).toContain('>R</text>')
    })
})
