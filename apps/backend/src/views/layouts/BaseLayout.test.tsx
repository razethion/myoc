import {describe, expect, it} from 'vitest'
import {BaseLayout} from './BaseLayout'

function renderBaseLayout(): string {
    return BaseLayout({
        children: 'Body content',
        head: <style>{'BODY_HEAD'}</style>,
        mediaBaseUrl: 'https://m.example.com',
        title: 'Layout test | MyOC',
    }).toString()
}

describe('BaseLayout', () => {
    it('preconnects to the media host before the stylesheet loads', () => {
        const html = renderBaseLayout()

        const preconnect = /<link(?=[^>]*href="https:\/\/m\.example\.com")(?=[^>]*rel="preconnect")[^>]*>/.exec(html)
        const stylesheet = html.indexOf('<link href="/app.css" rel="stylesheet"/>')

        expect(preconnect).not.toBeNull()
        expect(stylesheet).toBeGreaterThan(-1)
        expect(preconnect?.index).toBeLessThan(stylesheet)
    })

    it('preloads the Nohemi font with CORS mode before the stylesheet loads', () => {
        const html = renderBaseLayout()

        const preload =
            /<link(?=[^>]*as="font")(?=[^>]*crossorigin="anonymous")(?=[^>]*href="\/assets\/Nohemi\.woff2")(?=[^>]*rel="preload")(?=[^>]*type="font\/woff2")[^>]*>/.exec(
                html,
            )
        const stylesheet = html.indexOf('<link href="/app.css" rel="stylesheet"/>')

        expect(preload).not.toBeNull()
        expect(preload?.index).toBeLessThan(stylesheet)
    })

    it('keeps the title, favicon, page head, and body content', () => {
        const html = renderBaseLayout()

        expect(html).toContain('<title>Layout test | MyOC</title>')
        expect(html).toContain('rel="icon"')
        expect(html).toContain('BODY_HEAD')
        expect(html).toContain('Body content')
    })
})
