# Contributing to MyOC

MyOC accepts focused contributions that improve the character-gallery product, fix defects, strengthen reliability, or
make the project easier to operate.

By opening a pull request, you agree to the [Contributor License Agreement](./CLA.md) and confirm that you have the
right to submit the work.

## Good Contributions

- Fix a reproducible bug.
- Improve character, folder, gallery, media, search, migration, admin, or profile workflows.
- Add tests around behavior that can regress.
- Improve accessibility, reliability, security, or performance.
- Clarify documentation that caused real setup or usage confusion.

Feature ideas should describe the user problem first. MyOC is intentionally not a social network, marketplace, custom
website builder, or general lore platform.

## Local Setup

Use Node.js 24 and npm 11, matching [`package.json`](./package.json).

```sh
npm ci
cp .dev.vars.example .dev.vars
npx wrangler login
npm run db:prepare:local
npm run dev
```

Wrangler prints the public local URL, `http://127.0.0.1:5173`. It runs SvelteKit as the entry Worker and connects Hono through a service binding.
Seeded accounts use `password123` as the password.

## Checks

Before opening a pull request, run:

```sh
npm run ci
npm run build
```

Use `npm run test` while actively working on tests, and `npm run coverage` when you need a local coverage report.

If you change Cloudflare bindings in either Worker configuration under [`apps`](./apps), run the typecheck command so Wrangler
regenerates Worker types before TypeScript runs:

```sh
npm run typecheck
```

Generated files such as `worker-configuration.d.ts`, `apps/backend/public/app.css`, `apps/backend/public/vendor`, and
`apps/web/.svelte-kit` are local build artifacts and should not be committed unless the project intentionally changes that policy.

## Code Guidelines

- Keep request validation close to the route or helper that consumes the data.
- Use D1 prepared statements with bound parameters instead of interpolating user input into SQL.
- Keep Hono page markup in `apps/backend/src/views` and route orchestration in `apps/backend/src/routes` when practical.
- Keep migrated SvelteKit pages in `apps/web/src/routes` and reusable Svelte components in `apps/web/src/lib`.
- Keep reusable business logic in `apps/backend/src/lib` instead of duplicating it in route handlers.
- Keep shared Worker schemas and types in `packages/contracts`.
- Do not add secrets, production data, real user media, or private credentials to the repository.
- Avoid broad refactors in the same pull request as behavior changes.

## Database and Media

Add new numbered migrations in [`apps/backend/migrations`](./apps/backend/migrations). Do not edit migrations that may already be applied.

Update [`apps/backend/seeds/development.sql`](./apps/backend/seeds/development.sql) when schema or workflow changes would otherwise break local
setup.

Media objects are stored in R2. Be careful with changes that affect object-key shape, previews, NSFW blur objects,
height-chart images, or cleanup behavior.

## Pull Requests

A good pull request should:

- Explain the problem and solution.
- Include screenshots or short recordings for visible UI changes.
- Include tests for behavior changes when practical.
- Update documentation when setup, commands, policy, or behavior changes.
- Pass `npm run ci` and `npm run build`.

Do not report security vulnerabilities in public issues. Follow [SECURITY.md](./SECURITY.md).
