// @ts-nocheck
export const adminImageApprovalsScript = `((__name) => {(${adminImageApprovalsClient.toString()})();})((target) => target);`

function adminImageApprovalsClient() {
    const root = document.querySelector<HTMLElement>('[data-image-approvals]')
    const dataScript = document.getElementById('image-approval-data')

    if (!root || !dataScript) {
        return
    }

    const currentContainer = root.querySelector<HTMLElement>('[data-approval-current]')
    const csrfToken = root.dataset.csrfToken || ''
    let state = JSON.parse(dataScript.dataset.imageApprovalState || '{}')
    let selectedActions: Record<string, string> = {}

    const sfwActions = [
        ['approve_sfw_homepage', 'Approve SFW, Allow Homepage'],
        ['approve_sfw_no_homepage', 'Approve SFW, No Homepage'],
        ['mark_nsfw', 'Mark as NSFW'],
        ['report_sfw', 'Report'],
    ]
    const nsfwActions = [
        ['approve_nsfw', 'Approve NSFW'],
        ['mark_sfw_homepage', 'Mark SFW, Approve Allow Homepage'],
        ['mark_sfw_no_homepage', 'Mark SFW, No Homepage'],
        ['report_nsfw', 'Report'],
    ]

    function escapeHtml(value: unknown) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
    }

    function formatBytes(value: unknown) {
        if (!Number.isFinite(Number(value))) {
            return 'Unknown size'
        }

        const units = ['B', 'KB', 'MB', 'GB']
        let size = Number(value)
        let unitIndex = 0

        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024
            unitIndex += 1
        }

        return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
    }

    function formatDimensions(variant: {width?: unknown; height?: unknown} | null) {
        if (!variant?.width || !variant.height) {
            return 'Unknown dimensions'
        }

        return `${variant.width} x ${variant.height}`
    }

    function formatDate(value: unknown) {
        if (!value) {
            return 'Never'
        }

        const date = new Date(`${String(value).replace(' ', 'T')}Z`)

        if (Number.isNaN(date.getTime())) {
            return String(value)
        }

        return date.toLocaleString()
    }

    function getMovedVariant(rating: 'sfw' | 'nsfw') {
        if (!state.current) {
            return null
        }

        if (rating === 'sfw' && selectedActions.nsfw === 'mark_sfw_homepage' && !state.current.sfw) {
            return {...state.current.nsfw, rating: 'sfw', movedFrom: 'NSFW'}
        }

        if (rating === 'sfw' && selectedActions.nsfw === 'mark_sfw_no_homepage' && !state.current.sfw) {
            return {...state.current.nsfw, rating: 'sfw', movedFrom: 'NSFW'}
        }

        if (rating === 'nsfw' && selectedActions.sfw === 'mark_nsfw' && !state.current.nsfw) {
            return {...state.current.sfw, rating: 'nsfw', movedFrom: 'SFW'}
        }

        return null
    }

    function sourceWillMove(rating: 'sfw' | 'nsfw') {
        return (
            (rating === 'sfw' && selectedActions.sfw === 'mark_nsfw') ||
            (rating === 'nsfw' && (selectedActions.nsfw === 'mark_sfw_homepage' || selectedActions.nsfw === 'mark_sfw_no_homepage'))
        )
    }

    function renderVariant(rating: 'sfw' | 'nsfw') {
        const current = state.current
        const original = current?.[rating]
        const moved = getMovedVariant(rating)
        const variant = moved || original
        const title = rating === 'sfw' ? 'SFW Image' : 'NSFW Image'
        const actions = rating === 'sfw' ? sfwActions : nsfwActions
        const selected = selectedActions[rating] || ''
        const oppositeOccupied = rating === 'sfw' ? Boolean(current?.nsfw) : Boolean(current?.sfw)
        const moveWouldConflict =
            (selected === 'mark_nsfw' || selected === 'mark_sfw_homepage' || selected === 'mark_sfw_no_homepage') && oppositeOccupied

        if (!variant || sourceWillMove(rating)) {
            const moveMessage = sourceWillMove(rating)
                ? `<p class="text-sm text-warning">${title} will move to ${rating === 'sfw' ? 'NSFW' : 'SFW'} on submit.</p>`
                : '<p class="text-sm text-base-content/60">None</p>'

            return `
                <section class="admin-approval-panel rounded border border-base-300 bg-base-200 p-2">
                    <div class="mb-2 flex shrink-0 items-center justify-between gap-2">
                        <h3 class="text-sm font-bold">${title}</h3>
                        <span class="badge">${rating.toUpperCase()}</span>
                    </div>
                    <div class="admin-approval-media-frame flex items-center justify-center rounded bg-base-300/40 p-3 text-center">
                        ${moveMessage}
                    </div>
                    ${original ? renderActions(rating, actions, selected, moveWouldConflict) : ''}
                </section>
            `
        }

        return `
            <section class="admin-approval-panel rounded border border-base-300 bg-base-200 p-2">
                <div class="mb-2 flex shrink-0 items-center justify-between gap-2">
                    <h3 class="text-sm font-bold">${title}</h3>
                    <span class="badge ${variant.needsReview ? 'badge-warning' : 'badge-success'}">${variant.needsReview ? 'Pending' : escapeHtml(variant.reviewStatus)}</span>
                </div>
                ${moved ? `<div class="alert alert-info mb-2 shrink-0 py-1 text-xs">Moved from ${escapeHtml(moved.movedFrom)} for preview. Submit to save it.</div>` : ''}
                ${moveWouldConflict ? '<div class="alert alert-error mb-2 shrink-0 py-1 text-xs">Move target already has an image.</div>' : ''}
                <a class="admin-approval-media-frame block overflow-hidden rounded bg-base-300" href="${escapeHtml(variant.imageUrl)}" rel="noopener noreferrer" target="_blank">
                    <img alt="${title}" src="${escapeHtml(variant.imageUrl)}">
                </a>
                <dl class="mt-2 grid shrink-0 grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div class="min-w-0"><dt class="font-semibold">Artist</dt><dd class="truncate">${escapeHtml(variant.artist || 'Unknown')}</dd></div>
                    <div><dt class="font-semibold">Size</dt><dd>${escapeHtml(formatBytes(variant.byteSize))}</dd></div>
                    <div><dt class="font-semibold">Dimensions</dt><dd>${escapeHtml(formatDimensions(variant))}</dd></div>
                    <div><dt class="font-semibold">Approved</dt><dd class="truncate">${escapeHtml(formatDate(variant.approvedAt))}</dd></div>
                </dl>
                ${original ? renderActions(rating, actions, selected, moveWouldConflict) : ''}
            </section>
        `
    }

    function renderActions(rating: string, actions: string[][], selected: string, moveWouldConflict: boolean) {
        return `
            <fieldset class="mt-2 grid shrink-0 grid-cols-2 gap-1">
                ${actions
                    .map(
                        ([value, label]) => `
                    <label class="btn btn-xs min-h-7 justify-start px-2 ${selected === value ? 'btn-warning' : 'btn-outline'}">
                        <input class="sr-only" data-action-input="${rating}" name="${rating}Action" type="radio" value="${value}" ${selected === value ? 'checked' : ''}>
                        <span class="truncate">${escapeHtml(label)}</span>
                    </label>
                `,
                    )
                    .join('')}
                ${moveWouldConflict ? '<p class="text-sm text-error">Choose a different action before submitting.</p>' : ''}
            </fieldset>
        `
    }

    function renderCurrent() {
        if (!currentContainer) {
            return
        }

        if (!state.current) {
            currentContainer.innerHTML = `
                <div class="flex h-full items-center justify-center rounded border border-dashed border-base-300 bg-base-200 p-8 text-center">
                    <div>
                        <h2 class="text-2xl font-bold">No images need approval</h2>
                        <p class="mt-2 text-sm text-base-content/70">Pending uploads will appear here.</p>
                    </div>
                </div>
            `
            return
        }

        const item = state.current
        currentContainer.innerHTML = `
            <div class="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
            <div class="flex shrink-0 items-center justify-between gap-3">
                <div class="min-w-0">
                    <h2 class="truncate text-lg font-bold">Image Approvals</h2>
                    <p class="truncate text-xs text-base-content/70">Leased to you until ${escapeHtml(formatDate(state.leaseExpiresAt))}.</p>
                </div>
                <button class="btn btn-sm btn-primary shrink-0" data-submit-approval type="button">Submit</button>
            </div>
            <section class="grid shrink-0 gap-2 rounded border border-base-300 bg-base-200 p-2 text-xs md:grid-cols-4">
                <div class="min-w-0"><p class="font-semibold">Uploader</p><p class="truncate"><a class="admin-approval-link" href="${escapeHtml(item.user.profileUrl)}">@${escapeHtml(item.user.username)}</a></p></div>
                <div class="min-w-0"><p class="font-semibold">Email</p><p class="truncate text-base-content/70">${escapeHtml(item.user.email)}</p></div>
                <div class="min-w-0"><p class="font-semibold">Character</p><p class="truncate"><a class="admin-approval-link" href="${escapeHtml(item.character.url)}">${escapeHtml(item.character.name)}</a></p></div>
                <div class="min-w-0"><p class="font-semibold">Uploaded</p><p class="truncate">${escapeHtml(formatDate(item.createdAt))}</p></div>
            </section>
            <div class="admin-approval-image-grid">
                ${renderVariant('sfw')}
                ${renderVariant('nsfw')}
            </div>
            </div>
        `

        for (const input of currentContainer.querySelectorAll<HTMLInputElement>('[data-action-input]')) {
            input.addEventListener('change', () => {
                selectedActions[input.dataset.actionInput || ''] = input.value
                renderCurrent()
            })
        }

        for (const button of currentContainer.querySelectorAll('[data-submit-approval]')) {
            button.addEventListener('click', submitApproval)
        }
    }

    function validateSelections() {
        if (!state.current) {
            return {ok: false, error: 'No media is selected.'}
        }

        if (state.current.sfw?.needsReview && !selectedActions.sfw) {
            return {ok: false, error: 'Choose an SFW action.'}
        }

        if (state.current.nsfw?.needsReview && !selectedActions.nsfw) {
            return {ok: false, error: 'Choose an NSFW action.'}
        }

        if (selectedActions.sfw === 'mark_nsfw' && state.current.nsfw) {
            return {ok: false, error: 'Cannot move SFW because this row already has an NSFW image.'}
        }

        if ((selectedActions.nsfw === 'mark_sfw_homepage' || selectedActions.nsfw === 'mark_sfw_no_homepage') && state.current.sfw) {
            return {ok: false, error: 'Cannot move NSFW because this row already has an SFW image.'}
        }

        return {ok: true}
    }

    async function submitApproval() {
        const validation = validateSelections()

        if (!validation.ok) {
            window.alert(validation.error)
            return
        }

        const response = await fetch(`/api/admin/image-approvals/${encodeURIComponent(state.current.id)}`, {
            method: 'POST',
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'x-csrf-token': csrfToken,
            },
            body: JSON.stringify({
                sfwAction: selectedActions.sfw,
                nsfwAction: selectedActions.nsfw,
            }),
        })
        const body = await response.json().catch(() => ({}))

        if (!response.ok) {
            window.alert(body.error || 'Approval could not be saved.')
            return
        }

        state = body
        selectedActions = {}
        renderCurrent()
    }

    function selectShortcutAction(rating: 'sfw' | 'nsfw', action: string) {
        if (!state.current?.[rating]) {
            return
        }

        selectedActions[rating] = action
        renderCurrent()
    }

    function getVisibleVariant(rating: 'sfw' | 'nsfw') {
        if (!state.current || sourceWillMove(rating)) {
            return null
        }

        return getMovedVariant(rating) || state.current[rating]
    }

    function openVariantInNewTab(rating: 'sfw' | 'nsfw') {
        const variant = getVisibleVariant(rating)

        if (!variant?.imageUrl) {
            return
        }

        const opened = window.open(variant.imageUrl, '_blank', 'noopener,noreferrer')

        if (opened) {
            opened.opener = null
        }
    }

    function isKeyboardShortcutTarget(target: EventTarget | null) {
        if (!(target instanceof Element)) {
            return true
        }

        return !target.closest('input, textarea, select, button, a, [contenteditable=true]')
    }

    function handleKeyboardShortcuts(event: KeyboardEvent) {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) {
            return
        }

        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key

        if (key === 'Enter') {
            if (event.target instanceof Element && event.target.closest('textarea, select, [contenteditable=true]')) {
                return
            }

            event.preventDefault()
            submitApproval()
            return
        }

        if (!isKeyboardShortcutTarget(event.target)) {
            return
        }

        const actionShortcuts: Record<string, ['sfw' | 'nsfw', string]> = {
            a: ['sfw', 'approve_sfw_homepage'],
            s: ['sfw', 'approve_sfw_no_homepage'],
            d: ['sfw', 'mark_nsfw'],
            f: ['sfw', 'report_sfw'],
            j: ['nsfw', 'approve_nsfw'],
            k: ['nsfw', 'mark_sfw_homepage'],
            l: ['nsfw', 'mark_sfw_no_homepage'],
            ';': ['nsfw', 'report_nsfw'],
        }

        if (key === 'r') {
            event.preventDefault()
            openVariantInNewTab('sfw')
            return
        }

        if (key === 'u') {
            event.preventDefault()
            openVariantInNewTab('nsfw')
            return
        }

        const shortcut = actionShortcuts[key]

        if (!shortcut) {
            return
        }

        event.preventDefault()
        selectShortcutAction(shortcut[0], shortcut[1])
    }

    document.addEventListener('keydown', handleKeyboardShortcuts)
    renderCurrent()
}
