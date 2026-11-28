import {copyFile, cp, mkdir, rm} from 'node:fs/promises'
import {basename, resolve} from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const sourceDirectory = resolve(projectRoot, 'apps', 'backend', 'public')
const targetDirectory = resolve(projectRoot, 'apps', 'web', 'static')

await rm(targetDirectory, {force: true, recursive: true})
await mkdir(targetDirectory, {recursive: true})
await cp(sourceDirectory, targetDirectory, {
    recursive: true,
    filter: (source) => {
        const name = basename(source)
        return name !== '_headers' && name !== 'build'
    },
})

// The backend public directory owns the asset response headers. adapter-cloudflare rejects
// _headers inside the static directory and only reads it from the project root, so copy the
// file there; the adapter merges it with its own rules into the deployment output.
await copyFile(resolve(sourceDirectory, '_headers'), resolve(projectRoot, 'apps', 'web', '_headers'))
