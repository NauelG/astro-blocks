<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Bring `src/styles/` under the Biome gate

One vertical slice. The order matters: the **before** dump has to exist before anything touches the
CSS, and the format pass has to come after the config change or Biome will refuse to look at the file.

> **The gate being added cannot verify this change.** `biome ci` will confirm the file is *formatted*;
> it says nothing about whether formatting altered the render. That is what the computed-style dump is
> for, and it is the only evidence that counts here.

## T1 — Baseline dump (before anything)

- [x] Throwaway Playwright spec in the **scratchpad**, copied into `e2e/` only to run and deleted
  afterwards: log in, visit every admin route, and for every element dump
  `index | TAG.firstClass | <the property subset from design.md §4>`.
- [x] Assert the element count is recorded per page. If a later run has a different count the
  comparison is meaningless — the #138 probe measured the wrong element for exactly this reason, and
  an unscoped selector reports confidently either way.
- **Verify:** one JSON file per admin route exists, non-empty. **Do not touch the CSS before this
  completes.**

## T2 — Config (`biome.json`)

- [x] Remove `!src/styles/**` from `files.includes`.
- [x] Add the `overrides` block from `design.md` §1: `includes: ["src/styles/**"]`,
  `complexity.noImportantStyles: "off"`.
- [x] Leave `!**/*.astro` alone — that is #107 / #66, deliberately not bundled.
- **Verify:** `npx biome check src/styles/cms-admin.css` now looks at the file and reports **1 format
  error + 8 warnings** (the 38 `noImportantStyles` are gone, the 8 `noDescendingSpecificity` remain).
  Use `--max-diagnostics=200`: the default of 20 truncates and will under-report — it did during
  grilling, showing 20 of 46.

## T3 — Format pass

- [x] `npx biome format --write src/styles/cms-admin.css`.
- [x] **Never `check --write`** — per ADR-0013 it also applies lint autofixes, which on CSS could
  rewrite declarations. Whitespace is the only intended change.
- **Verify:** `git diff --stat` shows one file, ~88 lines. Skim the diff and confirm every hunk is
  whitespace: no reordered declarations, no changed values, no removed `!important`.

## T4 — Prove the render is unchanged

- [x] `npm run build` and rebuild the playground, then re-run the T1 spec into a second directory.
- [x] Diff the two dumps. **Target: zero differing elements.**
- [x] If the element counts differ between runs, the comparison is invalid — fix the instrument
  before reading the result, do not explain the difference away.
- [x] Any non-zero diff **stops the change**. A formatter that alters a computed style means either
  the tool did more than format or the assumption was wrong; both need understanding, not overriding.
- **Verify:** zero.

## T5 — Documentation and coordination

- [x] `docs/DESIGN.md` §1.3 — add the *Linting* paragraph from `spec-delta.md`, including the
  warning not to re-enable `noImportantStyles` without first removing the 38 deliberate uses.
- [x] Do **not** edit `docs/adr/0013-biome-ci-gate.md`. Immutable; its baseline figure describes the
  moment it was written.
- [x] Comment on [#65](https://github.com/NauelG/astro-blocks/issues/65): the warning count it tracks
  moves from **62 to 69**, the 8 added are `noDescendingSpecificity` in `cms-admin.css`, and 38
  `noImportantStyles` were suppressed by scoped config rather than fixed.

  > **Corrected during execution.** This bullet originally said "~77 to ~85", quoting ADR-0013's
  > figure as if it were current. Measured, `main` is at 62 — the ADR is right as history and has
  > drifted. The delta is also +7, not +8: one warning *disappeared*
  > (`useBiomeIgnoreFolder`), which Biome had been raising about the `!src/styles/**` exclusion this
  > change removes.
- **Verify:** a reader of `DESIGN.md` alone can tell why the rule is off and what must happen before
  turning it back on.

## T6 — Full verification

- [x] `npx biome ci .` — exit 0. This is the gate the issue is about.
- [x] `npm run build && npm test && npm run typecheck` — 1291/1291.
- [x] `npm run features:validate`.
- [x] `npm run build:playground && npm run e2e` — 11/11. Rebuild first; `npm run e2e` does **not**
  rebuild the playground.
- [x] `git diff --stat` on `dist/` after a build: exactly one changed file,
  `dist/styles/cms-admin.css`, formatting only.
- [x] Delete the throwaway spec from `e2e/`; revert any `playgrounds/basic/data/` churn.

## T7 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `tooling(biome): bring src/styles under the lint gate`
- Body: why the exclusion existed (it preserved a byte-identical `dist/` proof during the `src/`
  reorg) and why that reason is gone; that two UI fixes released today modified this file with no
  gate covering it; that `noImportantStyles` is suppressed rather than fixed because the sheet exists
  to override Pico and the rule assumes otherwise; and that the render was proven unchanged by
  diffing computed styles, not by looking. Reference #95, ADR-0013, and #65 for the count.
- No version bump, no `CHANGELOG` entry — tooling-only, no consumer-visible change
  (`AGENTS.md`: *cambios solo-CI/infra no llevan entrada*).
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Execution notes (2026-07-20)

**T3's "confirm every hunk is whitespace" was not satisfiable as written.** Biome's CSS formatter
does slightly more than whitespace, and a line-by-line diff cannot show it because the formatter also
*splits* long declarations. Stripping all whitespace from both versions and comparing revealed two
further transformations: `content: ''` → `""` (1) and hex colours lowercased (4). Both are inert in
CSS — same empty string, hex is case-insensitive — and after normalising those two the before and
after are byte-identical. That is an exhaustive statement rather than "looks like only whitespace".

**T4 returned zero**, over 3281 elements across 11 admin routes, with matching element counts in both
runs.

**`biome ci` failed on `biome.json` itself.** The Python `json.dump(indent=2)` used to edit the config
does not match Biome's own formatting, so the first full run exited 1 — the newly added gate caught
the change that added it. Fixed with `biome format --write biome.json`.

**The `dist/` delta check in T6 does not apply**: `dist/` is not tracked in this repo, so there is
nothing to diff. The issue's original verification step assumed otherwise.
