import {applyD1Migrations, type D1Migration, reset} from 'cloudflare:test'
import {env} from 'cloudflare:workers'
import {beforeEach, describe, expect, it} from 'vitest'
import {queryAll} from './test/d1'

const testDb = env.DB
const migrations = (env as typeof env & {TEST_MIGRATIONS: D1Migration[]}).TEST_MIGRATIONS
const finalMigration = migrations.at(-1)

if (!finalMigration) {
    throw new Error('Expected TEST_MIGRATIONS to contain the case-insensitive username migration')
}

function insertUser(id: string, username: string, createdAt: string): D1PreparedStatement {
    return testDb
        .prepare(
            `INSERT INTO users (id, email, username, password_hash, created_at)
             VALUES (?, ?, ?, 'test-password-hash', ?)`,
        )
        .bind(id, `${id}@example.test`, username, createdAt)
}

async function usersByCreatedAt(): Promise<{id: string; username: string}[]> {
    return queryAll<{id: string; username: string}>('SELECT id, username FROM users ORDER BY created_at', [], testDb)
}

describe('migration 0037_enforce_case_insensitive_usernames', () => {
    beforeEach(async () => {
        await reset()
    })

    it('renames case-insensitive duplicates and blocks new ones', async () => {
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
        // "<name prefix>_<id hex>" using the shortest free suffix.
        await expect(usersByCreatedAt()).resolves.toEqual([
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

    it('extends the suffix when the replacement name already exists in another case', async () => {
        await applyD1Migrations(testDb, migrations.slice(0, -1))

        await testDb.batch([
            insertUser('aaaaaaaa-0000-4000-8000-000000000000', 'Raz', '2026-01-01 00:00:00'),
            insertUser('dddddddd-0000-4000-8000-000000000000', 'RAZ_BBBBBBBB', '2026-01-15 00:00:00'),
            insertUser('bbbbbbbb-0000-4000-8000-000000000000', 'raz', '2026-02-01 00:00:00'),
        ])

        await applyD1Migrations(testDb, [finalMigration])

        // The 'raz' duplicate would become 'raz_bbbbbbbb', which already exists
        // as 'RAZ_BBBBBBBB'. The case-insensitive availability check extends the
        // suffix instead of writing a colliding name.
        await expect(usersByCreatedAt()).resolves.toEqual([
            {id: 'aaaaaaaa-0000-4000-8000-000000000000', username: 'Raz'},
            {id: 'dddddddd-0000-4000-8000-000000000000', username: 'RAZ_BBBBBBBB'},
            {id: 'bbbbbbbb-0000-4000-8000-000000000000', username: 'raz_bbbbbbbb0'},
        ])
    })

    it('assigns distinct replacements when duplicate ids share a prefix', async () => {
        await applyD1Migrations(testDb, migrations.slice(0, -1))

        await testDb.batch([
            insertUser('aaaaaaaa-0000-4000-8000-000000000000', 'Raz', '2026-01-01 00:00:00'),
            insertUser('bbbbbbbb-0000-4000-8000-000000000000', 'raz', '2026-02-01 00:00:00'),
            insertUser('bbbbbbbb-0000-4000-8000-000000000001', 'RAZ', '2026-03-01 00:00:00'),
        ])

        await applyD1Migrations(testDb, [finalMigration])

        // Both duplicates share their first id characters. The second rename
        // sees the first replacement as taken and extends its own suffix.
        await expect(usersByCreatedAt()).resolves.toEqual([
            {id: 'aaaaaaaa-0000-4000-8000-000000000000', username: 'Raz'},
            {id: 'bbbbbbbb-0000-4000-8000-000000000000', username: 'raz_bbbbbbbb'},
            {id: 'bbbbbbbb-0000-4000-8000-000000000001', username: 'RAZ_bbbbbbbb0'},
        ])
    })

    it('keeps distinct usernames untouched and rejects case-variant inserts', async () => {
        await applyD1Migrations(testDb, migrations)

        await testDb.batch([
            insertUser('aaaaaaaa-0000-4000-8000-000000000000', 'Raz', '2026-01-01 00:00:00'),
            insertUser('dddddddd-0000-4000-8000-000000000000', 'someone', '2026-01-15 00:00:00'),
        ])

        await expect(usersByCreatedAt()).resolves.toEqual([
            {id: 'aaaaaaaa-0000-4000-8000-000000000000', username: 'Raz'},
            {id: 'dddddddd-0000-4000-8000-000000000000', username: 'someone'},
        ])

        await expect(insertUser('eeeeeeee-0000-4000-8000-000000000000', 'raz', '2026-02-01 00:00:00').run()).rejects.toThrow(
            /UNIQUE constraint failed/,
        )
    })
})
