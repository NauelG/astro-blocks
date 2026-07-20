<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Ratchet the "unused" rules to error

_First slice of [#65](https://github.com/NauelG/astro-blocks/issues/65) (P3, tooling). Grilled
2026-07-20._

## Problem

`biome ci` fails on **errors only**. 69 lint warnings are non-blocking, so nothing stops a new one
from appearing. #65 asks for the ratchet: fix a rule, promote it to `error` in `biome.json`, and it
can never regress — explicitly "in small per-rule PRs, not one mega-PR".

Warnings are not free. #95 landed today after finding that Biome had been raising
`useBiomeIgnoreFolder` about a stale exclusion **for months**; the signal was real and was one line
among 62. A warning list nobody reads is a gate that does not exist.

## Measured state

`biome ci --reporter=json` on `main`, **69 warnings across 11 rules** — 34 in `src/`, 34 in `tests/`,
1 in `e2e/`:

| Rule | Count |
| --- | --- |
| `correctness/noUnusedVariables` | 18 |
| `complexity/useOptionalChain` | 14 |
| `correctness/noUnusedFunctionParameters` | 8 |
| `style/noDescendingSpecificity` | 8 |
| `correctness/noUnusedImports` | 7 |
| `style/noNonNullAssertion` | 5 |
| `suppressions/unused` | 3 |
| `suspicious/noExplicitAny` | 3 |
| `style/useImportType`, `suspicious/noDocumentCookie`, `performance/noDynamicNamespaceImportAccess` | 1 each |

## What autofix actually does

Measured by applying and reverting, not assumed:

| Command | warnings | infos | files touched |
| --- | --- | --- | --- |
| — | 69 | 113 | — |
| `check --write` (safe) | 68 | 113 | **1** |
| `check --write --unsafe` | 27 | 1 | **40** |
| `check --write --unsafe --only=` the three unused rules | 42 | 113 | **17** |

The safe autofix resolves **one** warning. Blanket `--unsafe` resolves a lot but rewrites 40 files
with changes the tool itself declares unsafe, across shipped code — and ADR-0013 records exactly why
`check --write` is not the default tool here.

## Proposed change

**Scope: the "unused" family** — `noUnusedVariables` + `noUnusedFunctionParameters` +
`noUnusedImports`, **33 warnings**. Three rules, one idea: dead code. Reviewing them together is more
coherent than three PRs that each read the same way.

1. **`biome check --write --unsafe --only=` scoped to those three rules** — 27 warnings, 17 files.
   Scoping is what makes `--unsafe` acceptable here: every change is of a single, inspectable nature
   (delete something unreferenced), rather than an assorted 40-file rewrite.
2. **Six by hand**, all in two test files, all destructured dynamic imports the autofix refuses to
   touch because editing a destructuring pattern can change evaluation:
   `tests/import-export-import-pipeline.test.js` (5) and `tests/media-handlers.test.js` (1).
3. **Promote the three rules to `"error"`** in `biome.json`. This is the ratchet; without it the
   change is a cleanup that decays.

Result: **69 → 36 warnings**, and three rules that can never come back.

## Why this scope is verifiable

Deleting something genuinely unused cannot change behaviour. If it does, **it was not unused** — and
that is the finding, not an accident. The six manual cases deserve a second look for exactly this
reason: an unused variable in a test can mean "leftover", or it can mean "the assertion that used it
was deleted", and the second is a real defect hiding behind a lint warning.

## Alternatives considered

- **Blanket `--unsafe`** — rejected. 69→27 warnings and 113→1 infos in one pass is tempting, and the
  suite plus e2e plus a computed-style dump could probably verify it. But it is 40 files of
  machine-applied changes the tool flags as unsafe, over shipped code, and it contradicts the
  issue's own instruction.
- **One rule per PR** — rejected as too fine here. The three rules are the same idea and the same
  review; splitting them triples the ceremony without adding a decision point.
- **Starting with `suppressions/unused` (3)** — a smaller, zero-risk first slice that would validate
  the fix-then-promote flow. Rejected only because 3 of 69 leaves the pattern untested against
  anything that matters; it remains a good candidate for the next slice.

## Correction owed to #65

The figures I posted to that issue were wrong twice, and the root cause was the same both times:
grepping decorated terminal output instead of using `--reporter=json`, which Biome has always had.
`useLiteralKeys` was quoted as 89 *warnings* — it is **info** severity. "121 FIXABLE diagnostics
could go in a few mechanical PRs" — the **safe** autofix resolves **one**. A third comment carries
the measured inventory.
