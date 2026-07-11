import {copyFile, mkdir, rm} from 'node:fs/promises'

await mkdir('public/vendor/cropperjs', {recursive: true})
await rm('public/vendor/cropperjs/cropper.min.css', {force: true})
await copyFile('node_modules/cropperjs/dist/cropper.min.js', 'public/vendor/cropperjs/cropper.min.js')

await mkdir('public/vendor/simplewebauthn', {recursive: true})
await copyFile('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'public/vendor/simplewebauthn/index.umd.min.js')
