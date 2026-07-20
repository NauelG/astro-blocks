<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — One serialized seam for every users.json write

Target: `docs/specs/session-auth.md`. No new capability. R7's *"What this does not yet cover"*
paragraph names this exact gap and points at #135; this delta closes it, so the paragraph is
replaced rather than amended.

## MODIFIED: R7 — The restore write is serialized and store-owned

Was: the restore write is serialized against every path that *does* hold the lock, with the CRUD
handlers explicitly outside it. That caveat is now false. R7 also broadens from "the restore write"
to "every mutation", since the restore is no longer the only serialized writer.

> **R7 — Every mutation of the user store is serialized, and the store owns it.** `users.json` has
> exactly one mutation seam, `mutateUsers` (ADR-0030). It acquires the users lock, re-reads the list
> **inside** the lock, hands it to the mutator, and writes it back. A **mutator** never acquires the
> lock — it is non-reentrant, so reaching for it from inside the mutator would deadlock. The seam is
> not the lock's only client: the import pipeline acquires it directly for the span of a whole run,
> which is why `withUsersLock` stays exported.
>
> The seam **preserves unknown top-level keys** in `users.json`. `loadUsers` and `restoreUsers` both
> spread the loaded object deliberately, so a field the code does not model survives a read and a
> restore; a mutation must not be the one path that silently drops it.
>
> The seam has **no abort mechanism**: it writes unconditionally. An error path does not mutate, and
> the unchanged list is rewritten. A `commit()` flag or an `ABORT` sentinel would each add a way to
> discard a real mutation silently — the failure mode the seam exists to remove — in exchange for
> avoiding a redundant write on a rare branch (ADR-0030).
>
> **Guards are evaluated against the in-lock list**, never against a read taken before it: email
> uniqueness, `ownerCount` for the last-owner rules, and record existence. Serializing the write
> without re-validating would move the lost update while leaving the check-then-act intact.
>
> **Password hashing happens outside the critical section.** `hashPassword` is deliberately slow;
> holding the users lock across it would block every login for its duration. The cost accepted is a
> hash computed on error paths that then discard it.
>
> `restoreUsers` is **not** a seam client: its caller (the import pipeline) already holds the lock,
> and it *replaces* the list rather than mutating it. The rule is every **mutation**, not every write.
> `saveUsers` likewise stays a plain unlocked writer — it is what both are built from.

## MODIFIED: R4 — Revocation triggers

The password-change bullet gains the guarantee that was missing. Every other bullet is unchanged.

> - **Password change** → `tokenVersion` is incremented, revoking every previously-issued token for
>   that user. The increment is applied **inside the users lock, against the freshly re-read record**
>   (R7), so a concurrent write to another user cannot discard it. Losing that increment would report
>   success while leaving the revoked token valid for the remainder of its lifetime — a fail-open
>   reached through a race rather than a stale claim (#135).

## MODIFIED: R6 — Regression coverage

Every existing case stays. The concurrency seam is added.

> **The serialization seam is covered under genuine interleave**, not by sequential calls: a password
> change concurrent with an unrelated user write must keep its `tokenVersion` bump, and a token
> minted at the old generation must still be rejected by `getAuth`. Concurrent creates must both
> persist; a concurrent delete and update must not silently discard either. Concurrent demotion and
> deletion of two owners must leave at least one owner — true before this change only as an accident
> of last-writer-wins rewriting the whole list, and required to hold by construction afterwards.
>
> The bootstrap-import and login-vs-bootstrap suites must stay green: `mutateUsers` acquires a
> non-reentrant lock, so a violation surfaces as a **hung** run rather than a failing assertion.
