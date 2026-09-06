declare const c: {
    req: {
        formData(): Promise<FormData>
        json<T>(): Promise<T>
        raw: Request
    }
}
declare const request: Request
declare const req: Request
declare const response: Response

declare function readFormDataUpTo(request: Request, maxBytes: number): Promise<FormData | null>
declare function readJsonUpTo<T>(request: Request, maxBytes: number): Promise<T | null>

async function parseBodies() {
    // ruleid: myoc.routes.no-unbounded-request-body
    const honoJson = await c.req.json<unknown>()

    // ruleid: myoc.routes.no-unbounded-request-body
    const caughtHonoJson = await c.req.json<unknown>().catch(() => null)

    // ruleid: myoc.routes.no-unbounded-request-body
    const honoForm = await c.req.formData()

    // ruleid: myoc.routes.no-unbounded-request-body
    const rawHonoJson = await c.req.raw.json()

    // ruleid: myoc.routes.no-unbounded-request-body
    const rawHonoForm = await c.req.raw.formData()

    // ruleid: myoc.routes.no-unbounded-request-body
    const standardJson = await request.json()

    // ruleid: myoc.routes.no-unbounded-request-body
    const standardForm = await req.formData()

    // ok: myoc.routes.no-unbounded-request-body
    const boundedJson = await readJsonUpTo<unknown>(c.req.raw, 1024)

    // ok: myoc.routes.no-unbounded-request-body
    const boundedForm = await readFormDataUpTo(request, 1024)

    // ok: myoc.routes.no-unbounded-request-body
    const responseJson = await response.json()

    return {
        boundedForm,
        boundedJson,
        caughtHonoJson,
        honoForm,
        honoJson,
        rawHonoForm,
        rawHonoJson,
        responseJson,
        standardForm,
        standardJson,
    }
}

void parseBodies

export {}
