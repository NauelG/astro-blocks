<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — One serialized seam for every users.json write

One vertical slice. T1 goes red against `main`, T2–T4 turn it green, and the last two writers move
onto the seam so the rule is structural rather than habitual.

Tests import from `../dist/…`, so every verify step is `npm run build && npm test`.

> **Making the red deterministic.** A concurrency test that fires two requests and hopes for an
> interleave is a flaky test wearing a bug report's clothes. The lever that removes the timing
> guesswork is `hashPassword`: it is deliberately slow (orders of magnitude slower than the `fs` read
> around it), so **two concurrent password changes on two different users** always overlap. Both load
> the same list, both hash, both write the whole list — and on `main` exactly one bump survives,
> whichever writes last. The assertion "both users' `tokenVersion` was incremented" therefore fails
> on `main` every run, and after the fix cannot fail spuriously. Do not weaken it into a loop of N
> attempts.

## T1 — Concurrency regression tests (red)

- [x] **File:** `tests/users-handlers.test.js` — it already imports `loadUsers` from
  `../dist/api/data.js` and owns `withTempProject` + `seedOwner`. Add `handlePutUser` /
  `handlePostUsers` / `handleDeleteUser` usage as the existing tests do. No new test file.
  - **`concurrent password changes both keep their revocation bump`** — seed two users, fire two
    `handlePutUser` password changes with `Promise.all`, assert **both** `tokenVersion` values
    incremented. This is the issue's core defect; it fails on `main`.
  - **`a lost bump would leave a revoked token valid`** — same interleave, then mint a token at each
    user's *old* generation and assert `getAuth` rejects both. Asserting the counter alone would pass
    even if `getAuth` stopped consulting the store; the whole point is the session, not the number.
  - **`concurrent creates both persist`** — two `handlePostUsers` with distinct emails; both exist
    afterwards.
  - **`a concurrent delete and update discard neither`** — delete user A while updating user B;
    afterwards A is gone **and** B carries its change.
  - **`concurrent demotion and deletion leave at least one owner`** — true on `main` only as an
    accident of last-writer-wins rewriting the whole list (see `proposal.md`). Pin it so the fix
    keeps it true by construction.
- **Verify:** `npm run build && npm test` — the first four fail, the fifth passes. No other suite
  changes.

## T2 — The seam (`src/api/data.ts`)

- [x] Add exported `mutateUsers<T>(fn: (users: User[]) => Promise<T> | T): Promise<T>` from
  `design.md` §1, with its doc comment. The comment must carry the two facts that are not inferable:
  **the caller never acquires `withUsersLock`** (non-reentrant — a mutator reaching for it deadlocks),
  and **the write is unconditional by design** (ADR-0030), not an oversight.
  - Compose the existing `loadUsers` and `saveUsers`. No new normalizer, no `writeJson` call.
  - No `commit()` parameter and no `ABORT` sentinel. If a later reader wants one, ADR-0030 is the
    answer.
- **Verify:** `npm run build && npm test && npm run typecheck` — green; T1 still red (nothing uses the
  seam yet).

## T3 — The three CRUD handlers (green)

- [x] **File:** `src/api/handlers/users.ts`
  - `handlePostUsers`, `handlePutUser`, `handleDeleteUser` each become: validate the request → hash
    if a password is present → `return data.mutateUsers(async (users) => { ... })`.
  - **Move every guard inside the mutator**, evaluated against the in-lock array: email uniqueness
    (`:41`), record existence (`:68`, `:114`), `ownerCount` last-owner rules (`:79`, `:122`). Leaving
    any of them outside fixes the lost update and keeps the check-then-act.
  - **`hashPassword` moves out of the critical section** (`:48`, `:89`). Accept that an error path may
    hash and discard.
  - `requireOwner` and `parseJsonBody` stay outside — they never touch the store.
  - Response shapes and status codes are unchanged for all three endpoints.
- **Verify:** `npm run build && npm test` — all T1 tests pass. The existing `users-handlers.test.js`
  suite (`:452-530`, the `tokenVersion` block) must stay green untouched.

## T4 — `handleLogin` (`src/api/handlers/auth.ts`)

- [x] Replace the bespoke `withUsersLock` block (`:35`) with a `mutateUsers` client. The in-lock
  re-check (`fresh.users.length !== 0` → `'raced'`) becomes the mutator's early return; its shape as
  a return value is unchanged.
- [x] Move `hashPassword` (`:41`) out of the lock.
- [x] The SAME-MICROTASK INVARIANT of #25 does **not** apply here — `handleLogin` already has two
  awaits before acquiring the lock and takes no `projectRoot`. Verified in `design.md` §4. Do not
  add a comment claiming otherwise.
- **Verify:** `npm run build && npm test` — `tests/auth-handlers.test.js` and
  `tests/import-export-bootstrap.test.js` stay green. **A deadlock here hangs the run instead of
  failing it** — if the suite stops progressing, `mutateUsers` was called from inside a held lock.

## T5 — Full verification

- [x] `npm run build && npm test && npm run typecheck`.
- [x] `npm run features:validate`.
- [x] `npm run e2e` — the admin's user management drives these endpoints for real. Note that
  `npm run e2e` does **not** rebuild the playground; run `npm run build:playground` first or it tests
  a stale `dist`.
- [x] Confirm `withUsersLock`'s only remaining callers are `mutateUsers` and the import pipeline:
  `grep -rn "withUsersLock" src/`.

## T6 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `fix(api): serialize every users.json mutation behind one seam`
- Body: what was lost (a password change's revocation bump, silently, with a `200`), why it is the
  #124 fail-open class through a race, and the two triage claims this corrected — no deadlock risk,
  and the last-owner guard was never defeatable. Reference #135, ADR-0030. Note that hashing moved
  out of the critical section, so the paths that already held the lock now hold it for less time.
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is a `patch` with a `### Fixed` entry.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.
