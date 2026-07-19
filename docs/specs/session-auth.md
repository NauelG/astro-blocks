<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Session authentication & revocation

> Living specification. Describes the current behavior of CMS session authentication and
> revocation. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`). History:
> inaugurated by change `session-revocation` (#124, ADR-0027); R3/R5/R6 sharpened by
> `tokenversion-boundary-normalization` (2026-07-17), which moved the `tokenVersion` default to the
> store boundary after a legacy-record lockout; R4/R6 extended and R7 added by
> `restore-session-revocation` (2026-07-19, #134, ADR-0028), which made restore a revocation trigger
> so the monotonicity R3 assumes is actually upheld.

## Capability

The CMS API authenticates every request with a JWT carried in a header, verified **statefully**
against the user store on each call. A per-user session generation, `tokenVersion`, makes live
sessions revocable. The token is header-only (no cookie, no ambient credential — ADR-0007), so the
surface carries no CSRF exposure.

## Requirements

**R1 — Auth is a header-carried JWT, verified stateful.** The API authenticates solely via a JWT in
the `Authorization: Bearer` or `x-cms-token` header. `getAuth` verifies the signature **and**
re-loads the user from `users.json` on every authenticated request. The store is the single source
of truth for identity.

**R2 — The token carries only identity and generation.** The JWT holds `sub` (user id) and
`tokenVersion`. `email` and `role` are **not** in the token; `getAuth` returns them from the store
record. A token missing `sub`, or without a numeric `tokenVersion`, is rejected.

**R3 — `tokenVersion` is the revocation counter.** Each `User` has an integer `tokenVersion`
(initial `1`). Every record returned by the store carries a **positive integer** — the store
boundary guarantees it (R5), so no consumer defaults or validates it. `getAuth` rejects (→ 401)
when the user no longer exists, or when `payload.tokenVersion !== user.tokenVersion`. Bumping a
user's `tokenVersion` invalidates all of their live sessions at once ("sign out everywhere").

**R4 — Revocation triggers.**

- **Deletion** → the existence check rejects the token (no bump; the record is gone).
- **Demotion** → not a rejection: the user stays authenticated, and the fresh store role makes
  `requireOwner` return 403. A role can never go stale in a token because it is never in the token.
- **Password change** → `tokenVersion` is incremented, revoking every previously-issued token for
  that user.
- **Restore of the `users` unit** → every restored record is written at one generation **above the
  high-water mark** of the current store and the archive combined, revoking every session on the
  instance (ADR-0028). A restore replaces `users.json` wholesale, so passing the archive's
  generations through would move counters *backwards* and re-arm any token minted at them. A per-id
  `max(current, restored)` is insufficient: a user deleted after the backup returns with no current
  record to compare against.

**R5 — No migration; normalization at the store boundary.** Tokens issued before `tokenVersion`
existed carry no such claim and are rejected; users re-login once. Accepting a claim-less token
would reopen the fail-open hole, so there is no compatibility path.

On the store side there is likewise no migration — records are normalized on **read**, never
rewritten. `loadUsers` is the **sole** reader of `users.json` and the **sole** owner of the default:
every record it returns has `tokenVersion` coerced to a positive integer. Absent (a pre-ADR-0027
record) or malformed (`"3"`, `NaN`, `0`, `-5`, `1.5` — the store casts JSON without validating, and
`restore` writes an uploaded archive straight through) both read as `1`. Coercion, not
pass-through: `getAuth` compares strictly, so a malformed value that survived the boundary would
never match any claim and would lock the user out permanently.

Consumers therefore do not default the field. A record loaded from the store satisfies the type.

**R6 — Regression coverage.** Deleted-user token → 401; revoked (version-mismatch) token → 401;
legacy claim-less token → 401; a valid token returns the store-sourced role (not the token's);
demoted-owner token → `requireOwner` 403; password change → old token 401; `handlePostUsers` sets
`tokenVersion: 1`.

**The token-issuing seam is covered end-to-end**: a legacy record (no `tokenVersion`) and a
malformed record (`tokenVersion: "3"`) must each traverse `handleLogin → createToken → getAuth` and
authenticate. Hand-signed JWT fixtures do not satisfy this requirement — they bypass `createToken`,
which is where the lockout lived. The store contract is covered directly: `loadUsers` normalizes
absent / `"3"` / `NaN` / `0` / `-5` / `1.5` to `1` and passes `3` through.

**The restore seam is covered end-to-end**: restoring an archive whose `tokenVersion` is *lower* than
the store's must leave a token minted at the older generation rejected; a user deleted after the
backup and resurrected by it must not have their old tokens validate; a malformed generation in the
archive must not inflate the high-water mark. Asserting the resulting number alone does not satisfy
this — the token must be put through `getAuth`, or the coverage would survive `getAuth` ceasing to
consult the store at all.

The lock is covered from both sides: with the users lock held, a run that names the `users` unit must
**not** proceed, and a run that cannot write `users.json` must. The negative case is what
distinguishes the conditional lock from an unconditional one. Bootstrap (empty store) must still
apply without deadlocking. Rollback must return the store to its pre-apply generation, unbumped.

**R7 — The restore write is serialized and store-owned.** `restoreUsers` is the **sole** writer of a
restored user list; `saveUsers` stays a plain writer and the restore path does not call it. The
archive's generations are normalized (R5) **before** the high-water mark is computed, so a malformed
value cannot inflate it.

Because the computation reads the current store and then writes it, the import pipeline holds
`withUsersLock` for any run that can write `users.json` — bootstrap, an explicit selection naming the
`users` unit, or a selection not yet resolved from the manifest. The lock is non-reentrant, so
`restoreUsers` never acquires it and must always be called from inside a held lock.

**What this does not yet cover.** `withUsersLock` is held by exactly two paths: `handleLogin`'s
first-user creation and the import pipeline. The user CRUD handlers (`handlePutUser`,
`handlePostUsers`, `handleDeleteUser`) each run an unlocked `loadUsers` → mutate → `saveUsers`, so a
password change concurrent with a restore is still a lost-update race — as are two concurrent
password changes, independently of restore. That gap predates this requirement and is tracked in
[#135](https://github.com/NauelG/astro-blocks/issues/135). The invariant established here is that the
restore write is serialized against every path that *does* hold the lock — not that `users.json` has
a single writer.

Rollback from a pre-apply snapshot is **not** a restore: it returns the store to the state it was
already in, resurrects nothing, and deliberately bypasses `restoreUsers` — bumping generations on a
run that failed would sign everyone out because an import did *not* happen.

## Boundaries & unchanged behaviour

- `jwtSecretMisconfigured` fail-closed behaviour (production refuses the built-in fallback secret),
  the header parsing, and the 7-day token lifetime (`JWT_EXPIRY`) are unchanged.
- `requireOwner` is unchanged — it simply receives the fresh store role.
- Revocation is **per-user**, not per-session: there is no `jti` and no per-device sign-out. An
  explicit "sign out everywhere" endpoint is not yet exposed (the mechanism is in place).
- `tokenVersion` normalization is **read-only and per-record**; it never writes, and it never moves a
  counter *backwards* in the store. Neither does a restore: the counter is **monotonic**, without
  qualification (R4, R7, ADR-0028). The price is that restoring the `users` unit signs every user
  out, every time, even when nothing was compromised — restore is treated as a security event rather
  than a data operation, so the resurrection case cannot be reached by a subtly wrong rule.
