<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Stateful session revocation (`tokenVersion`)

## 1. The type (`src/types/index.ts`)

`User` gains a required `tokenVersion`:

```ts
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: 'owner' | 'user';
  tokenVersion: number;   // session generation; bumped to revoke all live sessions
  createdAt?: string;
}
```

Required, not optional: every write path sets it. Legacy JSON records that predate the field are
tolerated only at the **read** boundary in `getAuth` (`?? 1`), never by widening the type.

## 2. Token shape (`src/api/handlers/auth-core.ts`)

`createToken` stops signing `email` / `role` and signs the generation instead:

```ts
export async function createToken(user: Pick<User, 'id' | 'tokenVersion'>): Promise<string> {
  return new SignJWT({ tokenVersion: user.tokenVersion })
    .setSubject(user.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}
```

## 3. `getAuth` becomes stateful

```ts
import { loadUsers } from '../data.js';   // acyclic: data.ts does not import auth-core

export async function getAuth(request: Request): Promise<AuthResult | null> {
  if (jwtSecretMisconfigured()) return null;   // unchanged fail-closed

  const token = /* unchanged: Bearer header || x-cms-token */;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const id = payload.sub;
    const tokenVersion = payload.tokenVersion;
    // A token missing either claim is a legacy/malformed token → reject.
    if (!id || typeof tokenVersion !== 'number') return null;

    const { users } = await loadUsers();
    const user = users.find((u) => u.id === id);
    if (!user) return null;                              // deleted → 401
    if ((user.tokenVersion ?? 1) !== tokenVersion) return null;  // revoked → 401

    // Store is the source of truth for email + role (fresh role closes fail-open demotion).
    return { user: { id: user.id, email: user.email, role: user.role } };
  } catch {
    return null;
  }
}
```

Notes:

- `requireOwner` is **unchanged** — it now receives the fresh store role, so a demoted owner gets a
  403 with no code change there.
- `getAuth` never distinguishes "deleted" from "revoked" to the caller: both are `null` → 401. Role
  is not a `getAuth` concern; authorization stays in `requireOwner`.

## 4. Write paths set / bump `tokenVersion`

| Path | File | Change |
|---|---|---|
| Bootstrap owner | `auth.ts:43` | `{ id, email, passwordHash, role: 'owner', tokenVersion: 1, createdAt }` |
| Create user | `users.ts:45` (`handlePostUsers`) | add `tokenVersion: 1` to `newUser` |
| **Password change** | `users.ts:82-88` (`handlePutUser`) | on `body.password` set: `tokenVersion: (usersData.users[index].tokenVersion ?? 1) + 1` |

Role change in `handlePutUser` (`:80`) does **not** bump — fresh role read covers demotion.
`createToken` callers (`auth.ts:49`, `:66`) already pass the full `user`; they now supply
`tokenVersion` for free via the record.

## 5. Tests (TDD — written first, red, then the change)

`node --test` + `withTempProject`, handler contract isolated via `ASTRO_BLOCKS_PROJECT_ROOT`.

### `tests/auth-core.test.js` (or the existing auth-core suite)

- **Deleted user → 401**: seed a user, mint a token, delete the record, `getAuth` → `null`.
- **Revoked (version mismatch) → 401**: mint a token at `tokenVersion: 1`, bump the record to `2`,
  `getAuth` → `null`.
- **Legacy token (no `tokenVersion` claim) → 401**: sign a token with only `sub` (old shape),
  `getAuth` → `null`.
- **Valid token → passes**: matching version returns `{ id, email, role }` **from the store** —
  assert the role is the store's, not the token's (seed store role different from any token claim to
  prove the source).
- **Legacy record (no `tokenVersion` field) + token at v1 → passes**: proves the `?? 1` read default.

### `tests/users-handlers.test.js`

- **Demoted-owner token → `requireOwner` 403**: owner token, `PUT` role→`user`, same token now
  fails owner gate (403) but still authenticates as `user`.
- **Password change invalidates old token**: mint token, `PUT` new password, old token → 401
  (record `tokenVersion` incremented).
- **Create user sets `tokenVersion: 1`**: `handlePostUsers` → record has `tokenVersion === 1`.

## 6. Verification bar

1. `npm run typecheck` + `npm test` green.
2. Manual smoke in the playground:
   - Log in as owner → works. Delete a second user whose token you captured → their API call 401s.
   - Demote an owner → their existing token can no longer hit an owner-only route (403) but can hit
     a `user` route (200).
   - Change a user's password → their old token 401s; new login works.
3. Confirm every session drops on the upgrade path (old token → 401), matching the no-migration
   decision.

No UI change → no README screenshots. `src/meta/features.json` reviewed at close per checklist.

## 7. Commit sequence

TDD, test + change land red→green within each commit. Grouped so each commit is coherent:

1. `feat(auth): stateful session revocation via tokenVersion`
   — `User.tokenVersion`, `createToken` shape, stateful `getAuth`, write-path sets/bump, all tests,
   `CONTEXT.md` glossary lines, ADR-0027.

(One commit is defensible here — the type, the token and the reader are a single indivisible
contract change; splitting them leaves an intermediate state that does not typecheck.)

Release bump + CHANGELOG happen only at close, on the human's request, per policy.
