<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Decompose `block-form.ts` and extract the picker CSS

## MODIFIED: Admin HTML rendering & escaping (`admin-html-rendering.md`)

**R3 — Rendering lives in `client/*.ts`** widens to acknowledge client submodule directories:

> **R3 — Rendering lives in `client/**/*.ts`.** No admin `.astro` file writes a **dynamic** HTML
> sink; it may assign only a static literal. Dynamic rendering belongs in
> `src/routes/admin/client/` modules — including subdirectories such as `client/block-form/` —
> which Biome lints and the escape guard walks recursively.

Rationale: the block-form decomposition introduces the first client subdirectory
(`client/block-form/`). The requirement's intent (rendering lives in lintable, guard-reachable
module code, never inline in `.astro`) is unchanged; only the path shape widens. The enforcing
test (`tests/html-escape-guard.test.js`) must demonstrably cover subdirectories.

## No other behavioural delta

Everything else in this change is a pure relocation:

- The public contract of `block-form.ts` (`mountBlockForm`, `BlockFormOptions`, `BlockFormHandle`,
  `FieldChangeInfo`, `ArrayLimitInfo`, `checkArrayLimitReached`, import path unchanged) is
  preserved by the re-export facade. Consumers (`page-editor.ts`, `global-blocks-editor.ts`,
  `tests/block-form-array-limit.test.js`) compile untouched.
- The picker CSS relocation (`innerHTML` `<style>` → `styles/cms-admin.css`) does not alter any
  selector or declaration; availability widens to all admin pages but no matching markup exists
  outside the picker dialog.
- No spec section is ADDED or REMOVED.

## Consequence for Archive

1. Apply the R3 wording change to `docs/specs/admin-html-rendering.md` (it may also want a one-line
   note in its "History" preamble citing this change).
2. Move `docs/changes/decompose-block-form/` → `docs/changes/archive/<date>-decompose-block-form/`.
3. No ADR to leave in place — this change creates none.
