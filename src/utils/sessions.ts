export function createSessionToken(): string {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)

    return Array.from(bytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

export async function hashSessionToken(token: string): Promise<string> {
    const data = new TextEncoder().encode(token)
    const digest = await crypto.subtle.digest('SHA-256', data)

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
}

export function getSessionExpiryDate(): string {
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 30)

    return expiresAt.toISOString()
}