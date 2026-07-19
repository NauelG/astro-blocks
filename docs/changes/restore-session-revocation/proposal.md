<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Restore is a session-revocation event

_Resolves [#134](https://github.com/NauelG/astro-blocks/issues/134) (P1, security). Follow-up to
[#124](https://github.com/NauelG/astro-blocks/issues/124) / ADR-0027. Grilled 2026-07-19._

## Problem

**Restoring a backup re-arms revoked JWTs.**

`tokenVersion` is the session-revocation counter (ADR-0027): the JWT carries `sub` +
`tokenVersion`, and `getAuth` rejects any token whose generation no longer matches the store
(`auth-core.ts:157`). `applyImport` writes the archive's user list straight through, unguarded:

```ts
// src/api/backup.ts:645
case 'users': {
  const raw = await fs.readFile(path.join(stagingDir, 'data', 'users.json'), 'utf-8');
  await data.saveUsers(JSON.parse(raw));
  break;
}
```

Replacing `users.json` wholesale lets the counter go **backwards**:

```
t0  store=1, token T is stolen (claim 1)
t1  password changed -> store=2 -> T rejected  ✅
t2  restore a backup taken at t0 -> store=1
t3  T works again, for the remainder of its 7-day lifetime
```

The password rollback is visible and is arguably what "restore" means. The session resurrection is
**invisible** — nobody expects restoring a backup to re-arm a stolen token. It is the #124
fail-open class returning through another door.

## Why this is a spec contradiction, not a gap

Both the ADR and the glossary describe the counter as **monotonic**:

- `docs/adr/0027-stateful-session-revocation.md:41` — *"a monotonic per-user counter"*
- `docs/CONTEXT.md:119` — *"A monotonic per-user session generation."*

A counter that rewinds is not a revocation primitive. Either the code upholds monotonicity or the
docs stop claiming it. This change upholds the code.

`session-auth.md`'s *Boundaries* section already tracks the contradiction honestly (*"monotonic in
normal operation, **not** across a restore — tracked in #134"*), left there by
`tokenversion-boundary-normalization`. This change closes it.

## Findings that reframe the issue

The issue offered two options. Grilling the code invalidated the first and shrank the cost of the
second.

**1. `max(current, restored)` is not a merge.** For a given id, `restored` can never exceed
`current`: ids are generated (`data.generateId()`), a deleted-then-recreated user gets a *different*
id, and the counter only ever rises. So `max()` reduces to *"keep the current value, discard the
archive's"* — a correct behaviour wearing an arithmetic disguise. It also leaves the
deleted-after-backup user uncovered: that record returns with no `current` to compare against, and
their old tokens revive.

**2. The authenticated restore does not hold the users lock.** `backup.ts:911` is
`opts.bootstrapMode ? data.withUsersLock(run) : run()` — only bootstrap acquires it. The issue's
note ("must run inside the users lock") describes an invariant that does not currently hold. And
`withUsersLock` is deliberately **non-reentrant** (`data.ts:318-326`), so wrapping the `case 'users'`
body would deadlock the bootstrap path.

**3. The cost of a global bump is smaller than the issue assumes.** `usersReplaced` already closes
the importing admin's session client-side (`import-export-editor.ts:355` →
`closeSessionAndRedirect()`). The blast radius is other users' live sessions only.

**4. The lock condition is safe to change.** There is no `await` between `_runImportPipelineCore`'s
entry and the `return` at line 911, so the SAME-MICROTASK INVARIANT of #25 survives — provided the
new condition is likewise computed synchronously from `opts`.

## Proposed change

Treat a restore of the `users` unit as a **security event**, not a data operation. Every restored
record leaves with a generation above anything either side has ever seen, so no pre-restore token
can match — including the deleted-then-resurrected user, whom a per-id comparison cannot reach.

1. **New store seam `data.restoreUsers()`.** Monotonicity is an invariant *of the store*, so it is
   defended at the store. `saveUsers` stays a plain writer; the restore path stops using it.
2. **`applyImport` calls `restoreUsers`**, and the pipeline acquires `withUsersLock` whenever the
   run can touch `users.json`.
3. **ADR-0028** records the decision; `CONTEXT.md` and `session-auth.md` stop claiming an
   unqualified monotonicity and name the second revocation trigger.

## Alternatives considered

- **`max(current, restored)` per id (issue option 1)** — rejected. Reduces to "keep current" (see
  finding 1) and cannot cover the deleted-then-restored user.
- **"Keep current" + a separate rule for absent ids** — rejected. Covers both cases without logging
  anyone out unnecessarily, but at the price of two rules, two code paths and a wider test surface,
  for an operation that is rare and already drastic.
- **Harden `saveUsers` itself** — rejected. Impossible to bypass by construction, but it turns a
  plain write into a read-modify-write for *every* caller (`users.ts`, `auth.ts`) that already holds
  the correct value in memory — cost and deadlock risk on every route, not just restore.
- **Make `withUsersLock` reentrant** — rejected. Would allow a minimal critical section, but
  contradicts the deliberate non-reentrancy documented at `data.ts:318-326`, and reentrant locks
  hide nesting bugs. Would need its own ADR.

## Consequences accepted

Restoring a backup that includes the `users` unit **signs everyone out**, every time, even when
nothing was compromised. That is the deliberate trade: one rule that is impossible to get subtly
wrong, over two rules that preserve convenience during an operation nobody performs casually.
