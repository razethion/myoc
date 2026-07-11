import type {CurrentUser} from '../../lib/auth/session'
import {characterFolderImageUrl, characterProfileImageUrl, profilePhotoUrl} from '../../lib/media/url'
import {FIXED_SOCIAL_LINKS, type SocialPlatform, type UserSocialLink} from '../../lib/socialLinks'
import type {CharacterFolderPlacement, CharacterManagementCharacter, CharacterManagementFolder} from './CharacterManagementPage'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import {absoluteUrl, compactDescription} from '../meta'

export type ProfilePageUser = {
    id: string
    username: string
    profilePhotoKey: string | null
    bio: string
}

type ProfilePageProps = {
    currentUser?: CurrentUser | null
    profileUser: ProfilePageUser
    socialLinks: UserSocialLink[]
    folders: CharacterManagementFolder[]
    characters: CharacterManagementCharacter[]
    placements: CharacterFolderPlacement[]
    currentFolder?: CharacterManagementFolder | null
    folderPath?: CharacterManagementFolder[]
    mediaBaseUrl: string
    metaDescriptionFallback: string
    siteUrl: string
}

const socialLabelByPlatform = Object.fromEntries(
    FIXED_SOCIAL_LINKS.map((link) => [link.platform, link.label.replace(' / X', '')]),
) as Record<Exclude<SocialPlatform, 'custom'>, string>

function profileImageFor(user: ProfilePageUser, mediaBaseUrl: string): string {
    if (user.profilePhotoKey) {
        return profilePhotoUrl(mediaBaseUrl, user.id, user.profilePhotoKey)
    }

    const letter = user.username.trim().charAt(0).toUpperCase() || 'U'
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=ccc&color=000`
}

function FolderIcon() {
    return (
        <svg aria-hidden="true" class="relative z-10 h-full w-full" fill="none" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M18 54c0-12 10-22 22-22h38c8 0 15 4 19 11l8 13h55c12 0 22 10 22 22v76c0 12-10 22-22 22H40c-12 0-22-10-22-22V54Z"
                opacity="0.35"
                stroke="#000000"
                stroke-linejoin="round"
                stroke-width="12"
                transform="translate(3 4)"
            />
            <path
                d="M18 54c0-12 10-22 22-22h38c8 0 15 4 19 11l8 13h55c12 0 22 10 22 22v76c0 12-10 22-22 22H40c-12 0-22-10-22-22V54Z"
                opacity="0.72"
                stroke="#ffffff"
                stroke-linejoin="round"
                stroke-width="2"
            />
            <path d="M22 84h156" opacity="0.28" stroke="#ffffff" stroke-linecap="round" stroke-width="2" />
        </svg>
    )
}

function FolderCover({folder, mediaBaseUrl, userId}: {folder: CharacterManagementFolder; mediaBaseUrl: string; userId: string}) {
    if (folder.folderImageKey) {
        return (
            <img
                alt=""
                aria-hidden="true"
                class="absolute inset-0 z-10 h-full w-full object-cover transition group-hover:brightness-110"
                src={characterFolderImageUrl(mediaBaseUrl, userId, folder.id, folder.folderImageKey)}
            />
        )
    }

    return <FolderIcon />
}

function SocialIcon({platform}: {platform: SocialPlatform}) {
    if (platform === 'twitter') {
        return (
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.963 6.817H1.685l7.73-8.835L1.254 2.25h6.826l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
            </svg>
        )
    }

    if (platform === 'telegram') {
        return (
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M9.04 15.47 8.7 20.2c.49 0 .7-.21.96-.46l2.3-2.2 4.77 3.49c.87.48 1.49.23 1.72-.8L21.58 5.6c.31-1.45-.52-2.02-1.37-1.7L1.8 11.02c-1.41.55-1.39 1.33-.24 1.68l4.71 1.47L17.2 7.33c.52-.34.99-.15.6.2l-8.76 7.94Z" />
            </svg>
        )
    }

    if (platform === 'discord') {
        return (
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.8 13.8 0 0 0-.63 1.3 18.4 18.4 0 0 0-5.48 0 13.8 13.8 0 0 0-.64-1.3 19.7 19.7 0 0 0-4.96 1.57C.52 9.03-.33 13.58.1 18.07a19.9 19.9 0 0 0 6.08 3.08c.49-.66.92-1.36 1.3-2.1a12.9 12.9 0 0 1-2.05-.98l.5-.39a14.2 14.2 0 0 0 12.15 0l.5.39c-.65.39-1.34.72-2.06.98.38.74.82 1.44 1.3 2.1a19.8 19.8 0 0 0 6.08-3.08c.5-5.2-.85-9.7-3.58-13.7ZM8.02 15.31c-1.18 0-2.16-1.08-2.16-2.41s.95-2.42 2.16-2.42c1.2 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.41-2.16 2.41Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.41s.95-2.42 2.16-2.42c1.2 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.41-2.16 2.41Z" />
            </svg>
        )
    }

    if (platform === 'instagram') {
        return (
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <mask id="instagram-inverted-icon-profile">
                        <rect fill="white" height="24" width="24" />
                        <circle cx="12" cy="12" fill="black" r="4" />
                        <circle cx="17.5" cy="6.5" fill="black" r="1.4" />
                    </mask>
                </defs>
                <rect height="20" mask="url(#instagram-inverted-icon-profile)" rx="5" width="20" x="2" y="2" />
            </svg>
        )
    }

    if (platform === 'furaffinity') {
        return (
            <svg aria-hidden="true" class="w-8" fill="currentColor" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.427 6.844l-0.344 2.656 3.245 0.958 0.042 2.865 2.974 0.057-0.073 3.005 2.891-0.188c0.005-1.010 0.068-6.724 0.839-9.354zM15.141 24.318c0.073-0.281 0-1.203 0-1.526l-0.063-1.948c-2.698-0.115-5.604 0.427-5.604 2.911 0 0.542 0.229 1.026 0.568 1.401h4.417c0.333-0.188 0.578-0.448 0.682-0.839zM27.188 17.422l0.068-2.995-2.938-0.057-0.047-3.229-3.37-1.151 0.453-3.146h-12.573c-5.094 0-8.781 4.339-8.781 9.089v9.224h5.49c-0.036-0.333-0.047-0.672-0.031-1.005 0.198-4.891 5.599-5.729 9.656-5.609v-1.406c-0.068-1.135-0.99-2.141-3.656-2.141-1.776 0-3.885 0.229-5.25 0.724l0.359-3.182c1.307-0.365 2.776-0.724 5.938-0.724 6.099 0 6.771 2.703 6.724 5.844l-0.031 7.5h3.307v-0.005l0.125 0.005c4.406 0 8.031-3.589 8.484-7.891z" />
            </svg>
        )
    }

    if (platform === 'bluesky') {
        return (
            <svg aria-hidden="true" class="h-6 w-6" fill="currentColor" viewBox="0 0 600 530" xmlns="http://www.w3.org/2000/svg">
                <path d="M135.72 44.03C202.22 93.89 273.63 194.94 300 249.16c26.37-54.22 97.78-155.27 164.28-205.13C512.28 8.05 590-19.79 590 68.8c0 17.7-10.15 148.72-16.11 169.98-20.7 73.96-96.14 92.85-163.25 81.43 117.3 19.95 147.14 86.09 82.68 152.23-122.39 125.59-175.91-31.51-189.63-71.77-2.52-7.39-3.69-10.83-3.69-7.89 0-2.94-1.17.5-3.69 7.89-13.72 40.26-67.24 197.36-189.63 71.77-64.46-66.14-34.62-132.28 82.68-152.23-67.11 11.42-142.55-7.47-163.25-81.43C20.15 217.52 10 86.5 10 68.8 10-19.79 87.72 8.05 135.72 44.03Z" />
            </svg>
        )
    }

    return (
        <svg aria-hidden="true" class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path
                d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
            />
            <path
                d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
            />
        </svg>
    )
}

function socialLabel(link: UserSocialLink): string {
    if (link.platform === 'custom') {
        return link.label || 'Custom link'
    }

    return socialLabelByPlatform[link.platform]
}

function profileUrl(username: string): string {
    return `/u/${encodeURIComponent(username)}`
}

function folderUrl(username: string, folders: CharacterManagementFolder[]): string {
    return `${profileUrl(username)}/${folders.map((folder) => encodeURIComponent(folder.name)).join('/')}`
}

function characterUrl(username: string, character: CharacterManagementCharacter): string {
    return `${profileUrl(username)}/${encodeURIComponent(character.name)}`
}

function profilePageDescription(profileUser: ProfilePageUser, fallback: string): string {
    return compactDescription(profileUser.bio, fallback)
}

function ProfilePageHead({
    currentFolder,
    folderPath,
    imageUrl,
    metaDescriptionFallback,
    pageTitle,
    profileUser,
    siteUrl,
}: {
    currentFolder: CharacterManagementFolder | null
    folderPath: CharacterManagementFolder[]
    imageUrl: string
    metaDescriptionFallback: string
    pageTitle: string
    profileUser: ProfilePageUser
    siteUrl: string
}) {
    const canonicalPath = currentFolder ? folderUrl(profileUser.username, folderPath) : profileUrl(profileUser.username)
    const canonicalUrl = absoluteUrl(siteUrl, canonicalPath)
    const description = profilePageDescription(profileUser, metaDescriptionFallback)
    const imageAlt = `${profileUser.username} profile photo`
    const structuredData = {
        '@context': 'https://schema.org',
        '@type': 'ProfilePage',
        name: pageTitle,
        url: canonicalUrl,
        description,
        image: imageUrl,
        mainEntity: {
            '@type': 'Person',
            name: profileUser.username,
            image: imageUrl,
            url: canonicalUrl,
        },
    }

    return (
        <>
            <meta content={description} name="description" />
            <link href={canonicalUrl} rel="canonical" />

            <meta content={pageTitle} property="og:title" />
            <meta content={description} property="og:description" />
            <meta content="profile" property="og:type" />
            <meta content={canonicalUrl} property="og:url" />
            <meta content="MyOC" property="og:site_name" />
            <meta content={imageUrl} property="og:image" />
            <meta content="512" property="og:image:width" />
            <meta content="512" property="og:image:height" />
            <meta content={profileUser.profilePhotoKey ? 'image/webp' : 'image/png'} property="og:image:type" />
            <meta content={imageAlt} property="og:image:alt" />

            <meta content="summary" name="twitter:card" />
            <meta content={pageTitle} name="twitter:title" />
            <meta content={description} name="twitter:description" />
            <meta content={imageUrl} name="twitter:image" />
            <meta content={imageAlt} name="twitter:image:alt" />

            <script dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}} type="application/ld+json"></script>
        </>
    )
}

function ProfileSettingsLink() {
    return (
        <a
            aria-label="Content settings"
            class="btn btn-square btn-ghost absolute right-3 top-4 sm:right-0"
            href="/settings"
            title="Settings"
        >
            <span class="sr-only">Content settings</span>
            <svg
                aria-hidden="true"
                class="h-6 w-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 0 0-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 0 0-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 0 0-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 0 0-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 0 0 1.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.607 2.296.07 2.572-1.065Z"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                />
                <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" />
            </svg>
        </a>
    )
}

export function ProfilePage({
    currentUser,
    profileUser,
    socialLinks,
    folders,
    characters,
    placements,
    currentFolder = null,
    folderPath = [],
    mediaBaseUrl,
    metaDescriptionFallback,
    siteUrl,
}: ProfilePageProps) {
    const profileImageUrl = profileImageFor(profileUser, mediaBaseUrl)
    const childFolders = folders.filter((folder) => folder.parentFolderId === (currentFolder?.id ?? null))
    const characterById = new Map(characters.map((character) => [character.id, character]))
    const visibleCharacters = currentFolder
        ? placements
              .filter((placement) => placement.folderId === currentFolder.id)
              .sort((left, right) => left.sortOrder - right.sortOrder)
              .map((placement) => characterById.get(placement.characterId))
              .filter((character): character is CharacterManagementCharacter => Boolean(character))
        : characters
    const canEdit = currentUser?.id === profileUser.id
    const visibleSocialLinks = socialLinks.filter((link) => link.url)
    const isFolderPage = currentFolder !== null
    const pageTitle = isFolderPage ? `${currentFolder.name} | ${profileUser.username} | MyOC` : `${profileUser.username} | MyOC`

    return (
        <BaseLayout
            head={
                <ProfilePageHead
                    currentFolder={currentFolder}
                    folderPath={folderPath}
                    imageUrl={profileImageUrl}
                    metaDescriptionFallback={metaDescriptionFallback}
                    pageTitle={pageTitle}
                    profileUser={profileUser}
                    siteUrl={siteUrl}
                />
            }
            title={pageTitle}
        >
            <Navbar
                currentUser={currentUser}
                guestInitial={profileUser.username.trim().charAt(0).toUpperCase() || 'R'}
                mediaBaseUrl={mediaBaseUrl}
            />
            <main class="container relative mx-auto px-3 py-4 sm:px-0">
                {canEdit ? <ProfileSettingsLink /> : null}

                <div class="mb-4 flex justify-center pt-2">
                    <div class="flex max-w-full flex-col items-center gap-3 sm:flex-row">
                        <img
                            alt={`${profileUser.username} avatar`}
                            class="h-[6.25rem] w-[6.25rem] rounded object-cover"
                            src={profileImageUrl}
                        />
                        <h1 class="max-w-full break-words text-center text-5xl font-bold leading-none sm:text-6xl sm:-translate-y-[0.06em] sm:text-left">
                            {profileUser.username.toUpperCase()}
                        </h1>
                    </div>
                </div>

                {profileUser.bio ? (
                    <p class="mx-auto mb-2 max-w-3xl whitespace-pre-wrap text-center font-light">{profileUser.bio}</p>
                ) : null}

                {visibleSocialLinks.length > 0 ? (
                    <div class="mb-4 flex flex-wrap items-center justify-center gap-3">
                        {visibleSocialLinks.map((link) => {
                            const label = socialLabel(link)
                            return (
                                <a
                                    aria-label={label}
                                    class="btn btn-circle btn-ghost transition duration-200 hover:-translate-y-1 hover:scale-110 active:translate-y-0 active:scale-95"
                                    href={link.url}
                                    rel="noopener noreferrer"
                                    target="_blank"
                                    title={label}
                                >
                                    <SocialIcon platform={link.platform} />
                                </a>
                            )
                        })}
                    </div>
                ) : null}

                {isFolderPage ? (
                    <nav aria-label="Folder breadcrumbs" class="breadcrumbs mb-5 justify-center overflow-x-auto text-sm">
                        <ul class="justify-center">
                            <li>
                                <a
                                    class="rounded border border-base-300 bg-base-200 px-2 py-1 font-semibold leading-none text-base-content hover:bg-base-300"
                                    href={profileUrl(profileUser.username)}
                                >
                                    {profileUser.username}
                                </a>
                            </li>
                            {folderPath.map((folder, index) => {
                                const href = folderUrl(profileUser.username, folderPath.slice(0, index + 1))
                                const isCurrentFolder = folder.id === currentFolder.id

                                return (
                                    <li>
                                        {isCurrentFolder ? (
                                            <span class="rounded border border-primary bg-primary px-2 py-1 font-bold leading-none text-primary-content">
                                                {folder.name}
                                            </span>
                                        ) : (
                                            <a
                                                class="rounded border border-base-300 bg-base-200 px-2 py-1 font-semibold leading-none text-base-content hover:bg-base-300"
                                                href={href}
                                            >
                                                {folder.name}
                                            </a>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    </nav>
                ) : null}

                {isFolderPage ? (
                    <div class="mb-4 text-center">
                        <p class="text-sm font-semibold uppercase tracking-widest text-base-content/50">Folder</p>
                        <h2 class="text-3xl font-bold">{currentFolder.name}</h2>
                    </div>
                ) : null}

                {childFolders.length > 0 ? (
                    <section aria-label="Folders" class="grid grid-cols-3 gap-3 sm:gap-6 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {childFolders.map((folder) => (
                            <a
                                aria-label={`View folder ${folder.name}`}
                                class="group block"
                                href={folderUrl(profileUser.username, [...folderPath, folder])}
                            >
                                <figure>
                                    <div class="relative aspect-square w-full overflow-hidden rounded bg-base-200 p-6 transition group-hover:bg-base-300">
                                        <div
                                            aria-hidden="true"
                                            class="pointer-events-none absolute inset-0 bg-white/0 transition group-hover:bg-white/10"
                                        ></div>
                                        <FolderCover folder={folder} mediaBaseUrl={mediaBaseUrl} userId={profileUser.id} />
                                    </div>
                                    <figcaption class="mt-2 text-center font-bold">{folder.name}</figcaption>
                                </figure>
                            </a>
                        ))}
                    </section>
                ) : null}

                {childFolders.length > 0 && visibleCharacters.length > 0 ? <hr class="my-8" /> : null}

                {visibleCharacters.length > 0 ? (
                    <section aria-label="Characters" class="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
                        {visibleCharacters.map((character) => (
                            <a
                                aria-label={`View ${character.name}`}
                                class="group block"
                                href={characterUrl(profileUser.username, character)}
                            >
                                <figure>
                                    <img
                                        alt={`${character.name} portrait`}
                                        class="aspect-square w-full rounded object-cover transition group-hover:brightness-110"
                                        src={characterProfileImageUrl(
                                            mediaBaseUrl,
                                            profileUser.id,
                                            character.id,
                                            character.profileImageKey,
                                        )}
                                    />
                                    <figcaption class="mt-2 text-center font-bold">{character.name}</figcaption>
                                </figure>
                            </a>
                        ))}
                    </section>
                ) : (
                    <section class="rounded-box border border-base-300 bg-base-200 p-8 text-center text-base-content/70">
                        <p>{canEdit ? 'Create a character to start filling out this page.' : 'No characters have been added here yet.'}</p>
                    </section>
                )}
            </main>
        </BaseLayout>
    )
}
