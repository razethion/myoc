import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {backupD1Database} from './backup'

const EXPORT_SQL = [
    'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);',
    'CREATE UNIQUE INDEX idx_users_username ON users(username);',
    'INSERT INTO "users" ("id", "email", "username", "password_hash") VALUES (\'user-1\', \'raz@example.test\', \'raz\', \'hash-1\');',
    'INSERT INTO "users" ("id", "email", "username", "password_hash") VALUES (\'user-2\', \'eth@example.test\', \'eth\', \'hash-2\');',
].join('\n')

describe('backupD1Database', () => {
    it('uses the global fetch implementation when no fetch option is provided', async () => {
        const fetcher = createExportFetch()
        vi.stubGlobal('fetch', fetcher)

        try {
            const summary = await backupD1Database({
                CLOUDFLARE_ACCOUNT_ID: 'account-id',
                D1_DATABASE_ID: 'database-id',
                D1_REST_API_TOKEN: 'api-token',
                DB_BACKUP_BUCKET: createMockR2Bucket(),
            })

            expect(summary.databaseName).toBe('myoc-db')
            expect(summary.key).toMatch(/^d1\/myoc-db\/\d{4}\/\d{2}\/\d{2}\/myoc-db-\d{4}-\d{2}-\d{2}T/)
            expect(fetcher).toHaveBeenCalled()
        } finally {
            vi.unstubAllGlobals()
        }
    })

    it('exports D1 through the REST API and stores a gzipped SQL backup in R2', async () => {
        const backupBucket = createMockR2Bucket()
        const mediaBucket = createMockR2Bucket()
        const now = new Date('2026-07-12T08:00:00.000Z')
        const fetcher = createExportFetch()
        const env = {
            CLOUDFLARE_ACCOUNT_ID: 'account-id',
            D1_DATABASE_ID: 'database-id',
            D1_REST_API_TOKEN: 'api-token',
            DB_BACKUP_BUCKET: backupBucket,
            MEDIA_BUCKET: mediaBucket,
        }

        const summary = await backupD1Database(env, now, {
            fetch: fetcher,
            pollDelayMs: 0,
        })

        expect(summary).toMatchObject({
            key: 'd1/myoc-db/2026/07/12/myoc-db-2026-07-12T08-00-00-000Z.sql.gz',
            databaseName: 'myoc-db',
            generatedAt: '2026-07-12T08:00:00.000Z',
            schemaObjects: 2,
            tables: 1,
            rows: 2,
        })
        expect(summary.compressedBytes).toBeGreaterThan(0)
        expect(fetcher).toHaveBeenNthCalledWith(
            1,
            'https://api.cloudflare.com/client/v4/accounts/account-id/d1/database/database-id/export',
            expect.objectContaining({
                body: JSON.stringify({
                    output_format: 'polling',
                    dump_options: {
                        no_data: false,
                        no_schema: false,
                        tables: [],
                    },
                }),
                headers: expect.objectContaining({
                    Authorization: 'Bearer api-token',
                    'Content-Type': 'application/json',
                }),
                method: 'POST',
            }),
        )
        expect(fetcher).toHaveBeenNthCalledWith(
            2,
            'https://api.cloudflare.com/client/v4/accounts/account-id/d1/database/database-id/export',
            expect.objectContaining({
                body: JSON.stringify({
                    output_format: 'polling',
                    dump_options: {
                        no_data: false,
                        no_schema: false,
                        tables: [],
                    },
                    current_bookmark: 'bookmark-1',
                }),
            }),
        )
        expect(fetcher).toHaveBeenNthCalledWith(3, 'https://example.test/dump.sql')
        expect(backupBucket.createMultipartUpload).toHaveBeenCalledWith(summary.key, {
            httpMetadata: {
                cacheControl: 'private, no-store',
                contentEncoding: 'gzip',
                contentType: 'application/sql',
            },
            customMetadata: {
                database: 'myoc-db',
                generatedAt: '2026-07-12T08:00:00.000Z',
            },
        })
        expect(backupBucket.put).not.toHaveBeenCalled()
        expect(mediaBucket.createMultipartUpload).not.toHaveBeenCalled()
        expect(mediaBucket.put).not.toHaveBeenCalled()
        expect((await mediaBucket.list()).objects).toEqual([])

        const object = await backupBucket.get(summary.key)
        expect(object).not.toBeNull()
        expect(await gunzipObject(object)).toBe(EXPORT_SQL)
    })

    it('fails before export when the backup bucket is not configured', async () => {
        const fetcher = vi.fn() as unknown as typeof fetch
        const mediaBucket = createMockR2Bucket()
        const env = {
            CLOUDFLARE_ACCOUNT_ID: 'account-id',
            D1_DATABASE_ID: 'database-id',
            D1_REST_API_TOKEN: 'api-token',
            MEDIA_BUCKET: mediaBucket,
        }

        await expect(
            backupD1Database(env, new Date('2026-07-12T08:00:00.000Z'), {
                fetch: fetcher,
                pollDelayMs: 0,
            }),
        ).rejects.toThrow('DB_BACKUP_BUCKET is not configured')
        expect(fetcher).not.toHaveBeenCalled()
        expect(mediaBucket.createMultipartUpload).not.toHaveBeenCalled()
        expect(mediaBucket.put).not.toHaveBeenCalled()
    })

    it('uploads compressed backups in valid multipart chunks', async () => {
        const backupBucket = createMockR2Bucket()
        const completedSize = 123
        const uploadedSizes: number[] = []
        const upload = {
            abort: vi.fn(),
            complete: vi.fn(async () => ({size: completedSize})),
            uploadPart: vi.fn(async (partNumber: number, value: Uint8Array, _options?: R2UploadPartOptions) => {
                uploadedSizes.push(value.byteLength)
                return {partNumber, etag: `etag-${partNumber}`}
            }),
        }
        vi.mocked(backupBucket.createMultipartUpload).mockResolvedValue(upload as unknown as R2MultipartUpload)

        const summary = await backupD1Database(
            {
                CLOUDFLARE_ACCOUNT_ID: 'account-id',
                D1_DATABASE_ID: 'database-id',
                D1_REST_API_TOKEN: 'api-token',
                DB_BACKUP_BUCKET: backupBucket,
            },
            new Date('2026-07-12T08:00:00.000Z'),
            {
                fetch: createExportFetch(createLargeExportBytes()),
                pollDelayMs: 0,
            },
        )

        expect(uploadedSizes.length).toBeGreaterThan(1)
        expect(uploadedSizes.every((size) => size > 0)).toBe(true)
        expect(uploadedSizes.slice(0, -1).every((size) => size >= 5 * 1024 * 1024)).toBe(true)
        const partNumbers = upload.uploadPart.mock.calls.map(([partNumber]) => partNumber)
        expect(new Set(partNumbers).size).toBe(partNumbers.length)
        expect(partNumbers.every((partNumber) => Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= 10_000)).toBe(true)
        expect(upload.uploadPart.mock.calls.every(([, , options]) => options === undefined)).toBe(true)
        expect(summary.compressedBytes).toBe(completedSize)
    })

    it.each([new Error('abort failed'), 'abort failed'])('reports an abort failure and keeps the upload error: %s', async (abortError) => {
        const backupBucket = createMockR2Bucket()
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
        const upload = {
            abort: vi.fn(async () => {
                throw abortError
            }),
            complete: vi.fn(),
            uploadPart: vi.fn(async () => {
                throw new Error('R2 part upload failed')
            }),
        }
        vi.mocked(backupBucket.createMultipartUpload).mockResolvedValue(upload as unknown as R2MultipartUpload)

        try {
            await expect(
                backupD1Database(
                    {
                        CLOUDFLARE_ACCOUNT_ID: 'account-id',
                        D1_DATABASE_ID: 'database-id',
                        D1_REST_API_TOKEN: 'api-token',
                        DB_BACKUP_BUCKET: backupBucket,
                    },
                    new Date('2026-07-12T08:00:00.000Z'),
                    {
                        fetch: createExportFetch(),
                        pollDelayMs: 0,
                    },
                ),
            ).rejects.toThrow('R2 part upload failed')
            expect(upload.abort).toHaveBeenCalled()
            expect(upload.complete).not.toHaveBeenCalled()
            expect(warning).toHaveBeenCalledWith(expect.stringContaining('abort failed'))
        } finally {
            warning.mockRestore()
        }
    })

    it('reports an export API error when the API rejects the backup request', async () => {
        const fetcher = vi.fn(async () =>
            Response.json(
                {
                    errors: [{message: 'not allowed'}],
                    success: false,
                },
                {status: 403},
            ),
        ) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow('D1 export API failed with HTTP 403: not allowed')
    })

    it('reports an unknown export API error when Cloudflare does not return messages', async () => {
        const fetcher = vi.fn(async () =>
            Response.json(
                {
                    success: false,
                },
                {status: 500},
            ),
        ) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow('D1 export API failed with HTTP 500: Unknown error')
    })

    it('reports a malformed export API response without a result', async () => {
        const fetcher = vi.fn(async () =>
            Response.json({
                success: true,
            }),
        ) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow('D1 export API did not return a result')
    })

    it.each([
        {
            result: {
                status: 'error',
                error: 'bookmark expired',
            },
            message: 'D1 export failed: bookmark expired',
        },
        {
            result: {
                status: 'error',
                error: {message: 'bookmark expired'},
            },
            message: 'D1 export failed: Unknown error',
        },
    ])('reports failed export polling responses as $message', async ({result, message}) => {
        const fetcher = vi.fn(async () =>
            Response.json({
                result,
                success: true,
            }),
        ) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow(message)
    })

    it('reports when export polling never returns a signed dump URL', async () => {
        const fetcher = vi.fn(async () =>
            Response.json({
                result: {
                    status: 'active',
                },
                success: true,
            }),
        ) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollAttempts: 2,
                    pollDelayMs: 1,
                },
            ),
        ).rejects.toThrow('D1 export did not return a signed dump URL after 2 attempts')
        expect(fetcher).toHaveBeenCalledTimes(2)
    })

    it('reports a dump download failure after receiving a signed URL', async () => {
        const fetcher = vi.fn(async (input: RequestInfo | URL) => {
            if (String(input).endsWith('/export')) {
                return Response.json({
                    result: {
                        result: {
                            signed_url: 'https://example.test/dump.sql',
                        },
                    },
                    success: true,
                })
            }

            return new Response('unavailable', {status: 503})
        }) as unknown as typeof fetch

        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: 'api-token',
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                },
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: fetcher,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow('D1 export dump download failed with HTTP 503')
    })

    it('reports a configuration error when the API token secret is missing', async () => {
        await expect(
            backupD1Database(
                {
                    CLOUDFLARE_ACCOUNT_ID: 'account-id',
                    D1_DATABASE_ID: 'database-id',
                    D1_REST_API_TOKEN: undefined,
                    DB_BACKUP_BUCKET: createMockR2Bucket(),
                } as unknown as Parameters<typeof backupD1Database>[0],
                new Date('2026-07-12T08:00:00.000Z'),
                {
                    fetch: vi.fn() as unknown as typeof fetch,
                    pollDelayMs: 0,
                },
            ),
        ).rejects.toThrow('D1_REST_API_TOKEN is not configured')
    })
})

function createExportFetch(exportBody: BodyInit = EXPORT_SQL): typeof fetch {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)

        if (url.endsWith('/export')) {
            const call = fetcher.mock.calls.length

            if (call === 1) {
                return Response.json({
                    result: {
                        at_bookmark: 'bookmark-1',
                        success: true,
                        type: 'export',
                    },
                    success: true,
                })
            }

            return Response.json({
                result: {
                    result: {
                        signed_url: 'https://example.test/dump.sql',
                    },
                    status: 'complete',
                    success: true,
                    type: 'export',
                },
                success: true,
            })
        }

        return new Response(exportBody, {status: 200})
    })

    return fetcher as unknown as typeof fetch
}

function createLargeExportBytes(): Uint8Array {
    const bytes = new Uint8Array(6 * 1024 * 1024)
    let state = 0x9e3779b9

    for (let index = 0; index < bytes.length - 1; index += 1) {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        bytes[index] = state & 0xff
    }

    bytes[bytes.length - 1] = 0x0a
    return bytes
}

async function gunzipObject(object: R2ObjectBody | null): Promise<string> {
    if (!object) {
        throw new Error('Expected backup object to exist')
    }

    const compressedBytes = await object.bytes()
    const decompressedStream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(decompressedStream).text()
}
