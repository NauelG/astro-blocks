<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Redirect target policy

> Living specification. Describes the current behavior of redirect path validation. Changed via the
> cycle's `spec-delta.md` mechanism (see `AGENTS.md`). History: inaugurated by change
> `redirect-backslash-bypass` (#123).

## Capability

Redirects map one site-internal path (`from`) to another (`to`) and are served by the injected
`[...slug]` route via `Astro.redirect`. Targets are **internal-only**: no stored redirect can ever
resolve off-origin, and every flow that touches redirect data validates through a single function.

## Requirements

- **R1 — Redirect targets are internal-only.** A redirect's `to` (and `from`) must be a
  site-internal pathname: leading `/`, no scheme, no query, no fragment. Absolute URLs
  (`http://`, `https://`) are rejected with `redirects.pathMustBeInternal`.
- **R2 — Off-origin shapes are rejected, never rewritten.** Any path containing `\` or starting
  with `//` is rejected with `redirects.pathMustBeInternal`. Browsers normalize `\` to `/` and
  resolve `//host` as protocol-relative, so these are external URLs in disguise; silently
  normalizing them would mask attack-shaped input. (External targets, if ever wanted, are an
  explicit feature — #128 — not a loosening of this rule.)
- **R3 — `validateRedirectPathInput` is the single choke point.** All redirect flows — API write
  (`handlers/redirects.ts`), restore/import and read (`data.ts:normalizeRedirect`), and serve
  (`loadRedirects` → `page.astro`) — validate through this one function. Entries that fail
  validation are dropped at read time, so invalid persisted data never reaches `Astro.redirect`
  and no data migration is ever needed. No duplicate guard exists at the emit site by design.
- **R4 — Regression coverage.** `tests/redirects-utils.test.js` pins the bypass vectors
  (`/\evil.com`, `/\/evil.com`, `\\evil.com`, `//evil.com`, `///evil.com`) as rejected and
  interior double slashes (`/docs//intro`) as accepted; `tests/redirects-handlers.test.js` pins
  the API 400 and the read-time filtering of a hand-persisted malicious entry.
