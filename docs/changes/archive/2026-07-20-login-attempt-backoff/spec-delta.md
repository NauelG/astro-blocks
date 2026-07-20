<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Spec delta — Exponential backoff on failed logins

Target: `docs/specs/session-auth.md`. Adds one requirement (R8) and extends the
*Boundaries & unchanged behaviour* section. R1–R7 are untouched: this changes nothing about how a
token is verified, only how often a token may be *asked for*.

## ADDED: R8 — Failed logins are progressively delayed, keyed by email

Repeated credential failures for the same email address are answered with a growing delay:
`FREE_ATTEMPTS` (3) accrued failures owe nothing, then the debt doubles from `BASE_DELAY_MS`
(500 ms) up to `MAX_DELAY_MS` (8 s), where it pins. A successful login clears the key. An entry idle
for longer than `ATTEMPT_TTL_MS` (15 min) is forgotten, so a returning owner starts clean.

**The debt accrued by N failures is paid by the N+1th attempt**, not by the request that incurs it —
the wait happens before credentials are checked, so it can only reflect what is already known.
`FREE_ATTEMPTS` (3) therefore means **four** attempts are answered with no delay; the fifth is the
first to wait. Stating it as "three free attempts" is off by one and misreads the schedule.

**The key is the normalized email, and nothing else.** The client address is deliberately not part
of it (ADR-0032): Astro resolves it as `x-forwarded-for || socket.remoteAddress`, which is either
unspoofable but shared by every caller behind a proxy, or attacker-controlled — and a distributable
package cannot tell which of the two it holds. Keying on it would let an attacker rotate the header
for unlimited attempts, and would let them forge a victim's address to throttle a third party.

**The delay is the only observable.** A throttled attempt returns the same
`401 errors.invalidCredentials` as any other failure, with no `Retry-After` and no distinct status.
The delay applies identically whether or not the email exists in the store. This preserves the
anti-enumeration property of R1's single failure response: a lockout status that only ever appeared
for real accounts would enumerate them.

**It is a delay, not a lockout.** The CMS has a single owner; denying that account after N failures
would let any unauthenticated caller make the instance unadministrable. Backoff never shuts the
owner out — it only makes sequences of guesses slow.

**The attempt store is bounded and evicts by failure count, not recency.** It is in-process memory,
keyed by an attacker-controlled value, so it is capped (`MAX_TRACKED_KEYS`, 1 024). Eviction drops
expired entries first, then those with the **fewest** failures. Least-recently-used eviction would
be a bypass: flooding the store with junk keys would evict the entry tracking the account actually
under attack. A key under attack has the highest failure count and is therefore evicted last.

**A sweep reclaims a batch, not just the excess.** Evicting exactly one entry per insertion would
sort the whole store on *every* failed login once the cap is reached — turning the defense into a
CPU amplifier under precisely the flood it exists to survive. Reclaiming a batch amortizes the sort
across many insertions. This is a security property of the eviction path, not a performance tweak.

**What this does and does not bound.** Backoff bounds the rate a key sustains **over time**. It does
not bound a burst of concurrent requests that all arrive before any counter increments; against
that, the per-guess cost of scrypt is what limits throughput. The two compose and neither is
sufficient alone. The counter does not survive a restart and does not span instances — a
reverse-proxy rate limit remains the expected production layer, and this is defense in depth.

**Regression coverage.** The delay schedule is pure and covered directly (free attempts, doubling,
cap, absurd inputs). Through `handleLogin`: repeated failures grow the delay and a success resets
it; an **unknown email is throttled indistinguishably from a known one** in both status and body;
bootstrap on an empty store is unaffected; the `jwtSecretMisconfigured` 503 is not delayed. Eviction
is covered by the case that separates it from LRU — a high-failure key must survive a flood of
single-failure keys. Delays are asserted with mock timers, never by elapsed wall-clock time, which
would be flaky rather than meaningful.

## MODIFIED: Boundaries & unchanged behaviour

Add:

- Login throttling is **per email**, per process, and in memory. It does not persist across restart,
  does not coordinate across instances, and is not applied to any endpoint other than login. No
  other unauthenticated surface is rate limited.
- The first-user bootstrap path is not throttled and needs no counter: with an empty store any
  credentials succeed, so no credential failure is reachable there.
