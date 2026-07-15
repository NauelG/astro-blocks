<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Stateful session revocation (`tokenVersion`)

Single vertical slice (one indivisible contract: type + token + reader), executed with TDD:
red tests first, then the change. `User.tokenVersion` being required means **typecheck does not go
green until T4** — that is why the slice lands as one commit (T7). Behavioural tests, however, are
red against current code from T1.

## T1 — Regression tests (red) ✅

- [ ] **Files:** `tests/auth-handlers.test.js` (getAuth revocation — extends the existing auth
  suite; add `getAuth` + `createToken` to its imports), `tests/users-handlers.test.js` (write paths).
  Tests import from `../dist/…` and run after `npm run build`, per the repo's test convention.
- getAuth suite (isolated via `ASTRO_BLOCKS_PROJECT_ROOT` + `withTempProject`):
  - **deleted user → `null`**: seed user, mint token, delete record, `getAuth(req)` → `null`.
  - **revoked (version mismatch) → `null`**: mint token at `tokenVersion: 1`, bump record to `2`,
    `getAuth` → `null`.
  - **legacy claim-less token → `null`**: sign a token carrying only `sub` (+ old `email`/`role`,
    no `tokenVersion`), `getAuth` → `null`.
  - **valid token → store-sourced identity**: matching version returns `{ id, email, role }` where
    `role` is the **store's** — seed the store role deliberately different from any token claim to
    prove the source.
  - **legacy record (no `tokenVersion` field) + token at v1 → passes**: proves the `?? 1` read
    default.
- users-handlers suite:
  - **demoted-owner token → `requireOwner` 403**: owner token; `PUT` role→`user`; same token now
    fails an owner-only route (403) yet still authenticates as `user`.
  - **password change invalidates old token**: mint token; `PUT` new password; old token → 401.
  - **create user sets `tokenVersion: 1`**: `handlePostUsers` → record has `tokenVersion === 1`.
- **Verify:** `npm run build && npm test` shows the behavioural tests **failing** against current
  code (deleted/demoted/password tests red — current `getAuth` trusts the payload). The type does
  not exist yet, so fixtures that build a raw `User` literal must already include `tokenVersion` to
  compile (see T2).

## T2 — Type + write paths ✅

- [ ] **Files:** `src/types/index.ts`, `src/api/handlers/auth.ts`, `src/api/handlers/users.ts`
- `User` gains required `tokenVersion: number` (`types/index.ts:218-224`).
- Bootstrap owner (`auth.ts:43`): add `tokenVersion: 1` to the `newUser` literal.
- `handlePostUsers` (`users.ts:45`): add `tokenVersion: 1` to `newUser`.
- `handlePutUser` password branch (`users.ts:82-88`): on `body.password` set, also set
  `tokenVersion: (usersData.users[index].tokenVersion ?? 1) + 1`. Role branch (`:80`) unchanged
  (no bump — fresh role covers demotion).
- Update any test fixture / helper that constructs a `User` literal to include `tokenVersion`.
- **Verify:** create-user test (`tokenVersion === 1`) green; password-bump reflected in the record.
  (Full `getAuth` tests still red until T4.)

## T3 — Token shape ✅

- [ ] **File:** `src/api/handlers/auth-core.ts`
- `createToken` (`:119-124`): signature `Pick<User, 'id' | 'tokenVersion'>`; sign
  `{ tokenVersion: user.tokenVersion }`, keep `setSubject(user.id)`; **drop** `email` and `role`
  from the payload. Callers (`auth.ts:49`, `:66`) already pass the full record — no change there.
- **Verify:** `npm run typecheck` on this file; a token-shape assertion (decoded payload has `sub`
  + `tokenVersion`, no `email`/`role`).

## T4 — Stateful `getAuth` (green) ✅

- [ ] **File:** `src/api/handlers/auth-core.ts`
- Import `loadUsers` from `../data.js` (verified acyclic — `data.ts` does not import `auth-core`).
- `getAuth` (`:127-152`): after `jwtVerify`, require `sub` and a numeric `tokenVersion` (else
  `null`); `loadUsers()`, `find` by id; `null` if not found; `null` if
  `(user.tokenVersion ?? 1) !== tokenVersion`; else return `{ user: { id, email, role } }` from the
  **store record**. `jwtSecretMisconfigured` fail-closed and the header parsing stay unchanged.
- `requireOwner` untouched (receives the fresh role).
- **Verify:** `npm run typecheck` green across the repo; `npm test` fully green (all T1 tests).

## T5 — Glossary (CONTEXT.md) ✅

- [ ] **File:** `docs/CONTEXT.md` (§3 Glossary)
- Add: **`tokenVersion` (session generation)** — a monotonic per-user counter carried in the JWT;
  the token asserts "user X at generation N", the store answers "is X still at N". A mismatch = the
  token is revoked.
- Add: **Session revocation** — bumping a user's `tokenVersion` invalidates all their live sessions
  at once ("sign out everywhere"); triggered by a password change. Deletion/demotion need no bump
  (existence check / fresh store role). (ADR-0027, #124)
- Amend **Owner**: note the role is resolved fresh from the store every request — demotion takes
  effect immediately, not at token expiry.
- **Verify:** lines read as domain language, no implementation detail leaked.

## T6 — End-to-end verification

- [ ] Playground smoke (`playgrounds/` basic):
  - Log in as owner → works. Capture a second user's token, delete that user → their API call 401s.
  - Demote an owner → their existing token fails an owner-only route (403) but still hits a `user`
    route (200).
  - Change a user's password → their old token 401s; a fresh login works.
- [ ] Confirm the upgrade path: a pre-change token (no `tokenVersion` claim) → 401.
- **Verify:** all checks observed; `npm run typecheck` + `npm test` green. No UI change → no README
  screenshots. `src/meta/features.json` reviewed at close per checklist.

## T7 — Commit

- [ ] Single commit: `feat(auth): stateful session revocation via tokenVersion`
  (T1–T5), body summarizing the fail-open hole (#124) and the store-as-source-of-truth model,
  footer `Reviewed-by: Nauel Gómez <ngomez@codiara.com>` per repo policy. No version bump /
  CHANGELOG (only at close, on request).
- **Verify:** `git show --stat` touches only: `src/types/index.ts`,
  `src/api/handlers/auth-core.ts`, `src/api/handlers/auth.ts`, `src/api/handlers/users.ts`,
  `tests/auth-handlers.test.js`, `tests/users-handlers.test.js`, `docs/CONTEXT.md`,
  `docs/adr/0027-*.md`, and this change dir.
