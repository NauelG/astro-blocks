<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Bring `src/styles/` under the Biome gate

_Resolves [#95](https://github.com/NauelG/astro-blocks/issues/95) (P2, tooling). Grilled 2026-07-20._

## Problem

`biome.json` carries `!src/styles/**`, so `cms-admin.css` — the single source of truth for the whole
admin panel — has never been checked. It is the largest file in the project that no gate touches.

The exclusion was not an oversight. It was added during the `src/` reorg: collapsing seven
hand-listed directory globs into `src/**` widened the net, Biome saw the CSS for the first time and
reported a format error. Formatting it would have changed `dist/styles/cms-admin.css` and destroyed
that PR's byte-identical `dist/` proof, so the exclusion preserved the effective scope. **That reason
no longer applies.**

## Why now

This stopped being theoretical during today's work. Two of the four fixes released today modified
`cms-admin.css` and were covered by nothing:

| Release | Change | Gate |
| --- | --- | --- |
| `4.0.0` | icon/label spacing after Astro 7's whitespace compression | none |
| `4.0.2` | select menu escaping its clipping ancestor | none |

Both commits say so in their bodies. The gap is now a matter of record rather than a hypothesis.

## What removing the exclusion reports

Measured by temporarily removing it and running Biome:

- **1 format error** — the file has never been formatted; `biome format` would touch ~88 lines.
- **46 lint warnings** — `38 × noImportantStyles`, `8 × noDescendingSpecificity`.

The 38 match the file's 38 `!important` declarations exactly, and they are **not carelessness**.
`DESIGN.md` states the panel's stylesheet loads after Pico CSS specifically so the CMS overrides win,
and the rest are utility classes:

```css
.cms-hidden       { display: none !important; }
.cms-select-native { position: absolute !important; … }
```

`noImportantStyles` assumes the author controls the whole cascade. This file exists because we do
not. The rule is wrong for this context, not the code.

## Proposed change

1. **Remove `!src/styles/**`** from `biome.json` `files.includes`.
2. **`npx biome format --write src/styles/cms-admin.css`** — `format --write`, never `check --write`:
   per ADR-0013 the latter also applies lint autofixes that can change semantics.
3. **Silence `noImportantStyles` in an `overrides` block scoped to `src/styles/**`**, with the reason
   in the config. Scoped rather than global: today there is one stylesheet so the two are equivalent,
   but the justification is specific to the admin sheet, and a rule disabled project-wide is one
   nobody remembers the reason for.
4. **Leave the 8 `noDescendingSpecificity` warnings visible.** They are real signal about cascade
   ordering, and eight is a number someone can actually assess.

## Not in scope

- **Fixing the 46 warnings.** Disproportionate and risky: this file is load-bearing for the entire
  panel, none of the 38 `!important` carry a justifying comment, so removing them means guessing at
  intent — and changing specificity can alter the render with no gate to catch it.
- **Editing ADR-0013.** Its "~77 warnings / 114 infos" sits in *Consequences* as a statement of the
  situation when written. That is historical record and immutable, exactly like ADR-0010's `^6.0.0`.
- **`!**/*.astro`** — the sibling exclusion is [#107](https://github.com/NauelG/astro-blocks/issues/107)
  and [#66](https://github.com/NauelG/astro-blocks/issues/66). Bundling them would make a failure
  impossible to attribute.

## Coordination

[#65](https://github.com/NauelG/astro-blocks/issues/65) ratchets warnings to errors and says to
"track progress by watching the warning count drop toward zero". This change **adds 8** to that
count. Landing it silently would leave #65's premise wrong, so it gets a comment.

## Verification

A CSS formatter reorders whitespace, not declarations, so this "should" be inert. This session has
four times shown that "should" is not evidence — and this file has no gate at all, which is the whole
point of the issue.

So it is measured: dump `getComputedStyle` for every element across the admin pages before and after
the format, and diff. The target is **zero differences** — not "looks the same". The same instrument
found the 142 shifted elements behind the Astro 7 whitespace regression, and it writes nothing into
the repo, unlike regenerating README screenshots.
