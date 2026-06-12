import {vi} from 'vitest'

export type BoundStatement = {
    sql: string
    binds: unknown[]
    first: ReturnType<typeof vi.fn>
    all: ReturnType<typeof vi.fn>
    run: ReturnType<typeof vi.fn>
}

type MockDbOptions = {
    firstResults?: unknown[]
    allResults?: unknown[][]
    runError?: Error
}

export function createMockDb(options: MockDbOptions = {}): {
    db: D1Database
    boundStatements: BoundStatement[]
} {
    const boundStatements: BoundStatement[] = []
    const firstResults = [...(options.firstResults ?? [])]
    const allResults = [...(options.allResults ?? [])]

    const db = {
        prepare: vi.fn((sql: string) => ({
            bind: vi.fn((...binds: unknown[]) => {
                const statement: BoundStatement = {
                    sql,
                    binds,
                    first: vi.fn(async () => firstResults.shift() ?? null),
                    all: vi.fn(async () => ({results: allResults.shift() ?? []})),
                    run: vi.fn(async () => {
                        if (options.runError) {
                            throw options.runError
                        }

                        return {success: true}
                    }),
                }

                boundStatements.push(statement)
                return statement
            }),
        })),
        batch: vi.fn(async () => []),
    }

    return {
        db: db as unknown as D1Database,
        boundStatements,
    }
}
