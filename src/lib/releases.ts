export type ReleaseNote = {
    version: string
    releasedOn: string
    title: string
    summary: string
    changes: string[]
    important?: boolean
}

export const RELEASE_NOTES: ReleaseNote[] = [
    {
        version: '2026.07.05.02',
        releasedOn: 'July 5, 2026',
        title: 'Various improvements',
        summary: 'Bugfixes, new features, and more.',
        changes: [
            'Fixed a bug where some characters had their heads cut-off by the size-chart feature.',
            'Added the option to specify where the character\'s nameplate should display below them.',
        ],
    },
    {
        version: '2026.07.05.01',
        releasedOn: 'July 5, 2026',
        title: 'Character Studio Improvements',
        summary: 'Made it easier than ever to manage characters.',
        changes: [
            'Cleaned up the character studio page with a fresh new layout.',
            'Added the ability to order how characters display on your profile.',
            'Improved character-to-folder assignments.',
            'Fixed bugs.',
        ],
    },
    {
        version: '2026.07.02.01',
        releasedOn: 'July 2, 2026',
        title: 'Improved gallery editor',
        summary: 'It\'s now easier than ever to edit your gallery.',
        important: true,
        changes: [
            'The gallery editor is now simpler and easier to use and understand the expected layout.',
            'Drag-and-drop is more reliable and predictable.',
            'IMPORTANT: "Fullsize last row" was replaced by a new setting that works across tabs. If you ' +
            'used this feature, your preference was not saved. You should check your gallery to ensure ' +
            'the final row renders how you want. Because the previous feature was tab-agnostic, ' +
            'we could not infer your preferences.',
        ],
    },
    {
        version: '2026.07.01.01',
        releasedOn: 'July 1, 2026',
        title: 'New homepage, and rules!',
        summary: 'Reworked the homepage and added a vision and rules page.',
        changes: [
            'Reworked the homepage to be more user friendly.',
            'Added a product vision page to make it clear what we are doing and what we stand for.',
            'Added the site policies page so everyone knows what is and is not allowed.',
            'Added a warning to the sizechart regarding display preferences.',
            'Fixed a bug with loading spinners on character media.',
        ],
    },
    {
        version: '2026.06.29.01',
        releasedOn: 'June 29, 2026',
        title: 'Image gallery improvements',
        summary: 'Fixed some bugs!',
        changes: [
            'Blurs are images now, instead of client rendered for better performance.',
            'Improve the fullres media loader and fixed some bugs with it.',
        ],
    },
    {
        version: '2026.06.27.01',
        releasedOn: 'June 27, 2026',
        title: 'Huge QOL update',
        summary: 'Major changes to site usability for better UX!',
        changes: [
            'Character gallery tabs can now be moved left and right from the character editor with clearer tabs and layout panel controls.',
            'The default gallery tab can now be renamed.',
            'Gallery rows can now be moved up or down, with new rows insertable above or below existing rows.',
            'Bulk gallery uploads now show a modal with upload progress.',
            'Images now have thumbnails so pages load quicker, before the full-res can be loaded by the client.',
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
        summary: 'Now you can see what\'s happening on the site as it\'s happening!',
        changes: [
            'Added this What\'s New page with a dedicated block for each app version.',
            'Introduced application versioning starting with version 2026.06.15.01.',
            'Implemented the notification to users when a new version has released.',
        ],
    },
]

function latestReleaseVersion(releases: ReleaseNote[]) {
    const latestRelease = releases[0]
    if (!latestRelease) {
        throw new Error('RELEASE_NOTES must include at least one release.')
    }

    return latestRelease.version
}

export const APP_VERSION = latestReleaseVersion(RELEASE_NOTES)
