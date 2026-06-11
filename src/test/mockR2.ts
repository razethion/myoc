import {vi} from 'vitest'

export function createMockR2Bucket(): R2Bucket {
    return {
        put: vi.fn(async () => null),
        get: vi.fn(async () => null),
        delete: vi.fn(async () => undefined),
    } as unknown as R2Bucket
}
