<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Reorganize the repo around `src/` as the publish root

Delivered as **one atomic commit**. The working tree is intentionally broken between T3 and T7 —
that is why the order is strict and why the only meaningful gate is T10 onwards. Do not commit
mid-way.

> **Note on TDD.** This change adds no behaviour, so there is no failing test to write. The
> equivalent discipline is T1: capture the `dist/` fingerprint *first*. Any deviation from it at T10
> is the "red". The existing 90-test suite is the regression net.

---

## T0 — Sweep the artifacts that have no home

- **Do:** delete `data/` (untracked leak; `.gitignore:35-39` forbids a package-root `data/`) and
  `img/.DS_Store` (today copied into `dist/img/` and shipped to npm).
- **Files:** `data/media.json`, `img/.DS_Store`
- **Verify:** neither path exists; `git status` is unchanged (both were untracked).
- **Why first:** the baseline in T1 must not contain `.DS_Store`, or T10 reports a false failure.

- [x] done

## T1 — Capture the `dist/` baseline (the "red")

- **Do:** `npm run build`, then hash every file under `dist/` into a manifest kept **outside** the
  repo (scratchpad), e.g. `find dist -type f | sort` + per-file SHA-256.
- **Verify:** the manifest exists and is non-empty.
- **Critical:** run this *after* T0. This artifact is the proof for T10.

- [x] done

## T2 — Rewrite `tsconfig.json` (highest-risk task; do it BEFORE the move)

- **Do:** `rootDir: "." → "src"`; `include: [6 hand-listed dirs] → ["src/**/*.ts"]`. `exclude`
  unchanged.
- **Files:** `tsconfig.json`
- **Verify:** deferred to T10 (the tree does not exist yet). Re-read the diff: if `rootDir` is not
  `"src"`, tsc emits `dist/src/plugin/…` and breaks every export, the `bin`, `plugin/index.ts:21`'s
  `cmsDir` and `plugin/cli/init-ai.ts:63,137`'s `../../..` walk — all at once.

- [x] done

## T3 — Move the publishable tree into `src/`

- **Do:** `git mv` each of `api components contract img meta plugin routes styles types utils` into
  `src/`. Verbatim — no renames inside, no file content edits.
- **Verify:** `git status --short` shows only `R` (rename) entries for these paths; `git diff -M --stat`
  reports 100% similarity. No `A`/`D` pairs.

- [x] done

## T4 — Move the internal docs into `docs/`

- **Do:** `git mv CONTEXT.md DESIGN.md DECISIONS.md DEVELOPING.md LOCAL_PACKAGE_TESTING.md
  RELEASE_READINESS.md docs/` and `git mv adr specs changes docs/`. (`docs/media.md` and
  `docs/schema-separate-file.md` already live there.)
- **Verify:** the root keeps exactly `README.md`, `CHANGELOG.md`, `LICENSE.md`, `NOTICE.md`,
  `TRADEMARK.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`,
  `AGENTS.consumer.md`. 100% renames.

- [x] done

## T5 — Realign the build to the mirror

- **Do:** in `scripts/build.mjs`, add `const srcDir = path.join(rootDir, 'src')`; `copyStaticAssets`
  reads `routes`, `components`, `styles`, `img`, `meta` from `srcDir`. **Targets under `dist/` stay
  exactly as they are** — that is the mirror. Update `scripts/features-manifest.mjs:9` to
  `path.join('src','meta','features.json')`.
- **Files:** `scripts/build.mjs:49-56`, `scripts/features-manifest.mjs:9`
- **Verify:** `npm run build` succeeds and `dist/` contains `plugin/`, `api/`, `routes/`,
  `components/`, `styles/`, `img/`, `meta/` at the top level — **not** `dist/src/`.

- [x] done

## T6 — Collapse the Biome list

- **Do:** `files.includes` → `["src/**", "scripts/**", "tests/**", "e2e/**", "!**/*.astro", "!**/dist"]`.
- **Files:** `biome.json:8-20`
- **Verify:** `npm run check` (`biome ci .`) exits 0. Confirm it still *sees* `src/` by introducing a
  deliberate format error in a `src/` file, running `biome ci .`, and reverting — a glob that matches
  nothing would also exit 0, which is the trap this check exists to catch.

- [x] done

## T7 — Fix the tests that read source as text

- **Do:** prefix the source-path literals with `src/` in the 11 guard tests. These read files as
  **text**; the compiler cannot see them and they fail only at runtime.
- **Files:** `tests/admin-routes-prerender.test.js:23,34` · `tests/admin-define-vars-bridge.test.js:13` ·
  `tests/admin-upload-error-feedback.test.js:29,30` · `tests/block-form-canonical-escape.test.js:25`
  (**and the failure message at `:60`**) · `tests/common-escapehtml-deleted.test.js:25,26` ·
  `tests/download-button-playground.test.js:75,86` · `tests/html-escape-attr-guard.test.js:45-50` ·
  `tests/import-export-admin-ui.test.js:22,117,172,401,498,507,518` ·
  `tests/i18n-no-spanish-leak.test.js:51,52,53,64,66` · `tests/media-canonical-escape.test.js:23` ·
  `tests/table-editors-canonical-escape.test.js:26-29`
- **Verify:** `npm test` green. Then confirm the guards still *guard*: `grep -c "src/" <file>` on each
  — a guard whose path no longer resolves may silently read nothing and pass vacuously. Spot-check
  one by breaking its subject and watching it go red.

- [x] done

## T8 — Repoint the release/screenshot tooling

- **Do:** `scripts/capture-readme-screenshots.mjs:20-22` and `scripts/capture-media-screenshots.mjs:50`
  (+ its path comments at `:10,11,26,91,430`) → `src/img`. `package.json:82` (`version` script):
  `git add README.md img/` → `git add README.md src/img/`. `README.md:7,87,92,97,102,107`:
  `<img src="img/…">` → `src/img/…`.
- **Verify:** `npm run screenshots:readme` writes into `src/img/` and leaves the working tree clean
  apart from those images; the README renders on GitHub with images resolving.
- **Note:** knowingly temporary — the packaging change relocates these to `docs/img/`.

- [x] done

## T9 — Repoint the documentation

- **Do:** `AGENTS.md` (all cycle paths → `docs/`: `changes/<slug>/`, `specs/`, `adr/`, `CONTEXT.md`,
  `DESIGN.md`, `DECISIONS.md`, `DEVELOPING.md`, `LOCAL_PACKAGE_TESTING.md`); `CLAUDE.md` (`@AGENTS.md`
  stays — it is at the root; the rest → `docs/…`); `.github/PULL_REQUEST_TEMPLATE.md`; inside `docs/`,
  links to root files become `../README.md` etc., and source-dir references gain `src/`. Add the
  ADR-0021 invariant to `docs/CONTEXT.md` under conventions.
- **Do NOT touch:** `CHANGELOG.md` (history) and the prose of `docs/adr/0015`, `docs/adr/0018` — an
  ADR is immutable; only its links get repointed.
- **Verify:** no surviving reference to a moved path. Sweep with
  `grep -rnE '\]\((\.\/)?(CONTEXT|DESIGN|DECISIONS|DEVELOPING|LOCAL_PACKAGE_TESTING|RELEASE_READINESS)\.md|\]\((\.\/)?(adr|specs|changes)/' --include='*.md' .`
  excluding `docs/`, `node_modules`, `CHANGELOG.md`.

- [x] done

## T10 — The proof: `dist/` byte-identical

- **Do:** `npm run build`; re-hash the `dist/` tree; diff against the T1 manifest.
- **Verify:** **identical file list and identical hashes.** Any difference means something was lost,
  renamed, or `rootDir` is wrong. This gate is non-negotiable — it is the entire reason the domain
  re-cut and the packaging fix were deferred out of this change.

- [x] done

## T11 — Full gate

- **Do:** `npm run typecheck` · `npm run check` · `npm test` · `npm run e2e` · `npm run pack:local` +
  `npm run prepare:playground` + boot the playground.
- **Verify:** all green; the admin panel loads with the logo and favicon rendering (this is what
  proves `src/routes/admin/layout.astro:15-16`'s asset imports still resolve through `dist/`).
  `git status` shows renames only, no unexpected add/delete.

- [x] done

## Deviations from the plan (found during execution)

Three things the plan did not predict. All three were resolved without weakening a gate.

**1. The `dist/` byte-identical check needed refining — and the refinement made it stronger.**
`dist/` is *not* bit-for-bit identical, for two reasons that are both correct and enumerable:

- **152 `.map` files** differ. Only in their `sources` field (`../utils/getMenu.ts` →
  `../../src/utils/getMenu.ts`) — which is *right*: a sourcemap must point at where the source
  actually lives. Proven by rebuilding `HEAD` in a detached worktree and comparing each map with
  `sources` stripped: **152/152 identical** in `mappings`, `names`, `version` and `file`.
- **`dist/package.json`** differs by exactly one line — the `version` npm script's
  `git add README.md img/` → `src/img/`, which T8 had to change. Verified as a one-line diff with no
  collateral edits.

Everything else — **184/185 executable files and assets** (`.js`, `.d.ts`, `.astro`, `.css`, images,
`features.json`) — is **byte-identical**. The consumer-visible package is unchanged.

**2. `src/**` is a *wider* net than the seven globs it replaced.** It pulls in `src/styles/`, which
Biome had never linted (`styles/` was absent from the old `files.includes`), and `cms-admin.css`
turned out to need formatting — one error, the only one in the whole run. Formatting it would have
changed `dist/styles/cms-admin.css` and destroyed the byte-identical proof. **A reorganization must
not change what CI enforces**, so `!src/styles/**` was added to keep Biome's effective scope exactly
as it was. Confirmed by the diagnostic counts landing on `77 warnings / 114 infos`, the identical
baseline ADR-0013 records for `main`. *Bringing CSS under Biome is a real improvement and now has an
obvious home: its own change, since it touches `dist/`.*

**3. The old `biome.json` would have gone silently blind.** After the move, its globs (`api/**`,
`plugin/**`, …) match nothing — and Biome exits **0** when it checks nothing. Had the config not been
updated, CI would have stayed green while inspecting zero lines of source. The T6 canary (inject a
format error into `src/`, confirm Biome catches it, revert) is what surfaced this, and it is the
strongest argument for the whole change: **a hand-maintained list of directories is a gate that can
quietly stop being a gate.**

## T12 — Commit

- **Do:** one commit, Conventional Commits, English, with the `Reviewed-by` footer. No version bump
  (per `AGENTS.md`, that happens only when the human asks to close/release).
- **Message:** `refactor: adopt src/ as the publish root and move docs under docs/`
  — body explains the invariant (ADR-0021), the collapsed config lists, and the byte-identical
  `dist/` proof.

- [x] done
