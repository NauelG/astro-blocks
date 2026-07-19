<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Restore is a session-revocation event

Target: `docs/specs/session-auth.md`. No new capability — R3 already called the counter a revocation
primitive and the *Boundaries* section already recorded that a restore breaks it (tracked as #134).
This delta makes the restore path uphold the claim, so the qualifier can be dropped instead of
carried.

## MODIFIED: R4 — Revocation triggers

Was: three bullets, of which only password change bumps the counter. Restore was absent — which is
why it silently rewound it.

> **R4 — Revocation triggers.**
>
> - **Deletion** → the existence check rejects the token (no bump; the record is gone).
> - **Demotion** → not a rejection: the user stays authenticated, and the fresh store role makes
>   `requireOwner` return 403. A role can never go stale in a token because it is never in the token.
> - **Password change** → `tokenVersion` is incremented, revoking every previously-issued token for
>   that user.
> - **Restore of the `users` unit** → every restored record is written at one generation **above the
>   high-water mark** of the current store and the archive combined, revoking every session on the
>   instance (ADR-0028). A restore replaces `users.json` wholesale, so passing the archive's
>   generations through would move counters *backwards* and re-arm any token minted at them. A
>   per-id `max(current, restored)` is insufficient: a user deleted after the backup returns with no
>   current record to compare against.

## ADDED: R7 — The restore write is serialized and store-owned

New requirement. The invariant belongs to the store, and the write that establishes it is a
read-modify-write, so both facts need stating — the previous design left the first implicit and the
second false.

> **R7 — The restore write is serialized and store-owned.** `restoreUsers` is the **sole** writer of
> a restored user list; `saveUsers` stays a plain writer and the restore path does not call it. The
> archive's generations are normalized (R5) **before** the high-water mark is computed, so a
> malformed value cannot inflate it.
>
> Because the computation reads the current store and then writes it, the import pipeline holds
> `withUsersLock` for any run that can write `users.json` — bootstrap, an explicit selection naming
> the `users` unit, or a selection not yet resolved from the manifest. The lock is non-reentrant, so
> `restoreUsers` never acquires it and must always be called from inside a held lock.
>
> **What this does not yet cover.** `withUsersLock` is held by exactly two paths: `handleLogin`'s
> first-user creation and the import pipeline. The user CRUD handlers (`handlePutUser`,
> `handlePostUsers`, `handleDeleteUser`) each run an unlocked `loadUsers` → mutate → `saveUsers`, so
> a password change concurrent with a restore is still a lost-update race — as are two concurrent
> password changes, independently of restore. That gap predates this change and is tracked in #135.
> The invariant this requirement establishes is that the restore write is serialized against every
> path that *does* hold the lock — not that `users.json` has a single writer.
>
> Rollback from a pre-apply snapshot is **not** a restore: it returns the store to the state it was
> already in, resurrects nothing, and deliberately bypasses `restoreUsers` — bumping generations on
> a run that failed would sign everyone out because an import did *not* happen.

## MODIFIED: R6 — Regression coverage

Every existing case stays; the restore seam is added.

> **R6 — Regression coverage.** Deleted-user token → 401; revoked (version-mismatch) token → 401;
> legacy claim-less token → 401; a valid token returns the store-sourced role (not the token's);
> demoted-owner token → `requireOwner` 403; password change → old token 401; `handlePostUsers` sets
> `tokenVersion: 1`.
>
> **The token-issuing seam is covered end-to-end**: a legacy record (no `tokenVersion`) and a
> malformed record (`tokenVersion: "3"`) must each traverse `handleLogin → createToken → getAuth` and
> authenticate. Hand-signed JWT fixtures do not satisfy this requirement — they bypass `createToken`,
> which is where the lockout lived. The store contract is covered directly: `loadUsers` normalizes
> absent / `"3"` / `NaN` / `0` / `-5` / `1.5` to `1` and passes `3` through.
>
> **The restore seam is covered end-to-end**: restoring an archive whose `tokenVersion` is *lower*
> than the store's must leave a token minted at the older generation rejected; a user deleted after
> the backup and resurrected by it must not have their old tokens validate; a malformed generation in
> the archive must not inflate the high-water mark. Asserting the resulting number alone does not
> satisfy this — the token must be put through `getAuth`, or the coverage would survive `getAuth`
> ceasing to consult the store at all.
>
> The lock is covered from both sides: with the users lock held, a run that names the `users` unit
> must **not** proceed, and a run that cannot write `users.json` must. The negative case is what
> distinguishes the conditional lock from an unconditional one. Bootstrap (empty store) must still
> apply without deadlocking. Rollback must return the store to its pre-apply generation, unbumped.

## MODIFIED: Boundaries & unchanged behaviour

The final bullet's qualifier is now false — the restore path upholds monotonicity. Replaced:

> - `tokenVersion` normalization is **read-only and per-record**; it never writes, and it never moves
>   a counter *backwards* in the store. Neither does a restore: the counter is **monotonic**, without
>   qualification (R4, R7, ADR-0028). The price is that restoring the `users` unit signs every user
>   out, every time, even when nothing was compromised — restore is treated as a security event
>   rather than a data operation, so the resurrection case cannot be reached by a subtly wrong rule.
