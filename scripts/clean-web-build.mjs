import {rm} from 'node:fs/promises'
import {resolve, sep} from 'node:path'

const buildRoot = resolve(import.meta.dirname, '../apps/web/.svelte-kit')

for (const name of ['output', 'cloudflare', 'cloudflare-tmp']) {
    const target = resolve(buildRoot, name)

    if (!target.startsWith(`${buildRoot}${sep}`)) {
        throw new Error(`Refusing to remove a path outside ${buildRoot}`)
    }

    await rm(target, {force: true, recursive: true})
}
