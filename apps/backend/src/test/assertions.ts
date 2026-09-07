import {expect} from 'vitest'

export function expectSessionCookie(response: Response): string {
    const cookie = response.headers.get('set-cookie')

    expect(cookie).toContain('myoc_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Max-Age=2592000')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')

    return cookie ?? ''
}

export function expectSecurityHeaders(response: Response): string {
    const contentSecurityPolicy = response.headers.get('content-security-policy')

    expect(contentSecurityPolicy).toBeTruthy()
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('permissions-policy')).toContain('camera=()')
    expect(response.headers.get('permissions-policy')).toContain('microphone=()')
    expect(response.headers.get('permissions-policy')).toContain('geolocation=()')
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains')

    return contentSecurityPolicy ?? ''
}
