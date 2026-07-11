import type {CurrentUser} from '../../lib/auth/session'
import {characterFolderImageUrl, characterProfileImageUrl} from '../../lib/media/url'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'
import {PROFILE_CROPPER_BROWSER_HELPERS} from '../profileCropperScript'

export type CharacterManagementFolder = {
    id: string
    name: string
    parentFolderId: string | null
    folderImageKey: string | null
    folderImageUrl: string | null
    sortOrder: number
}

export type CharacterManagementCharacter = {
    id: string
    name: string
    profileImageKey: string
    profileImageUrl: string
    folderId: string | null
    sortOrder: number
}

export type CharacterFolderPlacement = {
    folderId: string
    characterId: string
    sortOrder: number
}

type CharacterManagementPageProps = {
    currentUser: CurrentUser
    folders: CharacterManagementFolder[]
    characters: CharacterManagementCharacter[]
    placements: CharacterFolderPlacement[]
    uploadedImageCount: number
    mediaBaseUrl: string
}

type CharacterManagementFolderTreeItem = CharacterManagementFolder & {
    children: CharacterManagementFolderTreeItem[]
}

function buildFolderTree(
    folders: CharacterManagementFolder[],
    parentFolderId: string | null = null,
): CharacterManagementFolderTreeItem[] {
    return folders
        .filter((folder) => folder.parentFolderId === parentFolderId)
        .sort(compareOrderedNames)
        .map((folder) => ({
            ...folder,
            children: buildFolderTree(folders, folder.id),
        }))
}

function compareOrderedNames(left: { sortOrder: number; name: string }, right: {
    sortOrder: number;
    name: string
}): number {
    return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

const CHARACTER_NAME_INPUT_PATTERN = String.raw`(?=.*[A-Za-z0-9])[A-Za-z0-9 _'.\(\)"\-]+`
const CHARACTER_NAME_INPUT_TITLE = 'Use letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses. Include at least one letter or number.'

function CharacterManagementStyles() {
    return (
        <style>{`
            .management-shell {
                background:
                    radial-gradient(circle at top left, color-mix(in oklab, currentColor 7%, transparent), transparent 28rem),
                    linear-gradient(135deg, color-mix(in oklab, currentColor 4%, transparent), transparent 32rem);
            }
            .management-item[aria-grabbed="true"] { opacity: 0.48; }
            .drag-handle {
                align-items: center;
                cursor: grab;
                display: inline-flex;
                justify-content: center;
                line-height: 1;
                min-height: 2.5rem;
                min-width: 2.25rem;
                touch-action: none;
                user-select: none;
            }
            .management-item[aria-grabbed="true"] .drag-handle { cursor: grabbing; }
            .management-drag-ghost {
                box-sizing: border-box;
                left: 0;
                opacity: 0.9;
                pointer-events: none;
                position: fixed;
                top: 0;
                z-index: 90;
            }
            .management-is-dragging,
            .management-is-dragging * {
                cursor: grabbing !important;
                user-select: none;
            }
            .folder-drop-marker {
                position: fixed;
                z-index: 80;
                height: 2px;
                border-radius: 999px;
                background: currentColor;
                box-shadow: 0 0 0 1px color-mix(in oklab, currentColor 16%, transparent), 0 0 18px color-mix(in oklab, currentColor 35%, transparent);
                pointer-events: none;
            }
            .character-drop-marker {
                border-radius: 999px;
                background: currentColor;
                box-shadow: 0 0 0 1px color-mix(in oklab, currentColor 16%, transparent), 0 0 18px color-mix(in oklab, currentColor 35%, transparent);
                height: 3px;
                margin-block: 0.35rem;
                pointer-events: none;
            }
            .folder-row.drag-over,
            .character-dropzone.drag-over,
            .profile-dropzone.drag-over {
                outline: 2px dashed currentColor;
                outline-offset: 4px;
            }
            .folder-row.drag-over {
                background: color-mix(in oklab, currentColor 9%, transparent);
            }
            .folder-tree-children {
                margin-left: clamp(0.875rem, 2.5vw, 1.35rem);
                padding-left: 0.75rem;
                border-left: 1px solid color-mix(in oklab, currentColor 14%, transparent);
            }
            .folder-dropzone:empty::before,
            .character-dropzone:empty::before,
            .profile-dropzone:empty::before {
                display: block;
                color: color-mix(in oklab, currentColor 55%, transparent);
                font-size: 0.875rem;
                padding: 0.75rem;
            }
            .folder-dropzone:empty::before { content: "Drop folders here"; }
            .character-dropzone:empty::before { content: "Add characters to this folder"; }
            .profile-dropzone:empty::before { content: "Create a character to start ordering your profile"; }
            .folder-dropzone,
            .character-dropzone,
            .profile-dropzone { min-height: 3rem; }
            #create-character-modal {
                align-items: flex-start;
                overflow-y: auto;
                --create-character-modal-top-space: max(4rem, calc(env(safe-area-inset-top) + 3rem));
                --create-character-modal-bottom-space: max(6rem, calc(env(safe-area-inset-bottom) + 5rem));
                padding: var(--create-character-modal-top-space) 0.75rem var(--create-character-modal-bottom-space);
            }
            #create-character-modal .modal-box {
                margin: 0;
                max-height: calc(100dvh - var(--create-character-modal-top-space) - var(--create-character-modal-bottom-space));
                max-height: calc(100svh - var(--create-character-modal-top-space) - var(--create-character-modal-bottom-space));
                overflow-y: auto;
                overscroll-behavior: contain;
                padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
            }
            [data-character-profile-cropper] cropper-canvas,
            [data-new-folder-image-cropper] cropper-canvas,
            [data-edit-folder-image-cropper] cropper-canvas {
                display: block;
                height: min(62dvh, 34rem) !important;
                min-height: 24rem;
                width: 100%;
            }
            @media (min-width: 640px) {
                #create-character-modal { align-items: center; padding: 1rem; }
                #create-character-modal .modal-box { max-height: calc(100dvh - 2rem); }
            }
            .toast-message { animation: toast-fade 2600ms ease forwards; }
            @keyframes toast-fade {
                0%, 80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(0.5rem); }
            }
        `}</style>
    )
}

function CharacterManagementScript({
                                       characters,
                                       csrfToken,
                                       folders,
                                       placements,
                                   }: {
    characters: CharacterManagementCharacter[]
    csrfToken: string
    folders: CharacterManagementFolder[]
    placements: CharacterFolderPlacement[]
}) {
    const foldersJson = JSON.stringify(folders).replace(/</g, '\\u003c')
    const charactersJson = JSON.stringify(characters).replace(/</g, '\\u003c')
    const placementsJson = JSON.stringify(placements).replace(/</g, '\\u003c')
    const initialSelectedFolderId = folders[0]?.id ?? null
    const script = `
        const csrfToken = ${JSON.stringify(csrfToken)};
        let folders = ${foldersJson};
        let characters = ${charactersJson};
        let placements = ${placementsJson};
        let selectedFolderId = ${JSON.stringify(initialSelectedFolderId)};
        let dragged = null;
        let deleteTargetCharacterId = null;
        let deleteTargetCharacterName = '';
        let deleteTargetFolderId = null;
        let editTargetFolderId = null;
        let editFolderRemoveImage = false;
        let characterProfileCropperInstance = null;
        let characterProfileObjectUrl = null;
        const editFolderImageCropState = { cropper: null, objectUrl: null };
        const newFolderImageCropState = { cropper: null, objectUrl: null };
        let currentFolderNestRow = null;
        let currentFolderSortKey = '';
        let currentCharacterSortKey = '';
        let pointerDragCandidate = null;
        let pointerDragState = null;
        ${PROFILE_CROPPER_BROWSER_HELPERS}

        const folderDropMarker = document.createElement('div');
        folderDropMarker.className = 'folder-drop-marker';
        const characterDropMarker = document.createElement('div');
        characterDropMarker.className = 'character-drop-marker';

        const folderTreeRoot = document.getElementById('folder-tree-root');
        const folderCount = document.getElementById('folder-count');
        const characterCount = document.getElementById('character-count');
        const profileCharacterList = document.getElementById('profile-character-list');
        const selectedFolderPanel = document.getElementById('selected-folder-panel');
        const createCharacterModal = document.getElementById('create-character-modal');
        const createCharacterForm = document.getElementById('create-character-form');
        const createFolderModal = document.getElementById('create-folder-modal');
        const createFolderForm = document.getElementById('create-folder-form');
        const editFolderModal = document.getElementById('edit-folder-modal');
        const editFolderForm = document.getElementById('edit-folder-form');
        const deleteCharacterModal = document.getElementById('delete-character-modal');
        const deleteCharacterForm = document.getElementById('delete-character-form');
        const deleteFolderModal = document.getElementById('delete-folder-modal');
        const toastRegion = document.getElementById('toast-region');
        const characterProfileInput = document.getElementById('new-character-profile-image');
        const characterProfileCropper = document.querySelector('[data-character-profile-cropper]');
        const characterProfileCropImage = document.querySelector('[data-character-profile-crop-image]');
        const editFolderImageInput = document.getElementById('edit-folder-image');
        const editFolderImageCropper = document.querySelector('[data-edit-folder-image-cropper]');
        const editFolderImageCropImage = document.querySelector('[data-edit-folder-image-crop-image]');
        const editFolderCurrentImage = document.querySelector('[data-edit-folder-current-image]');
        const editFolderCurrentImageFrame = document.querySelector('[data-edit-folder-current-image-frame]');
        const editFolderRemoveImageButton = document.querySelector('[data-remove-edit-folder-image]');
        const newFolderImageInput = document.getElementById('new-folder-image');
        const newFolderImageCropper = document.querySelector('[data-new-folder-image-cropper]');
        const newFolderImageCropImage = document.querySelector('[data-new-folder-image-crop-image]');

        function escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        }

        function normalizeFolderId(value) {
            return value && value !== 'root' ? value : null;
        }

        function compareOrderedNames(left, right) {
            return (left.sortOrder || 0) - (right.sortOrder || 0) || left.name.localeCompare(right.name);
        }

        function pluralize(count, singular, plural) {
            return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
        }

        function characterById(characterId) {
            return characters.find((character) => character.id === characterId) || null;
        }

        function folderById(folderId) {
            return folders.find((folder) => folder.id === folderId) || null;
        }

        function folderChildren(parentFolderId) {
            const normalizedParent = normalizeFolderId(parentFolderId);
            return folders
                .filter((folder) => folder.parentFolderId === normalizedParent)
                .sort(compareOrderedNames);
        }

        function folderThumbnailHtml(folder, sizeClass) {
            if (folder.folderImageUrl) {
                return '<img alt="" class="' + sizeClass + ' rounded-box object-cover" src="' + escapeHtml(folder.folderImageUrl) + '">';
            }

            return '<span aria-hidden="true" class="' + sizeClass + ' inline-flex items-center justify-center rounded-box bg-base-300 text-base-content/55">' +
                '<svg class="h-2/3 w-2/3" fill="none" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M18 54c0-12 10-22 22-22h38c8 0 15 4 19 11l8 13h55c12 0 22 10 22 22v76c0 12-10 22-22 22H40c-12 0-22-10-22-22V54Z" stroke="currentColor" stroke-linejoin="round" stroke-width="12"/>' +
                '<path d="M22 84h156" opacity="0.45" stroke="currentColor" stroke-linecap="round" stroke-width="8"/>' +
                '</svg>' +
                '</span>';
        }

        function folderOptions() {
            const options = [{ id: 'root', label: 'All characters only' }];
            function walk(parentFolderId, depth) {
                for (const folder of folderChildren(parentFolderId)) {
                    options.push({ id: folder.id, label: '— '.repeat(depth) + folder.name });
                    walk(folder.id, depth + 1);
                }
            }
            walk(null, 0);
            return options;
        }

        function renderFolderSelect(select, selectedValue) {
            if (!select) return;
            select.innerHTML = folderOptions()
                .map((option) => '<option value="' + escapeHtml(option.id) + '"' + (option.id === selectedValue ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>')
                .join('');
        }

        function renderAll() {
            normalizeSelectedFolder();
            renderFolderTree();
            renderProfileCharacters();
            renderSelectedFolderPanel();
            renderFolderControls();
            renderStats();
        }

        function normalizeSelectedFolder() {
            if (selectedFolderId && folderById(selectedFolderId)) return;
            selectedFolderId = folders[0] ? folders.slice().sort(compareOrderedNames)[0].id : null;
        }

        function renderStats() {
            folderCount.textContent = pluralize(folders.length, 'folder');
            characterCount.textContent = pluralize(characters.length, 'character');
        }

        function renderFolderControls() {
            const selectedValue = selectedFolderId || 'root';
            renderFolderSelect(document.getElementById('new-character-folder'), selectedValue);
            renderFolderSelect(document.getElementById('new-folder-parent'), selectedValue);
        }

        function renderFolderTree() {
            folderTreeRoot.innerHTML = folderDropzoneHtml('root');
        }

        function folderDropzoneHtml(parentFolderId) {
            return '<div class="folder-dropzone space-y-2 py-2" data-folder-dropzone data-parent-folder-id="' + escapeHtml(parentFolderId) + '">' +
                folderChildren(parentFolderId).map(folderHtml).join('') +
                '</div>';
        }

        function folderHtml(folder) {
            const selectedClass = folder.id === selectedFolderId ? ' bg-base-300' : ' hover:bg-base-200/80';
            return '<article class="management-item" data-folder-id="' + escapeHtml(folder.id) + '" data-folder-sort-item draggable="true">' +
                '<div class="folder-row flex items-center gap-2 rounded-box px-3 py-2 transition-colors' + selectedClass + '" data-folder-drop-target>' +
                '<span aria-hidden="true" class="drag-handle text-base-content/55" data-drag-handle>☰</span>' +
                folderThumbnailHtml(folder, 'h-9 w-9 shrink-0') +
                '<button aria-label="Select ' + escapeHtml(folder.name) + '" class="min-w-0 flex-1 truncate text-left font-semibold" data-select-folder type="button">' + escapeHtml(folder.name) + '</button>' +
                '<span class="badge badge-ghost badge-sm">' + folderPlacements(folder.id).length + '</span>' +
                '<button aria-label="Delete ' + escapeHtml(folder.name) + ' folder" class="btn btn-ghost btn-xs btn-square" data-delete-folder type="button">x</button>' +
                '</div>' +
                '<div class="folder-tree-children" data-folder-children>' + folderDropzoneHtml(folder.id) + '</div>' +
                '</article>';
        }

        function renderProfileCharacters() {
            profileCharacterList.innerHTML = characters.map((character) => profileCharacterHtml(character)).join('');
        }

        function profileCharacterHtml(character) {
            return '<article class="management-item rounded-box border border-base-300 bg-base-100 p-3 shadow-sm" data-profile-character-id="' + escapeHtml(character.id) + '" data-character-card draggable="true">' +
                '<div class="flex items-center gap-3">' +
                '<span aria-hidden="true" class="drag-handle text-base-content/55" data-drag-handle>☰</span>' +
                '<img alt="' + escapeHtml(character.name) + '" class="h-14 w-14 rounded-box object-cover" src="' + escapeHtml(character.profileImageUrl) + '"/>' +
                '<div class="min-w-0 flex-1">' +
                '<a class="block truncate font-bold" href="/edit/' + encodeURIComponent(character.id) + '">' + escapeHtml(character.name) + '</a>' +
                '<p class="truncate text-xs text-base-content/60">Appears in ' + pluralize(folderIdsForCharacter(character.id).length, 'folder') + '</p>' +
                '</div>' +
                '<button aria-label="Delete ' + escapeHtml(character.name) + '" class="btn btn-ghost btn-sm btn-square" data-delete-character type="button">x</button>' +
                '</div></article>';
        }

        function renderSelectedFolderPanel() {
            if (!selectedFolderId || !folderById(selectedFolderId)) {
                selectedFolderPanel.innerHTML = '<div class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center text-base-content/65">Create a folder, then add characters to it without changing the main profile order.</div>';
                return;
            }

            const folder = folderById(selectedFolderId);
            const placedCharacters = folderCharacters(selectedFolderId);
            const addableCharacters = characters.filter((character) => !placements.some((placement) => placement.folderId === selectedFolderId && placement.characterId === character.id));
            const addableCharacterItems = addableCharacters.map((character) => '<li>' +
                '<label class="flex cursor-pointer items-center gap-3">' +
                '<input class="checkbox checkbox-sm" data-folder-character-checkbox type="checkbox" value="' + escapeHtml(character.id) + '"/>' +
                '<img alt="" class="h-8 w-8 rounded object-cover" src="' + escapeHtml(character.profileImageUrl) + '"/>' +
                '<span class="min-w-0 flex-1 truncate font-semibold">' + escapeHtml(character.name) + '</span>' +
                '</label>' +
                '</li>').join('');

            selectedFolderPanel.innerHTML = '<div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">' +
                '<div class="flex min-w-0 gap-3">' +
                folderThumbnailHtml(folder, 'h-20 w-20 shrink-0') +
                '<div class="min-w-0">' +
                '<p class="text-xs font-semibold uppercase tracking-[0.24em] text-base-content/50">Selected folder</p>' +
                '<h2 class="truncate text-2xl font-black">' + escapeHtml(folder.name) + '</h2>' +
                '<p class="mt-1 text-sm text-base-content/65">This order is only for this folder. Characters can also live in other folders.</p>' +
                '<div class="mt-3 flex flex-wrap gap-2">' +
                '<button class="btn btn-sm" data-edit-folder type="button">Edit folder</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<span class="badge badge-ghost whitespace-nowrap">' + placedCharacters.length + ' OCs</span>' +
                '</div>' +
                '<div class="mb-4">' +
                '<details class="dropdown w-full" id="folder-character-add-dropdown">' +
                '<summary class="btn w-full justify-between" role="button">' +
                '<span>' + (addableCharacters.length === 0 ? 'Every character is already here' : 'Select characters to add') + '</span>' +
                '<span class="badge badge-ghost" data-folder-character-selection-count>0 selected</span>' +
                '</summary>' +
                '<div class="dropdown-content z-[70] mt-2 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow-xl">' +
                (addableCharacters.length === 0
                    ? '<p class="p-3 text-sm text-base-content/65">Every character is already in this folder.</p>'
                    : '<ul class="menu max-h-72 w-full overflow-y-auto p-0">' + addableCharacterItems + '</ul>' +
                    '<div class="mt-2 flex items-center justify-between gap-2 border-t border-base-300 pt-2">' +
                    '<span class="text-xs text-base-content/60">' + pluralize(addableCharacters.length, 'available character') + '</span>' +
                    '<button class="btn btn-sm" data-add-selected-characters-to-folder disabled type="button">Add selected</button>' +
                    '</div>') +
                '</div>' +
                '</details>' +
                '</div>' +
                '<div class="character-dropzone space-y-2 rounded-box bg-base-200/70 p-2" data-placement-dropzone data-folder-id="' + escapeHtml(selectedFolderId) + '">' +
                placedCharacters.map((character) => placementCharacterHtml(character, selectedFolderId)).join('') +
                '</div>';
        }

        function placementCharacterHtml(character, folderId) {
            return '<article class="management-item rounded-box border border-base-300 bg-base-100 p-3" data-placement-character-id="' + escapeHtml(character.id) + '" data-placement-folder-id="' + escapeHtml(folderId) + '" data-character-card draggable="true">' +
                '<div class="flex items-center gap-3">' +
                '<span aria-hidden="true" class="drag-handle text-base-content/55" data-drag-handle>☰</span>' +
                '<img alt="' + escapeHtml(character.name) + '" class="h-12 w-12 rounded-box object-cover" src="' + escapeHtml(character.profileImageUrl) + '"/>' +
                '<a class="min-w-0 flex-1 truncate font-bold" href="/edit/' + encodeURIComponent(character.id) + '">' + escapeHtml(character.name) + '</a>' +
                '<button class="btn btn-ghost btn-sm" data-remove-placement type="button">Remove</button>' +
                '</div></article>';
        }

        function folderPlacements(folderId) {
            return placements
                .filter((placement) => placement.folderId === folderId)
                .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));
        }

        function folderCharacters(folderId) {
            return folderPlacements(folderId)
                .map((placement) => characterById(placement.characterId))
                .filter(Boolean);
        }

        function folderIdsForCharacter(characterId) {
            return placements
                .filter((placement) => placement.characterId === characterId)
                .map((placement) => placement.folderId);
        }

        function updateFolderCharacterSelectionCount() {
            const selectedCount = selectedFolderPanel.querySelectorAll('[data-folder-character-checkbox]:checked').length;
            const badge = selectedFolderPanel.querySelector('[data-folder-character-selection-count]');
            const addButton = selectedFolderPanel.querySelector('[data-add-selected-characters-to-folder]');
            if (badge) badge.textContent = selectedCount + ' selected';
            if (addButton) addButton.disabled = selectedCount === 0;
        }

        function showToast(message, isError = false) {
            const alert = document.createElement('div');
            alert.className = 'toast-message alert ' + (isError ? 'alert-error' : 'alert-success');
            alert.textContent = message;
            toastRegion.append(alert);
            setTimeout(() => alert.remove(), 2800);
        }

        async function apiJson(url, options = {}) {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'content-type': 'application/json',
                    'x-csrf-token': csrfToken,
                    ...(options.headers || {}),
                },
            });
            if (response.status === 204) return null;
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Request failed');
            return body;
        }

        function serializeFolderTree(parentFolderId) {
            return folderChildren(parentFolderId).map((folder) => ({
                type: 'folder',
                id: folder.id,
                children: serializeFolderTree(folder.id),
            }));
        }

        async function persistFolderTree() {
            await apiJson('/api/characters/folders/tree', {
                method: 'POST',
                body: JSON.stringify({ items: serializeFolderTree(null) }),
            });
        }

        async function persistCharacterOrder() {
            characters.forEach((character, index) => {
                character.sortOrder = index;
            });
            await apiJson('/api/characters/order', {
                method: 'POST',
                body: JSON.stringify({ characterIds: characters.map((character) => character.id) }),
            });
        }

        async function persistFolderPlacements(folderId) {
            normalizePlacementOrders(folderId);
            await apiJson('/api/characters/folders/' + encodeURIComponent(folderId) + '/placements', {
                method: 'PUT',
                body: JSON.stringify({ characterIds: folderPlacements(folderId).map((placement) => placement.characterId) }),
            });
        }

        function normalizePlacementOrders(folderId) {
            folderPlacements(folderId).forEach((placement, index) => {
                placement.sortOrder = index;
            });
        }

        function setFolderOrder(parentFolderId, orderedFolders) {
            const normalizedParent = normalizeFolderId(parentFolderId);
            orderedFolders.forEach((folder, index) => {
                folder.parentFolderId = normalizedParent;
                folder.sortOrder = index;
            });
        }

        function moveFolder(folderId, targetParentFolderId, beforeFolderId) {
            const folder = folderById(folderId);
            if (!folder) throw new Error('Folder not found.');
            const originalParentFolderId = folder.parentFolderId;
            const originalSiblings = folderChildren(originalParentFolderId).filter((sibling) => sibling.id !== folderId);
            setFolderOrder(originalParentFolderId, originalSiblings);

            const targetSiblings = folderChildren(targetParentFolderId).filter((sibling) => sibling.id !== folderId);
            let insertIndex = beforeFolderId ? targetSiblings.findIndex((sibling) => sibling.id === beforeFolderId) : targetSiblings.length;
            if (insertIndex < 0) insertIndex = targetSiblings.length;
            targetSiblings.splice(insertIndex, 0, folder);
            setFolderOrder(targetParentFolderId, targetSiblings);
        }

        function isDescendantFolder(folderId, targetFolderId) {
            let current = targetFolderId ? folderById(targetFolderId) : null;
            while (current) {
                if (current.id === folderId) return true;
                current = current.parentFolderId ? folderById(current.parentFolderId) : null;
            }
            return false;
        }

        function indexFromPointer(container, pointerY, selector) {
            const grabbed = document.querySelector('[aria-grabbed="true"]');
            const items = Array.from(container.querySelectorAll(':scope > ' + selector)).filter((item) => item !== grabbed);
            const next = items.find((item) => {
                const box = item.getBoundingClientRect();
                return pointerY < box.top + box.height / 2;
            });
            return next ? items.indexOf(next) : items.length;
        }

        function closestElement(target, selector) {
            return target && target.closest ? target.closest(selector) : null;
        }

        function nextFolderSortElement(item) {
            let sibling = item.nextElementSibling;
            while (sibling && !sibling.matches('[data-folder-sort-item]')) {
                sibling = sibling.nextElementSibling;
            }
            return sibling;
        }

        function folderPlacementFromTarget(target, pointerY) {
            const row = closestElement(target, '[data-folder-drop-target]');
            if (row) {
                const item = row.closest('[data-folder-sort-item]');
                if (!item) return null;
                const box = row.getBoundingClientRect();
                const edgeSize = Math.min(14, Math.max(8, box.height * 0.28));
                const pointerOffset = pointerY - box.top;
                if (pointerOffset <= edgeSize || pointerOffset >= box.height - edgeSize) {
                    return {
                        type: 'sort',
                        container: item.parentElement.closest('[data-folder-dropzone]'),
                        beforeElement: pointerOffset <= edgeSize ? item : nextFolderSortElement(item),
                    };
                }
                return { type: 'nest', folderId: item.dataset.folderId, row };
            }

            const container = closestElement(target, '[data-folder-dropzone]');
            if (!container) return null;
            const index = indexFromPointer(container, pointerY, '[data-folder-sort-item]');
            const items = Array.from(container.querySelectorAll(':scope > [data-folder-sort-item]'));
            return { type: 'sort', container, beforeElement: items[index] || null };
        }

        function folderPlacementFromEvent(event) {
            return folderPlacementFromTarget(event.target, event.clientY);
        }

        function showFolderPlacement(placement) {
            if (!placement) return;
            if (placement.type === 'nest') {
                hideFolderDropMarker();
                currentFolderSortKey = '';
                if (currentFolderNestRow !== placement.row) {
                    if (currentFolderNestRow) currentFolderNestRow.classList.remove('drag-over');
                    currentFolderNestRow = placement.row;
                    currentFolderNestRow.classList.add('drag-over');
                }
                return;
            }
            if (!placement.container) return;
            if (currentFolderNestRow) {
                currentFolderNestRow.classList.remove('drag-over');
                currentFolderNestRow = null;
            }
            const beforeId = placement.beforeElement ? placement.beforeElement.dataset.folderId : 'end';
            const sortKey = placement.container.dataset.parentFolderId + ':' + beforeId;
            if (currentFolderSortKey === sortKey && folderDropMarker.isConnected) return;
            currentFolderSortKey = sortKey;
            showFolderDropMarker(placement);
        }

        function showFolderDropMarker(placement) {
            const containerBox = placement.container.getBoundingClientRect();
            let top = containerBox.top + 8;
            if (placement.beforeElement) {
                top = placement.beforeElement.getBoundingClientRect().top;
            } else {
                const items = Array.from(placement.container.querySelectorAll(':scope > [data-folder-sort-item]'));
                if (items.length > 0) top = items[items.length - 1].getBoundingClientRect().bottom;
            }
            folderDropMarker.style.left = containerBox.left + 'px';
            folderDropMarker.style.top = top + 'px';
            folderDropMarker.style.width = containerBox.width + 'px';
            if (!folderDropMarker.isConnected) document.body.append(folderDropMarker);
        }

        function hideFolderDropMarker() {
            folderDropMarker.remove();
        }

        function hideCharacterDropMarker() {
            characterDropMarker.remove();
            currentCharacterSortKey = '';
        }

        function clearDragState() {
            document.querySelectorAll('[aria-grabbed="true"]').forEach((item) => item.removeAttribute('aria-grabbed'));
            document.querySelectorAll('.drag-over').forEach((item) => item.classList.remove('drag-over'));
            hideFolderDropMarker();
            hideCharacterDropMarker();
            currentFolderNestRow = null;
            currentFolderSortKey = '';
            if (pointerDragState && pointerDragState.ghost) pointerDragState.ghost.remove();
            pointerDragState = null;
            pointerDragCandidate = null;
            document.body.classList.remove('management-is-dragging');
            dragged = null;
        }

        function moveCharacterInProfile(characterId, insertIndex) {
            const currentIndex = characters.findIndex((character) => character.id === characterId);
            if (currentIndex < 0) return;
            const character = characters.splice(currentIndex, 1)[0];
            characters.splice(Math.max(0, Math.min(insertIndex, characters.length)), 0, character);
        }

        function upsertFolderPlacement(folderId, characterId, insertIndex) {
            placements = placements.filter((placement) => !(placement.folderId === folderId && placement.characterId === characterId));
            const folderList = folderPlacements(folderId);
            const nextPlacement = { folderId, characterId, sortOrder: 0 };
            folderList.splice(Math.max(0, Math.min(insertIndex, folderList.length)), 0, nextPlacement);
            folderList.forEach((placement, index) => {
                placement.sortOrder = index;
            });
            placements = placements.filter((placement) => placement.folderId !== folderId).concat(folderList);
        }

        function removeFolderPlacement(folderId, characterId) {
            placements = placements.filter((placement) => !(placement.folderId === folderId && placement.characterId === characterId));
            normalizePlacementOrders(folderId);
        }

        function dragDataForHandle(handle) {
            const folder = handle.closest('[data-folder-sort-item]');
            const placementCharacter = handle.closest('[data-placement-character-id]');
            const profileCharacter = handle.closest('[data-profile-character-id]');
            if (folder) {
                return {
                    item: folder,
                    dragged: { type: 'folder', folderId: folder.dataset.folderId },
                };
            }
            if (placementCharacter) {
                return {
                    item: placementCharacter,
                    dragged: {
                        type: 'character',
                        source: 'folder',
                        characterId: placementCharacter.dataset.placementCharacterId,
                        folderId: placementCharacter.dataset.placementFolderId,
                    },
                };
            }
            if (profileCharacter) {
                return {
                    item: profileCharacter,
                    dragged: {
                        type: 'character',
                        source: 'profile',
                        characterId: profileCharacter.dataset.profileCharacterId,
                    },
                };
            }
            return null;
        }

        function createPointerDragGhost(source) {
            const box = source.getBoundingClientRect();
            const ghost = source.cloneNode(true);
            ghost.classList.add('management-drag-ghost');
            ghost.removeAttribute('aria-grabbed');
            ghost.style.width = box.width + 'px';
            ghost.style.height = box.height + 'px';
            document.body.append(ghost);
            return ghost;
        }

        function movePointerDragGhost(x, y) {
            if (!pointerDragState || !pointerDragState.ghost) return;
            pointerDragState.ghost.style.transform = 'translate3d(' + (x - pointerDragState.offsetX) + 'px,' + (y - pointerDragState.offsetY) + 'px,0)';
        }

        function scrollDuringPointerDrag(pointerY) {
            const edgeSize = Math.min(96, window.innerHeight * 0.16);
            if (pointerY < edgeSize) {
                window.scrollBy({ top: -18, behavior: 'auto' });
            } else if (pointerY > window.innerHeight - edgeSize) {
                window.scrollBy({ top: 18, behavior: 'auto' });
            }
        }

        function characterPlacementFromTarget(target, pointerY) {
            const dropzone = closestElement(target, '[data-profile-dropzone], [data-placement-dropzone]');
            if (!dropzone) return null;
            const grabbed = document.querySelector('[aria-grabbed="true"]');
            const items = Array.from(dropzone.querySelectorAll(':scope > [data-character-card]'))
                .filter((item) => item !== grabbed);
            const beforeElement = items.find((item) => {
                const box = item.getBoundingClientRect();
                return pointerY < box.top + box.height / 2;
            }) || null;
            return {
                dropzone,
                insertIndex: beforeElement ? items.indexOf(beforeElement) : items.length,
                beforeElement,
                type: dropzone.matches('[data-profile-dropzone]') ? 'profile' : 'folder',
            };
        }

        function showCharacterPlacement(placement) {
            document.querySelectorAll('[data-profile-dropzone].drag-over, [data-placement-dropzone].drag-over')
                .forEach((dropzone) => dropzone.classList.remove('drag-over'));
            if (!placement) {
                hideCharacterDropMarker();
                return;
            }
            const beforeId = placement.beforeElement
                ? placement.beforeElement.dataset.profileCharacterId || placement.beforeElement.dataset.placementCharacterId || 'unknown'
                : 'end';
            const dropzoneId = placement.dropzone.dataset.folderId || 'profile';
            const sortKey = placement.type + ':' + dropzoneId + ':' + beforeId;
            placement.dropzone.classList.add('drag-over');
            if (currentCharacterSortKey === sortKey && characterDropMarker.isConnected) return;
            currentCharacterSortKey = sortKey;
            if (placement.beforeElement) {
                placement.dropzone.insertBefore(characterDropMarker, placement.beforeElement);
            } else {
                placement.dropzone.append(characterDropMarker);
            }
        }

        function startPointerDrag(candidate, event) {
            const box = candidate.item.getBoundingClientRect();
            dragged = candidate.dragged;
            candidate.item.setAttribute('aria-grabbed', 'true');
            pointerDragState = {
                ghost: createPointerDragGhost(candidate.item),
                offsetX: event.clientX - box.left,
                offsetY: event.clientY - box.top,
            };
            document.body.classList.add('management-is-dragging');
            movePointerDragGhost(event.clientX, event.clientY);
        }

        async function applyFolderDrop(placement) {
            if (!placement || !dragged || dragged.type !== 'folder') return false;
            const draggedFolderId = dragged.folderId;
            const parentFolderId = placement.type === 'nest'
                ? placement.folderId
                : normalizeFolderId(placement.container.dataset.parentFolderId);
            const beforeFolderId = placement.type === 'sort' && placement.beforeElement
                ? placement.beforeElement.dataset.folderId
                : null;
            if (beforeFolderId === draggedFolderId) {
                clearDragState();
                renderAll();
                return true;
            }
            if (draggedFolderId === parentFolderId || isDescendantFolder(draggedFolderId, parentFolderId)) {
                clearDragState();
                renderAll();
                showToast('A folder cannot be moved inside itself.', true);
                return true;
            }
            const previousFolders = folders.map((folder) => ({ ...folder }));
            try {
                moveFolder(draggedFolderId, parentFolderId, beforeFolderId);
                selectedFolderId = draggedFolderId;
                await persistFolderTree();
                clearDragState();
                renderAll();
                showToast(placement.type === 'nest' ? 'Folder nested.' : 'Folder order saved.');
            } catch (error) {
                folders = previousFolders;
                clearDragState();
                renderAll();
                showToast(error.message, true);
            }
            return true;
        }

        async function applyCharacterDrop(target, pointerY) {
            if (!dragged || dragged.type !== 'character') return false;
            const draggedCharacterId = dragged.characterId;
            const draggedSource = dragged.source;
            const placement = characterPlacementFromTarget(target, pointerY);
            if (!placement) return false;

            if (placement.type === 'profile') {
                const previousCharacters = characters.slice();
                try {
                    moveCharacterInProfile(draggedCharacterId, placement.insertIndex);
                    await persistCharacterOrder();
                    clearDragState();
                    renderAll();
                    showToast('Profile order saved.');
                } catch (error) {
                    characters = previousCharacters;
                    clearDragState();
                    renderAll();
                    showToast(error.message, true);
                }
                return true;
            }

            if (placement.type === 'folder') {
                const folderId = placement.dropzone.dataset.folderId;
                const previousPlacements = placements.slice();
                try {
                    upsertFolderPlacement(folderId, draggedCharacterId, placement.insertIndex);
                    await persistFolderPlacements(folderId);
                    selectedFolderId = folderId;
                    clearDragState();
                    renderAll();
                    showToast(draggedSource === 'profile' ? 'Character added to folder.' : 'Folder order saved.');
                } catch (error) {
                    placements = previousPlacements;
                    clearDragState();
                    renderAll();
                    showToast(error.message, true);
                }
                return true;
            }

            return false;
        }

        function beginPointerDragCandidate(event) {
            if (event.pointerType === 'mouse' || event.button !== 0) return;
            const handle = closestElement(event.target, '[data-drag-handle]');
            if (!handle) return;
            const dragData = dragDataForHandle(handle);
            if (!dragData) return;
            pointerDragCandidate = {
                ...dragData,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                handle,
            };
            event.preventDefault();
            handle.setPointerCapture?.(event.pointerId);
        }

        function handlePointerDragMove(event) {
            if (!pointerDragCandidate || event.pointerId !== pointerDragCandidate.pointerId) return;
            const distance = Math.hypot(event.clientX - pointerDragCandidate.startX, event.clientY - pointerDragCandidate.startY);
            if (!pointerDragState && distance >= 6) {
                startPointerDrag(pointerDragCandidate, event);
            }
            if (!pointerDragState) return;
            event.preventDefault();
            movePointerDragGhost(event.clientX, event.clientY);
            scrollDuringPointerDrag(event.clientY);
            const target = document.elementFromPoint(event.clientX, event.clientY);
            if (dragged.type === 'folder') {
                const placement = folderPlacementFromTarget(target, event.clientY);
                if (placement) {
                    showFolderPlacement(placement);
                } else {
                    hideFolderDropMarker();
                }
                return;
            }
            showCharacterPlacement(characterPlacementFromTarget(target, event.clientY));
        }

        async function handlePointerDragEnd(event) {
            if (!pointerDragCandidate || event.pointerId !== pointerDragCandidate.pointerId) return;
            try {
                pointerDragCandidate.handle.releasePointerCapture?.(event.pointerId);
            } catch {
                // The pointer may already be released after a browser-level touch cancellation.
            }
            if (!pointerDragState) {
                pointerDragCandidate = null;
                return;
            }
            event.preventDefault();
            const target = document.elementFromPoint(event.clientX, event.clientY);
            if (dragged.type === 'folder') {
                const placement = folderPlacementFromTarget(target, event.clientY);
                if (!(await applyFolderDrop(placement))) {
                    clearDragState();
                    renderAll();
                }
                return;
            }
            if (!(await applyCharacterDrop(target, event.clientY))) {
                clearDragState();
                renderAll();
            }
        }

        function cancelPointerDrag(event) {
            if (!pointerDragCandidate || event.pointerId !== pointerDragCandidate.pointerId) return;
            clearDragState();
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

        async function createCroppedCharacterProfileDataUrl() {
            if (!characterProfileCropperInstance) throw new Error('Choose a profile image first.');
            const canvas = await createProfileCropCanvas(characterProfileCropperInstance);
            return canvas.toDataURL('image/webp', 0.9);
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

        function folderImageCropContext(kind) {
            if (kind === 'new') {
                return {
                    state: newFolderImageCropState,
                    input: newFolderImageInput,
                    panel: newFolderImageCropper,
                    image: newFolderImageCropImage,
                };
            }

            return {
                state: editFolderImageCropState,
                input: editFolderImageInput,
                panel: editFolderImageCropper,
                image: editFolderImageCropImage,
            };
        }

        async function loadFolderImageForCropping(kind, file) {
            if (kind === 'edit' && (!editTargetFolderId || !folderById(editTargetFolderId))) throw new Error('Select a folder first.');
            if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
            if (typeof Cropper === 'undefined') throw new Error('Folder image editor could not load. Refresh and try again.');
            const context = folderImageCropContext(kind);
            resetFolderImageCropper(kind, false);
            context.state.objectUrl = URL.createObjectURL(file);
            context.image.src = context.state.objectUrl;
            context.panel.classList.remove('hidden');
            context.state.cropper = createProfileCropper(context.image);
            await initializeProfileCropper(context.state.cropper);
        }

        async function createCroppedFolderImageCanvas(kind) {
            const context = folderImageCropContext(kind);
            if (!context.state.cropper) throw new Error('Choose a folder image first.');
            return await createProfileCropCanvas(context.state.cropper);
        }

        async function createCroppedFolderImageDataUrl(kind) {
            const canvas = await createCroppedFolderImageCanvas(kind);
            return canvas.toDataURL('image/webp', 0.9);
        }

        async function createCroppedFolderImageBlob(kind) {
            const canvas = await createCroppedFolderImageCanvas(kind);
            return await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare folder image.')), 'image/webp', 0.9);
            });
        }

        function resetFolderImageCropper(kind, clearInput = true) {
            const context = folderImageCropContext(kind);
            if (context.state.cropper) {
                context.state.cropper.destroy();
                context.state.cropper = null;
            }
            if (context.state.objectUrl) {
                URL.revokeObjectURL(context.state.objectUrl);
                context.state.objectUrl = null;
            }
            context.image.removeAttribute('src');
            context.panel.classList.add('hidden');
            if (clearInput) context.input.value = '';
        }

        async function uploadEditFolderImage(folder) {
            const blob = await createCroppedFolderImageBlob('edit');
            const form = new FormData();
            form.append('folderImage', blob, 'folder.webp');
            const response = await fetch('/api/characters/folders/' + encodeURIComponent(folder.id) + '/image', {
                method: 'POST',
                headers: {
                    'x-csrf-token': csrfToken,
                },
                body: form,
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(body.error || 'Folder image could not be saved.');
            folder.folderImageKey = body.folderImageKey || null;
            folder.folderImageUrl = body.folderImageUrl || null;
        }

        async function removeFolderImage(folder) {
            if (!folder || !folder.folderImageKey) return;
            const response = await fetch('/api/characters/folders/' + encodeURIComponent(folder.id) + '/image', {
                method: 'DELETE',
                headers: {
                    'x-csrf-token': csrfToken,
                },
            });
            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(body.error || 'Folder image could not be removed.');
            }
            folder.folderImageKey = null;
            folder.folderImageUrl = null;
        }

        function updateEditFolderCurrentImage(folder) {
            if (folder && folder.folderImageUrl && !editFolderRemoveImage) {
                editFolderCurrentImage.src = folder.folderImageUrl;
                editFolderCurrentImageFrame.classList.remove('hidden');
                editFolderRemoveImageButton.disabled = false;
                return;
            }

            editFolderCurrentImage.removeAttribute('src');
            editFolderCurrentImageFrame.classList.add('hidden');
            editFolderRemoveImageButton.disabled = true;
        }

        function openEditFolderModal(folder) {
            editTargetFolderId = folder.id;
            editFolderRemoveImage = false;
            editFolderForm.reset();
            resetFolderImageCropper('edit');
            document.getElementById('edit-folder-name').value = folder.name;
            updateEditFolderCurrentImage(folder);
            editFolderModal.showModal();
            document.getElementById('edit-folder-name').focus();
        }

        async function saveEditFolder() {
            const folder = editTargetFolderId ? folderById(editTargetFolderId) : null;
            if (!folder) throw new Error('Select a folder first.');

            const name = document.getElementById('edit-folder-name').value.trim();
            const result = await apiJson('/api/characters/folders/' + encodeURIComponent(folder.id), {
                method: 'PATCH',
                body: JSON.stringify({ name }),
            });

            folder.name = result.folder.name;
            folder.sortOrder = result.folder.sortOrder;

            if (editFolderImageCropState.cropper) {
                await uploadEditFolderImage(folder);
            } else if (editFolderRemoveImage) {
                await removeFolderImage(folder);
            }

            resetFolderImageCropper('edit');
            editTargetFolderId = null;
            editFolderRemoveImage = false;
            editFolderModal.close();
            renderAll();
            showToast('Folder updated.');
        }

        document.getElementById('create-character-button').addEventListener('click', () => {
            renderFolderControls();
            createCharacterModal.showModal();
            document.getElementById('new-character-name').focus();
        });

        document.getElementById('create-folder-button').addEventListener('click', () => {
            renderFolderControls();
            createFolderForm.reset();
            resetFolderImageCropper('new');
            createFolderModal.showModal();
            document.getElementById('new-folder-name').focus();
        });

        characterProfileInput.addEventListener('change', async () => {
            resetCharacterProfileCropper();
            const file = characterProfileInput.files && characterProfileInput.files[0];
            if (!file) return;
            try {
                await loadCharacterProfileForCropping(file);
            } catch (error) {
                resetCharacterProfileCropper();
                showToast(error.message || 'Could not prepare profile image.', true);
                characterProfileInput.value = '';
            }
        });

        editFolderImageInput.addEventListener('change', async () => {
            const file = editFolderImageInput.files && editFolderImageInput.files[0];
            if (!file) return;
            try {
                editFolderRemoveImage = false;
                await loadFolderImageForCropping('edit', file);
                editFolderCurrentImageFrame.classList.add('hidden');
            } catch (error) {
                resetFolderImageCropper('edit');
                showToast(error.message || 'Could not prepare folder image.', true);
            }
        });

        document.querySelector('[data-cancel-edit-folder-image-crop]').addEventListener('click', () => {
            const folder = editTargetFolderId ? folderById(editTargetFolderId) : null;
            resetFolderImageCropper('edit');
            updateEditFolderCurrentImage(folder);
        });

        editFolderRemoveImageButton.addEventListener('click', () => {
            editFolderRemoveImage = true;
            resetFolderImageCropper('edit');
            updateEditFolderCurrentImage(null);
        });

        editFolderForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = editFolderForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                await saveEditFolder();
            } catch (error) {
                showToast(error.message, true);
            } finally {
                button.disabled = false;
            }
        });

        newFolderImageInput.addEventListener('change', async () => {
            const file = newFolderImageInput.files && newFolderImageInput.files[0];
            if (!file) return;
            try {
                await loadFolderImageForCropping('new', file);
            } catch (error) {
                resetFolderImageCropper('new');
                showToast(error.message || 'Could not prepare folder image.', true);
            }
        });

        document.querySelector('[data-cancel-new-folder-image-crop]').addEventListener('click', () => {
            resetFolderImageCropper('new');
        });

        createCharacterForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = createCharacterForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const name = document.getElementById('new-character-name').value.trim();
                const folderId = normalizeFolderId(document.getElementById('new-character-folder').value);
                const profileImageData = await createCroppedCharacterProfileDataUrl();
                const result = await apiJson('/api/characters', {
                    method: 'POST',
                    body: JSON.stringify({ name, folderId, profileImageData }),
                });
                const character = { ...result.character, profileImageKey: result.character.profileImageKey || '', folderId, sortOrder: characters.length };
                characters.push(character);
                if (folderId) {
                    upsertFolderPlacement(folderId, character.id, folderPlacements(folderId).length);
                    await persistFolderPlacements(folderId);
                    selectedFolderId = folderId;
                }
                await persistCharacterOrder();
                createCharacterModal.close();
                createCharacterForm.reset();
                resetCharacterProfileCropper();
                renderAll();
                showToast(name + ' created.');
            } catch (error) {
                showToast(error.message, true);
            } finally {
                button.disabled = false;
            }
        });

        createFolderForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = createFolderForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const name = document.getElementById('new-folder-name').value.trim();
                const parentFolderId = normalizeFolderId(document.getElementById('new-folder-parent').value);
                const folderImageData = newFolderImageCropState.cropper
                    ? await createCroppedFolderImageDataUrl('new')
                    : null;
                const result = await apiJson('/api/characters/folders', {
                    method: 'POST',
                    body: JSON.stringify({ name, parentFolderId, folderImageData }),
                });
                const nextSiblings = folderChildren(parentFolderId);
                const folder = { ...result.folder, parentFolderId, sortOrder: nextSiblings.length };
                folders.push(folder);
                setFolderOrder(parentFolderId, nextSiblings.concat(folder));
                selectedFolderId = folder.id;
                await persistFolderTree();
                createFolderModal.close();
                createFolderForm.reset();
                resetFolderImageCropper('new');
                renderAll();
                showToast('Folder created.');
            } catch (error) {
                showToast(error.message, true);
            } finally {
                button.disabled = false;
            }
        });

        document.addEventListener('change', (event) => {
            if (!event.target.closest('[data-folder-character-checkbox]')) return;
            updateFolderCharacterSelectionCount();
        });

        document.addEventListener('click', async (event) => {
            const selectFolderButton = event.target.closest('[data-select-folder]');
            const addSelectedCharactersButton = event.target.closest('[data-add-selected-characters-to-folder]');
            const removePlacementButton = event.target.closest('[data-remove-placement]');
            const deleteCharacterButton = event.target.closest('[data-delete-character]');
            const deleteFolderButton = event.target.closest('[data-delete-folder]');
            const editFolderButton = event.target.closest('[data-edit-folder]');

            if (selectFolderButton) {
                selectedFolderId = selectFolderButton.closest('[data-folder-sort-item]').dataset.folderId;
                renderAll();
                return;
            }

            if (addSelectedCharactersButton && selectedFolderId) {
                const selectedCharacterIds = Array.from(selectedFolderPanel.querySelectorAll('[data-folder-character-checkbox]:checked'))
                    .map((checkbox) => checkbox.value)
                    .filter(Boolean);
                if (selectedCharacterIds.length === 0) {
                    showToast('Select at least one character to add.', true);
                    return;
                }
                const previousPlacements = placements.slice();
                try {
                    let insertIndex = folderPlacements(selectedFolderId).length;
                    for (const characterId of selectedCharacterIds) {
                        upsertFolderPlacement(selectedFolderId, characterId, insertIndex);
                        insertIndex += 1;
                    }
                    await persistFolderPlacements(selectedFolderId);
                    renderAll();
                    showToast(pluralize(selectedCharacterIds.length, 'character') + ' added to folder.');
                } catch (error) {
                    placements = previousPlacements;
                    renderAll();
                    showToast(error.message, true);
                }
                return;
            }

            if (removePlacementButton) {
                const item = removePlacementButton.closest('[data-placement-character-id]');
                const folderId = item.dataset.placementFolderId;
                const characterId = item.dataset.placementCharacterId;
                const previousPlacements = placements.slice();
                try {
                    removeFolderPlacement(folderId, characterId);
                    await persistFolderPlacements(folderId);
                    renderAll();
                    showToast('Character removed from folder.');
                } catch (error) {
                    placements = previousPlacements;
                    renderAll();
                    showToast(error.message, true);
                }
                return;
            }

            if (deleteCharacterButton) {
                const item = deleteCharacterButton.closest('[data-profile-character-id]');
                deleteTargetCharacterId = item.dataset.profileCharacterId;
                deleteTargetCharacterName = characterById(deleteTargetCharacterId).name;
                document.getElementById('delete-character-confirm-name').placeholder = deleteTargetCharacterName;
                deleteCharacterModal.showModal();
                return;
            }

            if (editFolderButton && selectedFolderId) {
                const folder = folderById(selectedFolderId);
                if (folder) openEditFolderModal(folder);
                return;
            }

            if (deleteFolderButton) {
                deleteTargetFolderId = deleteFolderButton.closest('[data-folder-sort-item]').dataset.folderId;
                deleteFolderModal.showModal();
            }
        });

        deleteCharacterForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!deleteTargetCharacterId) return;
            try {
                await apiJson('/api/characters/' + encodeURIComponent(deleteTargetCharacterId), {
                    method: 'DELETE',
                    body: JSON.stringify({
                        confirmName: document.getElementById('delete-character-confirm-name').value.trim(),
                        permanent: document.getElementById('delete-confirm-permanent').checked,
                    }),
                });
                characters = characters.filter((character) => character.id !== deleteTargetCharacterId);
                placements = placements.filter((placement) => placement.characterId !== deleteTargetCharacterId);
                deleteCharacterModal.close();
                deleteCharacterForm.reset();
                renderAll();
                showToast(deleteTargetCharacterName + ' deleted.');
            } catch (error) {
                showToast(error.message, true);
            }
        });

        deleteFolderModal.addEventListener('click', async (event) => {
            if (event.target.matches('[data-cancel-delete-folder]')) {
                deleteFolderModal.close();
                return;
            }
            if (!event.target.matches('[data-confirm-delete-folder]') || !deleteTargetFolderId) return;
            const folder = folderById(deleteTargetFolderId);
            if (!folder) return;
            const previousFolders = folders.map((item) => ({ ...item }));
            const previousPlacements = placements.slice();
            try {
                await apiJson('/api/characters/folders/' + encodeURIComponent(deleteTargetFolderId), { method: 'DELETE' });
                folders = folders.filter((item) => item.id !== deleteTargetFolderId);
                folders.forEach((item) => {
                    if (item.parentFolderId === deleteTargetFolderId) item.parentFolderId = null;
                });
                placements = placements.filter((placement) => placement.folderId !== deleteTargetFolderId);
                if (selectedFolderId === deleteTargetFolderId) selectedFolderId = null;
                await persistFolderTree();
                deleteFolderModal.close();
                renderAll();
                showToast(folder.name + ' removed. Characters remain in All characters.');
            } catch (error) {
                folders = previousFolders;
                placements = previousPlacements;
                renderAll();
                showToast(error.message, true);
            }
        });

        document.addEventListener('dragstart', (event) => {
            const folder = event.target.closest('[data-folder-sort-item]');
            const profileCharacter = event.target.closest('[data-profile-character-id]');
            const placementCharacter = event.target.closest('[data-placement-character-id]');
            if (folder) {
                dragged = { type: 'folder', folderId: folder.dataset.folderId };
                folder.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'move';
                return;
            }
            if (placementCharacter) {
                dragged = {
                    type: 'character',
                    source: 'folder',
                    characterId: placementCharacter.dataset.placementCharacterId,
                    folderId: placementCharacter.dataset.placementFolderId,
                };
                placementCharacter.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'move';
                return;
            }
            if (profileCharacter) {
                dragged = { type: 'character', source: 'profile', characterId: profileCharacter.dataset.profileCharacterId };
                profileCharacter.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'copyMove';
            }
        });

        document.addEventListener('dragend', clearDragState);

        document.addEventListener('dragover', (event) => {
            if (!dragged) return;
            if (dragged.type === 'folder') {
                const placement = folderPlacementFromEvent(event);
                if (!placement) {
                    hideFolderDropMarker();
                    return;
                }
                event.preventDefault();
                showFolderPlacement(placement);
                return;
            }

            const characterPlacement = characterPlacementFromTarget(event.target, event.clientY);
            if (characterPlacement) {
                event.preventDefault();
                showCharacterPlacement(characterPlacement);
            } else {
                hideCharacterDropMarker();
            }
        });

        document.addEventListener('dragleave', (event) => {
            const dropzone = event.target.closest('[data-profile-dropzone], [data-placement-dropzone]');
            const nextTarget = event.relatedTarget;
            const isStillInside = nextTarget && nextTarget.nodeType && dropzone && dropzone.contains(nextTarget);
            if (dropzone && !isStillInside) {
                dropzone.classList.remove('drag-over');
                if (characterDropMarker.parentElement === dropzone) hideCharacterDropMarker();
            }
        });

        document.addEventListener('drop', async (event) => {
            if (!dragged) return;

            if (dragged.type === 'folder') {
                const placement = folderPlacementFromEvent(event);
                if (!placement) return;
                event.preventDefault();
                await applyFolderDrop(placement);
                return;
            }

            if (closestElement(event.target, '[data-profile-dropzone], [data-placement-dropzone]')) {
                event.preventDefault();
                await applyCharacterDrop(event.target, event.clientY);
            }
        });

        document.addEventListener('pointerdown', beginPointerDragCandidate);
        window.addEventListener('pointermove', handlePointerDragMove, { passive: false });
        window.addEventListener('pointerup', handlePointerDragEnd);
        window.addEventListener('pointercancel', cancelPointerDrag);

        document.querySelectorAll('[data-close-create-character-modal], [data-close-create-folder-modal], [data-close-edit-folder-modal], [data-close-delete-character-modal]').forEach((button) => {
            button.addEventListener('click', () => button.closest('dialog').close());
        });

        createCharacterModal.addEventListener('close', () => {
            createCharacterForm.reset();
            resetCharacterProfileCropper();
        });
        createFolderModal.addEventListener('close', () => {
            createFolderForm.reset();
            resetFolderImageCropper('new');
        });
        editFolderModal.addEventListener('close', () => {
            editFolderForm.reset();
            resetFolderImageCropper('edit');
            editTargetFolderId = null;
            editFolderRemoveImage = false;
            updateEditFolderCurrentImage(null);
        });
        deleteCharacterModal.addEventListener('close', () => {
            deleteCharacterForm.reset();
            deleteTargetCharacterId = null;
            deleteTargetCharacterName = '';
        });
        deleteFolderModal.addEventListener('close', () => {
            deleteTargetFolderId = null;
        });

        renderAll();
    `

    return <script dangerouslySetInnerHTML={{__html: script}}></script>
}

export function CharacterManagementPage({
    currentUser,
    folders,
    characters,
                                            placements,
                                            uploadedImageCount,
    mediaBaseUrl,
}: CharacterManagementPageProps) {
    const foldersWithUrls = folders.map((folder) => ({
        ...folder,
        folderImageUrl: folder.folderImageKey
            ? characterFolderImageUrl(mediaBaseUrl, currentUser.id, folder.id, folder.folderImageKey)
            : null,
    }))
    const charactersWithUrls = characters
        .slice()
        .sort(compareOrderedNames)
        .map((character) => ({
            ...character,
            profileImageUrl: characterProfileImageUrl(mediaBaseUrl, currentUser.id, character.id, character.profileImageKey),
        }))
    const folderTree = buildFolderTree(foldersWithUrls)

    return (
        <BaseLayout
            head={(
                <CharacterManagementStyles/>
            )}
            title="Character Management | MyOC"
        >
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl}/>
            <main class="management-shell min-h-screen px-3 py-6 sm:px-5">
                <section
                    class="mx-auto mb-5 max-w-7xl overflow-hidden rounded-[2rem] border border-base-300 bg-base-100/90 p-5 shadow-sm sm:p-7">
                    <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                        <div class="max-w-3xl">
                            <h1 class="mt-2 text-4xl font-black leading-none sm:text-6xl">Character Studio.</h1>
                            <p class="mt-4 max-w-2xl text-base text-base-content/70">
                                Create, delete, and sort characters and folders.
                            </p>
                        </div>
                    </div>
                    <div class="mt-6 grid gap-3 sm:grid-cols-3">
                        <div class="rounded-box bg-base-200 p-4">
                            <p class="text-xs uppercase tracking-[0.2em] text-base-content/55">Characters</p>
                            <p class="mt-1 text-2xl font-black"
                               id="character-count">{formatCount(characters.length, 'character')}</p>
                        </div>
                        <div class="rounded-box bg-base-200 p-4">
                            <p class="text-xs uppercase tracking-[0.2em] text-base-content/55">Folders</p>
                            <p class="mt-1 text-2xl font-black"
                               id="folder-count">{formatCount(folders.length, 'folder')}</p>
                        </div>
                        <div class="rounded-box bg-base-200 p-4">
                            <p class="text-xs uppercase tracking-[0.2em] text-base-content/55">Images Uploaded</p>
                            <p class="mt-1 text-2xl font-black">{formatCount(uploadedImageCount, 'image')}</p>
                        </div>
                    </div>
                </section>

                <div
                    class="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[minmax(22rem,1.1fr)_minmax(17rem,0.8fr)_minmax(22rem,1fr)]">
                    <section class="card border border-base-300 bg-base-100/95 shadow-sm">
                        <div class="card-body gap-4 p-4 sm:p-5">
                            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h2 class="card-title text-2xl">All Characters</h2>
                                    <p class="text-sm text-base-content/65">Create and delete characters, and change
                                        their sort-order for your main profile (outside of folders).</p>
                                </div>
                                <button class="btn btn-primary" id="create-character-button" type="button">New
                                    Character
                                </button>
                            </div>
                            <div class="profile-dropzone space-y-2 rounded-box bg-base-200/65 p-2" data-profile-dropzone
                                 id="profile-character-list"></div>
                        </div>
                    </section>

                    <section class="card border border-base-300 bg-base-100/95 shadow-sm">
                        <div class="card-body gap-4 p-4 sm:p-5">
                            <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <h2 class="card-title text-2xl">Folders</h2>
                                    <p class="text-sm text-base-content/65">Create, delete, sort, and nest folders.
                                        Select a folder to display its contents.</p>
                                </div>
                                <button class="btn" id="create-folder-button" type="button">New Folder</button>
                            </div>
                            <div class="rounded-box border border-base-300 bg-base-200/55 p-3">
                                <div class="mb-2 flex items-center gap-2 rounded-box bg-base-100 px-3 py-2 font-bold">
                                    <span aria-hidden="true" class="text-base-content/45">/</span>
                                    <span class="min-w-0 flex-1 truncate">All characters</span>
                                    <span class="badge badge-ghost badge-sm">fixed</span>
                                </div>
                                <div id="folder-tree-root">
                                    {folderTree.length > 0 ? null : (
                                        <div
                                            class="rounded-box border border-dashed border-base-300 bg-base-100 p-4 text-sm text-base-content/65">
                                            No folders yet.
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section class="card border border-base-300 bg-base-100/95 shadow-sm">
                        <div class="card-body gap-4 p-4 sm:p-5">
                            <div>
                                <h2 class="mb-2 text-2xl font-black text-base-content">Inside Folder</h2>
                                <p class="text-sm text-base-content/65">Select a folder, then add and order characters
                                    inside it.</p>
                            </div>
                            <div id="selected-folder-panel">
                                <div
                                    class="rounded-box border border-dashed border-base-300 bg-base-100 p-8 text-center text-base-content/65">
                                    Select or create a folder to manage its character order.
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </main>

            <dialog class="modal" id="create-character-modal">
                <div class="modal-box w-11/12 max-w-3xl">
                    <form method="dialog">
                        <button aria-label="Close create character dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Create Character</h2>
                    <form class="mt-5 space-y-4" id="create-character-form">
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Character Name</legend>
                            <input class="input w-full" id="new-character-name" maxLength={80}
                                   pattern={CHARACTER_NAME_INPUT_PATTERN} required
                                   title={CHARACTER_NAME_INPUT_TITLE}
                                   type="text"/>
                        </fieldset>
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Profile Image</legend>
                            <input accept="image/*" class="file-input w-full" id="new-character-profile-image" required type="file"/>
                            <p class="label">You'll be able to crop the image before uploading.</p>
                        </fieldset>
                        <div class="hidden rounded-box border border-base-300 bg-base-100 p-3" data-character-profile-cropper>
                            <div class="h-[min(62dvh,34rem)] min-h-96 overflow-hidden rounded-box bg-base-300">
                                <img alt="Crop character profile image"
                                     class="block h-full w-full object-contain"
                                     data-character-profile-crop-image/>
                            </div>
                            <p class="mt-2 text-xs text-base-content/60">Drag to choose the square profile crop.</p>
                        </div>
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Initial Folder</legend>
                            <select class="select w-full" id="new-character-folder">
                                <option value="root">All characters only</option>
                            </select>
                            <p class="label">You can add the character to more folders later.</p>
                        </fieldset>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-create-character-modal type="button">Cancel</button>
                            <button class="btn btn-primary" type="submit">Create Character</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <dialog class="modal" id="create-folder-modal">
                <div class="modal-box w-11/12 max-w-3xl">
                    <form method="dialog">
                        <button aria-label="Close create folder dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Create Folder</h2>
                    <form class="mt-5 space-y-4" id="create-folder-form">
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Folder Name</legend>
                            <input class="input w-full" id="new-folder-name" maxLength={80}
                                   pattern="[A-Za-z0-9][A-Za-z0-9 _'.()-]*" required
                                   title="Use letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses. Start with a letter or number."
                                   type="text"/>
                        </fieldset>
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Parent Folder</legend>
                            <select class="select w-full" id="new-folder-parent">
                                <option value="root">All characters</option>
                            </select>
                        </fieldset>
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Folder Image</legend>
                            <input accept="image/*" class="file-input w-full" id="new-folder-image" type="file"/>
                            <p class="label">Optional. You'll be able to crop the image before creating the folder.</p>
                        </fieldset>
                        <div class="hidden rounded-box border border-base-300 bg-base-100 p-3"
                             data-new-folder-image-cropper>
                            <div class="h-[min(62dvh,34rem)] min-h-96 overflow-hidden rounded-box bg-base-300">
                                <img alt="Crop new folder image"
                                     class="block h-full w-full object-contain"
                                     data-new-folder-image-crop-image/>
                            </div>
                            <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p class="text-xs text-base-content/60">Drag to choose the square folder crop.</p>
                                <button class="btn btn-ghost btn-sm" data-cancel-new-folder-image-crop
                                        type="button">Remove image
                                </button>
                            </div>
                        </div>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-create-folder-modal type="button">Cancel</button>
                            <button class="btn" type="submit">Create Folder</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <dialog class="modal" id="edit-folder-modal">
                <div class="modal-box w-11/12 max-w-3xl">
                    <form method="dialog">
                        <button aria-label="Close edit folder dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Edit Folder</h2>
                    <form class="mt-5 space-y-4" id="edit-folder-form">
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Folder Name</legend>
                            <input class="input w-full" id="edit-folder-name" maxLength={80}
                                   pattern="[A-Za-z0-9][A-Za-z0-9 _'.()-]*" required
                                   title="Use letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses. Start with a letter or number."
                                   type="text"/>
                        </fieldset>
                        <div class="hidden rounded-box border border-base-300 bg-base-200/65 p-3"
                             data-edit-folder-current-image-frame>
                            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-base-content/55">Current
                                image</p>
                            <img alt="" class="h-24 w-24 rounded-box object-cover" data-edit-folder-current-image/>
                        </div>
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Folder Image</legend>
                            <input accept="image/*" class="file-input w-full" id="edit-folder-image" type="file"/>
                            <p class="label">Choose a new image to crop, or remove the current image.</p>
                        </fieldset>
                        <div class="hidden rounded-box border border-base-300 bg-base-100 p-3"
                             data-edit-folder-image-cropper>
                            <div class="h-[min(62dvh,34rem)] min-h-96 overflow-hidden rounded-box bg-base-300">
                                <img alt="Crop folder image"
                                     class="block h-full w-full object-contain"
                                     data-edit-folder-image-crop-image/>
                            </div>
                            <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <p class="text-xs text-base-content/60">Drag to choose the square folder crop.</p>
                                <button class="btn btn-ghost btn-sm" data-cancel-edit-folder-image-crop
                                        type="button">Cancel image change
                                </button>
                            </div>
                        </div>
                        <div
                            class="modal-action flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <button class="btn btn-ghost" data-remove-edit-folder-image type="button">Remove image
                            </button>
                            <div class="flex justify-end gap-2">
                                <button class="btn btn-ghost" data-close-edit-folder-modal type="button">Cancel</button>
                                <button class="btn btn-primary" type="submit">Save Folder</button>
                            </div>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <dialog class="modal" id="delete-character-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close delete dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Delete Character</h2>
                    <p class="mt-3 text-sm text-base-content/80">
                        This removes the character from your account, all folders, and its gallery. Type the character
                        name and confirm permanent deletion to continue.
                    </p>
                    <form class="mt-5 space-y-4" id="delete-character-form">
                        <fieldset class="fieldset">
                            <legend class="fieldset-legend">Character Name</legend>
                            <input autocomplete="off" class="input w-full" id="delete-character-confirm-name" required
                                   type="text"/>
                        </fieldset>
                        <label class="label cursor-pointer justify-start gap-3">
                            <input class="checkbox checkbox-error" id="delete-confirm-permanent" type="checkbox"/>
                            <span>I understand this cannot be undone.</span>
                        </label>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-delete-character-modal type="button">Cancel</button>
                            <button class="btn btn-error" type="submit">Delete Character</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <dialog class="modal" id="delete-folder-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close delete folder dialog"
                                class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2" type="submit">x
                        </button>
                    </form>
                    <h2 class="text-xl font-bold">Remove Folder</h2>
                    <p class="mt-3 text-sm text-base-content/80">Nested folders move to All characters. Character
                        placements in this folder are removed, but characters are not deleted.</p>
                    <div class="modal-action">
                        <button class="btn btn-ghost" data-cancel-delete-folder type="button">Cancel</button>
                        <button class="btn btn-error" data-confirm-delete-folder type="button">Remove Folder</button>
                    </div>
                </div>
                <form class="modal-backdrop" method="dialog">
                    <button type="submit">close</button>
                </form>
            </dialog>

            <div aria-live="polite" class="toast toast-end z-9999" id="toast-region"></div>
            <script src="/vendor/cropperjs/cropper.min.js"></script>
            <CharacterManagementScript
                characters={charactersWithUrls}
                csrfToken={currentUser.csrfToken}
                folders={foldersWithUrls}
                placements={placements}
            />
        </BaseLayout>
    )
}
