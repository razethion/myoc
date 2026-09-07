import {cp, mkdir, rm} from 'node:fs/promises'
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
