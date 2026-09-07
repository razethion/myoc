import {SearchPageDataSchema} from '@myoc/contracts/search'
import {error} from '@sveltejs/kit'
import type {PageServerLoad} from './$types'

export const load: PageServerLoad = async ({platform, request, url}) => {
    const backend = platform?.env.HONO

    if (!backend) {
        error(503, 'The application backend is unavailable.')
    }

    const backendUrl = new URL('/api/search/page', url)
    backendUrl.search = url.search
    const headers = new Headers(request.headers)
    headers.set('accept', 'application/json')
    const response = await backend.fetch(backendUrl.toString(), {headers})

    if (!response.ok) {
        error(response.status, 'Could not load the search page.')
    }

    const parsed = SearchPageDataSchema.safeParse(await response.json())

    if (!parsed.success) {
        console.error('The Hono Worker returned invalid search page data.', {issues: parsed.error.issues})
        error(502, 'The search service returned an invalid response.')
    }

    return parsed.data
}
