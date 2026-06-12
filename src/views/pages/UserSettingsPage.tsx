import type {CurrentUser} from '../../lib/auth/session'
import {profilePhotoUrl} from '../../lib/media/url'
import {
    createSettingsSocialLinks,
    FIXED_SOCIAL_LINKS,
    type FixedSocialPlatform,
    type UserSocialLink,
} from '../../lib/socialLinks'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type UserSettingsPageProps = {
    currentUser: CurrentUser
    socialLinks?: UserSocialLink[]
    mediaBaseUrl: string
}

function avatarUrlFor(user: CurrentUser, mediaBaseUrl: string): string {
    if (user.profilePhotoKey) {
        return profilePhotoUrl(mediaBaseUrl, user.id, user.profilePhotoKey)
    }

    const letter = user.username.trim().charAt(0).toUpperCase() || 'U'
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(letter)}&background=ccc&color=000`
}

function SocialIcon({platform}: { platform: FixedSocialPlatform | 'custom' }) {
    if (platform === 'twitter') {
        return (
            <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="currentColor" viewBox="0 0 24 24">
                <path
                    d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817-5.963 6.817H1.685l7.73-8.835L1.254 2.25h6.826l4.713 6.231 5.451-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/>
            </svg>
        )
    }

    if (platform === 'telegram') {
        return (
            <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="currentColor" viewBox="0 0 24 24">
                <path
                    d="M9.04 15.47 8.7 20.2c.49 0 .7-.21.96-.46l2.3-2.2 4.77 3.49c.87.48 1.49.23 1.72-.8L21.58 5.6c.31-1.45-.52-2.02-1.37-1.7L1.8 11.02c-1.41.55-1.39 1.33-.24 1.68l4.71 1.47L17.2 7.33c.52-.34.99-.15.6.2l-8.76 7.94Z"/>
            </svg>
        )
    }

    if (platform === 'discord') {
        return (
            <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="currentColor" viewBox="0 0 24 24">
                <path
                    d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a13.8 13.8 0 0 0-.63 1.3 18.4 18.4 0 0 0-5.48 0 13.8 13.8 0 0 0-.64-1.3 19.7 19.7 0 0 0-4.96 1.57C.52 9.03-.33 13.58.1 18.07a19.9 19.9 0 0 0 6.08 3.08c.49-.66.92-1.36 1.3-2.1a12.9 12.9 0 0 1-2.05-.98l.5-.39a14.2 14.2 0 0 0 12.15 0l.5.39c-.65.39-1.34.72-2.06.98.38.74.82 1.44 1.3 2.1a19.8 19.8 0 0 0 6.08-3.08c.5-5.2-.85-9.7-3.58-13.7ZM8.02 15.31c-1.18 0-2.16-1.08-2.16-2.41s.95-2.42 2.16-2.42c1.2 0 2.18 1.1 2.16 2.42 0 1.33-.96 2.41-2.16 2.41Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.41s.95-2.42 2.16-2.42c1.2 0 2.18 1.1 2.16 2.42 0 1.33-.95 2.41-2.16 2.41Z"/>
            </svg>
        )
    }

    if (platform === 'instagram') {
        return (
            <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="currentColor" viewBox="0 0 24 24">
                <defs>
                    <mask id="instagram-settings-icon">
                        <rect fill="white" height="24" width="24"/>
                        <circle cx="12" cy="12" fill="black" r="4"/>
                        <circle cx="17.5" cy="6.5" fill="black" r="1.4"/>
                    </mask>
                </defs>
                <rect height="20" mask="url(#instagram-settings-icon)" rx="5" width="20" x="2" y="2"/>
            </svg>
        )
    }

    if (platform === 'furaffinity') {
        return (
            <svg aria-hidden="true" class="h-6 w-6 opacity-70" fill="currentColor" viewBox="0 0 32 32">
                <path
                    d="M22.427 6.844l-0.344 2.656 3.245 0.958 0.042 2.865 2.974 0.057-0.073 3.005 2.891-0.188c0.005-1.010 0.068-6.724 0.839-9.354zM15.141 24.318c0.073-0.281 0-1.203 0-1.526l-0.063-1.948c-2.698-0.115-5.604 0.427-5.604 2.911 0 0.542 0.229 1.026 0.568 1.401h4.417c0.333-0.188 0.578-0.448 0.682-0.839zM27.188 17.422l0.068-2.995-2.938-0.057-0.047-3.229-3.37-1.151 0.453-3.146h-12.573c-5.094 0-8.781 4.339-8.781 9.089v9.224h5.49c-0.036-0.333-0.047-0.672-0.031-1.005 0.198-4.891 5.599-5.729 9.656-5.609v-1.406c-0.068-1.135-0.99-2.141-3.656-2.141-1.776 0-3.885 0.229-5.25 0.724l0.359-3.182c1.307-0.365 2.776-0.724 5.938-0.724 6.099 0 6.771 2.703 6.724 5.844l-0.031 7.5h3.307v-0.005l0.125 0.005c4.406 0 8.031-3.589 8.484-7.891z"/>
            </svg>
        )
    }

    if (platform === 'bluesky') {
        return (
            <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="currentColor" viewBox="0 0 600 530">
                <path
                    d="M135.72 44.03C202.22 93.89 273.63 194.94 300 249.16c26.37-54.22 97.78-155.27 164.28-205.13C512.28 8.05 590-19.79 590 68.8c0 17.7-10.15 148.72-16.11 169.98-20.7 73.96-96.14 92.85-163.25 81.43 117.3 19.95 147.14 86.09 82.68 152.23-122.39 125.59-175.91-31.51-189.63-71.77-2.52-7.39-3.69-10.83-3.69-7.89 0-2.94-1.17.5-3.69 7.89-13.72 40.26-67.24 197.36-189.63 71.77-64.46-66.14-34.62-132.28 82.68-152.23-67.11 11.42-142.55-7.47-163.25-81.43C20.15 217.52 10 86.5 10 68.8 10-19.79 87.72 8.05 135.72 44.03Z"/>
            </svg>
        )
    }

    return (
        <svg aria-hidden="true" class="h-5 w-5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43" stroke-linecap="round"
                  stroke-linejoin="round" stroke-width="2"/>
            <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33" stroke-linecap="round"
                  stroke-linejoin="round" stroke-width="2"/>
        </svg>
    )
}

function UserSettingsPageScript() {
    const script = `
        const settingsForm = document.querySelector('[data-settings-form]');
        const settingsAlert = document.querySelector('[data-settings-alert]');
        const settingsAlertMessage = document.querySelector('[data-settings-alert-message]');
        const profilePhotoUploader = document.querySelector('[data-profile-photo-uploader]');
        const profilePhotoInput = document.querySelector('[data-profile-photo-input]');
        const profilePhotoButton = document.querySelector('[data-profile-photo-button]');
        const profilePhotoCropper = document.querySelector('[data-profile-photo-cropper]');
        const profilePhotoCropImage = document.querySelector('[data-profile-photo-crop-image]');
        const profilePhotoImages = document.querySelectorAll('[data-profile-photo-image]');
        let profilePhotoCropperInstance = null;
        let profilePhotoObjectUrl = null;

        function showSettingsAlert(message, isSuccess = false) {
            settingsAlertMessage.textContent = message;
            settingsAlert.classList.toggle('alert-error', !isSuccess);
            settingsAlert.classList.toggle('alert-success', isSuccess);
            settingsAlert.classList.remove('invisible');
            settingsAlert.scrollIntoView({ block: 'nearest' });
        }

        function clearSettingsAlert() {
            settingsAlert.classList.add('invisible');
            settingsAlertMessage.textContent = '';
            settingsAlert.classList.remove('alert-error', 'alert-success');
        }

        function clearCustomValidity(form) {
            for (const input of form.querySelectorAll('input, textarea')) {
                input.setCustomValidity('');
            }
        }

        function validateUrl(input, label) {
            const value = input.value.trim();
            input.value = value;
            input.setCustomValidity('');

            if (!value) {
                return true;
            }

            try {
                const url = new URL(value);

                if (url.protocol !== 'https:') {
                    input.setCustomValidity(label + ' must start with https://');
                    return false;
                }
            } catch {
                input.setCustomValidity(label + ' must be a valid URL');
                return false;
            }

            return true;
        }

        function prepareOptionalSocialInputs(form) {
            for (const input of form.querySelectorAll('[data-social-url]')) {
                input.required = false;
                input.removeAttribute('required');

                if (!input.value.trim()) {
                    input.value = '';
                    input.setCustomValidity('');
                }
            }
        }

        function clearSocialValidityForInput(input) {
            if (!input) {
                return;
            }

            input.setCustomValidity('');

            if (input.matches('[data-social-url]') && !input.value.trim()) {
                input.required = false;
                input.removeAttribute('required');
            }

            if (input.name === 'customLinkLabel' || input.name === 'customLinkUrl') {
                const form = input.form;
                const customLabel = form && form.elements.namedItem('customLinkLabel');
                const customUrl = form && form.elements.namedItem('customLinkUrl');

                if (customLabel) customLabel.setCustomValidity('');
                if (customUrl) customUrl.setCustomValidity('');
            }
        }

        function validateSettingsForm(form) {
            clearCustomValidity(form);
            prepareOptionalSocialInputs(form);

            for (const input of form.querySelectorAll('[data-social-url]')) {
                validateUrl(input, input.dataset.socialLabel || 'Social link');
            }

            const customLabel = form.elements.namedItem('customLinkLabel');
            const customUrl = form.elements.namedItem('customLinkUrl');

            customLabel.value = customLabel.value.trim();
            customUrl.value = customUrl.value.trim();

            const hasCustomLabel = customLabel.value.length > 0;
            const hasCustomUrl = customUrl.value.length > 0;

            if (hasCustomLabel && !hasCustomUrl) {
                customUrl.setCustomValidity('Custom link requires a URL');
            }

            if (hasCustomUrl && !hasCustomLabel) {
                customLabel.setCustomValidity('Custom link requires a label');
            }

            if (hasCustomUrl) {
                validateUrl(customUrl, 'Custom link');
            }

            if (!form.reportValidity()) {
                showSettingsAlert('Check the highlighted fields and try again.');
                return false;
            }

            return true;
        }

        function canvasToBlob(canvas) {
            return new Promise((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Could not prepare profile photo.'));
                    }
                }, 'image/webp', 0.9);
            });
        }

        async function loadProfilePhotoForCropping(file) {
            if (!file.type.startsWith('image/')) {
                throw new Error('Choose an image file.');
            }

            if (typeof Cropper === 'undefined') {
                throw new Error('Profile photo editor could not load. Refresh and try again.');
            }

            if (profilePhotoCropperInstance) {
                profilePhotoCropperInstance.destroy();
                profilePhotoCropperInstance = null;
            }

            if (profilePhotoObjectUrl) {
                URL.revokeObjectURL(profilePhotoObjectUrl);
            }

            profilePhotoObjectUrl = URL.createObjectURL(file);
            profilePhotoCropImage.src = profilePhotoObjectUrl;
            profilePhotoCropperInstance = new Cropper(profilePhotoCropImage, {
                aspectRatio: 1,
                autoCropArea: 1,
                background: false,
                viewMode: 1,
                zoomable: false,
                zoomOnTouch: false,
                zoomOnWheel: false,
            });
        }

        async function createCroppedProfilePhoto() {
            if (!profilePhotoCropperInstance) {
                throw new Error('Choose a profile photo first.');
            }

            const canvas = profilePhotoCropperInstance.getCroppedCanvas({
                width: 512,
                height: 512,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });

            return await canvasToBlob(canvas);
        }

        if (profilePhotoInput && profilePhotoButton && profilePhotoCropper && profilePhotoCropImage) {
            profilePhotoInput.addEventListener('change', async () => {
                clearSettingsAlert();
                profilePhotoCropperInstance = null;
                profilePhotoButton.disabled = true;
                profilePhotoCropper.classList.add('hidden');

                const file = profilePhotoInput.files && profilePhotoInput.files[0];

                if (!file) {
                    return;
                }

                try {
                    await loadProfilePhotoForCropping(file);
                    profilePhotoCropper.classList.remove('hidden');
                    profilePhotoButton.disabled = false;
                } catch (error) {
                    showSettingsAlert(error instanceof Error ? error.message : 'Could not prepare profile photo.');
                }
            });

            profilePhotoButton.addEventListener('click', async () => {
                if (!profilePhotoUploader || !profilePhotoCropperInstance) {
                    showSettingsAlert('Choose a profile photo first.');
                    return;
                }

                clearSettingsAlert();
                const originalLabel = profilePhotoButton.textContent;
                profilePhotoButton.disabled = true;
                profilePhotoButton.textContent = 'Uploading...';

                let croppedProfilePhotoBlob;

                try {
                    croppedProfilePhotoBlob = await createCroppedProfilePhoto();
                } catch (error) {
                    showSettingsAlert(error instanceof Error ? error.message : 'Could not prepare profile photo.');
                    profilePhotoButton.disabled = false;
                    profilePhotoButton.textContent = originalLabel;
                    return;
                }

                const formData = new FormData();
                formData.set('csrfToken', profilePhotoUploader.dataset.csrfToken || '');
                formData.set('profilePhoto', new File([croppedProfilePhotoBlob], 'profile-photo.webp', {
                    type: 'image/webp',
                }));

                try {
                    const response = await fetch('/api/users/me/profile-photo', {
                        method: 'POST',
                        headers: {
                            accept: 'application/json',
                        },
                        body: formData,
                    });

                    const body = await response.json().catch(() => ({}));

                    if (!response.ok) {
                        showSettingsAlert(body.error || 'Profile photo could not be uploaded.');
                        return;
                    }

                    if (body.profilePhotoUrl) {
                        const profilePhotoUrl = body.profilePhotoUrl + '?v=' + Date.now();

                        for (const image of profilePhotoImages) {
                            image.src = profilePhotoUrl;
                        }
                    }

                    profilePhotoInput.value = '';
                    profilePhotoCropperInstance.destroy();
                    profilePhotoCropperInstance = null;
                    profilePhotoCropper.classList.add('hidden');
                    showSettingsAlert('Profile photo updated.', true);
                } catch {
                    showSettingsAlert('Could not reach the server. Try again.');
                } finally {
                    profilePhotoButton.disabled = !profilePhotoCropperInstance;
                    profilePhotoButton.textContent = originalLabel;
                }
            });
        }

        if (settingsForm) {
            prepareOptionalSocialInputs(settingsForm);

            settingsForm.addEventListener('input', (event) => {
                clearSettingsAlert();
                clearSocialValidityForInput(event.target);
            });

            settingsForm.addEventListener('change', (event) => {
                clearSocialValidityForInput(event.target);
            });

            settingsForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                if (!validateSettingsForm(settingsForm)) {
                    return;
                }

                clearSettingsAlert();

                const submitButton = settingsForm.querySelector('button[type="submit"]');
                const originalLabel = submitButton.textContent;
                submitButton.disabled = true;
                submitButton.textContent = 'Saving...';

                try {
                    const response = await fetch(settingsForm.action, {
                        method: 'POST',
                        headers: {
                            accept: 'application/json',
                        },
                        body: new FormData(settingsForm),
                    });

                    if (!response.ok) {
                        const body = await response.json().catch(() => ({}));
                        showSettingsAlert(body.error || 'Settings could not be saved.');
                        return;
                    }

                    showSettingsAlert('Settings saved.', true);
                } catch {
                    showSettingsAlert('Could not reach the server. Try again.');
                } finally {
                    submitButton.disabled = false;
                    submitButton.textContent = originalLabel;
                }
            });
        }
    `

    return (
        <script dangerouslySetInnerHTML={{__html: script}}></script>
    )
}

export function UserSettingsPage({currentUser, socialLinks = [], mediaBaseUrl}: UserSettingsPageProps) {
    const socialValues = createSettingsSocialLinks(socialLinks)

    return (
        <BaseLayout head={<link href="/vendor/cropperjs/cropper.min.css" rel="stylesheet"/>}
                    title="User Settings | MyOC">
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl}/>

            <main class="container mx-auto max-w-3xl px-3 py-6 sm:px-0">
                <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                        <h1 class="text-4xl font-bold sm:text-5xl">User Settings</h1>
                        <p class="mt-1 text-sm text-base-content/70">Edit how your account appears on your profile.</p>
                    </div>
                </div>

                <form action="/api/users/me" class="space-y-8" data-settings-form method="post">
                    <input name="csrfToken" type="hidden" value={currentUser.csrfToken}/>

                    <section class="space-y-5">
                        <div>
                            <h2 class="text-2xl font-bold">Profile</h2>
                            <p class="text-sm text-base-content/70">These details appear above your character
                                folders.</p>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <fieldset class="fieldset">
                                <label class="fieldset-label" for="email">Email</label>
                                <input
                                    autocomplete="email"
                                    class="input input-bordered w-full"
                                    id="email"
                                    name="email"
                                    required
                                    type="email"
                                    value={currentUser.email}
                                />
                            </fieldset>

                            <fieldset class="fieldset">
                                <label class="fieldset-label" for="password">Password</label>
                                <input
                                    autocomplete="new-password"
                                    class="input input-bordered w-full"
                                    id="password"
                                    minLength={8}
                                    name="password"
                                    placeholder="Enter a new password"
                                    type="password"
                                />
                                <div class="label">
                                    <span class="label-text-alt">Leave blank to keep your current password.</span>
                                </div>
                            </fieldset>
                        </div>

                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="username">Username</label>
                            <label class="input input-bordered w-full">
                                <span class="opacity-60">@</span>
                                <input
                                    class="grow"
                                    id="username"
                                    maxLength={32}
                                    minLength={3}
                                    name="username"
                                    pattern="[A-Za-z0-9_]+"
                                    required
                                    title="Use 3-32 letters, numbers, or underscores."
                                    type="text"
                                    value={currentUser.username}
                                />
                            </label>
                            <div class="label justify-between">
                                <span class="label-text-alt">Letters, numbers, and underscores only.</span>
                                <span class="label-text-alt">32 characters max</span>
                            </div>
                        </fieldset>

                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="bio">Bio</label>
                            <textarea
                                class="textarea textarea-bordered min-h-32 w-full resize-y"
                                id="bio"
                                maxLength={255}
                                name="bio"
                                placeholder="Write a short profile bio..."
                            >{currentUser.bio}</textarea>
                            <div class="label justify-end">
                                <span class="label-text-alt">255 characters max</span>
                            </div>
                        </fieldset>

                        <section class="rounded-box border border-base-300 bg-base-200 p-4">
                            <label class="flex cursor-pointer items-start gap-3">
                                <input
                                    checked={currentUser.displayNsfwMedia}
                                    class="checkbox checkbox-primary mt-1"
                                    name="displayNsfwMedia"
                                    type="checkbox"
                                    value="true"
                                />
                                <span>
                                    <span class="block font-bold">Display NSFW media</span>
                                    <span class="mt-1 block text-sm text-base-content/70">
                                        Show NSFW variants while browsing media when they are available. NSFW media will always display when editing characters.
                                    </span>
                                </span>
                            </label>
                        </section>

                        <section class="rounded-box border border-base-300 bg-base-200 p-4"
                                 data-csrf-token={currentUser.csrfToken} data-profile-photo-uploader>
                            <div class="flex flex-col gap-4 sm:flex-row sm:items-center">
                                <img
                                    alt={`${currentUser.username} profile preview`}
                                    class="h-24 w-24 shrink-0 rounded object-cover"
                                    data-profile-photo-image
                                    data-profile-photo-preview
                                    src={avatarUrlFor(currentUser, mediaBaseUrl)}
                                />

                                <div class="min-w-0 flex-1">
                                    <h3 class="text-xl font-bold">Profile Photo</h3>
                                    <p class="mt-1 text-sm text-base-content/70">
                                        You'll be able to crop the image before uploading.
                                    </p>

                                    <div class="mt-4 flex flex-col gap-3 sm:flex-row">
                                        <input accept="image/*" class="file-input file-input-bordered w-full"
                                               data-profile-photo-input type="file"/>
                                        <button class="btn btn-secondary" data-profile-photo-button disabled
                                                type="button">Upload Photo
                                        </button>
                                    </div>

                                    <div class="mt-4 hidden rounded-box border border-base-300 bg-base-100 p-4"
                                         data-profile-photo-cropper>
                                        <div class="max-h-[22rem] overflow-hidden rounded-box bg-base-300">
                                            <img alt="Selected profile photo crop editor"
                                                 class="block max-h-[22rem] w-full object-contain"
                                                 data-profile-photo-crop-image/>
                                        </div>
                                        <p class="mt-3 text-xs text-base-content/60">
                                            Drag the image or crop box to choose the square area.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </section>

                    <section class="space-y-5">
                        <div>
                            <h2 class="text-2xl font-bold">Social Links</h2>
                            <p class="text-sm text-base-content/70">Add the public links that should appear with your
                                profile.</p>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            {FIXED_SOCIAL_LINKS.map((link) => (
                                <fieldset class="fieldset">
                                    <label class="fieldset-label" for={link.formName}>{link.label}</label>
                                    <label class="input input-bordered w-full">
                                        <SocialIcon platform={link.platform}/>
                                        <input
                                            data-social-label={link.label}
                                            data-social-url
                                            class="grow"
                                            id={link.formName}
                                            inputmode="url"
                                            name={link.formName}
                                            placeholder={link.placeholder}
                                            type="text"
                                            value={socialValues.fixed[link.platform]}
                                        />
                                    </label>
                                </fieldset>
                            ))}
                        </div>

                        <div class="rounded-box border border-base-300 bg-base-200 p-4">
                            <h3 class="font-semibold">Custom Link</h3>
                            <div class="mt-3 grid gap-3 sm:grid-cols-2">
                                <fieldset class="fieldset">
                                    <label class="fieldset-label" for="customLinkLabel">Label</label>
                                    <input
                                        class="input input-bordered w-full"
                                        autocomplete="off"
                                        id="customLinkLabel"
                                        maxLength={40}
                                        name="customLinkLabel"
                                        placeholder="Website"
                                        type="text"
                                        value={socialValues.customLabel}
                                    />
                                </fieldset>

                                <fieldset class="fieldset">
                                    <label class="fieldset-label" for="customLinkUrl">URL</label>
                                    <label class="input input-bordered w-full">
                                        <SocialIcon platform="custom"/>
                                        <input
                                            class="grow"
                                            autocomplete="off"
                                            id="customLinkUrl"
                                            inputmode="url"
                                            name="customLinkUrl"
                                            placeholder="https://example.com"
                                            type="text"
                                            value={socialValues.customUrl}
                                        />
                                    </label>
                                </fieldset>
                            </div>
                        </div>
                    </section>

                    <div class="space-y-4 border-t border-base-300 pt-6">
                        <div class="alert invisible min-h-12 py-2" data-settings-alert>
                            <span data-settings-alert-message></span>
                        </div>

                        <div class="flex w-full flex-wrap justify-end gap-2">
                            <a class="btn btn-ghost" href="/">Cancel</a>
                            <button class="btn btn-primary" type="submit">Save Changes</button>
                        </div>
                    </div>
                </form>
            </main>

            <script src="/vendor/cropperjs/cropper.min.js"></script>
            <UserSettingsPageScript/>
        </BaseLayout>
    )
}
