<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Reject backslash and protocol-relative redirect targets

## ADDED: Redirect target policy (`redirects.md`, new spec)

First living spec for redirects. Requirements:

> **R1 — Redirect targets are internal-only.** A redirect's `to` (and `from`) must be a
> site-internal pathname: leading `/`, no scheme, no query, no fragment. Absolute URLs
> (`http://`, `https://`) are rejected with `redirects.pathMustBeInternal`.
>
> **R2 — Off-origin shapes are rejected, never rewritten.** Any path containing `\` or starting
> with `//` is rejected with `redirects.pathMustBeInternal`. Browsers normalize `\` to `/` and
> resolve `//host` as protocol-relative, so these are external URLs in disguise; silently
> normalizing them would mask attack-shaped input. (External targets, if ever wanted, are an
> explicit feature — #128 — not a loosening of this rule.)
>
> **R3 — `validateRedirectPathInput` is the single choke point.** All redirect flows — API write
> (`handlers/redirects.ts`), restore/import and read (`data.ts:normalizeRedirect`), and serve
> (`loadRedirects` → `page.astro`) — validate through this one function. Entries that fail
> validation are dropped at read time, so invalid persisted data never reaches `Astro.redirect`
> and no data migration is ever needed. No duplicate guard exists at the emit site by design.
>
> **R4 — Regression coverage.** `tests/redirects-utils.test.js` pins the bypass vectors
> (`/\evil.com`, `/\/evil.com`, `\\evil.com`, `//evil.com`, `///evil.com`) as rejected and
> interior double slashes (`/docs//intro`) as accepted; `tests/redirects-handlers.test.js` pins
> the API 400 and the read-time filtering of a hand-persisted malicious entry.

## No other behavioural delta

- `normalizePathname` / `normalizeRedirectPath` semantics are unchanged; only pre-validation
  tightened.
- Matching (`findRedirectByPath`), status codes, and the admin editor flow are untouched.

## Consequence for Archive

1. Create `docs/specs/redirects.md` from the ADDED section above.
2. Add the glossary line to `docs/CONTEXT.md` if not already landed with the fix commit.
3. Move `docs/changes/redirect-backslash-bypass/` → `docs/changes/archive/<date>-redirect-backslash-bypass/`.
4. No ADR to leave in place — this change creates none.
