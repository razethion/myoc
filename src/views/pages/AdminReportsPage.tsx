import type {AdminReportsData, AdminImageReport} from '../../lib/admin/reports'

type AdminReportsPageProps = {
    csrfToken: string
    data: AdminReportsData
}

const reportActions = [
    {action: 'ignore', label: 'Resubmit for Approval', className: 'btn-outline'},
    {action: 'delete-image', label: 'Delete Image', className: 'btn-warning'},
    {action: 'delete-character', label: 'Delete Character', className: 'btn-error'},
    {action: 'ban-user', label: 'Ban User', className: 'btn-error'},
] as const

export function AdminReportsPage({csrfToken, data}: AdminReportsPageProps) {
    return (
        <div class="p-4 sm:p-6">
            <AdminReportsStyles/>
            <div class="mb-6">
                <h2 class="text-2xl font-bold">Reports</h2>
                <p class="mt-1 text-sm text-base-content/70">Oldest reports are shown first.</p>
            </div>

            {data.reports.length > 0 ? (
                <div class="grid gap-4">
                    {data.reports.map((report) => (
                        <ImageReportCard csrfToken={csrfToken} report={report}/>
                    ))}
                </div>
            ) : (
                <div class="rounded border border-dashed border-base-300 bg-base-200 p-8 text-center">
                    <h3 class="text-xl font-bold">No reports</h3>
                    <p class="mt-2 text-sm text-base-content/70">Reported content will appear here.</p>
                </div>
            )}

            <AdminReportsScript/>
        </div>
    )
}

function ImageReportCard({csrfToken, report}: { csrfToken: string; report: AdminImageReport }) {
    const title = `${report.rating.toUpperCase()} image report`
    const reportedBy = report.reportedByUsername
        ? `Reported by @${report.reportedByUsername} in Image Approvals.`
        : 'Reported by an admin in Image Approvals.'
    const displayImageUrl = report.previewImageUrl ?? report.imageUrl

    return (
        <article class="admin-report-card">
            <div class="admin-report-preview">
                <img alt={title} src={displayImageUrl}/>
            </div>

            <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-xl font-bold">{title}</h3>
                            <span class="badge badge-error">Reported</span>
                        </div>
                        <p class="mt-1 text-sm text-base-content/70">{reportedBy}</p>
                    </div>
                    <p class="text-sm text-base-content/60">{report.reportedAt}</p>
                </div>

                <dl class="mt-4 grid gap-2 text-sm md:grid-cols-2">
                    <div>
                        <dt class="font-semibold">User</dt>
                        <dd>@{report.user.username}</dd>
                    </div>
                    <div>
                        <dt class="font-semibold">Character</dt>
                        <dd>{report.character.name}</dd>
                    </div>
                    <div class="md:col-span-2">
                        <dt class="font-semibold">R2 Path</dt>
                        <dd class="break-all font-mono text-xs">{report.objectKey}</dd>
                    </div>
                </dl>

                <div class="mt-4 flex flex-wrap gap-2">
                    <a class="btn btn-sm btn-outline" href={report.character.url}>View Character</a>
                    <a class="btn btn-sm btn-outline" href={report.user.profileUrl}>View User</a>
                </div>

                <div class="mt-5 flex flex-wrap gap-2">
                    {reportActions.map((item) => (
                        <button
                            class={`btn btn-sm ${item.className}`}
                            data-confirm-action={item.action}
                            data-confirm-target={`${report.mediaId}:${report.rating}`}
                            type="button"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>

                {reportActions.map((item) => (
                    <dialog class="modal" data-confirm-dialog={`${report.mediaId}:${report.rating}:${item.action}`}>
                        <div class="modal-box">
                            <h3 class="text-lg font-bold">Confirm {item.label}</h3>
                            <p class="py-4 text-sm text-base-content/70">
                                This action will affect {report.rating.toUpperCase()} media for {report.character.name}.
                            </p>
                            <div class="modal-action">
                                <form method="dialog">
                                    <button class="btn btn-ghost">Cancel</button>
                                </form>
                                <form
                                    action={`/api/admin/reports/images/${encodeURIComponent(report.mediaId)}/${report.rating}/${item.action}`}
                                    method="post">
                                    <input name="csrfToken" type="hidden" value={csrfToken}/>
                                    <button class={`btn ${item.className}`} type="submit">{item.label}</button>
                                </form>
                            </div>
                        </div>
                    </dialog>
                ))}
            </div>
        </article>
    )
}

function AdminReportsStyles() {
    return (
        <style>{`
            .admin-report-card {
                display: flex;
                flex-direction: column;
                gap: 1rem;
                min-width: 0;
                border: 1px solid var(--color-base-300);
                border-radius: var(--radius-box);
                background: var(--color-base-200);
                padding: 1rem;
            }

            @media (min-width: 768px) {
                .admin-report-card {
                    flex-direction: row;
                }
            }

            .admin-report-preview {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 100%;
                min-height: 12rem;
                overflow: hidden;
                border-radius: var(--radius-box);
                background: var(--color-base-300);
            }

            @media (min-width: 768px) {
                .admin-report-preview {
                    width: 16rem;
                    flex: 0 0 16rem;
                }
            }

            .admin-report-preview img {
                display: block;
                max-height: 16rem;
                width: 100%;
                object-fit: contain;
            }
        `}</style>
    )
}

function AdminReportsScript() {
    const script = `
        for (const button of document.querySelectorAll('[data-confirm-action]')) {
            button.addEventListener('click', () => {
                const key = button.dataset.confirmTarget + ':' + button.dataset.confirmAction;
                const dialog = document.querySelector('[data-confirm-dialog="' + CSS.escape(key) + '"]');
                if (dialog && typeof dialog.showModal === 'function') {
                    dialog.showModal();
                }
            });
        }
    `

    return (
        <script dangerouslySetInnerHTML={{__html: script}}></script>
    )
}
