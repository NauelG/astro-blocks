<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Reorganize the repo around `src/` as the publish root

Implements the invariant in **ADR-0021**: `dist/` is the compiled mirror of `src/`.

## 1. The mirror

Every directory under `src/` maps 1:1 onto `dist/`. Two mechanisms produce the mirror, and both
must stay aligned:

| `src/` | → `dist/` | Produced by |
|---|---|---|
| `src/api/` (27 `.ts`) | `dist/api/` | `tsc` |
| `src/contract/` (1 `.ts`) | `dist/contract/` | `tsc` |
| `src/plugin/` (3 `.ts`) | `dist/plugin/` | `tsc` (+ shebang, `build.mjs:87`) |
| `src/types/` (2 `.ts`) | `dist/types/` | `tsc` |
| `src/utils/` (22 `.ts`) | `dist/utils/` | `tsc` |
| `src/routes/` (22 `.ts` + 19 `.astro`) | `dist/routes/` | `tsc` + copy (`build.mjs:50`) |
| `src/components/` (2 `.astro`) | `dist/components/` | copy (`build.mjs:51`) |
| `src/styles/` (1 `.css`) | `dist/styles/` | copy (`build.mjs:52`) |
| `src/img/` (9 assets) | `dist/img/` | copy (`build.mjs:53`) |
| `src/meta/` (`features.json`) | `dist/meta/` | copy (`build.mjs:54`) |

`tsc` produces its half of the mirror **only** with `rootDir: "src"`. Left at `"."` it emits
`dist/src/plugin/index.js` and simultaneously breaks: every `package.json` export path, the `bin`
(`dist/plugin/cli/index.js`), `plugin/index.ts:21` (`cmsDir = path.resolve(__dirname, '..')`, which
must land on `dist/`), and `plugin/cli/init-ai.ts:63,137` (`path.resolve(cliDir, '..','..','..')`,
which walks from `dist/plugin/cli` to the package root). **This is the single highest-risk line in
the change.**

## 2. What does *not* change

- **~200 relative import specifiers between the moved directories.** They move together, so their
  relative distances are preserved. `src/utils/*.ts` → `../types/index.js` still resolves;
  `src/routes/admin/client/block-form.ts` → `../../../utils/html-escape.js` still resolves.
- **`src/routes/admin/layout.astro:10,15,16`** — `../../styles/cms-admin.css`,
  `../../img/blocks_logo.jpg`, `../../img/favicon.ico?url`. Because `styles/` and `img/` move into
  `src/` too, these resolve in **both** trees: `src/routes/admin/ → src/img/` and
  `dist/routes/admin/ → dist/img/`. This is the concrete payoff of putting assets inside `src/`.
- **`package.json`** `exports`, `main`, `types`, `bin`, `files` — all `dist/…`-relative.
- **`plugin/index.ts`** `injectRoute` entrypoints and `resolveCms` — all `dist/`-relative.
- **`tests/*.js` imports** — all 90 import from `../dist/…`, never from source.
- **`playwright.config.ts`**, `.github/workflows/*`, `e2e/*` — no source-dir paths.

## 3. Moves

```
git mv api components contract img meta plugin routes styles types utils   → src/
git mv CONTEXT.md DESIGN.md DECISIONS.md DEVELOPING.md \
       LOCAL_PACKAGE_TESTING.md RELEASE_READINESS.md                       → docs/
git mv adr specs changes                                                   → docs/
```

`docs/media.md` and `docs/schema-separate-file.md` already live there and do not move.

## 4. Deletions

- `data/` — a leaked write (`.gitignore:35-39` forbids a package-root `data/`). Untracked by git.
- `img/.DS_Store` — currently copied into `dist/img/` and shipped to npm.

Both must be deleted **before** the baseline `dist/` snapshot is taken, or the byte-identical check
reports a false failure on the removed `.DS_Store`.

## 5. Edits — exhaustive inventory

### Config (the payoff)

**`tsconfig.json`**
```jsonc
"rootDir": "src",              // was "."   ← critical
"include": ["src/**/*.ts"],    // was 6 hand-listed dirs
```
`src/types/sortablejs.d.ts` is still matched (`*.ts` covers `.d.ts`). `exclude` is unchanged.

**`biome.json`** — `files.includes` collapses from seven code entries to one:
```jsonc
"includes": ["src/**", "scripts/**", "tests/**", "e2e/**", "!**/*.astro", "!**/dist"]
```
This also fixes a live desync: `components/**` is in Biome's list today but absent from `tsconfig`'s
`include`.

### Build & tooling scripts

| File | Change |
|---|---|
| `scripts/build.mjs:49-56` | introduce `srcDir = path.join(rootDir, 'src')`; sources for `routes`, `components`, `styles`, `img`, `meta` read from `srcDir`. **Targets under `dist/` unchanged** — that *is* the mirror. |
| `scripts/features-manifest.mjs:9` | `path.join('meta','features.json')` → `path.join('src','meta','features.json')` |
| `scripts/capture-readme-screenshots.mjs:20-22` | `path.join(ROOT,'img',…)` → `path.join(ROOT,'src','img',…)` |
| `scripts/capture-media-screenshots.mjs:50` | `IMG_DIR = path.join(ROOT,'img')` → `…,'src','img')`; update path comments at `:10,11,26,91,430` |
| `package.json:82` (`version` script) | `git add README.md img/` → `git add README.md src/img/` |
| `scripts/coverage.mjs` | no change — its paths are `tests/`- and `dist/`-relative |

### Tests that read source as text (11 files — the compiler will not catch these)

Each builds a path from the repo root to a source file; every such literal gains the `src/` prefix.

- `tests/admin-routes-prerender.test.js:23,34`
- `tests/admin-define-vars-bridge.test.js:13`
- `tests/admin-upload-error-feedback.test.js:29,30`
- `tests/block-form-canonical-escape.test.js:25` *(and the failure message at `:60`, which hardcodes `'../../../utils/html-escape.js'`)*
- `tests/common-escapehtml-deleted.test.js:25,26`
- `tests/download-button-playground.test.js:75,86`
- `tests/html-escape-attr-guard.test.js:45-50`
- `tests/import-export-admin-ui.test.js:22,117,172,401,498,507,518`
- `tests/i18n-no-spanish-leak.test.js:51,52,53,64,66`
- `tests/media-canonical-escape.test.js:23`
- `tests/table-editors-canonical-escape.test.js:26-29`

### Documentation pointers

| File | Change |
|---|---|
| `README.md:7,87,92,97,102,107` | `<img src="img/…">` → `src/img/…` *(temporary — the packaging change moves these to `docs/img/`)* |
| `CLAUDE.md` | `@AGENTS.md` stays (root); pointers to `CONTEXT.md`, `DESIGN.md`, `DECISIONS.md`, `adr/` → `docs/…` |
| `AGENTS.md` | all cycle paths → `docs/`: `changes/<slug>/`, `specs/`, `adr/NNNN-*.md`, `CONTEXT.md`, `DESIGN.md`, `DECISIONS.md`, `DEVELOPING.md`, `LOCAL_PACKAGE_TESTING.md` |
| `.github/PULL_REQUEST_TEMPLATE.md` | doc paths → `docs/` |
| `docs/CONTEXT.md`, `docs/DESIGN.md`, `docs/DEVELOPING.md`, `docs/RELEASE_READINESS.md`, `docs/media.md` | sibling links stay valid (they all move together); links to root files (`README.md`, `CHANGELOG.md`) become `../README.md`; source-dir references gain `src/` |
| `docs/adr/0015-*.md`, `docs/adr/0018-*.md` | doc/dir references only. **The Contexto/Decisión/Consecuencias prose is NOT rewritten** — an ADR is immutable and describes the world as it was. |
| `CHANGELOG.md` | **not touched.** It is history. |

## 6. Verification

| Gate | Command | Passes when |
|---|---|---|
| Package identity | hash-compare the `dist/` tree before/after | **byte-identical** |
| Rename integrity | `git status` / `git diff --stat -M` | 100% renames; no unexpected add/delete |
| Unit | `npm test` (build + 90 tests) | green — this catches the 11 text-reading guards |
| Types | `npm run typecheck` | green — catches a wrong `rootDir`/`include` |
| Lint | `npm run check` (`biome ci .`) | green — catches a wrong `includes` glob |
| E2E | `npm run e2e` | green |
| Consumer view | `npm run pack:local` → `npm run prepare:playground` → boot playground | admin panel loads, logo + favicon render |

The `dist/` byte-identical check is the load-bearing one. It exists **only** because this change is
renames-only, and it is why the domain re-cut and the packaging fix are deferred.
