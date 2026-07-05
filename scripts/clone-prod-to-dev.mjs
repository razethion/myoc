import {mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises'
import {existsSync, readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFile, spawn} from 'node:child_process'
import {createHash, createHmac} from 'node:crypto'
import readline from 'node:readline/promises'
import {stdin as input, stdout as output} from 'node:process'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tmpDir = resolve(rootDir, '.tmp')
const wranglerBin = resolve(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const localD1StateDir = resolve(rootDir, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const args = new Set(process.argv.slice(2))
loadLocalEnv('.env')
loadLocalEnv('.dev.vars')
const importTableOrder = [
    'd1_migrations',
    'users',
    'user_social_links',
    'character_folders',
    'characters',
    'character_folder_placements',
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
    r2Mode: optionValue('--r2-mode') || process.env.CLONE_R2_MODE || 'auto',
    r2AccountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.R2_ACCOUNT_ID || '',
    r2Endpoint: process.env.R2_ENDPOINT || '',
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    r2Region: process.env.R2_REGION || process.env.AWS_REGION || 'auto',
}

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

R2 prefers server-side S3 CopyObject when R2 S3 credentials are available. Otherwise it falls
back to a temporary local Worker with remote R2 bindings.
Existing R2 keys are skipped, except height-chart objects are refreshed to avoid stale dev images
after the production D1 import.

Options:
  --yes                Skip confirmation.
  --dry-run            Print planned R2 object changes without changing R2 or D1.
  --skip-d1            Skip D1 clone.
  --skip-r2            Skip R2 clone.
  --r2-mode=auto|s3|worker
                       Choose the R2 clone implementation. Default: auto.

S3 R2 env, loaded from the shell, .env, or .dev.vars:
  CLOUDFLARE_ACCOUNT_ID or R2_ACCOUNT_ID
  R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY
  R2_ENDPOINT optional, defaults to https://<account>.r2.cloudflarestorage.com
`)
    process.exit(0)
}

function assertSafeConfig() {
    if (config.prodR2Bucket === config.devR2Bucket) {
        throw new Error('Refusing to clone R2 because PROD_R2_BUCKET and DEV_R2_BUCKET are the same.')
    }
    if (!['auto', 's3', 'worker'].includes(config.r2Mode)) {
        throw new Error(`Unsupported R2 clone mode "${config.r2Mode}". Use auto, s3, or worker.`)
    }
}

function optionValue(name) {
    const prefix = `${name}=`
    const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))
    return value ? value.slice(prefix.length) : ''
}

function loadLocalEnv(filename) {
    const file = resolve(rootDir, filename)
    if (!existsSync(file)) return

    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue

        const equalsIndex = trimmed.indexOf('=')
        if (equalsIndex === -1) continue

        const key = trimmed.slice(0, equalsIndex).trim()
        const value = unquoteEnvValue(trimmed.slice(equalsIndex + 1).trim())
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) {
            process.env[key] = value
        }
    }
}

function unquoteEnvValue(value) {
    if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1)
    }

    return value
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
    if (shouldUseS3R2Clone()) {
        await cloneR2WithS3()
        return
    }

    if (config.r2Mode === 's3') {
        throw new Error('R2 S3 clone mode requires CLOUDFLARE_ACCOUNT_ID/R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.')
    }

    console.log('R2 S3 credentials were not found; falling back to temporary local Worker clone.')
    await cloneR2WithWorker()
}

function shouldUseS3R2Clone() {
    if (config.r2Mode === 'worker') return false
    return Boolean(r2S3Endpoint() && config.r2AccessKeyId && config.r2SecretAccessKey)
}

function r2S3Endpoint() {
    if (config.r2Endpoint) return config.r2Endpoint.replace(/\/+$/, '')
    if (config.r2AccountId) return `https://${config.r2AccountId}.r2.cloudflarestorage.com`
    return ''
}

async function cloneR2WithS3() {
    console.log('Using R2 S3 CopyObject for server-side bucket clone.')
    console.log('[r2] Listing source bucket...')
    const sourceObjects = await listAllR2S3(config.prodR2Bucket, 'source')
    console.log('[r2] Listing destination bucket...')
    const destObjects = await listAllR2S3(config.devR2Bucket, 'destination')
    const sourceByKey = new Map(sourceObjects.map((object) => [object.key, object]))
    const destByKey = new Map(destObjects.map((object) => [object.key, object]))
    const toCopy = sourceObjects.filter((source) => shouldCopyR2Object(source, destByKey))
    const toRefreshExisting = toCopy.filter((source) => destByKey.has(source.key))
    const skippedExisting = sourceObjects.length - toCopy.length
    const toDelete = destObjects.filter((dest) => !sourceByKey.has(dest.key))
    const summary = {
        sourceObjects: sourceObjects.length,
        destObjects: destObjects.length,
        toCopy: toCopy.length,
        toRefreshExisting: toRefreshExisting.length,
        skippedExisting,
        toDelete: toDelete.length,
        copied: 0,
        deleted: 0,
    }

    console.log(`[r2] Plan: ${summary.toCopy} copy, ${summary.toRefreshExisting} refresh existing height-chart, ${summary.skippedExisting} skip existing, ${summary.toDelete} delete, ${summary.sourceObjects} source object(s), ${summary.destObjects} destination object(s).`)

    if (dryRun) {
        console.log('[r2] Dry run: no R2 objects were changed.')
        console.log(`R2 plan: ${summary.toCopy} copy, ${summary.toRefreshExisting} refresh existing height-chart, ${summary.skippedExisting} skip existing, ${summary.toDelete} delete, ${summary.sourceObjects} source object(s).`)
        return
    }

    console.log(`[r2] Copying selected objects with concurrency ${config.concurrency}...`)
    await runPool(toCopy, config.concurrency, async (object) => {
        await copyR2S3Object(object.key)
        summary.copied += 1
        if (summary.copied === 1 || summary.copied % 100 === 0 || summary.copied === summary.toCopy) {
            console.log(`[r2] Copied ${summary.copied}/${summary.toCopy} selected object(s).`)
        }
    })

    console.log('[r2] Deleting objects missing from source...')
    for (const keys of chunks(toDelete.map((object) => object.key), 1000)) {
        await deleteR2S3Objects(config.devR2Bucket, keys)
        summary.deleted += keys.length
        console.log(`[r2] Deleted ${summary.deleted}/${summary.toDelete} object(s).`)
    }

    console.log(`R2 plan: ${summary.toCopy} copy, ${summary.toRefreshExisting} refresh existing height-chart, ${summary.skippedExisting} skip existing, ${summary.toDelete} delete, ${summary.sourceObjects} source object(s).`)
    console.log(`R2 applied: ${summary.copied} copied, ${summary.deleted} deleted.`)
}

function shouldCopyR2Object(source, destByKey) {
    return !destByKey.has(source.key) || shouldRefreshExistingR2Key(source.key)
}

function shouldRefreshExistingR2Key(key) {
    return key.includes('/height-chart/')
}

async function listAllR2S3(bucket, label) {
    const objects = []
    let continuationToken
    let pageCount = 0

    do {
        const query = {
            'list-type': '2',
            'max-keys': '1000',
            'encoding-type': 'url',
        }
        if (continuationToken) query['continuation-token'] = continuationToken

        const response = await r2S3Request({
            method: 'GET',
            bucket,
            query,
        })
        const xml = await response.text()
        const pageObjects = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((match) => ({
            key: decodeS3XmlValue(xmlTagValue(match[1], 'Key')),
            etag: stripEtagQuotes(xmlTagValue(match[1], 'ETag')),
            size: Number(xmlTagValue(match[1], 'Size')),
        }))

        objects.push(...pageObjects)
        pageCount += 1
        console.log(`[r2] Listed ${objects.length} ${label} object(s) across ${pageCount} page(s).`)

        const truncated = xmlTagValue(xml, 'IsTruncated') === 'true'
        continuationToken = truncated ? decodeS3XmlValue(xmlTagValue(xml, 'NextContinuationToken')) : ''
    } while (continuationToken)

    return objects
}

async function copyR2S3Object(key) {
    await r2S3Request({
        method: 'PUT',
        bucket: config.devR2Bucket,
        key,
        headers: {
            'x-amz-copy-source': s3CopySource(config.prodR2Bucket, key),
            'x-amz-metadata-directive': 'COPY',
        },
    })
}

async function deleteR2S3Objects(bucket, keys) {
    if (keys.length === 0) return

    const body = [
        '<Delete>',
        '<Quiet>true</Quiet>',
        ...keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`),
        '</Delete>',
    ].join('')

    await r2S3Request({
        method: 'POST',
        bucket,
        query: {delete: ''},
        headers: {
            'content-md5': md5Base64(body),
            'content-type': 'application/xml',
        },
        body,
    })
}

async function r2S3Request({method, bucket, key = '', query = {}, headers = {}, body = ''}) {
    const endpoint = r2S3Endpoint()
    const url = new URL(`${endpoint}/${encodeS3Path(bucket)}${key ? `/${encodeS3Path(key)}` : ''}`)
    for (const [name, value] of Object.entries(query)) {
        url.searchParams.set(name, value)
    }

    const signedHeaders = signR2S3Request({method, url, headers, body})
    const response = await fetch(url, {
        method,
        headers: signedHeaders,
        body: body || undefined,
    })

    if (!response.ok) {
        const responseBody = await response.text()
        throw new Error(`R2 S3 ${method} ${url.pathname}${url.search} failed: ${response.status} ${response.statusText}\n${responseBody}`)
    }

    return response
}

function signR2S3Request({method, url, headers, body}) {
    const now = new Date()
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const payloadHash = sha256Hex(body)
    const requestHeaders = new Headers(headers)
    requestHeaders.set('host', url.host)
    requestHeaders.set('x-amz-content-sha256', payloadHash)
    requestHeaders.set('x-amz-date', amzDate)

    const canonicalHeaders = [...requestHeaders.entries()]
        .map(([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, ' ')])
        .sort(([left], [right]) => left.localeCompare(right))
    const signedHeaderNames = canonicalHeaders.map(([name]) => name).join(';')
    const canonicalRequest = [
        method,
        url.pathname,
        canonicalQueryString(url.searchParams),
        canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(''),
        signedHeaderNames,
        payloadHash,
    ].join('\n')
    const scope = `${dateStamp}/${config.r2Region}/s3/aws4_request`
    const stringToSign = [
        'AWS4-HMAC-SHA256',
        amzDate,
        scope,
        sha256Hex(canonicalRequest),
    ].join('\n')
    const signingKey = awsSigningKey(config.r2SecretAccessKey, dateStamp, config.r2Region, 's3')
    const signature = hmacHex(signingKey, stringToSign)

    requestHeaders.set('authorization', [
        `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${scope}`,
        `SignedHeaders=${signedHeaderNames}`,
        `Signature=${signature}`,
    ].join(', '))

    return requestHeaders
}

function canonicalQueryString(searchParams) {
    return [...searchParams.entries()]
        .sort(([leftName, leftValue], [rightName, rightValue]) => (
            leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName)
        ))
        .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
        .join('&')
}

function awsSigningKey(secretAccessKey, dateStamp, region, service) {
    const dateKey = hmacBuffer(`AWS4${secretAccessKey}`, dateStamp)
    const dateRegionKey = hmacBuffer(dateKey, region)
    const dateRegionServiceKey = hmacBuffer(dateRegionKey, service)
    return hmacBuffer(dateRegionServiceKey, 'aws4_request')
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex')
}

function md5Base64(value) {
    return createHash('md5').update(value).digest('base64')
}

function hmacBuffer(key, value) {
    return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key, value) {
    return createHmac('sha256', key).update(value).digest('hex')
}

function encodeS3Path(value) {
    return value.split('/').map(awsEncode).join('/')
}

function awsEncode(value) {
    return encodeURIComponent(value)
        .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function s3CopySource(bucket, key) {
    return `/${encodeS3Path(bucket)}/${encodeS3Path(key)}`
}

function xmlTagValue(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`))
    return match ? unescapeXml(match[1]) : ''
}

function decodeS3XmlValue(value) {
    return decodeURIComponent(value.replaceAll('+', '%20'))
}

function stripEtagQuotes(etag) {
    return etag.replace(/^"|"$/g, '')
}

function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
}

function unescapeXml(value) {
    return value
        .replaceAll('&apos;', "'")
        .replaceAll('&quot;', '"')
        .replaceAll('&gt;', '>')
        .replaceAll('&lt;', '<')
        .replaceAll('&amp;', '&')
}

async function cloneR2WithWorker() {
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
        console.log(`R2 plan: ${summary.toCopy} copy, ${summary.toRefreshExisting} refresh existing height-chart, ${summary.skippedExisting} skip existing, ${summary.toDelete} delete, ${summary.sourceObjects} source object(s).`)
        if (!dryRun) {
            console.log(`R2 applied: ${summary.copied} copied, ${summary.deleted} deleted.`)
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
                const toCopy = sourceObjects.filter((source) => shouldCopyR2Object(source, destByKey))
                const toRefreshExisting = toCopy.filter((source) => destByKey.has(source.key))
                const skippedExisting = sourceObjects.length - toCopy.length
                const toDelete = destObjects.filter((dest) => !sourceByKey.has(dest.key))
                const summary = {
                    dryRun,
                    sourceObjects: sourceObjects.length,
                    destObjects: destObjects.length,
                    toCopy: toCopy.length,
                    toRefreshExisting: toRefreshExisting.length,
                    skippedExisting,
                    toDelete: toDelete.length,
                    copied: 0,
                    deleted: 0,
                }

                progress('[r2] Plan: ' + summary.toCopy + ' copy, ' + summary.toRefreshExisting + ' refresh existing height-chart, ' + summary.skippedExisting + ' skip existing, ' + summary.toDelete + ' delete, ' + summary.sourceObjects + ' source object(s), ' + summary.destObjects + ' destination object(s).')

                if (!dryRun) {
                    progress('[r2] Copying selected objects with concurrency ' + concurrency + '...')
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
                            progress('[r2] Copied ' + summary.copied + '/' + summary.toCopy + ' selected object(s).')
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

function shouldCopyR2Object(source, destByKey) {
    return !destByKey.has(source.key) || shouldRefreshExistingR2Key(source.key)
}

function shouldRefreshExistingR2Key(key) {
    return key.includes('/height-chart/')
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
