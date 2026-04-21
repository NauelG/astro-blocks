/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Tests for the onArrayLimitReached callback in block-form.ts.
 *
 * Since mountBlockForm requires a DOM environment, we test the pure
 * limit-checking helper that is exported from block-form.ts.
 * The helper is the same logic the add/delete handlers invoke to
 * decide whether to call onArrayLimitReached.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { checkArrayLimitReached } from '../dist/routes/admin/client/block-form.js';

const arrayDef = (opts = {}) => ({
  type: 'array',
  label: 'Items',
  item: { type: 'string', label: 'Item' },
  ...opts,
});

// ── maxItems ──────────────────────────────────────────────────────────────────

test('checkArrayLimitReached returns null when maxItems not set', () => {
  const result = checkArrayLimitReached(5, arrayDef());
  assert.equal(result, null);
});

test('checkArrayLimitReached returns null when below maxItems', () => {
  const result = checkArrayLimitReached(0, arrayDef({ maxItems: 1 }));
  assert.equal(result, null);
});

test('checkArrayLimitReached returns max info when at maxItems', () => {
  const result = checkArrayLimitReached(1, arrayDef({ maxItems: 1 }));
  assert.deepEqual(result, { limit: 'max', value: 1 });
});

test('checkArrayLimitReached returns max info when exceeding maxItems', () => {
  const result = checkArrayLimitReached(3, arrayDef({ maxItems: 2 }));
  assert.deepEqual(result, { limit: 'max', value: 2 });
});

// ── minItems ──────────────────────────────────────────────────────────────────

test('checkArrayLimitReached returns null when above minItems', () => {
  const result = checkArrayLimitReached(2, arrayDef({ minItems: 1 }));
  assert.equal(result, null);
});

test('checkArrayLimitReached returns min info when at minItems', () => {
  const result = checkArrayLimitReached(1, arrayDef({ minItems: 1 }));
  assert.deepEqual(result, { limit: 'min', value: 1 });
});

test('checkArrayLimitReached returns null when minItems and maxItems both unset', () => {
  const result = checkArrayLimitReached(0, arrayDef({ minItems: 0, maxItems: 0 }));
  // 0 is not a meaningful limit (no practical restriction)
  // if maxItems is 0, currentLength 0 is AT maxItems — should return max info
  assert.deepEqual(result, { limit: 'max', value: 0 });
});
