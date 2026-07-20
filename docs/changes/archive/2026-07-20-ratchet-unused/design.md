<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Ratchet the "unused" rules to error

## 1. The scoped autofix

```
npx biome check --write --unsafe \
  --only=correctness/noUnusedVariables \
  --only=correctness/noUnusedImports \
  --only=correctness/noUnusedFunctionParameters .
```

`--only` is what makes `--unsafe` acceptable. Unscoped it rewrites 40 files across every rule Biome
has an opinion about; scoped, it touches 17 and every hunk is the same operation — remove a binding
nothing references. A reviewer can read that diff.

Measured effect: 27 of the 33 resolved. `noUnusedImports` and `noUnusedFunctionParameters` go to
**0**; `noUnusedVariables` drops 18 → 6.

## 2. The six the autofix will not touch

All are destructured dynamic imports. Biome refuses to edit a destructuring pattern because removing
a binding changes what the expression evaluates, and it cannot prove that is inert.

| File | Line | Binding |
| --- | --- | --- |
| `tests/import-export-import-pipeline.test.js` | 218 | `DATA_SCHEMA_VERSION: SV` |
| | 498 | `buildManifest` |
| | 529 | `sha256Hex` |
| | 672 | `SV` |
| | 1313 | `SV` |
| `tests/media-handlers.test.js` | 425 | `replaceMedia` |

They read as preparation for building a manifest by hand in tests that ended up taking another route:

```js
const { sha256Hex } = await import('../dist/api/manifest.js');
const { DATA_SCHEMA_VERSION: SV } = await import('../dist/api/schema-version.js');
```

**Each is looked at, not swept.** The two questions per case: is the whole `await import(...)`
statement now dead (delete the line) or only one binding (narrow the pattern); and — the one that
matters — *did the code that used it disappear along with an assertion?* An unused variable in a test
is sometimes a leftover and sometimes the fossil of coverage that was removed. The second is a real
defect wearing a lint warning, and the only chance to notice it is now.

## 3. The ratchet (`biome.json`)

```jsonc
"linter": {
  "enabled": true,
  "rules": {
    "recommended": true,
    "correctness": {
      "noUnusedVariables": "error",
      "noUnusedImports": "error",
      "noUnusedFunctionParameters": "error"
    }
  }
}
```

This is the point of the change. Without it the cleanup is a one-off that decays back; with it, a new
unused binding **fails `biome ci`** and therefore fails CI (`ci-main.yml:40` runs `npm run check`,
which is `biome ci .`).

The `overrides` block from #95 stays untouched.

## 4. Expected end state

| | before | after |
| --- | --- | --- |
| warnings | 69 | **36** |
| rules at `error` | 0 (beyond recommended defaults) | 3 |
| `biome ci` | exit 0 | exit 0 |

Infos are untouched at 113 — this slice is about warnings.

## 5. Verification

The scoped autofix's claim is "nothing referenced was removed". The compiler and the suite are the
right instruments for that, and unusually for this session they genuinely cover it:

1. `npm run typecheck` — a removed binding that was actually referenced is a type error.
2. `npm test` — 1291/1291. Most of the diff is in `tests/`, so the suite is testing the edit to
   itself; a deletion that mattered shows up as a failing or vanished test.
3. **Test count must stay 1291.** A deleted variable that silently removed a test case would show up
   here and nowhere else — this is the check that matters most for the six manual edits.
4. `npx biome ci .` — exit 0, with the three rules now at `error`.
5. `npm run build:playground && npm run e2e` — 11/11, for the `src/` half of the diff.
6. **Regression check on the ratchet itself**: temporarily add an unused import, confirm
   `biome ci` now **fails**, then remove it. A ratchet that does not bite is decoration.

Step 6 is the only one that tests what this change is actually for.
