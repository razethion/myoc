import {describe, expect, it, vi} from 'vitest'
import {createMockR2Bucket} from '../../test/mockR2'
import {backupD1Database, createBackupKey} from './backup'

const FIXTURE_TABLE = 'backup_fixture_users'
const FIXTURE_COLUMNS = ['id', 'label', 'login_count', 'avatar'] as const
const FIXTURE_INDEX = 'idx_backup_fixture_users_label'

describe('backupD1Database', () => {
    it('stores a gzipped SQL backup in R2', async () => {
        const db = createBackupDb()
        const backupBucket = createMockR2Bucket()
        const now = new Date('2026-07-12T08:00:00.000Z')

        const summary = await backupD1Database(
            {
                DB: db,
                DB_BACKUP_BUCKET: backupBucket,
            },
            now,
            {rowPageSize: 1},
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
        const backupSql = await gunzipObject(object)
        expect(backupSql).toContain('-- myoc-db D1 backup generated at 2026-07-12T08:00:00.000Z')
        expect(backupSql).toContain('PRAGMA foreign_keys=OFF;')
        expect(backupSql).toContain(`${createFixtureTableSql()};`)
        expect(backupSql).toContain(fixtureInsertSql("'user-1'", "'O''Malley'", '3', "X'000fff'"))
        expect(backupSql).toContain(fixtureInsertSql("'user-2'", 'NULL', '0', "X''"))
        expect(backupSql.indexOf(createFixtureIndexSql())).toBeGreaterThan(backupSql.indexOf(insertPrefix()))
        expect(backupSql).toContain('\nCOMMIT;\nPRAGMA foreign_keys=ON;\n')
    })
})

describe('createBackupKey', () => {
    it('creates date-partitioned gzip object keys', () => {
        expect(createBackupKey(new Date('2026-01-02T03:04:05.006Z'))).toBe('d1/myoc-db/2026/01/02/myoc-db-2026-01-02T03-04-05-006Z.sql.gz')
    })
})

function createBackupDb(): D1Database {
    return {
        prepare: vi.fn((sql: string) => {
            const statement = {
                binds: [] as unknown[],
                bind(...binds: unknown[]) {
                    statement.binds = binds
                    return statement
                },
                async all<T>() {
                    if (sql.includes('sqlite_master')) {
                        return d1Result([
                            {
                                type: 'table',
                                name: FIXTURE_TABLE,
                                tbl_name: FIXTURE_TABLE,
                                sql: createFixtureTableSql(),
                            },
                            {
                                type: 'index',
                                name: FIXTURE_INDEX,
                                tbl_name: FIXTURE_TABLE,
                                sql: createFixtureIndexSql(),
                            },
                        ] as T[])
                    }

                    if (sql.includes('pragma_table_info')) {
                        return d1Result([{name: 'id'}, {name: 'label'}, {name: 'login_count'}, {name: 'avatar'}] as T[])
                    }

                    throw new Error(`Unexpected all() SQL: ${sql}`)
                },
                async raw<T>() {
                    if (!sql.includes(` ${keyword('FROM')} ${quotedIdentifier(FIXTURE_TABLE)}`)) {
                        throw new Error(`Unexpected raw() SQL: ${sql}`)
                    }

                    const limit = Number(statement.binds[0])
                    const offset = Number(statement.binds[1])
                    const rows = [
                        ['user-1', "O'Malley", 3, new Uint8Array([0x00, 0x0f, 0xff])],
                        ['user-2', null, 0, new Uint8Array()],
                    ]

                    return rows.slice(offset, offset + limit) as T[]
                },
            }

            return statement
        }),
        batch: vi.fn(),
        exec: vi.fn(),
        dump: vi.fn(),
        withSession: vi.fn(),
    } as unknown as D1Database
}

function createFixtureTableSql(): string {
    return [
        keyword('CREATE'),
        keyword('TABLE'),
        FIXTURE_TABLE,
        `(${FIXTURE_COLUMNS[0]} TEXT ${keyword('PRIMARY')} ${keyword('KEY')}, ${FIXTURE_COLUMNS[1]} TEXT, ${FIXTURE_COLUMNS[2]} INTEGER, ${FIXTURE_COLUMNS[3]} BLOB)`,
    ].join(' ')
}

function createFixtureIndexSql(): string {
    return [keyword('CREATE'), keyword('INDEX'), FIXTURE_INDEX, keyword('ON'), `${FIXTURE_TABLE}(${FIXTURE_COLUMNS[1]})`].join(' ')
}

function fixtureInsertSql(id: string, label: string, loginCount: string, avatar: string): string {
    return `${insertPrefix()} ${keyword('VALUES')} (${id}, ${label}, ${loginCount}, ${avatar});`
}

function insertPrefix(): string {
    return [
        keyword('INSERT'),
        keyword('INTO'),
        quotedIdentifier(FIXTURE_TABLE),
        `(${FIXTURE_COLUMNS.map(quotedIdentifier).join(', ')})`,
    ].join(' ')
}

function quotedIdentifier(value: string): string {
    return `"${value}"`
}

function keyword(value: string): string {
    return value
}

function d1Result<T>(results: T[]): D1Result<T> {
    return {
        success: true,
        results,
        meta: {
            changed_db: false,
            changes: 0,
            duration: 0,
            last_row_id: 0,
            rows_read: results.length,
            rows_written: 0,
            size_after: 0,
        },
    }
}

async function gunzipObject(object: R2ObjectBody | null): Promise<string> {
    if (!object) {
        throw new Error('Expected backup object to exist')
    }

    const compressedBytes = await object.bytes()
    const decompressedStream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream('gzip'))
    return await new Response(decompressedStream).text()
}
