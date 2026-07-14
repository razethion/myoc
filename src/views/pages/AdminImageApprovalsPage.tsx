import type {ImageApprovalData} from '../../lib/admin/imageApprovals'
import {adminImageApprovalsScript} from './adminImageApprovalsScript'

type AdminImageApprovalsPageProps = {
    csrfToken: string
    data: ImageApprovalData
}

export function AdminImageApprovalsPage({csrfToken, data}: AdminImageApprovalsPageProps) {
    const initialState = safeJson(data)

    return (
        <div class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-csrf-token={csrfToken} data-image-approvals>
            <AdminImageApprovalsStyles />
            <div data-image-approval-state={initialState} hidden id="image-approval-data"></div>
            <div class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-base-300 px-2 py-1 text-xs sm:px-3">
                <ShortcutHint keys={['A', 'S', 'D', 'F']} label="SFW" />
                <ShortcutHint keys={['J', 'K', 'L', ';']} label="NSFW" />
                <ShortcutHint keys={['R', 'U']} label="Open" />
                <ShortcutHint keys={['Enter']} label="Submit" />
            </div>
            <div class="min-h-0 min-w-0 flex-1 overflow-hidden p-2" data-approval-current></div>
            <script dangerouslySetInnerHTML={{__html: adminImageApprovalsScript}}></script>
        </div>
    )
}

function ShortcutHint({keys, label}: {keys: string[]; label: string}) {
    return (
        <div class="flex items-center gap-1.5">
            <span class="whitespace-nowrap font-medium">{label}</span>
            <span class="flex items-center gap-1">
                {keys.map((key) => (
                    <kbd class="kbd kbd-xs">{key}</kbd>
                ))}
            </span>
        </div>
    )
}

function AdminImageApprovalsStyles() {
    return (
        <style>{`
            .admin-approval-image-grid {
                display: grid;
                grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                gap: 0.5rem;
                height: 100%;
                min-height: 0;
                min-width: 0;
                flex: 1 1 auto;
            }

            @media (max-width: 639px) {
                .admin-approval-image-grid {
                    gap: 0.375rem;
                }
            }

            .admin-approval-panel {
                display: flex;
                flex-direction: column;
                min-height: 0;
                min-width: 0;
                overflow: hidden;
            }

            .admin-approval-media-frame {
                flex: 1 1 auto;
                min-height: 0;
                min-width: 0;
            }

            .admin-approval-panel img {
                display: block;
                height: 100%;
                max-width: 100%;
                width: 100%;
                object-fit: contain;
            }

            .admin-approval-link {
                display: inline-block;
                border-radius: 0.25rem;
                background: color-mix(in oklab, var(--color-warning) 22%, transparent);
                color: var(--color-base-content);
                font-weight: 700;
                text-decoration: underline;
                text-decoration-color: var(--color-warning);
                text-decoration-thickness: 2px;
                text-underline-offset: 3px;
            }

            .admin-approval-link:hover {
                background: color-mix(in oklab, var(--color-warning) 34%, transparent);
            }
        `}</style>
    )
}

function safeJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}
