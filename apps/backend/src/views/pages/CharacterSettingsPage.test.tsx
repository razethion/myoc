import {describe, expect, it} from 'vitest'
import type {CurrentUser} from '../../lib/auth/session'
import {type CharacterSettingsCharacter, CharacterSettingsPage} from './CharacterSettingsPage'

const currentUser: CurrentUser = {
    bio: '',
    csrfToken: 'csrf-token',
    displayNsfwMedia: false,
    showUnapprovedMedia: true,
    email: 'demo@example.test',
    id: 'user-1',
    lastSeenVersion: null,
    profilePhotoKey: null,
    role: 'user',
    username: 'demo user',
}

function character(overrides: Partial<CharacterSettingsCharacter> = {}): CharacterSettingsCharacter {
    return {
        id: 'character-1',
        userId: 'user-1',
        name: 'Old Name',
        profileImageKey: 'profile.webp',
        description: '',
        ...overrides,
    }
}

function renderCharacterSettingsPage(overrides: Partial<CharacterSettingsCharacter> = {}): string {
    return CharacterSettingsPage({
        currentUser,
        character: character(overrides),
        galleryTabs: [],
        media: [],
        mediaBaseUrl: 'https://m.example.com',
    }).toString()
}

type FakeElement = {[key: string]: unknown}

function createStub(overrides: FakeElement = {}): FakeElement {
    const target = () => createStub()
    return new Proxy(target as unknown as FakeElement, {
        apply: () => createStub(),
        get(_target, property) {
            if (property === 'then' || property === Symbol.iterator || property === Symbol.asyncIterator) return undefined
            if (typeof property === 'string' && Object.hasOwn(overrides, property)) {
                return overrides[property]
            }
            return createStub()
        },
        set(_target, property, value) {
            if (typeof property === 'string') overrides[property] = value
            return true
        },
    })
}

type SubmitHandler = (event: {preventDefault(): void}) => Promise<void>

type RenameHarness = {
    anchor: {href: string}
    documentStub: FakeElement
    fetchStub: (url: unknown, options?: unknown) => Promise<unknown>
    requests: Array<{body: unknown; url: string}>
    submitHandlers: SubmitHandler[]
    windowStub: FakeElement
}

function createRenameHarness(): RenameHarness {
    const submitHandlers: SubmitHandler[] = []
    const anchor = {href: '/u/demo%20user/Old%20Name'}
    const elements: FakeElement = {
        'character-description': createStub({value: 'A description'}),
        'character-name': createStub({value: '  New Name  '}),
        'character-profile-photo': createStub({files: []}),
        'character-settings-form': createStub({
            addEventListener(type: unknown, handler: unknown) {
                if (type === 'submit' && typeof handler === 'function') {
                    submitHandlers.push(handler as SubmitHandler)
                }
            },
        }),
        'save-character-settings': createStub({classList: {toggle() {}}, dataset: {}, disabled: false, textContent: 'Save'}),
    }
    const requests: Array<{body: unknown; url: string}> = []
    const documentStub: FakeElement = {
        addEventListener() {},
        body: createStub(),
        createElement: () => createStub(),
        getElementById(id: unknown) {
            const element = typeof id === 'string' ? elements[id] : undefined
            return element ?? createStub()
        },
        querySelector(selector: unknown) {
            return selector === '[data-character-view-link]' ? anchor : createStub()
        },
        querySelectorAll: () => [],
    }
    const windowStub = createStub({clearTimeout() {}, location: {assign() {}}, setTimeout: () => 0})
    const fetchStub = async (url: unknown, options?: unknown) => {
        const requestOptions = (options ?? {}) as {body?: unknown}
        const body = typeof requestOptions.body === 'string' ? JSON.parse(requestOptions.body) : undefined
        const requestUrl = String(url)
        requests.push({body, url: requestUrl})
        if (requestUrl.endsWith('/gallery')) {
            return {json: async () => ({}), ok: true, status: 200}
        }
        return {json: async () => ({character: {description: 'A description', name: 'New Name'}}), ok: true, status: 200}
    }
    return {anchor, documentStub, fetchStub, requests, submitHandlers, windowStub}
}

function extractSettingsScript(html: string): string {
    for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script[^>]*>/gi)) {
        const script = match[1]
        if (script?.includes('character-settings-form')) return script
    }
    throw new Error('Character settings page did not render its settings script')
}

function runSettingsScript(html: string, harness: RenameHarness): void {
    const evaluate = new Function('document', 'window', 'fetch', extractSettingsScript(html)) as (...args: unknown[]) => void
    evaluate(harness.documentStub, harness.windowStub, harness.fetchStub)
}

describe('CharacterSettingsPage', () => {
    it('links to the character page using the encoded current name', () => {
        const html = renderCharacterSettingsPage({name: 'Old Name'})

        expect(html).toContain('data-character-view-link')
        expect(html).toContain('href="/u/demo%20user/Old%20Name"')
    })

    it('updates the character page link with the saved name after a rename', async () => {
        const harness = createRenameHarness()
        runSettingsScript(renderCharacterSettingsPage({name: 'Old Name'}), harness)

        expect(harness.submitHandlers).toHaveLength(1)
        const submit = harness.submitHandlers[0]
        if (!submit) throw new Error('Submit handler was not registered')

        await submit({preventDefault() {}})

        expect(harness.anchor.href).toBe('/u/demo%20user/New%20Name')
        const patch = harness.requests.find((request) => request.url === '/api/characters/character-1')
        expect(patch?.body).toEqual({description: 'A description', name: '  New Name  '})
    })
})
