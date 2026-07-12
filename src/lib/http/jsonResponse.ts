import type {Context} from 'hono'
import type {ContentfulStatusCode} from 'hono/utils/http-status'
import type {ZodType} from 'zod'

export function jsonResponse<TSchema extends ZodType>(c: Context, schema: TSchema, body: unknown, status?: ContentfulStatusCode): Response {
    const parsed = schema.parse(body)

    return status === undefined ? c.json(parsed) : c.json(parsed, status)
}
