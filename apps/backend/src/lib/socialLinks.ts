export const FIXED_SOCIAL_LINKS = [
    {
        platform: 'twitter',
        formName: 'twitterUrl',
        label: 'Twitter / X',
        placeholder: 'https://twitter.com/username',
    },
    {
        platform: 'telegram',
        formName: 'telegramUrl',
        label: 'Telegram',
        placeholder: 'https://t.me/username',
    },
    {
        platform: 'discord',
        formName: 'discordUrl',
        label: 'Discord',
        placeholder: 'https://discord.com/users/...',
    },
    {
        platform: 'instagram',
        formName: 'instagramUrl',
        label: 'Instagram',
        placeholder: 'https://instagram.com/username',
    },
    {
        platform: 'furaffinity',
        formName: 'furaffinityUrl',
        label: 'Fur Affinity',
        placeholder: 'https://www.furaffinity.net/user/username',
    },
    {
        platform: 'bluesky',
        formName: 'blueskyUrl',
        label: 'Bluesky',
        placeholder: 'https://bsky.app/profile/username.bsky.social',
    },
] as const

export type FixedSocialPlatform = (typeof FIXED_SOCIAL_LINKS)[number]['platform']
export type SocialPlatform = FixedSocialPlatform | 'custom'

export type UserSocialLink = {
    platform: SocialPlatform
    label: string | null
    url: string
}

export type SettingsSocialLinks = {
    fixed: Record<FixedSocialPlatform, string>
    customLabel: string
    customUrl: string
}

export function createSettingsSocialLinks(links: UserSocialLink[] = []): SettingsSocialLinks {
    const fixed = Object.fromEntries(FIXED_SOCIAL_LINKS.map((link) => [link.platform, ''])) as Record<FixedSocialPlatform, string>
    let customLabel = ''
    let customUrl = ''

    for (const link of links) {
        if (link.platform === 'custom') {
            customLabel = link.label ?? ''
            customUrl = link.url
            continue
        }

        fixed[link.platform] = link.url
    }

    return {
        fixed,
        customLabel,
        customUrl,
    }
}
