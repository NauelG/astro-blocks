<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0015 — Bootstrap import = full restore, gated only by zero-users

- **Status:** Accepted — verified against the code on 2026-07-14
- **Date:** 2026-06-30
- **Source:** engram observation(s) #1857, #1889

## Context

Bootstrap import is the unauthenticated import path reachable from the login screen only when the
instance has no users yet. The open product question was scope: should this path restore only the
`users` unit, or accept a full backup zip containing any combination of units (pages, media,
configuration, users, global blocks)? Restricting it to users-only would make the feature nearly
useless for its real purpose — seeding a brand-new instance from a complete migration backup.

The non-obvious risk is not the scope decision itself but its concurrency implications: the
zero-user check is the *only* thing standing between an anonymous caller and a full data restore.
If that check runs outside the shared import lock, two concurrent bootstrap POSTs can both observe
`users.length === 0`, both pass the gate, and both apply their archives — the second overwriting an
instance a moment after it was seeded. A naive "check once, then run the pipeline" implementation is
vulnerable to exactly this TOCTOU race, and a dual blind review flagged it as critical.

## Decision

We will let bootstrap import perform a full restore: `handleBootstrapImport`
(`api/handlers/backup-routes.ts`) runs the same shared pipeline
(`runImportPipeline` / `_runImportPipelineCore` in `api/backup.ts`) used by the authenticated import
path — same validation, ceilings, checksum, path guards, backup snapshot, and atomic apply — for any
combination of units present in the zip. The only differentiator from the authenticated path is the
auth gate: bootstrap import is reachable without authentication solely because
`users.length === 0`, checked before the request body is read at all. If the imported zip includes a
`users` unit, the instance leaves bootstrap state; otherwise it stays in bootstrap state and remains
reachable via this path.

To close the TOCTOU race, `_runImportPipelineCore` accepts a `bootstrapMode` flag. When true, it
acquires `data.withUsersLock` around the **entire** pipeline run (not just the users-file write) and
re-checks `users.length === 0` **inside** that lock immediately after acquiring it, aborting with
`errorCode: 'bootstrap-users-exist'` (mapped to a 403 by the handler) if the recheck fails. This
closes the "two concurrent bootstrap POSTs" race that the outer, unlocked gate could not.

## Consequences

- A single import pipeline serves both the authenticated and bootstrap paths — no duplicated
  validation/apply logic to keep in sync.
- The bootstrap surface remains public and security-critical by design: the zero-user gate is the
  only protection, and correctness depends on it running before any request-body access, and the
  in-lock recheck running before the pipeline actually applies anything.
- The source (#1889) flagged a residual narrow window as deferred future hardening: if
  `handleLogin`'s user-save completed *during* archive extraction — after the in-lock recheck but
  before `applyImport` — the bootstrap pipeline could still apply on a no-longer-empty instance,
  because at that time only the bootstrap side held the lock.

> Reviewer note: this residual window has since been closed in the current repo, beyond what the
> source describes. `api/handlers/auth.ts`'s first-login/owner-creation path now also acquires
> `data.withUsersLock` before saving the new user (comment references "GitHub #25"), and
> `api/backup.ts` comments (around the `applyImport`/`ImportPipelineOptions` definitions) confirm the
> held lock now spans the entire bootstrap pipeline run specifically "for the login-vs-bootstrap race
> (GitHub #25, closed via withUsersLock)." So both sides of the race are now serialized through the
> same mutex; the deferred hardening from #1889 appears to have already been done, not merely
> planned.

> Reviewer note: the source's file:line anchors (`api/handlers.ts:1412`, `~1915`, `catchall.ts:78`)
> predate both the handlers decomposition (see ADR-0012) and a separate route-table-auth-gating
> refactor referenced in code comments as "ADR-5" (not part of this `adr/` set). The underlying
> "runs before auth" property still holds, but is now expressed differently: the bootstrap route is
> declared `auth: 'public'` in `api/route-table.ts` (`pattern: 'import/bootstrap'`), and
> `routes/api/catchall.ts` dispatches `auth: 'public'` descriptors before its generic
> `if (!auth) return 401` check — rather than via a special-cased branch physically preceding an
> `ensureAuth()` call.

## Evidence (current repo)

- `api/handlers/backup-routes.ts` — `handleBootstrapImport`: loads users and returns 403 if
  `users.length !== 0` before reading the request body; passes `bootstrapMode: true` into
  `runImportPipeline`.
- `api/backup.ts` — `ImportPipelineOptions.bootstrapMode?: boolean`; `_runImportPipelineCore`
  re-checks `users.length === 0` inside the lock when `bootstrapMode` is set and returns
  `opts.bootstrapMode ? data.withUsersLock(run) : run()`.
- `api/route-table.ts` — route with `pattern: 'import/bootstrap'` declares `auth: 'public'`.
- `routes/api/catchall.ts` — the `auth === 'public'` branch returns the handler's result before the
  generic `if (!auth) return 401` gate later in the function, confirming bootstrap import still runs
  pre-auth under the current routing architecture.
- `api/handlers/auth.ts` — first-login path wraps user creation in `data.withUsersLock`, referencing
  "GitHub #25" — the mechanism that, per repo comments, closes the residual race noted in the source.

See ADR-0012 for the handlers decomposition that relocated `handleBootstrapImport` out of the
monolithic `api/handlers.ts` referenced by the source observations.
