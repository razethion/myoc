export function fallbackAvatarDataUrl(name: string, fallbackInitial = 'U'): string {
    const initial = firstCharacter(name) || firstCharacter(fallbackInitial) || 'U'
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 100 100">',
        '<rect width="100" height="100" fill="#ccc"/>',
        `<text x="50" y="52" fill="#000" font-family="Arial, sans-serif" font-size="50" text-anchor="middle" dominant-baseline="middle">${escapeXml(initial)}</text>`,
        '</svg>',
    ].join('')

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function firstCharacter(value: string): string {
    const character = Array.from(value.trim())[0] ?? ''

    return Array.from(character.toUpperCase())[0] ?? ''
}

function escapeXml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
        switch (character) {
            case '&':
                return '&amp;'
            case '<':
                return '&lt;'
            case '>':
                return '&gt;'
            case '"':
                return '&quot;'
            default:
                return '&apos;'
        }
    })
}
