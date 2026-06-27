export function absoluteUrl(siteUrl: string, path: string): string {
    return new URL(path, siteUrl).toString()
}

export function compactDescription(value: string, fallback: string): string {
    const description = value.replace(/\s+/g, ' ').trim() || fallback

    return description.length > 160 ? `${description.slice(0, 157).trimEnd()}...` : description
}
