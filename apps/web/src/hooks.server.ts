import type {Handle} from '@sveltejs/kit'

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
const STRICT_TRANSPORT_SECURITY = 'max-age=31536000; includeSubDomains'

export const handle: Handle = async ({event, resolve}) => {
    const startedAt = performance.now()
    const handler = event.route.id === '/search' ? 'sveltekit' : 'hono'

    try {
        let response: Response

        if (handler === 'hono') {
            const backend = event.platform?.env.HONO

            if (!backend) {
                response = new Response('The application backend is unavailable.', {status: 503})
            } else {
                const requestInit: RequestInit & {duplex?: 'half'} = {
                    headers: event.request.headers,
                    method: event.request.method,
                    redirect: event.request.redirect,
                }

                if (event.request.body) {
                    requestInit.body = event.request.body
                    requestInit.duplex = 'half'
                }

                response = await backend.fetch(event.request.url, requestInit)
            }
        } else {
            const resolvedResponse = await resolve(event)
            const headers = new Headers(resolvedResponse.headers)
            headers.set('Permissions-Policy', PERMISSIONS_POLICY)
            headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
            headers.set('X-Content-Type-Options', 'nosniff')
            headers.set('X-Frame-Options', 'DENY')

            if (event.url.protocol === 'https:') {
                headers.set('Strict-Transport-Security', STRICT_TRANSPORT_SECURITY)
            }

            response = new Response(resolvedResponse.body, {
                headers,
                status: resolvedResponse.status,
                statusText: resolvedResponse.statusText,
            })
        }

        logRequest(event.request, handler, response.status, startedAt)
        return response
    } catch (error) {
        logRequest(event.request, handler, 500, startedAt)
        throw error
    }
}

function logRequest(request: Request, handler: 'hono' | 'sveltekit', status: number, startedAt: number): void {
    console.info(
        JSON.stringify({
            message: 'HTTP request',
            method: request.method,
            path: new URL(request.url).pathname,
            status,
            durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
            handler,
        }),
    )
}
