<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Localize the unauthenticated 401 body in the CMS API dispatch

- **Issue:** #60 (`enhancement`, `P3`, `refactor`)
- **Status:** Proposed
- **Slug:** `localize-api-dispatch-401`

## Problem

The central API dispatcher (`routes/api/catchall.ts`, introduced in #59) returns a plain,
non-localized body for unauthenticated requests: `{ error: "Unauthorized" }`. Its sibling
responses in the same `dispatch()` function are already localized:

- **403** → `requireOwner(...)` → `localizedJsonError`
- **404** → `localizedJsonError(request, "errors.notFound", 404)`

So the **401** is the odd one out. This is not a regression — #59 deliberately preserved the
plain 401 to keep the route-table refactor behavior-equivalent (identical status codes across all
43 routes). #60 is the intentionally deferred consistency follow-up.

## Proposed change

Replace the **two** hardcoded 401 responses in `dispatch()` with the existing localized pattern:

```ts
// before
return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
// after
return localizedJsonError(request, 'errors.unauthorized', 401);
```

Both call sites (`routes/api/catchall.ts` L57 and L67) are affected:

- **L57** — unmatched path + unauthenticated → 401 (info-hiding: never 404, so route existence is
  not leaked).
- **L67** — matched route that requires auth, no session → 401.

The `errors.unauthorized` i18n key already exists in both catalogs
(`routes/admin/i18n/en.ts` → "Unauthorized.", `routes/admin/i18n/es.ts` → "No autorizado."), and
`localizedJsonError` already preserves the `{ error: string }` wire shape, so no new key, catalog
entry, or response shape is introduced.

## Consequences (summary — see `design.md`)

- Both 401 bodies become locale-aware (resolved from the request, like 403/404).
- Info-hiding is preserved: both sites return the **same** localized body, so an unauthenticated
  caller still cannot distinguish "route exists" from "route does not exist".
- Side effect: `localizedJsonError` also sets `Content-Type: application/json`, which the raw 401
  responses currently omit — a small, desirable correction.
- HTTP **status is unchanged (401)**, so the 43 router-level authz tests (which assert status only)
  stay green.

## No-goals

- No change to status codes, the auth ladder, or route matching.
- No new i18n keys or catalogs.
- No change to `handleAuthMe`'s self-reported 401 (already localized and separately tested).
- No ADR: this applies an existing pattern for consistency; it is not a non-obvious decision.
