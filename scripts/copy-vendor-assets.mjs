import {copyFile, mkdir} from 'node:fs/promises'

await mkdir('public/vendor/cropperjs', {recursive: true})
await copyFile('node_modules/cropperjs/dist/cropper.min.css', 'public/vendor/cropperjs/cropper.min.css')
await copyFile('node_modules/cropperjs/dist/cropper.min.js', 'public/vendor/cropperjs/cropper.min.js')
