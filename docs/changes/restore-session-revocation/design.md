<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Restore is a session-revocation event

## 1. The store seam (`src/api/data.ts`)

A single exported function owns the invariant. It is the only place that knows what a restore does
to a session generation.

```ts
/**
 * Restore is a session-revocation event (ADR-0028). A backup's `users.json` carries the generations
 * of the moment it was taken, so writing it through would move counters *backwards* and re-arm
 * every token minted at those generations — the #124 fail-open class through another door.
 *
 * Every restored record therefore leaves at one generation above the high-water mark of both sides.
 * A per-id `max(current, restored)` cannot achieve this: a user deleted after the backup has no
 * current record to compare against, and their old tokens would revive.
 *
 * Caller MUST hold `withUsersLock` — this is a read-modify-write against users.json. The lock is
 * non-reentrant, so this function does not acquire it (same contract as `saveUsers`).
 */
export async function restoreUsers(restored: UsersData): Promise<void> {
  const { users: current } = await loadUsers();
  const incoming = Array.isArray(restored.users) ? restored.users : [];

  // Normalize BEFORE comparing: `max(3, "99")` is meaningless, and loadUsers would read that
  // "99" back as 1 anyway. The high-water must be computed over values the store can actually hold.
  const highWater = [...current, ...incoming].reduce(
    (max, user) => Math.max(max, normalizeTokenVersion(user.tokenVersion)),
    1,
  );

  await saveUsers({
    ...restored,
    users: incoming.map((user) => ({ ...user, tokenVersion: highWater + 1 })),
  });
}
```

`normalizeTokenVersion` already exists (`data.ts:406`, from `tokenversion-boundary-normalization`)
and is reused unchanged. `saveUsers` remains the sole writer — `restoreUsers` composes it rather
than reaching for `writeJson`.

`reduce` over a seed of `1`, not `Math.max(...array)`: the spread form returns `-Infinity` on an
empty list (bootstrap) and risks a stack overflow on a large one.

| Scenario | current | restored | result |
| --- | --- | --- | --- |
| Password changed after backup | `2` | `1` | `3` — the stolen token at `1` stays dead |
| Untouched user | `1` | `1` | `2` — signed out, deliberately |
| Deleted after backup, resurrected | *(absent)* | `5` | `6` — old tokens cannot match |
| Malformed value in archive | `3` | `"99"` | `4` — `"99"` normalizes to `1`, does not poison the max |
| Bootstrap (empty store) | *(none)* | `1` | `2` — no live sessions to lose; one rule, no special case |

One number for everyone, not `max(perUser, hw) + 1`: since `hw` is already ≥ every per-user value,
the two are equal. The uniform form is simply the honest way to write it.

## 2. The restore path (`src/api/backup.ts`)

`applyImport`'s `case 'users'` (~645) swaps the writer:

```ts
case 'users': {
  const raw = await fs.readFile(path.join(stagingDir, 'data', 'users.json'), 'utf-8');
  // Not saveUsers: restore must not rewind session generations (ADR-0028).
  await data.restoreUsers(JSON.parse(raw));
  break;
}
```

## 3. The lock (`src/api/backup.ts:911`)

`restoreUsers` is a read-modify-write, and today an authenticated restore runs unlocked — a
concurrent `handlePutUser` password change would be lost or overwritten.

```ts
// Acquire the users lock whenever this run can write users.json: bootstrap always does, an
// explicit selection does when it names the unit, and an unknown selection (units still to be
// read from the manifest) is assumed to. Evaluated synchronously from `opts` — see the
// SAME-MICROTASK INVARIANT above; introducing an await here would break #25.
const touchesUsers =
  opts.bootstrapMode || !opts.selectedUnits || opts.selectedUnits.includes('users');
return touchesUsers ? data.withUsersLock(run) : run();
```

This keeps the existing latency profile for imports that cannot touch users (a large media-only
import does not freeze every login for its duration) while guaranteeing the lock exactly where the
read-modify-write happens. Bootstrap keeps acquiring it at the same point, so the non-reentrancy
contract is respected: `restoreUsers` is always called *inside* an already-held lock and never
acquires one itself.

## 4. What deliberately does not change

**`_rollbackFromSnapshot` keeps copying `users.json` raw** and does **not** route through
`restoreUsers`. This is correct, not an oversight: the snapshot is the pre-apply state, so restoring
it resurrects nothing — it returns the store to where it already was. Routing it through
`restoreUsers` would bump generations on a run that *failed*, signing everyone out because an import
did not happen. A comment records this so a later refactor does not "fix" it.

**`usersReplaced` is unchanged.** It is already `true` whenever the users unit was applied
(`backup.ts:711`) and already drives `closeSessionAndRedirect()` in the admin client
(`import-export-editor.ts:355`). The actor's logout is therefore already handled; no API or client
change is needed.

**`getAuth`, `createToken`, `handlePutUser`'s `+ 1` bump and the token lifetime are untouched.** This
change adds a second revocation trigger; it does not alter the first.
