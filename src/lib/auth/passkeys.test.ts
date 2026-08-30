import {type Context, Hono} from 'hono'
import {describe, expect, it} from 'vitest'
import {queryOne, seedChallenge, seedPasskey, seedSession, seedUser, useTestDatabase} from '../../test/d1'
import type {Bindings} from '../../types/bindings'
import {
    createCredentialPublicKeyValue,
    createDisabledPasswordHash,
    createPasskeyAuthenticationOptions,
    generateRecoveryPhrase,
    getPasskeyByCredentialId,
    getWebAuthnChallenge,
    hashRecoveryPhrase,
    hasUsablePassword,
    listUserSessions,
    type PasskeyRecord,
    serializeTransports,
    toPasskeySummary,
    toWebAuthnCredential,
    verifyRecoveryPhrase,
} from './passkeys'

const db = useTestDatabase()

describe('passkey database helpers', () => {
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
        await seedChallenge({
            id: challenge.id,
            userId: challenge.user_id,
            ceremony: 'authentication',
            challenge: challenge.challenge,
            expiresAt: challenge.expires_at,
        })

        await expect(getWebAuthnChallenge(db, 'challenge-1', 'authentication', new Date('2026-06-10T12:01:00Z'))).resolves.toEqual(
            challenge,
        )
        await expect(getWebAuthnChallenge(db, 'challenge-1', 'registration', new Date('2026-06-10T12:01:00Z'))).resolves.toBeNull()
        await expect(getWebAuthnChallenge(db, 'challenge-1', 'authentication', new Date('2026-06-10T12:06:00Z'))).resolves.toBeNull()
    })

    it('fetches passkeys by credential id', async () => {
        const passkey = createPasskey()
        await seedUser({id: passkey.user_id})
        await seedPasskey({
            id: 'other-passkey',
            userId: passkey.user_id,
            credentialId: 'other-credential',
            webauthnUserId: passkey.webauthn_user_id,
        })
        await seedPasskey({
            id: passkey.id,
            userId: passkey.user_id,
            credentialId: passkey.credential_id,
            publicKey: passkey.public_key,
            webauthnUserId: passkey.webauthn_user_id,
            counter: passkey.counter,
            deviceType: passkey.device_type,
            backedUp: Boolean(passkey.backed_up),
            transports: passkey.transports,
            name: passkey.name,
            createdAt: passkey.created_at,
            lastUsedAt: passkey.last_used_at,
        })

        await expect(getPasskeyByCredentialId(db, 'credential-id')).resolves.toEqual(passkey)
    })

    it('summarizes active sessions and marks the current one', async () => {
        await seedUser({id: 'user-1'})
        await seedSession({
            id: 'current-session',
            userId: 'user-1',
            token: 'current-token',
            createdAt: '2026-06-10 12:00:00',
            expiresAt: '2099-07-10 12:00:00',
        })
        await seedSession({
            id: 'other-session',
            userId: 'user-1',
            token: 'other-token',
            createdAt: '2026-06-09 12:00:00',
            expiresAt: '2099-07-09 12:00:00',
        })
        await seedSession({
            id: 'expired-session',
            userId: 'user-1',
            token: 'expired-token',
            createdAt: '2020-06-09 12:00:00',
            expiresAt: '2020-07-09 12:00:00',
        })
        await seedUser({id: 'user-2'})
        await seedSession({
            id: 'different-user-session',
            userId: 'user-2',
            token: 'different-user-token',
            createdAt: '2026-06-09 12:00:00',
            expiresAt: '2099-07-09 12:00:00',
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
                expiresAt: '2099-07-10 12:00:00',
                isCurrent: true,
            },
            {
                id: 'other-session',
                createdAt: '2026-06-09 12:00:00',
                expiresAt: '2099-07-09 12:00:00',
                isCurrent: false,
            },
        ])
    })
})

describe('passkey option helpers', () => {
    it('creates scoped authentication options for an existing user', async () => {
        const passkey = createPasskey({
            credential_id: 'existing-credential',
            transports: 'internal, usb',
        })
        await seedUser({id: passkey.user_id})
        await seedPasskey({
            id: passkey.id,
            userId: passkey.user_id,
            credentialId: passkey.credential_id,
            publicKey: passkey.public_key,
            webauthnUserId: passkey.webauthn_user_id,
            transports: passkey.transports,
            name: passkey.name,
            createdAt: passkey.created_at,
        })

        const response = await requestWithContext('https://127.0.0.1:8787/passkeys/options', async (c) =>
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
        expect(await queryOne('SELECT user_id, ceremony FROM webauthn_challenges WHERE id = ?', [body.challengeId])).toEqual({
            user_id: 'user-1',
            ceremony: 'authentication',
        })
    })

    it('creates discoverable authentication options when no user is supplied', async () => {
        const response = await requestWithContext('https://example.com/passkeys/options', async (c) =>
            createPasskeyAuthenticationOptions(c, null),
        )
        const body = await response.json<{
            challengeId: string
            options: {
                rpId: string
                allowCredentials?: unknown[]
            }
        }>()

        expect(response.status).toBe(200)
        expect(body.options.rpId).toBe('example.com')
        expect(body.options.allowCredentials).toBeUndefined()
        expect(await queryOne('SELECT user_id, ceremony FROM webauthn_challenges WHERE id = ?', [body.challengeId])).toEqual({
            user_id: null,
            ceremony: 'authentication',
        })
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
        const encoded = 'AAEC-_z9_v8'

        expect(createCredentialPublicKeyValue(bytes)).toBe(encoded)
        expect(Array.from(toWebAuthnCredential(createPasskey({public_key: encoded})).publicKey)).toEqual(Array.from(bytes))
    })
})

describe('passkey recovery helpers', () => {
    it('normalizes and verifies recovery phrases before hashing', async () => {
        const phraseHash = await hashRecoveryPhrase(' Correct Horse_Battery  Staple ')

        await expect(verifyRecoveryPhrase('correct-horse-battery-staple', phraseHash)).resolves.toBe(true)
        await expect(verifyRecoveryPhrase('wrong phrase', phraseHash)).resolves.toBe(false)
    })

    it('generates passkey-only password sentinels and recovery phrases', () => {
        const disabledHash = createDisabledPasswordHash()
        const recoveryPhrase = generateRecoveryPhrase()

        expect(disabledHash).toMatch(/^passkey-only:[A-Za-z0-9_-]{43}$/)
        expect(hasUsablePassword(disabledHash)).toBe(false)
        expect(hasUsablePassword('$2b$10$stored-password-hash')).toBe(true)
        expect(recoveryPhrase.split('-')).toHaveLength(4)
    })
})

async function requestWithContext<T>(url: string, callback: (c: Context<{Bindings: Bindings}>) => Promise<T>): Promise<Response> {
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
