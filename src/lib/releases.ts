export const APP_VERSION = '2026.06.27.01'

export type ReleaseNote = {
    version: string
    releasedOn: string
    title: string
    summary: string
    changes: string[]
}

export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: '2026.06.27.01',
        releasedOn: 'June 27, 2026',
        title: 'Huge QOL update',
        summary: 'Major changes to site usability for better UX!.',
        changes: [
            'Character gallery tabs can now be moved left and right from the character editor with clearer tabs and layout panel controls.',
            'The default gallery tab can now be renamed.',
            'Gallery rows can now be moved up or down, with new rows insertable above or below existing rows.',
            'Gallery tabs now keep at least one row so layouts cannot be emptied by accident.',
            'Gallery layouts now keep at least one tab so the tab list cannot be emptied by accident.',
        ],
    },
    {
        version: '2026.06.26.01',
        releasedOn: 'June 26, 2026',
        title: 'Toyhou.se Migrations',
        summary: 'Import characters and gallery images from Toyhou.se into MyOC.',
        changes: [
            'You can now migrate your toyhou.se profile to myoc.',
            'Access migrations in your account settings.',
        ],
    },
    {
        version: '2026.06.22.01',
        releasedOn: 'June 22, 2026',
        title: 'Character Size Chart',
        summary: 'Compare your characters by height with the new size chart feature.',
        changes: [
            'Added a size chart feature for characters! You can tell MyOC your character\'s height and see them next to each other!',
            'You can also compare your characters to others with the global search tool!',
            'Size charts can be exported as an image or URL for sharing with others!',
        ],
    },
    {
        version: '2026.06.16.02',
        releasedOn: 'June 16, 2026',
        title: 'Original File Uploads',
        summary: 'Gallery uploads now keep the file the user chose instead of converting it.',
        changes: [
            'Gallery art uploads now preserve the original file format and bytes instead of converting to PNG.',
            'Animated GIF uploads stay GIFs.',
            'Embedded image metadata, including color profiles, is left intact when the original file includes it.',
        ],
    },
    {
        version: '2026.06.16.01',
        releasedOn: 'June 16, 2026',
        title: 'Version notifications',
        summary: 'New releases can now be surfaced to signed-in users.',
        changes: [
            'Signed-in users now have their latest seen version saved across devices.',
            'A notification appears when there is a newer release note they have not viewed yet.',
            'Visiting the What\'s New page marks the current version as seen.',
        ],
    },
    {
        version: '2026.06.15.02',
        releasedOn: 'June 15, 2026',
        title: 'Bug fixes.',
        summary: 'Character names now accept the intended punctuation.',
        changes: [
            'Some symbols weren\'t allowed in character names, but should have been. This has been fixed.',
            'Quoted character names such as "Ivo" are now accepted.',
            'Character-name validation no longer emits an invalid browser pattern warning.',
        ],
    },
    {
        version: '2026.06.15.01',
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
