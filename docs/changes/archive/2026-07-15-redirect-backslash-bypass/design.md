<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Reject backslash and protocol-relative redirect targets

## 1. The validator change (`src/utils/redirects.ts`)

One new check in `validateRedirectPathInput`, placed together with the existing absolute-URL
rejection so every off-origin shape yields the same error:

```ts
const ABSOLUTE_URL_REGEX = /^https?:\/\//i;

// ...inside validateRedirectPathInput, replacing the current ABSOLUTE_URL_REGEX line:

// Backslashes and protocol-relative prefixes are off-origin in disguise: browsers
// normalize "\" to "/", so "/\evil.com" and "//evil.com" both resolve to
// https://evil.com. Redirect targets are internal-only — reject, never rewrite.
if (ABSOLUTE_URL_REGEX.test(path) || path.includes('\\') || path.startsWith('//'))
  return { errorKey: 'redirects.pathMustBeInternal', fieldKey };
```

Check order (empty → off-origin shapes → leading slash → query/fragment) is chosen so that every
bypass grafia reports `pathMustBeInternal` — including `\\evil.com`, which today would die at
`pathMustStartSlash` with a less truthful message.

No change to `normalizePathname` (`slug.ts` stays generic, pages keep their collapse semantics)
and no change to `normalizeRedirectPath`.

## 2. Why the validator alone closes the stored data hole

All three flows pass through `validateRedirectPathInput`:

| Flow | Path |
|---|---|
| API write | `handlers/redirects.ts:27-34` — validates raw input before normalize+save |
| Restore / import / **read** | `data.ts:normalizeRedirect` (:136-137) — validates each stored entry, `loadRedirects` (:369-374) drops failures |
| Serve | `page.astro:21` loads via `loadRedirects` → filtered entries never reach `Astro.redirect` |

A malicious entry already persisted in `redirects.json` is therefore neutralized at read time with
no migration. This is the single-choke-point decision from grilling: the invariant lives in one
function; no emit-time guard.

## 3. Tests (TDD — written first, red, then the fix)

### `tests/redirects-utils.test.js` — new regression test

`validateRedirectPathInput` returns `{ errorKey: 'redirects.pathMustBeInternal', ... }` for every
vector, on both fields:

- `/\evil.com` (the reported bypass)
- `/\/evil.com`
- `\\evil.com`
- `//evil.com`
- `///evil.com`

And stays `null` for `/valid-path` (already pinned) — plus `/docs//intro` (interior `//` is not a
protocol-relative shape; normalization still collapses it).

### `tests/redirects-handlers.test.js`

- **New test**: `POST` with `to: '/\\evil.com'` and `to: '//evil.com'` → 400 with the
  `pathMustBeInternal` message; nothing persisted.
- **New test (read-time filtering)**: write a `redirects.json` containing a `/\evil.com` entry
  directly with `fs`, then `loadRedirects()` → entry absent.
- **Deliberate update**: the CRUD test (:50) posts `to: '//new-path//'` expecting silent collapse
  to `/new-path`. That input is now invalid by design — the test switches to `to: '/new-path//'`,
  which keeps exercising trailing-slash normalization without the protocol-relative prefix.

`normalizeRedirectPath('//docs///intro//') → '/docs/intro'` (utils test :18) stays untouched:
the function is unchanged; only pre-validation tightened.

## 4. Docs

- **`docs/CONTEXT.md`** — one glossary line: *Redirect — an internal-only mapping from one site
  path to another; the target can never point off-origin.*
- **`docs/specs/redirects.md`** — created at Archive from `spec-delta.md`.

## 5. Verification bar

1. `npm run typecheck` + `npm test` green.
2. Manual smoke in the playground: create a redirect with `to: /\evil.com` via the admin UI →
   validation error shown; create a legit redirect → still works end-to-end.
3. Direct check that a hand-edited malicious `redirects.json` entry no longer redirects (serve
   returns 404 instead of off-site 301).

No UI change → no README screenshots. `src/meta/features.json` reviewed at close per checklist.

## 6. Commit sequence

A single commit (test + fix land together, red→green within the commit):

1. `fix(redirects): reject backslash and protocol-relative redirect targets`
   — validator change, regression tests, handler-test update, `CONTEXT.md` glossary line.

Release bump + CHANGELOG happen only at close, on the human's request, per policy.
