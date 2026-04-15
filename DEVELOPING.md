<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Developing AstroBlocks

This guide is for maintaining the package itself.

## Workspace Model

- The package lives at the repository root.
- Consumer validation happens in [`playgrounds/basic`](./playgrounds/basic).
- The package is built to `dist/` with `tsc`.
- Local distribution is validated with `npm pack`.
- Default for public pages is `server + Astro experimental cache`.

## Commands

```bash
npm install
npm run build
npm run features:validate
npm run typecheck
npm run test
npm run dev:playground
npm run build:playground
npm run screenshots:readme
npm run pack:local
```

## Build Pipeline

`npm run build` does three things:

1. validates `meta/features.json`
2. copies static package files to `dist/` (including `meta/features.json`)
3. compiles TypeScript sources to `dist/` with declarations

The package root publishes `dist/` only.

## Website Feature Manifest

- `meta/features.json` is an internal metadata catalog used by the informational website.
- It is copied to `dist/meta/features.json` during build.
- It is intentionally **not** exposed as a public runtime API subpath.
- Keep `id` values stable and update `updatedIn` whenever an existing feature changes.
- For new user-facing capabilities, add a new manifest entry with the current version in both `sinceVersion` and `updatedIn`.

## Playground Workflow

Use the playground to validate the package like a consumer would:

```bash
npm run build
npm run dev:playground
```

Validate at least:

- `/cms`
- `/cms/pages`
- `/cms/menus`
- `/robots.txt`
- `/sitemap-index.xml`
- the public home page rendered dynamically from `data/pages.json`
- editing a page invalidates and refreshes its public path
- editing menus/settings refreshes global page output after invalidation
- `/cms/cache` invalidates all AstroBlocks cache entries when requested

### README Screenshots

You can regenerate and overwrite the two README screenshots (`img/dashboard.jpg` and `img/page_editor.jpg`) with:

```bash
npm run screenshots:readme
```

The command:

1. prepares the playground package
2. starts the playground dev server
3. authenticates in `/cms` with an automated owner session
4. captures `/cms` (dashboard) and `/cms/pages` (page editor modal)
5. saves JPEG files in `img/` replacing the current screenshots

If Playwright Chromium is not installed yet, run once:

```bash
npx playwright install chromium
```

## Astro Cache Notes

- AstroBlocks does not configure `experimental.cache.provider` automatically.
- The consumer project must opt into Astro's experimental cache provider explicitly.
- In development, Astro exposes `context.cache` but performs no real caching, so validate invalidation behavior in a built app.

## Tarball Validation

The most realistic local validation is the packaged artifact:

```bash
npm run build
npm run pack:local
```

Install the generated `.tgz` into a clean Astro project and run both:

```bash
npm run dev
npm run build
```

The step-by-step flow is documented in [LOCAL_PACKAGE_TESTING.md](./LOCAL_PACKAGE_TESTING.md).

## Public API Rules

- Keep runtime imports split by subpath:
  - `@astroblocks/astro-blocks`
  - `@astroblocks/astro-blocks/contract`
  - `@astroblocks/astro-blocks/getMenu`
- Do not collapse everything into the root export.
- Keep internal imports relative.
- Do not introduce `@` aliases for internal package code.

## Documentation Rules

- `README.md` is consumer-facing only.
- `DEVELOPING.md` is maintainer-facing.
- `AGENTS.md` is the operational guide for coding agents working in this repo.

## Release Sanity Check

Before publishing or creating a release candidate:

1. review user-facing scope changes and update `meta/features.json` as needed
2. `npm run features:validate`
3. `npm run build`
4. `npm run test`
5. `npm run build:playground`
6. if the iteration includes UI changes, run `npm run screenshots:readme` to refresh `img/dashboard.jpg` and `img/page_editor.jpg`
7. `npm run pack:local`
8. install the generated tarball in a clean Astro project
9. verify dev + build there

## GitHub Actions Release Flow

### On push to `main`

- Workflow: `.github/workflows/ci-main.yml`
- Purpose: technical validation only (no tags, no npm publish, no GitHub release)
- Steps:
  1. `npm ci`
  2. `npm run features:validate`
  3. `npm run typecheck`
  4. `npm test`

### On push of a version tag (`v*`)

- Workflow: `.github/workflows/release-tag.yml`
- Purpose: validate release metadata, publish npm, and create/update GitHub release
- Required checks before publish:
  - tag format must match `vX.Y.Z` or `vX.Y.Z-alpha.N`
  - `package.json` version must match tag version (without `v`)
  - `CHANGELOG.md` must include entry `## [X.Y.Z...] - YYYY-MM-DD`
  - that entry must include:
    - `### Title`
    - one short non-empty title line below it
- npm publish behavior:
  - publish with `npm publish --tag latest --provenance`
  - ensure dist-tags `latest` and `alpha` both point to the tagged version
- GitHub release behavior:
  - release name: `vX.Y.Z... — <Title extracted from changelog>`
  - release notes: extracted from the changelog entry body (excluding the `### Title` block)
  - prerelease flag enabled when version contains `-alpha.`
  - the release is always marked as `latest` (same policy as npm dist-tags)

### Required secrets and permissions

- Environment secret `NPM_TOKEN` in environment `Production`, with publish rights for `@astroblocks/astro-blocks`
- `publish_npm` runs under environment `Production` to consume that secret and honor environment protection rules
- `release-tag.yml` requires:
  - `contents: write` (create/update release)
  - `id-token: write` (npm provenance)
