<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Developing AstroBlocks

This guide is for maintaining the package itself.

## Workspace Model

- The package lives at the repository root.
- Consumer validation happens in [`playgrounds/basic`](../playgrounds/basic).
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

1. validates `src/meta/features.json`
2. copies static package files to `dist/` (including `src/meta/features.json`)
3. compiles TypeScript sources to `dist/` with declarations

The package root publishes `dist/` only.

## Website Feature Manifest

- `src/meta/features.json` is an internal metadata catalog used by the informational website.
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
- `/cms/media` (upload an image, pick it from an `image` block field, replace it, delete it — see [docs/media.md](./media.md) for the full feature reference)
- `/robots.txt`
- `/sitemap-index.xml`
- the public home page rendered dynamically from `data/pages.json`
- editing a page invalidates and refreshes its public path
- editing menus/settings refreshes global page output after invalidation
- `/cms/cache` invalidates all AstroBlocks cache entries when requested

### Playground Admin Credentials

The playground seeds a single admin user in [`playgrounds/basic/data/users.json`](../playgrounds/basic/data/users.json). Use these to log in at `/cms`:

| Field | Value |
| --- | --- |
| Email | `admin@test.com` |
| Password | `admin1234` |

The stored `passwordHash` is a `scrypt` digest (`base64(salt):base64(hash)`, keylen 64 — see `hashPassword` in `src/api/handlers.ts`); the plaintext password is not recoverable from it. This is throwaway dev data, not a real secret, and is regenerated whenever you reset the playground. To rotate it, hash a new password with the same function:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16);c.scrypt(process.argv[1],s,64,(e,h)=>console.log(s.toString('base64')+':'+h.toString('base64')))" 'yourNewPassword'
```

Then paste the output into `passwordHash` in `playgrounds/basic/data/users.json`.

### README Screenshots

The two README screenshots (`img/dashboard.jpg` and `img/page_editor.jpg`) are regenerated
**automatically** by the `version` npm lifecycle hook on every release. You do not need to run
this manually before a release.

For ad-hoc refreshes (e.g. after a significant UI change mid-iteration), run:

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

### Media Screenshots

The two media-feature screenshots (`img/media-library.png` and `img/image-picker.png`) are
regenerated **automatically** by the `version` npm lifecycle hook on every release. You do not
need to run this manually before a release.

For ad-hoc refreshes (e.g. after a significant media-UI change mid-iteration), run:

```bash
npm run screenshots:media
```

The command does everything end-to-end in a single pass:

1. generates 6 abstract gradient placeholder images via sharp (no real or brand content)
2. resets the playground media state to a clean slate (empties the uploads directory and blanks `media.json`)
3. prepares the playground package and starts the dev server
4. authenticates as owner and uploads all 6 placeholders
5. polls until every upload has status `ready` (variants fully processed)
6. captures `/cms/media` (full viewport) and the image-field picker modal (cropped to the panel)
7. saves PNG files in `img/` replacing the current screenshots

If Playwright Chromium is not installed yet, run once:

```bash
npx playwright install chromium
```

## Astro Cache Notes

- AstroBlocks does not configure `cache.provider` automatically.
- The consumer project must configure Astro's route cache provider explicitly. Route caching graduated out of `experimental` in Astro 7 — the config is top-level `cache`, not `experimental.cache` (ADR-0029).
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

## Cutting a Release

### Prerequisites

- Playwright Chromium must be installed (`npx playwright install chromium`) — the `version`
  lifecycle hook runs both screenshot scripts, which require it.
- The working tree must be **clean** before running `npm version`. npm enforces this and will
  abort with an error if there are uncommitted changes or staged files.

### Steps

1. **Update `src/meta/features.json`** if this release adds or changes user-facing capabilities.
   Run `npm run features:validate` to confirm it is valid.

2. **Add the CHANGELOG entry** — open `CHANGELOG.md` and prepend a new block at the top:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Title

   Short, descriptive release title here

   ### Added

   - New feature description.
   ```

   Follow the changelog contract exactly (see `.claude/skills/npm-release/SKILL.md`):
   brackets around the version, ` - ` separator, mandatory `### Title` sub-heading with
   non-empty content.

3. **Commit the CHANGELOG** — npm version requires a clean tree, so commit first:

   ```bash
   git add CHANGELOG.md
   git commit -m "chore(changelog): add X.Y.Z entry"
   ```

4. **Run `npm version`** — this single command does everything else:

   ```bash
   npm version <major|minor|patch|X.Y.Z> -m "chore(release): %s"
   ```

   npm will, in order:
   1. Run `preversion` — executes `npm test` (build + unit tests). Aborts on failure.
   2. Bump `package.json#version`.
   3. Run `version` — regenerates both screenshot sets (`screenshots:readme` and
      `screenshots:media`) and stages `img/` via `git add img/`.
   4. Create the release commit (contains `package.json` + `img/`) with the message you
      passed via `-m` (the `%s` is replaced with the new version, e.g. `chore(release): 3.1.0`).
   5. Create the `vX.Y.Z` tag pointing at that commit.

   **Do NOT create the tag manually after this — npm already created it.**

5. **Push branch and tag together**:

   ```bash
   git push --follow-tags
   ```

   This triggers `release-tag.yml`, which validates the tag, runs tests, publishes to npm
   with provenance, and creates the GitHub Release.

6. **Verify** after the workflow completes:

   ```bash
   npm view @astroblocks/astro-blocks dist-tags
   ```

   Confirm `latest` (and `alpha` for pre-releases) points to the new version.

### Notes

- The `preversion` hook runs `npm test`, which itself runs `npm run build` first. A failing
  test or type error blocks the release before anything is committed.
- The screenshot scripts start the playground dev server and run Playwright — this takes
  roughly 1-2 minutes. The version hook is intentionally slow because correctness matters more
  than speed at release time.
- For alpha releases use `npm version X.Y.Z-alpha.N -m "chore(release): %s"` — the tag format
  `vX.Y.Z-alpha.N` is what the workflow recognises as a pre-release.
- If the `version` hook fails mid-run (e.g. Playwright crash), npm will NOT have created the
  commit or tag. Fix the issue, reset any partial `git add` if needed, and re-run `npm version`.

## Release Sanity Check

Before running `npm version`, confirm:

1. `src/meta/features.json` is up to date — `npm run features:validate`
2. Tests pass — `npm run test`
3. Playground builds cleanly — `npm run build:playground`
4. `npm run pack:local` produces a valid tarball (install into a clean Astro project to confirm)
5. CHANGELOG entry is committed and follows the exact parser contract
6. Working tree is clean (no uncommitted changes)

Screenshots are no longer a manual checklist item — the `version` hook regenerates them
automatically as part of step 4 in the release flow above.

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
