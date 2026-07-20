<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — One serialized seam for every users.json write

_Resolves [#135](https://github.com/NauelG/astro-blocks/issues/135) (P1, security). Closes the gap
named by `session-auth.md` R7, left open by `restore-session-revocation` (#134). Grilled 2026-07-19._

## Problem

Four code paths write `users.json`. Two hold `withUsersLock`; two do not.

| Writer | Lock |
| --- | --- |
| `handleLogin` first-user creation (`auth.ts:35`) | held |
| import pipeline (`backup.ts:927`) | held |
| `handlePostUsers` / `handlePutUser` / `handleDeleteUser` (`users.ts:55,95,129`) | **none** |

Each unlocked handler runs `loadUsers` → mutate the array → `saveUsers`, and `saveUsers` writes the
**whole list**. Two of them interleaving lose one update entirely — last writer wins across *every*
record, not just the one it meant to touch.

## Why it is a security issue, not a generic race

One of the mutations that can be silently discarded is the session-revocation bump:

```ts
// users.ts:91 — a password change revokes every live session for this user (ADR-0027, #124)
tokenVersion: current.tokenVersion + 1,
```

Losing that write is losing a **revocation**. An operator changes a compromised password, the API
answers `200`, the admin shows success — and the token they believe they killed stays valid for the
remainder of its 7-day lifetime. No error, no log line, nothing in the UI. It is the #124 fail-open
class reached through a race rather than through a stale claim.

## Two things the issue got wrong

Both were written by me at triage and are corrected here.

**1. There is no deadlock risk.** The issue warned that wrapping the handlers "risks reentrancy
against `handleLogin`, which already holds the lock". Checked: the three CRUD handlers are reached
**only** from `route-table.ts:272,316,378` — HTTP dispatch. Neither locked path
(`handleLogin`'s first-user block, `applyImport`) calls a handler; both call `loadUsers` /
`saveUsers` / `restoreUsers` directly. There is no nesting path, so there is nothing to deadlock.

**2. The last-owner guard cannot be defeated.** The obvious worst case looked reachable — two
concurrent deletes both read `ownerCount === 2`, both pass the check, instance left with no owner.
It is not: because `saveUsers` writes the entire list from a stale read, the surviving write
**resurrects** the owner the other request removed. Every reachable final state retains at least one
owner. The lost-update bug accidentally shields the check-then-act bug. This bounds the severity and
is recorded so the fix is not over-scoped chasing it.

## What the grilling found that the issue missed

`hashPassword` sits **inside** the read-modify-write span in three places — `users.ts:48`,
`users.ts:89`, and `auth.ts:41`. Password hashing is deliberately slow; that is its purpose.
Wrapping the existing code in a lock as-is would serialize every hash against every login and every
user write. The fix has to restructure, not just wrap.

## Proposed change

1. **New store seam `data.mutateUsers(fn)`** — acquires the lock, re-reads, hands the array to the
   mutator, writes. Handlers express *what* changes; the store owns *how* it is serialized. Same
   reasoning that put `restoreUsers` at the store boundary (#134, ADR-0028): correctness that lives
   in a seam cannot be forgotten by the next caller, because there is nothing to remember.
2. **The seam has no abort mechanism — it always writes.** Error paths simply do not mutate, and the
   unchanged list is written back. See ADR-0030 for why the alternatives are worse.
3. **Hashing moves out of the critical section.** `hashPassword` runs before the lock is acquired, in
   all four writers.
4. **Guards are re-validated inside the lock.** Email uniqueness, `ownerCount`, and record existence
   are currently evaluated against a read taken before any lock. Re-checking them against the fresh
   in-lock list is what turns this from "moved the lost update" into "closed the check-then-act".
5. **All four writers migrate**, `handleLogin` included. Leaving one bespoke lock holder would keep
   the rule as discipline — which is how this issue came to exist.

## Alternatives considered

- **`withUsersLock` inline in each handler** — rejected. No new interface to design and the abort is
  a plain `return`, but correctness stays a habit repeated three times, and the fourth writer added
  next year is born unlocked again.
- **Compare-and-swap on `saveUsers`** — rejected. Changes the signature for every caller, introduces
  retries and a new conflict failure mode, and this is a single-node CMS over JSON files:
  distributed-systems machinery without the distributed system.
- **Lock the whole handler body** — rejected. Trivially correct and impossible to leave a hole, but
  it holds the lock across `hashPassword`, blocking every login for hundreds of milliseconds. With
  [#125](https://github.com/NauelG/astro-blocks/issues/125) (no login rate limiting) open, that
  worsens an already fragile surface.
- **Leave `handleLogin` alone** — rejected. Its lock is correct and covered by tests, but it holds
  the lock across `hashPassword` too, and an exception to "writes go through the seam" is how the
  rule erodes.

## Not in scope

`restoreUsers` keeps its current contract: the caller holds the lock, and it *replaces* the list
rather than mutating it, so it is not a `mutateUsers` client.
