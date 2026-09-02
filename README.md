# MyOC

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node.js-24-5fa04e?logo=nodedotjs&logoColor=white&style=for-the-badge)](package.json)
[![License](https://img.shields.io/github/license/razethion/myoc?style=for-the-badge)](LICENSE)
[![Codecov](https://img.shields.io/codecov/c/github/razethion/myoc/master?logo=codecov&logoColor=white&style=for-the-badge)](https://codecov.io/gh/razethion/myoc)

MyOC is a high-resolution original-character gallery built on Cloudflare Workers. It gives character owners a focused
place to create profiles, organize characters into folders, upload character media, preserve full-resolution art, and
share clean profile or character links.

The app is intentionally gallery-first. It is not trying to be a social network, marketplace, custom website builder, or
general lore platform. See the product direction in the in-app `/product-vision` page and the source in
[apps/backend/src/views/pages/ProductVisionPage.tsx](apps/backend/src/views/pages/ProductVisionPage.tsx).

## Highlights

- **High-quality galleries**: uploads keep their original image bytes and format while also generating fast previews.
- **Character management**: users can create characters, folders, profile images, descriptions, gallery tabs, and custom
  gallery layouts.
- **Size charts**: characters can have calibrated height-chart images that are searchable and shareable.
- **Toyhou.se migration**: authenticated users can import character and gallery data from Toyhou.se.
- **Content controls**: SFW/NSFW media variants, blur assets, user display preferences, and image approval workflows are
  part of the product model.
- **Passkey support**: accounts can use WebAuthn passkeys, recovery phrases, and session controls.
- **Cloudflare-native operations**: D1 stores relational data, R2 stores media, KV caches derived views, and scheduled
  Worker jobs handle backup, cleanup, and leaderboard refresh work.

## Stack

- TypeScript, Hono, and `hono/jsx` for the Worker and server-rendered UI.
- Tailwind CSS 4 and daisyUI 5 for styling.
- Cloudflare Workers, D1, R2, KV, Images, and Cron Triggers for runtime infrastructure.
- Vitest with `@cloudflare/vitest-pool-workers` for Worker-aware tests.
- Biome, TypeScript, Knip, and Semgrep for quality checks.

## Getting Started

### Requirements

- Node.js `>=24 <25`
- npm 11
- Wrangler access to the Cloudflare account when running the full Worker locally or deploying

### Install

```sh
git clone https://github.com/razethion/myoc.git
cd myoc
npm ci
cp .dev.vars.example .dev.vars
```

Authenticate Wrangler if you are running the full Worker locally or deploying:

```sh
npx wrangler login
```

Prepare the local D1 database and seed development data:

```sh
npm run db:prepare:local
```

Start the development server:

```sh
npm run dev
```

Wrangler prints the local URL, usually `http://localhost:8787`.

Seeded local accounts:

| Username    | Email                    | Password      |
|-------------|--------------------------|---------------|
| `demo`      | `demo@example.test`      | `password123` |
| `artist`    | `artist@example.test`    | `password123` |
| `collector` | `collector@example.test` | `password123` |

### Try It

Open the local site and sign in with a seeded account:

```text
http://127.0.0.1:5173/login
```

Useful local routes:

- `/` - homepage, search, discovery, and public gallery previews
- `/characters` - signed-in character and folder management
- `/settings` - profile, social links, passkeys, recovery, and sessions
- `/migrate` - Toyhou.se migration flow
- `/search` - user and character search
- `/leaderboard` - leaderboard view
- `/size-chart` - character size-chart comparison
- `/whats-new` - release notes from [apps/backend/src/lib/releases.ts](apps/backend/src/lib/releases.ts)

Example read-only API request:

```sh
curl "http://127.0.0.1:5173/api/search?type=characters&q=raz"
```

## Development

Common commands:

```sh
npm run build
npm run typecheck
npm run lint
npm run test
npm run coverage
npm run deadcode
npm run semgrep
npm run ci
```

## Repository Guide

| Path                                                   | Purpose                                                  |
|--------------------------------------------------------|----------------------------------------------------------|
| [`apps/backend`](./apps/backend)                       | Hono Worker, D1 migrations, assets, and container code. |
| [`apps/web`](./apps/web)                               | SvelteKit entry Worker and migrated pages.              |
| [`packages/contracts`](./packages/contracts)           | Schemas and types shared by both Workers.               |
| [`packages/ui`](./packages/ui)                         | Styles shared by Hono and SvelteKit.                    |
| [`scripts`](./scripts)                                 | Local utility scripts.                                  |
| [`.github`](./.github)                                 | Issue templates and CI and deployment workflows.       |

## Project Documents

- [Contributing](./CONTRIBUTING.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [Support](./SUPPORT.md)
- [Security](./SECURITY.md)
- [Contributor License Agreement](./CLA.md)
- [License](./LICENSE)

## License

MyOC is licensed under [GPL-3.0-only](LICENSE).
