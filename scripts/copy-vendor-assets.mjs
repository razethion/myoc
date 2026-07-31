import {copyFile, cp, mkdir, rm} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {dirname, join} from 'node:path'

const require = createRequire(import.meta.url)
const openseadragonScriptPath = require.resolve('openseadragon/build/openseadragon/openseadragon.min.js')
const openseadragonSourceMapPath = require.resolve('openseadragon/build/openseadragon/openseadragon.min.js.map')
const openseadragonAssetPath = dirname(openseadragonScriptPath)

await mkdir('public/vendor/cropperjs', {recursive: true})
await rm('public/vendor/cropperjs/cropper.min.css', {force: true})
await copyFile('node_modules/cropperjs/dist/cropper.min.js', 'public/vendor/cropperjs/cropper.min.js')

await mkdir('public/vendor/openseadragon', {recursive: true})
await copyFile(openseadragonScriptPath, 'public/vendor/openseadragon/openseadragon.min.js')
await copyFile(openseadragonSourceMapPath, 'public/vendor/openseadragon/openseadragon.min.js.map')
await rm('public/vendor/openseadragon/OpenSeadragonHTMLelements.js', {force: true})
await copyFile('vendor/openseadragon/openseadragon-bookmark-url.js', 'public/vendor/openseadragon/openseadragon-bookmark-url.js')
await cp(join(openseadragonAssetPath, 'images'), 'public/vendor/openseadragon/images', {recursive: true})

await mkdir('public/vendor/simplewebauthn', {recursive: true})
await copyFile('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'public/vendor/simplewebauthn/index.umd.min.js')
