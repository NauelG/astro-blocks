<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Reject backslash and protocol-relative redirect targets

Single vertical slice (one behaviour, one commit), executed with TDD discipline:
red tests first, minimal fix, then docs. Commit only at T5.

## T1 — Regression tests (red)

- [x] **Files:** `tests/redirects-utils.test.js`, `tests/redirects-handlers.test.js`
- New utils test: `validateRedirectPathInput` returns
  `{ errorKey: 'redirects.pathMustBeInternal', fieldKey: <field> }` for `/\evil.com`,
  `/\/evil.com`, `\\evil.com`, `//evil.com`, `///evil.com` — on both `from` and `to`; stays
  `null` for `/docs//intro` (interior `//` remains legit input).
- New handler test: `POST /cms/api/redirects` with `to: '/\\evil.com'` and with
  `to: '//evil.com'` → 400, `redirects.json` untouched.
- New read-filter test: hand-write `data/redirects.json` with a `/\evil.com` entry via `fs`,
  then `loadRedirects()` → entry absent from the result.
- Deliberate update: CRUD test input `to: '//new-path//'` → `to: '/new-path//'` (still pins
  trailing-slash normalization; the protocol-relative prefix is now invalid by design).
- **Verify:** `npm run build && npm test -- --test-name-pattern` shows the new tests **failing**
  (except the CRUD update, which still passes) — the bypass is reproduced against current code.

## T2 — Validator fix (green)

- [x] **File:** `src/utils/redirects.ts`
- In `validateRedirectPathInput`, replace the `ABSOLUTE_URL_REGEX` line with the combined
  off-origin check (absolute URL ‖ contains `\` ‖ starts with `//`), returning
  `redirects.pathMustBeInternal`, with the two-line browser-normalization comment from
  `design.md` §1. Check order: empty → off-origin → leading slash → query/fragment.
- No changes to `src/utils/slug.ts` or `normalizeRedirectPath`.
- **Verify:** `npm run typecheck` green; `npm test` fully green (T1 tests included).

## T3 — Glossary line

- [x] **File:** `docs/CONTEXT.md`
- Add to the glossary: *Redirect — an internal-only mapping from one site path to another;
  the target can never point off-origin.*
- **Verify:** the line reads as domain language (no implementation detail leaked).

## T4 — End-to-end verification

- [x] Playground smoke (`playgrounds/` basic): admin UI rejects `to: /\evil.com` with the
  must-be-internal message; a legit redirect still round-trips (create → visit `from` → 301 to
  `to`).
- [x] Hand-edit the playground's `data/redirects.json` with a `/\evil.com` entry: visiting its
  `from` yields 404, not an off-site redirect; the entry does not appear in the admin list.
- **Verify:** both checks observed; `npm run check` (if defined) / `npm run typecheck` +
  `npm test` green.

## T5 — Commit

- [x] Single commit: `fix(redirects): reject backslash and protocol-relative redirect targets`
  (T1 + T2 + T3), body summarizing the bypass and the internal-only policy, footer
  `Reviewed-by:` per repo policy. No version bump / CHANGELOG (only at close, on request).
- **Verify:** `git show --stat` touches only the four files above + this change dir.
