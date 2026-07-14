<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0014 — Test coverage via c8; browser-only controllers excluded

- **Status:** Draft — proposed (triaged from engram memory, awaiting review)
- **Date:** 2026-06-15
- **Source:** engram observation(s) #881, #885

## Context

The project wanted a trustworthy, regenerate-on-release coverage number for the README badge.
Node's built-in `--experimental-test-coverage` flag looked like the obvious choice but undercounts
badly at scale: across 46 test files it reported `handlers.js` at 13% and a total of 51.92%, which
turned out to be a broken cross-process aggregation rather than a real number. `monocart-coverage-reports`
was tried next but, in the version evaluated, collapsed the multi-process Node V8 dump down to a
single source file (`catchall.ts`) in the final report despite its filters correctly resolving 25
source files — also unusable.

A combined node + browser coverage number was attempted and deliberately abandoned: the browser
bundle's sourcemaps point at the installed npm package copy under `node_modules/@astroblocks/.../dist/*.js`
(different path and different granularity — `.js` vs `.ts`) while c8's node-side coverage maps back
to the repo's own `.ts` sources, so the two are not statement-mergeable without manual sourcemap
composition. A directory-based split (treat `routes/admin/client/*` as "browser, skip in node
metric") also isn't clean on its own, since at least one file in that area (`media-fetch.ts`) is
labeled "client" but is actually ~97% exercised by node tests.

## Decision

We will use c8 (`NODE_V8_COVERAGE` + `c8 report`) as the coverage engine, via `scripts/coverage.mjs`,
with results source-mapped back to `.ts`. The README badge is regenerated on every release via
`scripts/coverage-badge.mjs`, wired into the npm `version` hook. The badge's scope is deliberately
**not** a true combined node+browser number: it is c8's node:test coverage over the shipped/server +
util surface, with the browser-only admin client controllers explicitly excluded
(`dist/routes/admin/client/block-form.js`, `dist/routes/admin/client/common.js`) because node:test
cannot drive a DOM and those paths are instead exercised by the Playwright e2e suite. Files that are
nominally "client" but substantially node-tested (e.g. `media-fetch.ts`) are left in scope rather
than excluded by directory.

## Consequences

- The badge number is deterministic and reproducible from a single tool (c8), avoiding the
  undercounting and report-collapsing problems seen with `--experimental-test-coverage` and
  `monocart-coverage-reports`.
- The badge does not represent true combined server+browser coverage — it explicitly omits the two
  browser-only client controller files, which are covered by Playwright e2e instead. Anyone reading
  the badge as "total product coverage" would be misled without this context.
- `scripts/coverage.mjs` must keep the raw V8 dump directory outside c8's `outputDir`, or c8's clean
  step wipes it before the report can be generated.
- A future true combined merge remains possible (the installed package copy is byte-identical to the
  repo's own `dist` output, so a path-normalized istanbul-lib-coverage merge is feasible) but is not
  built; this was a deliberate scope cut, not an oversight.

## Evidence (current repo)

- `scripts/coverage.mjs` — header comment: "Runs the node:test suite under NODE_V8_COVERAGE and
  reports with c8"; spawns `node --test` with `NODE_V8_COVERAGE` set, then invokes `c8` for the
  report.
- `scripts/coverage.mjs` — exclude list passed to `c8`: `dist/**/*.map`,
  `dist/routes/admin/client/block-form.js`, `dist/routes/admin/client/common.js`, confirming the
  scoped-exclusion decision is live and matches the two named files (not a broader directory
  exclusion).
- `scripts/coverage-badge.mjs` — exists, generates the README badge from the c8 summary.
- `package.json` — `"coverage": "node scripts/coverage.mjs"`, `"coverage:badge": "node scripts/coverage-badge.mjs"`,
  and the `"version"` script chains `coverage.mjs --no-build` + `coverage-badge.mjs` before the
  README/screenshot regeneration, confirming the badge is refreshed on every release as described.
- Not independently re-verified in this pass: the current badge percentage value in `README.md` and
  whether it still matches 88.2% from the source (not required for this decision to hold; the
  mechanism, not the specific number, is what this ADR records).
