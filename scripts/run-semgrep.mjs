import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semgrepArgs = ['scan', '--config', 'auto', '.']

function hasCommand(command) {
    const probe = process.platform === 'win32' ? 'where.exe' : 'which'
    const args = [command]
    const result = spawnSync(probe, args, {stdio: 'ignore', shell: false})
    return result.status === 0
}

function run(command, args) {
    const extraPath = path.dirname(command) !== '.' ? `${path.dirname(command)}${path.delimiter}` : ''
    return (
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
    process.exit(run('semgrep', semgrepArgs))
}

const pythonSemgrep = getPythonUserScript('semgrep')
if (pythonSemgrep) {
    process.exit(run(pythonSemgrep, semgrepArgs))
}

if (hasCommand('docker')) {
    process.exit(run('docker', ['run', '--rm', '-v', `${repoRoot}:/src`, '-w', '/src', 'semgrep/semgrep', 'semgrep', ...semgrepArgs]))
}

console.error(
    [
        'Semgrep is not installed and Docker is not available.',
        'Install Semgrep with pipx or run this project inside an environment with Docker/WSL, then retry `npm run security`.',
        'CI uses the official semgrep/semgrep container and does not require a local install.',
    ].join('\n'),
)
process.exit(1)
