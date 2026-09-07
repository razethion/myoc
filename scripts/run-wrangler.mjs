import {spawn} from 'node:child_process'
import {rm} from 'node:fs/promises'
import {resolve} from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const wranglerBin = resolve(projectRoot, 'node_modules/wrangler/bin/wrangler.js')
const workspaceWranglerDirectories = [resolve(projectRoot, 'apps/backend/.wrangler'), resolve(projectRoot, 'apps/web/.wrangler')]

const child = spawn(process.execPath, [wranglerBin, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: {
        ...process.env,
        WRANGLER_CACHE_DIR: resolve(projectRoot, '.wrangler/cache'),
    },
    stdio: 'inherit',
})

const exitCode = await new Promise((resolveExitCode, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => resolveExitCode(code ?? 1))
})

await Promise.all(workspaceWranglerDirectories.map((directory) => rm(directory, {force: true, recursive: true})))
process.exitCode = exitCode
