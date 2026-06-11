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
