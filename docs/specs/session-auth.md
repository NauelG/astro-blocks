<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Session authentication & revocation

> Living specification. Describes the current behavior of CMS session authentication and
> revocation. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`). History:
> inaugurated by change `session-revocation` (#124, ADR-0027).

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
(initial `1`; legacy records without it read as `1`). `getAuth` rejects (→ 401) when the user no
longer exists, or when `payload.tokenVersion !== user.tokenVersion`. Bumping a user's `tokenVersion`
invalidates all of their live sessions at once ("sign out everywhere").

**R4 — Revocation triggers.**

- **Deletion** → the existence check rejects the token (no bump; the record is gone).
- **Demotion** → not a rejection: the user stays authenticated, and the fresh store role makes
  `requireOwner` return 403. A role can never go stale in a token because it is never in the token.
- **Password change** → `tokenVersion` is incremented, revoking every previously-issued token for
  that user.

**R5 — No migration; every session drops on upgrade.** Tokens issued before `tokenVersion` existed
carry no such claim and are rejected; users re-login once. Accepting a claim-less token would reopen
the fail-open hole, so there is no compatibility path. Store records without the field normalize to
`1` at read time.

**R6 — Regression coverage.** Deleted-user token → 401; revoked (version-mismatch) token → 401;
legacy claim-less token → 401; a valid token returns the store-sourced role (not the token's);
demoted-owner token → `requireOwner` 403; password change → old token 401; `handlePostUsers` sets
`tokenVersion: 1`.

## Boundaries & unchanged behaviour

- `jwtSecretMisconfigured` fail-closed behaviour (production refuses the built-in fallback secret),
  the header parsing, and the 7-day token lifetime (`JWT_EXPIRY`) are unchanged.
- `requireOwner` is unchanged — it simply receives the fresh store role.
- Revocation is **per-user**, not per-session: there is no `jti` and no per-device sign-out. An
  explicit "sign out everywhere" endpoint is not yet exposed (the mechanism is in place).
