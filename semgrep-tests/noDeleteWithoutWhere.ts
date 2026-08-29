declare const db: {
    exec(sql: string): unknown
    prepare(sql: string): unknown
}
declare const table: string

// noinspection SqlWithoutWhere
const unsafeDeletes = [
    // ruleid: myoc.sql.no-delete-without-where
    db.prepare('DELETE FROM users'),
    // ruleid: myoc.sql.no-delete-without-where
    db.prepare('delete from sessions;'),
    // ruleid: myoc.sql.no-delete-without-where
    db.exec(`
        DELETE FROM "character_media";
    `),
    // ruleid: myoc.sql.no-delete-without-where
    db.prepare(`DELETE FROM ${table}`),
]

// ok: myoc.sql.no-delete-without-where
const filteredDelete = db.prepare('DELETE FROM users WHERE id = ?')

// ok: myoc.sql.no-delete-without-where
const multilineFilteredDelete = db.prepare(`
    DELETE FROM sessions
    WHERE expires_at <= ?
`)

void [filteredDelete, multilineFilteredDelete, unsafeDeletes]

export {}
