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

| Area             | Technology                    |
|------------------|-------------------------------|
| Runtime          | Cloudflare Workers            |
| Server framework | Hono                          |
| Views            | Hono JSX                      |
| Language         | TypeScript                    |
| Styling          | Tailwind CSS 4, DaisyUI       |
| Database         | Cloudflare D1                 |
| Testing          | Vitest                        |
| Tooling          | Wrangler, npm, GitHub Actions |

## Getting Started

### Prerequisites

- Node.js 22 or newer.
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
npm run check
npm run build
```

`npm run check` runs TypeScript typechecking and the Vitest test suite once. Use `npm run test` while actively working on tests; it starts Vitest in watch mode.

## Configuration

Worker configuration lives in [`wrangler.jsonc`](./wrangler.jsonc).

The app expects a Cloudflare D1 database bound as `DB`. For a new environment, create a D1 database and update `wrangler.jsonc` with the generated database ID:

```sh
npx wrangler d1 create myoc-db
```

Apply migrations locally:

```sh
npm run db:migrate:local
```

Apply fake development seed data locally:

```sh
npm run db:seed:local
```

Prepare a local database from migrations and seed data:

```sh
npm run db:prepare:local
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

Checks, pull request previews, and production deployment are handled by GitHub Actions in [`.github/workflows/checks.yml`](./.github/workflows/checks.yml). The workflow installs dependencies, runs checks, builds the CSS bundle, and only then calls Cloudflare.

The workflow behavior is:

- Pull requests run typechecking, Vitest, and the CSS build.
- Same-repository pull requests create or reuse a per-PR D1 database named `myoc-pr-<number>`.
- Pull request preview databases receive migrations and fake seed data from [`seeds/development.sql`](./seeds/development.sql).
- Same-repository pull requests upload a Cloudflare preview version bound to that per-PR D1 database after checks pass.
- Successful same-repository pull request previews get a bot comment with the live Cloudflare preview URL.
- Closing a same-repository pull request deletes its `myoc-pr-<number>` D1 database.
- Fork pull requests run checks only because Cloudflare secrets are not exposed to forked code.
- Pushes to `master`, including merged pull requests, run checks, build, apply production D1 migrations, and then deploy with `wrangler deploy --minify`.

The repository must define these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Manual deployment is still available when needed:

```sh
npm run deploy
```

The local deploy command runs checks, builds the CSS bundle, then runs Wrangler deployment with minification enabled.

## Scripts

| Command              | Description                                                   |
|----------------------|---------------------------------------------------------------|
| `npm run build`      | Compiles `src/styles/app.css` into minified `public/app.css`. |
| `npm run dev`        | Builds CSS, then starts `wrangler dev`.                       |
| `npm run typecheck`  | Runs TypeScript without emitting files.                       |
| `npm run test`       | Runs Vitest in watch mode.                                    |
| `npm run check`      | Runs TypeScript typechecking and the Vitest test suite once.  |
| `npm run db:migrate:local` | Applies D1 migrations to the local database.             |
| `npm run db:seed:local` | Applies fake development seed data to the local database.     |
| `npm run db:prepare:local` | Applies local migrations and fake seed data.             |
| `npm run deploy`     | Runs checks, builds CSS, then deploys the Worker.             |
| `npm run cf-typegen` | Generates Cloudflare binding types from `wrangler.jsonc`.     |

## Contributing
Contributions are welcome, but they must be made under the project Contributor License Agreement.

By opening a pull request, you agree that:

- You have read and accepted [`CLA.md`](./CLA.md).
- You have the right to submit the contribution.
- Your contribution may be licensed and relicensed by the project under the terms described in the CLA.
- Your contribution does not knowingly include code, assets, or other material that violates a third party's rights.

Before submitting a pull request, run:

```sh
npm run check
npm run build
```

GitHub Actions runs the same checks automatically on pull requests and pushes to `master`. Cloudflare preview uploads and production deployments only happen after those checks and the build pass.

Keep pull requests focused. If a change affects Cloudflare bindings, update `wrangler.jsonc` and run:

```sh
npm run cf-typegen
```

## License

MyOC is licensed under the Business Source License 1.1. See [`LICENSE.md`](./LICENSE.md).

The license permits source access, copying, modification, redistribution, and non-production use, with the additional use grant described in the license file. On the Change Date, the licensed work converts to the Apache License 2.0.

This project is source-available, not open source, until the applicable Change Date.
