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

Wrangler prints the local URL, usually `http://localhost:8787`. Seeded accounts use `password123` as the password.

## Checks

Before opening a pull request, run:

```sh
npm run ci
npm run build
```

Use `npm run test` while actively working on tests, and `npm run coverage` when you need a local coverage report.

If you change Cloudflare bindings in [`wrangler.jsonc`](./wrangler.jsonc), run the typecheck command so Wrangler
regenerates Worker types before TypeScript runs:

```sh
npm run typecheck
```

Generated files such as `worker-configuration.d.ts`, `public/app.css`, and `public/vendor` are local build artifacts and
should not be committed unless the project intentionally changes that policy.

## Code Guidelines

- Keep request validation close to the route or helper that consumes the data.
- Use D1 prepared statements with bound parameters instead of interpolating user input into SQL.
- Keep page markup in `src/views` and route orchestration in `src/routes` when practical.
- Keep reusable business logic in `src/lib` instead of duplicating it in route handlers.
- Do not add secrets, production data, real user media, or private credentials to the repository.
- Avoid broad refactors in the same pull request as behavior changes.

## Database and Media

Add new numbered migrations in [`migrations`](./migrations). Do not edit migrations that may already be applied.

Update [`seeds/development.sql`](./seeds/development.sql) when schema or workflow changes would otherwise break local
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
