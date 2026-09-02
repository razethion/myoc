import {describe, expect, it} from 'vitest'
import {createSettingsSocialLinks, FIXED_SOCIAL_LINKS} from './socialLinks'

describe('createSettingsSocialLinks', () => {
    it('creates empty settings fields when a user has no links', () => {
        const settings = createSettingsSocialLinks()

        expect(Object.keys(settings.fixed)).toEqual(FIXED_SOCIAL_LINKS.map((link) => link.platform))
        expect(Object.values(settings.fixed).every((value) => value === '')).toBe(true)
        expect(settings.customLabel).toBe('')
        expect(settings.customUrl).toBe('')
    })

    it('maps fixed and custom profile links into settings form values', () => {
        expect(
            createSettingsSocialLinks([
                {
                    platform: 'twitter',
                    label: null,
                    url: 'https://x.com/testuser',
                },
                {
                    platform: 'bluesky',
                    label: null,
                    url: 'https://bsky.app/profile/testuser.example',
                },
                {
                    platform: 'custom',
                    label: null,
                    url: 'https://example.com',
                },
                {
                    platform: 'custom',
                    label: 'Portfolio',
                    url: 'https://portfolio.example',
                },
            ]),
        ).toEqual({
            fixed: {
                twitter: 'https://x.com/testuser',
                telegram: '',
                discord: '',
                instagram: '',
                furaffinity: '',
                bluesky: 'https://bsky.app/profile/testuser.example',
            },
            customLabel: 'Portfolio',
            customUrl: 'https://portfolio.example',
        })
    })
})
