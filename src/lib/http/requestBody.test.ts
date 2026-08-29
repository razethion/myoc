import {describe, expect, it, vi} from 'vitest'
import {readFormDataUpTo, readJsonUpTo} from './requestBody'

const encoder = new TextEncoder()

function streamedRequest(chunks: string[], headers: HeadersInit = {}): {cancel: ReturnType<typeof vi.fn>; request: Request} {
    let index = 0
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
        cancel,
        pull(controller) {
            const chunk = chunks[index]
            index += 1

            if (chunk === undefined) {
                controller.close()
                return
            }

            controller.enqueue(encoder.encode(chunk))
        },
    })

    return {
        cancel,
        request: new Request('https://example.com', {
            body,
            headers,
            method: 'POST',
        }),
    }
}

describe('request body limits', () => {
    it('rejects an empty JSON body', async () => {
        await expect(readJsonUpTo(new Request('https://example.com'), 10)).rejects.toThrow()
    })

    it('parses a streamed JSON body at the byte limit', async () => {
        const json = '{"ok":true}'
        const {request} = streamedRequest(['{"ok":', 'true}'])

        await expect(readJsonUpTo(request, encoder.encode(json).byteLength)).resolves.toEqual({ok: true})
    })

    it('returns null and cancels a streamed JSON body above the byte limit', async () => {
        const json = '{"ok":true}'
        const {cancel, request} = streamedRequest([json, ' ', 'unread'])

        await expect(readJsonUpTo(request, encoder.encode(json).byteLength)).resolves.toBeNull()
        expect(cancel).toHaveBeenCalled()
    })

    it('counts UTF-8 bytes instead of JavaScript characters', async () => {
        const json = '{"name":"é"}'
        const {request} = streamedRequest([json])

        await expect(readJsonUpTo(request, json.length)).resolves.toBeNull()
    })

    it.each(['3', 'not-a-number', '-1', '1.5', '9007199254740992'])(
        'rejects an invalid or excessive content length of %s without reading the body',
        async (contentLength) => {
            const {request} = streamedRequest(['{}'], {'content-length': contentLength})

            await expect(readJsonUpTo(request, 2)).resolves.toBeNull()
            expect(request.bodyUsed).toBe(false)
        },
    )

    it('parses a body whose declared content length equals the limit', async () => {
        const {request} = streamedRequest(['{}'], {'content-length': '2'})

        await expect(readJsonUpTo(request, 2)).resolves.toEqual({})
    })

    it('preserves a JSON syntax error below the byte limit', async () => {
        const {request} = streamedRequest(['{'])

        await expect(readJsonUpTo(request, 10)).rejects.toThrow()
    })

    it('preserves a source stream error below the byte limit', async () => {
        const sourceError = new Error('source failed')
        const request = new Request('https://example.com', {
            body: new ReadableStream<Uint8Array>({
                pull(controller) {
                    controller.error(sourceError)
                },
            }),
            method: 'POST',
        })

        await expect(readJsonUpTo(request, 10)).rejects.toBe(sourceError)
    })

    it('parses a streamed form body at the byte limit', async () => {
        const body = 'toyhousePayload=%7B%7D&characterIds=123'
        const {request} = streamedRequest([body.slice(0, 20), body.slice(20)], {
            'content-type': 'application/x-www-form-urlencoded',
        })

        const form = await readFormDataUpTo(request, encoder.encode(body).byteLength)

        expect(form?.get('toyhousePayload')).toBe('{}')
        expect(form?.get('characterIds')).toBe('123')
    })

    it('parses an empty form body when the request has a form content type', async () => {
        const request = new Request('https://example.com', {
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            method: 'POST',
        })

        const form = await readFormDataUpTo(request, 10)

        expect([...(form?.entries() ?? [])]).toEqual([])
    })

    it('returns null for a streamed form body above the byte limit', async () => {
        const body = 'toyhousePayload=%7B%7D'
        const {request} = streamedRequest([body, '&unused=value'], {
            'content-type': 'application/x-www-form-urlencoded',
        })

        await expect(readFormDataUpTo(request, encoder.encode(body).byteLength)).resolves.toBeNull()
    })

    it('parses multipart form data below the byte limit', async () => {
        const form = new FormData()
        form.set('toyhousePayload', '{}')
        const request = new Request('https://example.com', {
            body: form,
            method: 'POST',
        })

        const parsed = await readFormDataUpTo(request, 1024)

        expect(parsed?.get('toyhousePayload')).toBe('{}')
    })

    it('preserves a form parse error below the byte limit', async () => {
        const {request} = streamedRequest(['not multipart'], {
            'content-type': 'multipart/form-data; boundary=missing',
        })

        await expect(readFormDataUpTo(request, 100)).rejects.toThrow()
    })
})
