<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Tasks — Exponential backoff on failed logins

One vertical slice. T1 goes red against `main`, T2–T3 turn it green, T4 documents the limit for
consumers.

`npm test` already runs `npm run build` first (`package.json:70`), and tests import from `../dist/…`,
so every verify step is plain `npm test`.

> **Where the red comes from.** There is no timing guesswork here. The store's owed delay is a pure
> read (`pendingBackoffMs`), so the schedule, the reset, the TTL, the eviction order and the
> enumeration guard are all asserted synchronously. Exactly one test touches the clock, and it
> asserts a **lower** bound — a timer can fire late, never early. Any assertion that a call finished
> *within* some time is flaky and must not be written.

> **⚠ The throttle is module-level state that outlives a single test.** `node --test tests/*.test.js`
> runs a file's tests in one process, and `tests/auth-handlers.test.js` already drives `handleLogin`
> with bad passwords repeatedly (`:126` and after), reusing the same seeded email. Once T3 lands,
> those failures accumulate across **unrelated** tests: past `FREE_ATTEMPTS` the suite starts sleeping
> for real, and the slowdown will look like a mystery rather than a leak. Every file that touches
> `handleLogin` must call `resetLoginThrottle()` per test. This is the single most likely way this
> change goes wrong, and it will present as "the suite got slow", not as a failure.

## T1 — Throttle policy and store tests (red)

- [x] **File:** `tests/login-throttle.test.js` — new. Pure module, no `withTempProject` needed.
  Imports from `../dist/api/handlers/login-throttle.js`. Call `resetLoginThrottle()` in a
  `beforeEach` so ordering between tests cannot matter.
  - **`the first FREE_ATTEMPTS failures are free`** — `backoffDelayMs(1..3)` is `0`.
  - **`the delay doubles from BASE_DELAY_MS and pins at MAX_DELAY_MS`** — `4 → 500`, `5 → 1000`,
    `6 → 2000`, `7 → 4000`, `8 → 8000`, and `9`, `50`, `10_000` all stay at `8000`. Absurd inputs
    must not overflow into a delay nobody can sit through.
  - **`recording failures accumulates, a clear drops the key`** — `pendingBackoffMs` reflects both.
  - **`an entry idle past ATTEMPT_TTL_MS is forgotten`** — a returning owner starts clean.
  - **`eviction keeps the key under attack`** — drive one key to many failures, then flood past
    `MAX_TRACKED_KEYS` with single-failure keys; the high-failure key must survive and keep its
    count. **This is the test that fails under a naive LRU**, and it is the reason the requirement is
    written down rather than left to the implementer's taste.
- [x] **File:** `tests/auth-handlers.test.js` — extend; do **not** create a new file. It already owns
  `withTempProject` (`:45`) and the seeding helpers; a fourth copy of that helper would feed #47.
  - Call `resetLoginThrottle()` inside `withTempProject` (or a `beforeEach`) so the module state
    cannot leak between the file's existing tests — see the warning above.
  - **`repeated wrong passwords grow the delay, a success resets it`** — through `handleLogin`,
    asserted via `pendingBackoffMs`.
  - **`an unknown email is throttled exactly like a known one`** — assert the owed delay is equal
    **and** that status and body are indistinguishable. This is the enumeration guard: it is what
    catches a future "optimization" that skips the counter when the user does not exist.
  - **`applyLoginBackoff actually waits`** — the single clock-touching test. Drive a key to
    `FREE_ATTEMPTS + 1`, assert the login took **at least** `BASE_DELAY_MS`. Lower bound only.
  - **`bootstrap on an empty store is not delayed`** — first login creates the owner and returns
    immediately.
  - **`the jwtSecretMisconfigured 503 is not delayed`** — a configuration answer reveals nothing
    about credentials, and delaying it only makes a broken instance harder to diagnose.
- **Verify:** `npm test` — the new tests fail (the module does not exist yet). No other suite changes.

## T2 — The throttle module

- [x] **File:** `src/api/handlers/login-throttle.ts` — new, with the BSL copyright header.
  - The five exports of `design.md` §1 plus `pendingBackoffMs`, and the constants of §2.
  - `backoffDelayMs` is **pure** — no `Date.now()`, no map access. Everything time- or state-dependent
    composes around it.
  - The doc comment must carry the two facts that are not inferable from the code: the key is the
    email **and deliberately not the client address** (ADR-0032, or the next reader "fixes" it), and
    the eviction order is **a security property, not housekeeping** — expired first, then fewest
    failures, never LRU.
- **Verify:** `npm test && npm run typecheck` — the `login-throttle.test.js` tests pass; the
  `auth-handlers.test.js` additions still fail (nothing is wired yet).

## T3 — Wire it into `handleLogin` (green)

- [x] **File:** `src/api/handlers/auth.ts` — the four edits of `design.md` §3. The signature does not
  change and `catchall.ts` is untouched.
  - `await applyLoginBackoff(email)` after the `:25` guard, **before** the store read — the caller
    learns nothing until it has paid.
  - `recordLoginFailure(email)` on the `:64` failure branch only. That branch is already where both
    failure modes converge; keeping it single is what preserves the uniform 401.
  - `clearLoginFailures(email)` on both success returns (`:52` bootstrap-created, `:68` verified).
  - The `jwtSecretMisconfigured` guard (`:13-18`) stays first and unthrottled.
- **Verify:** `npm test` — all T1 tests pass. `tests/auth-handlers.test.js`'s existing suite and
  `tests/import-export-bootstrap.test.js` stay green untouched.

## T4 — Consumer documentation

- [x] **File:** `README.md` — a short security note per `design.md` §6: failed logins are throttled
  per email, in-process; this does not survive a restart nor span instances; **a reverse-proxy rate
  limit is the expected production layer**.
  - State the limit plainly. An operator who believes this replaces a proxy rule is worse off than
    one who knows it does not.
  - Consumer-facing only — no build or maintenance notes (`AGENTS.md` *Documentación*).
- [x] **File:** `AGENTS.consumer.md` — same limitation, one line, since it ships in the tarball
  (ADR-005) and is what a consumer's agent reads.
- **Verify:** `npm run features:validate`.

## T5 — Full verification

- [x] `npm test && npm run typecheck && npm run check` — `npm test` does **not** run Biome;
  `check` is `biome ci .` and is a separate gate.
- [x] Confirm the suite did not get slower: no file that drives `handleLogin` may accumulate
  throttle state (see the warning at the top).
- [x] `npm run features:validate`.
- [x] `npm run e2e` — the admin login drives this path for real. `npm run e2e` does **not** rebuild
  the playground; run `npm run build:playground` first or it tests a stale `dist`.
- [x] Confirm the throttle has exactly one caller: `grep -rn "login-throttle" src/`.

## T6 — Commit

- [x] Single commit, Conventional Commits, English, `Reviewed-by` from `git config`:
  `fix(auth): throttle repeated failed logins with capped exponential backoff`
- Body: what was missing (no attempt counter of any kind; scrypt bounds cost per guess, not the
  number of guesses), and the two decisions that go against the issue's stated fix direction — the
  client address is not a usable key, and lockout is a self-inflicted DoS on a single-owner CMS.
  Note that the response is deliberately byte-identical to an ordinary failure, so the
  anti-enumeration property is preserved. Reference #125, ADR-0032.
- No version bump, no `CHANGELOG` entry — those happen only when the human asks to close
  (`AGENTS.md` *Versionado*). At close this is a `patch` with a `### Fixed` entry.
- **Verify:** `git log -1` shows no agent attribution and a `Reviewed-by` footer.

## Deviations from the plan (2026-07-20)

Three, all found during implementation and all changing the plan rather than working around it.

**The `jwtSecretMisconfigured` 503 test was dropped as unreachable.** `JWT_SECRET_STATUS` is a
module-level `const` evaluated at import (`auth-core.ts:67`), so reaching the 503 branch would
require `NODE_ENV=production` set *before* the module is imported — impossible from a file that has
already imported it. The ordering is still structurally guaranteed: the guard returns at `auth.ts:13`
before `applyLoginBackoff` is reachable at all. A test that appeared to cover this without being
able to would be worse than none.

**Eviction became batched, after the naive version turned out to be a CPU amplifier.** Evicting
exactly the excess meant sorting the whole map on *every* failed login once the cap was reached —
under the flood this code exists to survive, that is ~1 024·log(1 024) of work per attacker request,
on the defended path. It now reclaims `MAX_TRACKED_KEYS / 8` per sweep so the sort amortizes.
Measured on the eviction tests: **96 ms → 1.9 ms** and **55 ms → 1.7 ms**, with the
attacked-key-survives assertion unchanged and still passing.

**The enumeration test was restructured to stop sleeping.** It compared responses *after* accruing
past the free attempts, so it sat through two real backoffs. Comparing them while both keys are
still inside the free window is the same assertion for 0 ms; the accrual is then compared with the
pure read. **1 170 ms → 404 ms.**

### Cost, measured honestly

Suite wall-clock has real variance (`node --test` runs files concurrently): `main` measured
**4 407 ms**; with this change, **5 990–8 212 ms** across runs. The added cost is ~2 s and it is
concentrated in the two tests that must sit through genuine backoff — `the owed backoff is actually
waited out` and `repeated wrong passwords grow the backoff`. That is inherent to asserting a real
delay and is the price of covering it at all.

The first measurement taken during implementation (4 883 ms) was **not** a valid baseline: both new
test files were failing on import at that point and contributed ~0 ms. The 4 407 ms figure is from
`main` with the change stashed.

## Review findings (2026-07-20)

Reviewing the diff against `spec-delta.md` confirmed the substance — the key is the email and
nothing else, the failure branch stays single so the 401 remains uniform, the store is bounded, and
eviction favours the attacked key. It found one real defect, in the documentation rather than the
code.

- **The schedule was described off by one, in three places.** `spec-delta.md` said "`FREE_ATTEMPTS`
  (3) consecutive failures are free", and `design.md`'s table read as though the 4th attempt waits
  500 ms. Neither is what happens. The debt owed by N accrued failures is paid by the **N+1th**
  attempt, because `applyLoginBackoff` runs *before* credentials are checked and can only reflect
  failures already recorded. Traced against the built module: attempts 1–4 pay `0ms`, attempt 5 pays
  `500ms`, 6 pays `1000ms`, 7 pays `2000ms`. So three free *failures* means **four** un-delayed
  *attempts*. Corrected in the delta, in `design.md`'s table (now "accrued failures / debt / paid
  by"), and on the `FREE_ATTEMPTS` constant itself, which is where the next reader will look.
  - The tests were right throughout — they assert `pendingBackoffMs` after a given number of
    recorded failures, which is the debt, not the attempt count. The prose disagreed with the code
    the tests pinned, which is the harder version of this bug to notice.
- **`spec-delta.md` did not record why eviction reclaims a batch.** Added: a per-insertion sweep
  would sort the whole store on every failed login past the cap, making the defense a CPU amplifier
  under the flood it exists to survive. Left unstated, "simplify it to evict exactly the excess"
  reads like a cleanup rather than a regression.

**Worth naming:** the off-by-one passed every gate — 1304 unit tests, typecheck, biome, 14 e2e — and
could not have been caught by any of them, because the tests and the code agreed with each other and
only the prose was wrong. It was found by tracing what each successive attempt actually pays instead
of re-reading the table that claimed it.
