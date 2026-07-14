import type {ImageApprovalHistoryItem} from '../../lib/admin/imageApprovals'

type AdminImageApprovalLogPageProps = {
    history: ImageApprovalHistoryItem[]
}

export function AdminImageApprovalLogPage({history}: AdminImageApprovalLogPageProps) {
    return (
        <div class="p-4 sm:p-6">
            <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                    <h2 class="text-2xl font-bold">Image Approval Log</h2>
                </div>
                <a class="btn btn-sm btn-outline" href="/admin/image-approval-log">
                    Refresh
                </a>
            </div>

            {history.length > 0 ? (
                <div class="overflow-x-auto rounded border border-base-300">
                    <table class="table table-sm">
                        <thead>
                            <tr>
                                <th>Reviewed</th>
                                <th>Image</th>
                                <th>Action</th>
                                <th>Moderator</th>
                                <th>Owner</th>
                                <th>Character</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((item) => (
                                <tr>
                                    <td class="whitespace-nowrap font-mono text-xs">{formatTimestamp(item.createdAt)}</td>
                                    <td>
                                        <span class="badge badge-outline">{item.imageRating.toUpperCase()}</span>
                                    </td>
                                    <td class="whitespace-nowrap">{formatAction(item.action)}</td>
                                    <td class="whitespace-nowrap">@{item.moderatorUsername}</td>
                                    <td class="whitespace-nowrap">@{item.ownerUsername}</td>
                                    <td class="min-w-48">{item.characterName}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : (
                <div class="rounded border border-dashed border-base-300 bg-base-200 p-8 text-center">
                    <h3 class="text-lg font-bold">No image approval events</h3>
                </div>
            )}
        </div>
    )
}

function formatTimestamp(value: string): string {
    return `${value} UTC`
}

function formatAction(value: string): string {
    return value
        .split('_')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}
