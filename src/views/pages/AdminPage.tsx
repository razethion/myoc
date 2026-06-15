import type {CurrentUser} from '../../lib/auth/session'
import {Navbar} from '../components/Navbar'
import {BaseLayout} from '../layouts/BaseLayout'

type AdminPageProps = {
    currentUser: CurrentUser
    mediaBaseUrl: string
}

export function AdminPage({currentUser, mediaBaseUrl}: AdminPageProps) {
    return (
        <BaseLayout title="Admin | MyOC">
            <Navbar currentUser={currentUser} mediaBaseUrl={mediaBaseUrl}/>
            <main class="min-h-[calc(100vh-4rem)]"></main>
        </BaseLayout>
    )
}
