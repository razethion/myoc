# MyOC

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002)](https://hono.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.x-38B2AC?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![License: BUSL-1.1](https://img.shields.io/badge/License-BUSL--1.1-blue)](./LICENSE.md)

MyOC is a high-resolution gallery for original character media. It is built for artists, character owners, and communities that need a clean way to store, organize, and share character artwork without compressing the work into low-quality previews or burying it under unrelated social features.

MyOC focuses on:

- Original-quality character artwork and reference image presentation.
- Simple organization by users, characters, folders, layouts, and variants.
- Clear browsing and search for characters, artists, tags, and media.
- Content preferences that keep users in control of what they see.
- Character ownership and transfer workflows that keep media organization intact.
- A fast edge-hosted application built on Cloudflare Workers.

## Stack

| Area | Technology |
| --- | --- |
| Runtime | Cloudflare Workers |
| Server framework | Hono |
| Views | Hono JSX |
| Language | TypeScript |
| Styling | Tailwind CSS 4, DaisyUI |
| Database | Cloudflare D1 |
| Tooling | Wrangler, npm |

## Getting Started

### Prerequisites

- Node.js 20 or newer.
- npm.
- A Cloudflare account for D1 and deployment.
- Wrangler authentication for Cloudflare operations.

### Install Dependencies

```sh
npm install
```

### Start the Local Worker

```sh
npm run dev
```

This builds the CSS bundle and starts the app with Wrangler.

### Run Checks

```sh
npm run typecheck
npm run build
```

## Configuration

Worker configuration lives in [`wrangler.jsonc`](./wrangler.jsonc).

The app expects a Cloudflare D1 database bound as `DB`. For a new environment, create a D1 database and update `wrangler.jsonc` with the generated database ID:

```sh
npx wrangler d1 create myoc-db
```

Apply migrations locally:

```sh
npx wrangler d1 migrations apply myoc-db --local
```

Apply migrations to Cloudflare:

```sh
npx wrangler d1 migrations apply myoc-db --remote
```

When Worker bindings change, regenerate Cloudflare binding types:

```sh
npm run cf-typegen
```

## Deployment

Deploy to Cloudflare Workers:

```sh
npm run deploy
```

The deploy command builds the CSS bundle first, then runs Wrangler deployment with minification enabled.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build:css` | Compiles `src/styles/app.css` into minified `public/app.css`. |
| `npm run build` | Runs the CSS build. |
| `npm run dev` | Builds CSS, then starts `wrangler dev`. |
| `npm run deploy` | Builds CSS, then deploys the Worker. |
| `npm run cf-typegen` | Generates Cloudflare binding types from `wrangler.jsonc`. |
| `npm run typecheck` | Runs TypeScript without emitting files. |

## Contributing

Contributions are welcome, but they must be made under the project Contributor License Agreement.

By opening a pull request, you agree that:

- You have read and accepted [`CLA.md`](./CLA.md).
- You have the right to submit the contribution.
- Your contribution may be licensed and relicensed by the project under the terms described in the CLA.
- Your contribution does not knowingly include code, assets, or other material that violates a third party's rights.

Before submitting a pull request, run:

```sh
npm run typecheck
npm run build
```

Keep pull requests focused. If a change affects Cloudflare bindings, update `wrangler.jsonc` and run:

```sh
npm run cf-typegen
```

## License

MyOC is licensed under the Business Source License 1.1. See [`LICENSE.md`](./LICENSE.md).

The license permits source access, copying, modification, redistribution, and non-production use, with the additional use grant described in the license file. On the Change Date, the licensed work converts to the Apache License 2.0.

This project is source-available, not open source, until the applicable Change Date.
