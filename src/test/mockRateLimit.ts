import {vi} from 'vitest'

export function createMockRateLimit(success = true): RateLimit {
    return {
        limit: vi.fn(async () => ({success})),
    }
}

export function createAllowingAuthRateLimits(): Pick<
    Env,
    | 'AUTH_NETWORK_RATE_LIMITER'
    | 'AUTH_IDENTITY_BURST_RATE_LIMITER'
    | 'AUTH_IDENTITY_SUSTAINED_RATE_LIMITER'
    | 'AUTH_CHALLENGE_RATE_LIMITER'
> {
    return {
        AUTH_NETWORK_RATE_LIMITER: createMockRateLimit(),
        AUTH_IDENTITY_BURST_RATE_LIMITER: createMockRateLimit(),
        AUTH_IDENTITY_SUSTAINED_RATE_LIMITER: createMockRateLimit(),
        AUTH_CHALLENGE_RATE_LIMITER: createMockRateLimit(),
    }
}
