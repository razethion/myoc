import {raw} from 'hono/html'
import {serializeJsonForHtmlScript} from '../scriptJson'

export function JsonLdScript({value}: {value: unknown}) {
    const serializedValue = serializeJsonForHtmlScript(value)

    return <script type="application/ld+json">{raw(serializedValue)}</script>
}
