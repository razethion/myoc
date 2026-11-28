import type {Context} from 'hono'
import type {Bindings} from '../../types/bindings'
import {jsonResponse} from './jsonResponse'
import {ErrorResponseSchema} from './responseSchemas'

const RATE_LIMIT_ERROR = 'Too many requests. Try again later.'

type RateLimitContext = Context<{Bindings: Bindings}>

export async function applyRateLimit(binding: RateLimit | undefined, key: string): Promise<RateLimitOutcome> {
    if (!binding) {
        console.error('Required rate-limit binding is missing')
        return {success: false}
    }

    return await binding.limit({key})
}

export function rateLimitedResponse(c: RateLimitContext, retryAfterSeconds: number): Response {
    c.header('Retry-After', String(retryAfterSeconds))
    return jsonResponse(c, ErrorResponseSchema, {error: RATE_LIMIT_ERROR}, 429)
}

export async function rateLimitKey(category: string, value: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${category}:${value}`)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
