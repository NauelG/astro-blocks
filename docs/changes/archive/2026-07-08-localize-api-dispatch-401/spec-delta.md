<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Localize the unauthenticated 401 body

`specs/` does not exist yet; this change **inaugurates** it. The `ADDED` section below is the first
living spec (`specs/api-dispatch.md`) and describes the auth ladder in its **post-#60** state — at
Archive it is written verbatim into `specs/`. The `MODIFIED` section records the specific transition
#60 introduces relative to the pre-#60 (post-#59) behavior.

---

## ADDED: `specs/api-dispatch.md` — CMS API dispatch & auth ladder

**Capability.** All CMS REST traffic enters through one injected catchall
(`routes/api/catchall.ts`) whose five per-verb exports delegate to a single `dispatch()`. Requests
are matched against the route table (`api/route-table.ts` + `api/route-matcher.ts`); each route
declares an auth tier: `public`, `user`, or `owner`.

**Requirements.**

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
  `{ error: string }` wire shape, and sets `Content-Type: application/json`.
- **R6 — Info-hiding is body-stable.** The unmatched-unauthenticated 401 (R4) and the matched-route
  unauthenticated 401 (R3) return byte-identical bodies (same `errors.unauthorized` key), so the two
  cases are indistinguishable to an anonymous caller.

**Scenarios.**

- Unauthenticated `PUT /cms/api/site` with `Accept-Language: es` → 401, body `{ error: "No autorizado." }`.
- Unauthenticated `GET /cms/api/does-not-exist` → 401 (never 404), body localized, indistinguishable
  from R3's 401.
- Authenticated non-owner `GET /cms/api/users` → 403 (localized).
- Authenticated `GET /cms/api/does-not-exist` → 404 (`errors.notFound`, localized).

---

## MODIFIED: unauthenticated 401 response body

**Before (#59 baseline):** both 401 sites in `dispatch()` returned a raw, non-localized body
`{ error: "Unauthorized" }` with no `Content-Type` header — inconsistent with the already-localized
403 and 404 siblings.

**After (#60):** both sites return `localizedJsonError(request, "errors.unauthorized", 401)` →
locale-aware `{ error }` body plus `Content-Type: application/json`. Status (401) unchanged; the auth
ladder and route matching are unchanged. Satisfies R3, R4, R5, R6 above.

---

## REMOVED

_None._
