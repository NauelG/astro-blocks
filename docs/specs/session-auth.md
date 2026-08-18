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
> so the monotonicity R3 assumes is actually upheld; R4/R6 extended and R7 rewritten by
> `serialize-user-writes` (2026-07-20, #135, ADR-0030), which put every mutation behind one
> serialized seam and closed the gap R7 had itself declared; R8 added by `login-attempt-backoff`
> (2026-07-20, #125, ADR-0032), which bounded how often a token may be *asked for*.

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
  that user. The increment is applied **inside the users lock, against the freshly re-read record**
  (R7), so a concurrent write to another user cannot discard it. Losing that increment would report
  success while leaving the revoked token valid for the remainder of its lifetime — a fail-open
  reached through a race rather than a stale claim (#135).
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

**The serialization seam is covered under genuine interleave**, not by sequential calls: a password
change concurrent with an unrelated user write must keep its `tokenVersion` bump, and a token minted
at the old generation must still be rejected by `getAuth`. Concurrent creates must both persist; a
concurrent delete and update must not silently discard either. Concurrent demotion and deletion of
two owners must leave at least one owner — true before the seam existed only as an accident of
last-writer-wins rewriting the whole list, and required to hold by construction afterwards. A
mutation must also preserve unknown top-level keys in `users.json`, which no type-driven test can
catch on its own.

The interleave is made deterministic by `hashPassword`, which is slow enough relative to the
surrounding `fs` read that two concurrent password changes always overlap. Weakening these into a
loop of N attempts would turn a real regression test into a flaky one.

The bootstrap-import and login-vs-bootstrap suites must stay green: `mutateUsers` acquires a
non-reentrant lock, so a violation surfaces as a **hung** run rather than a failing assertion.

**R7 — Every mutation of the user store is serialized, and the store owns it.** `users.json` has
exactly one mutation seam, `mutateUsers` (ADR-0030). It acquires the users lock, re-reads the list
**inside** the lock, hands it to the mutator, and writes it back. A **mutator** never acquires the
lock — it is non-reentrant, so reaching for it from inside the mutator would deadlock. The seam is
not the lock's only client: the import pipeline acquires it directly for the span of a whole run,
which is why `withUsersLock` stays exported.

The seam has **no abort mechanism**: it writes unconditionally. An error path does not mutate, and
the unchanged list is rewritten. A `commit()` flag or an `ABORT` sentinel would each add a way to
discard a real mutation silently — the failure mode the seam exists to remove — in exchange for
avoiding a redundant write on a rare branch (ADR-0030).

The seam **preserves unknown top-level keys** in `users.json`. `loadUsers` and `restoreUsers` both
spread the loaded object deliberately, so a field the code does not model survives a read and a
restore; a mutation must not be the one path that silently drops it.

**Guards are evaluated against the in-lock list**, never against a read taken before it: email
uniqueness, `ownerCount` for the last-owner rules, and record existence. Serializing the write
without re-validating would move the lost update while leaving the check-then-act intact.

**Password hashing happens outside the critical section.** `hashPassword` is deliberately slow;
holding the users lock across it would block every login for its duration. The cost accepted is a
hash computed on error paths that then discard it.

**User creation has a format precondition.** `handlePostUsers` rejects an email failing the shared
grammar (`field-validation.md` R1) with the localized `errors.invalidEmail` body, before the hash
and before the lock. Login and token verification never format-validate — an already-stored legacy
value cannot be locked out (#108).

`restoreUsers` is **not** a seam client: its caller (the import pipeline) already holds the lock, and
it *replaces* the list rather than mutating it. The rule is every **mutation**, not every write.
`saveUsers` likewise stays a plain unlocked writer — it is what both are built from.

**R8 — Failed logins are progressively delayed, keyed by email.** Repeated credential failures for
the same email address accrue a growing delay: `FREE_ATTEMPTS` (3) accrued failures owe nothing,
then the debt doubles from `BASE_DELAY_MS` (500 ms) to `MAX_DELAY_MS` (8 s), where it pins. A
successful login clears the key; an entry idle beyond `ATTEMPT_TTL_MS` (15 min) is forgotten, so a
returning owner starts clean.

The debt accrued by N failures is paid by the **N+1th** attempt, not by the request that incurs it —
the wait runs before credentials are checked, so it can only reflect what is already recorded.
`FREE_ATTEMPTS` (3) therefore means **four** attempts are answered with no delay; the fifth is the
first to wait. Describing it as "three free attempts" is off by one.

**The key is the normalized email, and nothing else.** The client address is deliberately excluded
(ADR-0032): Astro resolves it as `x-forwarded-for || socket.remoteAddress`, which is either
unspoofable but shared by every caller behind a proxy, or attacker-controlled — and a distributable
package cannot tell which of the two it holds. Keying on it would let an attacker rotate the header
for unlimited attempts, and forge a victim's address to throttle a third party.

**The delay is the only observable.** A throttled attempt returns the same
`401 errors.invalidCredentials` as any other failure, with no `Retry-After` and no distinct status,
and accrues identically whether or not the email exists. This preserves R1's single failure
response: a lockout status appearing only for real accounts would enumerate them.

**It is a delay, not a lockout.** The CMS has a single owner; denying that account after N failures
would let any unauthenticated caller make the instance unadministrable. Backoff never shuts the
owner out — it only makes sequences of guesses slow.

**The attempt store is bounded, and evicts by failure count rather than recency.** It is in-process
memory keyed by an attacker-controlled value, so it is capped (`MAX_TRACKED_KEYS`, 1 024). Eviction
drops expired entries first, then those with the **fewest** failures. Least-recently-used eviction
would be a bypass: flooding the store with junk keys would evict the entry tracking the account
under attack. A sweep also reclaims a **batch** rather than the bare excess — evicting one entry per
insertion would sort the whole store on every failed login past the cap, making the defense a CPU
amplifier under precisely the flood it exists to survive. Both are security properties of the
eviction path, not housekeeping.

**What this does and does not bound.** Backoff bounds the rate a key sustains **over time**. It does
not bound a burst of concurrent requests arriving before any counter increments; there, the
per-guess cost of scrypt limits throughput. The two compose and neither is sufficient alone. The
counter does not survive a restart and does not span instances — a reverse-proxy rate limit remains
the expected production layer, and this is defense in depth.

**Regression coverage.** The delay schedule is pure and covered directly: free attempts, doubling,
the cap, and absurd inputs that must not overflow past it. Through `handleLogin`: repeated failures
grow the delay and a success resets it; an **unknown email is throttled indistinguishably from a
known one** in both status and body; bootstrap on an empty store is unaffected. Eviction is covered
by the case that separates it from LRU — a high-failure key must survive a flood of single-failure
keys. Exactly one test touches the clock, asserting a **lower** bound on elapsed time; a timer may
fire late on a loaded runner, never early, so an upper-bound assertion would be flaky rather than
meaningful.

The `jwtSecretMisconfigured` 503 is **not** covered by test and cannot be: `JWT_SECRET_STATUS` is
evaluated once at module import, so reaching that branch requires the environment set before the
import. Its ordering is structural instead — the guard returns before the throttle is reachable.

## Boundaries & unchanged behaviour

- `jwtSecretMisconfigured` fail-closed behaviour (production refuses the built-in fallback secret),
  the header parsing, and the 7-day token lifetime (`JWT_EXPIRY`) are unchanged.
- `requireOwner` is unchanged — it simply receives the fresh store role.
- Revocation is **per-user**, not per-session: there is no `jti` and no per-device sign-out. An
  explicit "sign out everywhere" endpoint is not yet exposed (the mechanism is in place).
- Login throttling (R8) is **per email, per process, in memory**. It does not persist across restart,
  does not coordinate across instances, and is applied to no endpoint other than login. No other
  unauthenticated surface is rate limited. The first-user bootstrap path is not throttled and needs
  no counter: with an empty store any credentials succeed, so no credential failure is reachable
  there.
- `tokenVersion` normalization is **read-only and per-record**; it never writes, and it never moves a
  counter *backwards* in the store. Neither does a restore: the counter is **monotonic**, without
  qualification (R4, R7, ADR-0028). The price is that restoring the `users` unit signs every user
  out, every time, even when nothing was compromised — restore is treated as a security event rather
  than a data operation, so the resurrection case cannot be reached by a subtly wrong rule.
