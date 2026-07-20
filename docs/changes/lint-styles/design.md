<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Bring `src/styles/` under the Biome gate

## 1. `biome.json`

```diff
   "files": {
     "includes": [
       "src/**",
       "scripts/**",
       "tests/**",
       "e2e/**",
       "!**/*.astro",
-      "!src/styles/**",
       "!**/dist"
     ]
   },
+  "overrides": [
+    {
+      "includes": ["src/styles/**"],
+      "linter": {
+        "rules": {
+          "complexity": {
+            "noImportantStyles": "off"
+          }
+        }
+      }
+    }
+  ],
```

`!**/*.astro` stays — that is #107 / #66, deliberately not bundled here.

The override is scoped to `src/styles/**` rather than set globally. Today the two are equivalent
(one stylesheet), but the justification is specific to the admin sheet: it loads after Pico CSS so
its overrides win (`DESIGN.md` §1), and `noImportantStyles` assumes the author owns the whole
cascade. A rule disabled project-wide is one whose reason nobody remembers.

JSON has no comments, so the reason lives in `DESIGN.md` and in this change's ADR-free record here —
the config carries the scope, the docs carry the why.

## 2. The format pass

```
npx biome format --write src/styles/cms-admin.css
```

**`format --write`, not `check --write`.** ADR-0013 records why: `check --write` also applies lint
autofixes, which for CSS could reorder or rewrite declarations. Whitespace is the only intended
change.

Expected: ~88 lines touched, and one corresponding change in `dist/styles/cms-admin.css` after a
build. The `dist` delta must be exactly that one file.

Biome's CSS formatter does slightly more than whitespace, and the diff was audited exhaustively to
confirm each transformation is inert: line splitting, `content: ''` → `""` (1 occurrence, same empty
string) and hex colours lowercased (4 occurrences, hex is case-insensitive). Stripping whitespace and
normalising those two leaves the before and after **byte-identical**.

## 3. What the warnings become

| Rule | Before | After | Why |
| --- | --- | --- | --- |
| format error | 1 | 0 | fixed by the format pass |
| `noImportantStyles` | 38 | 0 | silenced with a scoped, documented override |
| `noDescendingSpecificity` | 8 | 8 | **kept visible** — real signal about cascade order |

Repo warning baseline moves from **62 to 69** (measured, not quoted from ADR-0013, whose ~77 has drifted): +8 from the CSS, −1 from `useBiomeIgnoreFolder`, which Biome raised about the removed exclusion itself.

## 4. Verification: computed styles, before and after

The claim under test is "not a single computed style changed". Screenshots cannot express that, so
the check reads the same quantity the claim is about.

A throwaway Playwright spec (scratchpad, never `e2e/`) logs into the admin, visits every admin route,
and for every element dumps a stable subset of `getComputedStyle` — enough to catch a cascade change,
not so much that the diff drowns in noise:

```ts
const P = ['display','position','top','left','width','height','margin','padding',
           'color','background-color','border','font-size','font-weight','gap',
           'flex-direction','align-items','justify-content','z-index','overflow'];
Array.from(document.querySelectorAll('*')).map((el, i) => {
  const cs = getComputedStyle(el);
  return `${i}|${el.tagName}.${(el.className||'').toString().split(' ')[0]}|`
       + P.map(p => cs.getPropertyValue(p)).join(',');
});
```

Run once before the format pass, once after, diff the two dumps. **Target: zero differing
elements.** Any difference is a real finding and stops the change.

Element identity is index + tag + first class, which is stable because the format pass cannot alter
the DOM. If the counts differ between runs, the comparison is invalid and must be fixed before the
result means anything — a lesson from the #138 probe, where an unscoped selector silently measured
the wrong element.

## 5. Not touched

- **`docs/adr/0013-biome-ci-gate.md`** — immutable. Its baseline figure is a statement about the
  moment it was written.
- **`!**/*.astro`** — #107 / #66.
- **The 8 `noDescendingSpecificity` warnings** — left for whoever picks up #65, with a comment there
  noting the count moved.
- **`src/meta/features.json`** — already linted, already passing.
