<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Ratchet the "unused" rules to error

One vertical slice. The autofix comes first because it shrinks the manual set from 33 to 6; the
ratchet comes last because promoting the rules before the file is clean would fail the gate on the
way in.

> **Measure with `--reporter=json`, never by grepping the terminal.** `biome check` defaults to
> `--max-diagnostics=20` and truncates **silently** (it showed 20 of 46 during #95's triage), and the
> decorated output does not separate warnings from infos — which is how wrong figures reached #65
> twice. Every count in this plan came from the JSON reporter and every count taken while executing
> it must too.

## T1 — Record the starting point

- [x] `npx biome ci --reporter=json --max-diagnostics=500 .` → capture the summary and the per-rule
  warning breakdown. Expected: **69 warnings / 113 infos / 0 errors**, 11 rules.
- [x] Note `npm test`'s test count. Expected **1291**. This is the number that catches a manual
  deletion silently removing a test case, and nothing else will.
- **Verify:** both figures recorded before anything changes.

## T2 — Scoped autofix

- [x] ```
      npx biome check --write --unsafe \
        --only=correctness/noUnusedVariables \
        --only=correctness/noUnusedImports \
        --only=correctness/noUnusedFunctionParameters .
      ```
- [x] **`--only` is not optional.** Unscoped, `--unsafe` rewrites 40 files across every rule; scoped,
  it touches 17 and every hunk is the same operation. That is the difference between a reviewable
  diff and a machine-generated one.
- [x] Skim all 17 files. Each hunk must be a removal of something unreferenced — no reordering, no
  rewritten expressions, no changed values. Anything else means `--only` did not hold and the change
  stops here.
- **Verify:** warnings **69 → 42**; `noUnusedImports` and `noUnusedFunctionParameters` at **0**;
  `noUnusedVariables` at **6**. `npm run typecheck` green.

## T3 — The six by hand

- [x] `tests/import-export-import-pipeline.test.js` lines 218, 498, 529, 672, 1313 and
  `tests/media-handlers.test.js` line 425 — all destructured `await import(...)` bindings.
- [x] For each: is the whole statement dead (delete the line) or only one binding (narrow the
  pattern)? Leave no empty `const { } = await import(...)`.
- [x] **Ask the question that matters** before deleting: did the code that used this binding
  disappear together with an assertion? An unused variable in a test is sometimes a leftover and
  sometimes the fossil of removed coverage. If any case looks like the second, **record it** —
  that is a real defect wearing a lint warning, and this is the only moment anyone will look.
- **Verify:** `noUnusedVariables` at **0**; warnings at **36**; `npm test` still **1291** — same
  count, not merely green.

## T4 — The ratchet (`biome.json`)

- [x] Add the three rules at `"error"` under `linter.rules.correctness`, per `design.md` §3.
- [x] Leave the `overrides` block from #95 untouched.
- **Verify:** `npx biome ci .` exits **0** with the rules now at error severity.

## T5 — Prove the ratchet bites

- [x] Add an unused import to any `src/` file. Run `npx biome ci .` — it must **fail**.
- [x] Remove it. Run again — must pass.
- **This is the only step that tests what the change is for.** Everything else checks that nothing
  broke; this checks that something now cannot break silently. A ratchet that does not bite is
  decoration.

## T6 — Full verification

- [x] `npm run build && npm test && npm run typecheck` — **1291/1291**, count unchanged from T1.
- [x] `npx biome ci .` — exit 0.
- [x] `npm run features:validate`.
- [x] `npm run build:playground && npm run e2e` — 11/11. Rebuild first; `npm run e2e` does **not**
  rebuild the playground.
- [x] Revert any `playgrounds/basic/data/` churn.

## T7 — Correct #65 and commit

- [x] Comment on [#65](https://github.com/NauelG/astro-blocks/issues/65) with: the measured inventory
  after this slice (36 warnings, 8 rules), the three rules now at `error`, and — plainly — that the
  two earlier comments carried wrong figures because they came from grepping decorated output
  instead of `--reporter=json`. Include the `--max-diagnostics` truncation warning so the next person
  does not repeat it.
- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `tooling(biome): ratchet the unused-code rules to error`
- Body: what the ratchet is for and why the count alone is not the point; that `--only` is what made
  `--unsafe` reviewable (17 files, one operation) versus 40 unscoped; that six needed hand review
  because Biome will not edit a destructuring pattern; and that the ratchet was verified by breaking
  it on purpose. Reference #65, ADR-0013, and #95 for the precedent that unread warnings hide real
  signal.
- No version bump, no `CHANGELOG` entry — tooling-only (`AGENTS.md`: *cambios solo-CI/infra no llevan
  entrada*).
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Execution notes (2026-07-20)

**The autofix renames, it does not delete.** `--unsafe --only=` prefixes unused bindings with `_`,
Biome's convention for "intentionally unused". The plan assumed deletion and said the change stops if
the hunks are not removals — so it stopped. For function parameters the rename is the correct and
only possible fix (a positional parameter cannot be deleted); the ~12 variables and functions were
then handled by hand: statement deleted where the expression was pure, binding dropped and the call
kept where the call had a side effect the test relied on.

**Deleting dead code exposed more dead code.** Warnings went 42 → 45 after the manual pass before
coming down to 36: removing `const _page1 = await res1.json()` left `res1` unused, and so on. The
cascade is correct and is evidence the cleanup was real rather than cosmetic.

**A `.replace(..., 1)` broke a test, and the test count caught it.** Narrowing a destructuring by
string match hit the *first* occurrence in the file, which was a different one where the binding was
used — `ReferenceError: replaceMedia is not defined`. I noticed the replacement had "landed
elsewhere" and moved on instead of reverting it, which was the actual mistake. Found by T1's
requirement to compare the test count, not merely that the suite was green: 1291 tests, 1290 passing.
The remaining edits were then applied **by line number**, descending.

**`biome ci` failed after the ratchet — on formatting, not lint.** The line deletions left
`import-export-import-pipeline.test.js` unformatted. Fixed with `format --write`, per ADR-0013.

**T5 confirmed the ratchet bites**: an unused import added on purpose produced
`ERROR: lint/correctness/noUnusedImports` and a red gate; removing it returned exit 0.

**One real finding.** `tests/i18n-t.test.js` carried `const tFnEn = createT('en');` under a comment
reading *"nav.dashboard must exist in en (and in es). As a sanity check:"* — with no assertion. The
check had been removed and the unused variable was its fossil. Deleted along with the orphaned
comment, and reported on #65.
