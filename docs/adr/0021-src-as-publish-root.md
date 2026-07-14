<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0021 — `src/` is the publish root: `dist/` mirrors `src/`

- **Status:** Accepted — implemented in PR #97
- **Date:** 2026-07-14
- **Decisores:** Nauel Gómez

## Contexto

The repository root mixes three unrelated concerns with no boundary between them: publishable
source (`api/`, `components/`, `contract/`, `plugin/`, `routes/`, `styles/`, `types/`, `utils/`,
`img/`, `meta/`), repo tooling (`scripts/`, `tests/`, `e2e/`, `playgrounds/`), and documentation
(~18 loose `.md` files plus `adr/`, `specs/`, `changes/`, `docs/`).

Two costs follow from the missing boundary, and neither is cosmetic:

1. **Hand-maintained duplicate lists.** Because there is no single code root, every tool has to
   enumerate the same set of directories by hand: `tsconfig.json` `include` lists six of them,
   `biome.json` `files.includes` lists seven, and `scripts/build.mjs` copies five by name. Three
   lists that must be kept in sync manually; adding a directory silently desynchronizes them.

2. **Non-source artifacts leak into the root and into the npm tarball.** A root `data/` directory
   exists on disk even though `.gitignore` states it "must never exist" (it is a write leaked by a
   test into `process.cwd()`), and `img/.DS_Store` is copied into `dist/img/` by
   `scripts/build.mjs`, so it ships to consumers. With no rule about what belongs where, there is
   nothing to check these against.

The trigger is a request to introduce a `src/` directory. But a `src/` directory alone is a
convention, not a rule — it does not by itself say whether `img/` (imported by
`routes/admin/layout.astro` **and** referenced by the README) or `meta/features.json` (project
metadata **and** shipped in `dist/`) belong inside it. Without an explicit invariant, those
ambiguous cases get resolved case-by-case and the boundary rots again.

## Decisión

**`dist/` is the compiled mirror of `src/`. Everything that ships in the published package lives
in `src/`; nothing publishable lives outside it.**

Concretely:

- `src/` contains `api/`, `components/`, `contract/`, `img/`, `meta/`, `plugin/`, `routes/`,
  `styles/`, `types/`, `utils/`. Each maps 1:1 onto `dist/<same-name>/`, whether it gets there via
  `tsc` (TypeScript) or via a copy step in `scripts/build.mjs` (`.astro`, CSS, assets, manifests).
- `tsconfig.json` sets `rootDir: "src"` and `include: ["src/**/*.ts"]`. This is what preserves the
  mirror: with `rootDir: "."` the compiler would emit `dist/src/plugin/index.js` and break every
  `package.json` export path, the `bin`, `plugin/index.ts`'s `cmsDir = resolve(__dirname, '..')`,
  and `plugin/cli/init-ai.ts`'s three-level `..` walk to the package root.
- Non-publishable work — `scripts/`, `tests/`, `e2e/`, `playgrounds/` — stays at the repository
  root, because by the invariant it is not `src/`.
- Documentation that is not required at the root by an external tool (GitHub, npm, coding agents)
  lives under `docs/`.

The public contract is unchanged: `package.json` `exports`, `main`, `types` and `bin` all point at
`dist/…` paths that keep their exact shape. The reorganization is invisible to consumers, and this
is verifiable — `dist/` must be **byte-identical** before and after.

The directories keep their current names and internal boundaries. Re-cutting the code by domain
(screaming architecture) is a separate decision with a separate ADR; conflating it with this move
would destroy the byte-identical `dist/` check, which is the only strong evidence that a
rename-only refactor lost nothing.

## Consecuencias

- The three hand-maintained directory lists collapse: `tsconfig.json` `include` and `biome.json`
  `files.includes` each become a single `src/**` glob. Adding a new source directory needs no
  config change, which removes the desynchronization failure mode entirely.
- A new file has an unambiguous home decidable by one question — *does it ship?* — with no
  judgement call and no need to consult a maintainer. The same rule is checkable by a coding agent.
- Root `data/` and `img/.DS_Store` are deleted, not moved: by the invariant they have no home.
  (The leaked `data/` write means some test writes to `process.cwd()`; that is a separate defect
  worth tracking.)
- Every relative import between the moved directories stays valid — they move together, so their
  relative distances are unchanged. This includes `routes/admin/layout.astro`'s
  `../../img/blocks_logo.jpg`, which continues to resolve in both `src/` and `dist/`. Roughly 200
  import specifiers are untouched.
- Eleven test files read source files as **text** by string path (HTML-escape guards, i18n leak
  guard, prerender guards). Those paths must be updated by hand; the compiler cannot catch them and
  they fail only at runtime.
- The invariant **exposes an existing packaging defect** rather than fixing it: `src/img/` will hold
  both runtime assets (`blocks_logo.jpg`, `favicon.ico`) and six README screenshots, all of which
  `scripts/build.mjs` ships to npm today. Under the new rule the screenshots do not belong in `src/`
  at all. Fixing that changes `dist/` **by design**, so it is deliberately deferred to its own
  change — it cannot coexist with the byte-identical proof this one relies on. Until then, the
  README and the screenshot scripts point at `src/img/`, which is knowingly ugly and temporary.
- `git log --follow` survives, since the move is 100% renames in a single atomic commit.
