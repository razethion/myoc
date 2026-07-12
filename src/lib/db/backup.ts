import type {Bindings} from '../../types/bindings'

const DATABASE_NAME = 'myoc-db'
const BACKUP_PREFIX = 'd1/myoc-db'
const EXPORT_POLL_ATTEMPTS = 10
const EXPORT_POLL_DELAY_MS = 2_000

type D1BackupEnv = Pick<Bindings, 'CLOUDFLARE_ACCOUNT_ID' | 'D1_DATABASE_ID' | 'D1_REST_API_TOKEN' | 'DB_BACKUP_BUCKET'>

type BackupOptions = {
    fetch?: typeof fetch
    pollAttempts?: number
    pollDelayMs?: number
}

type ExportStartResult = {
    at_bookmark?: unknown
}

type ExportPollResult = {
    signed_url?: unknown
}

type D1ExportApiResponse<TResult> = {
    errors?: Array<{message?: string}>
    result?: TResult
    success?: boolean
}

export type D1BackupSummary = {
    key: string
    databaseName: string
    generatedAt: string
    schemaObjects: number
    tables: number
    rows: number
    compressedBytes: number
}

type BackupStats = {
    schemaObjects: number
    tables: number
    rows: number
}

export async function backupD1Database(env: D1BackupEnv, now = new Date(), options: BackupOptions = {}): Promise<D1BackupSummary> {
    const generatedAt = now.toISOString()
    const key = createBackupKey(now)
    const fetcher = options.fetch ?? fetch
    const dumpSql = await exportD1DatabaseSql(env, fetcher, options)
    const stats = countSqlDumpStats(dumpSql)
    const gzipBytes = await gzipText(dumpSql)
    const backupObject = await env.DB_BACKUP_BUCKET.put(key, gzipBytes, {
        httpMetadata: {
            contentType: 'application/sql',
            contentEncoding: 'gzip',
        },
        customMetadata: {
            database: DATABASE_NAME,
            generatedAt,
        },
    })

    const summary = {
        key,
        databaseName: DATABASE_NAME,
        generatedAt,
        schemaObjects: stats.schemaObjects,
        tables: stats.tables,
        rows: stats.rows,
        compressedBytes: backupObject.size,
    }

    console.log('D1 database backup complete', summary)
    return summary
}

export function createBackupKey(now: Date): string {
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    const [datePart] = timestamp.split('T')

    if (datePart === undefined) {
        throw new Error('Unable to create D1 backup key without a valid ISO date')
    }

    const [year, month, day] = datePart.split('-')

    if (year === undefined || month === undefined || day === undefined) {
        throw new Error('Unable to create D1 backup key without date parts')
    }

    return `${BACKUP_PREFIX}/${year}/${month}/${day}/${DATABASE_NAME}-${timestamp}.sql.gz`
}

async function exportD1DatabaseSql(env: D1BackupEnv, fetcher: typeof fetch, options: BackupOptions): Promise<string> {
    const exportUrl = createD1ExportUrl(env)
    const apiToken = requireEnvString(env.D1_REST_API_TOKEN, 'D1_REST_API_TOKEN')
    const bookmark = await startD1Export(exportUrl, apiToken, fetcher)
    const signedUrl = await pollD1Export(exportUrl, apiToken, bookmark, fetcher, options)
    const dumpResponse = await fetcher(signedUrl)

    if (!dumpResponse.ok) {
        throw new Error(`D1 export dump download failed with HTTP ${dumpResponse.status}`)
    }

    return await dumpResponse.text()
}

function createD1ExportUrl(env: D1BackupEnv): string {
    const accountId = encodeURIComponent(requireEnvString(env.CLOUDFLARE_ACCOUNT_ID, 'CLOUDFLARE_ACCOUNT_ID'))
    const databaseId = encodeURIComponent(requireEnvString(env.D1_DATABASE_ID, 'D1_DATABASE_ID'))
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/export`
}

function requireEnvString(value: string | undefined, name: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new Error(`${name} is not configured`)
    }

    return value
}

async function startD1Export(exportUrl: string, apiToken: string, fetcher: typeof fetch): Promise<string> {
    const response = await postD1Export<ExportStartResult>(exportUrl, apiToken, fetcher, {output_format: 'polling'})
    const bookmark = response.result?.at_bookmark

    if (typeof bookmark !== 'string' || bookmark.length === 0) {
        throw new Error('D1 export did not return an export bookmark')
    }

    return bookmark
}

async function pollD1Export(
    exportUrl: string,
    apiToken: string,
    bookmark: string,
    fetcher: typeof fetch,
    options: BackupOptions,
): Promise<string> {
    const pollAttempts = options.pollAttempts ?? EXPORT_POLL_ATTEMPTS
    const pollDelayMs = options.pollDelayMs ?? EXPORT_POLL_DELAY_MS

    for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
        const response = await postD1Export<ExportPollResult>(exportUrl, apiToken, fetcher, {current_bookmark: bookmark})
        const signedUrl = response.result?.signed_url

        if (typeof signedUrl === 'string' && signedUrl.length > 0) {
            return signedUrl
        }

        if (attempt < pollAttempts) {
            await wait(pollDelayMs)
        }
    }

    throw new Error(`D1 export did not return a signed dump URL after ${pollAttempts} attempts`)
}

async function postD1Export<TResult>(
    exportUrl: string,
    apiToken: string,
    fetcher: typeof fetch,
    body: Record<string, string>,
): Promise<D1ExportApiResponse<TResult>> {
    const response = await fetcher(exportUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    })
    const payload = (await response.json()) as D1ExportApiResponse<TResult>

    if (!response.ok || payload.success === false) {
        throw new Error(`D1 export API failed with HTTP ${response.status}: ${d1ApiErrorMessage(payload)}`)
    }

    return payload
}

function d1ApiErrorMessage(payload: D1ExportApiResponse<unknown>): string {
    const messages = payload.errors?.flatMap((error) => (error.message ? [error.message] : [])) ?? []
    return messages.length > 0 ? messages.join('; ') : 'Unknown error'
}

async function gzipText(text: string): Promise<Uint8Array> {
    const gzipStream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
    return new Uint8Array(await new Response(gzipStream).arrayBuffer())
}

function countSqlDumpStats(sql: string): BackupStats {
    return {
        schemaObjects: countMatches(sql, /^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\b/gim),
        tables: countMatches(sql, /^\s*CREATE\s+TABLE\b/gim),
        rows: countMatches(sql, /^\s*INSERT\s+INTO\b/gim),
    }
}

function countMatches(value: string, pattern: RegExp): number {
    return [...value.matchAll(pattern)].length
}

async function wait(ms: number): Promise<void> {
    if (ms <= 0) {
        return
    }

    await new Promise((resolve) => setTimeout(resolve, ms))
}
