<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Normalize `tokenVersion` at the store boundary

One vertical slice: the store boundary establishes the invariant and the consumers stop defending
it. TDD — T1 goes red against `main`, T2 turns it green, T3 removes the now-dead defences. No type
change, so `typecheck` stays green throughout and the slice lands as a single commit (T5).

Tests import from `../dist/…`, so every verify step is `npm run build && npm test`.

## T1 — Regression tests (red)

- [x] **File:** `tests/auth-handlers.test.js` — it already imports `loadUsers` / `saveUsers` from
  `../dist/api/data.js` and `getAuth` / `handleLogin` from `../dist/api/handlers.js`, and owns the
  `withTempProject` + `loginOwner` + `authRequest` harness. No new test file.
- Add a section under the existing `tokenVersion` block (after `:343`):
  - **`handleLogin: a legacy record without tokenVersion yields a token getAuth accepts`** — the
    regression test. Bootstrap via `loginOwner()` (produces a real `passwordHash`), then
    `delete stored.users[0].tokenVersion` + `saveUsers` to simulate a pre-ADR-0027 record. Log in
    **again** through `handleLogin`, take the returned token, assert `getAuth(authRequest(token))`
    is non-null and reports `role === 'owner'`.
  - **`handleLogin: a record with a malformed tokenVersion yields a token getAuth accepts`** — same
    shape, setting `tokenVersion = '3'` (string). Covers the coercion.
  - **`loadUsers: normalizes absent and malformed tokenVersion to 1`** — write `users.json` via
    `saveUsers` with one record per case and assert the value `loadUsers` returns:
    absent → `1`, `'3'` → `1`, `NaN` → `1`, `0` → `1`, `-5` → `1`, `1.5` → `1`, `3` → `3`.
    (`NaN` does not survive `JSON.stringify` — it serializes to `null`; that still lands on the
    invalid branch and must read as `1`. Assert the intent, not the wire form.)
- **Do not** hand-sign tokens in the two `handleLogin` tests. Crossing
  `handleLogin → createToken → getAuth` for real is the entire point — `:328` already seeds a legacy
  record and passes today precisely because it forges the token at `:343` and skips the broken path.
- **Verify:** `npm run build && npm test` — the three new tests **fail** against current code
  (`getAuth` → `null`; the `loadUsers` cases return the raw stored value). Every other test stays
  green.

## T2 — Normalize at the boundary (green)

- [x] **File:** `src/api/data.ts`
  - Add the private `normalizeTokenVersion(value: unknown): number` helper
    (`Number.isInteger(value) && value >= 1 ? value : 1`) with the doc comment from `design.md` §1 —
    it must say *why* it coerces rather than passes through (`getAuth` compares strictly, so a
    malformed value that survives is a permanent lockout).
  - Rewrite `loadUsers` (`:404`) to map every record through it. The non-array branch collapses to
    `[]` (see `design.md` §2) — it must be a real guard now that `.map` runs on the result.
  - Read-only: nothing is persisted.
- **Verify:** `npm run build && npm test` — the three T1 tests pass. `npm run typecheck` green.

## T3 — Remove the scattered defences (refactor)

- [x] **Files:** `src/api/handlers/auth-core.ts:157`, `src/api/handlers/users.ts:91`
  - `(user.tokenVersion ?? 1) !== tokenVersion` → `user.tokenVersion !== tokenVersion`
  - `(current.tokenVersion ?? 1) + 1` → `current.tokenVersion + 1`
  - `createToken` (`auth-core.ts:120-129`) is **not** touched — see `design.md` §4. Adding a `?? 1`
    there would fix the symptom and keep the disease.
  - The explicit `tokenVersion: 1` writes at `users.ts:50` and `auth.ts:43` **stay**.
- **Verify:** `npm run build && npm test && npm run typecheck` — all green, including the existing
  `tokenVersion` suites (`auth-handlers.test.js:269-343`, `users-handlers.test.js:452-530`), which
  must keep passing untouched.

## T4 — Documentation

- [x] **File:** `docs/CONTEXT.md:119` — the `tokenVersion` glossary line gains where the invariant is
  established: every record the store returns carries a positive integer, guaranteed by `loadUsers`;
  consumers do not default it. Keep it a glossary line — no implementation detail (`AGENTS.md`
  routing).
- [x] Do **not** touch `docs/adr/0027-*.md` — immutable, and its decision is unchanged. Its
  "Must watch" note (`:87-89`) stays wrong-but-historical; `session-auth.md` R5 becomes the accurate
  statement after Archive.
- **Verify:** `docs/CONTEXT.md:119-120` reads true against the code, and claims no monotonicity that
  `restore` breaks (that contradiction is [#134](https://github.com/NauelG/astro-blocks/issues/134)).

## T5 — Commit

- [x] Single commit, Conventional Commits, English, with `Reviewed-by` from `git config`:
  `fix(auth): normalize tokenVersion at the store boundary`
- Body: legacy records were locked out entirely — `createToken` signed `undefined`, `JSON.stringify`
  dropped the claim, `getAuth` rejected the token it had just caused to be issued. Reference #124 /
  ADR-0027; note the suite missed it because the tests hand-signed their JWTs.
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is a `patch` with a `### Fixed` entry.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.
