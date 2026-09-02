<script lang="ts">
import Navbar from '$lib/components/Navbar.svelte'
import SearchPage from '$lib/components/SearchPage.svelte'
import type {PageData} from './$types'

let {data}: {data: PageData} = $props()
</script>

<svelte:head>
    <title>{data.results.query ? `Search: ${data.results.query} | MyOC` : 'Search | MyOC'}</title>
</svelte:head>

<Navbar shell={data.shell} />
<SearchPage results={data.results} />
