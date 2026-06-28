import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

export type ToyhouseCharacter = {
    canImport?: boolean
    id: string
    images: ToyhouseImage[]
    imageCount: number | null
    importIssues?: string[]
    importMode?: 'create' | 'existing'
    name: string
    targetCharacterId?: string | null
    thumbnailUrl: string | null
    url: string
}

export type ToyhouseImage = {
    fullsizeUrl: string
    thumbnailUrl: string
}

export type ToyhouseMigrationResult = {
    profileUrl: string
    folderUrl: string
    characters: ToyhouseCharacter[]
    myocUserId: string
    pagesFetched: number
}

export type ToyhouseImportResult = {
    createdCharacters: number
    updatedCharacters: number
    importedImages: number
    skippedImages: number
}

export type ToyhouseClientImportPlan = {
    characters: {
        importMode: 'create' | 'existing'
        images: {
            fullsizeUrl: string
            importItemId: string
            mediaId?: string | null
            rating: 'sfw' | 'nsfw'
            status: 'pending' | 'uploading' | 'imported' | 'failed'
        }[]
        myocCharacterId: string
        name: string
        toyhouseId: string
    }[]
    createdCharacters: number
    importJobId: string
    totalImages: number
    updatedCharacters: number
}

type MigratePageProps = {
    clientImportPlan?: ToyhouseClientImportPlan | null
    currentUser: CurrentUser | null
    guestInitial?: string
    importResult?: ToyhouseImportResult | null
    mediaBaseUrl: string
    migrationError?: string
    migrationResult?: ToyhouseMigrationResult | null
    receiveToyhouseImport?: boolean
    showSetupForm?: boolean
    siteUrl: string
    toyhouseUsername?: string
}

export function MigratePage({
                                clientImportPlan = null,
                                currentUser,
                                guestInitial = 'M',
                                importResult = null,
                                mediaBaseUrl,
                                migrationError = '',
                                migrationResult = null,
                                receiveToyhouseImport = false,
                                showSetupForm = true,
                                siteUrl,
                                toyhouseUsername = '',
                            }: MigratePageProps) {
    const normalizedToyhouseUsername = getToyhouseUsername(toyhouseUsername)
    const toyhouseFolderUrl = getToyhouseFolderUrl(normalizedToyhouseUsername)

    return (
        <BaseLayout title="Migrate from Toyhou.se | MyOC">
            <Navbar currentUser={currentUser} guestInitial={guestInitial} mediaBaseUrl={mediaBaseUrl}/>

            <main class="container mx-auto max-w-3xl px-3 py-6 sm:px-0">
                <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="min-w-0">
                        <h1 class="text-4xl font-bold sm:text-5xl">Migrate from Toyhou.se</h1>
                        <p class="mt-1 text-sm text-base-content/70">
                            Import your public Toyhou.se profile into MyOC.
                        </p>
                    </div>
                    {currentUser ? (
                        <a class="btn btn-ghost" href="/settings">Back to Settings</a>
                    ) : (
                        <a class="btn btn-primary" href="/login">Sign in</a>
                    )}
                </div>

                <section class="space-y-5">
                    <div class="alert border-warning/40 bg-warning/10 text-base-content">
                        <span>
                            Please ensure you are logged into toyhouse before starting.
                        </span>
                    </div>

                    {showSetupForm && (
                        <form action="/migrate" class="rounded-box border border-base-300 bg-base-200 p-4" method="get">
                            <fieldset class="fieldset">
                                <label class="fieldset-label" for="toyhouse-username">Toyhou.se username</label>
                                <label class="input input-bordered w-full">
                                    <svg aria-hidden="true" class="h-5 w-5 opacity-60" fill="none" stroke="currentColor"
                                         viewBox="0 0 24 24">
                                        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.43"
                                              stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                                        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.33-1.33"
                                              stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                                    </svg>
                                    <input
                                        class="grow"
                                        id="toyhouse-username"
                                        name="toyhouseUsername"
                                        pattern="[A-Za-z0-9_-]+"
                                        placeholder="razeth"
                                        required
                                        title="Use only the Toyhou.se username from your profile URL."
                                        type="text"
                                        value={normalizedToyhouseUsername}
                                    />
                                </label>
                                <div class="label">
                                    <span
                                        class="label-text-alt">Use the username from https://toyhou.se/username.</span>
                                </div>
                            </fieldset>

                            <div class="mt-4 flex justify-end">
                                <button class="btn btn-primary" type="submit">Submit</button>
                            </div>
                        </form>
                    )}

                    {currentUser && (
                        <section class="rounded-box border border-base-300 bg-base-200 p-4">
                            <h2 class="text-xl font-bold">Verify Toyhou.se Ownership</h2>
                            <p class="mt-1 text-sm text-base-content/70">
                                Add this MyOC user ID anywhere in your Toyhou.se profile text before running the import.
                            </p>
                            <label class="input input-bordered mt-3 w-full">
                                <input class="grow font-mono text-sm" readonly type="text" value={currentUser.id}/>
                            </label>
                        </section>
                    )}

                    {toyhouseFolderUrl && (
                        <section class="rounded-box border border-base-300 bg-base-200 p-4">
                            <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <h2 class="text-xl font-bold">Ready to import</h2>
                                    <p class="mt-1 text-sm text-base-content/70">
                                        Save the import bookmarklet first, then MyOC will send you to Toyhou.se.
                                    </p>
                                </div>
                                <button class="btn btn-primary" data-toyhouse-import-start type="button">
                                    Start Import
                                </button>
                            </div>
                        </section>
                    )}

                    {migrationError && (
                        <div class="alert alert-error">
                            <span>{migrationError}</span>
                        </div>
                    )}

                    {receiveToyhouseImport && (
                        <section class="rounded-box border border-base-300 bg-base-200 p-4">
                            <h2 class="text-xl font-bold">Waiting for Toyhou.se</h2>
                            <p class="mt-1 text-sm font-semibold" data-toyhouse-import-receiver-status>
                                Keep this tab open. The bookmarklet will send your Toyhou.se import here automatically.
                            </p>
                            <p class="mt-1 text-sm text-base-content/70" data-toyhouse-import-receiver-detail>
                                Waiting for the bookmarklet to start.
                            </p>
                            <div class="mt-4 h-3 overflow-hidden rounded-full bg-base-300">
                                <div class="h-full w-[4%] rounded-full bg-primary transition-all"
                                     data-toyhouse-import-receiver-bar></div>
                            </div>
                            <ToyhouseImportReceiverScript/>
                        </section>
                    )}

                    {importResult && (
                        <section class="rounded-box border border-success/40 bg-success/10 p-4">
                            <h2 class="text-xl font-bold">Import complete</h2>
                            <p class="mt-1 text-sm text-base-content/70">
                                Created {importResult.createdCharacters} character{importResult.createdCharacters === 1 ? '' : 's'},
                                updated {importResult.updatedCharacters} existing
                                character{importResult.updatedCharacters === 1 ? '' : 's'},
                                and
                                imported {importResult.importedImages} image{importResult.importedImages === 1 ? '' : 's'}.
                                {importResult.skippedImages > 0 ? ` ${importResult.skippedImages} image${importResult.skippedImages === 1 ? '' : 's'} could not be imported.` : ''}
                            </p>
                            <div class="mt-4 flex justify-end">
                                <a class="btn btn-primary" href="/characters">View Characters</a>
                            </div>
                        </section>
                    )}

                    {clientImportPlan && currentUser && (
                        <ToyhouseClientImportRunner csrfToken={currentUser.csrfToken} importPlan={clientImportPlan}/>
                    )}

                    {migrationResult && (
                        <section class="space-y-4">
                            <div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                                <div>
                                    <h2 class="text-2xl font-bold">Review Characters for Import</h2>
                                    <p class="text-sm text-base-content/70">
                                        Found {migrationResult.characters.length} characters
                                        across {migrationResult.pagesFetched} page{migrationResult.pagesFetched === 1 ? '' : 's'}.
                                    </p>
                                </div>
                                <a class="link link-primary text-sm" href={migrationResult.folderUrl}>View on
                                    Toyhou.se</a>
                            </div>

                            {migrationResult.characters.length > 0 ? (
                                <ToyhouseImportReviewForm migrationResult={migrationResult}/>
                            ) : (
                                <div
                                    class="rounded-box border border-base-300 bg-base-200 p-4 text-sm text-base-content/70">
                                    No public characters were found for this profile.
                                </div>
                            )}
                        </section>
                    )}
                </section>
            </main>

            {toyhouseFolderUrl && (
                <ToyhouseImportDialog
                    bookmarkletUrl={createToyhouseBookmarklet(siteUrl, currentUser?.id ?? '')}
                    toyhouseFolderUrl={toyhouseFolderUrl}
                />
            )}
        </BaseLayout>
    )
}

function safeScriptJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}

function getToyhouseUsername(value: string): string {
    const username = value.trim()

    return /^[A-Za-z0-9_-]+$/.test(username) ? username : ''
}

function ToyhouseClientImportRunner({
                                        csrfToken,
                                        importPlan,
                                    }: {
    csrfToken: string
    importPlan: ToyhouseClientImportPlan
}) {
    return (
        <section class="rounded-box border border-base-300 bg-base-200 p-4" data-toyhouse-client-import>
            <h2 class="text-xl font-bold">Uploading Toyhou.se Images</h2>
            <p class="mt-1 text-sm font-semibold" data-toyhouse-client-import-status>
                Preparing chunked uploads...
            </p>
            <p class="mt-1 text-sm text-base-content/70" data-toyhouse-client-import-detail>
                Keep this page open. MyOC will upload each image in chunks and retry temporary failures.
            </p>
            <div class="mt-4 h-3 overflow-hidden rounded-full bg-base-300">
                <div class="h-full w-[4%] rounded-full bg-primary transition-all"
                     data-toyhouse-client-import-bar></div>
            </div>
            <div class="mt-4 hidden rounded border border-success/30 bg-success/10 p-3 text-sm text-success"
                 data-toyhouse-client-import-complete>
                Import complete.
            </div>
            <ToyhouseClientImportScript csrfToken={csrfToken} importPlan={importPlan}/>
        </section>
    )
}

function ToyhouseClientImportScript({
                                        csrfToken,
                                        importPlan,
                                    }: {
    csrfToken: string
    importPlan: ToyhouseClientImportPlan
}) {
    const script = `
(function () {
    const root = document.querySelector('[data-toyhouse-client-import]');
    if (!root) return;

    const csrfToken = ${safeScriptJson(csrfToken)};
    const importPlan = ${safeScriptJson(importPlan)};
    const status = root.querySelector('[data-toyhouse-client-import-status]');
    const detail = root.querySelector('[data-toyhouse-client-import-detail]');
    const bar = root.querySelector('[data-toyhouse-client-import-bar]');
    const complete = root.querySelector('[data-toyhouse-client-import-complete]');
    const maxAttempts = 4;

    function setProgress(message, detailMessage, completedImages, totalImages) {
        if (status) status.textContent = message;
        if (detail) detail.textContent = detailMessage || '';
        if (bar) {
            const percent = totalImages > 0 ? Math.round((completedImages / totalImages) * 100) : 4;
            bar.style.width = Math.max(4, Math.min(100, percent)) + '%';
        }
    }

    function sleep(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
    }

    async function withRetry(label, task) {
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            try {
                return await task(attempt);
            } catch (error) {
                lastError = error;
                if (error && error.retryable === false) break;
                if (attempt >= maxAttempts) break;
                setProgress(label + ' failed, retrying ' + attempt + ' of ' + (maxAttempts - 1), error && error.message ? error.message : String(error), completedImages, importPlan.totalImages);
                await sleep(600 * attempt * attempt);
            }
        }
        throw lastError || new Error(label + ' failed.');
    }

    async function apiFetch(url, options) {
        const response = await fetch(url, {
            ...options,
            headers: {
                ...(options && options.headers ? options.headers : {}),
                'x-csrf-token': csrfToken
            }
        });
        if (!response.ok) {
            let message = 'Request failed';
            try {
                const body = await response.json();
                message = body.error || message;
            } catch {}
            const error = new Error(message);
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
        }
        if (response.status === 204) return null;
        return await response.json();
    }

    function contentTypeFromUrl(url) {
        const pathname = new URL(url).pathname.toLowerCase();
        if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
        if (pathname.endsWith('.gif')) return 'image/gif';
        if (pathname.endsWith('.webp')) return 'image/webp';
        if (pathname.endsWith('.avif')) return 'image/avif';
        return 'image/png';
    }

    function normalizeImageContentType(value, url) {
        const raw = (value || '').split(';')[0].trim().toLowerCase();
        if (raw === 'png' || raw === 'png32') return 'image/png';
        if (raw === 'jpg' || raw === 'jpeg' || raw === 'image/jpg' || raw === 'image/pjpeg') return 'image/jpeg';
        if (['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'].includes(raw)) return raw;
        return contentTypeFromUrl(url);
    }

    function proxiedToyhouseImageUrl(url) {
        return '/migrate/toyhouse-image?url=' + encodeURIComponent(url);
    }

    async function fetchToyhouseImage(url) {
        const response = await withRetry('Downloading Toyhou.se image', async () => {
            const result = await fetch(proxiedToyhouseImageUrl(url), {credentials: 'same-origin'});
            if (!result.ok) {
                const error = new Error('Toyhou.se returned ' + result.status + ' for ' + url);
                error.retryable = result.status === 429 || result.status >= 500;
                throw error;
            }
            return result;
        });
        const contentType = normalizeImageContentType(response.headers.get('content-type'), url);
        const blob = await response.blob();
        if (blob.size <= 0) throw new Error('Toyhou.se image was empty: ' + url);
        let bitmap;
        try {
            bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'default' });
            return {
                blob,
                contentType,
                height: bitmap.height,
                width: bitmap.width,
                preview: await createGalleryPreviewImage(bitmap)
            };
        } finally {
            if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        }
    }

    async function createGalleryPreviewImage(bitmap) {
        const maxLongEdge = 1600;
        const longEdge = Math.max(bitmap.width, bitmap.height);
        const scale = Math.min(1, maxLongEdge / longEdge);
        const width = Math.max(1, Math.round(bitmap.width * scale));
        const height = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not prepare image preview.');
        context.drawImage(bitmap, 0, 0, width, height);
        const blob = await canvasToWebpBlob(canvas);
        return {
            data: await blobToBase64(blob),
            contentType: 'image/webp',
            width,
            height
        };
    }

    function canvasToWebpBlob(canvas) {
        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(blob);
                    return;
                }
                reject(new Error('Could not prepare image preview.'));
            }, 'image/webp', 0.9);
        });
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = String(reader.result || '');
                resolve(result.includes(',') ? result.split(',')[1] : result);
            };
            reader.onerror = () => reject(new Error('Could not prepare image preview.'));
            reader.readAsDataURL(blob);
        });
    }

    async function uploadChunk(characterId, mediaId, rating, upload, image, partNumber, chunk) {
        return await withRetry('Uploading chunk ' + partNumber, async () => await apiFetch(
            '/api/characters/' + encodeURIComponent(characterId)
            + '/media/chunked/' + encodeURIComponent(mediaId)
            + '/' + encodeURIComponent(rating)
            + '/' + encodeURIComponent(upload.uploadId)
            + '/' + encodeURIComponent(String(partNumber))
            + '?imageKey=' + encodeURIComponent(upload.imageKey)
            + '&contentType=' + encodeURIComponent(image.contentType),
            {
                method: 'PUT',
                body: chunk
            }
        ));
    }

    async function uploadChunkedImage(characterPlan, imagePlan) {
        if (imagePlan.status === 'imported' && imagePlan.mediaId) {
            return imagePlan.mediaId;
        }

        const image = await fetchToyhouseImage(imagePlan.fullsizeUrl);
        const rating = imagePlan.rating;
        let initResult = null;
        let upload = null;

        try {
            initResult = await withRetry('Starting chunked upload', async () => await apiFetch('/api/characters/' + encodeURIComponent(characterPlan.myocCharacterId) + '/media/chunked/init', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({uploads: [{rating, contentType: image.contentType}]})
            }));
            upload = initResult.uploads[rating];
            if (!upload) throw new Error('Upload could not be initialized.');

            const chunkSize = upload.chunkSize || (8 * 1024 * 1024);
            const parts = [];
            let partNumber = 1;
            for (let offset = 0; offset < image.blob.size; offset += chunkSize) {
                const chunk = image.blob.slice(offset, Math.min(offset + chunkSize, image.blob.size), image.contentType);
                parts.push(await uploadChunk(characterPlan.myocCharacterId, initResult.mediaId, rating, upload, image, partNumber, chunk));
                partNumber += 1;
            }

            const completeBody = {
                mediaId: initResult.mediaId,
                sfwArtist: '',
                nsfwArtist: ''
            };
            completeBody[rating + 'Upload'] = {
                uploadId: upload.uploadId,
                imageKey: upload.imageKey,
                contentType: image.contentType,
                width: image.width,
                height: image.height,
                parts
            };
            completeBody[rating + 'Preview'] = image.preview;

            const completed = await withRetry('Completing media upload', async () => await apiFetch('/api/characters/toyhouse-import-items/' + encodeURIComponent(imagePlan.importItemId) + '/complete', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify(completeBody)
            }));

            return completed.media.id;
        } catch (error) {
            if (initResult && upload) {
                await abortChunkedUpload(characterPlan.myocCharacterId, initResult.mediaId, rating, upload, image);
            }
            await markImportItemFailed(imagePlan.importItemId, error);
            throw error;
        }
    }

    async function markImportItemFailed(importItemId, error) {
        try {
            await apiFetch('/api/characters/toyhouse-import-items/' + encodeURIComponent(importItemId) + '/fail', {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: JSON.stringify({error: error && error.message ? error.message : String(error)})
            });
        } catch {}
    }

    async function abortChunkedUpload(characterId, mediaId, rating, upload, image) {
        try {
            await apiFetch(
                '/api/characters/' + encodeURIComponent(characterId)
                + '/media/chunked/' + encodeURIComponent(mediaId)
                + '/' + encodeURIComponent(rating)
                + '/' + encodeURIComponent(upload.uploadId)
                + '?imageKey=' + encodeURIComponent(upload.imageKey)
                + '&contentType=' + encodeURIComponent(image.contentType),
                {method: 'DELETE'}
            );
        } catch {}
    }

    function createRows(mediaIds) {
        const rows = [];
        for (let index = 0; index < mediaIds.length; index += 3) {
            rows.push({
                id: crypto.randomUUID(),
                mediaIds: mediaIds.slice(index, index + 3)
            });
        }
        return rows;
    }

    async function saveNewCharacterGallery(characterPlan, mediaIds) {
        if (characterPlan.importMode !== 'create' || mediaIds.length === 0) return;
        await withRetry('Saving gallery rows', async () => await apiFetch('/api/characters/' + encodeURIComponent(characterPlan.myocCharacterId) + '/gallery', {
            method: 'PUT',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify({
                fullsizeLastRow: false,
                tabs: [{
                    id: crypto.randomUUID(),
                    name: 'default',
                    rows: createRows(mediaIds)
                }]
            })
        }));
    }

    let completedImages = importPlan.characters.reduce((total, characterPlan) => total + characterPlan.images.filter((imagePlan) => imagePlan.status === 'imported').length, 0);

    async function runImport() {
        try {
            for (const characterPlan of importPlan.characters) {
                const mediaIds = [];
                for (const imagePlan of characterPlan.images) {
                    setProgress('Uploading ' + characterPlan.name, imagePlan.fullsizeUrl, completedImages, importPlan.totalImages);
                    mediaIds.push(await uploadChunkedImage(characterPlan, imagePlan));
                    completedImages += 1;
                    setProgress('Uploaded ' + completedImages + ' of ' + importPlan.totalImages + ' images', characterPlan.name, completedImages, importPlan.totalImages);
                }
                await saveNewCharacterGallery(characterPlan, mediaIds);
            }

            setProgress('Import complete', 'Created ' + importPlan.createdCharacters + ' character' + (importPlan.createdCharacters === 1 ? '' : 's') + ', updated ' + importPlan.updatedCharacters + ' existing character' + (importPlan.updatedCharacters === 1 ? '' : 's') + ', imported ' + importPlan.totalImages + ' image' + (importPlan.totalImages === 1 ? '' : 's') + '.', importPlan.totalImages, importPlan.totalImages);
            if (complete) {
                complete.textContent = 'Import complete. Created ' + importPlan.createdCharacters + ' character' + (importPlan.createdCharacters === 1 ? '' : 's') + ', updated ' + importPlan.updatedCharacters + ' existing character' + (importPlan.updatedCharacters === 1 ? '' : 's') + ', imported ' + importPlan.totalImages + ' image' + (importPlan.totalImages === 1 ? '' : 's') + '.';
                complete.classList.remove('hidden');
            }
        } catch (error) {
            setProgress('Import failed', error && error.message ? error.message : String(error), completedImages, importPlan.totalImages);
        }
    }

    runImport();
})();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

function ToyhouseImportReviewForm({migrationResult}: { migrationResult: ToyhouseMigrationResult }) {
    const readyCount = migrationResult.characters.filter((character) => character.canImport !== false).length
    const blockedCount = migrationResult.characters.length - readyCount

    return (
        <>
            <form action="/migrate/import/confirm" class="space-y-4" data-toyhouse-import-review method="post">
                <textarea class="hidden" name="toyhousePayload">{JSON.stringify(migrationResult)}</textarea>
                <div class="rounded-box border border-base-300 bg-base-200 p-4">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p class="font-semibold">
                            {readyCount} ready to import, {blockedCount} blocked
                        </p>
                        <button class="btn btn-primary" data-toyhouse-final-import-button disabled={readyCount === 0}
                                type="submit">Import Selected
                        </button>
                    </div>
                    <div class="mt-3 hidden rounded border border-base-300 bg-base-100 p-3"
                         data-toyhouse-final-import-progress>
                        <p class="text-sm font-semibold" data-toyhouse-final-import-status>
                            Preparing import...
                        </p>
                        <p class="mt-1 text-xs text-base-content/60" data-toyhouse-final-import-detail>
                            Keep this page open while MyOC imports your images.
                        </p>
                        <div class="mt-3 h-3 overflow-hidden rounded-full bg-base-300">
                            <div class="h-full w-[4%] rounded-full bg-primary transition-all"
                                 data-toyhouse-final-import-bar></div>
                        </div>
                    </div>
                </div>

                <div class="overflow-hidden rounded-box border border-base-300">
                    <ul class="divide-y divide-base-300">
                        {migrationResult.characters.map((character) => {
                            const canImport = character.canImport !== false
                            const importIssues = character.importIssues ?? []

                            return (
                                <li class={`bg-base-200 p-3 ${canImport ? '' : 'opacity-75'}`} key={character.id}>
                                    <div class="flex items-start gap-3">
                                        <input
                                            aria-label={`Import ${character.name}`}
                                            checked={canImport}
                                            class="checkbox checkbox-primary mt-4"
                                            disabled={!canImport}
                                            name="characterIds"
                                            type="checkbox"
                                            value={character.id}
                                        />
                                        {canImport && (
                                            <>
                                                <input name={`importMode:${character.id}`} type="hidden"
                                                       value={character.importMode ?? 'create'}/>
                                                {character.targetCharacterId && (
                                                    <input name={`targetCharacterId:${character.id}`} type="hidden"
                                                           value={character.targetCharacterId}/>
                                                )}
                                            </>
                                        )}
                                        {character.thumbnailUrl ? (
                                            <img
                                                alt={`${character.name} thumbnail`}
                                                class="h-14 w-14 shrink-0 rounded object-cover"
                                                loading="lazy"
                                                src={character.thumbnailUrl}
                                            />
                                        ) : (
                                            <div
                                                class="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-base-300 text-xl font-bold">
                                                {character.name.charAt(0).toUpperCase()}
                                            </div>
                                        )}
                                        <div class="min-w-0 flex-1">
                                            <div
                                                class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                                <a class="font-semibold link-hover"
                                                   href={character.url}>{character.name}</a>
                                                {canImport && character.importMode === 'existing' ? (
                                                    <span class="badge badge-info">Add images to existing</span>
                                                ) : canImport ? (
                                                    <span class="badge badge-success">Create new character</span>
                                                ) : !canImport && (
                                                    <span class="badge badge-warning">Blocked</span>
                                                )}
                                            </div>
                                            <p class="text-sm text-base-content/60">
                                                {character.images.length} image{character.images.length === 1 ? '' : 's'} found
                                                {character.imageCount === null ? '' : ` (${character.imageCount} listed)`}
                                            </p>
                                            {canImport && character.importMode === 'existing' ? (
                                                <p class="mt-1 text-sm text-info">
                                                    A character named {character.name} already exists. Selected images
                                                    will be added to that character.
                                                </p>
                                            ) : canImport && (
                                                <p class="mt-1 text-sm text-success">
                                                    A new character named {character.name} will be created with the
                                                    selected images.
                                                </p>
                                            )}
                                            {importIssues.length > 0 && (
                                                <ul class="mt-2 space-y-1 text-sm text-warning">
                                                    {importIssues.map((issue) => (
                                                        <li key={issue}>{issue}</li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    </div>

                                    {character.images.length > 0 && (
                                        <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                                            {character.images.map((image, index) => {
                                                const imageInputId = `toyhouse-image-${character.id}-${index}`
                                                const nsfwInputId = `toyhouse-image-nsfw-${character.id}-${index}`

                                                return (
                                                    <div
                                                        class="overflow-hidden rounded border border-base-300 bg-base-100"
                                                        data-toyhouse-image-card key={image.fullsizeUrl}>
                                                    <span class="block">
                                                        <img
                                                            alt={`${character.name} gallery image`}
                                                            class="aspect-square w-full object-contain"
                                                            loading="lazy"
                                                            src={image.fullsizeUrl}
                                                        />
                                                    </span>
                                                        <span class="block space-y-2 p-2">
                                                        <span class="flex items-center gap-2 text-sm">
                                                            <input
                                                                checked={canImport}
                                                                class="checkbox checkbox-sm checkbox-primary"
                                                                data-toyhouse-image-select={character.id}
                                                                disabled={!canImport}
                                                                id={imageInputId}
                                                                name={`imageUrls:${character.id}`}
                                                                type="checkbox"
                                                                value={image.fullsizeUrl}
                                                            />
                                                            <label for={imageInputId}>Import image</label>
                                                        </span>
                                                        <span class="flex items-center gap-2 text-sm">
                                                            <input
                                                                class="checkbox checkbox-sm checkbox-error"
                                                                data-toyhouse-image-nsfw={character.id}
                                                                disabled={!canImport}
                                                                id={nsfwInputId}
                                                                name={`nsfwImageUrls:${character.id}`}
                                                                type="checkbox"
                                                                value={image.fullsizeUrl}
                                                            />
                                                            <label for={nsfwInputId}>NSFW</label>
                                                        </span>
                                                    </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </li>
                            )
                        })}
                    </ul>
                </div>
            </form>
            <ToyhouseImportReviewScript/>
        </>
    )
}

function ToyhouseImportReviewScript() {
    const script = `
(function () {
    const form = document.querySelector('[data-toyhouse-import-review]');
    if (!form) return;
    const progressPanel = form.querySelector('[data-toyhouse-final-import-progress]');
    const status = form.querySelector('[data-toyhouse-final-import-status]');
    const detail = form.querySelector('[data-toyhouse-final-import-detail]');
    const bar = form.querySelector('[data-toyhouse-final-import-bar]');
    const submitButton = form.querySelector('[data-toyhouse-final-import-button]');
    const payloadField = form.querySelector('textarea[name="toyhousePayload"]');
    const payload = payloadField ? JSON.parse(payloadField.value) : {characters: []};
    const characters = new Map((payload.characters || []).map((character) => [character.id, character]));

    function syncImageNsfw(select) {
        const card = select.closest('[data-toyhouse-image-card]');
        const nsfw = card ? card.querySelector('[data-toyhouse-image-nsfw]') : null;
        if (!nsfw) return;
        nsfw.disabled = select.disabled || !select.checked;
        if (nsfw.disabled) {
            nsfw.checked = false;
        }
    }

    for (const select of form.querySelectorAll('[data-toyhouse-image-select]')) {
        syncImageNsfw(select);
        select.addEventListener('change', () => syncImageNsfw(select));
    }

    function setProgress(message, detailMessage, percent, indeterminate) {
        if (progressPanel) {
            progressPanel.classList.remove('hidden');
        }
        if (status) {
            status.textContent = message;
        }
        if (detail) {
            detail.textContent = detailMessage || '';
        }
        if (bar) {
            bar.style.width = Math.max(4, Math.min(100, percent || 4)) + '%';
            bar.classList.toggle('animate-pulse', Boolean(indeterminate));
        }
    }

    function nextFrame() {
        return new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    function imageToBitmap(blob) {
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(blob);
        }

        return new Promise((resolve, reject) => {
            const image = new Image();
            const url = URL.createObjectURL(blob);
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Could not read profile image.'));
            };
            image.src = url;
        });
    }

    function proxiedToyhouseImageUrl(url) {
        return '/migrate/toyhouse-image?url=' + encodeURIComponent(url);
    }

    async function createProfileImageDataUrl(url) {
        const response = await fetch(proxiedToyhouseImageUrl(url), {credentials: 'same-origin'});
        if (!response.ok) {
            throw new Error('Toyhou.se returned ' + response.status + ' for a profile image.');
        }

        const bitmap = await imageToBitmap(await response.blob());
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Canvas unavailable.');
        }

        const sourceWidth = bitmap.width;
        const sourceHeight = bitmap.height;
        const sourceSize = Math.min(sourceWidth, sourceHeight);
        const sourceX = Math.max(0, Math.floor((sourceWidth - sourceSize) / 2));
        const sourceY = Math.max(0, Math.floor((sourceHeight - sourceSize) / 2));
        context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, 512, 512);
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }

        return canvas.toDataURL('image/webp', 0.9);
    }

    function setHidden(name, value) {
        let input = form.querySelector('input[name="' + CSS.escape(name) + '"]');
        if (!input) {
            input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            form.append(input);
        }
        input.value = value;
    }

    form.addEventListener('submit', async (event) => {
        if (form.dataset.toyhouseProfilesReady === 'true') {
            return;
        }

        event.preventDefault();
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Importing...';
        }

        try {
            const selectedIds = [...form.querySelectorAll('input[name="characterIds"]:checked')].map((input) => input.value);
            const selectedImageCount = [...form.querySelectorAll('[data-toyhouse-image-select]:checked')].length;
            const createIds = selectedIds.filter((characterId) => {
                const mode = form.querySelector('input[name="importMode:' + CSS.escape(characterId) + '"]')?.value;
                return mode === 'create';
            });

            setProgress(
                'Preparing import',
                'Selected ' + selectedIds.length + ' character' + (selectedIds.length === 1 ? '' : 's') + ' and ' + selectedImageCount + ' image' + (selectedImageCount === 1 ? '' : 's') + '.',
                8,
                false
            );

            for (let index = 0; index < createIds.length; index += 1) {
                const characterId = createIds[index];
                const mode = form.querySelector('input[name="importMode:' + CSS.escape(characterId) + '"]')?.value;
                if (mode !== 'create') continue;

                const character = characters.get(characterId);
                if (!character || !character.thumbnailUrl) {
                    throw new Error('Missing Toyhou.se profile image for ' + (character ? character.name : characterId) + '.');
                }

                setProgress(
                    'Preparing profile image ' + (index + 1) + ' of ' + createIds.length,
                    character.name,
                    10 + Math.round(((index + 1) / Math.max(1, createIds.length)) * 35),
                    false
                );
                setHidden('profileImageDataUrl:' + characterId, await createProfileImageDataUrl(character.thumbnailUrl));
            }

            setProgress(
                'MyOC is importing your images',
                'The server is downloading Toyhou.se images, uploading them to MyOC storage, and saving the character data. This can take a while for large imports.',
                75,
                true
            );
            form.dataset.toyhouseProfilesReady = 'true';
            await nextFrame();
            form.submit();
        } catch (error) {
            setProgress('Import failed', error && error.message ? error.message : String(error), 100, false);
            if (submitButton) {
                submitButton.disabled = false;
                submitButton.textContent = 'Import Selected';
            }
        }
    });
})();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

function ToyhouseImportReceiverScript() {
    const script = `
(function () {
    const status = document.querySelector('[data-toyhouse-import-receiver-status]');
    const detail = document.querySelector('[data-toyhouse-import-receiver-detail]');
    const bar = document.querySelector('[data-toyhouse-import-receiver-bar]');

    function setProgress(message, detailMessage, percent) {
        if (status) {
            status.textContent = message;
        }
        if (detail) {
            detail.textContent = detailMessage || '';
        }
        if (bar && Number.isFinite(percent)) {
            bar.style.width = Math.max(4, Math.min(100, percent)) + '%';
        }
    }

    window.addEventListener('message', (event) => {
        if (!['https://toyhou.se', 'https://www.toyhou.se'].includes(event.origin)) {
            return;
        }

        const data = event.data || {};
        if (data.type === 'myoc:toyhouse-progress') {
            setProgress(String(data.status || 'Import running'), String(data.detail || ''), Number(data.percent));
            return;
        }

        if (data.type !== 'myoc:toyhouse-import' || typeof data.payload !== 'string') {
            return;
        }

        setProgress('Import received', 'Preparing review page...', 100);
        if (event.source && typeof event.source.postMessage === 'function') {
            event.source.postMessage({type: 'myoc:toyhouse-import-received'}, event.origin);
        }

        const form = document.createElement('form');
        form.method = 'post';
        form.action = '/migrate/import';

        const input = document.createElement('textarea');
        input.name = 'toyhousePayload';
        input.value = data.payload;
        form.append(input);

        document.body.append(form);
        form.submit();
    });
})();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

function getToyhouseFolderUrl(username: string): string {
    return username ? `https://toyhou.se/${encodeURIComponent(username)}/characters/folder:all` : ''
}

function createToyhouseBookmarklet(siteUrl: string, expectedMyocUserId: string): string {
    const targetUrl = `${siteUrl.replace(/\/+$/, '')}/migrate/import`
    const script = `
(async () => {
    const target = ${JSON.stringify(targetUrl)};
    const targetOrigin = new URL(target).origin;
    const expectedMyocUserId = ${JSON.stringify(expectedMyocUserId)};
    const maxGalleryPages = 200;
    let importDelivered = false;
    let receiverWindow = null;
    let statusEl, detailEl, barEl, closeButton;

    function bindProgress(modal) {
        statusEl = modal.querySelector('[data-myoc-status]');
        detailEl = modal.querySelector('[data-myoc-detail]');
        barEl = modal.querySelector('[data-myoc-bar]');
        closeButton = modal.querySelector('[data-myoc-close]');
        if (closeButton && !closeButton.dataset.myocBound) {
            closeButton.dataset.myocBound = 'true';
            closeButton.addEventListener('click', () => modal.remove());
        }
    }

    function closeSetupDialog() {
        const setupDialog = document.querySelector('[data-toyhouse-import-dialog][open]');
        if (!setupDialog) return;

        if (typeof setupDialog.close === 'function') {
            setupDialog.close();
        } else {
            setupDialog.removeAttribute('open');
        }
    }

    function ensureProgress() {
        closeSetupDialog();
        let modal = document.getElementById('myoc-migration-progress');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'myoc-migration-progress';
            modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px;font-family:system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#f8fafc';
            modal.innerHTML = '<div style="width:min(460px,100%);border:1px solid rgba(255,255,255,.18);border-radius:10px;background:#111827;box-shadow:0 24px 80px rgba(0,0,0,.45);padding:20px"><div style="font-size:18px;font-weight:700">MyOC Toyhou.se import</div><div data-myoc-status style="margin-top:12px;font-size:14px;font-weight:650">Starting...</div><div data-myoc-detail style="margin-top:4px;font-size:13px;color:#cbd5e1;line-height:1.35">Preparing import.</div><div style="height:10px;background:#334155;border-radius:999px;overflow:hidden;margin-top:16px"><div data-myoc-bar style="height:100%;width:4%;background:#60a5fa;border-radius:999px;transition:width .2s ease"></div></div><button data-myoc-close type="button" style="display:none;margin-top:16px;border:0;border-radius:6px;background:#e5e7eb;color:#111827;padding:8px 12px;font-weight:650;cursor:pointer">Close</button></div>';
            document.body.append(modal);
        }
        bindProgress(modal);
        return modal;
    }

    function progress(status, detail, percent) {
        ensureProgress();
        if (statusEl) statusEl.textContent = status;
        if (detailEl) detailEl.textContent = detail || '';
        if (barEl && Number.isFinite(percent)) barEl.style.width = Math.max(4, Math.min(100, percent)) + '%';
        sendProgressToReceiver(status, detail, percent);
    }

    function fail(error) {
        const message = error && error.message ? error.message : String(error);
        if (receiverWindow && !receiverWindow.closed) {
            receiverWindow.close();
        }
        progress('Import failed', message, 100);
        if (closeButton) closeButton.style.display = 'inline-flex';
    }

    function openReceiver() {
        if (receiverWindow && !receiverWindow.closed) {
            return receiverWindow;
        }

        receiverWindow = window.open(target, 'myoc-toyhouse-import');
        if (!receiverWindow) {
            throw new Error('MyOC could not open the import tab. Allow popups for Toyhou.se, then run the bookmarklet again.');
        }

        return receiverWindow;
    }

    function sendProgressToReceiver(status, detail, percent) {
        if (!receiverWindow || receiverWindow.closed) {
            return;
        }

        receiverWindow.postMessage({
            type: 'myoc:toyhouse-progress',
            status,
            detail: detail || '',
            percent: Number.isFinite(percent) ? percent : null,
        }, targetOrigin);
    }

    function closeToyhouseTab() {
        progress('Sent to MyOC', 'Import data was sent. Closing this Toyhou.se tab.', 100);
        window.setTimeout(() => window.close(), 200);
    }

    function sendToMyoc(payload) {
        const receiver = openReceiver();
        let attempts = 0;
        progress('Sending to MyOC', 'Sending import data to the MyOC import tab.', 98);

        const send = () => {
            if (importDelivered) {
                return;
            }

            if (receiver.closed) {
                fail(new Error('The MyOC import tab was closed before the import data could be sent.'));
                return;
            }

            receiver.postMessage({type: 'myoc:toyhouse-import', payload}, targetOrigin);
            attempts += 1;

            if (attempts < 40) {
                window.setTimeout(send, 250);
            } else {
                progress('Sent to MyOC', 'Check the MyOC import tab to review your characters.', 100);
                if (closeButton) closeButton.style.display = 'inline-flex';
            }
        };

        send();
    }

    window.addEventListener('message', (event) => {
        if (event.origin !== targetOrigin) {
            return;
        }

        const data = event.data || {};
        if (data.type !== 'myoc:toyhouse-import-received') {
            return;
        }

        importDelivered = true;
        closeToyhouseTab();
    });

    function username() {
        if (!/^(www\\.)?toyhou\\.se$/i.test(location.hostname)) {
            throw new Error('Drag the Import to MyOC button to your bookmarks bar, open the Toyhou.se character page, then run it from there.');
        }

        const value = location.pathname.split('/').filter(Boolean)[0] || '';
        if (!/^[A-Za-z0-9_-]+$/.test(decodeURIComponent(value))) {
            throw new Error('Open a Toyhou.se profile or character folder first.');
        }

        return decodeURIComponent(value);
    }

    function absolute(value) {
        return new URL(value, location.origin).toString();
    }

    function normalizedUrl(value) {
        const url = new URL(value, location.origin);
        url.hash = '';
        return url.toString();
    }

    function pageCount(doc) {
        const values = [1, ...Array.from(doc.querySelectorAll('.characters-gallery-pagination a[href*="page="], .pagination a[href*="page="]'))
            .map((link) => Number(new URL(link.href, location.origin).searchParams.get('page')) || 1)];
        return Math.max(...values);
    }

    function characterCards(doc) {
        return Array.from(doc.querySelectorAll('.character-name-badge')).map((link) => {
            const href = link.getAttribute('href') || '';
            const url = absolute(href);
            const id = (url.match(/toyhou\\.se\\/(\\d+)(?:[.\\/-]|$)/) || [])[1] || '';
            const caption = link.closest('.thumb-caption');
            const item = caption ? caption.parentElement : null;
            const image = item ? item.querySelector('.thumb-image img') : null;
            const images = item ? item.querySelector('.thumb-character-stat.images') : null;
            const countText = images ? images.textContent || '' : '';
            const imageCount = Number((countText.match(/\\d+/) || [])[0]);

            return {
                id,
                images: [],
                imageCount: Number.isFinite(imageCount) ? imageCount : null,
                name: (link.textContent || '').trim(),
                thumbnailUrl: image ? absolute(image.getAttribute('src') || '') : null,
                url,
            };
        }).filter((item) => item.id && item.name);
    }

    async function acceptWarning(doc, url) {
        const warningForm = doc.querySelector('form[action*="/~account/warnings/accept"]');
        if (!warningForm && !doc.querySelector('.content-warning')) return false;
        if (!warningForm) throw new Error('Toyhou.se showed a content warning for ' + url + ', but no accept form was found.');

        const body = new URLSearchParams();
        for (const input of warningForm.querySelectorAll('input[name]')) {
            body.set(input.name, input.value || '');
        }

        progress('Accepting warning', 'Accepting Toyhou.se content warning.', 18);
        const response = await fetch(absolute(warningForm.getAttribute('action') || '/~account/warnings/accept'), {
            method: 'POST',
            credentials: 'include',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body,
        });

        if (!response.ok) throw new Error('Toyhou.se returned ' + response.status + ' while accepting a content warning.');
        return true;
    }

    async function getDocument(url, attempt = 0) {
        const response = await fetch(url, {credentials: 'include'});
        if (!response.ok) throw new Error('Toyhou.se returned ' + response.status + ' for ' + url);

        const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
        if (attempt < 2 && await acceptWarning(doc, url)) {
            return getDocument(url, attempt + 1);
        }

        return doc;
    }

    async function verifyProfileOwner(owner) {
        if (!expectedMyocUserId) {
            throw new Error('MyOC user ID was missing from the bookmarklet. Create a fresh bookmarklet while signed in.');
        }

        progress('Verifying profile', 'Checking Toyhou.se profile for your MyOC user ID.', 20);
        const profileUrl = location.origin + '/' + encodeURIComponent(owner);
        const doc = await getDocument(profileUrl);
        const profileContent = doc.querySelector('.profile-section.profile-content-section.user-content.fr-view');

        if (!profileContent) {
            throw new Error('Could not find the Toyhou.se profile text section. Add your MyOC user ID to your public profile text and try again.');
        }

        if (!(profileContent.textContent || '').includes(expectedMyocUserId)) {
            throw new Error('Verification failed: MyOC user ID was not found on this Toyhou.se profile. Add this user ID to your Toyhou.se profile text, save it, then run the import again: ' + expectedMyocUserId);
        }

        return profileUrl;
    }

    function isLikelyImageUrl(value) {
        try {
            const url = new URL(value, location.origin);
            return /\\.(png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.test(url.pathname)
                || url.hostname.endsWith('toyhou.se') && url.pathname.includes('/file/');
        } catch {
            return false;
        }
    }

    function imageLinks(doc) {
        const images = new Map();
        for (const img of doc.querySelectorAll('#content a[href] img, .content-main a[href] img, .gallery a[href] img, .image-gallery a[href] img, a[href] img[src*="/thumbnails/"]')) {
            const link = img.closest('a[href]');
            if (!link) continue;

            const fullsizeUrl = absolute(link.getAttribute('href') || '');
            const thumbnailUrl = absolute(img.getAttribute('src') || '');
            if (!isLikelyImageUrl(fullsizeUrl) || !thumbnailUrl) continue;

            images.set(fullsizeUrl, {fullsizeUrl, thumbnailUrl});
        }

        return [...images.values()];
    }

    function discoverGalleryUrls(doc, basePath) {
        const urls = new Set();

        for (const link of doc.querySelectorAll('a[href*="/gallery"]')) {
            try {
                const href = normalizedUrl(link.getAttribute('href') || '');
                const url = new URL(href);
                if (url.origin === location.origin && url.pathname.replace(/\\/+$/, '').startsWith(basePath + '/gallery')) {
                    urls.add(href);
                }
            } catch {}
        }

        for (const link of doc.querySelectorAll('.sidebar-tab a[href]')) {
            try {
                const url = new URL(link.getAttribute('href') || '', location.origin);
                const path = url.pathname.replace(/\\/+$/, '');
                if (url.origin === location.origin && path.startsWith(basePath + '/') && !path.includes('/gallery')) {
                    url.pathname = path + '/gallery';
                    url.search = '';
                    url.hash = '';
                    urls.add(normalizedUrl(url.toString()));
                }
            } catch {}
        }

        return [...urls];
    }

    async function collectImages(character, index, total) {
        const characterUrl = new URL(character.url);
        const basePath = characterUrl.pathname.replace(/\\/+$/, '');
        const firstGallery = characterUrl.origin + basePath + '/gallery';
        const queue = [firstGallery];
        const visited = new Set();
        const byUrl = new Map();

        while (queue.length && visited.size < maxGalleryPages) {
            const url = normalizedUrl(queue.shift());
            if (visited.has(url)) continue;
            visited.add(url);

            progress('Loading galleries', 'Character ' + (index + 1) + ' of ' + total + ': ' + character.name + ' - gallery page ' + visited.size, 25 + (index / Math.max(total, 1)) * 65);
            const doc = await getDocument(url);

            for (const image of imageLinks(doc)) {
                byUrl.set(image.fullsizeUrl, image);
            }

            for (const next of discoverGalleryUrls(doc, basePath)) {
                if (!visited.has(next) && !queue.includes(next)) queue.push(next);
            }

            const pages = pageCount(doc);
            for (let page = 2; page <= pages; page++) {
                const pageUrl = new URL(url);
                pageUrl.searchParams.set('page', String(page));
                const normalized = normalizedUrl(pageUrl.toString());
                if (!visited.has(normalized) && !queue.includes(normalized)) queue.push(normalized);
            }
        }

        progress('Loading galleries', 'Found ' + byUrl.size + ' images for ' + character.name, 25 + ((index + 1) / Math.max(total, 1)) * 65);
        return [...byUrl.values()];
    }

    try {
        const owner = username();
        openReceiver();
        progress('Starting import', 'Reading Toyhou.se profile.', 4);
        const profileUrl = await verifyProfileOwner(owner);
        const folderUrl = location.origin + '/' + encodeURIComponent(owner) + '/characters/folder:all';

        progress('Loading characters', 'Opening all characters page.', 22);
        const firstDoc = location.href === folderUrl || location.href.startsWith(folderUrl + '?')
            ? document
            : await getDocument(folderUrl);

        if (await acceptWarning(firstDoc, folderUrl)) {
            location.reload();
            return;
        }

        const totalPages = pageCount(firstDoc);
        const byUrl = new Map(characterCards(firstDoc).map((item) => [item.url, item]));

        for (let page = 2; page <= totalPages; page++) {
            progress('Loading characters', 'Character page ' + page + ' of ' + totalPages + '.', 8 + (page / Math.max(totalPages, 1)) * 16);
            for (const item of characterCards(await getDocument(folderUrl + '?page=' + page))) {
                byUrl.set(item.url, item);
            }
        }

        const characters = [...byUrl.values()];
        progress('Loading galleries', 'Found ' + characters.length + ' characters. Loading gallery images.', 24);

        for (let index = 0; index < characters.length; index++) {
            characters[index].images = await collectImages(characters[index], index, characters.length);
        }

        const imageTotal = characters.reduce((sum, character) => sum + character.images.length, 0);
        progress('Sending to MyOC', 'Found ' + characters.length + ' characters and ' + imageTotal + ' images.', 96);

        const payload = JSON.stringify({myocUserId: expectedMyocUserId, profileUrl, folderUrl, pagesFetched: totalPages, characters});
        sendToMyoc(payload);
    } catch (error) {
        fail(error);
    }
})();
`

    return `javascript:${script.replace(/\s+/g, ' ').trim()}`
}

function ToyhouseImportDialog({
                                  bookmarkletUrl,
                                  toyhouseFolderUrl,
                              }: {
    bookmarkletUrl: string
    toyhouseFolderUrl: string
}) {
    return (
        <>
            <dialog class="modal" data-toyhouse-import-dialog>
                <div class="modal-box max-w-xl">
                    <h2 class="text-2xl font-bold">Save the import bookmarklet</h2>
                    <div class="mt-4 space-y-4 text-sm text-base-content/75">
                        <p>
                            Drag this button to your browser bookmarks bar.
                        </p>
                        <a class="btn btn-primary" href={bookmarkletUrl}>Import to MyOC</a>
                        <p>
                            After it is bookmarked, MyOC will open your Toyhou.se character page. Click the saved
                            bookmark while viewing Toyhou.se to send the character list back here.
                        </p>
                    </div>
                    <div class="modal-action">
                        <form method="dialog">
                            <button class="btn btn-ghost">Cancel</button>
                        </form>
                        <a class="btn btn-secondary" href={toyhouseFolderUrl}>I Bookmarked It</a>
                    </div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button>close</button>
                </form>
            </dialog>
            <ToyhouseImportDialogScript/>
        </>
    )
}

function ToyhouseImportDialogScript() {
    const script = `
(function () {
    const startButton = document.querySelector('[data-toyhouse-import-start]');
    const dialog = document.querySelector('[data-toyhouse-import-dialog]');

    if (!startButton || !dialog) {
        return;
    }

    startButton.addEventListener('click', () => {
        if (typeof dialog.showModal === 'function') {
            dialog.showModal();
        } else {
            dialog.setAttribute('open', '');
        }
    });
})();
`

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}
