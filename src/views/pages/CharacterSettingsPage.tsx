import type {CurrentUser} from '../../lib/auth/session'
import {GALLERY_MAX_IMAGES_PER_ROW} from '../../lib/gallery'
import {characterMediaImageUrl, characterMediaPreviewImageUrl, characterProfileImageUrl} from '../../lib/media/url'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import {PROFILE_CROPPER_BROWSER_HELPERS} from '../profileCropperScript'

export type CharacterSettingsCharacter = {
    id: string
    userId: string
    name: string
    profileImageKey: string
    description: string
    galleryFullsizeLastRow: boolean
}

export type CharacterSettingsMedia = {
    id: string
    sfwImageKey: string | null
    nsfwImageKey: string | null
    sfwPreviewImageKey: string | null
    nsfwPreviewImageKey: string | null
    nsfwBlurImageKey: string | null
    sfwContentType: string | null
    nsfwContentType: string | null
    sfwArtist: string
    nsfwArtist: string
    sfwWidth: number | null
    sfwHeight: number | null
    sfwPreviewWidth: number | null
    sfwPreviewHeight: number | null
    nsfwWidth: number | null
    nsfwHeight: number | null
    nsfwPreviewWidth: number | null
    nsfwPreviewHeight: number | null
}

export type CharacterSettingsGalleryTab = {
    id: string
    name: string
    rows: {
        id: string
        mediaIds: string[]
    }[]
}

type CharacterSettingsPageProps = {
    currentUser: CurrentUser
    character: CharacterSettingsCharacter
    media: CharacterSettingsMedia[]
    galleryTabs: CharacterSettingsGalleryTab[]
    mediaBaseUrl: string
}

const CHARACTER_NAME_INPUT_PATTERN = String.raw`(?=.*[A-Za-z0-9])[A-Za-z0-9 _'.\(\)"\-]+`
const CHARACTER_NAME_INPUT_TITLE = 'Use letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses. Include at least one letter or number.'

function safeJson(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
}

function mediaWithUrls(mediaBaseUrl: string, character: CharacterSettingsCharacter, media: CharacterSettingsMedia) {
    return {
        ...media,
        sfwImageUrl: media.sfwImageKey
            ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.sfwImageKey, 'sfw', media.sfwContentType)
            : null,
        sfwPreviewImageUrl: media.sfwPreviewImageKey
            ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.sfwPreviewImageKey, 'sfw')
            : null,
        nsfwImageUrl: media.nsfwImageKey
            ? characterMediaImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwImageKey, 'nsfw', media.nsfwContentType)
            : null,
        nsfwPreviewImageUrl: media.nsfwPreviewImageKey
            ? characterMediaPreviewImageUrl(mediaBaseUrl, character.userId, character.id, media.id, media.nsfwPreviewImageKey, 'nsfw')
            : null,
    }
}

function CharacterSettingsScript({
    character,
    media,
    galleryTabs,
    csrfToken,
}: {
    character: CharacterSettingsCharacter
    media: ReturnType<typeof mediaWithUrls>[]
    galleryTabs: CharacterSettingsGalleryTab[]
    csrfToken: string
}) {
    return (
        <script dangerouslySetInnerHTML={{
            __html: `
const character = ${safeJson(character)};
const csrfToken = ${safeJson(csrfToken)};
const maxGalleryImagesPerRow = ${safeJson(GALLERY_MAX_IMAGES_PER_ROW)};
const mediaLibrary = new Map(${safeJson(media)}.map((item) => [item.id, item]));
const tagLayouts = new Map(${safeJson(galleryTabs)}.map((tab) => [tab.id, tab]));
let activeTagId = ${safeJson(galleryTabs[0]?.id ?? 'default')};
${PROFILE_CROPPER_BROWSER_HELPERS}
let dragCandidate = null;
let dragState = null;
let pendingDeleteMediaId = null;

const mediaPool = document.getElementById('all-media-pool');
const mediaCount = document.getElementById('all-media-count');
const galleryTagTabs = document.getElementById('gallery-tag-tabs');
const galleryRows = document.getElementById('gallery-rows');
const activeGalleryTagTitle = document.getElementById('active-gallery-tag-title');
const activeGalleryTagMeta = document.getElementById('active-gallery-tag-meta');
const moveActiveTabLeftButton = document.getElementById('move-active-gallery-tab-left');
const moveActiveTabRightButton = document.getElementById('move-active-gallery-tab-right');
const renameActiveGalleryTabButton = document.getElementById('rename-active-gallery-tab');
const deleteActiveGalleryTabButton = document.getElementById('delete-active-gallery-tab');
const addGalleryRowButton = document.getElementById('add-gallery-row');
const saveCharacterSettingsButton = document.getElementById('save-character-settings');
const saveCharacterSettingsWarning = document.getElementById('save-character-settings-warning');
const settingsToastRegion = document.querySelector('[data-character-settings-toast-region]');
const characterSettingsForm = document.getElementById('character-settings-form');
const characterTitle = document.querySelector('[data-character-title]');
const characterProfileImageInput = document.getElementById('character-profile-photo');
const characterProfileImagePreview = document.querySelector('[data-character-profile-image-preview]');
const characterProfileCropper = document.querySelector('[data-character-profile-cropper]');
const characterProfileCropImage = document.querySelector('[data-character-profile-crop-image]');
const fullsizeLastRowInput = document.getElementById('fullsize-last-row');
const uploadMediaButton = document.getElementById('upload-media-button');
const bulkUploadButton = document.getElementById('bulk-upload-images');
const uploadImageModal = document.getElementById('upload-image-modal');
const uploadImageForm = document.getElementById('upload-image-form');
const uploadImageSfwFileInput = document.getElementById('gallery-image-sfw-file');
const uploadImageNsfwFileInput = document.getElementById('gallery-image-nsfw-file');
const uploadImageSfwArtistInput = document.getElementById('gallery-image-sfw-artist');
const uploadImageNsfwArtistInput = document.getElementById('gallery-image-nsfw-artist');
const uploadSfwPreview = document.querySelector('[data-upload-sfw-preview]');
const uploadNsfwPreview = document.querySelector('[data-upload-nsfw-preview]');
const bulkUploadModal = document.getElementById('bulk-upload-modal');
const bulkUploadForm = document.getElementById('bulk-upload-form');
const bulkUploadFileInput = document.getElementById('bulk-gallery-image-files');
const bulkUploadList = document.getElementById('bulk-upload-list');
const bulkUploadProgressModal = document.getElementById('bulk-upload-progress-modal');
const bulkUploadProgressSummary = document.getElementById('bulk-upload-progress-summary');
const bulkUploadProgressBar = document.getElementById('bulk-upload-progress-bar');
const bulkUploadProgressDetail = document.getElementById('bulk-upload-progress-detail');
const bulkUploadProgressCloseButton = document.getElementById('bulk-upload-progress-close');
const galleryTagModal = document.getElementById('gallery-tag-modal');
const galleryTagForm = document.getElementById('gallery-tag-form');
const galleryTagNameInput = document.getElementById('gallery-tag-name');
const renameGalleryTagModal = document.getElementById('rename-gallery-tag-modal');
const renameGalleryTagForm = document.getElementById('rename-gallery-tag-form');
const renameGalleryTagNameInput = document.getElementById('rename-gallery-tag-name');
const deleteMediaModal = document.getElementById('delete-media-modal');
const deleteGalleryTagModal = document.getElementById('delete-gallery-tag-modal');
const removeRowModal = document.getElementById('remove-row-modal');
const editImageArtistModal = document.getElementById('edit-image-artist-modal');
const editImageArtistForm = document.getElementById('edit-image-artist-form');
const editImageSfwFileInput = document.getElementById('edit-gallery-image-sfw-file');
const editImageNsfwFileInput = document.getElementById('edit-gallery-image-nsfw-file');
const editImageSfwArtistInput = document.getElementById('edit-gallery-image-sfw-artist');
const editImageNsfwArtistInput = document.getElementById('edit-gallery-image-nsfw-artist');
const editSfwPreview = document.querySelector('[data-edit-sfw-preview]');
const editNsfwPreview = document.querySelector('[data-edit-nsfw-preview]');
const deleteCharacterButton = document.getElementById('delete-character-button');
const deleteCharacterModal = document.getElementById('delete-character-modal');
const deleteCharacterForm = document.getElementById('delete-character-form');
const deleteCharacterConfirmNameInput = document.getElementById('delete-character-confirm-name');
const deleteConfirmPermanentInput = document.getElementById('delete-confirm-permanent');
const deleteConfirmFinalInput = document.getElementById('delete-confirm-final');
const confirmDeleteCharacterButton = document.getElementById('confirm-delete-character');

let pendingDeleteTagId = null;
let pendingRenameTagId = null;
let removeTargetRowIndex = null;
let bulkUploadFiles = [];
let editTargetMediaId = null;
let editRemoveSfw = false;
let editRemoveNsfw = false;
let characterProfileCropperInstance = null;
let characterProfileObjectUrl = null;

function displayGalleryTabName(name) {
    return name === 'default' ? 'Default' : name;
}

function createId() {
    return crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function showAlert(message, isSuccess) {
    if (!settingsToastRegion) return;
    const toast = document.createElement('div');
    toast.className = 'character-settings-toast-message alert shadow-lg ' + (isSuccess ? 'alert-success' : 'alert-error');
    toast.setAttribute('role', 'status');
    toast.textContent = message || 'Request failed.';
    settingsToastRegion.append(toast);
    window.setTimeout(() => toast.remove(), 3600);
}

function clearAlert() {
    if (!settingsToastRegion) return;
    settingsToastRegion.querySelectorAll('.character-settings-toast-message').forEach((toast) => toast.remove());
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
        throw new Error(message);
    }
    if (response.status === 204) {
        return null;
    }
    return await response.json();
}

function setLoading(button, isLoading, text) {
    if (!button) return;
    button.disabled = isLoading;
    button.classList.toggle('loading', isLoading);
    if (text) {
        if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
        button.textContent = isLoading ? text : button.dataset.idleText;
    }
}

function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return (unitIndex === 0 ? value : value.toFixed(1)) + ' ' + units[unitIndex];
}

function setBulkUploadProgress(summary, percent, detail, isError, canClose) {
    const safePercent = Math.max(0, Math.min(100, Math.round(percent || 0)));
    bulkUploadProgressSummary.textContent = summary;
    bulkUploadProgressBar.value = safePercent;
    bulkUploadProgressBar.className = 'progress w-full ' + (isError ? 'progress-error' : safePercent >= 100 ? 'progress-success' : 'progress-primary');
    bulkUploadProgressDetail.textContent = detail || safePercent + '%';
    bulkUploadProgressCloseButton.hidden = !canClose;
}

function openBulkUploadProgress(files) {
    setBulkUploadProgress('Uploading 0 of ' + files.length + ' images', 0, 'Preparing bulk upload', false, false);
    if (!bulkUploadProgressModal.open) bulkUploadProgressModal.showModal();
}

async function loadCharacterProfileForCropping(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
    if (typeof Cropper === 'undefined') throw new Error('Profile image editor could not load. Refresh and try again.');
    if (characterProfileCropperInstance) characterProfileCropperInstance.destroy();
    if (characterProfileObjectUrl) URL.revokeObjectURL(characterProfileObjectUrl);
    characterProfileObjectUrl = URL.createObjectURL(file);
    characterProfileCropImage.src = characterProfileObjectUrl;
    characterProfileCropper.classList.remove('hidden');
    characterProfileCropperInstance = createProfileCropper(characterProfileCropImage);
    await initializeProfileCropper(characterProfileCropperInstance);
}

async function createCroppedCharacterProfileFile() {
    if (!characterProfileCropperInstance) throw new Error('Choose a profile image first.');
    const canvas = await createProfileCropCanvas(characterProfileCropperInstance);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Could not prepare profile image.'));
                return;
            }
            resolve(new File([blob], 'character-profile.webp', { type: 'image/webp' }));
        }, 'image/webp', 0.9);
    });
}

function resetCharacterProfileCropper() {
    if (characterProfileCropperInstance) {
        characterProfileCropperInstance.destroy();
        characterProfileCropperInstance = null;
    }
    if (characterProfileObjectUrl) {
        URL.revokeObjectURL(characterProfileObjectUrl);
        characterProfileObjectUrl = null;
    }
    characterProfileCropImage.removeAttribute('src');
    characterProfileCropper.classList.add('hidden');
}

function normalizeTagName(name) {
    return name.trim().replace(/\\s+/g, ' ').slice(0, 32);
}

function getActiveLayout() {
    return tagLayouts.get(activeTagId) || Array.from(tagLayouts.values())[0];
}

function getUsedMediaIds(tagId) {
    const layout = tagLayouts.get(tagId);
    return new Set(layout ? layout.rows.flatMap((row) => row.mediaIds) : []);
}

function getMediaUsageTabCount(mediaId) {
    let count = 0;
    tagLayouts.forEach((layout) => {
        if (layout.rows.some((row) => row.mediaIds.includes(mediaId))) count += 1;
    });
    return count;
}

function getUnusedMediaCount() {
    let count = 0;
    mediaLibrary.forEach((media) => {
        if (getMediaUsageTabCount(media.id) === 0) count += 1;
    });
    return count;
}

function getOverflowRowCount() {
    let count = 0;
    tagLayouts.forEach((layout) => {
        layout.rows.forEach((row) => {
            if (row.mediaIds.length > maxGalleryImagesPerRow) count += 1;
        });
    });
    return count;
}

function mediaDisplayUrl(media) {
    return media.nsfwPreviewImageUrl || media.nsfwImageUrl || media.sfwPreviewImageUrl || media.sfwImageUrl || '';
}

function mediaSfwDisplayUrl(media) {
    return media.sfwPreviewImageUrl || media.sfwImageUrl || '';
}

function mediaNsfwDisplayUrl(media) {
    return media.nsfwPreviewImageUrl || media.nsfwImageUrl || '';
}

function mediaAlt(media) {
    return media.nsfwArtist || media.sfwArtist || 'Character media';
}

function createImageRatingBadge(media) {
    const badge = document.createElement('span');
    badge.className = 'absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-[0.65rem] font-bold leading-none shadow-md ';
    if (media.nsfwImageUrl) {
        badge.className += media.sfwImageUrl ? 'bg-purple-600 text-white' : 'bg-error text-error-content';
        badge.textContent = media.sfwImageUrl ? '18+ with SFW' : '18+';
    } else {
        badge.className += 'bg-success text-success-content';
        badge.textContent = 'SFW';
    }
    return badge;
}

function createMediaThumb(media, variant) {
    const item = document.createElement('div');
    item.className = variant === 'pool'
        ? 'media-pool-item group w-[calc((100%_-_1.5rem)/3)] cursor-grab active:cursor-grabbing sm:w-24'
        : 'gallery-image group relative aspect-square w-[calc((100%_-_1.5rem)/3)] cursor-grab overflow-hidden rounded bg-base-300 active:cursor-grabbing sm:h-24 sm:w-24';
    item.dataset.mediaId = media.id;
    item.dataset.galleryDraggable = '';
    item.dataset.gallerySource = variant;
    item.tabIndex = 0;
    item.role = 'button';
    item.ariaLabel = variant === 'pool' ? 'Drag media into a gallery row' : 'Drag media to reorder';

    const thumb = document.createElement('div');
    thumb.className = 'relative aspect-square overflow-hidden rounded bg-base-300';

    const image = document.createElement('img');
    image.className = 'h-full w-full object-cover';
    image.alt = mediaAlt(media);
    image.dataset.mediaThumbImage = '';
    image.decoding = 'async';
    image.draggable = false;
    image.loading = 'lazy';
    image.src = mediaDisplayUrl(media);

    const editButton = document.createElement('button');
    editButton.ariaLabel = 'Edit image settings';
    editButton.className = 'btn btn-neutral btn-sm btn-circle absolute left-1 top-1 z-10 min-h-8 h-8 w-8 opacity-95 sm:btn-xs sm:min-h-6 sm:h-6 sm:w-6';
    editButton.dataset.editImageArtist = '';
    editButton.type = 'button';
    editButton.innerHTML = '<svg aria-hidden="true" class="h-4 w-4 sm:h-3 sm:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16.862 3.487a2.1 2.1 0 0 1 2.97 2.97L8.76 17.53 4.5 18.75l1.22-4.26L16.862 3.487z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';

    const removeButton = document.createElement('button');
    removeButton.ariaLabel = variant === 'pool' ? 'Delete media' : 'Remove from row';
    removeButton.className = 'btn btn-error btn-sm btn-circle absolute right-1 top-1 z-10 min-h-8 h-8 w-8 opacity-95 sm:btn-xs sm:min-h-6 sm:h-6 sm:w-6';
    removeButton.dataset.removeImage = '';
    removeButton.type = 'button';
    removeButton.textContent = 'x';

    thumb.append(image, editButton, removeButton, createImageRatingBadge(media));

    if (variant === 'pool') {
        const usageCount = getMediaUsageTabCount(media.id);
        const usage = document.createElement('div');
        usage.className = 'mt-1 rounded px-1.5 py-1 text-center text-[0.65rem] font-bold leading-tight ' + (usageCount > 0 ? 'bg-success text-success-content' : 'bg-error text-error-content');
        usage.textContent = usageCount > 0 ? 'Used on ' + usageCount + (usageCount === 1 ? ' tab' : ' tabs') : 'Unused';
        item.append(thumb, usage);
        return item;
    }

    item.append(thumb);
    return item;
}

function renderMediaPool() {
    const usedInActiveTab = getUsedMediaIds(activeTagId);
    mediaPool.replaceChildren();
    mediaLibrary.forEach((media) => {
        const item = createMediaThumb(media, 'pool');
        const isUsed = usedInActiveTab.has(media.id);
        item.setAttribute('aria-disabled', isUsed ? 'true' : 'false');
        item.title = isUsed ? 'Already used in this tab' : 'Drag into a row';
        mediaPool.append(item);
    });
    mediaCount.textContent = mediaLibrary.size + ' media';
}

function replaceTagLayouts(entries) {
    tagLayouts.clear();
    entries.forEach(([id, layout]) => tagLayouts.set(id, layout));
}

function moveGalleryTag(tagId, direction) {
    const entries = Array.from(tagLayouts.entries());
    const fromIndex = entries.findIndex(([id]) => id === tagId);
    if (fromIndex < 0) return false;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= entries.length) return false;
    const [entry] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, entry);
    replaceTagLayouts(entries);
    return true;
}

function renderTabs() {
    galleryTagTabs.replaceChildren();
    tagLayouts.forEach((layout, tagId) => {
        const tab = document.createElement('button');
        tab.className = 'gallery-layout-tab tab' + (tagId === activeTagId ? ' tab-active' : '');
        tab.dataset.tagId = tagId;
        tab.role = 'tab';
        tab.type = 'button';
        tab.textContent = displayGalleryTabName(layout.name);
        galleryTagTabs.append(tab);
    });
    const addTab = document.createElement('button');
    addTab.ariaLabel = 'Add gallery tab';
    addTab.className = 'gallery-layout-tab gallery-layout-tab-add tab';
    addTab.dataset.addGalleryTag = '';
    addTab.role = 'tab';
    addTab.type = 'button';
    addTab.textContent = '+';
    galleryTagTabs.append(addTab);
}

function updateActiveTabControls() {
    const tabIds = Array.from(tagLayouts.keys());
    const activeIndex = tabIds.indexOf(activeTagId);
    const hasMultipleTabs = tabIds.length > 1;
    moveActiveTabLeftButton.disabled = activeIndex <= 0;
    moveActiveTabRightButton.disabled = activeIndex < 0 || activeIndex >= tabIds.length - 1;
    renameActiveGalleryTabButton.hidden = false;
    deleteActiveGalleryTabButton.hidden = false;
    deleteActiveGalleryTabButton.disabled = !hasMultipleTabs;
    deleteActiveGalleryTabButton.title = hasMultipleTabs ? 'Delete tab' : 'Each character needs at least one gallery tab';
}

function moveActiveGalleryRow(rowIndex, direction) {
    const rows = getActiveLayout().rows;
    const targetIndex = rowIndex + direction;
    if (rowIndex < 0 || targetIndex < 0 || rowIndex >= rows.length || targetIndex >= rows.length) return false;
    const [row] = rows.splice(rowIndex, 1);
    rows.splice(targetIndex, 0, row);
    return true;
}

function insertActiveGalleryRow(rowIndex) {
    const rows = getActiveLayout().rows;
    rows.splice(Math.max(0, Math.min(rowIndex, rows.length)), 0, { id: createId(), mediaIds: [] });
}

function renderRows() {
    const layout = getActiveLayout();
    galleryRows.replaceChildren();
    layout.rows.forEach((rowData, rowIndex) => {
        const row = document.createElement('div');
        row.className = 'rounded-box border border-base-300 bg-base-100 p-4';
        row.dataset.galleryRow = String(rowIndex);
        const header = document.createElement('div');
        header.className = 'mb-3 flex flex-wrap items-center justify-between gap-2';
        const title = document.createElement('h5');
        title.className = 'font-semibold';
        title.textContent = 'Row ' + (rowIndex + 1);
        const rowActions = document.createElement('div');
        rowActions.className = 'flex flex-wrap items-center justify-end gap-2';
        const rowCount = document.createElement('span');
        rowCount.className = 'badge ' + (rowData.mediaIds.length > maxGalleryImagesPerRow ? 'badge-error' : 'badge-neutral');
        rowCount.textContent = rowData.mediaIds.length + '/' + maxGalleryImagesPerRow;
        const moveUpButton = document.createElement('button');
        moveUpButton.ariaLabel = 'Move row up';
        moveUpButton.className = 'btn btn-sm btn-square';
        moveUpButton.dataset.moveRow = '-1';
        moveUpButton.disabled = rowIndex === 0;
        moveUpButton.title = 'Move row up';
        moveUpButton.type = 'button';
        moveUpButton.textContent = '↑';
        const moveDownButton = document.createElement('button');
        moveDownButton.ariaLabel = 'Move row down';
        moveDownButton.className = 'btn btn-sm btn-square';
        moveDownButton.dataset.moveRow = '1';
        moveDownButton.disabled = rowIndex === layout.rows.length - 1;
        moveDownButton.title = 'Move row down';
        moveDownButton.type = 'button';
        moveDownButton.textContent = '↓';
        const insertAboveButton = document.createElement('button');
        insertAboveButton.className = 'btn btn-sm btn-primary';
        insertAboveButton.dataset.insertRow = String(rowIndex);
        insertAboveButton.type = 'button';
        insertAboveButton.textContent = 'Insert Above';
        const insertBelowButton = document.createElement('button');
        insertBelowButton.className = 'btn btn-sm btn-primary';
        insertBelowButton.dataset.insertRow = String(rowIndex + 1);
        insertBelowButton.type = 'button';
        insertBelowButton.textContent = 'Insert Below';
        const removeButton = document.createElement('button');
        removeButton.className = 'btn btn-sm btn-error btn-outline';
        removeButton.dataset.removeRow = '';
        removeButton.disabled = layout.rows.length === 1;
        removeButton.title = layout.rows.length === 1 ? 'Each tab needs at least one row' : 'Remove row';
        removeButton.type = 'button';
        removeButton.textContent = 'Remove Row';
        rowActions.append(rowCount, moveUpButton, moveDownButton, insertAboveButton, insertBelowButton, removeButton);
        const dropzone = document.createElement('div');
        dropzone.className = 'gallery-dropzone flex min-h-28 flex-wrap gap-3 rounded border border-dashed border-base-300 bg-base-200 p-3';
        dropzone.dataset.dropzone = '';
        dropzone.dataset.rowIndex = String(rowIndex);
        if (rowData.mediaIds.length === 0) {
            const emptyRow = document.createElement('span');
            emptyRow.className = 'gallery-empty-row self-center text-xs text-base-content/60';
            emptyRow.textContent = 'No images in this row';
            dropzone.append(emptyRow);
        }
        rowData.mediaIds.forEach((mediaId) => {
            const media = mediaLibrary.get(mediaId);
            if (media) dropzone.append(createMediaThumb(media, 'row'));
        });
        header.append(title, rowActions);
        row.append(header, dropzone);
        galleryRows.append(row);
    });
    activeGalleryTagTitle.textContent = displayGalleryTabName(layout.name);
    activeGalleryTagMeta.textContent = layout.rows.length + (layout.rows.length === 1 ? ' row' : ' rows') + ' / ' + getUsedMediaIds(activeTagId).size + ' images';
    updateActiveTabControls();
}

function renderGallery() {
    renderTabs();
    renderRows();
    renderMediaPool();
    const unusedMediaCount = getUnusedMediaCount();
    const overflowRowCount = getOverflowRowCount();
    saveCharacterSettingsButton.disabled = getActiveLayout().rows.length === 0 || unusedMediaCount > 0 || overflowRowCount > 0;
    saveCharacterSettingsWarning.hidden = unusedMediaCount === 0 && overflowRowCount === 0;
    if (overflowRowCount > 0) {
        saveCharacterSettingsWarning.textContent = 'Move images so every row has ' + maxGalleryImagesPerRow + ' or fewer images before saving changes.';
    } else {
        saveCharacterSettingsWarning.textContent = unusedMediaCount === 1
            ? 'Delete 1 unused media item before saving changes.'
            : 'Delete ' + unusedMediaCount + ' unused media items before saving changes.';
    }
}

function removeFromActiveRow(rowIndex, mediaId) {
    const row = getActiveLayout().rows[rowIndex];
    if (!row) return;
    row.mediaIds = row.mediaIds.filter((id) => id !== mediaId);
    renderGallery();
}

function isNoopDrop(item, rowIndex, insertIndex) {
    if (!item || item.type !== 'row' || item.rowIndex !== rowIndex) return false;
    const sourceRow = getActiveLayout().rows[rowIndex];
    const sourceIndex = sourceRow ? sourceRow.mediaIds.indexOf(item.mediaId) : -1;
    return sourceIndex >= 0 && (insertIndex === sourceIndex || insertIndex === sourceIndex + 1);
}

function moveMediaToRow(item, rowIndex, insertIndex) {
    if (!item || isNoopDrop(item, rowIndex, insertIndex)) return false;
    const layout = getActiveLayout();
    const targetRow = layout.rows[rowIndex];
    const mediaId = item.mediaId;
    if (!targetRow || !mediaLibrary.has(mediaId)) return;
    const isSameRowMove = item.type === 'row' && item.rowIndex === rowIndex;

    if (!isSameRowMove && targetRow.mediaIds.length >= maxGalleryImagesPerRow) {
        showAlert('Rows can contain at most ' + maxGalleryImagesPerRow + ' images.', false);
        return false;
    }

    let targetIndex = Math.max(0, Math.min(insertIndex, targetRow.mediaIds.length));
    if (item.type === 'row') {
        const sourceRow = layout.rows[item.rowIndex];
        const sourceIndex = sourceRow ? sourceRow.mediaIds.indexOf(mediaId) : -1;
        if (sourceIndex < 0) return false;
        sourceRow.mediaIds.splice(sourceIndex, 1);
        if (item.rowIndex === rowIndex && sourceIndex < targetIndex) targetIndex -= 1;
    } else if (getUsedMediaIds(activeTagId).has(mediaId)) {
        return false;
    }

    targetRow.mediaIds.splice(Math.max(0, Math.min(targetIndex, targetRow.mediaIds.length)), 0, mediaId);
    return true;
}

function createDragGhost(source, x, y) {
    const rect = source.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'gallery-drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.transform = 'translate3d(' + (x - rect.width / 2) + 'px,' + (y - rect.height / 2) + 'px,0)';
    ghost.textContent = 'Move';
    document.body.append(ghost);
    return ghost;
}

function moveDragGhost(x, y) {
    if (!dragState || !dragState.ghost) return;
    dragState.ghost.style.transform = 'translate3d(' + (x - dragState.ghost.offsetWidth / 2) + 'px,' + (y - dragState.ghost.offsetHeight / 2) + 'px,0)';
}

function scrollDuringGalleryDrag(y) {
    const edgeSize = 72;
    const maxStep = 18;
    let step = 0;
    if (y < edgeSize) {
        step = -Math.ceil(((edgeSize - y) / edgeSize) * maxStep);
    } else if (y > window.innerHeight - edgeSize) {
        step = Math.ceil(((y - (window.innerHeight - edgeSize)) / edgeSize) * maxStep);
    }
    if (step) window.scrollBy(0, step);
}

function getDropIndexForPoint(dropzone, x, y) {
    const images = Array.from(dropzone.querySelectorAll('.gallery-image:not(.gallery-drag-source)'));
    if (images.length === 0) return 0;

    const rows = [];
    images.forEach((image, index) => {
        const rect = image.getBoundingClientRect();
        const centerY = rect.top + rect.height / 2;
        let row = rows.find((candidate) => Math.abs(candidate.centerY - centerY) < Math.max(12, rect.height / 2));
        if (!row) {
            row = { centerY, items: [] };
            rows.push(row);
        }
        row.items.push({ image, index, rect });
    });
    rows.sort((a, b) => a.centerY - b.centerY);

    let activeRow = rows[0];
    let closestDistance = Math.abs(y - activeRow.centerY);
    rows.forEach((row) => {
        const distance = Math.abs(y - row.centerY);
        if (distance < closestDistance) {
            activeRow = row;
            closestDistance = distance;
        }
    });
    activeRow.items.sort((a, b) => a.rect.left - b.rect.left);

    if (x <= activeRow.items[0].rect.left + activeRow.items[0].rect.width / 2) {
        return activeRow.items[0].index;
    }

    for (const item of activeRow.items) {
        if (x < item.rect.left + item.rect.width / 2) return item.index;
    }

    const lastItem = activeRow.items[activeRow.items.length - 1];
    return lastItem.index + 1;
}

function updateDropMarker(x, y) {
    if (!dragState) return;
    const target = document.elementFromPoint(x, y);
    const dropzone = target ? target.closest('[data-dropzone]') : null;
    document.querySelectorAll('.gallery-dropzone.drop-active').forEach((zone) => zone.classList.remove('drop-active'));
    if (!dropzone) {
        dragState.drop = null;
        dragState.marker.remove();
        return;
    }
    const rowIndex = Number(dropzone.dataset.rowIndex);
    const insertIndex = getDropIndexForPoint(dropzone, x, y);
    dragState.drop = { rowIndex, insertIndex };
    dropzone.classList.add('drop-active');
    const images = Array.from(dropzone.querySelectorAll('.gallery-image:not(.gallery-drag-source)'));
    const beforeImage = images[insertIndex];
    if (beforeImage) {
        dropzone.insertBefore(dragState.marker, beforeImage);
    } else {
        dropzone.append(dragState.marker);
    }
}

function startGalleryDrag(candidate, event) {
    const source = candidate.source;
    dragState = {
        type: candidate.type,
        mediaId: candidate.mediaId,
        rowIndex: candidate.rowIndex,
        ghost: createDragGhost(source, event.clientX, event.clientY),
        marker: document.createElement('div'),
        drop: null,
    };
    dragState.marker.className = 'gallery-drop-marker';
    source.classList.add('gallery-drag-source');
    document.body.classList.add('gallery-is-dragging');
    moveDragGhost(event.clientX, event.clientY);
    updateDropMarker(event.clientX, event.clientY);
}

function cleanupGalleryDrag() {
    document.body.classList.remove('gallery-is-dragging');
    document.querySelectorAll('.gallery-drag-source').forEach((item) => item.classList.remove('gallery-drag-source'));
    document.querySelectorAll('.gallery-dropzone.drop-active').forEach((zone) => zone.classList.remove('drop-active'));
    if (dragState) {
        dragState.ghost.remove();
        dragState.marker.remove();
    }
    dragState = null;
    dragCandidate = null;
}

function beginGalleryDragCandidate(event, item) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('[data-edit-image-artist],[data-remove-image]')) return;
    if (item.getAttribute('aria-disabled') === 'true') return;
    event.preventDefault();
    const row = item.closest('[data-gallery-row]');
    dragCandidate = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        source: item,
        type: item.dataset.gallerySource,
        mediaId: item.dataset.mediaId,
        rowIndex: row ? Number(row.dataset.galleryRow) : null,
    };
    item.setPointerCapture?.(event.pointerId);
}

function handleGalleryPointerMove(event) {
    if (!dragCandidate || event.pointerId !== dragCandidate.pointerId) return;
    const distance = Math.hypot(event.clientX - dragCandidate.startX, event.clientY - dragCandidate.startY);
    if (!dragState && distance >= 6) startGalleryDrag(dragCandidate, event);
    if (!dragState) return;
    event.preventDefault();
    moveDragGhost(event.clientX, event.clientY);
    scrollDuringGalleryDrag(event.clientY);
    updateDropMarker(event.clientX, event.clientY);
}

function handleGalleryPointerEnd(event) {
    if (!dragCandidate || event.pointerId !== dragCandidate.pointerId) return;
    if (dragState && dragState.drop && moveMediaToRow(dragState, dragState.drop.rowIndex, dragState.drop.insertIndex)) {
        cleanupGalleryDrag();
        renderGallery();
        return;
    }
    cleanupGalleryDrag();
}

function renderImagePreview(preview, src, emptyText) {
    if (!src) {
        preview.className = 'mb-3 flex aspect-video items-center justify-center overflow-hidden rounded bg-base-300 text-xs text-base-content/60';
        preview.textContent = emptyText;
        return;
    }
    preview.className = 'mb-3 aspect-video overflow-hidden rounded bg-base-300';
    preview.replaceChildren();
    const image = document.createElement('img');
    image.alt = emptyText;
    image.className = 'h-full w-full object-cover';
    image.loading = 'lazy';
    image.src = src;
    preview.append(image);
}

function renderFilePreview(input, preview, emptyText) {
    const file = input.files[0];
    renderImagePreview(preview, file && file.type.startsWith('image/') ? URL.createObjectURL(file) : '', emptyText);
}

const allowedGalleryImageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif'];
const galleryPreviewMaxLongEdge = 1600;
const galleryPreviewQuality = 0.9;

async function prepareOriginalImageFile(file) {
    if (!file) return null;
    if (!file.type.startsWith('image/')) {
        throw new Error('Choose an image file. PNG, JPG, WebP, GIF, and AVIF are accepted.');
    }
    if (!allowedGalleryImageTypes.includes(file.type)) {
        throw new Error('Choose a PNG, JPG, WebP, GIF, or AVIF image.');
    }
    let bitmap;
    try {
        bitmap = await createImageBitmap(file, { colorSpaceConversion: 'default' });
    } catch {
        throw new Error('Could not read this image. Try PNG, JPG, WebP, GIF, or AVIF.');
    }
    try {
        const image = {
            file,
            contentType: file.type,
            width: bitmap.width,
            height: bitmap.height,
            preview: await createGalleryPreviewImage(bitmap)
        };
        bitmap.close();
        return image;
    } catch (error) {
        bitmap.close();
        throw error;
    }
}

async function createGalleryPreviewImage(bitmap) {
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const scale = Math.min(1, galleryPreviewMaxLongEdge / longEdge);
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
        }, 'image/webp', galleryPreviewQuality);
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

async function uploadMedia({sfwFile, nsfwFile, sfwArtist, nsfwArtist}, progress) {
    if (progress) progress({ status: 'Preparing', percent: 5, detail: 'Checking image file' });
    const [sfwImage, nsfwImage] = await Promise.all([
        sfwFile ? prepareOriginalImageFile(sfwFile) : null,
        nsfwFile ? prepareOriginalImageFile(nsfwFile) : null
    ]);
    const uploads = [];
    if (sfwImage) uploads.push({ rating: 'sfw', contentType: sfwImage.contentType });
    if (nsfwImage) uploads.push({ rating: 'nsfw', contentType: nsfwImage.contentType });
    if (uploads.length === 0) throw new Error('At least one image is required.');

    if (progress) progress({ status: 'Starting', percent: 10, detail: 'Starting upload' });
    const initResult = await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/media/chunked/init', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uploads })
    });
    const completeBody = {
        mediaId: initResult.mediaId,
        sfwArtist: sfwArtist || '',
        nsfwArtist: nsfwArtist || ''
    };
    if (sfwImage) {
        completeBody.sfwPreview = sfwImage.preview;
        completeBody.sfwUpload = await uploadChunkedImage(initResult.mediaId, 'sfw', sfwImage, initResult.uploads.sfw, progress);
    }
    if (nsfwImage) {
        completeBody.nsfwPreview = nsfwImage.preview;
        completeBody.nsfwUpload = await uploadChunkedImage(initResult.mediaId, 'nsfw', nsfwImage, initResult.uploads.nsfw, progress);
    }

    if (progress) progress({ status: 'Finalizing', percent: 95, detail: 'Finishing upload' });
    const result = await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/media/chunked/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(completeBody)
    });
    mediaLibrary.set(result.media.id, result.media);
    const layout = getActiveLayout();
    let targetRow = layout.rows[layout.rows.length - 1];
    if (!targetRow || targetRow.mediaIds.length >= maxGalleryImagesPerRow) {
        targetRow = { id: createId(), mediaIds: [] };
        layout.rows.push(targetRow);
    }
    targetRow.mediaIds.push(result.media.id);
    renderGallery();
    if (progress) progress({ status: 'Done', percent: 100, detail: 'Upload complete' });
    return result.media;
}

async function uploadChunkedImage(mediaId, rating, image, upload, progress) {
    if (!upload) throw new Error('Upload could not be initialized.');
    const file = image.file;
    const chunkSize = upload.chunkSize || (8 * 1024 * 1024);
    const parts = [];
    let partNumber = 1;
    const totalBytes = Math.max(file.size, 1);

    for (let offset = 0; offset < file.size; offset += chunkSize) {
        const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size), image.contentType);
        const part = await apiFetch(
            '/api/characters/' + encodeURIComponent(character.id)
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
        );
        parts.push(part);
        const uploadedBytes = Math.min(offset + chunk.size, file.size);
        if (progress) {
            progress({
                status: 'Uploading',
                percent: 10 + ((uploadedBytes / totalBytes) * 80),
                detail: 'Uploaded ' + formatFileSize(uploadedBytes) + ' of ' + formatFileSize(file.size)
            });
        }
        partNumber += 1;
    }

    return {
        uploadId: upload.uploadId,
        imageKey: upload.imageKey,
        contentType: image.contentType,
        width: image.width,
        height: image.height,
        parts
    };
}

function openEditMediaModal(mediaId) {
    const media = mediaLibrary.get(mediaId);
    if (!media) return;
    editTargetMediaId = mediaId;
    editImageSfwArtistInput.value = media.sfwArtist || '';
    editImageNsfwArtistInput.value = media.nsfwArtist || '';
    editRemoveSfw = false;
    editRemoveNsfw = false;
    renderImagePreview(editSfwPreview, mediaSfwDisplayUrl(media), 'No SFW image uploaded');
    renderImagePreview(editNsfwPreview, mediaNsfwDisplayUrl(media), 'No NSFW image uploaded');
    editImageArtistModal.showModal();
}

function removeMediaFromLayouts(mediaId) {
    tagLayouts.forEach((layout) => {
        layout.rows.forEach((row) => {
            row.mediaIds = row.mediaIds.filter((id) => id !== mediaId);
        });
    });
}

galleryRows.addEventListener('click', (event) => {
    const removeImageButton = event.target.closest('[data-remove-image]');
    const editButton = event.target.closest('[data-edit-image-artist]');
    const moveRowButton = event.target.closest('[data-move-row]');
    const insertRowButton = event.target.closest('[data-insert-row]');
    const removeRowButton = event.target.closest('[data-remove-row]');
    const row = event.target.closest('[data-gallery-row]');
    if (removeImageButton && row) {
        removeFromActiveRow(Number(row.dataset.galleryRow), removeImageButton.closest('[data-media-id]').dataset.mediaId);
        return;
    }
    if (editButton) {
        openEditMediaModal(editButton.closest('[data-media-id]').dataset.mediaId);
        return;
    }
    if (moveRowButton && row) {
        if (moveActiveGalleryRow(Number(row.dataset.galleryRow), Number(moveRowButton.dataset.moveRow))) renderGallery();
        return;
    }
    if (insertRowButton) {
        insertActiveGalleryRow(Number(insertRowButton.dataset.insertRow));
        renderGallery();
        return;
    }
    if (removeRowButton && row) {
        const rowIndex = Number(row.dataset.galleryRow);
        const rows = getActiveLayout().rows;
        if (rows.length <= 1) return;
        if (rows[rowIndex].mediaIds.length > 0) {
            removeTargetRowIndex = rowIndex;
            removeRowModal.showModal();
            return;
        }
        rows.splice(rowIndex, 1);
        renderGallery();
    }
});

mediaPool.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-image]');
    const editButton = event.target.closest('[data-edit-image-artist]');
    const mediaItem = event.target.closest('[data-media-id]');
    if (!mediaItem) return;
    if (removeButton) {
        pendingDeleteMediaId = mediaItem.dataset.mediaId;
        deleteMediaModal.showModal();
        return;
    }
    if (editButton) {
        openEditMediaModal(mediaItem.dataset.mediaId);
        
    }
});

function preventNativeGalleryDrag(event) {
    if (event.target.closest('[data-gallery-draggable]')) event.preventDefault();
}

function handleGalleryPointerDown(event) {
    const item = event.target.closest('[data-gallery-draggable]');
    if (!item) return;
    beginGalleryDragCandidate(event, item);
}

galleryRows.addEventListener('dragstart', preventNativeGalleryDrag);
mediaPool.addEventListener('dragstart', preventNativeGalleryDrag);
galleryRows.addEventListener('pointerdown', handleGalleryPointerDown);
mediaPool.addEventListener('pointerdown', handleGalleryPointerDown);
window.addEventListener('pointermove', handleGalleryPointerMove, { passive: false });
window.addEventListener('pointerup', handleGalleryPointerEnd);
window.addEventListener('pointercancel', handleGalleryPointerEnd);

galleryTagTabs.addEventListener('click', (event) => {
    const addTab = event.target.closest('[data-add-gallery-tag]');
    const tab = event.target.closest('[data-tag-id]');
    if (addTab) {
        galleryTagModal.showModal();
        galleryTagNameInput.focus();
        return;
    }
    if (tab) {
        activeTagId = tab.dataset.tagId;
        renderGallery();
    }
});

moveActiveTabLeftButton.addEventListener('click', () => {
    if (moveGalleryTag(activeTagId, -1)) renderGallery();
});

moveActiveTabRightButton.addEventListener('click', () => {
    if (moveGalleryTag(activeTagId, 1)) renderGallery();
});

renameActiveGalleryTabButton.addEventListener('click', () => {
    pendingRenameTagId = activeTagId;
    renameGalleryTagNameInput.value = getActiveLayout().name;
    renameGalleryTagModal.showModal();
    renameGalleryTagNameInput.focus();
});

deleteActiveGalleryTabButton.addEventListener('click', () => {
    if (tagLayouts.size <= 1) return;
    pendingDeleteTagId = activeTagId;
    deleteGalleryTagModal.showModal();
});

addGalleryRowButton.addEventListener('click', () => {
    getActiveLayout().rows.push({ id: createId(), mediaIds: [] });
    renderGallery();
});

galleryTagForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = normalizeTagName(galleryTagNameInput.value);
    if (!name) return;
    const id = createId();
    tagLayouts.set(id, { id, name, rows: [{ id: createId(), mediaIds: [] }] });
    activeTagId = id;
    galleryTagModal.close();
    renderGallery();
});

renameGalleryTagForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const layout = tagLayouts.get(pendingRenameTagId);
    const name = normalizeTagName(renameGalleryTagNameInput.value);
    if (layout && name) layout.name = name;
    renameGalleryTagModal.close();
    renderGallery();
});

deleteGalleryTagModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-cancel-delete-gallery-tag]')) {
        deleteGalleryTagModal.close();
        return;
    }
    if (event.target.matches('[data-confirm-delete-gallery-tag]') && pendingDeleteTagId) {
        if (tagLayouts.size <= 1) {
            deleteGalleryTagModal.close();
            return;
        }
        tagLayouts.delete(pendingDeleteTagId);
        activeTagId = Array.from(tagLayouts.keys())[0];
        deleteGalleryTagModal.close();
        renderGallery();
    }
});

removeRowModal.addEventListener('click', (event) => {
    if (event.target.matches('[data-cancel-remove-row]')) {
        removeRowModal.close();
        return;
    }
    if (event.target.matches('[data-confirm-remove-row]') && removeTargetRowIndex !== null) {
        const rows = getActiveLayout().rows;
        if (rows.length > 1) rows.splice(removeTargetRowIndex, 1);
        removeRowModal.close();
        renderGallery();
    }
});

deleteMediaModal.addEventListener('click', async (event) => {
    if (event.target.matches('[data-cancel-delete-media]')) {
        deleteMediaModal.close();
        return;
    }
    if (event.target.matches('[data-confirm-delete-media]') && pendingDeleteMediaId) {
        try {
            await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/media/' + encodeURIComponent(pendingDeleteMediaId), { method: 'DELETE' });
            mediaLibrary.delete(pendingDeleteMediaId);
            removeMediaFromLayouts(pendingDeleteMediaId);
            deleteMediaModal.close();
            renderGallery();
        } catch (error) {
            showAlert(error.message, false);
        }
    }
});

uploadMediaButton.addEventListener('click', () => uploadImageModal.showModal());
bulkUploadButton.addEventListener('click', () => bulkUploadModal.showModal());
uploadImageSfwFileInput.addEventListener('change', () => renderFilePreview(uploadImageSfwFileInput, uploadSfwPreview, 'No SFW image selected'));
uploadImageNsfwFileInput.addEventListener('change', () => renderFilePreview(uploadImageNsfwFileInput, uploadNsfwPreview, 'No NSFW image selected'));

uploadImageForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = uploadImageForm.querySelector('button[type="submit"]');
    try {
        setLoading(submitButton, true, 'Uploading...');
        await uploadMedia({
            sfwFile: uploadImageSfwFileInput.files[0],
            nsfwFile: uploadImageNsfwFileInput.files[0],
            sfwArtist: uploadImageSfwArtistInput.value,
            nsfwArtist: uploadImageNsfwArtistInput.value
        });
        uploadImageModal.close();
        showAlert('Image uploaded. Save changes to persist gallery placement.', true);
    } catch (error) {
        showAlert(error.message, false);
    } finally {
        setLoading(submitButton, false, 'Uploading...');
    }
});

bulkUploadFileInput.addEventListener('change', () => {
    bulkUploadFiles = Array.from(bulkUploadFileInput.files).filter((file) => file.type.startsWith('image/'));
    bulkUploadList.replaceChildren();
    bulkUploadFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'grid gap-3 rounded border border-base-300 bg-base-200 p-3 sm:grid-cols-[4rem_1fr] sm:items-center';
        const preview = document.createElement('img');
        preview.alt = file.name;
        preview.className = 'h-16 w-16 rounded object-cover';
        preview.loading = 'lazy';
        preview.src = URL.createObjectURL(file);
        const input = document.createElement('input');
        input.className = 'input input-bordered w-full';
        input.dataset.bulkArtistInput = String(index);
        input.placeholder = 'Artist name';
        input.maxLength = 80;
        const nsfwLabel = document.createElement('label');
        nsfwLabel.className = 'label cursor-pointer justify-start gap-3';
        const nsfwInput = document.createElement('input');
        nsfwInput.className = 'checkbox checkbox-error';
        nsfwInput.dataset.bulkNsfwInput = String(index);
        nsfwInput.type = 'checkbox';
        const nsfwText = document.createElement('span');
        nsfwText.className = 'label-text';
        nsfwText.textContent = 'Mark as NSFW';
        const controls = document.createElement('div');
        controls.className = 'space-y-2';
        nsfwLabel.append(nsfwInput, nsfwText);
        controls.append(input, nsfwLabel);
        item.append(preview, controls);
        bulkUploadList.append(item);
    });
});

bulkUploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = bulkUploadForm.querySelector('button[type="submit"]');
    let activeIndex = -1;
    try {
        if (bulkUploadFiles.length === 0) throw new Error('Choose at least one image file.');
        setLoading(submitButton, true, 'Uploading...');
        openBulkUploadProgress(bulkUploadFiles);
        for (let index = 0; index < bulkUploadFiles.length; index += 1) {
            activeIndex = index;
            const artistInput = bulkUploadList.querySelector('[data-bulk-artist-input="' + index + '"]');
            const nsfwInput = bulkUploadList.querySelector('[data-bulk-nsfw-input="' + index + '"]');
            const isNsfw = Boolean(nsfwInput && nsfwInput.checked);
            setBulkUploadProgress(
                'Uploading ' + (index + 1) + ' of ' + bulkUploadFiles.length + ' images',
                (index / bulkUploadFiles.length) * 100,
                bulkUploadFiles[index].name,
                false,
                false
            );
            await uploadMedia({
                sfwFile: isNsfw ? null : bulkUploadFiles[index],
                nsfwFile: isNsfw ? bulkUploadFiles[index] : null,
                sfwArtist: isNsfw ? '' : (artistInput ? artistInput.value : ''),
                nsfwArtist: isNsfw ? (artistInput ? artistInput.value : '') : ''
            }, (state) => {
                const imageProgress = Math.max(0, Math.min(100, state.percent || 0));
                const totalProgress = ((index + (imageProgress / 100)) / bulkUploadFiles.length) * 100;
                setBulkUploadProgress(
                    state.status + ' image ' + (index + 1) + ' of ' + bulkUploadFiles.length,
                    totalProgress,
                    bulkUploadFiles[index].name + ' - ' + (state.detail || Math.round(imageProgress) + '%'),
                    false,
                    false
                );
            });
        }
        setBulkUploadProgress('Uploaded ' + bulkUploadFiles.length + ' images', 100, 'Bulk upload complete', false, true);
        bulkUploadModal.close();
        showAlert('Bulk upload complete. Save changes to persist gallery placement.', true);
    } catch (error) {
        if (activeIndex >= 0) {
            setBulkUploadProgress(
                'Bulk upload stopped at image ' + (activeIndex + 1) + ' of ' + bulkUploadFiles.length,
                ((activeIndex + 1) / Math.max(bulkUploadFiles.length, 1)) * 100,
                error.message || 'Upload failed',
                true,
                true
            );
        }
        showAlert(error.message, false);
    } finally {
        setLoading(submitButton, false, 'Uploading...');
    }
});

editImageSfwFileInput.addEventListener('change', () => renderFilePreview(editImageSfwFileInput, editSfwPreview, 'No SFW image uploaded'));
editImageNsfwFileInput.addEventListener('change', () => renderFilePreview(editImageNsfwFileInput, editNsfwPreview, 'No NSFW image uploaded'));

bulkUploadProgressCloseButton.addEventListener('click', () => {
    bulkUploadProgressModal.close();
});

editImageArtistForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = editImageArtistForm.querySelector('button[type="submit"]');
    try {
        setLoading(submitButton, true, 'Saving...');
        const [sfwImage, nsfwImage] = await Promise.all([
            editImageSfwFileInput.files[0] ? prepareOriginalImageFile(editImageSfwFileInput.files[0]) : null,
            editImageNsfwFileInput.files[0] ? prepareOriginalImageFile(editImageNsfwFileInput.files[0]) : null
        ]);
        const uploads = [];
        if (sfwImage) uploads.push({ rating: 'sfw', contentType: sfwImage.contentType });
        if (nsfwImage) uploads.push({ rating: 'nsfw', contentType: nsfwImage.contentType });
        const hasUploads = uploads.length > 0;
        const initResult = hasUploads
            ? await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/media/' + encodeURIComponent(editTargetMediaId) + '/chunked/init', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ uploads })
            })
            : null;
        const completeBody = {
            sfwArtist: editImageSfwArtistInput.value,
            nsfwArtist: editImageNsfwArtistInput.value,
            removeSfw: editRemoveSfw,
            removeNsfw: editRemoveNsfw
        };
        if (initResult && sfwImage) {
            completeBody.sfwPreview = sfwImage.preview;
            completeBody.sfwUpload = await uploadChunkedImage(editTargetMediaId, 'sfw', sfwImage, initResult.uploads.sfw);
        }
        if (initResult && nsfwImage) {
            completeBody.nsfwPreview = nsfwImage.preview;
            completeBody.nsfwUpload = await uploadChunkedImage(editTargetMediaId, 'nsfw', nsfwImage, initResult.uploads.nsfw);
        }
        const result = await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/media/' + encodeURIComponent(editTargetMediaId) + '/chunked/complete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(completeBody)
        });
        mediaLibrary.set(result.media.id, result.media);
        editImageArtistModal.close();
        renderGallery();
    } catch (error) {
        showAlert(error.message, false);
    } finally {
        setLoading(submitButton, false, 'Saving...');
    }
});

editImageArtistModal.addEventListener('click', (event) => {
    const media = mediaLibrary.get(editTargetMediaId);
    if (!media) return;
    if (event.target.matches('[data-remove-edit-sfw]')) {
        editRemoveSfw = !editRemoveSfw;
        renderImagePreview(editSfwPreview, editRemoveSfw ? '' : mediaSfwDisplayUrl(media), 'SFW image will be removed');
    }
    if (event.target.matches('[data-remove-edit-nsfw]')) {
        editRemoveNsfw = !editRemoveNsfw;
        renderImagePreview(editNsfwPreview, editRemoveNsfw ? '' : mediaNsfwDisplayUrl(media), 'NSFW image will be removed');
    }
});

document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
        if (event.target.matches('[data-close-upload-modal],[data-close-bulk-upload-modal],[data-close-gallery-tag-modal],[data-close-rename-gallery-tag-modal],[data-close-edit-artist-modal],[data-close-delete-modal]')) {
            dialog.close();
        }
    });
});

characterProfileImageInput.addEventListener('change', async () => {
    resetCharacterProfileCropper();
    const file = characterProfileImageInput.files && characterProfileImageInput.files[0];
    if (!file) return;
    try {
        await loadCharacterProfileForCropping(file);
    } catch (error) {
        resetCharacterProfileCropper();
        showAlert(error.message || 'Could not prepare profile image.', false);
        characterProfileImageInput.value = '';
    }
});

characterSettingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAlert();
    try {
        setLoading(saveCharacterSettingsButton, true, 'Saving...');
        if (characterProfileImageInput.files[0]) {
            const croppedProfileImage = await createCroppedCharacterProfileFile();
            const profileImageFormData = new FormData();
            profileImageFormData.set('profileImage', croppedProfileImage);
            const profileImageResult = await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/profile-image', {
                method: 'POST',
                body: profileImageFormData
            });
            character.profileImageKey = profileImageResult.profileImageKey;
            characterProfileImagePreview.src = profileImageResult.profileImageUrl;
            characterProfileImageInput.value = '';
            resetCharacterProfileCropper();
        }
        const name = document.getElementById('character-name').value;
        const description = document.getElementById('character-description').value;
        const updatedCharacter = await apiFetch('/api/characters/' + encodeURIComponent(character.id), {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name, description })
        });
        character.name = updatedCharacter.character.name;
        character.description = updatedCharacter.character.description;
        characterTitle.textContent = character.name;
        await apiFetch('/api/characters/' + encodeURIComponent(character.id) + '/gallery', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                fullsizeLastRow: fullsizeLastRowInput.checked,
                tabs: Array.from(tagLayouts.values())
            })
        });
        showAlert('Character settings saved.', true);
    } catch (error) {
        showAlert(error.message, false);
    } finally {
        setLoading(saveCharacterSettingsButton, false, 'Saving...');
    }
});

function updateDeleteButtonState() {
    confirmDeleteCharacterButton.disabled = !(deleteCharacterConfirmNameInput.value.trim().toUpperCase() === character.name.toUpperCase() && deleteConfirmPermanentInput.checked && deleteConfirmFinalInput.checked);
}

deleteCharacterButton.addEventListener('click', () => deleteCharacterModal.showModal());
deleteCharacterForm.addEventListener('input', updateDeleteButtonState);
deleteCharacterForm.addEventListener('change', updateDeleteButtonState);
deleteCharacterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
        setLoading(confirmDeleteCharacterButton, true, 'Deleting...');
        await apiFetch('/api/characters/' + encodeURIComponent(character.id), {
            method: 'DELETE',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ confirmName: deleteCharacterConfirmNameInput.value, permanent: deleteConfirmPermanentInput.checked && deleteConfirmFinalInput.checked })
        });
        window.location.assign('/characters');
    } catch (error) {
        showAlert(error.message, false);
        setLoading(confirmDeleteCharacterButton, false, 'Deleting...');
    }
});

uploadImageModal.addEventListener('close', () => {
    uploadImageForm.reset();
    renderImagePreview(uploadSfwPreview, '', 'No SFW image selected');
    renderImagePreview(uploadNsfwPreview, '', 'No NSFW image selected');
});
bulkUploadModal.addEventListener('close', () => {
    bulkUploadForm.reset();
    bulkUploadList.replaceChildren();
    bulkUploadFiles = [];
});
editImageArtistModal.addEventListener('close', () => {
    editImageArtistForm.reset();
    editTargetMediaId = null;
    editRemoveSfw = false;
    editRemoveNsfw = false;
});
galleryTagModal.addEventListener('close', () => galleryTagForm.reset());
renameGalleryTagModal.addEventListener('close', () => {
    pendingRenameTagId = null;
    renameGalleryTagForm.reset();
});
deleteMediaModal.addEventListener('close', () => pendingDeleteMediaId = null);
deleteGalleryTagModal.addEventListener('close', () => pendingDeleteTagId = null);
removeRowModal.addEventListener('close', () => removeTargetRowIndex = null);

if (tagLayouts.size === 0) {
    const defaultTabId = createId();
    tagLayouts.set(defaultTabId, { id: defaultTabId, name: 'default', rows: [{ id: createId(), mediaIds: [] }] });
    activeTagId = defaultTabId;
}

renderGallery();
updateDeleteButtonState();
`,
        }}/>
    )
}

export function CharacterSettingsPage({
    currentUser,
    character,
    media,
    galleryTabs,
    mediaBaseUrl,
}: CharacterSettingsPageProps) {
    const mediaItems = media.map((item) => mediaWithUrls(mediaBaseUrl, character, item))
    const profileImageUrl = characterProfileImageUrl(mediaBaseUrl, character.userId, character.id, character.profileImageKey)
    const characterViewUrl = `/u/${encodeURIComponent(currentUser.username)}/${encodeURIComponent(character.name)}`

    return (
        <BaseLayout
            title={`${character.name} Settings | MyOC`}
        >
            <Navbar currentUser={currentUser} guestInitial={currentUser.username.charAt(0).toUpperCase()} mediaBaseUrl={mediaBaseUrl}/>
            <main class="container mx-auto max-w-3xl px-3 py-6 sm:px-0">
                <style>{`
                    .media-pool-item, .gallery-image { contain: layout paint; touch-action: none; user-select: none; }
                    .media-pool-item [data-media-thumb-image], .gallery-image [data-media-thumb-image] { pointer-events: none; -webkit-user-drag: none; user-select: none; }
                    .media-pool-item.gallery-drag-source, .gallery-image.gallery-drag-source { opacity: 0.35; }
                    .media-pool-item[aria-disabled="true"] [data-media-thumb-image] { cursor: not-allowed; filter: grayscale(1); opacity: 0.35; }
                    .gallery-dropzone.drop-active { outline: 2px dashed currentColor; outline-offset: 4px; }
                    .gallery-drop-marker { align-self: stretch; border: 2px dashed var(--color-primary); border-radius: var(--radius-field, 0.25rem); min-height: 5rem; width: calc((100% - 1.5rem) / 3); }
                    @media (min-width: 40rem) { .gallery-drop-marker { width: 6rem; } }
                    .gallery-drag-ghost { align-items: center; background: color-mix(in oklab, var(--color-primary) 18%, var(--color-base-300)); border: 2px solid var(--color-primary); border-radius: var(--radius-field, 0.25rem); box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.28); color: var(--color-base-content); display: flex; font-size: 0.7rem; font-weight: 800; justify-content: center; left: 0; letter-spacing: 0; opacity: 0.95; pointer-events: none; position: fixed; text-transform: uppercase; top: 0; z-index: 9999; }
                    .gallery-is-dragging, .gallery-is-dragging * { cursor: grabbing !important; }
                    .gallery-layout-tabs { border-bottom: 1px solid var(--color-base-300); gap: 0.25rem; scrollbar-width: thin; }
                    .gallery-layout-tab { background: var(--color-base-300); border: 1px solid color-mix(in oklab, var(--color-base-content) 26%, transparent); border-bottom: 0; border-radius: var(--radius-field, 0.25rem) var(--radius-field, 0.25rem) 0 0; color: color-mix(in oklab, var(--color-base-content) 78%, transparent); font-weight: 800; min-height: 2.5rem; padding-inline: 0.9rem; white-space: nowrap; }
                    .gallery-layout-tab.tab-active { background: var(--color-base-200); border-color: var(--color-primary); color: var(--color-base-content); box-shadow: inset 0 3px 0 var(--color-primary); }
                    .gallery-layout-tab-add { min-width: 2.75rem; }
                    .gallery-layout-tab-action { min-height: 2rem; height: 2rem; width: 2rem; }
                    .gallery-layout-tab-action:not(:disabled) { border: 1px solid color-mix(in oklab, var(--color-base-content) 34%, transparent); box-shadow: 0 1px 0 color-mix(in oklab, var(--color-base-content) 18%, transparent); }
                    .gallery-layout-tab-action:disabled { background: var(--color-base-300); border: 1px dashed color-mix(in oklab, var(--color-base-content) 42%, transparent); color: color-mix(in oklab, var(--color-base-content) 62%, transparent); opacity: 1; }
                    .gallery-layout-panel { border-top-left-radius: 0; }
                    [data-character-profile-cropper] cropper-canvas { height: min(22rem, 55vh); }
                    .character-settings-toast-message { animation: character-settings-toast-fade 3400ms ease forwards; pointer-events: auto; }
                    @keyframes character-settings-toast-fade {
                        0%, 82% { opacity: 1; transform: translateY(0); }
                        100% { opacity: 0; transform: translateY(-0.5rem); }
                    }
                `}</style>

                <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="flex min-w-0 items-center gap-3">
                        <img alt="Current profile image" class="h-14 w-14 shrink-0 rounded object-cover sm:h-16 sm:w-16"
                             data-character-profile-image-preview loading="lazy" src={profileImageUrl}/>
                        <h1 class="min-w-0 wrap-break-word text-4xl font-bold sm:text-5xl"
                            data-character-title>{character.name}</h1>
                    </div>
                    <div class="flex flex-wrap gap-2 sm:justify-end">
                        <a class="btn btn-primary" href={characterViewUrl}>View Character</a>
                        <a class="btn btn-secondary" href={`/edit/${encodeURIComponent(character.id)}/height-chart`}>Height
                            Chart</a>
                        <a class="btn btn-secondary" href="/characters">Back to Characters</a>
                        <button class="btn btn-error" id="delete-character-button" type="button">Delete Character</button>
                    </div>
                </div>

                <form class="space-y-5" id="character-settings-form">
                    <fieldset class="fieldset">
                        <label class="fieldset-label" for="character-profile-photo">Profile Photo</label>
                        <input accept="image/*" class="file-input w-full" id="character-profile-photo"
                               name="character-profile-photo" type="file"/>
                        <div class="label">
                            <span class="label-text-alt">You'll be able to crop the image before uploading.</span>
                        </div>
                    </fieldset>
                    <div class="hidden rounded-box border border-base-300 bg-base-100 p-3" data-character-profile-cropper>
                        <div class="max-h-88 overflow-hidden rounded-box bg-base-300">
                            <img alt="Crop character profile image" class="block max-h-88 w-full object-contain"
                                 data-character-profile-crop-image/>
                        </div>
                        <p class="mt-2 text-xs text-base-content/60">Drag to choose the square profile crop. The saved
                            image will be converted to 512x512 WebP.</p>
                    </div>

                    <fieldset class="fieldset">
                        <label class="fieldset-label" for="character-name">Character Name</label>
                        <input class="input input-bordered w-full" id="character-name" maxLength={80}
                               name="character-name" pattern={CHARACTER_NAME_INPUT_PATTERN} required
                               title={CHARACTER_NAME_INPUT_TITLE}
                               type="text" value={character.name}/>
                    </fieldset>

                    <fieldset class="fieldset">
                        <label class="fieldset-label" for="character-description">Description</label>
                        <textarea class="textarea textarea-bordered min-h-32 w-full resize-y" id="character-description"
                                  maxLength={255} name="character-description"
                                  placeholder="Write a short character description...">{character.description}</textarea>
                        <div class="label justify-end">
                            <span class="label-text-alt">255 characters max</span>
                        </div>
                    </fieldset>

                    <section class="mt-10 space-y-6">
                        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <h2 class="text-2xl font-bold">Gallery Sorting</h2>
                                <p class="text-sm text-base-content/70">Upload PNG, JPG, WebP, GIF, AVIF, or other browser-supported images, then arrange each tab into rows.</p>
                            </div>
                            <div class="flex flex-wrap items-center justify-end gap-3">
                                <label class="label cursor-pointer gap-2">
                                    <input checked={character.galleryFullsizeLastRow} class="checkbox checkbox-primary"
                                           id="fullsize-last-row" type="checkbox"/>
                                    <span class="label-text">Fullsize Last Row</span>
                                </label>
                                <button class="btn btn-secondary" id="bulk-upload-images" type="button">Bulk Upload</button>
                                <button class="btn btn-primary" id="upload-media-button" type="button">Upload Image</button>
                            </div>
                        </div>

                        <div class="rounded-box border border-base-300 bg-base-200 p-4">
                            <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                                <h3 class="text-lg font-semibold">All Media</h3>
                                <span class="badge badge-neutral" id="all-media-count">0 media</span>
                            </div>
                            <div class="flex flex-wrap gap-3" id="all-media-pool"></div>
                        </div>

                        <div>
                            <div class="mb-3 min-w-0">
                                <h3 class="text-lg font-semibold">Tag Gallery Layouts</h3>
                                <p class="text-sm text-base-content/70">Each tab has its own row order and can reuse media from other tabs.</p>
                            </div>
                            <div aria-label="Gallery layout tabs"
                                 class="gallery-layout-tabs tabs tabs-border flex-nowrap overflow-x-auto"
                                 id="gallery-tag-tabs" role="tablist"></div>
                            <div class="gallery-layout-panel rounded-box border border-base-300 bg-base-200 p-4">
                                <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h4 class="font-semibold" id="active-gallery-tag-title">Default</h4>
                                        <p class="text-sm text-base-content/70" id="active-gallery-tag-meta">0 rows</p>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                                        <button aria-label="Move active tab left"
                                                class="gallery-layout-tab-action btn btn-dark btn-sm btn-square"
                                                id="move-active-gallery-tab-left" title="Move tab left" type="button">←
                                        </button>
                                        <button aria-label="Move active tab right"
                                                class="gallery-layout-tab-action btn btn-dark btn-sm btn-square"
                                                id="move-active-gallery-tab-right" title="Move tab right"
                                                type="button">→
                                        </button>
                                        <button aria-label="Rename active tab"
                                                class="gallery-layout-tab-action btn btn-dash btn-warning btn-sm btn-square"
                                                id="rename-active-gallery-tab" title="Rename tab" type="button">✎
                                        </button>
                                        <button aria-label="Delete active tab"
                                                class="gallery-layout-tab-action btn btn-error btn-sm btn-square"
                                                id="delete-active-gallery-tab" title="Delete tab" type="button">
                                            <svg aria-hidden="true" class="h-4 w-4" fill="none" stroke="currentColor"
                                                 viewBox="0 0 24 24">
                                                <path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"
                                                      stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/>
                                            </svg>
                                        </button>
                                        <button class="btn btn-sm btn-primary" id="add-gallery-row" type="button">Add
                                            Row
                                        </button>
                                    </div>
                                </div>
                                <div class="space-y-4" id="gallery-rows"></div>
                            </div>
                        </div>
                    </section>

                    <div class="mt-8 flex flex-col items-end gap-2">
                        <p class="text-sm text-error" hidden id="save-character-settings-warning">Delete unused media before saving changes.</p>
                        <button class="btn btn-primary" id="save-character-settings" type="submit">Save Changes</button>
                    </div>
                </form>

                <UploadDialog/>
                <BulkUploadDialog/>
                <BulkUploadProgressDialog/>
                <GalleryTagDialogs/>
                <MediaDialogs characterName={character.name}/>
                <DeleteCharacterDialog characterName={character.name}/>
                <div aria-live="polite" class="toast toast-top toast-end pointer-events-none z-9999"
                     data-character-settings-toast-region></div>

                <script src="/vendor/cropperjs/cropper.min.js"></script>
                <CharacterSettingsScript
                    character={character}
                    csrfToken={currentUser.csrfToken}
                    galleryTabs={galleryTabs}
                    media={mediaItems}
                />
            </main>
        </BaseLayout>
    )
}

function UploadDialog() {
    return (
        <dialog class="modal" id="upload-image-modal">
            <div class="modal-box">
                <form method="dialog"><button aria-label="Close upload dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                <h2 class="text-xl font-bold">Upload Image</h2>
                <form class="mt-5 space-y-4" id="upload-image-form">
                    <p class="text-sm text-base-content/70">PNG, JPG, WebP, GIF, and AVIF images are accepted. Files are
                        stored unmodified.</p>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <fieldset class="fieldset rounded border border-base-300 bg-base-200 p-3">
                            <label class="fieldset-label" for="gallery-image-sfw-file">SFW</label>
                            <div class="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded bg-base-300 text-xs text-base-content/60" data-upload-sfw-preview>No SFW image selected</div>
                            <input accept="image/*" class="file-input w-full" id="gallery-image-sfw-file" type="file"/>
                        </fieldset>
                        <fieldset class="fieldset rounded border border-base-300 bg-base-200 p-3">
                            <label class="fieldset-label" for="gallery-image-nsfw-file">NSFW</label>
                            <div class="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded bg-base-300 text-xs text-base-content/60" data-upload-nsfw-preview>No NSFW image selected</div>
                            <input accept="image/*" class="file-input w-full" id="gallery-image-nsfw-file" type="file"/>
                        </fieldset>
                    </div>
                    <div class="grid gap-3 sm:grid-cols-2">
                        <fieldset class="fieldset"><label class="fieldset-label" for="gallery-image-sfw-artist">SFW Credits</label><input class="input input-bordered w-full" id="gallery-image-sfw-artist" maxLength={80} placeholder="Artist name" type="text"/></fieldset>
                        <fieldset class="fieldset"><label class="fieldset-label" for="gallery-image-nsfw-artist">NSFW Credits</label><input class="input input-bordered w-full" id="gallery-image-nsfw-artist" maxLength={80} placeholder="Artist name" type="text"/></fieldset>
                    </div>
                    <div class="modal-action">
                        <button class="btn btn-ghost" data-close-upload-modal type="button">Cancel</button>
                        <button class="btn btn-primary" type="submit">Add Image</button>
                    </div>
                </form>
            </div>
            <form class="modal-backdrop" method="dialog"><button>close</button></form>
        </dialog>
    )
}

function BulkUploadDialog() {
    return (
        <dialog class="modal" id="bulk-upload-modal">
            <div class="modal-box max-w-3xl">
                <form method="dialog"><button aria-label="Close bulk upload dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                <h2 class="text-xl font-bold">Bulk Upload</h2>
                <form class="mt-5 space-y-4" id="bulk-upload-form">
                    <fieldset class="fieldset">
                        <label class="fieldset-label" for="bulk-gallery-image-files">Image Files</label>
                        <input accept="image/*" class="file-input w-full" id="bulk-gallery-image-files" multiple required type="file"/>
                    </fieldset>
                    <div class="space-y-3" id="bulk-upload-list"></div>
                    <div class="modal-action">
                        <button class="btn btn-ghost" data-close-bulk-upload-modal type="button">Cancel</button>
                        <button class="btn btn-primary" type="submit">Add Images</button>
                    </div>
                </form>
            </div>
            <form class="modal-backdrop">
                <button aria-label="Bulk upload backdrop" type="button">close</button>
            </form>
        </dialog>
    )
}

function BulkUploadProgressDialog() {
    return (
        <dialog class="modal" id="bulk-upload-progress-modal">
            <div class="modal-box max-w-2xl">
                <h2 class="text-xl font-bold">Uploading Images</h2>
                <p class="mt-1 text-sm text-base-content/70" id="bulk-upload-progress-summary">Preparing upload</p>
                <progress class="progress mt-5 w-full" id="bulk-upload-progress-bar" max="100" value="0"></progress>
                <p class="mt-2 truncate text-sm text-base-content/70" id="bulk-upload-progress-detail">Waiting to
                    upload</p>
                <div class="modal-action">
                    <button class="btn btn-primary" hidden id="bulk-upload-progress-close" type="button">Close</button>
                </div>
            </div>
            <form class="modal-backdrop">
                <button aria-label="Bulk upload progress backdrop" disabled type="button">Uploading</button>
            </form>
        </dialog>
    )
}

function GalleryTagDialogs() {
    return (
        <>
            <dialog class="modal" id="gallery-tag-modal">
                <div class="modal-box">
                    <form method="dialog"><button aria-label="Close tag dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                    <h2 class="text-xl font-bold">Add Gallery Tab</h2>
                    <form class="mt-5 space-y-4" id="gallery-tag-form">
                        <fieldset class="fieldset"><label class="fieldset-label" for="gallery-tag-name">Tab Name</label><input class="input input-bordered w-full" id="gallery-tag-name" maxLength={32} required type="text"/></fieldset>
                        <div class="modal-action"><button class="btn btn-ghost" data-close-gallery-tag-modal type="button">Cancel</button><button class="btn btn-primary" type="submit">Add Tab</button></div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
            <dialog class="modal" id="rename-gallery-tag-modal">
                <div class="modal-box">
                    <form method="dialog"><button aria-label="Close rename tab dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                    <h2 class="text-xl font-bold">Rename Gallery Tab</h2>
                    <form class="mt-5 space-y-4" id="rename-gallery-tag-form">
                        <fieldset class="fieldset"><label class="fieldset-label" for="rename-gallery-tag-name">Tab Name</label><input class="input input-bordered w-full" id="rename-gallery-tag-name" maxLength={32} required type="text"/></fieldset>
                        <div class="modal-action"><button class="btn btn-ghost" data-close-rename-gallery-tag-modal type="button">Cancel</button><button class="btn btn-primary" type="submit">Rename Tab</button></div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
            <dialog class="modal" id="delete-gallery-tag-modal">
                <div class="modal-box">
                    <h2 class="text-xl font-bold">Delete Tab?</h2>
                    <p class="mt-3 text-sm text-base-content/80">This removes that gallery tab and its custom row order. The media stays in All Media.</p>
                    <div class="modal-action"><button class="btn btn-ghost" data-cancel-delete-gallery-tag type="button">Cancel</button><button class="btn btn-error" data-confirm-delete-gallery-tag type="button">Delete Tab</button></div>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
        </>
    )
}

function MediaDialogs({characterName}: { characterName: string }) {
    return (
        <>
            <dialog class="modal" id="delete-media-modal">
                <div class="modal-box">
                    <h2 class="text-xl font-bold">Delete Media?</h2>
                    <p class="mt-3 text-sm text-base-content/80">This removes the media from this character entirely and removes it from every gallery tab.</p>
                    <div class="modal-action"><button class="btn btn-ghost" data-cancel-delete-media type="button">Cancel</button><button class="btn btn-error" data-confirm-delete-media type="button">Delete Media</button></div>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
            <dialog class="modal" id="remove-row-modal">
                <div class="modal-box">
                    <h2 class="text-xl font-bold">Remove Row?</h2>
                    <p class="mt-3 text-sm text-base-content/80">This row contains images. Removing it will delete those images from the gallery too. Move them to another row first if you want to keep them.</p>
                    <div class="modal-action"><button class="btn btn-ghost" data-cancel-remove-row type="button">Cancel</button><button class="btn btn-error" data-confirm-remove-row type="button">Remove Row</button></div>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
            <dialog class="modal" id="edit-image-artist-modal">
                <div class="modal-box">
                    <form method="dialog"><button aria-label="Close artist dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                    <h2 class="text-xl font-bold">Edit Image</h2>
                    <form class="mt-5 space-y-4" id="edit-image-artist-form">
                        <p class="text-sm text-base-content/70">PNG, JPG, WebP, GIF, and AVIF replacements are accepted.
                            Files are stored unmodified.</p>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <fieldset class="fieldset rounded border border-base-300 bg-base-200 p-3">
                                <label class="fieldset-label" for="edit-gallery-image-sfw-file">SFW</label>
                                <div class="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded bg-base-300 text-xs text-base-content/60" data-edit-sfw-preview>No SFW image uploaded</div>
                                <input accept="image/*" class="file-input w-full" id="edit-gallery-image-sfw-file" type="file"/>
                                <button class="btn btn-error btn-outline btn-sm mt-3 w-full" data-remove-edit-sfw type="button">Remove SFW Image</button>
                            </fieldset>
                            <fieldset class="fieldset rounded border border-base-300 bg-base-200 p-3">
                                <label class="fieldset-label" for="edit-gallery-image-nsfw-file">NSFW</label>
                                <div class="mb-3 flex aspect-video items-center justify-center overflow-hidden rounded bg-base-300 text-xs text-base-content/60" data-edit-nsfw-preview>No NSFW image uploaded</div>
                                <input accept="image/*" class="file-input w-full" id="edit-gallery-image-nsfw-file" type="file"/>
                                <button class="btn btn-error btn-outline btn-sm mt-3 w-full" data-remove-edit-nsfw type="button">Remove NSFW Image</button>
                            </fieldset>
                        </div>
                        <div class="grid gap-3 sm:grid-cols-2">
                            <fieldset class="fieldset"><label class="fieldset-label" for="edit-gallery-image-sfw-artist">SFW Credits</label><input class="input input-bordered w-full" id="edit-gallery-image-sfw-artist" maxLength={80} type="text"/></fieldset>
                            <fieldset class="fieldset"><label class="fieldset-label" for="edit-gallery-image-nsfw-artist">NSFW Credits</label><input class="input input-bordered w-full" id="edit-gallery-image-nsfw-artist" maxLength={80} type="text"/></fieldset>
                        </div>
                        <div class="modal-action"><button class="btn btn-ghost" data-close-edit-artist-modal type="button">Cancel</button><button class="btn btn-primary" type="submit">Save Image</button></div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>
            <input hidden readOnly value={characterName}/>
        </>
    )
}

function DeleteCharacterDialog({characterName}: { characterName: string }) {
    return (
        <dialog class="modal" id="delete-character-modal">
            <div class="modal-box">
                <form method="dialog"><button aria-label="Close delete dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button></form>
                <h2 class="text-xl font-bold">Delete Character</h2>
                <p class="mt-3 text-sm text-base-content/80">This will permanently delete this character and its gallery. Type the character name to continue.</p>
                <form class="mt-5 space-y-4" id="delete-character-form">
                    <fieldset class="fieldset">
                        <label class="fieldset-label" for="delete-character-confirm-name">Character Name</label>
                        <input autocomplete="off" class="input input-bordered w-full" id="delete-character-confirm-name"
                               placeholder={characterName} required type="text"/>
                    </fieldset>
                    <label class="label cursor-pointer justify-start gap-3"><input class="checkbox checkbox-error" id="delete-confirm-permanent" type="checkbox"/><span class="label-text">I understand this deletion is permanent.</span></label>
                    <label class="label cursor-pointer justify-start gap-3"><input class="checkbox checkbox-error" id="delete-confirm-final" type="checkbox"/><span class="label-text">I confirm I want to delete this character.</span></label>
                    <div class="modal-action"><button class="btn btn-ghost" data-close-delete-modal type="button">Cancel</button><button class="btn btn-error" disabled id="confirm-delete-character" type="submit">Delete Character</button></div>
                </form>
            </div>
            <form class="modal-backdrop" method="dialog"><button>close</button></form>
        </dialog>
    )
}
