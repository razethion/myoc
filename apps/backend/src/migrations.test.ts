import {applyD1Migrations, type D1Migration, reset} from 'cloudflare:test'
import {env} from 'cloudflare:workers'
import {beforeEach, describe, expect, it} from 'vitest'
import {queryAll} from './test/d1'

const testDb = env.DB
const migrations = (env as typeof env & {TEST_MIGRATIONS: D1Migration[]}).TEST_MIGRATIONS

function insertUser(id: string, username: string, createdAt: string): D1PreparedStatement {
    return testDb
        .prepare(
            `INSERT INTO users (id, email, username, password_hash, created_at)
             VALUES (?, ?, ?, 'test-password-hash', ?)`,
        )
        .bind(id, `${id}@example.test`, username, createdAt)
}

describe('migration 0037_enforce_case_insensitive_usernames', () => {
    beforeEach(async () => {
        await reset()
    })

    it('renames case-insensitive duplicates and blocks new ones', async () => {
        const finalMigration = migrations.at(-1)
        if (!finalMigration) {
            throw new Error('Expected TEST_MIGRATIONS to contain the case-insensitive username migration')
        }
        expect(finalMigration.name).toContain('0037_enforce_case_insensitive_usernames')

        await applyD1Migrations(testDb, migrations.slice(0, -1))

        await testDb.batch([
            insertUser('aaaaaaaa-0000-4000-8000-000000000000', 'Raz', '2026-01-01 00:00:00'),
            insertUser('bbbbbbbb-0000-4000-8000-000000000000', 'raz', '2026-02-01 00:00:00'),
            insertUser('cccccccc-0000-4000-8000-000000000000', 'RAZ', '2026-03-01 00:00:00'),
            insertUser('dddddddd-0000-4000-8000-000000000000', 'someone', '2026-01-15 00:00:00'),
        ])

        await applyD1Migrations(testDb, [finalMigration])

        // The oldest account keeps its username. Newer duplicates are renamed to
        // "<name prefix>_<first 8 chars of id>" so the unique index can be created.
        await expect(
            queryAll<{id: string; username: string}>('SELECT id, username FROM users ORDER BY created_at', [], testDb),
        ).resolves.toEqual([
            {id: 'aaaaaaaa-0000-4000-8000-000000000000', username: 'Raz'},
            {id: 'dddddddd-0000-4000-8000-000000000000', username: 'someone'},
            {id: 'bbbbbbbb-0000-4000-8000-000000000000', username: 'raz_bbbbbbbb'},
            {id: 'cccccccc-0000-4000-8000-000000000000', username: 'RAZ_cccccccc'},
        ])

        // After the migration, a new account cannot reuse a name that differs
        // only by case from an existing username.
        await expect(insertUser('eeeeeeee-0000-4000-8000-000000000000', 'RAZ', '2026-04-01 00:00:00').run()).rejects.toThrow(
            /UNIQUE constraint failed/,
        )
    })

    it('keeps distinct usernames untouched and rejects case-variant inserts', async () => {
        await applyD1Migrations(testDb, migrations)

        await testDb.batch([
            insertUser('aaaaaaaa-0000-4000-8000-000000000000', 'Raz', '2026-01-01 00:00:00'),
            insertUser('dddddddd-0000-4000-8000-000000000000', 'someone', '2026-01-15 00:00:00'),
        ])

        await expect(queryAll<{username: string}>('SELECT username FROM users ORDER BY created_at', [], testDb)).resolves.toEqual([
            {username: 'Raz'},
            {username: 'someone'},
        ])

        await expect(insertUser('eeeeeeee-0000-4000-8000-000000000000', 'raz', '2026-02-01 00:00:00').run()).rejects.toThrow(
            /UNIQUE constraint failed/,
        )
    })
})
