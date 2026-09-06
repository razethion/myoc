export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.pathname === '/health') return Response.json({ok: true})
        if (url.pathname !== '/seed' || request.method !== 'POST') return Response.json({error: 'Not found'}, {status: 404})

        return seedStream(request, env)
    },
}

function seedStream(request, env) {
    const encoder = new TextEncoder()
    return new Response(
        new ReadableStream({
            async start(controller) {
                const send = (event, data) => {
                    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
                }
                try {
                    const input = await request.json()
                    const keys = validateKeys(input.keys)
                    const concurrency = Math.max(1, Math.min(Number(input.concurrency ?? 8), 16))
                    const destinationKeys = await listKeys(env.DEVELOPMENT_MEDIA_BUCKET)
                    send('progress', {message: `Clearing ${destinationKeys.length} development R2 object(s).`})
                    for (const group of chunks(destinationKeys, 1000)) await env.DEVELOPMENT_MEDIA_BUCKET.delete(group)

                    let copied = 0
                    send('progress', {message: `Copying ${keys.length} selected production R2 object(s).`})
                    await runPool(keys, concurrency, async (key) => {
                        const source = await env.PRODUCTION_MEDIA_BUCKET.get(key)
                        if (!source) throw new Error(`Production R2 object is missing: ${key}`)
                        await env.DEVELOPMENT_MEDIA_BUCKET.put(key, source.body, {
                            httpMetadata: source.httpMetadata,
                            customMetadata: source.customMetadata,
                        })
                        copied += 1
                        if (copied === 1 || copied % 100 === 0 || copied === keys.length) {
                            send('progress', {message: `Copied ${copied}/${keys.length} selected R2 object(s).`})
                        }
                    })
                    send('summary', {cleared: destinationKeys.length, copied})
                } catch (error) {
                    send('error', {error: error instanceof Error ? error.message : String(error)})
                } finally {
                    controller.close()
                }
            },
        }),
        {headers: {'content-type': 'text/event-stream'}},
    )
}

function validateKeys(value) {
    if (!Array.isArray(value) || value.length > 20_000) throw new Error('The R2 object list is invalid or too large.')
    const keys = value.filter((key) => typeof key === 'string' && key.length > 0 && key.length <= 1024)
    if (keys.length !== value.length || new Set(keys).size !== keys.length)
        throw new Error('The R2 object list has an invalid or duplicate key.')
    return keys
}

async function listKeys(bucket) {
    const keys = []
    let cursor
    do {
        const page = await bucket.list({cursor, limit: 1000})
        keys.push(...page.objects.map((object) => object.key))
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return keys
}

async function runPool(items, concurrency, worker) {
    let nextIndex = 0
    await Promise.all(
        Array.from({length: Math.max(1, Math.min(concurrency, items.length || 1))}, async () => {
            while (nextIndex < items.length) {
                const index = nextIndex
                nextIndex += 1
                await worker(items[index])
            }
        }),
    )
}

function chunks(items, size) {
    const result = []
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
    return result
}
