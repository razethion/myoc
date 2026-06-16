import type {CurrentUser} from '../../lib/auth/session'
import {characterProfileImageUrl} from '../../lib/media/url'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

export type CharacterManagementFolder = {
    id: string
    name: string
    parentFolderId: string | null
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

export type CharacterManagementTreeItem =
    | (CharacterManagementFolder & { type: 'folder'; children: CharacterManagementTreeItem[] })
    | (CharacterManagementCharacter & { type: 'character' })

type CharacterManagementPageProps = {
    currentUser: CurrentUser
    folders: CharacterManagementFolder[]
    characters: CharacterManagementCharacter[]
    mediaBaseUrl: string
}

function buildTree(
    folders: CharacterManagementFolder[],
    characters: CharacterManagementCharacter[],
    parentFolderId: string | null = null,
): CharacterManagementTreeItem[] {
    const childFolders = folders
        .filter((folder) => folder.parentFolderId === parentFolderId)
        .sort(compareTreeItems)
        .map((folder) => ({
            ...folder,
            type: 'folder' as const,
            children: buildTree(folders, characters, folder.id),
        }))
    const childCharacters = characters
        .filter((character) => character.folderId === parentFolderId)
        .sort(compareTreeItems)
        .map((character) => ({
            ...character,
            type: 'character' as const,
        }))

    return [...childFolders, ...childCharacters]
}

function compareTreeItems(left: { sortOrder: number; name: string }, right: { sortOrder: number; name: string }): number {
    return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
}

function countCharacters(items: CharacterManagementTreeItem[]): number {
    return items.reduce((count, item) => count + (item.type === 'character' ? 1 : countCharacters(item.children)), 0)
}

function countFolders(items: CharacterManagementTreeItem[]): number {
    return items.reduce((count, item) => count + (item.type === 'folder' ? 1 + countFolders(item.children) : 0), 0)
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`
}

const CHARACTER_NAME_INPUT_PATTERN = String.raw`(?=.*[A-Za-z0-9])[A-Za-z0-9 _'.\(\)"\-]+`
const CHARACTER_NAME_INPUT_TITLE = 'Use letters, numbers, spaces, apostrophes, quotation marks, hyphens, underscores, periods, and parentheses. Include at least one letter or number.'

function CharacterManagementStyles() {
    return (
        <style>{`
            .management-item[aria-grabbed="true"] { opacity: 0.5; }
            .character-dropzone.drag-over {
                outline: 2px dashed currentColor;
                outline-offset: 4px;
            }
            .folder-row.drag-over {
                background: color-mix(in oklab, currentColor 10%, transparent);
                outline: 1px solid color-mix(in oklab, currentColor 22%, transparent);
            }
            .folder-drop-marker {
                position: fixed;
                z-index: 80;
                height: 2px;
                border-radius: 999px;
                background: white;
                box-shadow: 0 0 0 1px color-mix(in oklab, black 8%, transparent), 0 0 14px color-mix(in oklab, white 65%, transparent);
                pointer-events: none;
            }
            .item-dropzone:empty::before {
                content: "Drop folders here";
                color: color-mix(in oklab, currentColor 55%, transparent);
                font-size: 0.875rem;
            }
            .character-dropzone:empty::before {
                content: "No characters in this folder";
                color: color-mix(in oklab, currentColor 55%, transparent);
                font-size: 0.875rem;
            }
            .item-dropzone,
            .character-dropzone {
                min-height: 2.25rem;
                padding-top: 0.5rem;
                padding-bottom: 0.5rem;
            }
            .tree-children {
                margin-left: clamp(1rem, 3vw, 1.5rem);
                padding-left: 0.75rem;
                border-left: 1px solid color-mix(in oklab, currentColor 18%, transparent);
            }
            .tree-panel { overflow-x: auto; }
            .tree-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }
            .drag-handle {
                cursor: grab;
                line-height: 1;
            }
            .management-item[aria-grabbed="true"] .drag-handle { cursor: grabbing; }
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
            #create-character-modal [data-character-profile-cropper] [data-character-profile-crop-image],
            #create-character-modal [data-character-profile-cropper] .cropper-container {
                max-height: 40dvh !important;
            }
            @media (min-width: 640px) {
                #create-character-modal {
                    align-items: center;
                    padding: 1rem;
                }
                #create-character-modal .modal-box {
                    max-height: calc(100dvh - 2rem);
                }
                #create-character-modal [data-character-profile-cropper] [data-character-profile-crop-image],
                #create-character-modal [data-character-profile-cropper] .cropper-container {
                    max-height: 22rem !important;
                }
            }
            .toast-message { animation: toast-fade 2600ms ease forwards; }
            @keyframes toast-fade {
                0%, 80% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(0.5rem); }
            }
        `}</style>
    )
}

function CharacterManagementScript({tree, csrfToken}: { tree: CharacterManagementTreeItem[]; csrfToken: string }) {
    const initialJson = JSON.stringify(tree).replace(/</g, '\\u003c')
        const script = `
        const csrfToken = ${JSON.stringify(csrfToken)};
        let tree = ${initialJson};
        let selectedFolderId = 'root';
        let draggedFolderId = null;
        let draggedCharacterId = null;
        let deleteTargetCharacterId = null;
        let deleteTargetCharacterName = '';
        let deleteTargetFolderId = null;
        let characterProfileCropperInstance = null;
        let characterProfileObjectUrl = null;
        let currentFolderNestRow = null;
        let currentFolderSortKey = '';
        const folderDropMarker = document.createElement('div');
        folderDropMarker.className = 'folder-drop-marker';

        const folderTreeRoot = document.getElementById('folder-tree-root');
        const characterList = document.getElementById('character-list');
        const folderCount = document.getElementById('folder-count');
        const characterCount = document.getElementById('character-count');
        const createCharacterModal = document.getElementById('create-character-modal');
        const createCharacterForm = document.getElementById('create-character-form');
        const createFolderModal = document.getElementById('create-folder-modal');
        const createFolderForm = document.getElementById('create-folder-form');
        const deleteCharacterModal = document.getElementById('delete-character-modal');
        const deleteCharacterForm = document.getElementById('delete-character-form');
        const deleteFolderModal = document.getElementById('delete-folder-modal');
        const toastRegion = document.getElementById('toast-region');
        const characterProfileInput = document.getElementById('new-character-profile-image');
        const characterProfileCropper = document.querySelector('[data-character-profile-cropper]');
        const characterProfileCropImage = document.querySelector('[data-character-profile-crop-image]');

        function escapeHtml(value) {
            return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
        }

        function normalizeFolderId(value) {
            return value && value !== 'root' ? value : null;
        }

        function folderOptions(items = tree, depth = 0) {
            const options = [{ id: 'root', label: 'Home (unsorted)' }];
            function walk(children, level) {
                for (const item of children) {
                    if (item.type !== 'folder') continue;
                    options.push({ id: item.id, label: '— '.repeat(level) + item.name });
                    walk(item.children || [], level + 1);
                }
            }
            walk(items, depth);
            return options;
        }

        function renderFolderSelect(select, selectedValue = 'root') {
            if (!select) return;
            select.innerHTML = folderOptions()
                .map((option) => '<option value="' + escapeHtml(option.id) + '"' + (option.id === selectedValue ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>')
                .join('');
        }

        function pluralize(count, singular, plural = singular + 's') {
            return count + ' ' + (count === 1 ? singular : plural);
        }

        function renderAll() {
            renderFolderTree();
            renderFolderControls();
            renderCharacters();
        }

        function renderFolderControls() {
            const selectedValue = findItem('folder', selectedFolderId) ? selectedFolderId : 'root';
            selectedFolderId = selectedValue;
            renderFolderSelect(document.getElementById('new-character-folder'), selectedValue);
            renderFolderSelect(document.getElementById('new-folder-parent'), selectedValue);
        }

        function renderFolderTree() {
            folderTreeRoot.innerHTML = folderDropzoneHtml('root', foldersOnly(tree));
            folderCount.textContent = pluralize(countFolders(tree), 'folder');
        }

        function foldersOnly(items) {
            return items.filter((item) => item.type === 'folder');
        }

        function folderDropzoneHtml(parentFolderId, folders) {
            return '<div class="item-dropzone" data-folder-dropzone data-parent-folder-id="' + escapeHtml(parentFolderId) + '">' +
                folders.map(folderHtml).join('') +
                '</div>';
        }

        function folderHtml(folder) {
            return '<article class="management-item tree-item" data-folder-id="' + escapeHtml(folder.id) + '" data-folder-sort-item draggable="true">' +
                '<div class="tree-row folder-row flex items-center gap-3 rounded-xl px-3 py-2 transition-colors hover:bg-base-200/80" data-folder-drop-target>' +
                '<span aria-hidden="true" class="drag-handle text-base-content/60">☰</span>' +
                '<button aria-expanded="true" class="btn btn-ghost btn-xs btn-square" data-toggle-folder type="button">-</button>' +
                '<span class="tree-label min-w-0 flex-1 font-semibold">' + escapeHtml(folder.name) + '</span>' +
                '<button aria-label="Delete ' + escapeHtml(folder.name) + ' folder" class="btn btn-error btn-outline btn-xs btn-square" data-delete-folder type="button">x</button>' +
                '</div><div class="tree-children mt-2" data-folder-children>' +
                folderDropzoneHtml(folder.id, foldersOnly(folder.children || [])) +
                '</div></article>';
        }

        function renderCharacters() {
            characterCount.textContent = pluralize(countCharacters(tree), 'character');
            characterList.innerHTML = folderOptions().map((folder) => {
                const children = findChildren(folder.id) || [];
                const characters = children.filter((item) => item.type === 'character');
                return '<section class="rounded-box border border-base-300 bg-base-100/70 p-3">' +
                    '<div class="mb-2 flex items-center justify-between gap-3">' +
                    '<h3 class="tree-label text-sm font-bold">' + escapeHtml(folder.label) + '</h3>' +
                    '<span class="text-xs text-base-content/60">' + pluralize(characters.length, 'character') + '</span>' +
                    '</div>' +
                    '<div class="character-dropzone space-y-2 rounded-xl bg-base-200/45 p-2" data-character-dropzone data-character-folder-id="' + escapeHtml(folder.id) + '">' +
                    characters.map((character) => characterHtml(character, folder.id)).join('') +
                    '</div></section>';
            }).join('');
        }

        function characterHtml(character, currentFolderId) {
            return '<article class="management-item rounded border border-base-300 bg-base-200 p-2" data-character-id="' + escapeHtml(character.id) + '" data-character-sort-item draggable="true">' +
                '<div class="flex flex-col gap-3 sm:flex-row sm:items-center">' +
                '<div class="flex min-w-0 flex-1 items-center gap-3">' +
                '<span aria-hidden="true" class="drag-handle text-base-content/60">☰</span>' +
                '<img alt="' + escapeHtml(character.name) + '" class="h-14 w-14 rounded object-cover" src="' + escapeHtml(character.profileImageUrl) + '"/>' +
                '<a aria-label="Edit ' + escapeHtml(character.name) + '" class="tree-label min-w-0 flex-1 font-bold" href="/edit/' + encodeURIComponent(character.id) + '">' + escapeHtml(character.name) + '</a>' +
                '</div>' +
                '<div class="flex flex-wrap items-center gap-2 sm:justify-end">' +
                '<label class="flex items-center gap-2 text-sm"><span class="opacity-70">Folder</span><select class="select select-bordered select-sm" data-character-folder-select data-character-id="' + escapeHtml(character.id) + '">' + folderOptions().map((option) => '<option value="' + escapeHtml(option.id) + '"' + (option.id === currentFolderId ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>').join('') + '</select></label>' +
                '<button aria-label="Delete ' + escapeHtml(character.name) + '" class="btn btn-error btn-sm btn-square" data-delete-character type="button">x</button>' +
                '</div></div></article>';
        }

        function countCharacters(items) {
            return items.reduce((count, item) => count + (item.type === 'character' ? 1 : countCharacters(item.children || [])), 0);
        }

        function countFolders(items) {
            return items.reduce((count, item) => count + (item.type === 'folder' ? 1 + countFolders(item.children || []) : 0), 0);
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

        function findChildren(folderId, items = tree) {
            const normalizedFolderId = normalizeFolderId(folderId);
            if (!normalizedFolderId) return tree;
            for (const item of items) {
                if (item.type === 'folder') {
                    if (item.id === normalizedFolderId) return item.children;
                    const found = findChildren(normalizedFolderId, item.children || []);
                    if (found) return found;
                }
            }
            return null;
        }

        function findItem(type, id, items = tree) {
            const normalizedId = normalizeFolderId(id) || id;
            for (const item of items) {
                if (item.type === type && item.id === normalizedId) return item;
                if (item.type === 'folder') {
                    const found = findItem(type, normalizedId, item.children || []);
                    if (found) return found;
                }
            }
            return null;
        }

        function findItemLocation(type, id, items = tree, parentFolderId = 'root') {
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (item.type === type && item.id === id) return { parentFolderId, index };
                if (item.type === 'folder') {
                    const found = findItemLocation(type, id, item.children || [], item.id);
                    if (found) return found;
                }
            }
            return null;
        }

        function removeItem(type, id, items = tree) {
            for (let index = 0; index < items.length; index += 1) {
                const item = items[index];
                if (item.type === type && item.id === id) return items.splice(index, 1)[0];
                if (item.type === 'folder') {
                    const removed = removeItem(type, id, item.children || []);
                    if (removed) return removed;
                }
            }
            return null;
        }

        function isDescendantFolder(folder, targetFolderId) {
            return (folder.children || []).some((item) => item.type === 'folder' && (item.id === targetFolderId || isDescendantFolder(item, targetFolderId)));
        }

        function insertItemIntoFolder(item, folderId, index = null) {
            const children = findChildren(folderId);
            if (!children) throw new Error('Folder not found.');
            const folders = children.filter((child) => child.type === 'folder').length;
            const insertIndex = index === null ? children.length : Math.max(0, Math.min(index, children.length));
            if (item.type === 'folder') {
                const folderIndex = Math.min(insertIndex, folders);
                children.splice(folderIndex, 0, item);
            } else {
                const characterIndex = Math.max(insertIndex, folders);
                children.splice(characterIndex, 0, item);
            }
        }

        async function persistTree() {
            await apiJson('/api/characters/tree', {
                method: 'POST',
                body: JSON.stringify({ items: tree }),
            });
        }

        function indexFromPointer(container, pointerY, selector) {
            const items = Array.from(container.querySelectorAll(':scope > ' + selector));
            const next = items.find((item) => {
                const box = item.getBoundingClientRect();
                return pointerY < box.top + box.height / 2;
            });
            return next ? items.indexOf(next) : items.length;
        }

        function nextFolderSortElement(item) {
            let sibling = item.nextElementSibling;
            while (sibling && !sibling.matches('[data-folder-sort-item]')) {
                sibling = sibling.nextElementSibling;
            }
            return sibling;
        }

        function folderPlacementFromEvent(event) {
            const row = event.target.closest('[data-folder-drop-target]');
            if (row) {
                const item = row.closest('[data-folder-sort-item]');
                if (!item) return null;
                const box = row.getBoundingClientRect();
                const edgeSize = Math.min(14, Math.max(8, box.height * 0.28));
                const pointerOffset = event.clientY - box.top;
                if (pointerOffset <= edgeSize || pointerOffset >= box.height - edgeSize) {
                    return {
                        type: 'sort',
                        container: item.parentElement.closest('[data-folder-dropzone]'),
                        beforeElement: pointerOffset <= edgeSize ? item : nextFolderSortElement(item),
                    };
                }
                return { type: 'nest', folderId: item.dataset.folderId, row };
            }

            const container = event.target.closest('[data-folder-dropzone]');
            if (!container) return null;
            const index = indexFromPointer(container, event.clientY, '[data-folder-sort-item]');
            const items = Array.from(container.querySelectorAll(':scope > [data-folder-sort-item]'));
            return { type: 'sort', container, beforeElement: items[index] || null };
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

        function clearFolderDropState() {
            hideFolderDropMarker();
            if (currentFolderNestRow) currentFolderNestRow.classList.remove('drag-over');
            currentFolderNestRow = null;
            currentFolderSortKey = '';
        }

        async function loadCharacterProfileForCropping(file) {
            if (!file || !file.type.startsWith('image/')) throw new Error('Choose an image file.');
            if (typeof Cropper === 'undefined') throw new Error('Profile image editor could not load. Refresh and try again.');
            if (characterProfileCropperInstance) characterProfileCropperInstance.destroy();
            if (characterProfileObjectUrl) URL.revokeObjectURL(characterProfileObjectUrl);
            characterProfileObjectUrl = URL.createObjectURL(file);
            characterProfileCropImage.src = characterProfileObjectUrl;
            characterProfileCropperInstance = new Cropper(characterProfileCropImage, {
                aspectRatio: 1,
                autoCropArea: 1,
                background: false,
                viewMode: 1,
                zoomable: false,
                zoomOnTouch: false,
                zoomOnWheel: false,
            });
        }

        function createCroppedCharacterProfileDataUrl() {
            if (!characterProfileCropperInstance) throw new Error('Choose a profile image first.');
            const canvas = characterProfileCropperInstance.getCroppedCanvas({
                width: 512,
                height: 512,
                imageSmoothingEnabled: true,
                imageSmoothingQuality: 'high',
            });
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

        document.getElementById('create-character-button').addEventListener('click', () => {
            renderFolderControls();
            createCharacterModal.showModal();
            document.getElementById('new-character-name').focus();
        });

        document.getElementById('create-folder-button').addEventListener('click', () => {
            renderFolderControls();
            createFolderModal.showModal();
            document.getElementById('new-folder-name').focus();
        });

        characterProfileInput.addEventListener('change', async () => {
            resetCharacterProfileCropper();
            const file = characterProfileInput.files && characterProfileInput.files[0];
            if (!file) return;
            try {
                await loadCharacterProfileForCropping(file);
                characterProfileCropper.classList.remove('hidden');
            } catch (error) {
                showToast(error.message || 'Could not prepare profile image.', true);
                characterProfileInput.value = '';
            }
        });

        createCharacterForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const button = createCharacterForm.querySelector('[type="submit"]');
            button.disabled = true;
            try {
                const name = document.getElementById('new-character-name').value.trim();
                const folderId = normalizeFolderId(document.getElementById('new-character-folder').value);
                const profileImageData = createCroppedCharacterProfileDataUrl();
                const result = await apiJson('/api/characters', {
                    method: 'POST',
                    body: JSON.stringify({ name, folderId, profileImageData }),
                });
                insertItemIntoFolder({ type: 'character', ...result.character }, folderId);
                selectedFolderId = folderId || 'root';
                createCharacterModal.close();
                createCharacterForm.reset();
                resetCharacterProfileCropper();
                await persistTree();
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
                const result = await apiJson('/api/characters/folders', {
                    method: 'POST',
                    body: JSON.stringify({ name, parentFolderId }),
                });
                insertItemIntoFolder({ type: 'folder', ...result.folder, children: [] }, parentFolderId);
                createFolderModal.close();
                createFolderForm.reset();
                await persistTree();
                renderAll();
                showToast('Folder created.');
            } catch (error) {
                showToast(error.message, true);
            } finally {
                button.disabled = false;
            }
        });

        document.addEventListener('click', async (event) => {
            const toggleButton = event.target.closest('[data-toggle-folder]');
            const deleteCharacterButton = event.target.closest('[data-delete-character]');
            const deleteFolderButton = event.target.closest('[data-delete-folder]');

            if (toggleButton) {
                const folder = toggleButton.closest('[data-folder-sort-item]');
                const children = folder.querySelector(':scope > [data-folder-children]');
                const expanded = toggleButton.getAttribute('aria-expanded') === 'true';
                children.classList.toggle('hidden', expanded);
                toggleButton.setAttribute('aria-expanded', String(!expanded));
                toggleButton.textContent = expanded ? '+' : '-';
                return;
            }

            if (deleteCharacterButton) {
                const item = deleteCharacterButton.closest('[data-character-sort-item]');
                deleteTargetCharacterId = item.dataset.characterId;
                deleteTargetCharacterName = item.querySelector('a').textContent.trim();
                document.getElementById('delete-character-confirm-name').placeholder = deleteTargetCharacterName;
                deleteCharacterModal.showModal();
                return;
            }

            if (deleteFolderButton) {
                deleteTargetFolderId = deleteFolderButton.closest('[data-folder-sort-item]').dataset.folderId;
                deleteFolderModal.showModal();
            }
        });

        document.addEventListener('change', async (event) => {
            const select = event.target.closest('[data-character-folder-select]');
            if (!select) return;
            const location = findItemLocation('character', select.dataset.characterId);
            const character = removeItem('character', select.dataset.characterId);
            if (!character) return;
            try {
                insertItemIntoFolder(character, normalizeFolderId(select.value));
                selectedFolderId = select.value;
                await persistTree();
                renderAll();
                showToast('Character moved.');
            } catch (error) {
                insertItemIntoFolder(character, location ? location.parentFolderId : 'root', location ? location.index : null);
                renderAll();
                showToast(error.message, true);
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
                removeItem('character', deleteTargetCharacterId);
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
            const folder = removeItem('folder', deleteTargetFolderId);
            if (!folder) return;
            try {
                await apiJson('/api/characters/folders/' + encodeURIComponent(deleteTargetFolderId), { method: 'DELETE' });
                tree.push(...(folder.children || []));
                if (selectedFolderId === deleteTargetFolderId) selectedFolderId = 'root';
                await persistTree();
                deleteFolderModal.close();
                renderAll();
                showToast(folder.name + ' removed. Its contents moved to Home (unsorted).');
            } catch (error) {
                insertItemIntoFolder(folder, 'root');
                renderAll();
                showToast(error.message, true);
            }
        });

        document.addEventListener('dragstart', (event) => {
            const folder = event.target.closest('[data-folder-sort-item]');
            const character = event.target.closest('[data-character-sort-item]');
            if (folder) {
                draggedFolderId = folder.dataset.folderId;
                folder.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'move';
                return;
            }
            if (character) {
                draggedCharacterId = character.dataset.characterId;
                character.setAttribute('aria-grabbed', 'true');
                event.dataTransfer.effectAllowed = 'move';
            }
        });

        document.addEventListener('dragend', () => {
            document.querySelectorAll('[aria-grabbed="true"]').forEach((item) => item.removeAttribute('aria-grabbed'));
            draggedFolderId = null;
            draggedCharacterId = null;
            document.querySelectorAll('.drag-over').forEach((dropzone) => dropzone.classList.remove('drag-over'));
            clearFolderDropState();
        });

        document.addEventListener('dragover', (event) => {
            const characterDropzone = event.target.closest('[data-character-dropzone]');
            if (draggedFolderId) {
                const placement = folderPlacementFromEvent(event);
                if (!placement) {
                    clearFolderDropState();
                    return;
                }
                event.preventDefault();
                showFolderPlacement(placement);
                return;
            }
            if (draggedCharacterId && characterDropzone) {
                event.preventDefault();
                characterDropzone.classList.add('drag-over');
            }
        });

        document.addEventListener('dragleave', (event) => {
            const dropzone = event.target.closest('[data-character-dropzone]');
            if (dropzone) dropzone.classList.remove('drag-over');
        });

        document.addEventListener('drop', async (event) => {
            const characterDropzone = event.target.closest('[data-character-dropzone]');

            if (draggedFolderId) {
                const placement = folderPlacementFromEvent(event);
                if (!placement) return;
                event.preventDefault();
                const parentFolderId = placement.type === 'nest'
                    ? placement.folderId
                    : normalizeFolderId(placement.container.dataset.parentFolderId);
                const originalLocation = findItemLocation('folder', draggedFolderId);
                const beforeFolderId = placement.type === 'sort' && placement.beforeElement
                    ? placement.beforeElement.dataset.folderId
                    : null;
                if (beforeFolderId === draggedFolderId) {
                    clearFolderDropState();
                    renderAll();
                    return;
                }
                const folder = removeItem('folder', draggedFolderId);
                if (!folder) return;
                if (folder.id === parentFolderId || isDescendantFolder(folder, parentFolderId)) {
                    insertItemIntoFolder(folder, originalLocation ? originalLocation.parentFolderId : 'root', originalLocation ? originalLocation.index : null);
                    clearFolderDropState();
                    renderAll();
                    showToast('A folder cannot be moved inside itself.', true);
                    return;
                }
                try {
                    let index = null;
                    if (placement.type === 'sort' && beforeFolderId) {
                        const children = findChildren(parentFolderId);
                        index = children ? children.findIndex((item) => item.type === 'folder' && item.id === beforeFolderId) : null;
                        if (index === -1) index = null;
                    }
                    insertItemIntoFolder(folder, parentFolderId, index);
                    await persistTree();
                    clearFolderDropState();
                    renderAll();
                    showToast(placement.type === 'nest' ? 'Folder moved.' : 'Folder order saved.');
                } catch (error) {
                    insertItemIntoFolder(folder, originalLocation ? originalLocation.parentFolderId : 'root', originalLocation ? originalLocation.index : null);
                    clearFolderDropState();
                    renderAll();
                    showToast(error.message, true);
                }
                return;
            }

            if (draggedCharacterId && characterDropzone) {
                event.preventDefault();
                const targetFolderId = normalizeFolderId(characterDropzone.dataset.characterFolderId);
                const originalLocation = findItemLocation('character', draggedCharacterId);
                const character = removeItem('character', draggedCharacterId);
                if (!character) return;
                try {
                    const index = indexFromPointer(characterDropzone, event.clientY, '[data-character-sort-item]');
                    const targetChildren = findChildren(targetFolderId) || tree;
                    const folderOffset = targetChildren.filter((item) => item.type === 'folder').length;
                    insertItemIntoFolder(character, targetFolderId, folderOffset + index);
                    selectedFolderId = characterDropzone.dataset.characterFolderId;
                    await persistTree();
                    renderAll();
                    showToast('Character order saved.');
                } catch (error) {
                    insertItemIntoFolder(character, originalLocation ? originalLocation.parentFolderId : 'root', originalLocation ? originalLocation.index : null);
                    renderAll();
                    showToast(error.message, true);
                }
            }
        });

        document.querySelectorAll('[data-close-create-character-modal], [data-close-create-folder-modal], [data-close-delete-character-modal]').forEach((button) => {
            button.addEventListener('click', () => button.closest('dialog').close());
        });

        createCharacterModal.addEventListener('close', () => {
            createCharacterForm.reset();
            resetCharacterProfileCropper();
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
    mediaBaseUrl,
}: CharacterManagementPageProps) {
    const charactersWithUrls = characters.map((character) => ({
        ...character,
        profileImageUrl: characterProfileImageUrl(mediaBaseUrl, currentUser.id, character.id, character.profileImageKey),
    }))
    const tree = buildTree(folders, charactersWithUrls)

    return (
        <BaseLayout
            head={(
                <>
                    <link href="/vendor/cropperjs/cropper.min.css" rel="stylesheet"/>
                    <CharacterManagementStyles/>
                </>
            )}
            title="Character Management | MyOC"
        >
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl}/>
            <main class="container mx-auto max-w-6xl px-3 py-6 sm:px-0">
                <div class="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h1 class="text-4xl font-bold sm:text-5xl">Characters</h1>
                        <p class="mt-2 text-sm text-base-content/70">Manage folder structure separately from character placement and order.</p>
                    </div>
                    <div class="flex flex-wrap gap-2 sm:justify-end">
                        <button class="btn btn-secondary" id="create-folder-button" type="button">New Folder</button>
                        <button class="btn btn-primary" id="create-character-button" type="button">New Character</button>
                    </div>
                </div>

                <div class="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.25fr)]">
                    <section class="rounded-box border border-base-300 bg-base-200 p-4">
                        <div class="mb-4 flex items-start justify-between gap-3">
                            <div>
                                <h2 class="text-2xl font-bold">Folder Structure</h2>
                                <p class="mt-1 text-sm text-base-content/70">Drop on a folder to nest it, or use the white line to reorder siblings.</p>
                            </div>
                            <span class="whitespace-nowrap text-sm text-base-content/70" id="folder-count">{formatCount(countFolders(tree), 'folder')}</span>
                        </div>
                        <div class="tree-panel rounded-box border border-base-300 bg-base-100 p-3">
                            <div class="tree-row flex items-center gap-3 rounded-xl bg-base-200/65 px-3 py-2">
                                <span aria-hidden="true" class="w-4 text-base-content/40">/</span>
                                <span class="tree-label min-w-0 flex-1 font-bold">Home (unsorted)</span>
                                <span class="text-xs text-base-content/60">Fixed</span>
                            </div>
                            <div class="tree-children mt-2" id="folder-tree-root"></div>
                        </div>
                    </section>

                    <section class="rounded-box border border-base-300 bg-base-200 p-4">
                        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                            <div>
                                <h2 class="text-2xl font-bold">Characters</h2>
                                <p class="mt-1 text-sm text-base-content/70">All characters stay visible. Change folder placement from each character row.</p>
                            </div>
                            <span class="whitespace-nowrap text-sm text-base-content/70" id="character-count">{formatCount(countCharacters(tree), 'character')}</span>
                        </div>
                        <div class="space-y-3" id="character-list"></div>
                    </section>
                </div>
            </main>

            <dialog class="modal" id="create-character-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close create character dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button>
                    </form>
                    <h2 class="text-xl font-bold">Create Character</h2>
                    <form class="mt-5 space-y-4" id="create-character-form">
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="new-character-name">Character Name</label>
                            <input class="input input-bordered w-full" id="new-character-name" maxLength={80}
                                   pattern={CHARACTER_NAME_INPUT_PATTERN} required
                                   title={CHARACTER_NAME_INPUT_TITLE}
                                   type="text"/>
                        </fieldset>
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="new-character-profile-image">Profile Image</label>
                            <input accept="image/*" class="file-input w-full" id="new-character-profile-image" required type="file"/>
                            <p class="text-xs text-base-content/60">You'll be able to crop the image before uploading.</p>
                        </fieldset>
                        <div class="hidden rounded-box border border-base-300 bg-base-100 p-3" data-character-profile-cropper>
                            <div class="max-h-[40dvh] overflow-hidden rounded-box bg-base-300 sm:max-h-[22rem]">
                                <img alt="Crop character profile image"
                                     class="block max-h-[40dvh] w-full object-contain sm:max-h-[22rem]"
                                     data-character-profile-crop-image/>
                            </div>
                            <p class="mt-2 text-xs text-base-content/60">Drag to choose the square profile crop.</p>
                        </div>
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="new-character-folder">Folder</label>
                            <select class="select select-bordered w-full" id="new-character-folder">
                                <option value="root">Home (unsorted)</option>
                            </select>
                        </fieldset>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-create-character-modal type="button">Cancel</button>
                            <button class="btn btn-primary" type="submit">Create Character</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>

            <dialog class="modal" id="create-folder-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close create folder dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button>
                    </form>
                    <h2 class="text-xl font-bold">Create Folder</h2>
                    <form class="mt-5 space-y-4" id="create-folder-form">
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="new-folder-name">Folder Name</label>
                            <input class="input input-bordered w-full" id="new-folder-name" maxLength={80}
                                   pattern="[A-Za-z0-9][A-Za-z0-9 _'.()-]*" required
                                   title="Use letters, numbers, spaces, apostrophes, hyphens, underscores, periods, and parentheses. Start with a letter or number."
                                   type="text"/>
                        </fieldset>
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="new-folder-parent">Parent Folder</label>
                            <select class="select select-bordered w-full" id="new-folder-parent">
                                <option value="root">Home (unsorted)</option>
                            </select>
                        </fieldset>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-create-folder-modal type="button">Cancel</button>
                            <button class="btn btn-primary" type="submit">Create Folder</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>

            <dialog class="modal" id="delete-character-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close delete dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button>
                    </form>
                    <h2 class="text-xl font-bold">Delete Character</h2>
                    <p class="mt-3 text-sm text-base-content/80">
                        This removes the character from your account. Type the character name and confirm permanent deletion to continue.
                    </p>
                    <form class="mt-5 space-y-4" id="delete-character-form">
                        <fieldset class="fieldset">
                            <label class="fieldset-label" for="delete-character-confirm-name">Character Name</label>
                            <input autocomplete="off" class="input input-bordered w-full" id="delete-character-confirm-name" required type="text"/>
                        </fieldset>
                        <label class="label cursor-pointer justify-start gap-3">
                            <input class="checkbox checkbox-error" id="delete-confirm-permanent" type="checkbox"/>
                            <span class="label-text">I understand this cannot be undone.</span>
                        </label>
                        <div class="modal-action">
                            <button class="btn btn-ghost" data-close-delete-character-modal type="button">Cancel</button>
                            <button class="btn btn-error" type="submit">Delete Character</button>
                        </div>
                    </form>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>

            <dialog class="modal" id="delete-folder-modal">
                <div class="modal-box">
                    <form method="dialog">
                        <button aria-label="Close delete folder dialog" class="btn btn-sm btn-circle btn-ghost absolute right-2 top-2">x</button>
                    </form>
                    <h2 class="text-xl font-bold">Remove Folder</h2>
                    <p class="mt-3 text-sm text-base-content/80">Characters and nested folders inside this folder will move to Home (unsorted).</p>
                    <div class="modal-action">
                        <button class="btn btn-ghost" data-cancel-delete-folder type="button">Cancel</button>
                        <button class="btn btn-error" data-confirm-delete-folder type="button">Remove Folder</button>
                    </div>
                </div>
                <form class="modal-backdrop" method="dialog"><button>close</button></form>
            </dialog>

            <div aria-live="polite" class="toast toast-end z-[9999]" id="toast-region"></div>
            <script src="/vendor/cropperjs/cropper.min.js"></script>
            <CharacterManagementScript csrfToken={currentUser.csrfToken} tree={tree}/>
        </BaseLayout>
    )
}
