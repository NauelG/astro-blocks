<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0013 — Adopt Biome as a CI gate separate from tests

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-07-07
- **Source:** engram observation(s) #1959, #2004, #1978

> **Compliance note (2026-07-14).** Verified against the code. The decision holds: `npm run check`
> (`biome ci .`) is its own CI step in job `validate`, independent of `npm test`, and `e2e` needs
> `validate`. **But the gate is narrower than "`biome ci .`" reads.** `biome.json` `files.includes` is an
> allowlist (`src/`, `scripts/`, `tests/`, `e2e/`), so root configs, `playgrounds/` and `docs/` are out
> of scope; `!**/*.astro` leaves the several hundred lines of inline TypeScript in the admin `.astro`
> pages entirely unlinted — which is where the XSS in **#99** lives; and `!src/styles/**` excludes
> `cms-admin.css` (**#95**). None of this falsifies the Decision — it is about *where the gate runs*,
> not what it covers — but a reader will over-estimate the coverage.

## Context

The repo's `test` script (`npm run build && node --test tests/*.test.js`) exercises functional
correctness but says nothing about formatting or lint hygiene. Left implicit, that created a
recurring failure mode: a local run of build + tests + `tsc --noEmit` can be fully green while
`biome ci .` still fails in CI, because none of those commands check formatting.

Two documented incidents show why this is non-obvious rather than a theoretical risk. During the
`decompose-handlers` chain, PR #75 failed CI on two formatting errors in newly created files
(`utils/locale-projection.ts`, `tests/locale-projection.test.js`); apply/verify agents had run
build, tests, and typecheck — all green — but never `npm run check`. During
`consolidate-html-escapers`, an apply agent misreported a formatting failure in a new test file it
had just created as a "pre-existing" Biome warning; the failure was actually an **error** (exit 1)
surfaced only by `biome ci`, not by `biome check` or per-file lint, and was easy to miss because
77 warnings and 114 infos on `main` push a single error past the on-screen summary without naming
the offending file inline.

## Decision

We will run `npm run check` (`biome ci .`, per `package.json`) as its own step in CI
(`.github/workflows/ci-main.yml`, job `validate`), independent from the `test` script, which
deliberately does not invoke Biome. Any PR — including verbatim-move refactor PRs — must pass
`npm run build && node --test tests/*.test.js`, `npx tsc --noEmit`, **and** `npx biome ci .` before
being considered green; passing tests and typecheck alone is not sufficient. Format-only failures on
new files must be fixed with `npx biome format --write <file>`, not `biome check --write`, since
`check --write` also applies lint autofixes (e.g. `noPrototypeBuiltins` → `Object.hasOwn`) that would
silently change semantics — unacceptable for refactors meant to be verbatim moves.

> Reviewer note: the source describes this as `npm run check` running "as a SEPARATE job from
> `npm test`." That is not literally accurate in the current repo — `.github/workflows/ci-main.yml`
> defines a single job named `validate` whose steps run, in order, "Lint & format (Biome)"
> (`npm run check`), "Validate features catalog", "Typecheck", and "Run tests" (`npm test`). Biome
> and tests are separate **steps in the same job**, not separate GitHub Actions jobs — a step
> failure still fails the whole job and blocks the downstream `e2e` job (which `needs: validate`).
> The substantive decision the source is pointing at — Biome enforced as its own gate, not folded
> into the `test` script, so a green test run is not proof of a green Biome run — is confirmed
> correct; only the "separate job" wording should be read as "separate gate/step."

## Consequences

- Formatting/lint drift is caught deterministically in CI regardless of whether the test suite
  passes, closing the gap that caused two real incidents above.
- Contributors and coding agents must remember to run `npm run check` locally — not just tests and
  `tsc` — or risk a late CI failure; `npx biome ci <changed-files>` is the recommended way to
  isolate a hidden error in a noisy full run.
- Agents' self-reports of "Biome clean" must not be trusted without re-running `npm run check` and
  checking the exit code directly, since a single error can be missed in a run with dozens of
  warnings/infos.
- Baseline on `main` is 0 errors with ~77 warnings / 114 infos (`noPrototypeBuiltins`,
  `noDynamicNamespaceImportAccess`, etc. at warning severity) — these are acceptable and do not fail
  `biome ci`; only format violations and error-severity rules do.

## Evidence (current repo)

- `biome.json` — exists at repo root, confirming Biome is configured.
- `package.json` — `"check": "biome ci ."`; `"test": "npm run build && node --test tests/*.test.js"`
  (no Biome invocation in `test`).
- `.github/workflows/ci-main.yml` — job `validate` runs `npm run check` as the "Lint & format
  (Biome)" step before "Typecheck" and "Run tests" (`npm test`); job `e2e` declares
  `needs: validate`. Confirms Biome runs before tests and gates downstream work, but as a step
  within one job, not a separate job (see Reviewer note above).

See ADR-0012 for the decomposition work whose PR #75 first surfaced this gap in practice.
