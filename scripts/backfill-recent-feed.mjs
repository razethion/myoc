import {execFile, spawn} from 'node:child_process'
import {existsSync} from 'node:fs'
import {mkdtemp, readFile, rmdir, unlink, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wranglerBin = resolve(rootDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const sourceConfigPath = resolve(rootDir, 'wrangler.jsonc')
const devVarsPath = resolve(rootDir, '.dev.vars')
const persistDir = resolve(rootDir, '.wrangler', 'state')
const recoveryCron = '* * * * *'
const scheduledEndpoint = '/cdn-cgi/handler/scheduled'
const stateSql = `SELECT requested_revision AS requestedRevision,
                         published_revision AS publishedRevision,
                         generation,
                         root_key AS rootKey,
                         bootstrap_revision AS bootstrapRevision,
                         bootstrap_cursor_created_at AS bootstrapCursorCreatedAt,
                         bootstrap_cursor_id AS bootstrapCursorId,
                         last_error AS lastError
                  FROM recent_feed_state
                  WHERE singleton = 1;`
const resetStateSql = `DELETE FROM recent_feed_dirty_hours
                       WHERE rowid IN (SELECT rowid FROM recent_feed_dirty_hours);
                       DELETE FROM recent_feed_generations
                       WHERE rowid IN (SELECT rowid FROM recent_feed_generations);
                       DELETE FROM recent_feed_revocations
                       WHERE rowid IN (SELECT rowid FROM recent_feed_revocations);
                       UPDATE recent_feed_state
                       SET requested_revision = 1,
                           published_revision = 0,
                           generation = NULL,
                           root_key = NULL,
                           published_at = NULL,
                           lease_owner = NULL,
                           lease_expires_at = NULL,
                           bootstrap_revision = NULL,
                           bootstrap_cursor_created_at = NULL,
                           bootstrap_cursor_id = NULL,
                           bootstrap_variant_roots_json = NULL,
                           bootstrap_active_key = NULL,
                           bootstrap_objects_written = 0,
                           bootstrap_bytes_written = 0,
                           bootstrap_started_at = NULL,
                           last_error = NULL,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE singleton = 1;
                       INSERT INTO recent_feed_dirty_hours (dirty_hour, revision, reason, urgent)
                       VALUES ('*', 1, 'initial-build', 1);`

const options = parseOptions(process.argv.slice(2))

if (options.help) {
    printHelp()
    process.exit(0)
}

if (!existsSync(wranglerBin)) {
    throw new Error('Wrangler is not installed. Run npm install first.')
}

let worker = null
let temporaryConfigDir = null
let temporaryConfigPath = null
let expectedMediaOrigin = null
let selectedBucketName = null

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        worker?.child.kill()
        process.exit(signal === 'SIGINT' ? 130 : 143)
    })
}

function parseOptions(args) {
    const flags = new Set(args)
    const valueOptions = ['--confirm-production=', '--database=', '--delay-ms=', '--max-runs=', '--port=']
    const unknown = args.find(
        (argument) =>
            !['--help', '-h', '--local', '--production'].includes(argument) && !valueOptions.some((prefix) => argument.startsWith(prefix)),
    )

    if (unknown) {
        throw new Error(`Unknown option: ${unknown}`)
    }

    const parsed = {
        confirmProduction: optionValue(args, '--confirm-production'),
        database: optionValue(args, '--database') || process.env.RECENT_FEED_DATABASE || 'myoc-db',
        delayMs: positiveInteger(optionValue(args, '--delay-ms') || process.env.RECENT_FEED_BACKFILL_DELAY_MS || '1000', '--delay-ms'),
        help: flags.has('--help') || flags.has('-h'),
        local: flags.has('--local'),
        maxRuns: positiveInteger(optionValue(args, '--max-runs') || process.env.RECENT_FEED_BACKFILL_MAX_RUNS || '10000', '--max-runs'),
        port: positiveInteger(optionValue(args, '--port') || process.env.RECENT_FEED_BACKFILL_PORT || '8798', '--port'),
        production: flags.has('--production'),
    }

    if (parsed.local && parsed.production) {
        throw new Error('--local and --production cannot be used together.')
    }

    return parsed
}

function optionValue(args, name) {
    const prefix = `${name}=`
    const value = args.find((argument) => argument.startsWith(prefix))
    return value ? value.slice(prefix.length) : ''
}

function positiveInteger(value, name) {
    const number = Number(value)

    if (!Number.isSafeInteger(number) || number < 1) {
        throw new Error(`${name} must be a positive integer.`)
    }

    return number
}

function printHelp() {
    console.log(`Backfill the generated recent-media feed by running its recovery cron in sequence.

Usage:
  npm run recent-feed:backfill
  npm run recent-feed:backfill -- --local
  npm run recent-feed:backfill -- --production --confirm-production=DATABASE:BUCKET

The default mode reads local D1 and uses the development bindings in wrangler.jsonc. In the
current config, this writes generated objects to the preview recent-feed R2 bucket. The script
creates a restricted temporary config and cannot use the production D1 database or production
recent-feed bucket.

Production mode uses the production D1 database and recent-feed bucket. It never resets feed
state. It requires an exact --confirm-production value based on the configured database and
bucket names.

Options:
  --local               Disable remote bindings and use local D1 and R2 data.
  --production          Use remote production D1 and R2 bindings. Never reset production state.
  --confirm-production=DATABASE:BUCKET
                        Confirm the exact production resources used by --production.
  --database=NAME       D1 database name. Default: myoc-db.
  --port=NUMBER         Local Wrangler port. Default: 8798.
  --max-runs=NUMBER     Stop after this many cron runs. Default: 10000.
  --delay-ms=NUMBER     Delay between incomplete cron runs. Default: 1000.
  --help, -h            Show this help.
`)
}

function wranglerArgs(args) {
    if (!temporaryConfigPath) throw new Error('The restricted Wrangler config is not ready.')
    return [wranglerBin, ...args, '--config', temporaryConfigPath]
}

function wranglerEnvironment() {
    const environment = {...process.env}
    delete environment.CLOUDFLARE_ENV
    return environment
}

function readDevVar(contents, name) {
    const prefix = `${name}=`
    const line = contents
        .split(/\r?\n/)
        .map((value) => value.trim())
        .find((value) => value.startsWith(prefix))

    if (!line) return ''
    const value = line.slice(prefix.length).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1)
    }
    return value
}

function httpsOrigin(value, name) {
    let url
    try {
        url = new URL(value)
    } catch (error) {
        throw new Error(`${name} must be a valid URL.`, {cause: error})
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
        throw new Error(`${name} must be an HTTPS URL without credentials.`)
    }
    return url.origin
}

function productionBackfillTarget(config, database, recentFeedBucket) {
    const confirmation = `${database.database_name}:${recentFeedBucket.bucket_name}`
    if (options.confirmProduction !== confirmation) {
        throw new Error(`Production backfill requires --confirm-production=${confirmation}.`)
    }
    if (options.database !== database.database_name) {
        throw new Error(`Production backfill must use the configured database ${database.database_name}.`)
    }
    if (!config.vars?.MEDIA_PUBLIC_BASE_URL) {
        throw new Error('wrangler.jsonc must define MEDIA_PUBLIC_BASE_URL for the production backfill.')
    }

    return {
        bucketName: recentFeedBucket.bucket_name,
        mediaBaseUrl: config.vars.MEDIA_PUBLIC_BASE_URL,
        mediaBaseUrlName: 'wrangler.jsonc MEDIA_PUBLIC_BASE_URL',
    }
}

function developmentBackfillTarget(developmentMediaBaseUrl, recentFeedBucket) {
    if (!recentFeedBucket.preview_bucket_name) {
        throw new Error('wrangler.jsonc must define RECENT_FEED_BUCKET.preview_bucket_name for the dev backfill.')
    }
    if (recentFeedBucket.preview_bucket_name === recentFeedBucket.bucket_name) {
        throw new Error('The recent-feed preview and production R2 bucket names must be different.')
    }
    if (!developmentMediaBaseUrl) {
        throw new Error('.dev.vars must define MEDIA_PUBLIC_BASE_URL for the dev backfill.')
    }

    return {
        bucketName: recentFeedBucket.preview_bucket_name,
        mediaBaseUrl: developmentMediaBaseUrl,
        mediaBaseUrlName: '.dev.vars MEDIA_PUBLIC_BASE_URL',
    }
}

async function createRestrictedConfig() {
    let config
    try {
        config = JSON.parse(await readFile(sourceConfigPath, 'utf8'))
    } catch (error) {
        throw new Error(`Could not read ${sourceConfigPath} as JSON.`, {cause: error})
    }

    const database = config.d1_databases?.find((binding) => binding.binding === 'DB')
    const recentFeedBucket = config.r2_buckets?.find((binding) => binding.binding === 'RECENT_FEED_BUCKET')
    const devVars = existsSync(devVarsPath) ? await readFile(devVarsPath, 'utf8') : ''
    const developmentMediaBaseUrl = readDevVar(devVars, 'MEDIA_PUBLIC_BASE_URL')

    if (!database) throw new Error('wrangler.jsonc does not define the D1 binding.')
    if (!recentFeedBucket?.bucket_name) throw new Error('wrangler.jsonc does not define the production recent-feed bucket.')

    const target = options.production
        ? productionBackfillTarget(config, database, recentFeedBucket)
        : developmentBackfillTarget(developmentMediaBaseUrl, recentFeedBucket)
    expectedMediaOrigin = httpsOrigin(target.mediaBaseUrl, target.mediaBaseUrlName)
    selectedBucketName = target.bucketName

    temporaryConfigDir = await mkdtemp(join(tmpdir(), 'myoc-recent-feed-backfill-'))
    temporaryConfigPath = join(temporaryConfigDir, 'wrangler.json')
    const restrictedConfig = {
        account_id: config.vars?.CLOUDFLARE_ACCOUNT_ID,
        name: `${config.name}-recent-feed-backfill`,
        main: resolve(rootDir, config.main),
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        dev: {enable_containers: false},
        vars: {...config.vars, MEDIA_PUBLIC_BASE_URL: target.mediaBaseUrl},
        d1_databases: [{...database, remote: options.production}],
        r2_buckets: [
            {
                binding: 'RECENT_FEED_BUCKET',
                bucket_name: selectedBucketName,
                remote: options.production || !options.local,
            },
        ],
    }
    await writeFile(temporaryConfigPath, JSON.stringify(restrictedConfig, null, 2))
}

async function removeRestrictedConfig() {
    if (temporaryConfigPath) await unlink(temporaryConfigPath).catch(() => undefined)
    if (temporaryConfigDir) await rmdir(temporaryConfigDir).catch(() => undefined)
    temporaryConfigPath = null
    temporaryConfigDir = null
    expectedMediaOrigin = null
    selectedBucketName = null
}

function runWrangler(args) {
    return new Promise((resolvePromise, reject) => {
        execFile(
            process.execPath,
            wranglerArgs(args),
            {cwd: rootDir, env: wranglerEnvironment(), maxBuffer: 10 * 1024 * 1024},
            (error, stdout, stderr) => {
                if (error) {
                    error.stdout = stdout
                    error.stderr = stderr
                    const details = stderr.trim() || stdout.trim()
                    if (details) error.message = `${error.message}\n${details}`
                    reject(error)
                    return
                }
                resolvePromise({stdout, stderr})
            },
        )
    })
}

function startWorker() {
    const args = [
        'dev',
        '--test-scheduled',
        '--port',
        String(options.port),
        '--persist-to',
        persistDir,
        '--log-level',
        'info',
        '--show-interactive-dev-session=false',
    ]
    if (!options.production && existsSync(devVarsPath)) args.push('--env-file', devVarsPath)
    if (options.local) args.push('--local')
    const state = {
        child: spawn(process.execPath, wranglerArgs(args), {
            cwd: rootDir,
            env: wranglerEnvironment(),
            stdio: ['ignore', 'pipe', 'pipe'],
        }),
        exited: false,
        logs: '',
    }

    const recordOutput = (chunk, destination) => {
        const text = chunk.toString()
        state.logs = `${state.logs}${text}`.slice(-100_000)
        destination.write(text)
    }
    state.child.stdout.on('data', (chunk) => recordOutput(chunk, process.stdout))
    state.child.stderr.on('data', (chunk) => recordOutput(chunk, process.stderr))
    state.child.on('exit', () => {
        state.exited = true
    })

    return state
}

async function waitForWorker(state) {
    const stateUrl = `http://127.0.0.1:${options.port}/api/recent-media/state`

    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (state.exited) {
            throw new Error(`Wrangler exited before it was ready.\n${state.logs}`)
        }

        try {
            await fetch(stateUrl, {signal: AbortSignal.timeout(1000)})
            return
        } catch {
            await delay(500)
        }
    }

    throw new Error(`Timed out while waiting for Wrangler.\n${state.logs}`)
}

async function triggerRecoveryCron() {
    const url = new URL(scheduledEndpoint, `http://127.0.0.1:${options.port}`)
    url.searchParams.set('cron', recoveryCron)
    url.searchParams.set('format', 'json')
    const response = await fetch(url, {signal: AbortSignal.timeout(20 * 60 * 1000)})
    const body = await response.text()

    if (!response.ok) {
        throw new Error(`Recent-feed cron failed: ${response.status} ${response.statusText}\n${body}`)
    }

    let result
    try {
        result = JSON.parse(body)
    } catch {
        if (body.trim() === 'Ran scheduled event') return
        throw new Error(`Recent-feed cron returned an unexpected response.\n${body}`)
    }

    if (result.outcome !== 'ok') {
        throw new Error(`Recent-feed cron returned outcome ${JSON.stringify(result.outcome)}.`)
    }
}

async function readState() {
    const {stdout} = await runWrangler([
        'd1',
        'execute',
        options.database,
        ...(options.production ? ['--remote'] : ['--local', '--persist-to', persistDir]),
        '--json',
        '--command',
        stateSql,
    ])
    let results

    try {
        results = JSON.parse(stdout)
    } catch {
        throw new Error(`Wrangler returned invalid D1 JSON.\n${stdout}`)
    }

    const row = results?.[0]?.results?.[0]
    if (!row) {
        throw new Error('The recent_feed_state row is missing. Apply the recent-feed migrations first.')
    }

    return row
}

async function currentFeedIsAvailable(state) {
    if (options.production) {
        return await productionRootIsAvailable(state)
    }

    const url = new URL('/api/recent-media', `http://127.0.0.1:${options.port}`)
    url.searchParams.set('limit', '1')
    url.searchParams.set('nsfw', 'false')
    url.searchParams.set('unapproved', 'false')
    const response = await fetch(url, {signal: AbortSignal.timeout(30_000)})
    if (!response.ok || !expectedMediaOrigin) return false

    let page
    try {
        page = await response.json()
    } catch {
        return false
    }

    return (
        Array.isArray(page?.items) &&
        page.items.every(
            (item) =>
                mediaUrlHasExpectedOrigin(item?.previewSrc) &&
                mediaUrlHasExpectedOrigin(item?.originalSrc) &&
                mediaUrlHasExpectedOrigin(item?.character?.avatarUrl) &&
                (item?.user?.avatarUrl === null || mediaUrlHasExpectedOrigin(item?.user?.avatarUrl)),
        )
    )
}

async function productionRootIsAvailable(state) {
    if (!selectedBucketName || typeof state.rootKey !== 'string' || state.rootKey.length === 0) return false

    let stdout
    try {
        const result = await runWrangler(['r2', 'object', 'get', `${selectedBucketName}/${state.rootKey}`, '--remote', '--pipe'])
        stdout = result.stdout
    } catch {
        return false
    }

    let root
    try {
        root = JSON.parse(stdout)
    } catch {
        return false
    }

    return (
        root?.schemaVersion === 1 &&
        root?.generation === state.generation &&
        Number(root?.throughRevision) === Number(state.publishedRevision) &&
        root?.variants !== null &&
        typeof root?.variants === 'object' &&
        root?.initialItems !== null &&
        typeof root?.initialItems === 'object'
    )
}

function mediaUrlHasExpectedOrigin(value) {
    if (typeof value !== 'string' || !expectedMediaOrigin) return false
    try {
        return new URL(value).origin === expectedMediaOrigin
    } catch {
        return false
    }
}

async function resetLocalFeedState() {
    if (options.production) throw new Error('Production feed state cannot be reset by the backfill runner.')
    await runWrangler(['d1', 'execute', options.database, '--local', '--persist-to', persistDir, '--command', resetStateSql])
}

function isComplete(state) {
    return (
        state.bootstrapRevision === null &&
        typeof state.rootKey === 'string' &&
        state.rootKey.length > 0 &&
        Number(state.publishedRevision) >= Number(state.requestedRevision)
    )
}

function describeState(state) {
    const progress = `${state.publishedRevision}/${state.requestedRevision}`
    if (state.bootstrapRevision !== null) {
        const cursor =
            state.bootstrapCursorCreatedAt && state.bootstrapCursorId
                ? `${state.bootstrapCursorCreatedAt} ${state.bootstrapCursorId}`
                : 'starting'
        return `revision ${progress}; bootstrap ${state.bootstrapRevision}; cursor ${cursor}`
    }
    return `revision ${progress}; generation ${state.generation || 'not published'}`
}

async function stopWorker(state) {
    if (!state || state.exited) return

    state.child.kill()
    await Promise.race([new Promise((resolvePromise) => state.child.once('exit', resolvePromise)), delay(5000)])
}

function delay(milliseconds) {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function existingFeedIsReady() {
    const initialState = await readState()
    if (!isComplete(initialState)) return false
    if (await currentFeedIsAvailable(initialState)) {
        console.log('Recent-feed backfill is already complete.')
        return true
    }

    if (options.production) {
        throw new Error('Production feed state is complete, but its R2 root is unavailable or invalid. Refusing to reset it.')
    }

    console.log('The current generation is unavailable or incompatible with the development config. Rebuilding it.')
    await resetLocalFeedState()
    return false
}

async function runBackfillLoop() {
    for (let run = 1; run <= options.maxRuns; run += 1) {
        console.log(`[${run}/${options.maxRuns}] Running recent-feed recovery cron...`)
        await triggerRecoveryCron()
        const state = await readState()
        console.log(`[${run}/${options.maxRuns}] ${describeState(state)}`)

        if (state.lastError) {
            throw new Error(`Recent-feed publication failed: ${state.lastError}`)
        }

        if (isComplete(state)) {
            if (!(await currentFeedIsAvailable(state))) {
                throw new Error('Recent-feed state completed, but its R2 root is unavailable or invalid.')
            }
            console.log(`Recent-feed backfill complete after ${run} cron run${run === 1 ? '' : 's'}.`)
            return
        }

        await delay(options.delayMs)
    }

    throw new Error(`Recent-feed backfill did not complete after ${options.maxRuns} cron runs.`)
}

async function main() {
    try {
        console.log(`Recent-feed backfill runner using ${scheduledEndpoint}.`)
        await createRestrictedConfig()
        const target = options.production ? 'production D1 and production R2' : options.local ? 'all-local' : 'local D1 and dev R2'
        console.log(`Starting ${target} recent-feed backfill.`)
        worker = startWorker()
        await waitForWorker(worker)
        if (!(await existingFeedIsReady())) await runBackfillLoop()
    } finally {
        await stopWorker(worker)
        worker = null
        await removeRestrictedConfig()
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    if (error?.stderr) console.error(error.stderr)
    process.exitCode = 1
})
