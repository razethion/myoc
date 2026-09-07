import {rm} from 'node:fs/promises'
import {resolve} from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const generatedDirectories = [
    resolve(projectRoot, 'apps/backend/.wrangler'),
    resolve(projectRoot, 'apps/web/.wrangler'),
    resolve(projectRoot, 'apps/web/node_modules'),
]

await Promise.all(generatedDirectories.map((directory) => rm(directory, {force: true, recursive: true})))
