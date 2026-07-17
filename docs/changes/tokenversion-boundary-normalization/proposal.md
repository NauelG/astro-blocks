<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Normalize `tokenVersion` at the store boundary

_Follow-up to [#124](https://github.com/NauelG/astro-blocks/issues/124) / ADR-0027. Grilled 2026-07-17._

## Problem

**An installation upgraded to 3.7.0+ with pre-existing users cannot log in at all.**

ADR-0027 promised that legacy records without a `tokenVersion` field would read as `1` and keep
working (`docs/adr/0027:45-46`, and `session-auth.md` R5: *"Store records without the field
normalize to `1` at read time"*). The code never delivers it on the path that matters:

1. A record persisted before 3.7.0 has no `tokenVersion`.
2. `handleLogin` (`auth.ts:66`) calls `createToken(user)`, which signs
   `new SignJWT({ tokenVersion: user.tokenVersion })` (`auth-core.ts:124`) with `undefined`.
   `JSON.stringify` **drops undefined keys** — the token is issued with no `tokenVersion` claim.
3. `getAuth` (`auth-core.ts:151`) rejects any token without a numeric claim → **401**.

Login answers **200 with a token that is dead on arrival**, and the user sees no useful error.
Verified empirically: the emitted payload is `{"sub":"u1","exp":…}`.

This is not a missing-permissions bug — `role` is read fresh from the store and is correct. It is a
total lockout.

### Root cause

The defect is architectural, not a typo. The `?? 1` default is **replicated across call sites** —
`getAuth:157`, `handlePutUser:91` — over a type that `readJson` **casts without validating**
(`data.ts:287`: `JSON.parse(raw) as T`). `User.tokenVersion: number` is fiction over whatever is on
disk.

ADR-0027 predicted this exact class of bug and placed the guard in the wrong layer
(`0027:87-89`: *"every user-creation path must set `tokenVersion: 1`; a path that forgets it relies
on the `?? 1` read-time default"*). The archived `design.md` names the mistake precisely: *"tolerated
only at the read boundary in `getAuth` (`?? 1`)"* — it assumed `getAuth` was the **only** reader of
the field. `createToken` reads it too, and was never covered.

The suite stayed green because the tests **sign JWTs by hand**. `auth-handlers.test.js:328`
(*"legacy record without a tokenVersion field defaults to 1 and passes"*) builds the token with
`new SignJWT({ tokenVersion: 1 })` directly — it proves `getAuth`'s `?? 1` works and never exercises
`login → createToken → getAuth`. No test crosses the seam where the bug lives.

## Proposal

Move the invariant to the **store boundary**. `loadUsers` normalizes every record on read; the
scattered defaults are deleted.

1. **`loadUsers` (`data.ts:404`) normalizes `tokenVersion` on every record it returns.** Verified:
   `loadUsers` is the **only** read of `users.json` in `src/` — all 15 call sites go through it — so
   the boundary is airtight, including records that `restore` writes in behind it (`backup.ts:645`).
2. **Normalization coerces to an integer ≥ 1.** Absent, `"3"`, `NaN`, `-5`, `1.5` all read as `1`.
   `?? 1` only catches `undefined`/`null`; a string or `NaN` from a hand-edited file or an uploaded
   backup archive produces a *permanent* lockout (`"3" !== 3`, `NaN !== NaN` never match). The
   invariant becomes total and the type stops lying.
3. **The scattered `?? 1` defaults are removed** (`getAuth:157`, `handlePutUser:91`) — dead code
   once the boundary guarantees the field.
4. **`createToken` needs no change.** Its callers receive store-loaded users, so the field is
   already guaranteed. The bug disappears *by construction* rather than by a fourth defensive
   default — which is the whole point.
5. **A regression test crosses the real seam**: `login → createToken → getAuth` against a legacy
   record. This is the actual deliverable; without it the next change reopens the hole and the suite
   stays green.

## Observable behaviour changes

- A legacy record (no `tokenVersion`) can **log in and stay authenticated** — was: permanent 401
  after a 200 login.
- A record with a corrupt `tokenVersion` (`"3"`, `NaN`, `0`, `-5`, `1.5`) reads as `1` instead of
  locking the user out permanently.
- No change for records written by 3.7.0+ — they already carry a valid integer.
- No token format change, no re-login, no migration. Nothing is written to disk.

## Out of scope

- **`restore` rewinds `tokenVersion` and resurrects revoked sessions.** `backup.ts:645` does
  `saveUsers(JSON.parse(raw))` unguarded: restoring a pre-bump backup returns the counter to its old
  value, re-arming a stolen token for up to 7 days. This **contradicts the "monotonic" claim** in
  `0027:41` and `CONTEXT.md:119` — a counter that can rewind is not a revocation primitive. Real,
  but a distinct defect with its own grilling. Filed as
  [#134](https://github.com/NauelG/astro-blocks/issues/134) (P1, security).
- **"Sign out everywhere" endpoint** — still deferred (ADR-0027).
- **Validating the rest of the `User` shape.** `readJson`'s unchecked cast is a broader problem;
  this change normalizes `tokenVersion` only, where the failure is live.

## Consequences

- **No new ADR.** ADR-0027's decision (stateful revocation via `tokenVersion`) is unchanged — it was
  implemented incorrectly. Moving the default to the boundary is reversible, unsurprising and
  carries no real trade-off: it meets none of the three ADR criteria. ADR-0027 stays **intact**
  (immutable), including its now-outdated "Must watch" note; `session-auth.md` R5 becomes the
  accurate statement of where normalization lives.
- **`docs/specs/session-auth.md`**: R3 / R5 / R6 modified (see `spec-delta.md`). R5 already claimed
  read-time normalization — the spec was aspirational; this change makes the code match it and says
  *where*.
- **`docs/CONTEXT.md`**: the `tokenVersion` glossary line notes that the invariant is established at
  the store boundary.
- **Silent downgrade is accepted, and logged nowhere.** A corrupt value degrades to `1` with no
  warning (a `console.warn` variant was weighed and rejected at grilling). If a generation-1 token
  ever revives after a corrupt restore, there will be no trace to inspect. Conscious trade-off:
  fewer moving parts over forensics on a path that should not occur.
- **Release**: security fix → `patch`, `### Fixed` entry noting that upgraded installations with
  pre-existing users were locked out.
