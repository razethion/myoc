export function isCloneableMediaKey(key) {
    return !['d1/', 'image-sources/', 'image-staging/', 'thumbnail-originals/'].some((prefix) => key.startsWith(prefix))
}

export function executeD1ImportStatements(db, statements) {
    const counts = {
        createdIndexes: 0,
        createdTables: 0,
        insertedRows: 0,
        insertsByTable: new Map(),
    }

    for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index]
        executeD1ImportStatement(db, statement, index, statements.length)
        recordD1ImportStatement(statement, counts)
    }

    console.log(
        `D1 import complete: ${counts.createdTables} table(s), ${counts.insertedRows} row insert(s), ${counts.createdIndexes} index(es).`,
    )
}

function executeD1ImportStatement(db, statement, index, totalStatements) {
    try {
        db.exec(statement)
    } catch (error) {
        const preview = statement.split('\n')[0].slice(0, 200)
        throw new Error(
            `D1 import failed at statement ${index + 1}/${totalStatements}: ${preview}\n${error instanceof Error ? error.message : String(error)}`,
        )
    }
}

function recordD1ImportStatement(statement, counts) {
    const tableName = createTableName(statement)

    if (tableName) {
        counts.createdTables += 1
        console.log(`D1 import: created table ${tableName} (${counts.createdTables})`)
        return
    }

    const insertTable = insertTableName(statement)

    if (insertTable) {
        recordD1ImportInsert(insertTable, counts)
        return
    }

    const indexName = createIndexName(statement)

    if (indexName) {
        counts.createdIndexes += 1
        console.log(`D1 import: created index ${indexName} (${counts.createdIndexes})`)
    }
}

function recordD1ImportInsert(tableName, counts) {
    counts.insertedRows += 1
    const tableCount = (counts.insertsByTable.get(tableName) ?? 0) + 1
    counts.insertsByTable.set(tableName, tableCount)

    if (tableCount === 1 || tableCount % 500 === 0) {
        console.log(`D1 import: inserted ${tableCount} row(s) into ${tableName} (${counts.insertedRows} total)`)
    }
}

export function insertTableName(statement) {
    const match = statement.trimStart().match(/^INSERT INTO\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i)
    return match?.[1] ?? match?.[2] ?? null
}

function createTableName(statement) {
    const match = statement.trimStart().match(/^CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i)
    return match?.[1] ?? match?.[2] ?? null
}

function createIndexName(statement) {
    const match = statement.trimStart().match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)?\s+(?:"([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))/i)
    return match?.[1] ?? match?.[2] ?? null
}

export async function readR2CloneProgress(response) {
    if (!response.body) {
        throw new Error('R2 clone worker did not return a response body.')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const state = {summary: null}

    while (true) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        buffer += decoder.decode(value, {stream: true})
        const events = buffer.split('\n\n')
        buffer = events.pop()

        for (const eventText of events) {
            consumeR2CloneEventText(eventText, state)
        }
    }

    buffer += decoder.decode()

    if (buffer.trim()) {
        consumeR2CloneEventText(buffer, state)
    }

    if (!state.summary) {
        throw new Error('R2 clone worker did not return a summary.')
    }

    return state.summary
}

function consumeR2CloneEventText(eventText, state) {
    const event = parseServerSentEvent(eventText)

    if (!event) {
        return
    }

    if (event.name === 'progress') {
        console.log(event.data.message)
        return
    }

    if (event.name === 'summary') {
        state.summary = event.data
        return
    }

    if (event.name === 'error') {
        throw new Error(event.data.error)
    }
}

function parseServerSentEvent(eventText) {
    let name = 'message'
    const dataLines = []

    for (const line of eventText.split('\n')) {
        if (line.startsWith('event:')) {
            name = line.slice('event:'.length).trim()
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice('data:'.length).trimStart())
        }
    }

    if (dataLines.length === 0) {
        return null
    }

    return {
        name,
        data: JSON.parse(dataLines.join('\n')),
    }
}
