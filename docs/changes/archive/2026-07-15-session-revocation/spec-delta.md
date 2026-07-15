<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Stateful session revocation (`tokenVersion`)

## ADDED: Session authentication & revocation (`session-auth.md`, new spec)

First living spec for CMS auth. Requirements:

> **R1 — Auth is a header-carried JWT, verified stateful.** The CMS API authenticates solely via a
> JWT in the `Authorization: Bearer` or `x-cms-token` header (ADR-0007 — no cookie, no CSRF
> surface). `getAuth` verifies the signature **and** re-loads the user from `users.json` on every
> authenticated request. The store is the single source of truth for identity.
>
> **R2 — The token carries only identity and generation.** The JWT holds `sub` (user id) and
> `tokenVersion`. `email` and `role` are **not** in the token; `getAuth` returns them from the store
> record. A token missing `sub` or a numeric `tokenVersion` is rejected.
>
> **R3 — `tokenVersion` is the revocation counter.** Each `User` has an integer `tokenVersion`
> (initial `1`; legacy records without it read as `1`). `getAuth` rejects (→ 401) when the user no
> longer exists or when `payload.tokenVersion !== user.tokenVersion`. Bumping a user's
> `tokenVersion` invalidates all of their live sessions at once ("sign out everywhere").
>
> **R4 — Revocation triggers.**
> - **Deletion** → the existence check rejects the token (no bump; the record is gone).
> - **Demotion** → not a rejection: the user stays authenticated, and the fresh store role makes
>   `requireOwner` return 403. Role in a token can never go stale because it is never in the token.
> - **Password change** → `tokenVersion` is incremented, revoking every previously-issued token for
>   that user.
>
> **R5 — No migration; every session drops on upgrade.** Tokens issued before `tokenVersion` existed
> carry no such claim and are rejected; users re-login once. Accepting a claim-less token would
> reopen the fail-open hole, so there is no compatibility path. Store records without the field
> normalize to `1` at read time.
>
> **R6 — Regression coverage.** Deleted-user token → 401; revoked (version-mismatch) token → 401;
> legacy claim-less token → 401; valid token returns store-sourced role (not the token's);
> demoted-owner token → `requireOwner` 403; password change → old token 401; `handlePostUsers` sets
> `tokenVersion: 1`.

## MODIFIED: Owner (glossary / behaviour)

The **Owner** definition already states the sole owner cannot be demoted or deleted. Add that a
user's **role is resolved fresh from the store on every request** — a demotion takes effect
immediately, not at token expiry. (The last-owner guard in `handlePutUser` / `handleDeleteUser` is
unchanged.)

## No other behavioural delta

- `jwtSecretMisconfigured` fail-closed behaviour, the header parsing, and `JWT_EXPIRY` (7d) are
  unchanged.
- `requireOwner` is unchanged — it simply receives the fresh role.

## Consequence for Archive

1. Create `docs/specs/session-auth.md` from the ADDED section (R1–R6).
2. Apply the MODIFIED Owner note to `docs/CONTEXT.md` §3 and land the new glossary lines
   (`tokenVersion` / session generation, session revocation) if not already committed with the fix.
3. Leave `docs/adr/0027-stateful-session-revocation.md` in place (flip its status to Accepted).
4. Move `docs/changes/session-revocation/` → `docs/changes/archive/<date>-session-revocation/`.
