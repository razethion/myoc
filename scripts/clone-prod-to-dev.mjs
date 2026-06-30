import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile, spawn} from 'node:child_process'
import readline from 'node:readline/promises'
import {stdin as input, stdout as output} from 'node:process'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmpDir = resolve(rootDir, '.tmp')
const wranglerBin = resolve(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const localD1StateDir = resolve(rootDir, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const importTableOrder = [
    'd1_migrations',
    'users',
    'user_social_links',
    'character_folders',
    'characters',
    'character_media',
    'character_gallery_tabs',
    'character_gallery_rows',
    'character_gallery_row_media',
    'character_media_review_events',
    'sessions',
    'toyhouse_import_jobs',
    'toyhouse_import_items',
]

const config = {
    prodD1Database: process.env.PROD_D1_DATABASE || 'myoc-db',
    localD1Database: process.env.LOCAL_D1_DATABASE || 'myoc-db',
    prodR2Bucket: process.env.PROD_R2_BUCKET || 'myoc',
    devR2Bucket: process.env.DEV_R2_BUCKET || 'myoc-dev',
    concurrency: Number(process.env.CLONE_R2_CONCURRENCY || 8),
    workerPort: Number(process.env.CLONE_R2_WORKER_PORT || 8799),
}

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const yes = args.has('--yes') || args.has('-y')
const skipD1 = args.has('--skip-d1')
const skipR2 = args.has('--skip-r2')
const keepExport = args.has('--keep-export')

if (args.has('--help') || args.has('-h')) {
    console.log(`Clone production data into development targets.

Usage:
  npm run env:clone:prod-to-dev
  npm run env:clone:prod-to-dev -- --yes
  npm run env:clone:prod-to-dev -- --dry-run

Targets:
  D1: remote ${config.prodD1Database} -> local ${config.localD1Database}
  R2: remote ${config.prodR2Bucket} -> remote ${config.devR2Bucket}

R2 uses a temporary local Worker with remote R2 bindings. No S3 access-key env vars are needed,
but Wrangler must be logged in to the Cloudflare account that can access both buckets.

Options:
  --yes       Skip confirmation.
  --dry-run   Print planned R2 object changes without changing R2 or D1.
  --skip-d1   Skip D1 clone.
  --skip-r2   Skip R2 clone.
`)
    process.exit(0)
}

function assertSafeConfig() {
    if (config.prodR2Bucket === config.devR2Bucket) {
        throw new Error('Refusing to clone R2 because PROD_R2_BUCKET and DEV_R2_BUCKET are the same.')
    }
}

async function confirmDestructiveWork() {
    if (dryRun || yes) return

    const rl = readline.createInterface({input, output})
    try {
        console.log('This will replace your local dev D1 data and mirror prod R2 into the remote dev R2 bucket.')
        const answer = await rl.question('Type "clone prod to dev" to continue: ')
        if (answer.trim() !== 'clone prod to dev') {
            throw new Error('Confirmation did not match; aborting.')
        }
    } finally {
        rl.close()
    }
}

function run(command, commandArgs, options = {}) {
    return new Promise((resolvePromise, reject) => {
        const child = execFile(command, commandArgs, {
            cwd: rootDir,
            maxBuffer: 1024 * 1024 * 100,
            ...options,
        }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout
                error.stderr = stderr
                error.message = `${error.message}\nCommand: ${formatCommand(command, commandArgs)}`
                reject(error)
                return
            }
            resolvePromise({stdout, stderr})
        })

        if (options.stdio === 'inherit') {
            child.stdout?.pipe(process.stdout)
            child.stderr?.pipe(process.stderr)
        }
    })
}

function wranglerArgs(args) {
    return [wranglerBin, ...args]
}

function formatCommand(command, args) {
    return [command, ...args].map((part) => (
        /\s/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part
    )).join(' ')
}

async function cloneD1() {
    const exportFile = resolve(tmpDir, `prod-d1-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
    const importFile = resolve(tmpDir, `prod-d1-import-${new Date().toISOString().replace(/[:.]/g, '-')}.sql`)
    await mkdir(tmpDir, {recursive: true})

    console.log(`Exporting remote D1 ${config.prodD1Database}...`)
    await run(process.execPath, wranglerArgs([
        'd1',
        'export',
        config.prodD1Database,
        '--remote',
        '--output',
        exportFile,
        '--skip-confirmation',
    ]), {stdio: 'inherit'})

    console.log('Preparing D1 export for local import...')
    await sanitizeD1Export(exportFile, importFile)

    console.log(`Resetting local D1 ${config.localD1Database}...`)
    await resetLocalD1State()

    console.log(`Importing production dump into local D1 ${config.localD1Database}...`)
    await importLocalD1(importFile)

    if (!keepExport) {
        await rm(exportFile, {force: true})
        await rm(importFile, {force: true})
    } else {
        console.log(`Kept D1 export at ${exportFile}`)
        console.log(`Kept sanitized D1 import at ${importFile}`)
    }
}

async function resetLocalD1State() {
    if (!localD1StateDir.startsWith(rootDir)) {
        throw new Error(`Refusing to remove local D1 state outside the project: ${localD1StateDir}`)
    }

    await rm(localD1StateDir, {recursive: true, force: true})
    console.log(`Removed local D1 state at ${localD1StateDir}`)
}

async function importLocalD1(importFile) {
    await mkdir(localD1StateDir, {recursive: true})
    console.log('Initializing fresh local D1 state...')
    await run(process.execPath, wranglerArgs([
        'd1',
        'execute',
        config.localD1Database,
        '--local',
        '--json',
        '--command',
        'SELECT 1;',
    ]))

    const dbFile = await findLocalD1DatabaseFile()
    const {DatabaseSync} = await import('node:sqlite')
    const db = new DatabaseSync(dbFile)
    const statements = splitSqlStatements(await readFile(importFile, 'utf8'))

    try {
        console.log(`D1 import: executing ${statements.length} SQL statement(s) into ${dbFile}`)
        executeD1ImportStatements(db, statements)
    } finally {
        db.close()
    }
}

function executeD1ImportStatements(db, statements) {
    const insertCounts = new Map()
    let createdTables = 0
    let createdIndexes = 0
    let insertedRows = 0

    for (let index = 0; index < statements.length; index += 1) {
        const statement = statements[index]

        try {
            db.exec(statement)
        } catch (error) {
            const preview = statement.split('\n')[0]?.slice(0, 200) ?? ''
            throw new Error(`D1 import failed at statement ${index + 1}/${statements.length}: ${preview}\n${error instanceof Error ? error.message : String(error)}`)
        }

        const tableName = createTableName(statement)
        const indexName = createIndexName(statement)
        const insertTable = insertTableName(statement)

        if (tableName) {
            createdTables += 1
            console.log(`D1 import: created table ${tableName} (${createdTables})`)
        } else if (insertTable) {
            insertedRows += 1
            const tableCount = (insertCounts.get(insertTable) ?? 0) + 1
            insertCounts.set(insertTable, tableCount)

            if (tableCount === 1 || tableCount % 500 === 0) {
                console.log(`D1 import: inserted ${tableCount} row(s) into ${insertTable} (${insertedRows} total)`)
            }
        } else if (indexName) {
            createdIndexes += 1
            console.log(`D1 import: created index ${indexName} (${createdIndexes})`)
        }
    }

    console.log(`D1 import complete: ${createdTables} table(s), ${insertedRows} row insert(s), ${createdIndexes} index(es).`)
}

async function findLocalD1DatabaseFile() {
    const entries = await readdir(localD1StateDir, {withFileTypes: true})
    const databaseFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite')
        .map((entry) => resolve(localD1StateDir, entry.name))

    if (databaseFiles.length !== 1) {
        throw new Error(`Expected one local D1 SQLite file, found ${databaseFiles.length}.`)
    }

    return databaseFiles[0]
}

async function sanitizeD1Export(exportFile, importFile) {
    const sql = await readFile(exportFile, 'utf8')
    const statements = splitSqlStatements(sql)
    const sanitizedStatements = statements.filter((statement) => !isManagedSqliteStatement(statement))
    const removedStatements = statements.length - sanitizedStatements.length
    const tableStatements = sanitizedStatements.filter((statement) => /^CREATE TABLE\b/i.test(statement.trimStart()))
    const indexStatements = sanitizedStatements.filter((statement) => /^CREATE (?:UNIQUE )?INDEX\b/i.test(statement.trimStart()))
    const insertStatements = orderInsertStatements(sanitizedStatements.filter((statement) => /^INSERT INTO\b/i.test(statement.trimStart())))
    const dataStatements = sanitizedStatements.filter((statement) => (
        !/^PRAGMA\b/i.test(statement.trimStart())
        && !/^CREATE TABLE\b/i.test(statement.trimStart())
        && !/^CREATE (?:UNIQUE )?INDEX\b/i.test(statement.trimStart())
        && !/^INSERT INTO\b/i.test(statement.trimStart())
    ))
    const sanitized = [
        'PRAGMA foreign_keys=OFF;',
        ...tableStatements,
        ...insertStatements,
        ...dataStatements,
        ...indexStatements,
        'PRAGMA foreign_keys=ON;',
    ].join('\n')

    await writeFile(importFile, sanitized)
    console.log(`D1 export prepared: ${tableStatements.length} table(s), ${insertStatements.length} insert(s), ${indexStatements.length} index(es), ${removedStatements} managed SQLite statement(s) removed.`)
}

function splitSqlStatements(sql) {
    const statements = []
    let current = []

    for (const line of sql.split(/\r?\n/)) {
        if (!line.trim()) {
            continue
        }

        current.push(line)

        if (line.trimEnd().endsWith(';')) {
            statements.push(current.join('\n'))
            current = []
        }
    }

    if (current.length > 0) {
        statements.push(current.join('\n'))
    }

    return statements
}

function orderInsertStatements(statements) {
    const insertsByTable = new Map()
    const unordered = []

    for (const statement of statements) {
        const tableName = insertTableName(statement)

        if (!tableName) {
            unordered.push(statement)
            continue
        }

        const inserts = insertsByTable.get(tableName) ?? []
        inserts.push(statement)
        insertsByTable.set(tableName, inserts)
    }

    return [
        ...importTableOrder.flatMap((tableName) => insertsByTable.get(tableName) ?? []),
        ...[...insertsByTable.entries()]
            .filter(([tableName]) => !importTableOrder.includes(tableName))
            .flatMap(([, inserts]) => inserts),
        ...unordered,
    ]
}

function insertTableName(statement) {
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

function isManagedSqliteStatement(line) {
    return /\bsqlite_sequence\b/i.test(line)
        || /\bsqlite_stat\d*\b/i.test(line)
}

async function cloneR2() {
    await mkdir(tmpDir, {recursive: true})

    const workerFile = resolve(tmpDir, 'r2-clone-worker.mjs')
    const workerConfigFile = resolve(tmpDir, 'r2-clone-wrangler.jsonc')
    await writeFile(workerFile, r2CloneWorkerSource())
    await writeFile(workerConfigFile, JSON.stringify({
        name: 'myoc-r2-clone',
        main: './r2-clone-worker.mjs',
        compatibility_date: '2026-06-10',
        r2_buckets: [
            {
                binding: 'PROD_MEDIA_BUCKET',
                bucket_name: config.prodR2Bucket,
                remote: true,
            },
            {
                binding: 'DEV_MEDIA_BUCKET',
                bucket_name: config.devR2Bucket,
                remote: true,
            },
        ],
    }, null, 2))

    const dev = await startR2CloneWorker(workerConfigFile)
    try {
        const url = new URL('/clone', `http://127.0.0.1:${config.workerPort}`)
        url.searchParams.set('dryRun', dryRun ? '1' : '0')
        url.searchParams.set('concurrency', String(config.concurrency))

        const response = await fetch(url, {method: 'POST'})
        if (!response.ok) {
            const body = await response.text()
            throw new Error(`R2 clone worker failed: ${response.status} ${response.statusText}\n${body}`)
        }

        const summary = await readR2CloneProgress(response)
        console.log(`R2 plan: ${summary.toCopy} copy/update, ${summary.toDelete} delete, ${summary.sourceObjects} source object(s).`)
        if (!dryRun) {
            console.log(`R2 applied: ${summary.copied} copied/updated, ${summary.deleted} deleted.`)
        }
    } finally {
        await stopR2CloneWorker(dev)
    }
}

async function readR2CloneProgress(response) {
    if (!response.body) {
        return await response.json()
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let summary = null

    while (true) {
        const {done, value} = await reader.read()

        if (done) {
            break
        }

        buffer += decoder.decode(value, {stream: true})
        const events = buffer.split('\n\n')
        buffer = events.pop() ?? ''

        for (const eventText of events) {
            const event = parseServerSentEvent(eventText)

            if (!event) {
                continue
            }

            if (event.name === 'progress') {
                console.log(event.data.message)
            } else if (event.name === 'summary') {
                summary = event.data
            } else if (event.name === 'error') {
                throw new Error(event.data.error)
            }
        }
    }

    if (buffer.trim()) {
        const event = parseServerSentEvent(buffer)
        if (event?.name === 'summary') {
            summary = event.data
        } else if (event?.name === 'error') {
            throw new Error(event.data.error)
        }
    }

    if (!summary) {
        throw new Error('R2 clone worker did not return a summary.')
    }

    return summary
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

async function startR2CloneWorker(workerConfigFile) {
    console.log(`Starting temporary R2 clone Worker on http://127.0.0.1:${config.workerPort}...`)
    const state = {
        child: spawn(process.execPath, wranglerArgs([
            'dev',
            '--config',
            workerConfigFile,
            '--port',
            String(config.workerPort),
            '--log-level',
            'info',
            '--show-interactive-dev-session=false',
        ]), {
            cwd: rootDir,
            stdio: ['ignore', 'pipe', 'pipe'],
        }),
        exited: false,
        logs: '',
    }

    state.child.stdout.on('data', (chunk) => {
        const text = chunk.toString()
        state.logs += text
        process.stdout.write(text)
    })
    state.child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        state.logs += text
        process.stderr.write(text)
    })
    state.child.on('exit', () => {
        state.exited = true
    })

    const healthUrl = `http://127.0.0.1:${config.workerPort}/health`
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (state.exited) {
            throw new Error(`Temporary R2 clone Worker exited before it was ready.\n${state.logs}`)
        }
        try {
            const response = await fetch(healthUrl)
            if (response.ok) return state
        } catch {
            // Wait for Wrangler to finish starting the local runtime.
        }
        await delay(500)
    }

    await stopR2CloneWorker(state)
    throw new Error(`Timed out waiting for temporary R2 clone Worker.\n${state.logs}`)
}

async function stopR2CloneWorker(state) {
    if (!state || state.exited) return

    state.child.kill()
    await Promise.race([
        new Promise((resolvePromise) => state.child.once('exit', resolvePromise)),
        delay(5000),
    ])
}

function delay(ms) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function r2CloneWorkerSource() {
    return `
export default {
    async fetch(request, env) {
        const url = new URL(request.url)
        if (url.pathname === '/health') {
            return json({ok: true})
        }
        if (url.pathname !== '/clone' || request.method !== 'POST') {
            return json({error: 'Not found'}, 404)
        }

        return cloneStream(url, env)
    },
}

function cloneStream(url, env) {
    const encoder = new TextEncoder()

    return new Response(new ReadableStream({
        async start(controller) {
            const send = (event, data) => {
                controller.enqueue(encoder.encode('event: ' + event + '\\n' + 'data: ' + JSON.stringify(data) + '\\n\\n'))
            }
            const progress = (message) => send('progress', {message})

            try {
                const dryRun = url.searchParams.get('dryRun') === '1'
                const concurrency = Math.max(1, Math.min(Number(url.searchParams.get('concurrency') || 8), 32))
                progress('[r2] Listing source bucket...')
                const sourceObjects = await listAll(env.PROD_MEDIA_BUCKET, 'source', progress)
                progress('[r2] Listing destination bucket...')
                const destObjects = await listAll(env.DEV_MEDIA_BUCKET, 'destination', progress)
                const sourceByKey = new Map(sourceObjects.map((object) => [object.key, object]))
                const destByKey = new Map(destObjects.map((object) => [object.key, object]))
                const toCopy = sourceObjects.filter((source) => {
                    const dest = destByKey.get(source.key)
                    return !dest || dest.size !== source.size || dest.etag !== source.etag
                })
                const toDelete = destObjects.filter((dest) => !sourceByKey.has(dest.key))
                const summary = {
                    dryRun,
                    sourceObjects: sourceObjects.length,
                    destObjects: destObjects.length,
                    toCopy: toCopy.length,
                    toDelete: toDelete.length,
                    copied: 0,
                    deleted: 0,
                }

                progress('[r2] Plan: ' + summary.toCopy + ' copy/update, ' + summary.toDelete + ' delete, ' + summary.sourceObjects + ' source object(s), ' + summary.destObjects + ' destination object(s).')

                if (!dryRun) {
                    progress('[r2] Copying/updating objects with concurrency ' + concurrency + '...')
                    await runPool(toCopy, concurrency, async (object) => {
                        const source = await env.PROD_MEDIA_BUCKET.get(object.key)
                        if (source === null || !('body' in source)) {
                            throw new Error('Source object disappeared while cloning: ' + object.key)
                        }
                        await env.DEV_MEDIA_BUCKET.put(object.key, source.body, {
                            httpMetadata: source.httpMetadata,
                            customMetadata: source.customMetadata,
                        })
                        summary.copied += 1
                        if (summary.copied === 1 || summary.copied % 100 === 0 || summary.copied === summary.toCopy) {
                            progress('[r2] Copied/updated ' + summary.copied + '/' + summary.toCopy + ' object(s).')
                        }
                    })

                    progress('[r2] Deleting objects missing from source...')
                    for (const keys of chunks(toDelete.map((object) => object.key), 1000)) {
                        await env.DEV_MEDIA_BUCKET.delete(keys)
                        summary.deleted += keys.length
                        progress('[r2] Deleted ' + summary.deleted + '/' + summary.toDelete + ' object(s).')
                    }
                } else {
                    progress('[r2] Dry run: no R2 objects were changed.')
                }

                send('summary', summary)
            } catch (error) {
                send('error', {error: error instanceof Error ? error.message : String(error)})
            } finally {
                controller.close()
            }
        },
    }), {
        headers: {'content-type': 'text/event-stream'},
    })
}

async function listAll(bucket, label, progress) {
    const objects = []
    let cursor
    let pageCount = 0
    do {
        const page = await bucket.list({cursor, limit: 1000})
        objects.push(...page.objects.map((object) => ({
            key: object.key,
            etag: object.etag,
            size: object.size,
        })))
        pageCount += 1
        progress('[r2] Listed ' + objects.length + ' ' + label + ' object(s) across ' + pageCount + ' page(s).')
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return objects
}

async function runPool(items, concurrency, worker) {
    let nextIndex = 0
    const workers = Array.from({length: Math.max(1, Math.min(concurrency, items.length || 1))}, async () => {
        while (nextIndex < items.length) {
            const index = nextIndex
            nextIndex += 1
            await worker(items[index])
        }
    })
    await Promise.all(workers)
}

function chunks(items, size) {
    const result = []
    for (let index = 0; index < items.length; index += size) {
        result.push(items.slice(index, index + size))
    }
    return result
}

function json(value, status = 200) {
    return new Response(JSON.stringify(value), {
        status,
        headers: {'content-type': 'application/json'},
    })
}
`
}

async function main() {
    assertSafeConfig()
    await confirmDestructiveWork()

    if (dryRun) {
        console.log('Dry run: D1 clone will be skipped; R2 changes will be planned only.')
    }

    if (!skipD1 && !dryRun) {
        await cloneD1()
    }

    if (!skipR2) {
        await cloneR2()
    }

    console.log('Production to development clone complete.')
}

main().catch((error) => {
    console.error(error.message)
    if (error.stderr) console.error(error.stderr)
    process.exit(1)
})
