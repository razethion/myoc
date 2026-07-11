import {vi} from 'vitest'

type MockKvOptions = {
    values?: Record<string, unknown>
}

export function createMockKVNamespace(options: MockKvOptions = {}): KVNamespace {
    const values = new Map<string, string>()

    for (const [key, value] of Object.entries(options.values ?? {})) {
        values.set(key, typeof value === 'string' ? value : JSON.stringify(value))
    }

    return {
        get: vi.fn(async (key: string, type?: string | {type?: string}) => {
            const value = values.get(key)

            if (value == null) {
                return null
            }

            const valueType = typeof type === 'string' ? type : type?.type

            if (valueType === 'json') {
                return JSON.parse(value)
            }

            return value
        }),
        put: vi.fn(async (key: string, value: string) => {
            values.set(key, value)
        }),
        delete: vi.fn(async (key: string) => {
            values.delete(key)
        }),
        list: vi.fn(async () => ({
            keys: [],
            list_complete: true,
            cursor: undefined,
            cacheStatus: null,
        })),
    } as unknown as KVNamespace
}
