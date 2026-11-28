import type {Context} from 'hono'
import type {Bindings} from '../../types/bindings'
import {applyRateLimit, rateLimitedResponse, rateLimitKey} from '../http/rateLimit'

type UploadContext = Context<{Bindings: Bindings}>

async function enforceUploadNetworkRateLimit(c: UploadContext): Promise<Response | null> {
    const ipAddress = c.req.header('cf-connecting-ip') ?? 'unknown'
    const result = await applyRateLimit(c.env.UPLOAD_NETWORK_RATE_LIMITER, await rateLimitKey('upload-network', ipAddress))
    return result.success ? null : rateLimitedResponse(c, 60)
}

async function enforceUploadIdentityRateLimit(c: UploadContext, identity: string): Promise<Response | null> {
    const key = await rateLimitKey('upload-identity', identity.toLowerCase())
    const [burst, sustained] = await Promise.all([
        applyRateLimit(c.env.UPLOAD_IDENTITY_BURST_RATE_LIMITER, key),
        applyRateLimit(c.env.UPLOAD_IDENTITY_SUSTAINED_RATE_LIMITER, key),
    ])

    if (!sustained.success) {
        return rateLimitedResponse(c, 60)
    }

    return burst.success ? null : rateLimitedResponse(c, 10)
}

export async function enforceUploadRateLimits(c: UploadContext, identity: string): Promise<Response | null> {
    return (await enforceUploadNetworkRateLimit(c)) ?? (await enforceUploadIdentityRateLimit(c, identity))
}
