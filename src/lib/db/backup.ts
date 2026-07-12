import type {Bindings} from '../../types/bindings'

const DATABASE_NAME = 'myoc-db'
const BACKUP_PREFIX = 'd1/myoc-db'
const ROW_PAGE_SIZE = 500

type D1BackupEnv = Pick<Bindings, 'DB' | 'DB_BACKUP_BUCKET'>

type BackupOptions = {
    rowPageSize?: number
}

type SchemaObjectRow = {
    type: 'table' | 'index' | 'trigger' | 'view'
    name: string
    tbl_name: string
    sql: string
}

type TableColumnRow = {
    name: string
}

type SqlValue = ArrayBuffer | ArrayBufferView | boolean | number | string | null

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
    const stats: BackupStats = {
        schemaObjects: 0,
        tables: 0,
        rows: 0,
    }
    const sqlStream = streamFromAsyncIterable(createD1BackupSqlChunks(env.DB, generatedAt, stats, options))
    const gzipStream = sqlStream.pipeThrough(new TextEncoderStream()).pipeThrough(new CompressionStream('gzip'))
    const backupObject = await env.DB_BACKUP_BUCKET.put(key, gzipStream, {
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

async function* createD1BackupSqlChunks(
    db: D1Database,
    generatedAt: string,
    stats: BackupStats,
    options: BackupOptions,
): AsyncGenerator<string> {
    const schemaObjects = await listSchemaObjects(db)
    const tableObjects = schemaObjects.filter((object) => object.type === 'table')
    const deferredSchemaObjects = schemaObjects.filter((object) => object.type !== 'table')
    const rowPageSize = options.rowPageSize ?? ROW_PAGE_SIZE

    stats.schemaObjects = schemaObjects.length
    stats.tables = tableObjects.length

    yield `-- ${DATABASE_NAME} D1 backup generated at ${generatedAt}\n`
    yield 'PRAGMA foreign_keys=OFF;\n'
    yield 'BEGIN TRANSACTION;\n\n'

    for (const table of tableObjects) {
        yield `${ensureSqlStatementTerminator(table.sql)}\n`
    }

    if (tableObjects.length > 0) {
        yield '\n'
    }

    for (const table of tableObjects) {
        const columns = await listTableColumns(db, table.name)

        if (columns.length === 0) {
            continue
        }

        const quotedTableName = quoteIdentifier(table.name)
        const quotedColumnList = columns.map(quoteIdentifier).join(', ')
        const selectSql = `SELECT ${quotedColumnList} FROM ${quotedTableName} ORDER BY rowid LIMIT ? OFFSET ?`
        let offset = 0

        while (true) {
            const rows = await db.prepare(selectSql).bind(rowPageSize, offset).raw<SqlValue[]>()

            if (rows.length === 0) {
                break
            }

            for (const row of rows) {
                stats.rows += 1
                yield `INSERT INTO ${quotedTableName} (${quotedColumnList}) VALUES (${row.map(sqlLiteral).join(', ')});\n`
            }

            if (rows.length < rowPageSize) {
                break
            }

            offset += rowPageSize
        }

        yield '\n'
    }

    for (const schemaObject of deferredSchemaObjects) {
        yield `${ensureSqlStatementTerminator(schemaObject.sql)}\n`
    }

    yield '\nCOMMIT;\n'
    yield 'PRAGMA foreign_keys=ON;\n'
}

async function listSchemaObjects(db: D1Database): Promise<SchemaObjectRow[]> {
    const result = await db
        .prepare(
            `SELECT type, name, tbl_name, sql
             FROM sqlite_master
             WHERE sql IS NOT NULL
               AND name NOT LIKE 'sqlite_%'
             ORDER BY
               CASE type
                 WHEN 'table' THEN 0
                 WHEN 'index' THEN 1
                 WHEN 'trigger' THEN 2
                 WHEN 'view' THEN 3
                 ELSE 4
               END,
               name`,
        )
        .all<SchemaObjectRow>()

    return result.results
}

async function listTableColumns(db: D1Database, tableName: string): Promise<string[]> {
    const result = await db.prepare(`SELECT name FROM pragma_table_info(${sqlLiteral(tableName)}) ORDER BY cid`).all<TableColumnRow>()
    return result.results.map((column) => column.name)
}

function streamFromAsyncIterable<T>(iterable: AsyncIterable<T>): ReadableStream<T> {
    const iterator = iterable[Symbol.asyncIterator]()

    return new ReadableStream<T>({
        async pull(controller) {
            const next = await iterator.next()

            if (next.done) {
                controller.close()
                return
            }

            controller.enqueue(next.value)
        },
        async cancel() {
            await iterator.return?.()
        },
    })
}

function ensureSqlStatementTerminator(sql: string): string {
    const trimmed = sql.trimEnd()
    return trimmed.endsWith(';') ? trimmed : `${trimmed};`
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`
}

function sqlLiteral(value: SqlValue): string {
    if (value === null) {
        return 'NULL'
    }

    if (typeof value === 'boolean') {
        return value ? '1' : '0'
    }

    if (typeof value === 'number') {
        return Number.isFinite(value) ? String(value) : sqlLiteral(String(value))
    }

    if (typeof value === 'string') {
        return `'${value.replace(/'/g, "''")}'`
    }

    if (value instanceof ArrayBuffer) {
        return blobLiteral(new Uint8Array(value))
    }

    return blobLiteral(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
}

function blobLiteral(bytes: Uint8Array): string {
    let hex = ''

    for (const byte of bytes) {
        hex += byte.toString(16).padStart(2, '0')
    }

    return `X'${hex}'`
}
