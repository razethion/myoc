import type {Bindings} from '../../types/bindings'

const DATABASE_NAME = 'myoc-db'
const BACKUP_PREFIX = 'd1/myoc-db'
const EXPORT_POLL_ATTEMPTS = 10
const EXPORT_POLL_DELAY_MS = 2_000
const R2_MULTIPART_PART_BYTES = 5 * 1024 * 1024

type D1BackupEnv = Pick<Bindings, 'CLOUDFLARE_ACCOUNT_ID' | 'D1_DATABASE_ID' | 'D1_REST_API_TOKEN' | 'DB_BACKUP_BUCKET'>

type BackupOptions = {
    fetch?: typeof fetch
    pollAttempts?: number
    pollDelayMs?: number
}

type ExportStartResult = {
    at_bookmark?: unknown
    error?: unknown
    result?: {
        signed_url?: unknown
    }
    status?: unknown
    success?: unknown
}

type D1ExportRequestBody = {
    current_bookmark?: string
    dump_options: {
        no_data: boolean
        no_schema: boolean
        tables: string[]
    }
    output_format: 'polling'
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
    const backupBucket = requireBackupBucket(env.DB_BACKUP_BUCKET)
    const generatedAt = now.toISOString()
    const key = createBackupKey(now)
    const fetcher = options.fetch ?? fetch
    const dumpStream = await exportD1DatabaseSqlStream(env, fetcher, options)
    const statsCounter = createSqlStatsCounter()
    const gzipStream = dumpStream.pipeThrough(statsCounter.stream).pipeThrough(new CompressionStream('gzip'))
    const backupObject = await uploadMultipartStream(backupBucket, key, gzipStream, {
        httpMetadata: {
            cacheControl: 'private, no-store',
            contentEncoding: 'gzip',
            contentType: 'application/sql',
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
        schemaObjects: statsCounter.stats.schemaObjects,
        tables: statsCounter.stats.tables,
        rows: statsCounter.stats.rows,
        compressedBytes: backupObject.size,
    }

    console.log(JSON.stringify({message: 'D1 database backup complete', ...summary}))
    return summary
}

async function uploadMultipartStream(
    bucket: R2Bucket,
    key: string,
    stream: ReadableStream<Uint8Array>,
    options: R2MultipartOptions,
): Promise<R2Object> {
    const upload = await bucket.createMultipartUpload(key, options)

    try {
        const parts = await uploadStreamParts(upload, stream)
        return await upload.complete(parts)
    } catch (error) {
        await abortMultipartUpload(upload, key)
        throw error
    }
}

async function uploadStreamParts(upload: R2MultipartUpload, stream: ReadableStream<Uint8Array>): Promise<R2UploadedPart[]> {
    const reader = stream.getReader()
    const writer = new MultipartPartWriter(upload)

    try {
        while (true) {
            const {done, value} = await reader.read()

            if (done) {
                return await writer.finish()
            }

            await writer.write(value)
        }
    } catch (error) {
        await Promise.allSettled([reader.cancel(error)])
        throw error
    } finally {
        reader.releaseLock()
    }
}

class MultipartPartWriter {
    private buffer = new Uint8Array(R2_MULTIPART_PART_BYTES)
    private bufferedBytes = 0
    private nextPartNumber = 1
    private readonly parts: R2UploadedPart[] = []

    constructor(private readonly upload: R2MultipartUpload) {}

    async write(chunk: Uint8Array): Promise<void> {
        let chunkOffset = 0

        while (chunkOffset < chunk.byteLength) {
            const bytesToCopy = Math.min(this.buffer.byteLength - this.bufferedBytes, chunk.byteLength - chunkOffset)
            this.buffer.set(chunk.subarray(chunkOffset, chunkOffset + bytesToCopy), this.bufferedBytes)
            this.bufferedBytes += bytesToCopy
            chunkOffset += bytesToCopy

            if (this.bufferedBytes === this.buffer.byteLength) {
                await this.uploadBufferedPart()
            }
        }
    }

    async finish(): Promise<R2UploadedPart[]> {
        /* istanbul ignore else -- The gzip stream always emits a final chunk. */
        if (this.bufferedBytes > 0) {
            await this.uploadBufferedPart()
        }

        return this.parts
    }

    private async uploadBufferedPart(): Promise<void> {
        const bytes = this.bufferedBytes === this.buffer.byteLength ? this.buffer : this.buffer.slice(0, this.bufferedBytes)
        this.parts.push(await this.upload.uploadPart(this.nextPartNumber, bytes))
        this.nextPartNumber += 1
        this.buffer = new Uint8Array(R2_MULTIPART_PART_BYTES)
        this.bufferedBytes = 0
    }
}

function requireBackupBucket(bucket: R2Bucket | undefined): R2Bucket {
    if (!bucket) {
        throw new Error('DB_BACKUP_BUCKET is not configured')
    }

    return bucket
}

async function abortMultipartUpload(upload: R2MultipartUpload, key: string): Promise<void> {
    try {
        await upload.abort()
    } catch (error) {
        console.warn(
            JSON.stringify({
                message: 'Unable to abort incomplete D1 backup upload',
                key,
                error: error instanceof Error ? error.message : String(error),
            }),
        )
    }
}

function createBackupKey(now: Date): string {
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

async function exportD1DatabaseSqlStream(
    env: D1BackupEnv,
    fetcher: typeof fetch,
    options: BackupOptions,
): Promise<ReadableStream<Uint8Array>> {
    const exportUrl = createD1ExportUrl(env)
    const apiToken = requireEnvString(env.D1_REST_API_TOKEN, 'D1_REST_API_TOKEN')
    const signedUrl = await createD1ExportSignedUrl(exportUrl, apiToken, fetcher, options)
    const dumpResponse = await fetcher(signedUrl)

    if (!dumpResponse.ok || !dumpResponse.body) {
        throw new Error(`D1 export dump download failed with HTTP ${dumpResponse.status}`)
    }

    return dumpResponse.body
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

async function createD1ExportSignedUrl(
    exportUrl: string,
    apiToken: string,
    fetcher: typeof fetch,
    options: BackupOptions,
): Promise<string> {
    const pollAttempts = options.pollAttempts ?? EXPORT_POLL_ATTEMPTS
    const pollDelayMs = options.pollDelayMs ?? EXPORT_POLL_DELAY_MS
    let currentBookmark: string | undefined

    for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
        const response = await postD1Export<ExportStartResult>(exportUrl, apiToken, fetcher, createD1ExportRequestBody(currentBookmark))
        const signedUrl = readSignedExportUrl(response)

        if (signedUrl) {
            return signedUrl
        }

        throwIfD1ExportFailed(response)
        currentBookmark = readExportBookmark(response) ?? currentBookmark
        await waitForNextPoll(attempt, pollAttempts, pollDelayMs)
    }

    throw new Error(`D1 export did not return a signed dump URL after ${pollAttempts} attempts`)
}

function readSignedExportUrl(response: ExportStartResult): string | null {
    const signedUrl = response.result?.signed_url
    return typeof signedUrl === 'string' && signedUrl.length > 0 ? signedUrl : null
}

function throwIfD1ExportFailed(response: ExportStartResult): void {
    if (response.status === 'error') {
        throw new Error(`D1 export failed: ${typeof response.error === 'string' ? response.error : 'Unknown error'}`)
    }
}

function readExportBookmark(response: ExportStartResult): string | null {
    return typeof response.at_bookmark === 'string' && response.at_bookmark.length > 0 ? response.at_bookmark : null
}

async function waitForNextPoll(attempt: number, pollAttempts: number, pollDelayMs: number): Promise<void> {
    if (attempt < pollAttempts) {
        await wait(pollDelayMs)
    }
}

function createD1ExportRequestBody(currentBookmark: string | undefined): D1ExportRequestBody {
    return {
        output_format: 'polling',
        dump_options: {
            no_data: false,
            no_schema: false,
            tables: [],
        },
        current_bookmark: currentBookmark,
    }
}

async function postD1Export<TResult>(
    exportUrl: string,
    apiToken: string,
    fetcher: typeof fetch,
    body: D1ExportRequestBody,
): Promise<TResult> {
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

    if (payload.result === undefined) {
        throw new Error('D1 export API did not return a result')
    }

    return payload.result
}

function d1ApiErrorMessage(payload: D1ExportApiResponse<unknown>): string {
    const messages = payload.errors?.flatMap((error) => (error.message ? [error.message] : [])) ?? []
    return messages.length > 0 ? messages.join('; ') : 'Unknown error'
}

function createSqlStatsCounter(): {stream: TransformStream<Uint8Array, Uint8Array>; stats: BackupStats} {
    const stats: BackupStats = {schemaObjects: 0, tables: 0, rows: 0}
    const decoder = new TextDecoder()
    let linePrefix = ''

    return {
        stats,
        stream: new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                linePrefix = countCompleteSqlLines(linePrefix, decoder.decode(chunk, {stream: true}), stats)
                controller.enqueue(chunk)
            },
            flush() {
                linePrefix = countCompleteSqlLines(linePrefix, decoder.decode(), stats)

                if (linePrefix) {
                    countSqlLine(linePrefix, stats)
                }
            },
        }),
    }
}

function countCompleteSqlLines(linePrefix: string, text: string, stats: BackupStats): string {
    const lines = text.split('\n')

    if (lines.length === 1) {
        return appendSqlLinePrefix(linePrefix, lines[0] as string)
    }

    countSqlLine(appendSqlLinePrefix(linePrefix, lines[0] as string), stats)

    for (const line of lines.slice(1, -1)) {
        countSqlLine(line.slice(0, 128), stats)
    }

    return (lines.at(-1) as string).slice(0, 128)
}

function appendSqlLinePrefix(current: string, value: string): string {
    return (current + value).slice(0, 128)
}

function countSqlLine(line: string, stats: BackupStats): void {
    if (/^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\b/i.test(line)) {
        stats.schemaObjects += 1
    }

    if (/^\s*CREATE\s+TABLE\b/i.test(line)) {
        stats.tables += 1
    }

    if (/^\s*INSERT\s+INTO\b/i.test(line)) {
        stats.rows += 1
    }
}

async function wait(ms: number): Promise<void> {
    if (ms <= 0) {
        return
    }

    await new Promise((resolve) => setTimeout(resolve, ms))
}
