import type {Context, Next} from 'hono'
import type {Bindings} from '../../types/bindings'

export const NON_HTML_CONTENT_SECURITY_POLICY = [
    "default-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    'sandbox',
].join('; ')

const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'
const TOYHOUSE_IMAGE_SOURCES = ['https://file.toyhou.se', 'https://f2.toyhou.se']
const PERMISSIONS_POLICY = [
    'accelerometer=()',
    'camera=()',
    'geolocation=()',
    'gyroscope=()',
    'magnetometer=()',
    'microphone=()',
    'payment=()',
    'usb=()',
].join(', ')

export function securityHeaders(c: Context<{Bindings: Bindings}>, next: Next): Promise<void> {
    return applySecurityHeaders(c, next)
}

export function createHtmlContentSecurityPolicy(nonce: string, mediaPublicBaseUrl: string): string {
    // CropperJS and the chart editors generate inline style attributes and runtime style elements.
    const mediaSource = cspSourceOrigin(mediaPublicBaseUrl)
    const imageSources = ["'self'", 'data:', 'blob:', mediaSource, ...TOYHOUSE_IMAGE_SOURCES].filter(Boolean)
    const mediaSources = ["'self'", mediaSource].filter(Boolean)

    return [
        "default-src 'self'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
        `script-src 'self' 'nonce-${nonce}'`,
        "script-src-attr 'none'",
        "style-src 'self' 'unsafe-inline'",
        "style-src-elem 'self' 'unsafe-inline'",
        "style-src-attr 'unsafe-inline'",
        `img-src ${imageSources.join(' ')}`,
        "font-src 'self' data:",
        "connect-src 'self'",
        `media-src ${mediaSources.join(' ')}`,
        "manifest-src 'self'",
        "worker-src 'none'",
        "frame-src 'none'",
        'upgrade-insecure-requests',
    ].join('; ')
}

async function applySecurityHeaders(c: Context<{Bindings: Bindings}>, next: Next): Promise<void> {
    await next()

    const headers = new Headers(c.res.headers)
    setCommonSecurityHeaders(headers, c.req.url)

    if (!isHtmlResponse(headers)) {
        headers.set('Content-Security-Policy', NON_HTML_CONTENT_SECURITY_POLICY)
        c.res = copyResponseWithHeaders(c.res, headers)
        return
    }

    const nonce = createCspNonce()
    headers.set('Content-Security-Policy', createHtmlContentSecurityPolicy(nonce, c.env.MEDIA_PUBLIC_BASE_URL))
    headers.delete('Content-Length')

    const rewritten = new HTMLRewriter().on('script', new NonceAttributeHandler(nonce)).transform(copyResponseWithHeaders(c.res, headers))

    c.res = rewritten
}

function setCommonSecurityHeaders(headers: Headers, requestUrl: string): void {
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    headers.set('X-Frame-Options', 'DENY')
    headers.set('Permissions-Policy', PERMISSIONS_POLICY)

    if (new URL(requestUrl).protocol === 'https:') {
        headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
    }
}

function isHtmlResponse(headers: Headers): boolean {
    return (headers.get('Content-Type') ?? '').toLowerCase().includes('text/html')
}

function copyResponseWithHeaders(response: Response, headers: Headers): Response {
    return new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
    })
}

function createCspNonce(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)

    return btoa(String.fromCharCode(...bytes))
}

function cspSourceOrigin(value: string): string {
    try {
        const url = new URL(value)

        return url.protocol === 'https:' ? url.origin : ''
    } catch {
        return ''
    }
}

class NonceAttributeHandler implements HTMLRewriterElementContentHandlers {
    constructor(private readonly nonce: string) {}

    element(element: Element): void {
        element.setAttribute('nonce', this.nonce)
    }
}
