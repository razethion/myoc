import type {Child} from 'hono/jsx'
import {type CurrentUser, isAdminUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

export type AdminSection =
    | 'image-approvals'
    | 'image-approval-log'
    | 'moderate-images'
    | 'moderate-characters'
    | 'moderate-users'
    | 'reports'
    | 'admin-options'

type AdminPageProps = {
    activeSection: AdminSection
    children?: Child
    currentUser: CurrentUser
    imageApprovalPendingCount?: number
    mediaBaseUrl: string
}

const adminNavItems: Array<{label: string; section: AdminSection}> = [
    {label: 'Image Approvals', section: 'image-approvals'},
    {label: 'Image Approval Log', section: 'image-approval-log'},
    {label: 'Moderate Images', section: 'moderate-images'},
    {label: 'Moderate Characters', section: 'moderate-characters'},
    {label: 'Moderate Users', section: 'moderate-users'},
    {label: 'Reports', section: 'reports'},
    {label: 'Admin Options', section: 'admin-options'},
]

export function isAdminSection(section: string): section is AdminSection {
    return adminNavItems.some((item) => item.section === section)
}

export function AdminPage({activeSection, children, currentUser, imageApprovalPendingCount = 0, mediaBaseUrl}: AdminPageProps) {
    const visibleNavItems = isAdminUser(currentUser) ? adminNavItems : adminNavItems.filter((item) => item.section === 'image-approvals')
    const fallbackItem = visibleNavItems[0]
    if (!fallbackItem) {
        throw new Error('Admin navigation is empty.')
    }

    const activeItem = visibleNavItems.find((item) => item.section === activeSection) ?? fallbackItem

    return (
        <BaseLayout title={`${activeItem.label} | Admin | MyOC`}>
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl} />
            <main
                class={
                    activeSection === 'image-approvals'
                        ? 'grid h-[calc(100vh-4rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-base-100 lg:grid-cols-[17rem_1fr] lg:grid-rows-none'
                        : 'grid min-h-[calc(100vh-4rem)] bg-base-100 lg:grid-cols-[17rem_1fr]'
                }
            >
                <aside class="border-b border-base-300 bg-base-200/70 lg:border-b-0 lg:border-r">
                    <nav aria-label="Admin sections" class="p-3">
                        <ul class="menu gap-1 p-0">
                            {visibleNavItems.map((item) => {
                                const isActive = item.section === activeSection

                                return (
                                    <li>
                                        <a
                                            aria-current={isActive ? 'page' : undefined}
                                            class={isActive ? 'active font-semibold' : ''}
                                            href={`/admin/${item.section}`}
                                        >
                                            <span class="flex w-full items-center justify-between gap-2">
                                                <span>{item.label}</span>
                                                {item.section === 'image-approvals' && imageApprovalPendingCount > 0 ? (
                                                    <span class="badge badge-sm">{imageApprovalPendingCount}</span>
                                                ) : null}
                                            </span>
                                        </a>
                                    </li>
                                )
                            })}
                        </ul>
                    </nav>
                </aside>

                <section
                    aria-label={`${activeItem.label} content`}
                    class={activeSection === 'image-approvals' ? 'min-h-0 min-w-0 overflow-hidden' : 'min-w-0'}
                >
                    {children}
                </section>
            </main>
        </BaseLayout>
    )
}
