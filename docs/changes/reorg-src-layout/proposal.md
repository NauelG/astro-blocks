<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Reorganize the repo around `src/` as the publish root

## Problem

The repository root has no boundary between publishable source, repo tooling, and documentation.
The cost is not aesthetic; it is two concrete defects.

**Duplicate hand-maintained lists.** With no single code root, three separate configs enumerate the
same directories by hand:

| File | Lists |
|---|---|
| `tsconfig.json` (`include`) | `plugin`, `api`, `contract`, `utils`, `routes`, `types` |
| `biome.json` (`files.includes`) | `api`, `plugin`, `contract`, `utils`, `routes`, `types`, `components` (+ `scripts`, `tests`, `e2e`) |
| `scripts/build.mjs:50-54` | `routes`, `components`, `styles`, `img`, `meta` |

They already disagree (`components` is in Biome's list but not TypeScript's `include`). Adding a
directory desynchronizes them silently.

**Non-source artifacts leak into the root and into npm.** `data/media.json` sits in the root even
though `.gitignore:35-39` states that a package-root `data/` "must never exist" — it is a write
leaked by a test into `process.cwd()`. `img/.DS_Store` is copied into `dist/img/` by
`scripts/build.mjs:53` and ships to consumers.

## Proposal

Adopt the invariant recorded in **ADR-0021**:

> `dist/` is the compiled mirror of `src/`. Everything that ships lives in `src/`; nothing
> publishable lives outside it.

and reorganize the repository to satisfy it.

### Target layout

```
src/                    # everything that ships — dist/ mirrors this 1:1
  api/  components/  contract/  img/  meta/
  plugin/  routes/  styles/  types/  utils/

docs/                   # internal documentation
  CONTEXT.md  DESIGN.md  DECISIONS.md  DEVELOPING.md
  LOCAL_PACKAGE_TESTING.md  RELEASE_READINESS.md
  media.md  schema-separate-file.md
  adr/  specs/  changes/

scripts/  tests/  e2e/  playgrounds/     # not shipped → not src/

README.md  CHANGELOG.md  LICENSE.md  NOTICE.md  TRADEMARK.md
CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md
CLAUDE.md  AGENTS.md  AGENTS.consumer.md   # required at root by GitHub / npm / agents
```

The eight code directories plus `img/` and `meta/` move **verbatim** — no renames, no re-cutting by
domain. `dist/` therefore keeps its exact current shape, and `package.json`'s `exports`, `main`,
`types` and `bin` need no change at all. Consumers cannot observe this refactor.

Root `data/` and `img/.DS_Store` are deleted, not moved: under the invariant they have no home.

### Explicitly out of scope

- **Re-cutting `src/` by domain** (screaming architecture). A separate decision, a separate ADR. It
  would also destroy the byte-identical `dist/` check that makes this move provably safe.
- **The npm packaging leak.** `scripts/build.mjs:53` ships six README screenshots to consumers. The
  fix (`src/img` → `src/assets` for the two runtime assets, screenshots out to `docs/img/`) changes
  `dist/` *by design* and therefore cannot coexist with the byte-identical proof. It gets its own
  change. Until then the README and screenshot scripts point at `src/img/` — knowingly temporary.
- **The `data/` write leak.** Some test writes to `process.cwd()/data`. We delete the artifact here;
  finding and fixing the offending test is separate work.

## Why this and not the alternatives

- **A monorepo (`packages/*`)** would be the right move only if a second publishable artifact
  existed. It does not: the growth is more subpath exports inside the same package. A single-package
  monorepo is pure overhead.
- **Moving code but leaving `img/`/`meta/` at the root** breaks the mirror and makes
  `routes/admin/layout.astro:15` import `../../../img/blocks_logo.jpg` — a path that resolves in the
  source tree but points *outside the package* from `dist/`. A specifier that is a lie in one of the
  two trees is exactly the fuzzy boundary this change exists to kill.
- **Moving only the code and leaving the docs** halves the benefit and leaves ~18 `.md` files in the
  root.

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `tsconfig.json` keeps `rootDir: "."` → `tsc` emits `dist/src/plugin/…` | **Critical** — breaks every export, the `bin`, `cmsDir`, and `init-ai.ts`'s `../../..` walk simultaneously | `rootDir: "src"` is task 1; the byte-identical `dist/` check catches it instantly |
| 11 test files read source as text by string path | **High** — invisible to the compiler, fails only at runtime | Enumerated in `design.md`; `npm test` is a required gate |
| Doc cross-links (`CLAUDE.md`, `AGENTS.md`, ADRs) go stale | Medium | Enumerated and rewritten; `CHANGELOG.md` is history and is **not** rewritten |
| A rename silently drops a file | High | `dist/` byte-identical + `git status` must report 100% renames |

## Verification

1. **`dist/` byte-identical** — hash every file under `dist/` before and after; the trees must match
   exactly. This is the strong proof, and it is only available because the move is renames-only.
   *(Snapshot the baseline **after** deleting `img/.DS_Store`, since that file currently ships.)*
2. `npm test` (build + 90 unit tests), `npm run typecheck`, `npm run check` (Biome), `npm run e2e`.
3. `npm run pack:local` + `npm run prepare:playground` + boot the playground — the package as a
   consumer sees it.
4. `git status` reports renames only; no unexpected add/delete.

## Delivery

A **single atomic commit**. The repo is never in a broken state, and git records the moves as
renames so `git log --follow` survives.
