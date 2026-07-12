import type {ImageApprovalData} from '../../lib/admin/imageApprovals'
import {adminImageApprovalsScript} from './adminImageApprovalsScript'

type AdminImageApprovalsPageProps = {
    csrfToken: string
    data: ImageApprovalData
}

export function AdminImageApprovalsPage({csrfToken, data}: AdminImageApprovalsPageProps) {
    const initialState = safeJson(data)

    return (
        <div class="min-h-[calc(100vh-4rem)]" data-csrf-token={csrfToken} data-image-approvals>
            <AdminImageApprovalsStyles />
            <div data-image-approval-state={initialState} hidden id="image-approval-data"></div>
            <div class="grid min-h-[calc(100vh-4rem)] xl:grid-cols-[1fr_22rem]">
                <div class="min-w-0 p-4 sm:p-6" data-approval-current></div>
                <aside class="border-t border-base-300 bg-base-200/60 xl:border-l xl:border-t-0">
                    <div class="grid gap-5 p-4" data-approval-sidebar></div>
                </aside>
            </div>
            <script dangerouslySetInnerHTML={{__html: adminImageApprovalsScript}}></script>
        </div>
    )
}

function AdminImageApprovalsStyles() {
    return (
        <style>{`
            .admin-approval-image-grid {
                display: grid;
                grid-template-columns: 1fr;
                gap: 1rem;
                min-width: 0;
            }

            @media (min-width: 768px) {
                .admin-approval-image-grid {
                    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
                }
            }

            .admin-approval-panel {
                min-width: 0;
            }

            .admin-approval-panel img {
                display: block;
                max-width: 100%;
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

            .admin-approval-sidebar-card {
                display: block;
                width: 100%;
                min-width: 0;
                border: 1px solid var(--color-base-300);
                border-radius: var(--radius-box);
                background: var(--color-base-100);
                text-align: left;
                box-shadow: 0 1px 2px rgb(0 0 0 / 0.18);
                transition: border-color 150ms ease, background-color 150ms ease;
            }

            .admin-approval-sidebar-card:hover,
            .admin-approval-sidebar-card.is-active {
                border-color: var(--color-primary);
            }

            .admin-approval-sidebar-card.is-active {
                background: color-mix(in oklab, var(--color-primary) 10%, var(--color-base-100));
            }
        `}</style>
    )
}

function safeJson(value: unknown): string {
    return JSON.stringify(value).replace(/</g, '\\u003c')
}
