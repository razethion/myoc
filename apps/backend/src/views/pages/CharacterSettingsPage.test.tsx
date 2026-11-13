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

describe('CharacterSettingsPage', () => {
    it('links to the character page using the encoded current name', () => {
        const html = renderCharacterSettingsPage({name: 'Old Name'})

        expect(html).toContain('data-character-view-link')
        expect(html).toContain('href="/u/demo%20user/Old%20Name"')
    })

    it('updates the character page link after a rename is saved', () => {
        const html = renderCharacterSettingsPage()

        expect(html).toContain('const characterProfileBaseUrl = "/u/demo%20user/";')
        expect(html).toContain('characterViewLink.href = characterProfileBaseUrl + encodeURIComponent(character.name);')
    })
})
