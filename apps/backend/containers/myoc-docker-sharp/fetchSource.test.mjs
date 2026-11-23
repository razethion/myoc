import assert from 'node:assert/strict'
import test from 'node:test'
import {fetchImageBytes} from './fetchSource.mjs'

/**
 * @param {{chunks?: Uint8Array[], status?: number, headers?: Record<string, string>, noBody?: boolean, onCancel?: () => void}} [options]
 */
function fakeResponse(options = {}) {
    const status = options.status ?? 200
    const headers = options.headers ?? {}
    const chunks = options.chunks ?? []
    let index = 0

    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (name) => headers[name.toLowerCase()] ?? null,
        },
        body: options.noBody
            ? null
            : {
                  getReader: () => ({
                      read: async () => (index < chunks.length ? {done: false, value: chunks[index++]} : {done: true, value: undefined}),
                      cancel: async () => {
                          options.onCancel?.()
                      },
                  }),
              },
    }
}

function sleepRecorder() {
    /** @type {number[]} */
    const delays = []

    return {
        delays,
        sleepImpl: async (ms) => {
            delays.push(ms)
        },
    }
}

test('returns source bytes on the first attempt', async () => {
    const first = Uint8Array.from([1, 2, 3])
    const second = Uint8Array.from([4, 5])
    const expected = Buffer.concat([Buffer.from(first), Buffer.from(second)])
    /** @type {RequestInit[]} */
    const requests = []
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    const bytes = await fetchImageBytes('https://media.example/image.gif', {
        fetchImpl: async (_url, init) => {
            calls += 1
            requests.push(init)
            return fakeResponse({chunks: [first, second], headers: {'content-length': '5'}})
        },
        maxBytes: 1024,
        retryDelayMs: 10,
        sleepImpl,
        timeoutMs: 1_000,
    })

    assert.deepEqual(bytes, expected)
    assert.equal(calls, 1)
    assert.equal(delays.length, 0)
    assert.equal(requests[0].headers.accept, 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8')
    assert.ok(requests[0].signal instanceof AbortSignal)
})

test('retries retryable origin statuses with growing delays', async () => {
    const ok = Uint8Array.from([9])
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    const bytes = await fetchImageBytes('https://media.example/image.gif', {
        fetchImpl: async () => {
            calls += 1
            if (calls === 1) {
                return fakeResponse({status: 520})
            }
            if (calls === 2) {
                return fakeResponse({status: 502})
            }
            return fakeResponse({chunks: [ok]})
        },
        maxBytes: 1024,
        retryDelayMs: 10,
        sleepImpl,
        timeoutMs: 1_000,
    })

    assert.deepEqual(bytes, Buffer.from([9]))
    assert.equal(calls, 3)
    assert.deepEqual(delays, [10, 20])
})

test('throws after exhausting attempts', async () => {
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: async () => {
                calls += 1
                return fakeResponse({status: 520})
            },
            maxAttempts: 2,
            maxBytes: 1024,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 1_000,
        }),
        /Source image fetch failed with 520/,
    )

    assert.equal(calls, 2)
    assert.deepEqual(delays, [10])
})

test('does not retry a missing source', async () => {
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: async () => {
                calls += 1
                return fakeResponse({status: 404})
            },
            maxBytes: 1024,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 1_000,
        }),
        /Source image fetch failed with 404/,
    )

    assert.equal(calls, 1)
    assert.equal(delays.length, 0)
})

test('retries network errors', async () => {
    const ok = Uint8Array.from([7])
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    const bytes = await fetchImageBytes('https://media.example/image.gif', {
        fetchImpl: async () => {
            calls += 1
            if (calls === 1) {
                throw new Error('socket hang up')
            }
            return fakeResponse({chunks: [ok]})
        },
        maxBytes: 1024,
        retryDelayMs: 10,
        sleepImpl,
        timeoutMs: 1_000,
    })

    assert.deepEqual(bytes, Buffer.from([7]))
    assert.equal(calls, 2)
    assert.deepEqual(delays, [10])
})

test('rejects a declared size above the cap without retrying', async () => {
    let calls = 0
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: async () => {
                calls += 1
                return fakeResponse({headers: {'content-length': '2048'}})
            },
            maxBytes: 1024,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 1_000,
        }),
        /Source image is too large/,
    )

    assert.equal(calls, 1)
    assert.equal(delays.length, 0)
})

test('rejects a streamed body above the cap and cancels the reader', async () => {
    let cancelled = false
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: async () =>
                fakeResponse({
                    chunks: [Uint8Array.from([1, 2, 3, 4]), Uint8Array.from([5, 6, 7, 8])],
                    onCancel: () => {
                        cancelled = true
                    },
                }),
            maxBytes: 4,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 1_000,
        }),
        /Source image is too large/,
    )

    assert.equal(cancelled, true)
    assert.equal(delays.length, 0)
})

test('rejects a response without a body', async () => {
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: async () => fakeResponse({noBody: true}),
            maxBytes: 1024,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 1_000,
        }),
        /Source image response has no body/,
    )

    assert.equal(delays.length, 0)
})

test('retries with the built-in sleep when no sleep implementation is given', async () => {
    const ok = Uint8Array.from([8])
    let calls = 0

    const bytes = await fetchImageBytes('https://media.example/image.gif', {
        fetchImpl: async () => {
            calls += 1
            if (calls === 1) {
                return fakeResponse({status: 503})
            }
            return fakeResponse({chunks: [ok]})
        },
        maxBytes: 1024,
        retryDelayMs: 1,
        timeoutMs: 1_000,
    })

    assert.deepEqual(bytes, Buffer.from([8]))
    assert.equal(calls, 2)
})

test('aborts a fetch that exceeds the timeout and reports it as retryable', async () => {
    const {sleepImpl, delays} = sleepRecorder()

    await assert.rejects(
        fetchImageBytes('https://media.example/image.gif', {
            fetchImpl: (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal.addEventListener('abort', () => {
                        reject(new Error('This operation was aborted'))
                    })
                }),
            maxAttempts: 1,
            maxBytes: 1024,
            retryDelayMs: 10,
            sleepImpl,
            timeoutMs: 5,
        }),
        /Source image fetch failed: Error: This operation was aborted/,
    )

    assert.equal(delays.length, 0)
})
