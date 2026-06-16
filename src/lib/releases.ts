export const APP_VERSION = '2026.06.15.01'

export type ReleaseNote = {
    version: string
    releasedOn: string
    title: string
    summary: string
    changes: string[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: APP_VERSION,
        releasedOn: 'June 15, 2026',
        title: 'What\'s New, Bugfixes, and more!',
        summary: 'Now you can see what\'s happening on the site as it\'s happening!.',
        changes: [
            'Added this What\'s New page with a dedicated block for each app version.',
            'Introduced application versioning starting with version 2026.06.15.01.',
            'Implemented the notification to users when a new version has released.',
        ],
    },
]
