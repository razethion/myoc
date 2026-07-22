import {describe, expect, it, vi} from 'vitest'
import {readJsonUpTo} from './requestBody'

describe('request body limits', () => {
    it('returns empty bytes when a request has no body', async () => {
        await expect(readJsonUpTo(new Request('https://example.com'), 10)).rejects.toThrow()
    })

    it('skips empty stream chunks', async () => {
        const reader = {
            read: vi
                .fn()
                .mockResolvedValueOnce({done: false, value: undefined})
                .mockResolvedValueOnce({done: false, value: new TextEncoder().encode('{}')})
                .mockResolvedValueOnce({done: true, value: undefined}),
            releaseLock: vi.fn(),
            cancel: vi.fn(),
        }
        const request = {
            url: 'https://example.com',
            method: 'POST',
            headers: new Headers(),
            body: {getReader: () => reader},
        } as unknown as Request

        await expect(readJsonUpTo(request, 10)).resolves.toEqual({})
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

        await expect(readJsonUpTo(request, 10)).resolves.toBeNull()
    })

    it('accepts a safe content-length within the limit', async () => {
        const request = {
            headers: new Headers({'content-length': '10'}),
            body: null,
        } as unknown as Request

        await expect(readJsonUpTo(request, 10)).rejects.toThrow()
    })
})
