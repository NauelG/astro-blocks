<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0028 — Restore is a session-revocation event

- **Status:** Accepted — 2026-07-19
- **Date:** 2026-07-19
- **Decisores:** Nauel Gómez
- **Source:** Issue [#134](https://github.com/NauelG/astro-blocks/issues/134) (P1, security), grilled 2026-07-19
- **Relación:** extiende ADR-0027 (no lo reemplaza) — añade un segundo disparador de revocación.

## Contexto

ADR-0027 made `getAuth` stateful and expressed revocation as a per-user counter, `tokenVersion`,
which it described as **monotonic**. `docs/CONTEXT.md` repeated the claim. The property was never
enforced anywhere: it was an emergent consequence of the only writer that touched the counter
(`handlePutUser`, `+ 1` on password change) happening to move it in one direction.

`applyImport` is a second writer, and it moves it in both. Restoring a backup replaces `users.json`
wholesale (`backup.ts:645`), so the archive's generations overwrite the store's:

```
t0  store=1, token T is stolen (claim 1)
t1  password changed -> store=2 -> T rejected
t2  restore a backup taken at t0 -> store=1
t3  T works again, for the remainder of its 7-day lifetime
```

The password rollback is visible and is what "restore" means. The session resurrection is invisible.
It is the #124 fail-open class — an authorization decision driven by a value that can go stale —
re-entering through a door nobody was watching.

A counter that rewinds is not a revocation primitive. The contradiction had to be resolved on one
side or the other: enforce the invariant, or delete the word "monotonic" from the docs.

The narrower fix proposed at triage, a per-id `max(current, restored)`, does not survive contact
with the domain. Ids are generated and a recreated user gets a new one, so for a given id `restored`
can never exceed `current` — `max()` reduces to *"keep the current value"*. It also cannot reach the
case that matters most: a user **deleted after the backup** returns with no current record to
compare against, and every token they ever held revives.

## Decisión

**Restoring the `users` unit is a session-revocation event, not a data operation.** Live sessions
are not restorable state.

Concretely:

- A new store seam, **`data.restoreUsers()`**, is the sole writer of a restored user list. It reads
  the current store, computes a **high-water mark** over the current and archived generations
  combined, and writes every restored record at `highWater + 1`. `saveUsers` stays a plain writer
  and the restore path no longer calls it.
- Archived generations are **normalized before** they are compared (ADR-0027's
  `normalizeTokenVersion`), so a malformed value in an uploaded archive cannot inflate the mark.
- The invariant lives at the **store boundary**, not in the backup pipeline — the same reasoning
  that moved the `tokenVersion` default into `loadUsers`. A future code path that writes a user list
  wholesale cannot silently reopen the hole.
- The import pipeline holds **`withUsersLock`** for any run that can write `users.json` (bootstrap;
  a selection naming the unit; a selection not yet resolved from the manifest). The computation is a
  read-modify-write and previously ran unlocked on the authenticated path. The condition is
  evaluated synchronously from `opts` to preserve the same-microtask invariant of #25.
- **Rollback from a pre-apply snapshot is not a restore** and deliberately bypasses `restoreUsers`.
  It returns the store to the state it was already in and resurrects nothing; bumping generations
  there would sign everyone out because an import *failed*.

## Alternativas consideradas

1. **Per-id `max(current, restored)`** — rejected: reduces to "keep current" (ids are generated), and
   leaves the deleted-then-resurrected user uncovered.
2. **"Keep current" plus a separate rule for ids absent from the store** — rejected. It covers both
   cases and signs nobody out unnecessarily, but buys that convenience with two rules, two code paths
   and a wider test surface, on an operation that is rare and already drastic. One rule that cannot
   be subtly wrong is worth more here than one that is kinder in the common case.
3. **Harden `saveUsers` to never let the counter fall** — rejected: impossible to bypass, but turns a
   plain write into a read-modify-write for every caller (`users.ts`, `auth.ts`) that already holds
   the right value in memory, adding cost and deadlock surface on every route.
4. **Make `withUsersLock` reentrant** so only the `case 'users'` body needs wrapping — rejected: the
   non-reentrancy is a deliberate, documented decision (`data.ts:318-326`), and reentrant locks hide
   nesting bugs.

## Consecuencias

- `tokenVersion` is now **monotonic without qualification**. `CONTEXT.md` and `session-auth.md` drop
  the "not across a restore" caveat they were carrying.
- **Restoring the `users` unit signs every user out, every time**, including when nothing was
  compromised. This is the accepted price. The actor's own logout was already handled —
  `usersReplaced` drives `closeSessionAndRedirect()` in the admin client — so the marginal cost is
  other users' live sessions.
- Generation numbers **jump** rather than increment on a restore (everyone lands on the same value).
  Nothing reads them as a count; they are opaque generation labels.
- Authenticated imports that name the `users` unit now serialize against logins and user CRUD for the
  duration of the run. Imports that cannot touch users keep their previous latency profile.
- Session revocation now has **two** triggers. ADR-0027 remains accurate on everything else — the
  stateful `getAuth`, the reduced JWT, deletion and demotion — and is not superseded.
