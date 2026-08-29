declare const c: {
    body(...args: unknown[]): Response
}
declare const upstream: Response

// ruleid: myoc.routes.no-image-body-proxy
const standardProxy = new Response(upstream.body, {status: upstream.status})

// ruleid: myoc.routes.no-image-body-proxy
const honoProxy = c.body(upstream.body, upstream.status)

// ok: myoc.routes.no-image-body-proxy
const textResponse = new Response('Use a public media URL instead.')

export {honoProxy, standardProxy, textResponse}
