import {vi} from 'vitest'

export function createMockQueue<T>() {
    const bodies: T[] = []
    const queue = {
        send: vi.fn(async (body: T) => {
            bodies.push(body)
        }),
        sendBatch: vi.fn(async (messages: Array<{body: T}>) => {
            bodies.push(...messages.map(({body}) => body))
        }),
    }

    return {bodies, queue: queue as unknown as Queue<T>}
}
