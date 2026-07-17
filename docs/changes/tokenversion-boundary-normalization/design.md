<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Normalize `tokenVersion` at the store boundary

## 1. The normalizer (`src/api/data.ts`)

A single private function owns the default. It is the only place in the codebase that knows a
missing or malformed session generation reads as `1`.

```ts
/**
 * A session generation is a positive integer. Anything else on disk — absent (a record written
 * before ADR-0027), or malformed (a hand-edited file, a restored backup archive: readJson casts
 * without validating) — reads as generation 1. Coercing rather than passing the value through is
 * what keeps `getAuth`'s strict `!==` from locking a user out permanently: `"3" !== 3` and
 * `NaN !== NaN` never match.
 */
function normalizeTokenVersion(value: unknown): number {
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : 1;
}
```

| On disk | Reads as | Why it matters |
| --- | --- | --- |
| absent | `1` | legacy record, pre-3.7.0 — the live bug |
| `3` | `3` | valid; untouched |
| `"3"` | `1` | was: permanent lockout |
| `NaN` | `1` | was: permanent lockout (`NaN !== NaN`) |
| `0`, `-5`, `1.5` | `1` | not a valid generation |

## 2. `loadUsers` applies it (`src/api/data.ts:404`)

Before:

```ts
export async function loadUsers(): Promise<UsersData> {
  const data = await readJson(getDataPath('users.json'), DEFAULT_USERS);
  return Array.isArray(data.users) ? data : { ...DEFAULT_USERS, users: data.users ?? [] };
}
```

After:

```ts
export async function loadUsers(): Promise<UsersData> {
  const data = await readJson(getDataPath('users.json'), DEFAULT_USERS);
  const users = Array.isArray(data.users) ? data.users : [];
  return {
    ...data,
    users: users.map((user) => ({ ...user, tokenVersion: normalizeTokenVersion(user.tokenVersion) })),
  };
}
```

Two notes on the rewrite:

- **The non-array branch now yields `[]`.** The old expression put a non-array truthy `data.users`
  (say, an object) straight through into `users`. That value would now reach `.map` and throw, so
  the guard has to be real. Collapsing it to `[]` matches the shape the type already promises and
  the intent `DEFAULT_USERS` (`data.ts:73`, `{ users: [] }`) always had.
- **Read-only.** Nothing is persisted. This is normalization, not migration — consistent with
  ADR-0027 and `AGENTS.md`'s no-migration policy.

## 3. The scattered defaults are deleted

Once the boundary guarantees the field, the call-site defaults are dead code. Leaving them in would
re-teach the pattern that caused the bug.

```ts
// auth-core.ts:157
- if ((user.tokenVersion ?? 1) !== tokenVersion) return null;
+ if (user.tokenVersion !== tokenVersion) return null;

// users.ts:91
- tokenVersion: (current.tokenVersion ?? 1) + 1,
+ tokenVersion: current.tokenVersion + 1,
```

## 4. What does **not** change

- **`createToken` (`auth-core.ts:120-129`) is untouched.** Both callers hand it a store-loaded user
  (`auth.ts:66` from `loadUsers`; `auth.ts:49` a freshly-built record with `tokenVersion: 1`), so
  the field is guaranteed at every call. The lockout disappears *by construction*. Adding a fourth
  `?? 1` here would fix the symptom and preserve the disease.
- **Explicit writes stay explicit.** `users.ts:50` and `auth.ts:43` keep `tokenVersion: 1`. New
  records should carry the field on disk; the boundary default is for legacy and corrupt data, not
  a licence for write paths to omit it.
- **`User.tokenVersion: number` stays required.** The type was never wrong about intent — the
  boundary now makes it true instead of aspirational.
- Token shape, `JWT_EXPIRY`, header parsing, `jwtSecretMisconfigured`, `requireOwner`: all unchanged.

## 5. Tests

The bug shipped green because **8 test files build tokens with `new SignJWT(...)` by hand**
(`auth-handlers`, `media-*`, `catchall-*`) — none crosses `login → createToken → getAuth`. The
hand-signing is fine as a fixture shortcut for media/routing tests; the gap is that *no* test owns
the seam. This change closes it.

New, in `tests/auth-handlers.test.js`:

- **`handleLogin: a legacy record without tokenVersion yields a usable token`** — the regression
  test. Seed `users.json` with a record that has no `tokenVersion`, POST valid credentials to
  `handleLogin`, take the returned token, hand it to `getAuth`, assert it authenticates and reports
  the store role. **Fails on `main`** (`getAuth` → `null`). This is the deliverable.
- **`handleLogin: a record with a malformed tokenVersion yields a usable token`** — same shape with
  `tokenVersion: "3"`, covering the coercion.

Also in `tests/auth-handlers.test.js` — there is no users data-layer suite, and this file already
imports `loadUsers` / `saveUsers` from `../dist/api/data.js` and owns the `withTempProject` harness:

- **`loadUsers: normalizes absent and malformed tokenVersion to 1`** — table-driven over
  absent / `"3"` / `NaN` / `0` / `-5` / `1.5` / `3`, asserting the boundary contract directly.

Existing `tokenVersion` tests (`auth-handlers.test.js:269-343`, `users-handlers.test.js:452-530`)
stay as-is: they still describe correct behaviour and must keep passing.
