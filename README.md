# MyOC

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/typescript-6.0-3178c6?logo=typescript&logoColor=white&style=for-the-badge)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node.js-24-5fa04e?logo=nodedotjs&logoColor=white&style=for-the-badge)](package.json)
[![License](https://img.shields.io/github/license/razethion/myoc?style=for-the-badge)](LICENSE)

MyOC is a high-resolution original-character gallery built on Cloudflare Workers. It gives character owners a focused
place to create profiles, organize characters into folders, upload character media, preserve full-resolution art, and
share clean profile or character links.

The app is intentionally gallery-first. It is not trying to be a social network, marketplace, custom website builder, or
general lore platform. See the product direction in the in-app `/product-vision` page and the source in
[src/views/pages/ProductVisionPage.tsx](src/views/pages/ProductVisionPage.tsx).

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

| Username | Email | Password |
| --- | --- | --- |
| `demo` | `demo@example.test` | `password123` |
| `artist` | `artist@example.test` | `password123` |
| `collector` | `collector@example.test` | `password123` |

### Try It

Open the local site and sign in with a seeded account:

```text
http://localhost:8787/login
```

Useful local routes:

- `/` - homepage, search, discovery, and public gallery previews
- `/characters` - signed-in character and folder management
- `/settings` - profile, social links, passkeys, recovery, and sessions
- `/migrate` - Toyhou.se migration flow
- `/search` - user and character search
- `/leaderboard` - leaderboard view
- `/size-chart` - character size-chart comparison
- `/whats-new` - release notes from [src/lib/releases.ts](src/lib/releases.ts)

Example read-only API request:

```sh
curl "http://localhost:8787/api/search?type=characters&q=raz"
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

Project layout:

| Path | Purpose |
| --- | --- |
| [src/index.ts](src/index.ts) | Worker entry point, route mounting, and scheduled job dispatch |
| [src/routes](src/routes) | Page routes, API routes, and form-action handlers |
| [src/views](src/views) | Server-rendered JSX pages, layouts, and components |
| [src/lib](src/lib) | Auth, media, search, leaderboard, admin, database backup, and HTTP helpers |
| [src/test](src/test) | Worker binding mocks and test utilities |
| [migrations](migrations) | Numbered D1 schema migrations |
| [seeds/development.sql](seeds/development.sql) | Local and preview seed data |
| [public](public) | Static assets copied or served by the Worker |
| [vendor](vendor) | Checked-in vendor extensions copied during `npm run build` |
| [scripts](scripts) | Build, security, and environment maintenance scripts |

Database changes should be added as new numbered files in [migrations](migrations). Do not edit migrations that may
already be applied. Update [seeds/development.sql](seeds/development.sql) when schema changes would break local setup.

## Deployment

Production and pull-request preview deployments run through
[.github/workflows/checks.yml](.github/workflows/checks.yml).

Manual deployment uses the same quality gate:

```sh
npm run deploy
```

The Worker configuration lives in [wrangler.jsonc](wrangler.jsonc). Required production secrets are declared there; keep
real credentials out of the repository and in Wrangler or `.dev.vars`.

## Help

- Read [SUPPORT.md](SUPPORT.md) before opening support issues.
- Report vulnerabilities through [SECURITY.md](SECURITY.md), not public issues.
- Review project expectations in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- Check local setup and contribution notes in [CONTRIBUTING.md](CONTRIBUTING.md).

## Maintainers and Contributors

MyOC is maintained by [@razethion](https://github.com/razethion).

Contributions are welcome when they improve the focused character-gallery product. Before opening a pull request, read
[CONTRIBUTING.md](CONTRIBUTING.md) and [CLA.md](CLA.md). By contributing, you agree to the contributor license agreement
and confirm that you have the right to submit the work.

## License

MyOC is licensed under [GPL-3.0-only](LICENSE).
