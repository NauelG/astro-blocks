<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Localize the unauthenticated 401 body

One vertical slice (the whole change is a two-site substitution guarded by one new test).
Executed straight-through with TDD discipline in the Implement phase. Mark each `[x]` as it lands.

Test note: this repo's tests import the **compiled** `dist/`, so every run is
`npm run build && node --test …` (per `CONTEXT.md` / ADR-0002).

## Slice 1 — Dispatch 401 body localization

- [x] **T0 — Branch.** Create `refactor/localize-api-dispatch-401` off `main` (currently on `main`;
      never commit the change straight to the default branch).
      - Verify: `git rev-parse --abbrev-ref HEAD` → `refactor/localize-api-dispatch-401`.

- [x] **T1 — RED: failing test for the localized dispatch 401.**
      - File: `tests/i18n-api-errors.test.js` — add a section "dispatch 401 localization" driving the
        catchall verb exports (`dist/routes/api/catchall.js`), unauthenticated (no token):
        - matched route (`PUT /cms/api/site`), `Accept-Language: es` → `status 401`, `body.error === "No autorizado."`
        - same, `Accept-Language: en` (or no header) → `body.error === "Unauthorized."`
        - unmatched path (`GET /cms/api/does-not-exist`), `es` → `status 401`, `body.error === "No autorizado."`
          (proves R4 info-hiding + R6 body-stable)
      - Also assert `Content-Type` is `application/json` on the 401.
      - Verify: `npm run build && node --test tests/i18n-api-errors.test.js` → new cases FAIL
        (current body is `{error:"Unauthorized"}`, no Content-Type), pre-existing cases still pass.

- [x] **T2 — GREEN: substitute both 401 sites.**
      - File: `routes/api/catchall.ts` — replace the two
        `new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })` at L57 (unmatched-path
        unauthenticated) and L67 (matched-route unauthenticated) with
        `localizedJsonError(request, 'errors.unauthorized', 401)`. `localizedJsonError` is already imported
        (L24); `request` is in scope in `dispatch()`.
      - Verify: `npm run build && node --test tests/i18n-api-errors.test.js` → new cases GREEN.

- [x] **T3 — Refactor + full gate.**
      - No structural refactor expected (2-line change). Confirm no dead code / no other hardcoded
        `"Unauthorized"` bodies remain in `routes/` or `api/` (grep).
      - Verify (all exit 0):
        - `npm run build && node --test tests/*.test.js` — full suite green, especially
          `tests/catchall-authz-routing.test.js` (status-only asserts, must stay green).
        - `npx tsc --noEmit`
        - `npx biome ci .` (if the changed test file trips a format error, `npx biome format --write`
          it — never `biome check --write`, per ADR-0013).

- [x] **T4 — Commit (dev commit, no version bump).**
      - Conventional Commit, English, with `Reviewed-by: Nauel Gómez <ngomez@codiara.com>` footer; no
        agent/bot trailers. Message:
        `refactor(api): localize the unauthenticated 401 body in the CMS API dispatch (#60)`
      - No `package.json`/`CHANGELOG` bump here — versioning happens only at the explicit close/release
        gate the human triggers (per `AGENTS.md` › Versionado).
      - Verify: `git log --oneline -1` shows the commit on the feature branch; working tree clean.

## Out of this slice (deferred)

- Push + open PR for #60 — a "close" action; only on explicit request.
- Version bump / `CHANGELOG` entry — only at the release gate.
- `specs/` inauguration write — happens in the **Archive** phase from `spec-delta.md`, not here.
