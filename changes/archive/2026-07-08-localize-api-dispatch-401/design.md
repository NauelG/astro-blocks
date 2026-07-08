<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Localize the unauthenticated 401 body

> This change introduces **no new design decision**. It applies an existing, already-approved
> pattern (`localizedJsonError`) to two call sites for consistency. This document records the
> mechanism, the two non-obvious nuances, and the alternatives considered, so the reviewer has the
> full picture. No ADR is warranted (nothing here is non-obvious or reversible-costly).

## Mechanism

`localizedJsonError(request, key, status)` (`api/handlers/shared.ts`) resolves the request UI locale
(`resolveRequestUiLocale` → `cms-ui-locale` cookie → `Accept-Language` → English fallback), looks
the key up in the matching catalog, and returns `jsonError(message, status)` which serializes
`{ error: message }` with `Content-Type: application/json`. It is re-exported from the `api/handlers.ts`
shim, which `catchall.ts` already imports and already uses for the 404 sibling. So the change is a
one-to-one substitution at two sites — no new imports, no new helpers.

## Nuance 1 — info-hiding is preserved

`dispatch()` returns 401 (not 404) for an **unmatched path when unauthenticated**, on purpose: it
must not reveal whether a route exists to an unauthenticated caller. Because both 401 sites resolve
the **same** key (`errors.unauthorized`), they produce byte-identical bodies. Localizing them does
not create an oracle: "unknown path" and "known path, no auth" remain indistinguishable. The
authenticated unmatched-path case keeps returning the localized 404, unchanged.

## Nuance 2 — Content-Type correction (intended, minor)

The current raw responses `new Response(JSON.stringify(...), { status: 401 })` omit the
`Content-Type` header; `localizedJsonError`/`jsonError` add `application/json`. This aligns the 401
with every other API error response. It is a behavior change only in the header, harmless to clients
that parse by content, and desirable for correctness.

## Alternatives considered

- **Leave as-is.** Rejected — the whole point of #60 is removing the 401's inconsistency with 403/404.
- **A bespoke inline localized response** instead of `localizedJsonError`. Rejected — it would
  duplicate the resolver and diverge from the established pattern (`CONTEXT.md`: "bodyless/error
  responses go through the shared helpers"). The helper already does exactly this.
- **Centralize the 401 into the route-table layer.** Out of scope — that is a larger refactor of the
  auth ladder; #60 is a targeted body-localization only.

## Testing approach (TDD)

The dispatch-level 401 body is **not** covered today: `tests/i18n-api-errors.test.js` localizes only
`handleAuthMe`'s self-reported 401, not the `dispatch()` gate. TDD anchor:

1. Add a failing test asserting the `dispatch()` 401 body is localized for both sites and both
   locales (es → "No autorizado.", en → "Unauthorized.") — driven through the exported verb handlers,
   consistent with `tests/catchall-authz-routing.test.js`.
2. Apply the two-site substitution → test goes green.
3. Confirm `tests/catchall-authz-routing.test.js` (status-only asserts) stays green.
