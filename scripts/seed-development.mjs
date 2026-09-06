import {execFile} from 'node:child_process'
import {createHash, createHmac, randomUUID} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'
import {
    CLEAR_TABLE_ORDER,
    CLONE_TABLE_QUERIES,
    collectMediaObjectKeys,
    DEVELOPMENT_CLONE_USERNAMES,
    insertStatement,
    prepareCloneData,
} from './seed-development-helpers.mjs'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const localD1StateDir = resolve(rootDir, '.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject')
const wranglerConfigFile = resolve(rootDir, 'wrangler.jsonc')
const defaultWrangler = resolve(rootDir, 'node_modules', '.bin', 'wrangler')
const pageSize = 500

loadLocalEnv('.env')
loadLocalEnv('.dev.vars')

const remote = process.argv.includes('--remote')
const projectWranglerConfig = readProjectWranglerConfig()
const projectMediaBucket = projectWranglerConfig.r2_buckets?.find((binding) => binding.binding === 'MEDIA_BUCKET')
const config = {
    accountId: envValue('CLOUDFLARE_ACCOUNT_ID') || projectWranglerConfig.vars?.CLOUDFLARE_ACCOUNT_ID || '',
    apiToken: envValue('CLOUDFLARE_API_TOKEN'),
    sourceD1Id: envValue('PROD_D1_DATABASE_ID') || '909ada8f-fc57-47ad-83e1-18ffe863debb',
    sourceR2: envValue('PROD_R2_BUCKET') || 'myoc',
    r2AccessKeyId: envValue('R2_ACCESS_KEY_ID') || envValue('AWS_ACCESS_KEY_ID'),
    r2SecretAccessKey: envValue('R2_SECRET_ACCESS_KEY') || envValue('AWS_SECRET_ACCESS_KEY'),
    r2Endpoint: envValue('R2_ENDPOINT'),
    r2Region: envValue('R2_REGION') || 'auto',
    targetD1Id: optionValue('--target-d1-id') || envValue('TARGET_D1_DATABASE_ID'),
    targetD1Name: optionValue('--target-d1-name') || envValue('TARGET_D1_DATABASE') || 'myoc-db',
    targetR2: remote ? optionValue('--target-r2') || envValue('TARGET_R2_BUCKET') : projectMediaBucket?.preview_bucket_name || 'myoc-dev',
    approvalSeed: optionValue('--approval-seed') || envValue('DEVELOPMENT_APPROVAL_SEED') || randomUUID(),
    concurrency: normalizeInteger(optionValue('--concurrency') || envValue('SEED_R2_CONCURRENCY') || '16', 1, 16),
    wrangler: envValue('WRANGLER') || defaultWrangler,
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`Seed development from selected production accounts.

Local target (local D1 and remote myoc-dev R2):
  npm run db:prepare:local

Remote PR target:
  node scripts/seed-development.mjs --remote \\
    --target-d1-id=<uuid> --target-d1-name=myoc-pr-123 --target-r2=myoc-pr-123-media

The source account list is fixed in source code. Production D1 and R2 are read-only.
The command clears all data and objects in the selected development target.
All R2 seeds use S3 CopyObject, so media stays in Cloudflare.`)
    process.exit(0)
}

function assertSafeConfig() {
    if (!config.accountId) throw new Error('The Cloudflare account ID is not configured.')
    if (!config.apiToken) throw new Error('Cloudflare authentication is not available.')
    if (!/^[0-9a-f-]{36}$/i.test(config.sourceD1Id)) throw new Error('PROD_D1_DATABASE_ID must be a UUID.')
    if (!config.r2AccessKeyId || !config.r2SecretAccessKey) {
        throw new Error('R2 seeding requires R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY.')
    }
    if (config.targetR2 === config.sourceR2) throw new Error('Refusing to seed because the R2 target matches production.')
    if (remote) assertSafeRemoteConfig()
    else if (config.targetR2 !== 'myoc-dev') throw new Error('Local development must use the myoc-dev R2 bucket.')
}

function assertSafeRemoteConfig() {
    if (!/^[0-9a-f-]{36}$/i.test(config.targetD1Id)) throw new Error('--target-d1-id must be a UUID for a remote seed.')
    if (!/^myoc-pr-[1-9][0-9]*$/.test(config.targetD1Name)) throw new Error('The remote D1 target must use the name myoc-pr-<number>.')
    if (!/^myoc-pr-[1-9][0-9]*-media$/.test(config.targetR2))
        throw new Error('The remote R2 target must use the name myoc-pr-<number>-media.')
    if (config.targetD1Id === config.sourceD1Id) throw new Error('Refusing to seed because the D1 target matches production.')
}

async function resolveCloudflareAuth() {
    if (!existsSync(config.wrangler)) throw new Error(`Wrangler was not found at ${config.wrangler}.`)
    if (config.apiToken) return

    const credentials = await runWranglerJson(['auth', 'token', '--json'])
    if (!['api_token', 'oauth'].includes(credentials.type) || typeof credentials.token !== 'string' || !credentials.token) {
        throw new Error('Wrangler must use an API token or OAuth login. Run npx wrangler login.')
    }
    config.apiToken = credentials.token
}

function runWranglerJson(args) {
    return new Promise((resolvePromise, reject) => {
        execFile(config.wrangler, args, {cwd: rootDir, env: process.env, maxBuffer: 1024 * 1024}, (error, stdout, stderr) => {
            if (error) {
                const detail = stderr.trim().split('\n').at(-1)
                reject(new Error(`Wrangler authentication failed. Run npx wrangler login.${detail ? ` ${detail}` : ''}`))
                return
            }
            try {
                resolvePromise(JSON.parse(stdout))
            } catch {
                reject(new Error('Wrangler returned invalid authentication data.'))
            }
        })
    })
}

function readProjectWranglerConfig() {
    try {
        return JSON.parse(readFileSync(wranglerConfigFile, 'utf8'))
    } catch {
        return {}
    }
}

async function fetchCloneTables() {
    const loweredUsernames = DEVELOPMENT_CLONE_USERNAMES.map((username) => username.toLowerCase())
    const tables = {}
    for (const query of CLONE_TABLE_QUERIES) {
        tables[query.table] = await queryAllSource(query.sql, loweredUsernames)
        console.log(`Read ${tables[query.table].length} production ${query.table} row(s).`)
    }

    const found = new Set(tables.users.map((user) => String(user.username).toLowerCase()))
    const missing = loweredUsernames.filter((username) => !found.has(username))
    if (missing.length > 0 || tables.users.length !== loweredUsernames.length) {
        throw new Error(`Production account selection failed. Missing or duplicate account(s): ${missing.join(', ') || 'unknown'}.`)
    }
    return tables
}

async function queryAllSource(sql, baseParams) {
    const rows = []
    for (let offset = 0; ; offset += pageSize) {
        const page = await queryD1(config.sourceD1Id, `${sql}\nLIMIT ? OFFSET ?`, [...baseParams, pageSize, offset])
        rows.push(...page)
        if (page.length < pageSize) return rows
    }
}

async function queryD1(databaseId, sql, params = []) {
    const results = await callD1(databaseId, {sql, params})
    return results[0]?.results ?? []
}

async function batchD1(databaseId, statements) {
    for (const group of chunks(statements, 50)) await callD1(databaseId, {batch: group})
}

async function callD1(databaseId, body) {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/d1/database/${databaseId}/query`, {
        method: 'POST',
        headers: {authorization: `Bearer ${config.apiToken}`, 'content-type': 'application/json'},
        body: JSON.stringify(body),
    })
    const payload = await response.json()
    if (
        !response.ok ||
        payload.success !== true ||
        !Array.isArray(payload.result) ||
        payload.result.some((result) => result.success === false)
    ) {
        const errors = Array.isArray(payload.errors) ? payload.errors.map((error) => error.message).join('; ') : response.statusText
        throw new Error(`D1 request failed for database ${databaseId}: ${errors}`)
    }
    return payload.result
}

async function clearTargetD1() {
    console.log(`Clearing ${remote ? `remote ${config.targetD1Name}` : 'local'} D1 data.`)
    const statements = CLEAR_TABLE_ORDER.map((table) => ({sql: `DELETE FROM ${table}`}))
    if (remote) {
        await batchD1(config.targetD1Id, statements)
        return
    }
    const db = await openLocalD1()
    try {
        db.exec('BEGIN IMMEDIATE')
        for (const statement of statements) db.exec(statement.sql)
        db.exec('COMMIT')
    } catch (error) {
        rollbackTransaction(db)
        throw error
    } finally {
        db.close()
    }
}

async function writeTargetD1(tables) {
    const statements = CLONE_TABLE_QUERIES.flatMap(({table}) => tables[table].map((row) => insertStatement(table, row)))
    const seedSql = await readFile(resolve(rootDir, 'seeds', 'development.sql'), 'utf8')
    const finishStatements = [
        {sql: seedSql},
        {
            sql: `INSERT OR IGNORE INTO admin_image_review_queue (media_id, created_at, queued_at)
                  SELECT id, created_at, CURRENT_TIMESTAMP
                  FROM character_media
                  WHERE (sfw_image_key IS NOT NULL AND sfw_review_status = 'pending')
                     OR (nsfw_image_key IS NOT NULL AND nsfw_review_status = 'pending')`,
        },
        {sql: 'DELETE FROM recent_feed_dirty_hours WHERE TRUE'},
        {sql: "INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent) VALUES ('*', 1, 'development-seed', 1)"},
        {
            sql: `UPDATE recent_feed_state
                  SET requested_revision = 1, published_revision = 0, generation = NULL, root_key = NULL,
                      published_at = NULL, lease_owner = NULL, lease_expires_at = NULL, bootstrap_revision = NULL,
                      bootstrap_cursor_created_at = NULL, bootstrap_cursor_id = NULL,
                      bootstrap_variant_roots_json = NULL, bootstrap_active_key = NULL,
                      bootstrap_objects_written = 0, bootstrap_bytes_written = 0, bootstrap_started_at = NULL,
                      last_error = NULL, updated_at = CURRENT_TIMESTAMP
                  WHERE singleton = 1`,
        },
    ]

    console.log(`Writing ${statements.length} cloned D1 row(s) and the demo login.`)
    if (remote) {
        await batchD1(config.targetD1Id, [...statements, ...finishStatements])
        const foreignKeyErrors = await queryD1(config.targetD1Id, 'PRAGMA foreign_key_check')
        if (foreignKeyErrors.length > 0) throw new Error(`The development D1 seed has ${foreignKeyErrors.length} foreign key error(s).`)
        return
    }

    const db = await openLocalD1()
    let foreignKeyErrorCount = 0
    try {
        db.exec('BEGIN IMMEDIATE')
        for (const statement of statements) db.prepare(statement.sql).run(...statement.params)
        for (const statement of finishStatements) db.exec(statement.sql)
        foreignKeyErrorCount = db.prepare('PRAGMA foreign_key_check').all().length
        if (foreignKeyErrorCount === 0) db.exec('COMMIT')
        else rollbackTransaction(db)
    } catch (error) {
        rollbackTransaction(db)
        throw error
    } finally {
        db.close()
    }
    if (foreignKeyErrorCount > 0) throw new Error(`The development D1 seed has ${foreignKeyErrorCount} foreign key error(s).`)
}

function rollbackTransaction(db) {
    try {
        db.exec('ROLLBACK')
    } catch (error) {
        console.warn(`The D1 transaction rollback did not run: ${error instanceof Error ? error.message : String(error)}`)
    }
}

async function openLocalD1() {
    const entries = await readdir(localD1StateDir, {withFileTypes: true})
    const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sqlite') && entry.name !== 'metadata.sqlite')
    if (files.length !== 1) throw new Error(`Expected one local D1 database, found ${files.length}. Run migrations first.`)
    const {DatabaseSync} = await import('node:sqlite')
    return new DatabaseSync(resolve(localD1StateDir, files[0].name))
}

async function replaceTargetR2(keys) {
    console.log('Using R2 S3 CopyObject for a server-side media copy.')
    const destinationKeys = await listAllR2Keys(config.targetR2)
    console.log(`Clearing ${destinationKeys.length} development R2 object(s).`)
    for (const group of chunks(destinationKeys, 1000)) await deleteR2Objects(config.targetR2, group)

    let copied = 0
    await runPool(keys, config.concurrency, async (key) => {
        await copyR2Object(config.sourceR2, config.targetR2, key)
        copied += 1
        if (copied === 1 || copied % 100 === 0 || copied === keys.length) {
            console.log(`Copied ${copied}/${keys.length} selected R2 object(s).`)
        }
    })
    console.log(`R2 seed complete: ${destinationKeys.length} cleared and ${copied} copied.`)
}

async function listAllR2Keys(bucket) {
    const keys = []
    let continuationToken = ''
    do {
        const query = {'encoding-type': 'url', 'list-type': '2', 'max-keys': '1000'}
        if (continuationToken) query['continuation-token'] = continuationToken
        const response = await r2Request({method: 'GET', bucket, query})
        const xml = await response.text()
        for (const match of xml.matchAll(/<Contents>[\s\S]*?<Key>([\s\S]*?)<\/Key>[\s\S]*?<\/Contents>/g)) {
            keys.push(decodeURIComponent(decodeXml(match[1])))
        }
        continuationToken =
            xmlTagValue(xml, 'IsTruncated') === 'true' ? decodeURIComponent(decodeXml(xmlTagValue(xml, 'NextContinuationToken'))) : ''
    } while (continuationToken)
    return keys
}

async function copyR2Object(sourceBucket, destinationBucket, key) {
    await r2Request({
        method: 'PUT',
        bucket: destinationBucket,
        key,
        headers: {
            'x-amz-copy-source': `/${encodeR2Path(sourceBucket)}/${encodeR2Path(key)}`,
            'x-amz-metadata-directive': 'COPY',
        },
    })
}

async function deleteR2Objects(bucket, keys) {
    if (keys.length === 0) return
    const body = `<Delete><Quiet>true</Quiet>${keys.map((key) => `<Object><Key>${escapeXml(key)}</Key></Object>`).join('')}</Delete>`
    await r2Request({
        method: 'POST',
        bucket,
        query: {delete: ''},
        headers: {'content-md5': md5Base64(body), 'content-type': 'application/xml'},
        body,
    })
}

async function r2Request({method, bucket, key = '', query = {}, headers = {}, body = ''}) {
    const endpoint = (config.r2Endpoint || `https://${config.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, '')
    const url = new URL(`${endpoint}/${encodeR2Path(bucket)}${key ? `/${encodeR2Path(key)}` : ''}`)
    const queryEntries = Object.entries(query).map(([name, value]) => [name, String(value)])
    url.search = canonicalQueryString(queryEntries)
    const response = await fetch(url, {
        method,
        headers: signR2Request({method, url, queryEntries, headers, body}),
        body: body || undefined,
    })
    if (!response.ok) {
        throw new Error(`R2 S3 ${method} request failed with ${response.status}: ${await response.text()}`)
    }
    return response
}

function signR2Request({method, url, queryEntries, headers, body}) {
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
        canonicalQueryString(queryEntries),
        canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(''),
        signedHeaderNames,
        payloadHash,
    ].join('\n')
    const scope = `${dateStamp}/${config.r2Region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
    const signature = hmacHex(awsSigningKey(config.r2SecretAccessKey, dateStamp, config.r2Region), stringToSign)
    requestHeaders.set(
        'authorization',
        `AWS4-HMAC-SHA256 Credential=${config.r2AccessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    )
    return requestHeaders
}

function canonicalQueryString(entries) {
    return [...entries]
        .sort(([leftName, leftValue], [rightName, rightValue]) =>
            leftName === rightName ? leftValue.localeCompare(rightValue) : leftName.localeCompare(rightName),
        )
        .map(([name, value]) => `${awsEncode(name)}=${awsEncode(value)}`)
        .join('&')
}

function awsSigningKey(secret, dateStamp, region) {
    const dateKey = hmacBuffer(`AWS4${secret}`, dateStamp)
    const regionKey = hmacBuffer(dateKey, region)
    const serviceKey = hmacBuffer(regionKey, 's3')
    return hmacBuffer(serviceKey, 'aws4_request')
}

function encodeR2Path(value) {
    return value.split('/').map(awsEncode).join('/')
}

function awsEncode(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex')
}

function md5Base64(value) {
    // nosemgrep: javascript.node-stdlib.cryptography.crypto-weak-algorithm.crypto-weak-algorithm -- S3 requires Content-MD5 for DeleteObjects body integrity.
    return createHash('md5').update(value).digest('base64')
}

function hmacBuffer(key, value) {
    return createHmac('sha256', key).update(value).digest()
}

function hmacHex(key, value) {
    return createHmac('sha256', key).update(value).digest('hex')
}

function xmlTagValue(xml, tagName) {
    return xml.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`))?.[1] ?? ''
}

function decodeXml(value) {
    return value
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
}

function escapeXml(value) {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
}

async function runPool(items, concurrency, work) {
    let nextIndex = 0
    async function worker() {
        for (;;) {
            const index = nextIndex
            nextIndex += 1
            if (index >= items.length) return
            await work(items[index])
        }
    }
    await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, () => worker()))
}

function optionValue(name) {
    const prefix = `${name}=`
    return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? ''
}

function envValue(name) {
    return process.env[name] ?? ''
}

function normalizeInteger(value, minimum, maximum) {
    const number = Number(value)
    if (!Number.isInteger(number) || number < minimum || number > maximum)
        throw new Error(`Expected an integer from ${minimum} through ${maximum}.`)
    return number
}

function loadLocalEnv(filename) {
    const path = resolve(rootDir, filename)
    if (!existsSync(path)) return
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
        if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue
        const value = match[2]
        process.env[match[1]] = value.length >= 2 && value[0] === value.at(-1) && ['"', "'"].includes(value[0]) ? value.slice(1, -1) : value
    }
}

function chunks(items, size) {
    const result = []
    for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size))
    return result
}

async function main() {
    await resolveCloudflareAuth()
    assertSafeConfig()
    console.log(`Development approval seed: ${config.approvalSeed}`)
    console.log(`Selected production accounts: ${DEVELOPMENT_CLONE_USERNAMES.join(', ')}`)
    const sourceTables = await fetchCloneTables()
    const tables = prepareCloneData(sourceTables, config.approvalSeed)
    const objectKeys = collectMediaObjectKeys(tables)
    console.log(`Selected ${objectKeys.length} production R2 object(s).`)

    await clearTargetD1()
    await replaceTargetR2(objectKeys)
    await writeTargetD1(tables)
    console.log('Development seed complete.')
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
