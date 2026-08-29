import {serializeJsonForHtmlScript} from '../src/views/scriptJson'

const structuredData = {description: 'Example'}

// ruleid: myoc.views.require-safe-json-in-json-ld-script
const unsafeDirect = <script dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData)}} type="application/ld+json" />

const rawJson = JSON.stringify(structuredData)

// ruleid: myoc.views.require-safe-json-in-json-ld-script
const unsafeIndirect = <script dangerouslySetInnerHTML={{__html: rawJson}} type="application/ld+json" />

// ruleid: myoc.views.require-safe-json-in-json-ld-script
const unsafePaired = <script dangerouslySetInnerHTML={{__html: rawJson}} type="application/ld+json"></script>

// ok: myoc.views.require-safe-json-in-json-ld-script
const safe = <script dangerouslySetInnerHTML={{__html: serializeJsonForHtmlScript(structuredData)}} type="application/ld+json" />

// ok: myoc.views.require-safe-json-in-json-ld-script
const safePaired = (
    <script dangerouslySetInnerHTML={{__html: serializeJsonForHtmlScript(structuredData)}} type="application/ld+json"></script>
)

export {safe, safePaired, unsafeDirect, unsafeIndirect, unsafePaired}
