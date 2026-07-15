<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Decompose `block-form.ts` and extract the picker CSS

## 1. Shape

Facade + submodule directory, mirroring ADR-0012 (`handlers.ts` over `handlers/*.ts`). NodeNext
resolution means `'./block-form.js'` cannot resolve to a directory index, so the facade **file**
stays and the submodules live beside it:

```
src/routes/admin/client/
├── block-form.ts              ← pure re-export facade (~20 lines, no logic)
└── block-form/
    ├── picker-dialog.ts
    ├── field-dom-sync.ts
    ├── field-renderers.ts
    ├── array-limits.ts
    ├── file-accept.ts
    ├── field-helpers.ts
    └── mount.ts
```

`docs/CONTEXT.md`'s glossary entry ("`block-form.ts` is the single source of truth for block field
rendering") remains true: the facade is the SSOT's front door; the directory is implementation
detail. No new ADR — the decision follows a documented precedent and is cheap to reverse.

## 2. Module map

Line ranges refer to the pre-split file (1654 lines).

| Module | Contents (moved verbatim) | Source lines |
|---|---|---|
| `picker-dialog.ts` | singleton state (`pickerDialog`, `activePickerInputId`, `activePickerMode`, `activePickerAccept`), `mountPickerDialog`, `closePickerDialog`, `PickerState`, `renderPickerItem`, `renderPickerGrid`, `pickerLoadPage`, `openPickerDialog`, `selectPickerImage`, `selectPickerFile`, `xIconSvg` | 81–773 (minus the `<style>` block) |
| `field-dom-sync.ts` | `updateImageFieldDom`, `updateFileFieldDom`, `seedAltInput`, `seedCaptionInput` | 320–402 |
| `field-renderers.ts` | `imageFieldHtml`, `fileFieldHtml`, `primitiveInputHtml`, `renderPrimitiveField`, `renderArrayPrimitiveItem`, `renderArrayObjectItem`, `renderArrayField`, `trashIconSvg` | 903–1300 |
| `array-limits.ts` | `ArrayLimitInfo`, `checkArrayLimitReached` | 782–807 |
| `file-accept.ts` | `getGlobalAllowlist`, `computeEffectiveAccept` | 964–1011 |
| `field-helpers.ts` | `errorKey`, `withLocaleHint`, `parseFieldValue`, `defaultPrimitiveValue`, `defaultArrayItemValue`, `imageFilenameFromUrl`, `imagePickerIconSvg` | 833–901, 74–77 |
| `mount.ts` | `FieldChangeInfo`, `BlockFormOptions`, `BlockFormHandle`, `mountBlockForm` (incl. Sortable lifecycle) | 775–831, 1302–1654 |

**Facade** re-exports exactly the current public surface:

```ts
export { mountBlockForm } from './block-form/mount.js';
export type { BlockFormOptions, BlockFormHandle, FieldChangeInfo } from './block-form/mount.js';
export { checkArrayLimitReached } from './block-form/array-limits.js';
export type { ArrayLimitInfo } from './block-form/array-limits.js';
```

Nothing else is re-exported: submodule internals stay internal.

## 3. Dependency graph (one-directional, no cycles)

```
mount.ts ──────────► field-renderers.ts ──► field-helpers.ts, file-accept.ts
   │                        │
   ├──► picker-dialog.ts ──►│ field-dom-sync.ts ──► field-helpers.ts
   ├──► field-dom-sync.ts   │
   ├──► array-limits.ts     └─► array-limits.ts (renderArrayField reads maxItems hint)
   └──► field-helpers.ts
```

Cross-cutting facts that force `field-helpers.ts` to exist:
`imageFilenameFromUrl` is used by both `field-dom-sync` and `field-renderers`; `errorKey` by both
`field-renderers` and `mount`; `imagePickerIconSvg` by both `field-dom-sync` (placeholder swap on
clear) and `field-renderers` (initial placeholder + choose button). Icons `xIconSvg` and
`trashIconSvg` have a single consumer each and stay with it (#122 will centralize all three later).

The module-level singleton state stays module-level in `picker-dialog.ts` — mechanical move, no
redesign. `selectPickerImage`/`selectPickerFile` live with the picker because they read
`activePickerInputId`; they call into `field-dom-sync` (one-way edge).

## 4. CSS extraction

The `<style>` block at lines 113–275 (~163 lines, `.cms-media-picker-*` selectors) moves verbatim
into `src/styles/cms-admin.css` as a new sectioned block
(`/* ─── Media picker dialog ─── */`) adjacent to the existing "Image field picker" (l. 4333) and
"File field" (l. 4431) sections. The `<style>` element is removed from `mountPickerDialog`'s
`innerHTML` template.

Equivalence argument: the current `<style>` is a regular global stylesheet (the dialog is **not**
shadow DOM), so its selectors already apply document-wide on pages that mount the picker. Moving
them to the globally-loaded `cms-admin.css` widens *availability* (all admin pages) but not
*applicability* (no `.cms-media-picker-*` markup exists outside the dialog). Keep the block's
explanatory comment about mirroring the DetailModal layout contract.

## 5. Spec & guard-test impact

- **`docs/specs/admin-html-rendering.md` R3** — wording widens from `client/*.ts` to client modules
  *including subdirectories* (`client/**/*.ts`). See `spec-delta.md`.
- **`tests/html-escape-guard.test.js`** — verify its `readdirSync` walk recurses into
  `client/block-form/`; if it does not, extend it. The new modules must remain inside the guard.
- **`tests/block-form-canonical-escape.test.js`** — repoint from the single pinned `relPath` to the
  `block-form/` modules that contain sinks (`picker-dialog.ts`, `field-dom-sync.ts`,
  `field-renderers.ts`, `mount.ts`). The facade contains no sinks and needs no entry.
- **`tests/block-form-array-limit.test.js`** — imports `checkArrayLimitReached` from
  `dist/.../block-form.js`; the facade keeps it green untouched.
- **`scripts/coverage.mjs`** — excludes `block-form.ts` from unit coverage (noted in the canonical-
  escape test header); the exclusion must cover the new directory too, or coverage gates would
  suddenly count 1600 uncovered lines.

## 6. Verification bar (agreed at grilling)

1. `npm run typecheck` and `npm test` green at **every** commit (leaf-first sequence, §7).
2. `e2e/admin-flow.spec.ts` green after the final commit.
3. Manual picker smoke in `playgrounds/basic`: open picker, paginate, select image, select file,
   clear, array add/remove/reorder (Sortable), upload from picker.
4. CSS check: picker renders identically; the built admin JS bundle no longer embeds
   `.cms-media-picker-*` rules.

## 7. Commit sequence (each compiles, typechecks, tests green)

1. `refactor(admin): move picker dialog CSS into cms-admin.css`
2. `refactor(admin): extract block-form leaf modules (field-helpers, array-limits, file-accept)`
3. `refactor(admin): extract block-form field-dom-sync module`
4. `refactor(admin): extract block-form field-renderers module`
5. `refactor(admin): extract block-form picker-dialog module`
6. `refactor(admin): extract mount.ts and reduce block-form.ts to a re-export facade`
   (includes the canonical-escape/guard test repointing and the spec R3 edit)

Leaf-first order guarantees every intermediate state has no forward references; `git bisect`
resolution is one extraction, not the whole change.
