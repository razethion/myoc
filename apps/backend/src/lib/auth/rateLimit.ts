import type {Context, Next} from 'hono'
import type {Bindings} from '../../types/bindings'
import {applyRateLimit, rateLimitedResponse, rateLimitKey} from '../http/rateLimit'

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
