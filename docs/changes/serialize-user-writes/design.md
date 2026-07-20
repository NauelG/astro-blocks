<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — One serialized seam for every users.json write

## 1. The seam (`src/api/data.ts`)

```ts
/**
 * Run a mutation against the user list under the users lock (#135).
 *
 * The list is re-read INSIDE the lock and handed to `fn` as a mutable array. Whatever `fn` returns
 * is returned to the caller; the list is then written back unconditionally.
 *
 * Writing unconditionally is deliberate — see ADR-0030. An error path simply does not mutate, and
 * rewriting the unchanged list is a cheap atomic no-op. A `commit()` flag or an ABORT sentinel would
 * both add a way to silently discard a real change, which is precisely the failure mode this seam
 * exists to remove. If `fn` throws, the exception propagates before the write and nothing is
 * persisted.
 *
 * This is the ONLY way to mutate users.json. Callers never acquire withUsersLock themselves — the
 * lock is non-reentrant, so a caller inside `fn` that reached for it would deadlock.
 */
export async function mutateUsers<T>(fn: (users: User[]) => Promise<T> | T): Promise<T> {
  return withUsersLock(async () => {
    const { users } = await loadUsers();
    const result = await fn(users);
    await saveUsers({ users });
    return result;
  });
}
```

Composes the existing `loadUsers` (which normalizes `tokenVersion` at the boundary, ADR-0027) and
`saveUsers` (which stays a plain unlocked writer, callable from inside a held lock). No new
normalizer, no new writer.

A side effect worth naming: because every mutation rewrites what `loadUsers` returned, a legacy or
malformed `tokenVersion` gets **persisted** in its normalized form the first time any user is
touched. Read-time normalization becomes write-time consolidation, for free.

## 2. Hashing moves out of the critical section

The shape in all four writers becomes:

```ts
// 1. validate the request and hash — expensive, outside the lock
const passwordHash = password ? await hashPassword(password) : undefined;

// 2. re-read, re-validate and mutate — cheap, inside the lock
return data.mutateUsers(async (users) => { ... });
```

`hashPassword` is deliberately slow. Today it runs inside the span at `users.ts:48`, `users.ts:89`
and `auth.ts:41`; holding the users lock across it would block every login for its duration.

A consequence to accept: on an error path (404, duplicate email) the hash was computed for nothing.
That is wasted work on a rare branch, and it makes the timing of a failed request less dependent on
*why* it failed.

## 3. Guards re-validate against the fresh list

This is the half that turns a lost-update fix into a correctness fix. Every guard currently reads a
list fetched before any lock:

| Handler | Guard | Today |
| --- | --- | --- |
| `handlePostUsers` | email uniqueness | `users.ts:41`, stale read |
| `handlePutUser` | record exists · last-owner demotion | `users.ts:68,79`, stale read |
| `handleDeleteUser` | record exists · last-owner deletion | `users.ts:114,122`, stale read |

All of them move inside the mutator, evaluated against the in-lock array. `handleLogin` already does
this (`auth.ts:36`, the `fresh.users.length !== 0` re-check) — the pattern is not new here, it is
being applied consistently.

## 4. `handleLogin` (`src/api/handlers/auth.ts`)

The existing block already re-checks inside the lock; it becomes a `mutateUsers` client and moves its
`hashPassword` out. Its "raced" branch — a concurrent bootstrap import created the owner first —
survives unchanged as a return value from the mutator.

The SAME-MICROTASK INVARIANT of #25 does **not** constrain this call site: `handleLogin` already has
two awaits before acquiring the lock (`parseJsonBody`, `loadUsers`) and takes no `projectRoot`
parameter, so the lock key is computed from the ambient root either way. That invariant is specific
to `_runImportPipelineCore`, where the key must be captured against the same root that
`opts.projectRoot` was resolved from. Verified before adopting this scope.

## 5. What deliberately does not change

- **`restoreUsers`** — the caller (the import pipeline) already holds the lock, and it *replaces* the
  list rather than mutating it. Routing it through `mutateUsers` would double-acquire a
  non-reentrant lock.
- **`saveUsers`** stays a plain, unlocked writer. It is what `mutateUsers` and `restoreUsers` are
  built from; locking it would deadlock both.
- **`withUsersLock`** stays exported and non-reentrant. After this change its only callers are
  `mutateUsers` and the import pipeline.
- **Response shapes and status codes** are unchanged for all four endpoints.

## 6. Verification

The unit suite can express this directly — no browser needed. The shape that matters is a genuine
interleave, not two sequential calls:

1. **The revocation survives a concurrent write.** Start a password change for user A and a role
   change for user B concurrently; assert A's `tokenVersion` bump is present afterwards and a token
   minted at the old generation is rejected by `getAuth`. This fails against `main`.
2. **No update is lost.** Concurrent creates: both users exist afterwards. Concurrent delete +
   update: neither is silently discarded.
3. **Guards hold under interleave.** Concurrent demote + delete of two owners leaves at least one
   owner — true today by accident, and it must stay true by construction.
4. **The seam writes on error paths.** A 404 through `mutateUsers` leaves the file byte-equivalent in
   content (a rewrite is fine; a *change* is not).
5. **No deadlock.** The bootstrap-import and login-vs-bootstrap suites must stay green. A violation
   here hangs the run rather than failing it.
