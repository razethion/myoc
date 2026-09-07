import {spawn} from 'node:child_process'
import {readFile, rm, writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const backendConfigPath = resolve(projectRoot, 'apps/backend/wrangler.jsonc')
const backendDevConfigPath = resolve(projectRoot, 'apps/backend/wrangler.hono-dev.jsonc')
const legacyTypesPath = resolve(projectRoot, 'worker-configuration.d.ts')
const wranglerRunnerPath = resolve(projectRoot, 'scripts/run-wrangler.mjs')
const npmCliPath = process.env.npm_execpath

if (!npmCliPath) {
    throw new Error('Run this script through npm.')
}

const run = (command, args) =>
    new Promise((resolveExitCode, reject) => {
        const child = spawn(command, args, {
            cwd: projectRoot,
            stdio: 'inherit',
        })

        child.once('error', reject)
        child.once('exit', (code) => resolveExitCode(code ?? 1))
    })

const buildExitCode = await run(process.execPath, [npmCliPath, 'run', 'build'])

if (buildExitCode !== 0) {
    process.exitCode = buildExitCode
} else {
    await rm(legacyTypesPath, {force: true})

    const backendConfig = JSON.parse(await readFile(backendConfigPath, 'utf8'))
    delete backendConfig.containers
    await writeFile(backendDevConfigPath, `${JSON.stringify(backendConfig, null, 2)}\n`)

    try {
        process.exitCode = await run(process.execPath, [
            wranglerRunnerPath,
            'dev',
            '--config',
            'apps/web/wrangler.jsonc',
            '--config',
            'apps/backend/wrangler.hono-dev.jsonc',
            '--port',
            '5173',
            '--persist-to',
            '.wrangler/state',
            '--env-file',
            '.dev.vars',
            ...process.argv.slice(2),
        ])
    } finally {
        await rm(backendDevConfigPath, {force: true})
    }
}
