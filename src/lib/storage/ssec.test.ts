import {describe, expect, it} from 'vitest'
import {objectStorageEncryptionKey} from './ssec'

describe('objectStorageEncryptionKey', () => {
    it('accepts a 32-byte hexadecimal key', () => {
        const key = 'a5'.repeat(32)
        expect(objectStorageEncryptionKey({OBJECT_STORAGE_ENCRYPTION_KEY: key})).toBe(key)
    })

    it.each([undefined, '', 'a5'.repeat(31), 'zz'.repeat(32)])('rejects an invalid key', (key) => {
        expect(() => objectStorageEncryptionKey({OBJECT_STORAGE_ENCRYPTION_KEY: key})).toThrow(
            'OBJECT_STORAGE_ENCRYPTION_KEY must contain exactly 32 bytes as 64 hexadecimal characters',
        )
    })
})
