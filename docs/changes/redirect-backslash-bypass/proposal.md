<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Reject backslash and protocol-relative redirect targets

_Issue: [#123](https://github.com/NauelG/astro-blocks/issues/123) (P1, security). Grilled 2026-07-15._

## Problem

Redirect targets are internal-only by policy (`redirects.pathMustBeInternal`), but the validator
only rejects `^https?://`, a missing leading `/`, and `?`/`#`. Two bypass shapes survive:

- **Backslash**: a `to` of `/\evil.com` passes `validateRedirectPathInput`
  (`src/utils/redirects.ts:31-45`) and survives `normalizePathname`
  (`src/utils/slug.ts:15-23`, collapses forward slashes only) intact. `page.astro:88-89` emits it
  raw into `Astro.redirect`; browsers normalize `/\` to `//`, producing a **protocol-relative
  off-site redirect**. Stored, persistent, and served to unauthenticated public visitors. Any
  low-privilege CMS user (`auth: 'user'`, `src/api/route-table.ts:235`) can plant it.
- **Leading double slash**: a raw `to` of `//evil.com` passes validation and is only neutralized
  because `normalizePathname` happens to collapse it to `/evil.com` — a **silent rewrite** of an
  attack-shaped input, dependent on a generic slug helper that redirects do not own.

## Proposal

Harden `validateRedirectPathInput` — the single choke point all three redirect paths flow through
(API write via `handlers/redirects.ts`, restore/import and read via `data.ts:normalizeRedirect`,
serve via `loadRedirects` → `page.astro`):

1. **Reject any path containing `\`**, on both `from` and `to`. A backslash has no legitimate use
   in an internal path; a `from` containing one is unmatchable dead data.
2. **Reject any path starting with `//`** (protocol-relative shape), instead of relying on
   `normalizePathname`'s collapse. The invariant "no stored redirect can resolve off-origin"
   becomes self-contained in the validator.
3. Both rejections reuse the existing **`redirects.pathMustBeInternal`** error key — semantically
   exact, zero new i18n surface.

Because `loadRedirects` runs every stored entry through `normalizeRedirect`, which calls this
validator, **already-persisted malicious entries are filtered out at read time** — no migration,
consistent with the repo's no-fallback policy.

## Observable behaviour changes

- Inputs containing `\` (anywhere) are rejected with a validation error; previously stored/emitted.
- Inputs with a leading `//` (e.g. `//new-path//`) are rejected; previously silently collapsed to
  `/new-path`. The existing handler CRUD test pins that old behaviour and is updated deliberately.
- Stored entries with either shape disappear from reads (and thus from the admin list and serving).

## Out of scope

- **External redirect targets** — captured as an explicit future feature in
  [#128](https://github.com/NauelG/astro-blocks/issues/128); this fix keeps the internal-only policy.
- Defense-in-depth guard at the `page.astro` emit — rejected at grilling: dead code by
  construction once the choke point rejects, and it would split ownership of the invariant.
- Session revocation (#124) and the rest of the security backlog.

## Consequences

- First living spec for redirects: `docs/specs/redirects.md` (see `spec-delta.md`).
- One new glossary line in `docs/CONTEXT.md` (Redirect — internal-only).
- No ADR — cheap to reverse (reversal is #128's own cycle), explainable in a two-line code comment.
- Release: no bump during development; at close, `patch` + `### Fixed` entry (security fix).
