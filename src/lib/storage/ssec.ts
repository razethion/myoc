export function objectStorageEncryptionKey(env: {OBJECT_STORAGE_ENCRYPTION_KEY?: string}): string {
    const value = env.OBJECT_STORAGE_ENCRYPTION_KEY
    if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) {
        throw new Error('OBJECT_STORAGE_ENCRYPTION_KEY must contain exactly 32 bytes as 64 hexadecimal characters')
    }

    return value
}
