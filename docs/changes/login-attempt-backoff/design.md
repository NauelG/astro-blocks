<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — Exponential backoff on failed logins

## 1. Shape: a pure policy plus an effectful store

The module splits along the line that makes it testable without slow tests.

`src/api/handlers/login-throttle.ts`

```ts
/** Pure. Milliseconds to wait before answering the Nth consecutive failure. */
export function backoffDelayMs(failures: number): number;

/** Pure read: milliseconds this key currently owes. The observable used by tests. */
export function pendingBackoffMs(email: string): number;

/** Waits out any backoff owed by this key. Call BEFORE verifying credentials. */
export async function applyLoginBackoff(email: string): Promise<void>;

/** Grows this key's backoff. Call on every credential failure. */
export function recordLoginFailure(email: string): void;

/** Drops the key. Call on every successful login. */
export function clearLoginFailures(email: string): void;

/** Test seam: empties the store. Not called by production code. */
export function resetLoginThrottle(): void;
```

`backoffDelayMs` carries the whole policy and touches no state, so the schedule is unit-tested
exhaustively and instantly. Everything time-dependent is one thin function around it.

## 2. The schedule

`backoffDelayMs(failures)` is the **debt owed by failures already accrued**. It is paid by the *next*
attempt, since the wait happens before credentials are checked and can only reflect what is already
known:

| Accrued failures | Debt | Paid by |
| --- | --- | --- |
| 1 – 3 | 0 ms | — |
| 4 | 500 ms | attempt 5 |
| 5 | 1 s | attempt 6 |
| 6 | 2 s | attempt 7 |
| 7 | 4 s | attempt 8 |
| 8+ | 8 s (cap) | attempt 9+ |

So `FREE_ATTEMPTS = 3` means **four** attempts are answered immediately and the fifth is the first to
wait. Do not describe this as "three free attempts" — it is off by one.

```ts
const FREE_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;
const ATTEMPT_TTL_MS = 15 * 60_000;
const MAX_TRACKED_KEYS = 1_024;
```

Three free attempts so a typing owner is never punished. The cap exists because an unbounded delay
is an open connection an attacker can accumulate: at 8 s a sustained attacker gets ~7.5 guesses per
minute per key, down from thousands, while the owner's worst case stays under a page-load's
patience. `ATTEMPT_TTL_MS` is idle time, not a fixed window — an entry untouched for 15 minutes is
forgotten, so a legitimate owner returning later starts clean.

## 3. Placement in `handleLogin`

Four edits to `src/api/handlers/auth.ts`, none of which change its signature:

```ts
const email = ...; const password = ...;                    // :23-24 unchanged
if (!email || !password) return localizedJsonError(...);    // :25  unchanged

await applyLoginBackoff(email);                             // NEW — before any store read

// ... bootstrap path (:30-61) unchanged ...
if (result.kind === 'created') {
  clearLoginFailures(email);                                // NEW
  ...
}

const user = users.find(...);
if (!user || !(await verifyPassword(password, user.passwordHash))) {
  recordLoginFailure(email);                                // NEW
  return localizedJsonError(request, 'errors.invalidCredentials', 401);
}

clearLoginFailures(email);                                  // NEW
return Response.json({ token, ... });
```

**Order matters.** The wait happens *before* the store read and the credential check, so the caller
learns nothing until it has paid. Recording happens on the failure branch only, which is already the
single place both failure modes converge (`auth.ts:64`) — the same convergence that gives the
response its anti-enumeration property.

The 503 `jwtSecretMisconfigured` guard (`:13-18`) stays first and is not throttled: it is a
configuration answer that reveals nothing about credentials, and delaying it would only make a
misconfigured instance harder to diagnose.

**The bootstrap path needs no counter.** With an empty store, any email and password create the
owner and succeed — no credential failure is reachable, so nothing can accumulate. It calls
`clearLoginFailures` only for the raced case, where it falls through into the shared verify path.

## 4. The store, and why eviction order is a security property

```ts
type Attempt = { failures: number; lastAt: number };
const attempts = new Map<string, Attempt>();
```

Single-threaded JS makes increments atomic; no lock is needed, and the map is per-process by
construction.

The key is **attacker-controlled**. An unbounded map keyed by arbitrary emails is a
memory-exhaustion vector — swapping a brute-force defense for an OOM. Hence `MAX_TRACKED_KEYS`.

Which entry to evict is not a housekeeping detail. Evicting the least-recently-used would hand the
attacker the bypass: flood 1 024 junk emails and the entry tracking the real target is pushed out,
resetting its backoff. Eviction therefore runs in this order:

1. entries past `ATTEMPT_TTL_MS` (expired — free to drop),
2. then the **lowest `failures`** count.

A key under active attack has the highest failure count, so it is evicted last. A flood of
single-attempt junk keys evicts itself before it touches the entry that matters.

## 5. Tests

`tests/login-throttle.test.js` — the policy and the store, directly:

- `backoffDelayMs` returns `0` through `FREE_ATTEMPTS`, then doubles, then pins at `MAX_DELAY_MS`
  and never exceeds it for absurd inputs.
- `recordLoginFailure` accumulates; `clearLoginFailures` drops the key.
- An entry idle beyond `ATTEMPT_TTL_MS` is forgotten.
- **Eviction favours the attacked key:** fill the store past `MAX_TRACKED_KEYS` with single-failure
  keys while one key holds many failures; the high-failure key must survive. This is the test that
  would fail under a naive LRU, and it is the reason the requirement is written down.

`tests/auth-handlers.test.js` — the wiring, through `handleLogin`. These go in the **existing** file
rather than a new one: it already owns `withTempProject` and the owner-seeding helpers, and adding a
fourth copy of `withTempProject` would feed #47 rather than the change.

- Repeated wrong passwords grow the delay; the successful login that follows resets it.
- **An unknown email is throttled identically to a known one.** Assert both the status and the body
  are indistinguishable — this is the enumeration guard, and it is the assertion that would catch a
  future "optimization" that skips the counter when the user does not exist.
- Bootstrap (empty store) is unaffected: first login succeeds with no delay.
- The `jwtSecretMisconfigured` 503 is not delayed.

### How the delay is asserted without a slow or flaky suite

`pendingBackoffMs` exists so that **almost every assertion is a pure read**: the store's owed delay
is inspected directly, instantly, with no timers involved. That covers the schedule, the reset, the
TTL, the eviction order and the enumeration guard.

One test — and only one — proves that `applyLoginBackoff` actually honours what
`pendingBackoffMs` reports, by driving a key to `FREE_ATTEMPTS + 1` failures and asserting the call
took **at least** `BASE_DELAY_MS`. A lower bound is safe in a way an upper bound is not: a timer may
fire late on a loaded CI runner, never early. Costs 500 ms once.

`node:test` mock timers were considered and rejected: they are used nowhere in this repo today, and
introducing an unproven pattern to save 500 ms in a single test is a bad trade. Asserting an upper
bound on elapsed time is not acceptable at any point — that is a flaky test, not a fast one.

## 6. Consumer documentation

`README.md` gains a short security note: the CMS throttles repeated failed logins per email
in-process, this does not survive restart nor span instances, and **a reverse-proxy rate limit is
the expected production layer**. Stating the limit is the point — an operator who believes this
replaces a proxy rule is worse off than one who knows it does not.
