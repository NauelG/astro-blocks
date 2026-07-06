/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * route-matcher.test.js — Phase 1 (PR1) of route-table-auth-gating.
 *
 * Pure unit tests for `api/route-matcher.ts`: `matchRoute` + `defineRoute`.
 * No handlers, no I/O, no HTTP — fixture route tables only. This is the
 * foundation module other phases (PR2/PR3) build on; it must prove
 * exact-arity matching, `:param` extraction, and declaration-order
 * first-match semantics BEFORE the real 43-entry table exists.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { defineRoute, matchRoute } from '../dist/api/route-matcher.js';

// Fixture handler — never invoked by these tests, only referenced for typing/identity.
const noopHandler = () => new Response(null, { status: 204 });

// ─── Exact static match ─────────────────────────────────────────────────────

test('matchRoute: exact static pattern matches identical segments', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'pages', auth: 'user', handler: noopHandler })];

  const match = matchRoute('GET', ['pages'], routes);

  assert.ok(match);
  assert.equal(match.descriptor.pattern, 'pages');
  assert.deepEqual(match.params, {});
});

// ─── Arity-exact rejection ──────────────────────────────────────────────────

test('matchRoute: arity mismatch (extra segment) never matches', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'pages', auth: 'user', handler: noopHandler })];

  assert.equal(matchRoute('GET', ['pages', 'extra'], routes), null);
});

test('matchRoute: arity mismatch (missing segment) never matches', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'media/:id/usage', auth: 'user', handler: noopHandler })];

  assert.equal(matchRoute('GET', ['media', '123'], routes), null);
});

// ─── Literal mismatch ───────────────────────────────────────────────────────

test('matchRoute: literal segment mismatch never matches', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'pages', auth: 'user', handler: noopHandler })];

  assert.equal(matchRoute('GET', ['menus'], routes), null);
});

// ─── Dynamic :param extraction ──────────────────────────────────────────────

test('matchRoute: single :param captures the segment value', () => {
  const routes = [defineRoute({ method: 'PUT', pattern: 'languages/:id', auth: 'owner', handler: noopHandler })];

  const match = matchRoute('PUT', ['languages', 'es'], routes);

  assert.ok(match);
  assert.deepEqual(match.params, { id: 'es' });
});

test('matchRoute: nested :param mid-pattern captures correctly (media/:id/usage)', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'media/:id/usage', auth: 'user', handler: noopHandler })];

  const match = matchRoute('GET', ['media', 'abc-123', 'usage'], routes);

  assert.ok(match);
  assert.deepEqual(match.params, { id: 'abc-123' });
});

test('matchRoute: empty-segment never captures a :param (no match)', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'media/:id/usage', auth: 'user', handler: noopHandler })];

  assert.equal(matchRoute('GET', ['media', '', 'usage'], routes), null);
});

test('matchRoute: multiple :params in one pattern each capture independently', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'a/:x/:y', auth: 'user', handler: noopHandler })];

  const match = matchRoute('GET', ['a', '1', '2'], routes);

  assert.ok(match);
  assert.deepEqual(match.params, { x: '1', y: '2' });
});

test('matchRoute: leading :param (first segment) captures correctly', () => {
  const routes = [defineRoute({ method: 'GET', pattern: ':id', auth: 'user', handler: noopHandler })];

  const match = matchRoute('GET', ['42'], routes);

  assert.ok(match);
  assert.deepEqual(match.params, { id: '42' });
});

// ─── Method filter ──────────────────────────────────────────────────────────

test('matchRoute: same pattern, different declared method, does not cross-match', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'languages/:id', auth: 'owner', handler: noopHandler })];

  assert.equal(matchRoute('DELETE', ['languages', 'es'], routes), null);
});

test('matchRoute: method filter still returns the correct entry when methods differ', () => {
  const routes = [
    defineRoute({ method: 'GET', pattern: 'languages/:id', auth: 'user', handler: noopHandler }),
    defineRoute({ method: 'DELETE', pattern: 'languages/:id', auth: 'owner', handler: noopHandler }),
  ];

  const match = matchRoute('DELETE', ['languages', 'es'], routes);

  assert.ok(match);
  assert.equal(match.descriptor.auth, 'owner');
});

// ─── Declaration-order, first-match-wins (ADR-4) ────────────────────────────

test('matchRoute: first declared match wins when two entries could both match', () => {
  const first = defineRoute({ method: 'GET', pattern: 'media/:id', auth: 'user', handler: noopHandler });
  const second = defineRoute({ method: 'GET', pattern: 'media/:id', auth: 'owner', handler: noopHandler });

  const match = matchRoute('GET', ['media', '42'], [first, second]);

  assert.ok(match);
  assert.equal(match.descriptor.auth, 'user');
});

test('matchRoute: reordering the same two entries changes which one wins (order-dependent, not type-dependent)', () => {
  const paramFirst = defineRoute({ method: 'GET', pattern: 'media/:id', auth: 'user', handler: noopHandler });
  const staticSecond = defineRoute({ method: 'GET', pattern: 'media/replace', auth: 'owner', handler: noopHandler });

  // "media/replace" as a concrete segment set would also satisfy "media/:id" — first
  // declaration wins regardless of static vs. param shape (no special precedence rule).
  const match = matchRoute('GET', ['media', 'replace'], [paramFirst, staticSecond]);

  assert.ok(match);
  assert.equal(match.descriptor.pattern, 'media/:id');
});

// ─── No match → null ─────────────────────────────────────────────────────────

test('matchRoute: unknown path returns null (no matching descriptor at all)', () => {
  const routes = [defineRoute({ method: 'GET', pattern: 'pages', auth: 'user', handler: noopHandler })];

  assert.equal(matchRoute('GET', ['does-not-exist'], routes), null);
});

test('matchRoute: empty table always returns null', () => {
  assert.equal(matchRoute('GET', ['pages'], []), null);
});

// ─── /cms/api mount-prefix handling (patterns are already seg-relative) ─────

test('matchRoute: patterns are mount-relative — no leading/trailing slash noise affects matching', () => {
  // getPathSegments() already strips the /cms/api mount prefix (slice(2)) before
  // segments reach the matcher, so patterns never carry a leading slash. The
  // matcher must be robust to accidental slashes via split('/').filter(Boolean).
  const routes = [defineRoute({ method: 'GET', pattern: '/global-blocks/:id/', auth: 'user', handler: noopHandler })];

  const match = matchRoute('GET', ['global-blocks', 'hero'], routes);

  assert.ok(match);
  assert.deepEqual(match.params, { id: 'hero' });
});

// ─── declaration order across a mixed table (declaration order = original branch order) ─

test('matchRoute: scans in declaration order and stops at first match, ignoring later matches', () => {
  const routes = [
    defineRoute({ method: 'GET', pattern: 'auth/status', auth: 'public', handler: noopHandler }),
    defineRoute({ method: 'GET', pattern: 'pages', auth: 'user', handler: noopHandler }),
    defineRoute({ method: 'GET', pattern: 'pages', auth: 'owner', handler: noopHandler }), // unreachable duplicate
  ];

  const match = matchRoute('GET', ['pages'], routes);

  assert.ok(match);
  assert.equal(match.descriptor.auth, 'user');
});
