<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec — Session authentication & revocation

> Living specification. Describes the current behavior of CMS session authentication and
> revocation. Changed via the cycle's `spec-delta.md` mechanism (see `AGENTS.md`). History:
> inaugurated by change `session-revocation` (#124, ADR-0027); R3/R5/R6 sharpened by
> `tokenversion-boundary-normalization` (2026-07-17), which moved the `tokenVersion` default to the
> store boundary after a legacy-record lockout.

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

## Boundaries & unchanged behaviour

- `jwtSecretMisconfigured` fail-closed behaviour (production refuses the built-in fallback secret),
  the header parsing, and the 7-day token lifetime (`JWT_EXPIRY`) are unchanged.
- `requireOwner` is unchanged — it simply receives the fresh store role.
- Revocation is **per-user**, not per-session: there is no `jti` and no per-device sign-out. An
  explicit "sign out everywhere" endpoint is not yet exposed (the mechanism is in place).
- `tokenVersion` normalization is **read-only and per-record**; it never writes, and it never moves a
  counter *backwards* in the store. Restoring a backup does: `restore` replaces `users.json`
  wholesale, so a pre-bump archive returns a user to an older generation and re-arms any token of
  that generation for the remainder of its lifetime. The counter is monotonic in normal operation,
  **not across a restore** — tracked in [#134](https://github.com/NauelG/astro-blocks/issues/134).
