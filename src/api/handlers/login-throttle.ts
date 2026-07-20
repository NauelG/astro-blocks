/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * login-throttle.ts — capped exponential backoff for repeated failed logins (#125, ADR-0032).
 *
 * scrypt makes each password guess expensive; it does not bound how many guesses are made. This
 * module bounds the rate a single key sustains over time. It does not bound a burst of concurrent
 * requests arriving before any counter increments — there, the per-guess cost of scrypt is what
 * limits throughput. The two compose; neither is sufficient alone, and a reverse-proxy rate limit
 * remains the expected production layer.
 *
 * Two things here are decisions, not implementation details, and reversing either is a regression:
 *
 * 1. **The key is the email, and deliberately NOT the client address.** Astro resolves the address
 *    as `x-forwarded-for || socket.remoteAddress`: behind a proxy the socket is a single value
 *    shared by every caller, and the header is attacker-controlled (validated only for shape, with
 *    no trust boundary or hop count). A distributable package cannot tell which of the two it is
 *    holding. Adding it would let an attacker rotate the header for unlimited attempts, and let
 *    them forge a victim's address to throttle a third party. See ADR-0032 before "fixing" this.
 *
 * 2. **Eviction drops the FEWEST-failure entries, never the least-recently-used.** The key space is
 *    attacker-controlled, so the store is capped. LRU would be a bypass: flooding it with junk keys
 *    would evict the entry tracking the account actually under attack and reset its backoff. A key
 *    under attack has the highest failure count and is therefore evicted last.
 *
 * The delay is the only observable. A throttled attempt returns the same 401 as any other failure,
 * and accrues identically for emails that do not exist — a distinct status or header would
 * enumerate which accounts are real.
 */

/**
 * Accrued failures that owe nothing, so a mistyping owner is never punished.
 *
 * Note the off-by-one: the debt from N failures is paid by the N+1th attempt (the wait runs before
 * credentials are checked, so it can only reflect failures already recorded). A value of 3 therefore
 * means FOUR attempts are answered immediately and the fifth is the first to wait.
 */
export const FREE_ATTEMPTS = 3;

/** The delay applied to the first non-free failure; doubles from here. */
export const BASE_DELAY_MS = 500;

/**
 * The ceiling. An unbounded delay is an open connection an attacker accumulates; at 8s a sustained
 * attacker gets ~7.5 guesses per minute per key, while the owner's worst case stays bearable.
 */
export const MAX_DELAY_MS = 8_000;

/** Idle time after which an entry is forgotten, measured from the last failure. */
export const ATTEMPT_TTL_MS = 15 * 60_000;

/** Hard cap on tracked keys — the key space is attacker-controlled (see the note above). */
export const MAX_TRACKED_KEYS = 1_024;

type Attempt = { failures: number; lastAt: number };

/**
 * Per-process, in memory. Persisting it would mean one disk write per failed login, handing the
 * attacker an I/O amplifier on the exact path being defended. The cost is that the counter does not
 * survive a restart and does not span instances; that is accepted and documented for consumers.
 */
const attempts = new Map<string, Attempt>();

/**
 * Pure: milliseconds owed after `failures` consecutive failures. Holds the whole policy and touches
 * no state, so the schedule is unit-tested exhaustively and instantly.
 */
export function backoffDelayMs(failures: number): number {
  const overage = failures - FREE_ATTEMPTS;
  if (overage <= 0) return 0;

  // Cap the exponent before computing it: 2 ** 10_000 is Infinity, and Math.min(Infinity, cap)
  // would work by luck rather than by intent.
  const steps = Math.min(overage - 1, 32);
  return Math.min(BASE_DELAY_MS * 2 ** steps, MAX_DELAY_MS);
}

function liveEntry(key: string, now: number): Attempt | undefined {
  const entry = attempts.get(key);
  if (!entry) return undefined;

  if (now - entry.lastAt > ATTEMPT_TTL_MS) {
    attempts.delete(key);
    return undefined;
  }
  return entry;
}

/**
 * How far below the cap a sweep evicts. Reclaiming a batch rather than a single entry amortizes the
 * sort below across many insertions: without it, every failed login past the cap would sort the
 * whole map, which is a CPU amplifier on precisely the path a flood attacks.
 */
const EVICTION_BATCH = Math.floor(MAX_TRACKED_KEYS / 8);

/**
 * Evict back below the cap: expired entries first (free to drop), then the fewest failures. Never
 * LRU — see the module note.
 */
function evictIfNeeded(now: number): void {
  if (attempts.size <= MAX_TRACKED_KEYS) return;

  for (const [key, entry] of attempts) {
    if (now - entry.lastAt > ATTEMPT_TTL_MS) attempts.delete(key);
  }
  if (attempts.size <= MAX_TRACKED_KEYS) return;

  const byFewestFailures = [...attempts.entries()].sort((a, b) => a[1].failures - b[1].failures);
  const target = attempts.size - MAX_TRACKED_KEYS + EVICTION_BATCH;
  for (let i = 0; i < target; i++) {
    const victim = byFewestFailures[i];
    if (victim) attempts.delete(victim[0]);
  }
}

/**
 * Milliseconds this key currently owes. A pure read — the observable tests assert against, so the
 * schedule, the reset, the TTL and the eviction order need no timers.
 *
 * `now` is injectable so time-dependent assertions stay deterministic; production omits it.
 */
export function pendingBackoffMs(email: string, now: number = Date.now()): number {
  const entry = liveEntry(email, now);
  return entry ? backoffDelayMs(entry.failures) : 0;
}

/** Grows this key's backoff. Call on every credential failure, existing account or not. */
export function recordLoginFailure(email: string, now: number = Date.now()): void {
  const entry = liveEntry(email, now);

  if (entry) {
    entry.failures += 1;
    entry.lastAt = now;
  } else {
    attempts.set(email, { failures: 1, lastAt: now });
  }

  evictIfNeeded(now);
}

/** Drops the key. Call on every successful login. */
export function clearLoginFailures(email: string): void {
  attempts.delete(email);
}

/** Waits out any backoff owed by this key. Call BEFORE verifying credentials. */
export async function applyLoginBackoff(email: string): Promise<void> {
  const delay = pendingBackoffMs(email);
  if (delay <= 0) return;

  await new Promise<void>((resolve) => setTimeout(resolve, delay));
}

/**
 * Test seam: empties the store. Production never calls this — but every test file that drives
 * handleLogin must, or module state leaks between unrelated tests and the suite silently starts
 * sleeping for real.
 */
export function resetLoginThrottle(): void {
  attempts.clear();
}
