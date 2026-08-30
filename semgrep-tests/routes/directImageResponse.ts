declare const c: {
    body(...args: unknown[]): Response
}

const imageBytes = new Uint8Array()

// ruleid: myoc.routes.no-direct-image-response
const standardLowercaseHeader = new Response(imageBytes, {headers: {'content-type': 'image/png'}})

// ruleid: myoc.routes.no-direct-image-response
const standardTitleCaseHeader = new Response(imageBytes, {headers: {'Content-Type': 'image/webp'}})

// ruleid: myoc.routes.no-direct-image-response
const standardDoubleQuotedLowercaseHeader = new Response(imageBytes, {headers: {"content-type": "image/gif"}})

// ruleid: myoc.routes.no-direct-image-response
const standardDoubleQuotedTitleCaseHeader = new Response(imageBytes, {headers: {"Content-Type": "image/svg+xml"}})

// ruleid: myoc.routes.no-direct-image-response
const honoLowercaseHeader = c.body(imageBytes, 200, {'content-type': 'image/avif'})

// ruleid: myoc.routes.no-direct-image-response
const honoTitleCaseHeader = c.body(imageBytes, 200, {'Content-Type': 'IMAGE/JPEG'})

// ruleid: myoc.routes.no-direct-image-response
const honoDoubleQuotedLowercaseHeader = c.body(imageBytes, 200, {"content-type": "image/bmp"})

// ruleid: myoc.routes.no-direct-image-response
const honoDoubleQuotedTitleCaseHeader = c.body(imageBytes, 200, {"Content-Type": "image/tiff"})

// ok: myoc.routes.no-direct-image-response
const nonImageResponse = new Response(imageBytes, {headers: {'content-type': 'application/octet-stream'}})

void [
    honoDoubleQuotedLowercaseHeader,
    honoDoubleQuotedTitleCaseHeader,
    honoLowercaseHeader,
    honoTitleCaseHeader,
    nonImageResponse,
    standardDoubleQuotedLowercaseHeader,
    standardDoubleQuotedTitleCaseHeader,
    standardLowercaseHeader,
    standardTitleCaseHeader,
]

export {}
