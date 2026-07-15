<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# 0027 — Stateful session revocation via `tokenVersion`

- **Status:** Accepted — 2026-07-15
- **Date:** 2026-07-15
- **Decisores:** Nauel Gómez
- **Source:** Issue [#124](https://github.com/NauelG/astro-blocks/issues/124) (P1, security), grilled 2026-07-15

## Contexto

ADR-0007 established token-in-header JWT auth as the sole mechanism for the CMS API and — as an
emergent property, never a stated requirement — treated the token as **stateless**: `getAuth`
verified the signature and read `sub` / `email` / `role` straight from the payload, never touching
the store. Its "Consequences" section flagged the boundary explicitly: *"this reasoning is only
valid as long as…"*.

That statelessness is exactly what issue #124 exploits. With a 7-day token lifetime and no store
read, a **deleted or demoted user keeps full API access until the token expires**. Demotion is
*fail-open*: a stale `role: 'owner'` claim still satisfies `requireOwner`. There is no logout, no
`jti`, no token-version, no deny-list — no way to revoke a live session at all.

Three mechanisms were weighed at grilling:

1. **Stateful re-validation** — read the user from the store on every authenticated request and
   validate against `users.json`.
2. **In-memory `jti` deny-list** — keep the token authoritative, hold a set of revoked ids in
   memory. Rejected: the set does not survive a restart and is simply absent on a fresh serverless
   invocation — the very environment this repo targets (ADR-0009's baked-artifact reasoning). A
   revocation that silently forgets itself is worse than none.
3. **Short access token + refresh token** — bounds the window without a store read, at the cost of
   an entire refresh flow. Rejected as scope disproportionate to a file-based, single-node CMS.

## Decisión

`getAuth` becomes **stateful**: it re-loads the user from `users.json` on every authenticated
request and the **store is the single source of truth** for identity. Revocation is expressed as a
monotonic per-user counter, `tokenVersion`.

Concretely:

- `User` gains a required integer field **`tokenVersion`** (initial value `1`). Legacy records
  without it read as `1` (`user.tokenVersion ?? 1`); no data migration.
- The **JWT is reduced to identity + generation**: `sub` (user id) and a `tokenVersion` claim.
  `email` and `role` are **dropped from the token** and read fresh from the store. A claim that
  drives an authorization decision but can go stale is the #124 defect by construction; removing it
  makes the whole fail-open class impossible, not merely watched.
- `getAuth` returns `null` (→ 401) when: no token · bad signature · expired · missing `sub` or
  `tokenVersion` · user not found · `payload.tokenVersion !== user.tokenVersion`. Otherwise it
  returns `{ id, email, role }` sourced **from the store record**.
- **Demotion is not a `getAuth` rejection.** A demoted owner stays authenticated as `user`; the
  fresh store role makes `requireOwner` return 403 immediately. Deletion is caught by the
  existence check.
- The counter is bumped (`tokenVersion + 1`) **only on password change**. That single write turns
  `tokenVersion` into a real revocation primitive: changing a compromised password kills every live
  session for that user. Delete needs no bump (existence), demotion needs no bump (fresh role).
- An explicit "sign out everywhere" endpoint is **out of scope** — it is a one-line `tokenVersion++`
  on the mechanism this ADR establishes, deferred to its own cycle.

### Relationship to ADR-0007

ADR-0007 is **not superseded**; it remains correct that auth is header-only and carries no CSRF
surface. This ADR resolves the boundary ADR-0007 named: it trades that ADR's emergent statelessness
for revocability. The token stays header-only — no cookie, no ambient credential — so ADR-0007's
CSRF conclusion is untouched.

### Transition (no migration, per repo policy)

Tokens issued before this change carry no `tokenVersion` claim and are **rejected** — every active
session is invalidated on deploy and users re-login once. Accepting a claim-less legacy token would
mean trusting the payload again, i.e. reopening #124; there is no safe softer path. Store records
without the field normalize to `1` on read.

## Consecuencias

- **Easier:** a live session can finally be revoked. Deleted users lose access instantly; demoted
  owners lose owner powers instantly; a password change is a "sign out everywhere". The token can no
  longer carry a stale privilege.
- **Cost:** one `loadUsers()` read per authenticated request. On a file-based single-node CMS this
  is reading a small JSON — negligible, and it buys single-source-of-truth. `getAuth` now depends on
  the data layer (`auth-core.ts` → `data.ts`; verified acyclic — `data.ts` does not import
  `auth-core`).
- **Must watch:** every user-creation path must set `tokenVersion: 1` (login bootstrap,
  `handlePostUsers`); a path that forgets it relies on the `?? 1` read-time default. The bump on
  password change lives in `handlePutUser` — if a self-service password-change endpoint is ever
  added, it must bump too.
- **Deploy impact:** all sessions drop on the release that ships this. Expected for an auth change;
  worth a line in the CHANGELOG entry at close.
- **Follow-up:** "sign out everywhere" (#124 leaves the mechanism ready), and login rate-limiting
  (#125) remain separate.
