import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type SitePoliciesPageProps = {
    currentUser?: CurrentUser | null
    guestInitial: string
    mediaBaseUrl: string
}

type PolicySection = {
    title: string
    body: string[]
    bullets: string[]
    groups?: {
        title: string
        items: string[]
    }[]
}

const POLICY_SECTIONS: PolicySection[] = [
    {
        title: '1. Scope and acceptance',
        body: [
            'These Site Policies govern access to and use of MyOC, including all accounts, profiles, character records, images, metadata, descriptions, links, and any other material submitted to or displayed through the service.',
            'By using MyOC, you agree that your use of the service must comply with these policies, applicable law, and any moderator instruction issued to protect the service or its users.',
        ],
        bullets: [
            'Content means any text, image, file, link, tag, title, caption, profile field, character field, or metadata submitted by a user.',
            "Public content means content visible to users other than the uploader or the uploader's approved viewers.",
            'MyOC may remove, restrict, relabel, or decline to host content that violates these policies or creates legal, security, operational, or safety risk.',
        ],
    },
    {
        title: '2. Account responsibility',
        body: [
            'You are responsible for all activity performed through your account. You must keep account credentials secure and must not use MyOC to evade account limits, moderator action, blocks, bans, or access controls.',
            'Users must provide accurate account information where required for safety, age gating, or legal compliance. MyOC may suspend accounts that provide materially false information to access restricted areas or content.',
        ],
        bullets: [
            'Do not impersonate another person, artist, character owner, moderator, organization, or official MyOC channel.',
            'Do not create or use additional accounts to bypass enforcement, contact restrictions, content visibility restrictions, or technical limits.',
            'Do not sell, transfer, or provide account access to another person without written permission from MyOC.',
        ],
    },
    {
        title: '3. Rights, ownership, and license',
        body: [
            'You retain the rights you already hold in content you submit. Submitting content to MyOC does not transfer ownership of that content to MyOC.',
            'You grant MyOC a limited, non-exclusive, worldwide license to host, store, cache, process, resize, transcode, display, distribute, and back up submitted content as necessary to operate, secure, improve, and moderate the service.',
        ],
        bullets: [
            'You must have all rights, licenses, permissions, and consents required to upload, display, share, or authorize MyOC to process the content.',
            'You may not upload stolen art, unsourced assets, scraped images, unauthorized fanart, unauthorized bases, unauthorized stock photography, or official assets unless your use is permitted by the rights holder and applicable law.',
            'When credit is required by an artist, base maker, doll maker, generator, stock provider, license, or original platform, you must provide accurate and reasonably accessible credit.',
        ],
    },
    {
        title: '4. Character and artwork sourcing',
        body: [
            'Character profiles and galleries must not misrepresent who created, owns, designed, commissioned, or authorized the displayed material. MyOC may restrict profiles that rely on missing, misleading, or unverifiable sourcing.',
            'If a character, design, base, generator image, stock image, moodboard asset, or reference uses third-party material, the profile must make the relevant source and permission status clear enough for ordinary review.',
        ],
        bullets: [
            'Do not list, trade, advertise, or otherwise present a character as yours if you do not own or control the relevant rights.',
            'Do not upload traced, copied, edited, generated, or derivative artwork in a way that hides the underlying source or permission terms.',
            'Do not use screenshots, official artwork, published character assets, or real-person imagery as character art unless the use is clearly permitted and accurately labeled.',
        ],
    },
    {
        title: '5. Content classification and NSFW rules',
        body: [
            'MyOC permits adult fictional character content when it is lawful, properly labeled, and kept out of general-audience surfaces. Classification is based on what is visibly shown, what the work is plainly intended to communicate, and whether a reasonable viewer would expect a warning before seeing it in full resolution.',
            'MyOC may add warnings, require NSFW classification, restrict visibility, or remove content when classification is missing, misleading, or incompatible with these rules.',
        ],
        bullets: [
            'Adult content may only be uploaded, viewed, requested, offered, commissioned, or discussed by users who are legally permitted to access that material.',
            'Do not use MyOC to provide adult content to a user you know or reasonably should know is under the required age.',
            'Borderline cases should be classified as NSFW. If a reasonable person would not want the content opened in full HD at an office job, it belongs behind an NSFW warning.',
        ],
        groups: [
            {
                title: 'Allowed adult content',
                items: [
                    'General pornography, sexually explicit fictional character art, erotic writing, fetish content, and substantially similar adult material.',
                    'Consensual adult character content where all depicted characters are adults or adult-coded and the content is lawful in the relevant jurisdictions.',
                    'Nonsexual nudity, artistic nudity, and anatomy references when otherwise compliant with these policies.',
                ],
            },
            {
                title: 'Prohibited adult content',
                items: [
                    'Illegal content, sexual exploitation, "revenge" pornography, or content that advertises, requests, links to, facilitates, or normalizes unlawful sexual material.',
                    'IRL pornography, real-person sexual imagery, or sexual content using photos, videos, likenesses, or identifying depictions of real people.',
                    'Sexual content involving underage characters, minor-coded characters, loli, shota, cub, or substantially similar depictions.',
                    'Sexual content involving real animals, or substantially similar unlawful or abusive sexual material.',
                ],
            },
            {
                title: 'Must be marked NSFW',
                items: [
                    'Exposed reproductive organs, explicit sex acts, masturbation, sexually suggestive posing, sexual fluids, sex toys, fetish presentation, vore, or substantially similar sexual content.',
                    'Large or exaggerated clothing bulges, clothed arousal, or framing that makes genitals, breasts, buttocks, or sexualized body parts the focus of the image.',
                    'Gore, excessive blood, exposed viscera, severed body parts, graphic injury, or violence presented with comparable intensity.',
                    'Any content that a reasonable viewer would not want opened in full HD on a screen at an office job.',
                ],
            },
            {
                title: 'Not NSFW by itself',
                items: [
                    'Exposed nipples or breasts shown non-sexually, including ordinary toplessness or free-the-nipple style depictions.',
                    'Light blood, small injuries, bruises, scars, or low-intensity medical or action-related marks.',
                    'Artistic nudity where reproductive organs are not visible and the image is not sexually framed.',
                    'Nonsexual anatomy references, swimwear, underwear, or suggestive fashion when the image does not otherwise meet the NSFW standard.',
                ],
            },
        ],
    },
    {
        title: '6. Prohibited conduct and public safety',
        body: [
            'MyOC is for hosting and sharing character media. It may not be used to harass users, coordinate abuse, publish private information, threaten harm, or create unsafe public spaces.',
            'Moderator review may consider context, intent, severity, repetition, risk to other users, and whether a user ignored prior instruction.',
        ],
        bullets: [
            'Do not post threats, targeted insults, harassment, discriminatory attacks, hateful conduct, or encouragement of self-harm or violence.',
            "Do not disclose, solicit, trade, or threaten to disclose another person's private identifying information.",
            'Do not spam, flood, brigade, manipulate reports, coordinate harassment, or encourage other users to contact someone on your behalf.',
        ],
    },
    {
        title: '7. Derivative works, fandom, and real people',
        body: [
            'Derivative work must be labeled honestly. MyOC may host original characters inspired by existing media where the profile makes the original contribution clear and does not present official or canon material as user-owned content.',
            'Content involving real people requires additional caution because it can create privacy, consent, publicity, harassment, and defamation risk.',
        ],
        bullets: [
            'Do not upload profiles that are direct re-uploads of canon characters or lightly altered copies intended to function as the canon character.',
            'Do not use MyOC to depict, roleplay, sexualize, harass, impersonate, or commercially exploit real people without appropriate legal rights and consent.',
            'Do not use official assets, game screenshots, face claims, celebrity photos, or third-party media as a substitute for original character art unless clearly permitted and sourced.',
        ],
    },
    {
        title: '8. Technical abuse and platform integrity',
        body: [
            'Users must not interfere with MyOC systems, security controls, storage, media delivery, account protections, rate limits, or moderation workflows.',
            'MyOC may limit automated traffic, reject uploads, block requests, invalidate sessions, or suspend accounts to protect service availability and user data.',
        ],
        bullets: [
            'Do not probe, scan, exploit, bypass, reverse engineer, scrape, overload, or attempt unauthorized access to MyOC systems or user data.',
            'Do not upload malware, exploit files, tracking payloads, deceptive links, phishing pages, or files intended to disrupt browsers, devices, networks, or moderation tools.',
            'Do not use bots, crawlers, bulk downloaders, hotlinking, or automation in a way that avoids rate limits, extracts user content at scale, or degrades service quality.',
        ],
    },
    {
        title: '9. Enforcement and remedies',
        body: [
            'MyOC may enforce these policies at its discretion. Enforcement may occur with or without prior notice when needed to address legal risk, user safety, security risk, repeat abuse, or urgent operational concerns.',
            'Reports and appeals should include specific URLs, usernames, character names, timestamps, screenshots where appropriate, source links, ownership evidence, and a concise explanation of the alleged violation.',
        ],
        bullets: [
            'Possible actions include warning, content relabeling, content removal, delisting, upload restriction, profile freeze, account suspension, account termination, IP or device restriction, and preservation or disclosure required by law.',
            'MyOC is not a court, escrow service, marketplace arbitrator, or payment processor, and may be unable to force refunds, compel transfers, or resolve private contractual disputes.',
            'Repeated attempts to re-upload removed content, remove moderator warnings, evade restrictions, or retaliate against reporters may result in stronger enforcement.',
        ],
    },
    {
        title: '10. Changes, conflicts, and severability',
        body: [
            'MyOC may update these policies as the product, legal requirements, moderation needs, or technical risks change. Continued use of MyOC after an update means the updated policies apply to future use.',
            'If any policy term is unenforceable, the remaining terms continue to apply. If these Site Policies conflict with a separate Terms of Service, Privacy Policy, or legally required notice, the more specific or legally controlling document governs.',
        ],
        bullets: [
            "Policy examples are illustrative and do not limit MyOC's ability to address comparable conduct or content.",
            "Failure to enforce a policy in one situation does not waive MyOC's right to enforce that policy later.",
            'MyOC may preserve or disclose content and account records where required to comply with law, protect users, or investigate abuse.',
        ],
    },
]

export function SitePoliciesPage({currentUser, guestInitial, mediaBaseUrl}: SitePoliciesPageProps) {
    return (
        <BaseLayout title="Site Policies | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl} />
            <main class="min-h-[calc(100vh-4rem)] bg-base-100 px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
                <section class="mx-auto max-w-6xl">
                    <div class="border-b border-base-content/10 pb-8">
                        <p class="text-sm font-bold uppercase text-base-content/55">Site Policies</p>
                        <h1 class="font-display mt-4 max-w-4xl text-4xl leading-tight sm:text-5xl">
                            Rules for hosting, sharing, and moderating character media.
                        </h1>
                        <p class="mt-5 max-w-3xl text-base leading-7 text-base-content/70 sm:text-lg sm:leading-8">
                            These policies define what users may upload, how content must be labeled, and how MyOC may respond when content,
                            conduct, or technical behavior creates risk.
                        </p>
                    </div>

                    <div class="divide-y divide-base-content/10">
                        {POLICY_SECTIONS.map((section) => (
                            <section class="grid gap-6 py-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
                                <div>
                                    <h2 class="font-display text-3xl leading-tight">{section.title}</h2>
                                </div>
                                <div>
                                    <div class="grid gap-4 text-sm leading-6 text-base-content/70">
                                        {section.body.map((paragraph) => (
                                            <p>{paragraph}</p>
                                        ))}
                                    </div>
                                    <ul class="mt-6 grid gap-3 text-sm leading-6 text-base-content/70">
                                        {section.bullets.map((item) => (
                                            <li class="flex gap-3">
                                                <span aria-hidden="true" class="mt-2 h-1.5 w-1.5 shrink-0 bg-primary"></span>
                                                <span>{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    {section.groups ? (
                                        <div class="mt-8 grid gap-6 md:grid-cols-2">
                                            {section.groups.map((group) => (
                                                <div class="border border-base-content/10 p-5">
                                                    <h3 class="text-sm font-bold uppercase tracking-wide">{group.title}</h3>
                                                    <ul class="mt-4 grid gap-3 text-sm leading-6 text-base-content/70">
                                                        {group.items.map((item) => (
                                                            <li class="flex gap-3">
                                                                <span
                                                                    aria-hidden="true"
                                                                    class="mt-2 h-1.5 w-1.5 shrink-0 bg-base-content/35"
                                                                ></span>
                                                                <span>{item}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    ) : null}
                                </div>
                            </section>
                        ))}
                    </div>
                </section>
            </main>
        </BaseLayout>
    )
}
