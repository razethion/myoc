declare const c: {
    body(...args: unknown[]): Response
    json(...args: unknown[]): Response
}
declare const responseSchema: unknown
declare function jsonResponse(...args: unknown[]): Response

const payload = {ok: true}

// ruleid: myoc.routes.no-direct-json-response
const honoJson = c.json(payload)

// ruleid: myoc.routes.no-direct-json-response
const standardJson = Response.json(payload)

// ruleid: myoc.routes.no-direct-json-response
const constructedJsonWithInit = new Response(JSON.stringify(payload), {status: 200})

// ruleid: myoc.routes.no-direct-json-response
const constructedJson = new Response(JSON.stringify(payload))

// ruleid: myoc.routes.no-direct-json-response
const honoBodyWithStatus = c.body(JSON.stringify(payload), 200)

// ruleid: myoc.routes.no-direct-json-response
const honoBody = c.body(JSON.stringify(payload))

// ok: myoc.routes.no-direct-json-response
const schemaCheckedJson = jsonResponse(c, responseSchema, payload)

export {constructedJson, constructedJsonWithInit, honoBody, honoBodyWithStatus, honoJson, schemaCheckedJson, standardJson}
