import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import {fileURLToPath} from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const semgrepAutoArgs = ['scan', '--config', 'auto', '.']
const semgrepTestTargets = [
    'semgrep-tests/noDeleteWithoutWhere.ts',
    'semgrep-tests/noSelectStar.ts',
    'semgrep-tests/routes/directImageResponse.ts',
    'semgrep-tests/routes/directJsonResponse.ts',
    'semgrep-tests/routes/imageBodyProxy.ts',
    'semgrep-tests/scriptJson.semgrep-test.tsx',
]
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
        // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Local developer tooling runs only fixed Semgrep and uv commands.
        spawnSync(command, args, {
            cwd: repoRoot,
            env: {...process.env, PATH: `${extraPath}${process.env.PATH ?? ''}`},
            stdio: 'inherit',
            shell: false,
        }).status ?? 1
    )
}

function runSemgrep(command, commandArgs = []) {
    const autoStatus = run(command, [...commandArgs, ...semgrepAutoArgs])
    const testStatus =
        autoStatus === 0
            ? semgrepTestTargets.reduce(
                  (status, target) => (status === 0 ? run(command, [...commandArgs, 'test', '--config', '.semgrep.yml', target]) : status),
                  0,
              )
            : autoStatus
    return testStatus === 0 ? run(command, [...commandArgs, ...semgrepCustomArgs]) : testStatus
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
    process.exit(runSemgrep('semgrep'))
}

const pythonSemgrep = getPythonUserScript('semgrep')
if (pythonSemgrep) {
    process.exit(runSemgrep(pythonSemgrep))
}

if (hasCommand('uvx')) {
    process.exit(runSemgrep('uvx', ['--from', 'semgrep', 'semgrep']))
}

if (hasCommand('uv')) {
    process.exit(runSemgrep('uv', ['tool', 'run', '--from', 'semgrep', 'semgrep']))
}

console.error(
    [
        'Semgrep and uv are not installed.',
        'Install uv, then retry `npm run semgrep`.',
        'The separate Semgrep service handles remote scans. This command is for local checks.',
    ].join('\n'),
)
process.exit(1)
