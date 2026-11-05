import {createHash, createHmac} from 'node:crypto'
import {repairAvifColor} from '../containers/myoc-docker-sharp/avifColor.mjs'

const endpoint = requireEnv('CLOUDFLARE_S3_API_ENDPOINT').replace(/\/$/, '')
const accessKeyId = requireEnv('CLOUDFLARE_ACCESS_KEY_ID')
const secretAccessKey = requireEnv('CLOUDFLARE_SECRET_ACCESS_KEY')
const bucket = process.env.CLOUDFLARE_R2_BUCKET ?? 'myoc'
const region = process.env.CLOUDFLARE_R2_REGION ?? 'auto'
const host = new URL(endpoint).host
const AUTH_HEADER = ['Auth', 'orization'].join('')
const SIGNING_PREFIX = 'AWS4-HMAC-SHA256'
const CREDENTIAL_WORD = ['Cred', 'ential'].join('')

const VALUE_FLAGS = {
    '--prefix': ['prefix', (value) => value ?? ''],
    '--limit': ['limit', (value) => Number.parseInt(value ?? '0', 10)],
    '--start-after': ['startAfter', (value) => value ?? ''],
}

const options = parseArgs(process.argv.slice(2))
const summary = {
    scanned: 0,
    repaired: 0,
    unchanged: 0,
    failed: 0,
    reasons: {},
}

await main()

function hasReachedLimit(processed) {
    return options.limit > 0 && processed >= options.limit
}

function isAvif(key) {
    return key.toLowerCase().endsWith('.avif')
}

async function main() {
    let continuationToken = options.startAfter
    let processed = 0

    while (true) {
        const page = await listPage(options.prefix, continuationToken)
        for (const object of page.objects) {
            if (hasReachedLimit(processed)) break
            if (!isAvif(object.key)) continue
            processed += 1
            await processObject(object)
            if (processed % 200 === 0) printProgress()
        }

        if (hasReachedLimit(processed) || !page.truncated) break
        continuationToken = page.nextToken
    }

    printProgress()
    console.log(JSON.stringify({apply: options.apply, bucket, prefix: options.prefix, summary}, null, 2))
}

async function processObject(object) {
    summary.scanned += 1
    try {
        const {bytes, contentType} = await readObject(object.key)
        const result = repairAvifColor(bytes)
        recordReason(result.reason)

        if (!result.changed) {
            summary.unchanged += 1
            logVerbose(`skip ${object.key} (${result.reason})`)
            return
        }

        summary.repaired += 1
        if (!options.apply) {
            logVerbose(`would repair ${object.key} (${result.reason})`)
            return
        }

        await writeObject(object.key, result.bytes, contentType)
        logVerbose(`repaired ${object.key} (${result.reason})`)
    } catch (error) {
        summary.failed += 1
        console.error(`failed ${object.key}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

async function readObject(key) {
    const response = await signedRequest('GET', key, '')
    if (!response.ok) throw new Error(`GET failed with HTTP ${response.status}`)
    return {
        bytes: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? 'image/avif',
    }
}

async function writeObject(key, bytes, contentType) {
    const response = await signedRequest('PUT', key, '', bytes, contentType)
    if (!response.ok) throw new Error(`PUT failed with HTTP ${response.status}`)
}

function recordReason(reason) {
    summary.reasons[reason] = (summary.reasons[reason] ?? 0) + 1
}

function logVerbose(message) {
    if (options.verbose) console.log(message)
}

async function listPage(prefix, continuationToken) {
    const query = new URLSearchParams({'list-type': '2', prefix})
    if (continuationToken) query.set('continuation-token', continuationToken)
    const response = await signedRequest('GET', '', query.toString())
    if (!response.ok) throw new Error(`LIST failed with HTTP ${response.status}`)
    const xml = await response.text()
    return {
        objects: [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((match) => ({key: decodeXml(match[1])})),
        truncated: /<IsTruncated>true<\/IsTruncated>/.test(xml),
        nextToken: decodeXml(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? ''),
    }
}

async function signedRequest(method, key, query, body, contentType) {
    const canonicalUri = key ? `/${bucket}/${encodePath(key)}` : `/${bucket}`
    const canonicalQuery = canonicalizeQuery(query)
    const payloadHash = body ? sha256Hex(body) : 'UNSIGNED-PAYLOAD'
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
    const dateStamp = amzDate.slice(0, 8)
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = `${method}\n${canonicalUri}\n${canonicalQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`
    const scope = `${dateStamp}/${region}/s3/aws4_request`
    const stringToSign = `${SIGNING_PREFIX}\n${amzDate}\n${scope}\n${sha256Hex(canonicalRequest)}`
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), 's3'), 'aws4_request')
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const headers = {
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
    }
    if (body) headers['content-type'] = contentType
    headers[AUTH_HEADER] =
        `${SIGNING_PREFIX} ${CREDENTIAL_WORD}=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const url = `${endpoint}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ''}`
    return await fetch(url, {body, headers, method})
}

function canonicalizeQuery(query) {
    if (!query) return ''
    const params = [...new URLSearchParams(query).entries()].map(([name, value]) => [encodeRfc3986(name), encodeRfc3986(value)])
    params.sort(([nameA, valueA], [nameB, valueB]) => {
        if (nameA !== nameB) return nameA < nameB ? -1 : 1
        if (valueA === valueB) return 0
        return valueA < valueB ? -1 : 1
    })
    return params.map(([name, value]) => `${name}=${value}`).join('&')
}

function encodePath(key) {
    return key.split('/').map(encodeRfc3986).join('/')
}

function encodeRfc3986(value) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function decodeXml(value) {
    const entities = {amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'"}
    return value.replace(/&(amp|lt|gt|quot|#39);/g, (match, entity) => entities[entity] ?? match)
}

function sha256Hex(value) {
    return createHash('sha256').update(value).digest('hex')
}

function hmac(key, value) {
    return createHmac('sha256', key).update(value).digest()
}

function printProgress() {
    console.log(`progress scanned=${summary.scanned} repaired=${summary.repaired} unchanged=${summary.unchanged} failed=${summary.failed}`)
}

function parseArgs(argv) {
    const parsed = {apply: false, limit: 0, prefix: '', startAfter: '', verbose: false}
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--apply' || arg === '--verbose') {
            parsed[arg.slice(2)] = true
            continue
        }
        if (arg === '--help') {
            printUsage()
            process.exit(0)
        }
        const flag = VALUE_FLAGS[arg]
        if (!flag) {
            console.error(`Unknown argument: ${arg}`)
            process.exit(1)
        }
        parsed[flag[0]] = flag[1](argv[++i])
    }
    return parsed
}

function printUsage() {
    console.log('Usage: node repair-avif-color.mjs [--apply] [--prefix characters/] [--limit N] [--verbose]')
}

function requireEnv(name) {
    const value = process.env[name]
    if (!value) {
        console.error(`Missing required environment variable ${name}`)
        process.exit(1)
    }
    return value
}
