import {raw} from 'hono/html'
import type {Child} from 'hono/jsx'

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
                    <link href="/assets/razfalling.png" rel="icon" type="image/png" />
                    <link href="/app.css" rel="stylesheet" />
                    {head}
                </head>
                <body class="min-h-screen overflow-x-hidden bg-base-100 text-base-content">{children}</body>
            </html>
        </>
    )
}
