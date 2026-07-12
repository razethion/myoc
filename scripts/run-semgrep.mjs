import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semgrepAutoArgs = ['scan', '--config', 'auto', '.']
const semgrepCustomArgs = ['scan', '--config', '.semgrep.yml', '--error', '.']

function hasCommand(command) {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which'
    const args = [command]
    const result = spawnSync(probe, args, {stdio: 'ignore', shell: false})
    return result.status === 0
}

function run(command, args) {
    const extraPath = path.dirname(command) !== '.' ? `${path.dirname(command)}${path.delimiter}` : ''
    return (
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Local developer tooling wrapper runs only fixed Semgrep/Docker commands.
        spawnSync(command, args, {
            cwd: repoRoot,
            env: {...process.env, PATH: `${extraPath}${process.env.PATH ?? ''}`},
            stdio: 'inherit',
            shell: false,
        }).status ?? 1
    )
}

function getPythonUserScript(command) {
    if (process.platform !== 'win32' || !hasCommand('py')) {
        return null
    }

    const result = spawnSync(
        'py',
        ['-c', `import os, sysconfig; print(os.path.join(sysconfig.get_path('scripts', scheme='nt_user'), '${command}.exe'))`],
        {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: false,
        },
    )
    const scriptPath = result.stdout.trim()
    return result.status === 0 && fs.existsSync(scriptPath) ? scriptPath : null
}

if (hasCommand('semgrep')) {
    const autoStatus = run('semgrep', semgrepAutoArgs)
    process.exit(autoStatus === 0 ? run('semgrep', semgrepCustomArgs) : autoStatus)
}

const pythonSemgrep = getPythonUserScript('semgrep')
if (pythonSemgrep) {
    const autoStatus = run(pythonSemgrep, semgrepAutoArgs)
    process.exit(autoStatus === 0 ? run(pythonSemgrep, semgrepCustomArgs) : autoStatus)
}

if (hasCommand('docker')) {
    const dockerArgs = ['run', '--rm', '-v', `${repoRoot}:/src`, '-w', '/src', 'semgrep/semgrep', 'semgrep']
    const autoStatus = run('docker', [...dockerArgs, ...semgrepAutoArgs])
    process.exit(autoStatus === 0 ? run('docker', [...dockerArgs, ...semgrepCustomArgs]) : autoStatus)
}

console.error(
    [
        'Semgrep is not installed and Docker is not available.',
        'Install Semgrep with pipx or run this project inside an environment with Docker/WSL, then retry `npm run security`.',
        'CI uses the official semgrep/semgrep container and does not require a local install.',
    ].join('\n'),
)
process.exit(1)
