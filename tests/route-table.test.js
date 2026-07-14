/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * route-table.test.js — structural guard for src/api/route-table.ts (Phase 3 of
 * route-table-auth-gating, resolves #36 + #37).
 *
 * This is a declaration-level proof, not a behavioral one: it asserts the
 * table has exactly the 43 entries the spec's equivalence checklist
 * enumerates, that every entry declares a valid `auth` level, and that the
 * 10 owner-gated routes are exactly the ones the design names. A future edit
 * that drops, duplicates, or downgrades a route fails HERE, at declaration
 * level, before any router-level behavioral test even runs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { routes } from '../dist/api/route-table.js';

const VALID_AUTH_LEVELS = new Set(['public', 'user', 'owner']);
const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

test('route table has exactly 43 entries', () => {
  assert.equal(routes.length, 43);
});

test('every entry has a valid method, pattern, and auth level', () => {
  for (const entry of routes) {
    assert.ok(VALID_METHODS.has(entry.method), `invalid method: ${entry.method}`);
    assert.equal(typeof entry.pattern, 'string');
    assert.ok(entry.pattern.length > 0);
    assert.ok(
      VALID_AUTH_LEVELS.has(entry.auth),
      `invalid auth level for ${entry.method} ${entry.pattern}: ${entry.auth}`,
    );
    assert.equal(typeof entry.handler, 'function');
  }
});

test('no duplicate method+pattern entries', () => {
  const seen = new Set();
  for (const entry of routes) {
    const key = `${entry.method} ${entry.pattern}`;
    assert.ok(!seen.has(key), `duplicate route entry: ${key}`);
    seen.add(key);
  }
});

test('method distribution matches the equivalence checklist (GET 15 / POST 12 / PUT 8 / PATCH 1 / DELETE 7)', () => {
  const counts = { GET: 0, POST: 0, PUT: 0, PATCH: 0, DELETE: 0 };
  for (const entry of routes) counts[entry.method]++;
  assert.deepEqual(counts, { GET: 15, POST: 12, PUT: 8, PATCH: 1, DELETE: 7 });
});

test('exactly 10 routes are owner-gated, matching the design inventory', () => {
  const ownerRoutes = routes
    .filter((r) => r.auth === 'owner')
    .map((r) => `${r.method} ${r.pattern}`);
  assert.equal(ownerRoutes.length, 10);
  assert.deepEqual(
    new Set(ownerRoutes),
    new Set([
      'GET export',
      'GET users',
      'POST import',
      'POST users',
      'POST languages',
      'PUT site',
      'PUT users/:id',
      'PUT languages/:id',
      'DELETE users/:id',
      'DELETE languages/:id',
    ]),
  );
});
