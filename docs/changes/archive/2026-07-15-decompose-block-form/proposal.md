<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Decompose `block-form.ts` and extract the picker CSS

_Issue: [#38](https://github.com/NauelG/astro-blocks/issues/38) (P1-4). Grilled 2026-07-15._

## Problem

`src/routes/admin/client/block-form.ts` is **1654 lines** and owns five unrelated concerns behind a
single file: the singleton media-picker dialog (with its own state machine), the field HTML
renderers, the in-place field DOM patchers, the array-limit logic, the file-accept computation, and
the 350-line `mountBlockForm()` wiring. It also carries the last remaining `<style>`-in-JS block in
the admin client (~163 lines injected via `innerHTML` when the picker mounts).

Concrete costs:

- **It blocks #43.** The `page-editor.ts` decomposition is explicitly sequenced after this change.
- **The picker CSS is invisible to tooling.** It ships inside the JS bundle, duplicates the
  DetailModal layout contract that lives in `styles/cms-admin.css`, and will silently escape the
  Biome CSS gate that #95 introduces.
- **Review and navigation cost.** Six concerns in one file means every field-rendering change diffs
  against picker/pagination/upload code it does not touch.

Note the issue text predates reality: the file has grown from 1497 to 1654 lines since it was filed,
and the "650-line `<style>` string" has already shrunk to ~163 lines (picker-modal styles only).
The decomposition motive stands; the CSS motive is now convention/lint hygiene, not bundle weight.

## Proposal

A **strictly mechanical** decomposition — zero observable behaviour change, callers untouched:

1. Split the file into `src/routes/admin/client/block-form/` modules —
   `picker-dialog.ts`, `field-dom-sync.ts`, `field-renderers.ts`, `array-limits.ts`,
   `file-accept.ts`, `mount.ts`, plus `field-helpers.ts` for the six cross-cutting pure helpers
   and the one icon constant shared by two modules.
2. Reduce `block-form.ts` to a **pure re-export facade** (the ADR-0012 `handlers.ts` pattern):
   the public surface (`mountBlockForm`, `BlockFormOptions`, `BlockFormHandle`, `FieldChangeInfo`,
   `ArrayLimitInfo`, `checkArrayLimitReached`) keeps its import path. `page-editor.ts`,
   `global-blocks-editor.ts` and `tests/block-form-array-limit.test.js` compile unchanged.
3. Move the picker-dialog `<style>` block (lines 113–275) into `src/styles/cms-admin.css`, next to
   the existing "Image field picker" / "File field" sections it already collaborates with.

## Out of scope

- SVG icon deduplication across editors — owned by #122.
- `page-editor.ts` decomposition and the shared error-key builder — owned by #43.
- Any design improvement to the picker singleton (module-level mutable state stays as is).

## Consequences

- `docs/specs/admin-html-rendering.md` **R3** ("Rendering lives in `client/*.ts`") must be widened
  to cover client subdirectories, and `tests/html-escape-guard.test.js` must verifiably walk them.
- `tests/block-form-canonical-escape.test.js` pins the literal path
  `src/routes/admin/client/block-form.ts`; it is repointed to the new modules as part of the move.
- Release: no bump during development; at close, `patch` + `### Changed` entry (the admin JS bundle
  loses the embedded CSS).
