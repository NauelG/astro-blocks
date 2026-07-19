<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Restore is a session-revocation event

One vertical slice: the store gains the invariant, the restore path adopts it, and the pipeline
acquires the lock the read-modify-write requires. TDD — T1 and T4 go red, T2/T3/T5 turn them green.
No public type change, so `typecheck` stays green throughout; the slice lands as a single commit
(T7).

Tests import from `../dist/…`, so **every verify step is `npm run build && npm test`**.

> **Red-state caveat for T1.** `restoreUsers` does not exist yet, and a named ESM import of a missing
> export is a *link* error — it fails the whole file, not just the new tests. So T1's red state is
> "the new tests do not pass"; the meaningful per-case red/green reading is taken at T2. Do not
> "fix" this by importing dynamically — the link error is correct and lasts one task.

## T1 — Store-contract tests (red)

- [x] **File:** `tests/auth-handlers.test.js` — it already imports `loadUsers` / `saveUsers` from
  `../dist/api/data.js` and owns `withTempProject` + `loginOwner` + `authRequest`. Add `restoreUsers`
  to the existing `data.js` import. No new test file: this keeps the whole `tokenVersion` store
  contract in one place, next to the normalization suite at `:357`.
- Add a section after the normalization block:
  - **`restoreUsers: a restored record lands above the current generation`** — bootstrap via
    `loginOwner()`, bump the stored record to `tokenVersion: 5` via `saveUsers`, then
    `restoreUsers` the same user at `tokenVersion: 1`. Assert `loadUsers` reports `6`, **not** `1`.
    This is the test the issue asks for, at the store level.
  - **`restoreUsers: a user absent from the current store cannot revive`** — current store holds
    user `a` at `3`; restore a list containing only user `b` at `5`. Assert `b` lands at `6` — above
    both sides, though `b` has no current record to compare against. This is the case a per-id
    `max()` cannot reach.
  - **`restoreUsers: a malformed archived generation does not inflate the high-water mark`** —
    current `3`, restore a record with `tokenVersion: '99'`. Assert the result is `4` (the `'99'`
    normalizes to `1`), not `100`.
  - **`restoreUsers: an empty current store still bumps`** — restore into a store with no users
    (the bootstrap shape). Assert the restored record lands at `restored + 1`, and specifically that
    the value is a positive integer — a `Math.max(...[])` regression would surface here as
    `-Infinity`.
  - **`restoreUsers: every restored record lands on the same generation`** — restore three users at
    `1`, `2`, `4` into a store whose max is `3`. Assert all three read back as `5`.
- **Verify:** `npm run build && npm test` — the new tests fail (see the caveat above). No other
  suite's assertions change.

## T2 — `restoreUsers` at the store boundary (green)

- [x] **File:** `src/api/data.ts`
  - Add the exported `restoreUsers(restored: UsersData): Promise<void>` from `design.md` §1, with its
    doc comment. The comment must carry *both* reasons, because neither is inferable from the code:
    why a per-id `max` is insufficient (the deleted-then-resurrected user), and that **the caller
    MUST hold `withUsersLock`** — non-reentrant, same contract as `saveUsers`.
  - Reuse the existing private `normalizeTokenVersion` (`:406`) and compose the existing `saveUsers`
    as the writer. Do not reach for `writeJson` directly and do not add a second normalizer.
  - `reduce` seeded with `1`, **not** `Math.max(...array)` — the spread form returns `-Infinity` on
    an empty list (the bootstrap case) and risks a stack overflow on a large one. `design.md` §1.
- **Verify:** `npm run build && npm test` — every T1 test passes. `npm run typecheck` green.

## T3 — The restore path adopts it (green)

- [x] **File:** `src/api/backup.ts`, `applyImport`'s `case 'users'` (~`:645`)
  - `data.saveUsers(JSON.parse(raw))` → `data.restoreUsers(JSON.parse(raw))`, with the one-line
    comment from `design.md` §2 naming ADR-0028.
  - **Do not** touch `_rollbackFromSnapshot` (`:917+`). Add the comment from `design.md` §4 recording
    that its raw `users.json` copy bypasses `restoreUsers` **deliberately** — the snapshot is the
    pre-apply state, so it resurrects nothing, and bumping there would sign everyone out because an
    import *failed*. Without that comment the asymmetry reads as a bug and gets "fixed".
  - `usersReplaced` (`:711`) is unchanged — it already covers the actor's logout.
- [x] **File:** `tests/import-export-import-pipeline.test.js` — end-to-end, using the existing
  `withTempProject` + `buildAndStage` + `applyImport` harness:
  - **`restore does not rewind tokenVersion (#134)`** — build and stage a `users` export, bump the
    live store above the archive's generation, `applyImport`, then assert the live generation is
    above the pre-restore value. Then cross the real seam: sign a token at the archived generation
    and assert `getAuth` still rejects it. Asserting the number alone would pass even if `getAuth`
    stopped consulting the store.
  - **`rollback restores users.json without bumping`** — drive `_rollbackFromSnapshot` and assert the
    generation returns to its pre-apply value, unbumped. This pins the deliberate asymmetry.
- **Verify:** `npm run build && npm test` — both new tests pass. `W-2` (`:1211`, partial import leaves
  `users.json` bytes identical) must stay green: a pages-only import must still not touch the file.

## T4 — Lock tests (red)

- [x] **File:** `tests/import-export-import-pipeline.test.js`
  - **`the pipeline waits on withUsersLock when the run can write users.json`** — hold
    `withUsersLock` with a manually-resolved promise, start `runImportPipeline` with
    `selectedUnits: ['users']`, assert `users.json` is **unchanged** while the lock is held, release,
    await, then assert the restore applied. Deterministic — no sleeps, no racing two real writers.
  - **`the pipeline does not wait when the run cannot write users.json`** — same setup with
    `selectedUnits: ['pages']`; the pipeline must complete while the lock is still held. This is the
    test that proves the condition is *conditional* and not just "always lock".
- **Verify:** `npm run build && npm test` — the first test **fails** (the authenticated path does not
  acquire the lock today), the second passes. Import `withUsersLock` from `../dist/api/data.js`.

## T5 — The lock condition (green)

- [x] **File:** `src/api/backup.ts:911`
  - Replace `opts.bootstrapMode ? data.withUsersLock(run) : run()` with the `touchesUsers` form from
    `design.md` §3, plus its comment.
  - **Zero `await`s** may be introduced between `_runImportPipelineCore`'s entry and this return —
    the condition reads synchronously from `opts` for exactly that reason. Breaking it breaks the
    SAME-MICROTASK INVARIANT of #25, which the existing comment block (`:900-910`) already guards;
    extend that comment rather than replacing it.
- **Verify:** `npm run build && npm test && npm run typecheck` — all green, including the bootstrap
  suites (`import-export-bootstrap.test.js`), which must keep passing untouched. A deadlock here
  surfaces as a **hung** test run, not a failure — if the suite stops progressing, the non-reentrancy
  contract was violated.

## T6 — Documentation

- [x] **File:** `docs/CONTEXT.md:119` — the `tokenVersion` glossary line drops
  *"Monotonic in normal operation; a restore can still rewind it (#134)"* and states the invariant
  unqualified, citing ADR-0028. The `Session revocation` line (`:120`) gains the second trigger:
  restore of the `users` unit re-generates every record. Keep both as glossary lines — no
  implementation detail (`AGENTS.md` routing).
- [x] `docs/adr/0028-restore-is-a-session-revocation-event.md` already exists (Propose phase). Do
  **not** touch `docs/adr/0027-*.md` — immutable, and its decision is extended, not superseded.
- [x] `docs/specs/session-auth.md` is **not** edited here — `spec-delta.md` is applied to it during
  **Archive**, per the cycle.
- **Verify:** `docs/CONTEXT.md:119-120` reads true against the code, and claims no monotonicity the
  restore path does not now uphold.

## T7 — Commit

- [x] Single commit, Conventional Commits, English, with `Reviewed-by` from `git config`:
  `fix(data): treat restore as a session-revocation event`
- Body: restoring a backup replaced `users.json` wholesale, moving `tokenVersion` backwards and
  re-arming tokens that a password change had already revoked — the #124 fail-open class through
  another door. Restored records now land above the high-water mark of both sides, and the pipeline
  holds the users lock for any run that can write the file. Reference #134 / ADR-0028; note that the
  per-id `max()` proposed at triage is insufficient because a user deleted after the backup has no
  current record to compare against.
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is a `patch` with a `### Fixed` entry; the entry must say
  restoring the `users` unit now signs every user out, since that is user-visible behaviour.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.
