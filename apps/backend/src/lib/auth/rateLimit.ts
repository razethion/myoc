import type {Context, Next} from 'hono'
import type {Bindings} from '../../types/bindings'
import {jsonResponse} from '../http/jsonResponse'
import {ErrorResponseSchema} from '../http/responseSchemas'

const RATE_LIMIT_ERROR = 'Too many requests. Try again later.'

type AuthContext = Context<{Bindings: Bindings}>

export async function authNetworkRateLimit(c: AuthContext, next: Next): Promise<Response | undefined> {
    if (c.req.method !== 'POST') {
        await next()
        return undefined
    }

    const ipAddress = c.req.header('cf-connecting-ip') ?? 'unknown'
    const network = await applyRateLimit(c.env.AUTH_NETWORK_RATE_LIMITER, await rateLimitKey('network', ipAddress))

    if (!network.success) {
        return rateLimitedResponse(c, 60)
    }

    await next()
    return undefined
}

export async function enforceAuthIdentityRateLimit(c: AuthContext, identity: string): Promise<Response | null> {
    const key = await rateLimitKey('identity', identity.toLowerCase())
    const [burst, sustained] = await Promise.all([
        applyRateLimit(c.env.AUTH_IDENTITY_BURST_RATE_LIMITER, key),
        applyRateLimit(c.env.AUTH_IDENTITY_SUSTAINED_RATE_LIMITER, key),
    ])

    if (!sustained.success) {
        return rateLimitedResponse(c, 60)
    }

    return burst.success ? null : rateLimitedResponse(c, 10)
}

export async function enforceAuthChallengeRateLimit(c: AuthContext, challengeId: string): Promise<Response | null> {
    const result = await applyRateLimit(c.env.AUTH_CHALLENGE_RATE_LIMITER, await rateLimitKey('challenge', challengeId))
    return result.success ? null : rateLimitedResponse(c, 60)
}

async function applyRateLimit(binding: RateLimit | undefined, key: string): Promise<RateLimitOutcome> {
    if (!binding) {
        console.error('Required authentication rate-limit binding is missing')
        return {success: false}
    }

    return await binding.limit({key})
}

function rateLimitedResponse(c: AuthContext, retryAfterSeconds: number): Response {
    c.header('Retry-After', String(retryAfterSeconds))
    return jsonResponse(c, ErrorResponseSchema, {error: RATE_LIMIT_ERROR}, 429)
}

async function rateLimitKey(category: string, value: string): Promise<string> {
    const bytes = new TextEncoder().encode(`${category}:${value}`)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
