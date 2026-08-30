import {describe, expect, it, vi} from 'vitest'
import {executeD1ImportStatements, insertTableName, readR2CloneProgress} from './clone-prod-to-dev-helpers.mjs'

describe('clone production data helpers', () => {
    it('executes D1 statements and reports useful counts', () => {
        const inserts = Array.from({length: 500}, (_, index) => `INSERT INTO "users" VALUES (${index});`)
        const statements = [
            'CREATE TABLE "users" (id INTEGER);',
            ...inserts,
            'CREATE UNIQUE INDEX "users_id" ON users(id);',
            'PRAGMA optimize;',
        ]
        const db = {exec: vi.fn()}
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        try {
            executeD1ImportStatements(db, statements)

            expect(db.exec).toHaveBeenCalledTimes(statements.length)
            expect(log).toHaveBeenLastCalledWith('D1 import complete: 1 table(s), 500 row insert(s), 1 index(es).')
        } finally {
            log.mockRestore()
        }
    })

    it.each([new Error('database failed'), 'database failed'])('adds statement context to D1 errors: %s', (error) => {
        const db = {
            exec: vi.fn(() => {
                throw error
            }),
        }

        expect(() => executeD1ImportStatements(db, ['SELECT 1;\nSELECT 2;'])).toThrow(
            'D1 import failed at statement 1/1: SELECT 1;\ndatabase failed',
        )
    })

    it('identifies the target of an insert statement', () => {
        // noinspection SqlResolve,SqlInsertValues
        expect(insertTableName('INSERT INTO users VALUES (1);')).toBe('users')
        // noinspection SqlResolve
        expect(insertTableName('INSERT INTO "user records" VALUES (1);')).toBe('user records')
        expect(insertTableName('SELECT 1;')).toBeNull()
    })

    it('reads streamed progress and a split UTF-8 summary tail', async () => {
        const text = [
            'event: progress\ndata: {"message":"Copying"}\n\n',
            'comment without data\n\n',
            'event: summary\ndata: {"label":"café"}',
        ].join('')
        const encoded = new TextEncoder().encode(text)
        const split = encoded.indexOf(0xc3) + 1
        const response = new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(encoded.slice(0, split))
                    controller.enqueue(encoded.slice(split))
                    controller.close()
                },
            }),
        )
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

        try {
            expect(await readR2CloneProgress(response)).toEqual({label: 'café'})
            expect(log).toHaveBeenCalledWith('Copying')
        } finally {
            log.mockRestore()
        }
    })

    it('rejects a response without a stream', async () => {
        await expectCloneProgressError(new Response(null, {status: 204}), 'R2 clone worker did not return a response body')
    })

    it('reads a summary from a terminated stream event', async () => {
        const response = new Response('event: summary\ndata: {"copied":3}\n\n')
        expect(await readR2CloneProgress(response)).toEqual({copied: 3})
    })

    it('reports a streamed clone error', async () => {
        const response = new Response('event: error\ndata: {"error":"copy failed"}')
        await expectCloneProgressError(response, 'copy failed')
    })

    it('requires a clone summary', async () => {
        const response = new Response('event: message\ndata: {"ok":true}')
        await expectCloneProgressError(response, 'R2 clone worker did not return a summary')
    })
})

async function expectCloneProgressError(response, expectedMessage) {
    try {
        await readR2CloneProgress(response)
    } catch (error) {
        expect(error).toBeInstanceOf(Error)
        if (!(error instanceof Error)) throw error
        expect(error.message).toContain(expectedMessage)
        return
    }

    throw new Error(`Expected clone progress to fail with: ${expectedMessage}`)
}
