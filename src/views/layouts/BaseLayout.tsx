import {raw} from 'hono/html'
import type {Child} from 'hono/jsx'

const FAVICON_DATA_URL =
    'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2064%2064%22%3E%3Crect%20width%3D%2264%22%20height%3D%2264%22%20rx%3D%2210%22%20fill%3D%22%23050505%22%2F%3E%3Cg%20fill%3D%22%23fff%22%20font-family%3D%22Nohemi%2CArial%2Csans-serif%22%20font-size%3D%2225%22%20font-weight%3D%22800%22%20text-anchor%3D%22middle%22%3E%3Ctext%20x%3D%2232%22%20y%3D%2228%22%3EMY%3C%2Ftext%3E%3Ctext%20x%3D%2232%22%20y%3D%2251%22%3EOC%3C%2Ftext%3E%3C%2Fg%3E%3C%2Fsvg%3E'

type BaseLayoutProps = {
    title: string
    head?: Child
    children: Child
}

export function BaseLayout({title, head, children}: BaseLayoutProps) {
    return (
        <>
            {raw('<!DOCTYPE html>')}
            <html data-theme="black" lang="en">
                <head>
                    <meta charset="UTF-8" />
                    <meta content="width=device-width, initial-scale=1" name="viewport" />
                    <title>{title}</title>
                    <link href={FAVICON_DATA_URL} rel="icon" type="image/svg+xml" />
                    <link href="/app.css" rel="stylesheet" />
                    {head}
                </head>
                <body class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">{children}</body>
            </html>
        </>
    )
}
