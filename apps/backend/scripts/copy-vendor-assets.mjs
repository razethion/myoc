import {copyFile, cp, mkdir, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join, resolve} from 'node:path'

const backendRoot = resolve(import.meta.dirname, '..')
const publicVendorRoot = resolve(backendRoot, 'public/vendor')
const require = createRequire(resolve(backendRoot, 'package.json'))
const cropperScriptPath = require.resolve('cropperjs/dist/cropper.min.js')
const openseadragonScriptPath = require.resolve('openseadragon/build/openseadragon/openseadragon.min.js')
const openseadragonSourceMapPath = require.resolve('openseadragon/build/openseadragon/openseadragon.min.js.map')
const openseadragonAssetPath = dirname(openseadragonScriptPath)
const simpleWebAuthnEntryPath = require.resolve('@simplewebauthn/browser')
const simpleWebAuthnScriptPath = resolve(dirname(simpleWebAuthnEntryPath), '../dist/bundle/index.umd.min.js')

await mkdir(resolve(publicVendorRoot, 'cropperjs'), {recursive: true})
await rm(resolve(publicVendorRoot, 'cropperjs/cropper.min.css'), {force: true})
await copyFile(cropperScriptPath, resolve(publicVendorRoot, 'cropperjs/cropper.min.js'))

await mkdir(resolve(publicVendorRoot, 'openseadragon'), {recursive: true})
await copyFile(openseadragonScriptPath, resolve(publicVendorRoot, 'openseadragon/openseadragon.min.js'))
await copyFile(openseadragonSourceMapPath, resolve(publicVendorRoot, 'openseadragon/openseadragon.min.js.map'))
await rm(resolve(publicVendorRoot, 'openseadragon/OpenSeadragonHTMLelements.js'), {force: true})
await copyFile(
    resolve(backendRoot, 'vendor/openseadragon/openseadragon-bookmark-url.js'),
    resolve(publicVendorRoot, 'openseadragon/openseadragon-bookmark-url.js'),
)
await cp(join(openseadragonAssetPath, 'images'), resolve(publicVendorRoot, 'openseadragon/images'), {recursive: true})

await mkdir(resolve(publicVendorRoot, 'simplewebauthn'), {recursive: true})
await copyFile(simpleWebAuthnScriptPath, resolve(publicVendorRoot, 'simplewebauthn/index.umd.min.js'))
