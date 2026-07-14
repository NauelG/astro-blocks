<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Reorganize the repo around `src/` as the publish root

## No behavioural delta

This change **adds, modifies and removes nothing** in `specs/`. It is a pure relocation of files.

- No runtime behaviour changes: not one line of TypeScript, Astro or CSS logic is edited. All
  changes are `git mv` operations plus path literals in build/test/config files.
- The **published contract is unchanged**: `package.json` `exports`, `main`, `types` and `bin` keep
  their exact `dist/…` paths, and the emitted `dist/` tree is required to be **byte-identical**
  before and after (see `design.md` §6). A consumer cannot observe this change.
- `specs/api-dispatch.md` is unaffected in content; it only relocates to `docs/specs/api-dispatch.md`.

## Consequence for Archive

The Archive phase has **no delta to integrate into `specs/`**. It only needs to:

1. Move `changes/reorg-src-layout/` → `docs/changes/archive/2026-07-14-reorg-src-layout/`
   (note: `changes/` itself relocates to `docs/changes/` as part of this change).
2. Leave `adr/0021-src-as-publish-root.md` — relocated to `docs/adr/` — intact.

## What this change does establish

Not a spec, a **rule**, and it lives in ADR-0021 and `CONTEXT.md`:

> `dist/` is the compiled mirror of `src/`. Everything that ships lives in `src/`; nothing
> publishable lives outside it.

`docs/CONTEXT.md` gains this invariant under its conventions section, so that the question *"where
does this new file go?"* has a single mechanical answer — *does it ship?* — for both humans and
agents.

## Deferred (each needs its own change)

- **`REMOVED` (future):** README screenshots must stop shipping in the npm tarball
  (`scripts/build.mjs:53` copies all of `img/` into `dist/`). Under ADR-0021 they do not belong in
  `src/` at all. Fixing it changes `dist/` **by design**, so it cannot coexist with the
  byte-identical proof this change relies on.
- The `data/` write leak: some test writes to `process.cwd()/data`. This change deletes the
  artifact; finding the offending test is separate work.
