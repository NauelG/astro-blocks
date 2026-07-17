<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Normalize `tokenVersion` at the store boundary

Target: `docs/specs/session-auth.md`. No new capability — R5 already claimed read-time
normalization; the code never delivered it on the token-issuing path. This delta makes the spec
say **where** the invariant is established, so it can be implemented once instead of remembered
at every call site.

## MODIFIED: R3 — `tokenVersion` is the revocation counter

Was: *"Each `User` has an integer `tokenVersion` (initial `1`; legacy records without it read as
`1`)."* — true of intent, but silent about who guarantees it, which is exactly what went wrong.

> **R3 — `tokenVersion` is the revocation counter.** Each `User` has an integer `tokenVersion`
> (initial `1`). Every record returned by the store carries a **positive integer** — the store
> boundary guarantees it (R5), so no consumer defaults or validates it. `getAuth` rejects (→ 401)
> when the user no longer exists, or when `payload.tokenVersion !== user.tokenVersion`. Bumping a
> user's `tokenVersion` invalidates all of their live sessions at once ("sign out everywhere").

## MODIFIED: R5 — No migration; normalization at the store boundary

Was: *"Store records without the field normalize to `1` at read time."* — aspirational. It named no
owner, so the default was replicated at each consumer and the one that issues tokens
(`createToken`) was missed: a legacy record logged in successfully and received a token with no
claim, which `getAuth` then rejected forever.

> **R5 — No migration; normalization at the store boundary.** Tokens issued before `tokenVersion`
> existed carry no such claim and are rejected; users re-login once. Accepting a claim-less token
> would reopen the fail-open hole, so there is no compatibility path.
>
> On the store side there is likewise no migration — records are normalized on **read**, never
> rewritten. `loadUsers` is the **sole** reader of `users.json` and the **sole** owner of the
> default: every record it returns has `tokenVersion` coerced to a positive integer. Absent (a
> pre-ADR-0027 record) or malformed (`"3"`, `NaN`, `0`, `-5`, `1.5` — the store casts JSON without
> validating, and `restore` writes an uploaded archive straight through) both read as `1`.
> Coercion, not pass-through: `getAuth` compares strictly, so a malformed value that survived the
> boundary would never match any claim and would lock the user out permanently.
>
> Consumers therefore do not default the field. A record loaded from the store satisfies the type.

## MODIFIED: R6 — Regression coverage

Adds the seam the original suite never crossed. Every existing case stays.

> **R6 — Regression coverage.** Deleted-user token → 401; revoked (version-mismatch) token → 401;
> legacy claim-less token → 401; a valid token returns the store-sourced role (not the token's);
> demoted-owner token → `requireOwner` 403; password change → old token 401; `handlePostUsers` sets
> `tokenVersion: 1`.
>
> **The token-issuing seam is covered end-to-end**: a legacy record (no `tokenVersion`) and a
> malformed record (`tokenVersion: "3"`) must each traverse `handleLogin → createToken → getAuth`
> and authenticate. Hand-signed JWT fixtures do not satisfy this requirement — they bypass
> `createToken`, which is where the lockout lived. The store contract is covered directly:
> `loadUsers` normalizes absent / `"3"` / `NaN` / `0` / `-5` / `1.5` to `1` and passes `3` through.

## MODIFIED: Boundaries & unchanged behaviour

Appends one bullet:

> - `tokenVersion` normalization is **read-only and per-record**; it never writes, and it never
>   moves a counter *backwards* in the store. Restoring a backup does: `restore` replaces
>   `users.json` wholesale, so a pre-bump archive returns a user to an older generation and re-arms
>   any token of that generation for the remainder of its lifetime. The counter is monotonic in
>   normal operation, **not across a restore** — tracked separately.
