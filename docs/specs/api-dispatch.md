<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — CMS API dispatch & auth ladder

> Living specification. Describes the current behavior of the CMS REST entry point. Changed via the
> cycle's `spec-delta.md` mechanism (see `AGENTS.md`). History: inaugurated by change
> `localize-api-dispatch-401` (#60).

## Capability

All CMS REST traffic enters through one injected catchall (`src/routes/api/catchall.ts`) whose five
per-verb exports (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) delegate to a single `dispatch()`. Requests
are matched against the route table (`src/api/route-table.ts` + `src/api/route-matcher.ts`); each route
declares an auth tier: `public`, `user`, or `owner`.

## Requirements

- **R1 — Route matching.** `dispatch()` strips the `/cms/api` prefix, matches `(method, segments)`
  against the route table, and either resolves a `{ descriptor, params }` or no match.
- **R2 — Public tier.** A matched `public` route runs its handler unconditionally (no auth required),
  receiving `user: auth?.user ?? null`.
- **R3 — Auth ladder.** For a matched non-public route:
  - unauthenticated → **401** with a **localized** body `{ error }`.
  - authenticated but `owner`-tier and caller is not the owner → **403** (localized, via `requireOwner`).
  - otherwise → the handler runs with the resolved `user`.
- **R4 — Unmatched path (info-hiding).** An unmatched path returns:
  - **401** (localized) when the caller is unauthenticated — deliberately **not** 404, so route
    existence is not disclosed to anonymous callers.
  - **404** (localized, `errors.notFound`) when the caller is authenticated.
- **R5 — Localized error bodies.** All 401/403/404 responses use `localizedJsonError`, which resolves
  the request UI locale (`cms-ui-locale` cookie → `Accept-Language` → English fallback), preserves the
  `{ error: string }` wire shape, and sets `Content-Type: application/json`. The 401 uses the
  `errors.unauthorized` key (en: "Unauthorized.", es: "No autorizado.").
- **R6 — Info-hiding is body-stable.** The unmatched-unauthenticated 401 (R4) and the matched-route
  unauthenticated 401 (R3) return byte-identical bodies (same `errors.unauthorized` key), so the two
  cases are indistinguishable to an anonymous caller.

## Scenarios

- Unauthenticated `PUT /cms/api/site` with `Accept-Language: es` → 401, `{ error: "No autorizado." }`.
- Unauthenticated `PUT /cms/api/site`, no locale requested → 401, `{ error: "Unauthorized." }`.
- Unauthenticated `GET /cms/api/does-not-exist` → 401 (never 404), body localized and identical to the
  matched-route 401 for the same locale.
- Authenticated non-owner `GET /cms/api/users` → 403 (localized).
- Authenticated `GET /cms/api/does-not-exist` → 404 (`errors.notFound`, localized).

## Coverage

- `tests/catchall-authz-routing.test.js` — the 401→403→404 status ladder across every auth tier.
- `tests/catchall-401-localization.test.js` — R3/R4/R5/R6 localized-body behavior (#60).
