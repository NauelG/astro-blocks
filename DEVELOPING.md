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
- Alpha default for public pages is `server + Astro experimental cache`.

## Commands

```bash
npm install
npm run build
npm run typecheck
npm run test
npm run dev:playground
npm run build:playground
npm run pack:local
```

## Build Pipeline

`npm run build` does two things:

1. copies static package files to `dist/`
2. compiles TypeScript sources to `dist/` with declarations

The package root publishes `dist/` only.

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
  - `astro-blocks`
  - `astro-blocks/contract`
  - `astro-blocks/getMenu`
- Do not collapse everything into the root export.
- Keep internal imports relative.
- Do not introduce `@` aliases for internal package code.

## Documentation Rules

- `README.md` is consumer-facing only.
- `DEVELOPING.md` is maintainer-facing.
- `AGENTS.md` is the operational guide for coding agents working in this repo.

## Release Sanity Check

Before publishing or creating a release candidate:

1. `npm run build`
2. `npm run test`
3. `npm run build:playground`
4. `npm run pack:local`
5. install the generated tarball in a clean Astro project
6. verify dev + build there
