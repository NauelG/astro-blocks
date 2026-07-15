<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Proposal — Stateful session revocation (`tokenVersion`)

_Issue: [#124](https://github.com/NauelG/astro-blocks/issues/124) (P1, security). Grilled 2026-07-15._

## Problem

`getAuth` (`src/api/handlers/auth-core.ts:127-152`) verifies the JWT signature and reads
`sub` / `email` / `role` **from the token payload only** — it never re-loads `users.json`. With a
7-day token lifetime (`JWT_EXPIRY`, `:68`), a deleted or demoted user keeps full API access until
the token expires:

- **Deleted user**: `handleDeleteUser` (`users.ts:101-127`) only mutates the store; the victim's
  token keeps working.
- **Demoted owner** (`handlePutUser`, `users.ts:76-82`): the token still carries `role: 'owner'`,
  so `requireOwner` passes — **fail-open**.

There is no logout, no `jti`, no token-version, no deny-list. A live session cannot be revoked at
all — not even a leaked token, short of deleting the user.

## Proposal

Make `getAuth` **stateful** and give the store the last word on identity. A monotonic per-user
integer, `tokenVersion`, expresses revocation. Decided at grilling (see `docs/adr/0027`):

1. **`getAuth` reads the user from `users.json` on every authenticated request** and validates
   existence + `tokenVersion`. It returns `email` / `role` **from the store record**, not the
   payload.
2. **The JWT is reduced to `sub` + `tokenVersion`.** `email` and `role` are dropped — a claim that
   drives authorization but can go stale is the #124 defect by construction. `getAuth` is the sole
   consumer of the claims (verified: no client-side decode, `jwtVerify` called only here), so
   dropping them is safe.
3. **`User` gains a required `tokenVersion: number`** (initial `1`). Legacy records read as `1`
   (`?? 1`); no migration.
4. **Bump `tokenVersion` on password change** (`handlePutUser`) — the revocation primitive:
   changing a compromised password kills every live session for that user. Delete is handled by the
   existence check; demotion by the fresh store role (no bump needed for either).

## Observable behaviour changes

- A deleted user's token → **401** (was: valid up to 7 days).
- A demoted owner's token → still authenticated as `user`; `requireOwner` → **403** immediately
  (was: fail-open 200).
- After a password change, the user's previously-issued tokens → **401**.
- **Every existing session is invalidated on deploy** (tokens lack the `tokenVersion` claim → 401);
  users re-login once. This is the no-migration transition, and it is not safely avoidable —
  accepting a claim-less token reopens #124.

## Out of scope

- **Explicit "sign out everywhere" endpoint** — the mechanism (`tokenVersion++`) is left ready; the
  endpoint/UI is a trivial follow-up on #124, not built here.
- **Login rate-limiting / lockout** — separate security item, [#125](https://github.com/NauelG/astro-blocks/issues/125).
- **Changing `JWT_EXPIRY` (7d)** — long-lived tokens are safer *with* revocation; left as-is.
- Per-device / per-session revocation (`jti` + session records) — rejected at grilling; the store
  holds no per-session state and the counter is per-user by design.

## Consequences

- **New ADR**: `docs/adr/0027-stateful-session-revocation.md` — trades ADR-0007's emergent
  statelessness for revocability; ADR-0007 stays intact and its CSRF conclusion is untouched
  (token remains header-only).
- **`docs/CONTEXT.md`**: new glossary lines (`tokenVersion` / session generation, session
  revocation); the **Owner** line notes the role now resolves fresh from the store.
- **First living spec for auth**: `docs/specs/session-auth.md` (see `spec-delta.md`), created at
  Archive.
- **Release**: no bump during development; at close, this is a **security fix** — `patch` with a
  `### Fixed` (and a `### Security`-flavoured note) entry, plus a CHANGELOG line warning that all
  sessions drop on upgrade.
