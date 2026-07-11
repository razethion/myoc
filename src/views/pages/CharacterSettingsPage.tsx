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
        forceFullWidth: boolean
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
const tagLayouts = new Map(${safeJson(galleryTabs)}.map((tab) => [tab.id, normalizeInitialGalleryLayout(tab)]));
let activeTagId = ${safeJson(galleryTabs[0]?.id ?? 'default')};
${PROFILE_CROPPER_BROWSER_HELPERS}
let pendingDeleteMediaId = null;
let dragCandidate = null;
let dragState = null;

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
const saveCharacterSettingsButton = document.getElementById('save-character-settings');
const saveCharacterSettingsWarning = document.getElementById('save-character-settings-warning');
const settingsToastRegion = document.querySelector('[data-character-settings-toast-region]');
const characterSettingsForm = document.getElementById('character-settings-form');
const characterTitle = document.querySelector('[data-character-title]');
const characterProfileImageInput = document.getElementById('character-profile-photo');
const characterProfileImagePreview = document.querySelector('[data-character-profile-image-preview]');
const characterProfileCropper = document.querySelector('[data-character-profile-cropper]');
const characterProfileCropImage = document.querySelector('[data-character-profile-crop-image]');
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

function createEmptyGalleryRow() {
    return { id: createId(), mediaIds: [], forceFullWidth: false };
}

function shouldForceRowFullWidth(row, rowIndex, rowCount) {
    return row && Array.isArray(row.mediaIds) && row.mediaIds.length === 1 && (rowIndex < rowCount - 1 || row.forceFullWidth === true);
}

function normalizeRowForceFullWidth(row, rowIndex, rowCount) {
    if (!row) return row;
    if (Number.isInteger(rowIndex) && Number.isInteger(rowCount)) {
        row.forceFullWidth = shouldForceRowFullWidth(row, rowIndex, rowCount);
    } else {
        row.forceFullWidth = row.forceFullWidth === true && Array.isArray(row.mediaIds) && row.mediaIds.length === 1;
    }
    return row;
}

function normalizeLayoutForceFullWidth(layout) {
    if (!layout || !Array.isArray(layout.rows)) return;
    layout.rows.forEach((row, rowIndex) => normalizeRowForceFullWidth(row, rowIndex, layout.rows.length));
}

function normalizeInitialGalleryLayout(tab) {
    const rows = Array.isArray(tab.rows)
        ? tab.rows.map((row) => ({
            id: row && row.id ? String(row.id) : createId(),
            mediaIds: Array.isArray(row && row.mediaIds)
                ? row.mediaIds.filter((mediaId) => typeof mediaId === 'string')
                : [],
            forceFullWidth: Boolean(row && row.forceFullWidth)
        }))
        : [];

    const layout = {
        id: tab && tab.id ? String(tab.id) : createId(),
        name: tab && tab.name ? String(tab.name) : 'default',
        rows: rows.length > 0 ? rows : [createEmptyGalleryRow()]
    };
    normalizeLayoutForceFullWidth(layout);
    return layout;
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
    const layout = tagLayouts.get(activeTagId) || Array.from(tagLayouts.values())[0];
    ensureLayoutRows(layout);
    return layout;
}

function ensureLayoutRows(layout) {
    if (!layout) return;
    if (!Array.isArray(layout.rows)) layout.rows = [];
    if (layout.rows.length === 0) layout.rows.push(createEmptyGalleryRow());
    normalizeLayoutForceFullWidth(layout);
}

function getUsedMediaIds(tagId) {
    const layout = tagLayouts.get(tagId);
    return new Set(layout && Array.isArray(layout.rows) ? layout.rows.flatMap((row) => row.mediaIds) : []);
}

function getActiveUsedMediaIds() {
    return getUsedMediaIds(activeTagId);
}

function getMediaUsageCounts() {
    const counts = new Map();
    mediaLibrary.forEach((_, mediaId) => counts.set(mediaId, 0));
    tagLayouts.forEach((layout) => {
        ensureLayoutRows(layout);
        const usedInTab = new Set(layout.rows.flatMap((row) => row.mediaIds));
        usedInTab.forEach((mediaId) => counts.set(mediaId, (counts.get(mediaId) || 0) + 1));
    });
    return counts;
}

function mediaUsageText(tabCount) {
    if (tabCount === 0) return 'not used';
    return 'Used on ' + tabCount + ' ' + (tabCount === 1 ? 'tab' : 'tabs');
}

function getOverflowRowCount() {
    let count = 0;
    tagLayouts.forEach((layout) => {
        ensureLayoutRows(layout);
        layout.rows.forEach((row) => {
            if (row.mediaIds.length > maxGalleryImagesPerRow) count += 1;
        });
    });
    return count;
}

function getGalleryValidationErrors() {
    const errors = [];
    const overflowRows = getOverflowRowCount();
    if (overflowRows > 0) {
        errors.push('Rows can contain at most ' + maxGalleryImagesPerRow + ' images.');
    }

    if (mediaLibrary.size === 0) {
        return errors;
    }

    const usageCounts = getMediaUsageCounts();
    const unusedCount = Array.from(usageCounts.values()).filter((count) => count === 0).length;
    if (unusedCount > 0) {
        errors.push('Place all media on at least one gallery tab before saving.');
    }

    let blankTabs = 0;
    let emptyRows = 0;
    tagLayouts.forEach((layout) => {
        ensureLayoutRows(layout);
        if (layout.rows.length === 0 || layout.rows.every((row) => row.mediaIds.length === 0)) {
            blankTabs += 1;
        }
        emptyRows += layout.rows.filter((row) => row.mediaIds.length === 0).length;
    });

    if (blankTabs > 0) {
        errors.push('Every tab needs at least one image before saving.');
    }

    if (emptyRows > 0) {
        errors.push('Remove empty rows before saving.');
    }

    return errors;
}

function mediaDisplayUrl(media) {
    return media.nsfwPreviewImageUrl || media.nsfwImageUrl || media.sfwPreviewImageUrl || media.sfwImageUrl || '';
}

function mediaDisplayDimensions(media) {
    const candidates = [
        [media.nsfwPreviewImageUrl, media.nsfwPreviewWidth, media.nsfwPreviewHeight],
        [media.nsfwImageUrl, media.nsfwWidth, media.nsfwHeight],
        [media.sfwPreviewImageUrl, media.sfwPreviewWidth, media.sfwPreviewHeight],
        [media.sfwImageUrl, media.sfwWidth, media.sfwHeight]
    ];
    const match = candidates.find(([url, width, height]) => url && Number(width) > 0 && Number(height) > 0);
    return {
        width: Number(match ? match[1] : 1) || 1,
        height: Number(match ? match[2] : 1) || 1
    };
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

function createPoolMediaThumb(media, usedInActiveTab, tabUsageCount) {
    const item = document.createElement('div');
    item.className = 'media-pool-item group w-[calc((100%_-_1.5rem)/3)] sm:w-24';
    item.dataset.mediaId = media.id;
    item.dataset.galleryDraggable = usedInActiveTab ? 'false' : 'true';
    item.dataset.gallerySource = 'pool';
    item.tabIndex = 0;
    item.title = usedInActiveTab ? 'Already used in the active tab' : 'Drag into the active gallery tab';
    item.setAttribute('aria-disabled', usedInActiveTab ? 'true' : 'false');

    const thumb = document.createElement('div');
    thumb.className = 'relative aspect-square overflow-hidden rounded bg-base-300';

    const image = document.createElement('img');
    image.className = 'h-full w-full object-cover';
    image.alt = mediaAlt(media);
    image.dataset.mediaThumbImage = '';
    image.decoding = 'async';
    image.loading = 'lazy';
    image.src = mediaDisplayUrl(media);

    const editButton = document.createElement('button');
    editButton.ariaLabel = 'Edit image settings';
    editButton.className = 'btn btn-neutral btn-sm btn-circle absolute left-1 top-1 z-10 min-h-8 h-8 w-8 opacity-95 sm:btn-xs sm:min-h-6 sm:h-6 sm:w-6';
    editButton.dataset.editImageArtist = '';
    editButton.type = 'button';
    editButton.innerHTML = '<svg aria-hidden="true" class="h-4 w-4 sm:h-3 sm:w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M16.862 3.487a2.1 2.1 0 0 1 2.97 2.97L8.76 17.53 4.5 18.75l1.22-4.26L16.862 3.487z" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>';

    const removeButton = document.createElement('button');
    removeButton.ariaLabel = 'Delete media';
    removeButton.className = 'btn btn-error btn-sm btn-circle absolute right-1 top-1 z-10 min-h-8 h-8 w-8 opacity-95 sm:btn-xs sm:min-h-6 sm:h-6 sm:w-6';
    removeButton.dataset.removeImage = '';
    removeButton.type = 'button';
    removeButton.textContent = 'x';

    thumb.append(image, editButton, removeButton, createImageRatingBadge(media));
    const usage = document.createElement('div');
    usage.className = 'mt-1 rounded px-1.5 py-1 text-center text-[0.65rem] font-bold leading-tight ' + (tabUsageCount > 0 ? 'bg-success text-success-content' : 'bg-warning text-warning-content');
    usage.textContent = mediaUsageText(tabUsageCount);
    item.append(thumb, usage);
    return item;
}

function createRowMediaThumb(media, rowIndex) {
    const item = document.createElement('div');
    const dimensions = mediaDisplayDimensions(media);
    item.className = 'gallery-row-media group';
    item.dataset.mediaId = media.id;
    item.dataset.galleryDraggable = 'true';
    item.dataset.gallerySource = 'row';
    item.dataset.rowIndex = String(rowIndex);
    item.style.setProperty('--media-width', String(dimensions.width));
    item.style.setProperty('--media-height', String(dimensions.height));
    item.style.setProperty('--media-aspect', String(dimensions.width / dimensions.height));
    item.tabIndex = 0;
    item.title = 'Drag to move image';

    const image = document.createElement('img');
    image.className = 'gallery-row-image';
    image.alt = mediaAlt(media);
    image.decoding = 'async';
    image.loading = 'lazy';
    image.src = mediaDisplayUrl(media);

    const removeButton = document.createElement('button');
    removeButton.ariaLabel = 'Remove image from row';
    removeButton.className = 'btn btn-error btn-xs btn-circle gallery-row-remove-image opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100';
    removeButton.dataset.removeRowImage = '';
    removeButton.type = 'button';
    removeButton.textContent = 'x';

    item.append(image, removeButton, createImageRatingBadge(media));
    return item;
}

function renderMediaPool() {
    const usedInActiveTab = getActiveUsedMediaIds();
    const usageCounts = getMediaUsageCounts();
    mediaPool.replaceChildren();
    mediaLibrary.forEach((media) => {
        mediaPool.append(createPoolMediaThumb(media, usedInActiveTab.has(media.id), usageCounts.get(media.id) || 0));
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
    const layout = getActiveLayout();
    const rows = layout.rows;
    const targetIndex = rowIndex + direction;
    if (rowIndex < 0 || targetIndex < 0 || rowIndex >= rows.length || targetIndex >= rows.length) return false;
    const [row] = rows.splice(rowIndex, 1);
    rows.splice(targetIndex, 0, row);
    normalizeLayoutForceFullWidth(layout);
    return true;
}

function insertActiveGalleryRow(rowIndex) {
    const layout = getActiveLayout();
    const rows = layout.rows;
    rows.splice(Math.max(0, Math.min(rowIndex, rows.length)), 0, createEmptyGalleryRow());
    normalizeLayoutForceFullWidth(layout);
}

function removeActiveGalleryRow(rowIndex) {
    const layout = getActiveLayout();
    const rows = layout.rows;
    if (rows.length <= 1 || rowIndex < 0 || rowIndex >= rows.length) return false;
    rows.splice(rowIndex, 1);
    normalizeLayoutForceFullWidth(layout);
    return true;
}

function removeFromActiveRow(rowIndex, mediaId) {
    const layout = getActiveLayout();
    const row = layout.rows[rowIndex];
    if (!row) return false;
    row.mediaIds = row.mediaIds.filter((id) => id !== mediaId);
    normalizeLayoutForceFullWidth(layout);
    return true;
}

function createRowControlButton(label, text, className, dataset) {
    const button = document.createElement('button');
    button.ariaLabel = label;
    button.className = className;
    button.type = 'button';
    button.textContent = text;
    Object.entries(dataset).forEach(([key, value]) => {
        button.dataset[key] = String(value);
    });
    return button;
}

function renderRows() {
    const layout = getActiveLayout();
    normalizeLayoutForceFullWidth(layout);
    galleryRows.replaceChildren();
    layout.rows.forEach((rowData, rowIndex) => {
        const shell = document.createElement('div');
        shell.className = 'gallery-row-editor';
        shell.dataset.galleryRow = String(rowIndex);

        const preview = document.createElement('div');
        preview.className = 'gallery-row-preview justified-row' + (rowData.forceFullWidth ? ' row-force-full-width' : '');
        preview.dataset.dropzone = '';
        preview.dataset.rowIndex = String(rowIndex);

        if (rowData.mediaIds.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'gallery-row-empty';
            empty.textContent = 'Drop images here';
            preview.append(empty);
        } else {
            rowData.mediaIds.forEach((mediaId) => {
                const media = mediaLibrary.get(mediaId);
                if (media) preview.append(createRowMediaThumb(media, rowIndex));
            });
        }

        const controls = document.createElement('div');
        controls.className = 'gallery-row-controls';
        const count = document.createElement('span');
        count.className = 'badge badge-dash ' + (rowData.mediaIds.length > maxGalleryImagesPerRow ? 'badge-error' : 'badge-info');
        count.textContent = rowData.mediaIds.length + '/' + maxGalleryImagesPerRow;
        const forceFullWidthLabel = document.createElement('label');
        forceFullWidthLabel.className = 'gallery-row-force-full-width label cursor-pointer justify-start gap-2 rounded border border-base-300 bg-base-100 px-2 py-1 text-xs font-semibold';
        const forceFullWidthInput = document.createElement('input');
        forceFullWidthInput.className = 'checkbox checkbox-sm';
        forceFullWidthInput.checked = rowData.forceFullWidth === true;
        forceFullWidthInput.dataset.toggleForceFullWidth = '';
        forceFullWidthInput.type = 'checkbox';
        const forceFullWidthText = document.createElement('span');
        forceFullWidthText.className = 'label-text text-xs';
        forceFullWidthText.textContent = 'Force full width';
        forceFullWidthLabel.append(forceFullWidthInput, forceFullWidthText);
        const moveUpButton = createRowControlButton('Move row up', 'Move Up', 'btn btn-sm btn-secondary', { moveRow: -1 });
        moveUpButton.disabled = rowIndex === 0;
        const moveDownButton = createRowControlButton('Move row down', 'Move Down', 'btn btn-sm btn-secondary', { moveRow: 1 });
        moveDownButton.disabled = rowIndex === layout.rows.length - 1;
        const addAboveButton = createRowControlButton('Add row above', '+ Above', 'btn btn-sm btn-secondary', { insertRow: rowIndex });
        const addBelowButton = createRowControlButton('Add row below', '+ Below', 'btn btn-sm btn-secondary', { insertRow: rowIndex + 1 });
        const deleteButton = createRowControlButton('Delete row', 'Delete', 'btn btn-sm btn-error', { deleteRow: rowIndex });
        deleteButton.disabled = layout.rows.length === 1;
        controls.append(count);
        if (rowData.mediaIds.length === 1 && rowIndex === layout.rows.length - 1) controls.append(forceFullWidthLabel);
        controls.append(moveUpButton, moveDownButton, addAboveButton, addBelowButton, deleteButton);

        shell.append(preview, controls);
        galleryRows.append(shell);
    });
}

function renderActiveGalleryTabPanel() {
    const layout = getActiveLayout();
    activeGalleryTagTitle.textContent = displayGalleryTabName(layout.name);
    activeGalleryTagMeta.textContent = layout.rows.length + (layout.rows.length === 1 ? ' row' : ' rows') + ' / ' + getActiveUsedMediaIds().size + ' images';
    updateActiveTabControls();
}

function renderGallery() {
    const validationErrors = getGalleryValidationErrors();
    renderTabs();
    renderRows();
    renderActiveGalleryTabPanel();
    renderMediaPool();
    saveCharacterSettingsButton.disabled = tagLayouts.size === 0 || validationErrors.length > 0;
    if (saveCharacterSettingsWarning) {
        saveCharacterSettingsWarning.hidden = validationErrors.length === 0;
        saveCharacterSettingsWarning.textContent = validationErrors.join(' ');
    }
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
        targetRow = createEmptyGalleryRow();
        layout.rows.push(targetRow);
    }
    targetRow.mediaIds.push(result.media.id);
    normalizeLayoutForceFullWidth(layout);
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
        ensureLayoutRows(layout);
        layout.rows.forEach((row) => {
            row.mediaIds = row.mediaIds.filter((id) => id !== mediaId);
        });
        normalizeLayoutForceFullWidth(layout);
    });
}

galleryRows.addEventListener('click', (event) => {
    const mediaItem = event.target.closest('[data-media-id]');
    const rowShell = event.target.closest('[data-gallery-row]');
    const removeImageButton = event.target.closest('[data-remove-row-image]');
    const moveRowButton = event.target.closest('[data-move-row]');
    const insertRowButton = event.target.closest('[data-insert-row]');
    const deleteRowButton = event.target.closest('[data-delete-row]');

    if (removeImageButton && mediaItem && rowShell) {
        removeFromActiveRow(Number(rowShell.dataset.galleryRow), mediaItem.dataset.mediaId);
        renderGallery();
        return;
    }

    if (moveRowButton && rowShell) {
        if (moveActiveGalleryRow(Number(rowShell.dataset.galleryRow), Number(moveRowButton.dataset.moveRow))) renderGallery();
        return;
    }

    if (insertRowButton) {
        insertActiveGalleryRow(Number(insertRowButton.dataset.insertRow));
        renderGallery();
        return;
    }

    if (deleteRowButton && rowShell) {
        if (removeActiveGalleryRow(Number(rowShell.dataset.galleryRow))) renderGallery();
    }
});

galleryRows.addEventListener('change', (event) => {
    const forceFullWidthInput = event.target.closest('[data-toggle-force-full-width]');
    if (!forceFullWidthInput) return;
    const rowShell = forceFullWidthInput.closest('[data-gallery-row]');
    if (!rowShell) return;
    const layout = getActiveLayout();
    const rowIndex = Number(rowShell.dataset.galleryRow);
    const row = layout.rows[rowIndex];
    if (!row) return;
    row.forceFullWidth = forceFullWidthInput.checked === true && row.mediaIds.length === 1;
    normalizeLayoutForceFullWidth(layout);
    renderGallery();
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

function getDragItem(target) {
    const item = target.closest('[data-gallery-draggable]');
    return item && item.dataset.galleryDraggable === 'true' ? item : null;
}

function createDragGhost(source, x, y) {
    const rect = source.getBoundingClientRect();
    const ghost = document.createElement('div');
    ghost.className = 'gallery-drag-ghost';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.transform = 'translate3d(' + (x - rect.width / 2) + 'px,' + (y - rect.height / 2) + 'px,0)';
    const image = source.querySelector('img');
    if (image) {
        const ghostImage = image.cloneNode();
        ghost.append(ghostImage);
    }
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

function rowMediaElements(dropzone) {
    return Array.from(dropzone.querySelectorAll('.gallery-row-media:not(.gallery-drag-source)'));
}

function getDropIndexForPoint(dropzone, x) {
    const images = rowMediaElements(dropzone);
    if (images.length === 0) return 0;
    for (let index = 0; index < images.length; index += 1) {
        const rect = images[index].getBoundingClientRect();
        if (x < rect.left + rect.width / 2) return index;
    }
    return images.length;
}

function updateDropMarker(x, y) {
    if (!dragState) return;
    const target = document.elementFromPoint(x, y);
    const dropzone = target ? target.closest('[data-dropzone]') : null;
    document.querySelectorAll('.gallery-row-preview.drop-active').forEach((zone) => zone.classList.remove('drop-active'));
    if (!dropzone) {
        dragState.drop = null;
        dragState.marker.remove();
        return;
    }
    const rowIndex = Number(dropzone.dataset.rowIndex);
    const insertIndex = getDropIndexForPoint(dropzone, x);
    dragState.drop = { rowIndex, insertIndex };
    dropzone.classList.add('drop-active');
    const images = rowMediaElements(dropzone);
    const beforeImage = images[insertIndex];
    if (beforeImage) {
        dropzone.insertBefore(dragState.marker, beforeImage);
    } else if (images.length === 0 && dropzone.firstChild) {
        dropzone.insertBefore(dragState.marker, dropzone.firstChild);
    } else {
        dropzone.append(dragState.marker);
    }
}

function startGalleryDrag(candidate, event) {
    dragState = {
        type: candidate.type,
        mediaId: candidate.mediaId,
        rowIndex: candidate.rowIndex,
        ghost: createDragGhost(candidate.source, event.clientX, event.clientY),
        marker: document.createElement('div'),
        drop: null
    };
    dragState.marker.className = 'gallery-drop-marker';
    candidate.source.classList.add('gallery-drag-source');
    document.body.classList.add('gallery-is-dragging');
    moveDragGhost(event.clientX, event.clientY);
    updateDropMarker(event.clientX, event.clientY);
}

function cleanupGalleryDrag() {
    document.body.classList.remove('gallery-is-dragging');
    document.querySelectorAll('.gallery-drag-source').forEach((item) => item.classList.remove('gallery-drag-source'));
    document.querySelectorAll('.gallery-row-preview.drop-active').forEach((zone) => zone.classList.remove('drop-active'));
    if (dragState) {
        dragState.ghost.remove();
        dragState.marker.remove();
    }
    dragState = null;
    dragCandidate = null;
}

function moveMediaToDrop() {
    if (!dragState || !dragState.drop) return false;
    const layout = getActiveLayout();
    const targetRow = layout.rows[dragState.drop.rowIndex];
    const mediaId = dragState.mediaId;
    if (!targetRow || !mediaLibrary.has(mediaId)) return false;

    const sourceRow = dragState.type === 'row' ? layout.rows[dragState.rowIndex] : null;
    const isSameRowMove = sourceRow === targetRow;
    if (!isSameRowMove && targetRow.mediaIds.length >= maxGalleryImagesPerRow) {
        showAlert('Rows can contain at most ' + maxGalleryImagesPerRow + ' images.', false);
        return false;
    }
    if (dragState.type === 'pool' && getActiveUsedMediaIds().has(mediaId)) {
        return false;
    }

    if (sourceRow) {
        sourceRow.mediaIds = sourceRow.mediaIds.filter((id) => id !== mediaId);
    }
    const insertIndex = Math.max(0, Math.min(dragState.drop.insertIndex, targetRow.mediaIds.length));
    targetRow.mediaIds.splice(insertIndex, 0, mediaId);
    normalizeLayoutForceFullWidth(layout);
    return true;
}

function beginGalleryDragCandidate(event) {
    if (event.button !== undefined && event.button !== 0) return;
    if (event.target.closest('[data-edit-image-artist],[data-remove-image],[data-remove-row-image],button,a,input,textarea,select')) return;
    const item = getDragItem(event.target);
    if (!item) return;
    event.preventDefault();
    const row = item.closest('[data-gallery-row]');
    dragCandidate = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        source: item,
        type: item.dataset.gallerySource,
        mediaId: item.dataset.mediaId,
        rowIndex: row ? Number(row.dataset.galleryRow) : null
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
    if (dragState && moveMediaToDrop()) {
        cleanupGalleryDrag();
        renderGallery();
        return;
    }
    cleanupGalleryDrag();
}

function preventNativeGalleryDrag(event) {
    if (event.target.closest('[data-gallery-draggable]')) event.preventDefault();
}

galleryRows.addEventListener('dragstart', preventNativeGalleryDrag);
mediaPool.addEventListener('dragstart', preventNativeGalleryDrag);
galleryRows.addEventListener('pointerdown', beginGalleryDragCandidate);
mediaPool.addEventListener('pointerdown', beginGalleryDragCandidate);
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

galleryTagForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = normalizeTagName(galleryTagNameInput.value);
    if (!name) return;
    const id = createId();
    tagLayouts.set(id, { id, name, rows: [createEmptyGalleryRow()] });
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
    const validationErrors = getGalleryValidationErrors();
    if (validationErrors.length > 0) {
        renderGallery();
        showAlert(validationErrors[0], false);
        return;
    }
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
                tabs: Array.from(tagLayouts.values()).map((layout) => ({
                    id: layout.id,
                    name: layout.name,
                    rows: layout.rows.map((row, rowIndex) => ({
                        id: row.id,
                        mediaIds: row.mediaIds,
                        forceFullWidth: shouldForceRowFullWidth(row, rowIndex, layout.rows.length)
                    }))
                }))
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

if (tagLayouts.size === 0) {
    const defaultTabId = createId();
    tagLayouts.set(defaultTabId, { id: defaultTabId, name: 'default', rows: [createEmptyGalleryRow()] });
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
            <main class="container mx-auto max-w-7xl px-3 py-6 sm:px-4">
                <style>{`
                    .media-pool-item { contain: layout paint; touch-action: none; user-select: none; }
                    .media-pool-item[aria-disabled="true"] [data-media-thumb-image] { cursor: not-allowed; filter: grayscale(1); opacity: 0.38; }
                    .media-pool-item [data-media-thumb-image] { pointer-events: none; user-select: none; }
                    .gallery-row-list { display: flex; flex-direction: column; gap: 0.85rem; }
                    .gallery-row-editor { align-items: stretch; display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); }
                    .gallery-row-preview { align-items: stretch; background: color-mix(in oklab, var(--color-base-100) 72%, var(--color-base-200)); border: 1px solid var(--color-base-300); border-radius: var(--radius-box, 0.5rem); display: flex; gap: 0.5rem; min-height: clamp(6rem, 15vw, 13.5rem); overflow: hidden; padding: 0.4rem; position: relative; width: 100%; }
                    .gallery-row-preview.drop-active { border-color: white; box-shadow: 0 0 0 2px color-mix(in oklab, white 55%, transparent); }
                    .gallery-row-media { aspect-ratio: var(--media-width) / var(--media-height); background: var(--color-base-300); border-radius: calc(var(--radius-field, 0.25rem) + 0.1rem); cursor: grab; flex: var(--media-aspect) 1 0; min-width: 0; overflow: hidden; position: relative; touch-action: none; user-select: none; }
                    .gallery-row-preview:not(.row-force-full-width) .gallery-row-media:only-child { flex: 0 1 min(100%, 34rem); }
                    .gallery-row-preview.row-force-full-width .gallery-row-media:only-child { flex: 1 1 100%; max-width: none; width: 100%; }
                    .gallery-row-media:active { cursor: grabbing; }
                    .gallery-row-image { display: block; height: 100%; object-fit: contain; pointer-events: none; user-select: none; width: 100%; }
                    .gallery-row-remove-image { position: absolute; right: 0.35rem; top: 0.35rem; z-index: 3; }
                    .gallery-row-empty { align-items: center; border: 1px dashed color-mix(in oklab, var(--color-base-content) 32%, transparent); border-radius: var(--radius-field, 0.25rem); color: color-mix(in oklab, var(--color-base-content) 62%, transparent); display: flex; flex: 1 1 auto; font-size: 0.85rem; font-weight: 700; justify-content: center; min-height: 5rem; text-transform: uppercase; }
                    .gallery-row-controls { align-content: flex-start; align-items: center; display: flex; flex-wrap: wrap; gap: 0.4rem; }
                    .gallery-row-controls .badge { height: 2rem; min-width: 4rem; }
                    .gallery-row-controls .btn { min-height: 2rem; }
                    .gallery-row-force-full-width { min-height: 2rem; width: auto; }
                    .gallery-drop-marker { align-self: stretch; border-left: 3px solid white; box-shadow: 0 0 0.85rem rgb(255 255 255 / 0.8); flex: 0 0 0; min-height: 5rem; pointer-events: none; z-index: 4; }
                    .gallery-drag-source { opacity: 0.35; }
                    .gallery-drag-ghost { border-radius: var(--radius-field, 0.25rem); box-shadow: 0 1rem 2.5rem rgb(0 0 0 / 0.42); left: 0; opacity: 0.9; overflow: hidden; pointer-events: none; position: fixed; top: 0; z-index: 9999; }
                    .gallery-drag-ghost img { display: block; height: 100%; object-fit: cover; width: 100%; }
                    .gallery-is-dragging, .gallery-is-dragging * { cursor: grabbing !important; }
                    @media (min-width: 40rem) {
                        .gallery-row-editor { grid-template-columns: minmax(0, 1fr) 10rem; }
                        .gallery-row-controls { align-items: stretch; flex-direction: column; }
                        .gallery-row-controls .btn, .gallery-row-controls .badge, .gallery-row-force-full-width { width: 100%; }
                    }
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
                        <img alt="Current character portrait"
                             class="h-14 w-14 shrink-0 rounded object-cover sm:h-16 sm:w-16"
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
                            <img alt="Crop character portrait" class="block max-h-88 w-full object-contain"
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
                                <h2 class="text-2xl font-bold">Gallery</h2>
                                <p class="text-sm text-base-content/70">Upload PNG, JPG, WebP, GIF, AVIF, or other
                                    browser-supported images, then manage the gallery tabs.</p>
                            </div>
                            <div class="flex flex-wrap items-center justify-end gap-3">
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
                                <h3 class="text-lg font-semibold">Gallery Tabs</h3>
                                <p class="text-sm text-base-content/70">Create, rename, delete, and reorder the tabs
                                    shown on this character gallery.</p>
                            </div>
                            <div aria-label="Gallery layout tabs"
                                 class="gallery-layout-tabs tabs tabs-border flex-nowrap overflow-x-auto"
                                 id="gallery-tag-tabs" role="tablist"></div>
                            <div class="gallery-layout-panel rounded-box border border-base-300 bg-base-200 p-4">
                                <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h4 class="font-semibold" id="active-gallery-tag-title">Default</h4>
                                        <p class="text-sm text-base-content/70" id="active-gallery-tag-meta">0 rows / 0
                                            images</p>
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
                                    </div>
                                </div>
                                <div class="gallery-row-list" id="gallery-rows"></div>
                            </div>
                        </div>
                    </section>

                    <div class="mt-8 flex flex-col items-end gap-2">
                        <button class="btn btn-primary" id="save-character-settings" type="submit">Save Changes</button>
                        <p class="max-w-xl text-right text-sm font-semibold text-warning" hidden
                           id="save-character-settings-warning"></p>
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
                <form method="dialog">
                    <button aria-label="Close upload dialog"
                            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                    </button>
                </form>
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
            <form class="modal-backdrop" method="dialog">
                <button type="submit">close</button>
            </form>
        </dialog>
    )
}

function BulkUploadDialog() {
    return (
        <dialog class="modal" id="bulk-upload-modal">
            <div class="modal-box max-w-3xl">
                <form method="dialog">
                    <button aria-label="Close bulk upload dialog"
                            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                    </button>
                </form>
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
                    <form method="dialog">
                        <button aria-label="Close tag dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Add Gallery Tab</h2>
                    <form class="mt-5 space-y-4" id="gallery-tag-form">
                        <fieldset class="fieldset"><label class="fieldset-label" for="gallery-tag-name">Tab Name</label><input class="input input-bordered w-full" id="gallery-tag-name" maxLength={32} required type="text"/></fieldset>
                        <div class="modal-action"><button class="btn btn-ghost" data-close-gallery-tag-modal type="button">Cancel</button><button class="btn btn-primary" type="submit">Add Tab</button></div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>
            <dialog class="modal" id="rename-gallery-tag-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close rename tab dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Rename Gallery Tab</h2>
                    <form class="mt-5 space-y-4" id="rename-gallery-tag-form">
                        <fieldset class="fieldset"><label class="fieldset-label" for="rename-gallery-tag-name">Tab Name</label><input class="input input-bordered w-full" id="rename-gallery-tag-name" maxLength={32} required type="text"/></fieldset>
                        <div class="modal-action"><button class="btn btn-ghost" data-close-rename-gallery-tag-modal type="button">Cancel</button><button class="btn btn-primary" type="submit">Rename Tab</button></div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>
            <dialog class="modal" id="delete-gallery-tag-modal">
                <div class="modal-box">
                    <h2 class="text-xl font-bold">Delete Tab?</h2>
                    <p class="mt-3 text-sm text-base-content/80">This removes that gallery tab. The media stays in All
                        Media.</p>
                    <div class="modal-action"><button class="btn btn-ghost" data-cancel-delete-gallery-tag type="button">Cancel</button><button class="btn btn-error" data-confirm-delete-gallery-tag type="button">Delete Tab</button></div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
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
                    <p class="mt-3 text-sm text-base-content/80">This removes the media from this character
                        entirely.</p>
                    <div class="modal-action"><button class="btn btn-ghost" data-cancel-delete-media type="button">Cancel</button><button class="btn btn-error" data-confirm-delete-media type="button">Delete Media</button></div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>
            <dialog class="modal" id="edit-image-artist-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close artist dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
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
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>
            <input hidden readOnly value={characterName}/>
        </>
    )
}

function DeleteCharacterDialog({characterName}: { characterName: string }) {
    return (
        <dialog class="modal" id="delete-character-modal">
            <div class="modal-box">
                <form method="dialog">
                    <button aria-label="Close delete dialog"
                            class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                    </button>
                </form>
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
            <form class="modal-backdrop" method="dialog">
                <button type="submit">close</button>
            </form>
        </dialog>
    )
}
