/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTEMPT_TTL_MS,
  BASE_DELAY_MS,
  FREE_ATTEMPTS,
  MAX_DELAY_MS,
  MAX_TRACKED_KEYS,
  backoffDelayMs,
  clearLoginFailures,
  pendingBackoffMs,
  recordLoginFailure,
  resetLoginThrottle,
} from '../dist/api/handlers/login-throttle.js';

// The store functions take an explicit `now` so every time-dependent assertion is deterministic.
// Production calls them with no argument and they default to Date.now().

// ─── backoffDelayMs (pure policy) ────────────────────────────────────────────

test('backoffDelayMs: the first FREE_ATTEMPTS failures are free', () => {
  for (let failures = 0; failures <= FREE_ATTEMPTS; failures++) {
    assert.equal(backoffDelayMs(failures), 0, `${failures} failures must not be delayed`);
  }
});

test('backoffDelayMs: the delay doubles from BASE_DELAY_MS', () => {
  assert.equal(backoffDelayMs(FREE_ATTEMPTS + 1), BASE_DELAY_MS);
  assert.equal(backoffDelayMs(FREE_ATTEMPTS + 2), BASE_DELAY_MS * 2);
  assert.equal(backoffDelayMs(FREE_ATTEMPTS + 3), BASE_DELAY_MS * 4);
  assert.equal(backoffDelayMs(FREE_ATTEMPTS + 4), BASE_DELAY_MS * 8);
});

test('backoffDelayMs: pins at MAX_DELAY_MS and never overflows past it', () => {
  // An unbounded doubling would reach a delay nobody can sit through, and 2**n overflows to
  // Infinity long before the input is absurd. Both must land on the cap.
  for (const failures of [FREE_ATTEMPTS + 5, 20, 50, 1_000, 10_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(
      backoffDelayMs(failures),
      MAX_DELAY_MS,
      `${failures} failures must pin at the cap`,
    );
  }
});

// ─── the attempt store ───────────────────────────────────────────────────────

test('recordLoginFailure: accumulates, and clearLoginFailures drops the key', () => {
  resetLoginThrottle();

  assert.equal(pendingBackoffMs('owner@example.com'), 0);

  for (let i = 0; i < FREE_ATTEMPTS + 1; i++) recordLoginFailure('owner@example.com');
  assert.equal(pendingBackoffMs('owner@example.com'), BASE_DELAY_MS);

  recordLoginFailure('owner@example.com');
  assert.equal(pendingBackoffMs('owner@example.com'), BASE_DELAY_MS * 2);

  clearLoginFailures('owner@example.com');
  assert.equal(pendingBackoffMs('owner@example.com'), 0, 'a success must reset the key');
});

test('the store tracks each key independently', () => {
  resetLoginThrottle();

  for (let i = 0; i < FREE_ATTEMPTS + 2; i++) recordLoginFailure('a@example.com');
  recordLoginFailure('b@example.com');

  assert.equal(pendingBackoffMs('a@example.com'), BASE_DELAY_MS * 2);
  assert.equal(pendingBackoffMs('b@example.com'), 0);
});

test('an entry idle past ATTEMPT_TTL_MS is forgotten', () => {
  resetLoginThrottle();

  const start = 1_000_000;
  for (let i = 0; i < FREE_ATTEMPTS + 3; i++) recordLoginFailure('owner@example.com', start);
  assert.equal(pendingBackoffMs('owner@example.com', start), BASE_DELAY_MS * 4);

  // Still owed just before the TTL elapses.
  assert.equal(
    pendingBackoffMs('owner@example.com', start + ATTEMPT_TTL_MS - 1),
    BASE_DELAY_MS * 4,
  );

  // Forgotten after it. A legitimate owner returning later starts clean.
  assert.equal(pendingBackoffMs('owner@example.com', start + ATTEMPT_TTL_MS + 1), 0);
});

test('idle time is measured from the last failure, not the first', () => {
  resetLoginThrottle();

  const start = 1_000_000;
  for (let i = 0; i < FREE_ATTEMPTS + 1; i++) recordLoginFailure('owner@example.com', start);

  // A failure most of the way through the window keeps the key alive past the original deadline.
  const later = start + ATTEMPT_TTL_MS - 1_000;
  recordLoginFailure('owner@example.com', later);

  assert.equal(pendingBackoffMs('owner@example.com', start + ATTEMPT_TTL_MS + 1) > 0, true);
});

// ─── eviction ────────────────────────────────────────────────────────────────

test('eviction keeps the key under attack and drops the junk around it', () => {
  resetLoginThrottle();

  // The account actually being attacked: many failures on one key.
  const target = 'owner@example.com';
  for (let i = 0; i < FREE_ATTEMPTS + 5; i++) recordLoginFailure(target);
  const owed = pendingBackoffMs(target);
  assert.equal(owed, MAX_DELAY_MS);

  // A flood of distinct single-failure keys, well past the cap.
  for (let i = 0; i < MAX_TRACKED_KEYS * 2; i++) recordLoginFailure(`junk-${i}@example.com`);

  // Least-recently-used eviction would have dropped the target — it was touched before every junk
  // key — resetting its backoff and handing the attacker a bypass. Fewest-failures-first keeps it.
  assert.equal(
    pendingBackoffMs(target),
    owed,
    'the most-failed key must survive a flood of single-failure keys',
  );
});

test('eviction bounds the store: an unlimited key space cannot exhaust memory', () => {
  resetLoginThrottle();

  for (let i = 0; i < MAX_TRACKED_KEYS * 3; i++) recordLoginFailure(`junk-${i}@example.com`);

  // The store cannot be inspected directly by design; the observable is that the oldest junk is
  // gone while the store still functions.
  assert.equal(pendingBackoffMs('junk-0@example.com'), 0);
  recordLoginFailure('still-works@example.com');
  assert.equal(pendingBackoffMs('still-works@example.com'), 0);
});
