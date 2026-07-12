import {type Context, Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {createMockDb, sqlFragment} from '../../test/mockD1'
import type {Bindings} from '../../types/bindings'
import {
    base64UrlToBytes,
    bytesToBase64Url,
    createBase64UrlToken,
    createCredentialPublicKeyValue,
    createDisabledPasswordHash,
    createPasskeyAuthenticationOptions,
    generateRecoveryPhrase,
    getPasskeyByCredentialId,
    getWebAuthnChallenge,
    hashRecoveryPhrase,
    hasUsablePassword,
    listUserSessions,
    normalizeRecoveryPhrase,
    type PasskeyRecord,
    parseTransports,
    serializeTransports,
    storeWebAuthnChallenge,
    toPasskeySummary,
    toWebAuthnCredential,
    verifyRecoveryPhrase,
} from './passkeys'

describe('passkey database helpers', () => {
    it('stores challenges with expiry cleanup and nullable metadata', async () => {
        const now = new Date('2026-06-10T12:00:00Z')
        const {db, boundStatements} = createMockDb()

        const challengeId = await storeWebAuthnChallenge(db, {
            userId: 'user-1',
            ceremony: 'authentication',
            challenge: 'challenge-value',
            now,
        })

        expect(challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(db.batch).toHaveBeenCalledTimes(1)
        expect(boundStatements[0]?.sql).toContain(sqlFragment('DELETE', 'FROM', 'webauthn_challenges'))
        expect(boundStatements[0]?.binds).toEqual(['2026-06-10 12:00:00'])
        expect(boundStatements[1]?.sql).toContain(sqlFragment('INSERT', 'INTO', 'webauthn_challenges'))
        expect(boundStatements[1]?.binds).toEqual([
            challengeId,
            'user-1',
            null,
            null,
            null,
            'authentication',
            'challenge-value',
            '2026-06-10 12:05:00',
        ])
    })

    it('fetches unexpired challenges by id and ceremony', async () => {
        const challenge = {
            id: 'challenge-1',
            user_id: 'user-1',
            email: null,
            username: null,
            webauthn_user_id: null,
            ceremony: 'authentication',
            challenge: 'challenge-value',
            expires_at: '2026-06-10 12:05:00',
        }
        const {db, boundStatements} = createMockDb({
            firstResults: [challenge],
        })

        await expect(getWebAuthnChallenge(db, 'challenge-1', 'authentication', new Date('2026-06-10T12:01:00Z'))).resolves.toEqual(
            challenge,
        )
        expect(boundStatements[0]?.binds).toEqual(['challenge-1', 'authentication', '2026-06-10 12:01:00'])
    })

    it('fetches passkeys by credential id', async () => {
        const passkey = createPasskey()
        const {db, boundStatements} = createMockDb({
            firstResults: [passkey],
        })

        await expect(getPasskeyByCredentialId(db, 'credential-id')).resolves.toEqual(passkey)
        expect(boundStatements[0]?.sql).toContain('WHERE credential_id = ?')
        expect(boundStatements[0]?.binds).toEqual(['credential-id'])
    })

    it('summarizes active sessions and marks the current one', async () => {
        const {db, boundStatements} = createMockDb({
            allResults: [
                [
                    {
                        id: 'current-session',
                        created_at: '2026-06-10 12:00:00',
                        expires_at: '2026-07-10 12:00:00',
                    },
                    {
                        id: 'other-session',
                        created_at: '2026-06-09 12:00:00',
                        expires_at: '2026-07-09 12:00:00',
                    },
                ],
            ],
        })

        await expect(
            listUserSessions(db, {
                id: 'user-1',
                sessionId: 'current-session',
                email: 'test@example.com',
                username: 'testuser',
                role: 'user',
                profilePhotoKey: null,
                bio: '',
                displayNsfwMedia: false,
                lastSeenVersion: null,
                csrfToken: 'csrf-token',
            }),
        ).resolves.toEqual([
            {
                id: 'current-session',
                createdAt: '2026-06-10 12:00:00',
                expiresAt: '2026-07-10 12:00:00',
                isCurrent: true,
            },
            {
                id: 'other-session',
                createdAt: '2026-06-09 12:00:00',
                expiresAt: '2026-07-09 12:00:00',
                isCurrent: false,
            },
        ])
        expect(boundStatements[0]?.sql).toContain('FROM sessions')
        expect(boundStatements[0]?.binds[0]).toBe('user-1')
    })
})

describe('passkey option helpers', () => {
    it('creates scoped authentication options for an existing user', async () => {
        const passkey = createPasskey({
            credential_id: 'existing-credential',
            transports: 'internal, usb',
        })
        const {db, boundStatements} = createMockDb({
            allResults: [[passkey]],
        })

        const response = await requestWithContext('https://127.0.0.1:8787/passkeys/options', db, async (c) =>
            createPasskeyAuthenticationOptions(c, {id: 'user-1'}),
        )
        const body = await response.json<{
            challengeId: string
            options: {
                rpId: string
                allowCredentials?: Array<{id: string; transports?: string[]}>
            }
        }>()

        expect(response.status).toBe(200)
        expect(body.challengeId).toMatch(/^[0-9a-f-]{36}$/)
        expect(body.options.rpId).toBe('localhost')
        expect(body.options.allowCredentials).toEqual([
            {
                id: 'existing-credential',
                transports: ['internal', 'usb'],
                type: 'public-key',
            },
        ])
        expect(boundStatements.some((statement) => statement.sql.includes(sqlFragment('INSERT', 'INTO', 'webauthn_challenges')))).toBe(true)
    })

    it('creates discoverable authentication options when no user is supplied', async () => {
        const {db} = createMockDb()

        const response = await requestWithContext('https://example.com/passkeys/options', db, async (c) =>
            createPasskeyAuthenticationOptions(c, null),
        )
        const body = await response.json<{
            options: {
                rpId: string
                allowCredentials?: unknown[]
            }
        }>()

        expect(response.status).toBe(200)
        expect(body.options.rpId).toBe('example.com')
        expect(body.options.allowCredentials).toBeUndefined()
    })
})

describe('passkey serialization helpers', () => {
    it('serializes transports and passkey summaries', () => {
        const syncedPasskey = createPasskey({
            name: null,
            device_type: 'multiDevice',
            backed_up: 1,
            transports: ' internal,usb,, ',
            last_used_at: '2026-06-11 12:00:00',
        })
        const securityKey = createPasskey({
            id: 'security-key',
            name: null,
            device_type: 'singleDevice',
        })

        expect(serializeTransports()).toBeNull()
        expect(serializeTransports([])).toBeNull()
        expect(serializeTransports(['internal', 'usb'])).toBe('internal,usb')
        expect(parseTransports(null)).toBeUndefined()
        expect(parseTransports(' internal,usb,, ')).toEqual(['internal', 'usb'])
        expect(toPasskeySummary(syncedPasskey)).toEqual({
            id: 'passkey-1',
            name: 'Synced passkey',
            deviceType: 'multiDevice',
            backedUp: true,
            transports: ['internal', 'usb'],
            createdAt: '2026-06-10 12:00:00',
            lastUsedAt: '2026-06-11 12:00:00',
        })
        expect(toPasskeySummary(securityKey).name).toBe('Security key')
    })

    it('converts credential public keys to and from base64url', () => {
        const bytes = new Uint8Array([0, 1, 2, 251, 252, 253, 254, 255])
        const encoded = bytesToBase64Url(bytes)

        expect(encoded).toBe('AAEC-_z9_v8')
        expect(createCredentialPublicKeyValue(bytes)).toBe(encoded)
        expect(Array.from(base64UrlToBytes(encoded))).toEqual(Array.from(bytes))
        expect(Array.from(toWebAuthnCredential(createPasskey({public_key: encoded})).publicKey)).toEqual(Array.from(bytes))
    })
})

describe('passkey recovery helpers', () => {
    it('normalizes and verifies recovery phrases before hashing', async () => {
        const phraseHash = await hashRecoveryPhrase(' Correct Horse_Battery  Staple ')

        expect(normalizeRecoveryPhrase(' Correct Horse_Battery  Staple ')).toBe('correct-horse-battery-staple')
        await expect(verifyRecoveryPhrase('correct-horse-battery-staple', phraseHash)).resolves.toBe(true)
        await expect(verifyRecoveryPhrase('wrong phrase', phraseHash)).resolves.toBe(false)
    })

    it('generates passkey-only password sentinels and recovery phrases', () => {
        const disabledHash = createDisabledPasswordHash()
        const recoveryPhrase = generateRecoveryPhrase()

        expect(disabledHash).toMatch(/^passkey-only:[A-Za-z0-9_-]{43}$/)
        expect(hasUsablePassword(disabledHash)).toBe(false)
        expect(hasUsablePassword('$2b$10$stored-password-hash')).toBe(true)
        expect(createBase64UrlToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
        expect(recoveryPhrase.split('-')).toHaveLength(4)
    })
})

async function requestWithContext<T>(
    url: string,
    db: D1Database,
    callback: (c: Context<{Bindings: Bindings}>) => Promise<T>,
): Promise<Response> {
    const app = new Hono<{Bindings: Bindings}>()
    app.get('/passkeys/options', async (c) => c.json(await callback(c)))

    return app.request(url, {}, {DB: db} as Bindings)
}

function createPasskey(overrides: Partial<PasskeyRecord> = {}): PasskeyRecord {
    return {
        id: 'passkey-1',
        user_id: 'user-1',
        credential_id: 'credential-id',
        public_key: 'AQID',
        webauthn_user_id: 'webauthn-user-1',
        counter: 0,
        device_type: 'singleDevice',
        backed_up: 0,
        transports: null,
        name: 'Laptop',
        created_at: '2026-06-10 12:00:00',
        last_used_at: null,
        ...overrides,
    }
}
