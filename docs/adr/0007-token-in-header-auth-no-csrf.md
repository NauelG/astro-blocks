<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0007 — Token-in-header JWT auth model (no CSRF surface)

- **Status:** Draft — proposed (triaged from engram memory, awaiting review)
- **Date:** 2026-06-30
- **Source:** engram observation #1865

## Context

An automated commit security review flagged a HIGH/CSRF finding on a change that switched the media upload/replace transport to a non-form `Content-Type` plus `request.arrayBuffer()`, reasoning that this "bypasses" Astro's origin-check middleware. Read at face value, that framing implies a security control was defeated.

The non-obvious part: CSRF as an attack class depends on the browser silently attaching *ambient* credentials (cookies, HTTP auth) to a cross-origin request forged by an attacker's page. The CMS API does not use ambient credentials for authorization — it authenticates exclusively via a JWT carried in a header the browser will never auto-attach cross-origin. Once that is true, "bypassing an origin-check middleware" is not a vulnerability, because origin-check exists specifically to compensate for ambient-credential auth, which this API doesn't have. Astro's origin-check was never the effective CSRF defense for this header-authenticated surface, so routing around it removes no protection.

## Decision

We will keep (and rely on) token-in-header authentication as the sole auth mechanism for the CMS API, and treat the CSRF finding on the upload/replace endpoints as a false positive rather than a defect to fix by re-introducing cookie/origin-based defenses.

Concretely:
- `getAuth()` (`api/handlers/auth-core.ts`) reads the JWT only from the `Authorization: Bearer` header or the `x-cms-token` header — never from a cookie.
- The one cookie the API reads (`api/handlers/shared.ts`, resolving UI locale) carries no authorization semantics and is not consulted by `getAuth()`.
- Upload/replace use a non-form `Content-Type` (raw binary via `request.arrayBuffer()`) plus a custom `x-cms-filename` header; this additionally forces a CORS preflight the server never answers cross-origin, so cross-origin requests never reach the handler at all.
- The previously misleading inline comment ("bypasses Astro's CSRF origin-check middleware") has been reworded to explain the actual safety reasoning (header-based JWT auth = no CSRF surface) instead of framing it as circumventing a control.

## Consequences

- Easier: no origin-check/CSRF-token plumbing is needed for the CMS API; any client that can send arbitrary headers (SPA admin, CLI, tests) can call the API without extra ceremony.
- Harder / must watch: this reasoning is only valid as long as NO endpoint accepts the JWT from a cookie or any other ambient-credential channel. If a future change adds cookie-based session auth (e.g., for SSR convenience), the CSRF-is-a-non-issue conclusion no longer holds for that path and origin-check or CSRF tokens would need to come back for it specifically.
- Reviewers unfamiliar with the token-in-header rationale may re-flag this pattern; this ADR exists so the reasoning doesn't have to be re-derived each time. Per the source memory's lesson: always verify the auth mechanism (cookie vs. header token) before accepting *or* dismissing a CSRF finding — it is the deciding factor.

## Evidence (current repo)

- `api/handlers/auth-core.ts` (`getAuth`, ~line 127) — reads the token only from the `authorization` header (stripping a `Bearer ` prefix) or the `x-cms-token` header; returns `null` if neither is present. No cookie read.
- `api/handlers/shared.ts` (~line 14-19) — the only cookie read in the handler layer is for UI-locale resolution (`cookie: request.headers.get('cookie')`), unrelated to authorization.
- `api/handlers/media.ts` (~line 84-94, `handleUpload`) — inline comment now states the header-token/no-CSRF-surface reasoning directly (rewording from the source finding has already landed); `request.arrayBuffer()` reads the raw binary body.
- `routes/api/catchall.ts` — the central `dispatch()` calls `handlers.getAuth(request)` once per request and gates every route through it; there is exactly one code path to any handler and it always goes through this header-based auth resolution (see ADR-0009 for the broader dispatch/route-table context, which post-dates this specific source memory's file layout).

> Reviewer note: the source memory (obs #1865) cites `api/handlers.ts:685-689` and `api/handlers.ts:65` for `getAuth` and the cookie read. Since that memory was recorded, the codebase went through a handler-extraction refactor (`api/handlers.ts` is now "a pure shim" per recent commit history) — `getAuth` now lives in `api/handlers/auth-core.ts` and the locale cookie read lives in `api/handlers/shared.ts`. The underlying decision and behavior are unchanged and verified live in the new locations; only the file path is stale.
