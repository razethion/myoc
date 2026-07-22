import {describe, expect, it, vi} from 'vitest'
import {readJsonUpTo, readRequestBodyUpTo} from './requestBody'

describe('request body limits', () => {
    it('returns empty bytes when a request has no body', async () => {
        await expect(readRequestBodyUpTo(new Request('https://example.com'), 10)).resolves.toEqual(new Uint8Array())
    })

    it('skips empty stream chunks', async () => {
        const reader = {
            read: vi.fn().mockResolvedValueOnce({done: false, value: undefined}).mockResolvedValueOnce({done: true, value: undefined}),
            releaseLock: vi.fn(),
            cancel: vi.fn(),
        }
        const request = {
            headers: new Headers(),
            body: {getReader: () => reader},
        } as unknown as Request

        await expect(readRequestBodyUpTo(request, 10)).resolves.toEqual(new Uint8Array())
        expect(reader.releaseLock).toHaveBeenCalledOnce()
    })

    it('returns null from the JSON helper when the body exceeds the limit', async () => {
        const request = {
            headers: new Headers({'content-length': '3'}),
            body: null,
        } as unknown as Request

        await expect(readJsonUpTo(request, 2)).resolves.toBeNull()
    })

    it('rejects invalid content-length values', async () => {
        const request = {
            headers: new Headers({'content-length': 'not-a-number'}),
            body: null,
        } as unknown as Request

        await expect(readRequestBodyUpTo(request, 10)).resolves.toBeNull()
    })

    it('accepts a safe content-length within the limit', async () => {
        const request = {
            headers: new Headers({'content-length': '10'}),
            body: null,
        } as unknown as Request

        await expect(readRequestBodyUpTo(request, 10)).resolves.toEqual(new Uint8Array())
    })
})
