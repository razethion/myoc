import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {backupD1Database, createBackupKey} from './backup'

const EXPORT_SQL = [
    'CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);',
    'CREATE UNIQUE INDEX idx_users_username ON users(username);',
    'INSERT INTO "users" ("id", "email", "username", "password_hash") VALUES (\'user-1\', \'raz@example.test\', \'raz\', \'hash-1\');',
    'INSERT INTO "users" ("id", "email", "username", "password_hash") VALUES (\'user-2\', \'eth@example.test\', \'eth\', \'hash-2\');',
].join('\n')

describe('backupD1Database', () => {
    it('exports D1 through the REST API and stores a gzipped SQL backup in R2', async () => {
        const backupBucket = createMockR2Bucket()
        const now = new Date('2026-07-12T08:00:00.000Z')
        const fetcher = createExportFetch()

        const summary = await backupD1Database(
            {
                CLOUDFLARE_ACCOUNT_ID: 'account-id',
                D1_DATABASE_ID: 'database-id',
                D1_REST_API_TOKEN: 'api-token',
                DB_BACKUP_BUCKET: backupBucket,
            },
            now,
            {
                fetch: fetcher,
                pollDelayMs: 0,
            },
        )

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
        expect(backupBucket.put).toHaveBeenCalledWith(
            summary.key,
            expect.any(Uint8Array),
            expect.objectContaining({
                httpMetadata: {
                    contentEncoding: 'gzip',
                    contentType: 'application/sql',
                },
                customMetadata: {
                    database: 'myoc-db',
                    generatedAt: '2026-07-12T08:00:00.000Z',
                },
            }),
        )

        const object = await backupBucket.get(summary.key)
        expect(object).not.toBeNull()
        expect(await gunzipObject(object)).toBe(EXPORT_SQL)
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

describe('createBackupKey', () => {
    it('creates date-partitioned gzip object keys', () => {
        expect(createBackupKey(new Date('2026-01-02T03:04:05.006Z'))).toBe('d1/myoc-db/2026/01/02/myoc-db-2026-01-02T03-04-05-006Z.sql.gz')
    })
})

function createExportFetch(): typeof fetch {
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

        return new Response(EXPORT_SQL, {status: 200})
    })

    return fetcher as unknown as typeof fetch
}

async function gunzipObject(object: R2ObjectBody | null): Promise<string> {
    if (!object) {
        throw new Error('Expected backup object to exist')
    }

    const compressedBytes = await object.bytes()
    const decompressedStream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(decompressedStream).text()
}
