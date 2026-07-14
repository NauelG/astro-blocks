/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-formatters.test.js — FIX B: formatter cohesion.
 *
 * formatBytes / formatDimensions / formatMediaDate are intentionally duplicated
 * between src/routes/admin/client/media-fetch.ts (client re-render) and the inlined
 * SSR copy in routes/admin/media.astro (first paint). SSR cannot import the
 * client module, so the copies live separately — but they MUST produce identical
 * output for the same inputs, or a card's server first-paint and client
 * re-render would disagree (e.g. "0×0" vs "—", or different date formats).
 *
 * The .astro frontmatter cannot be imported here. Instead we import the client
 * copy and snapshot the EXACT strings the (now-aligned) SSR copy also produces.
 * These expected values are the single agreed contract both copies satisfy.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBytes,
  formatDimensions,
  formatMediaDate,
} from '../dist/routes/admin/client/media-fetch.js';

// ─── formatBytes ──────────────────────────────────────────────────────────────

test('FIX-B formatBytes: representative inputs match the shared contract', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
});

// ─── formatDimensions — stricter > 0 rule (zero/absent → "—") ──────────────────

test('FIX-B formatDimensions: both dims > 0 → "w×h"', () => {
  assert.equal(formatDimensions(800, 600), '800×600');
});

test('FIX-B formatDimensions: zero dimension → "—" (not "0×0") — matches SSR', () => {
  assert.equal(formatDimensions(0, 600), '—');
  assert.equal(formatDimensions(800, 0), '—');
  assert.equal(formatDimensions(0, 0), '—');
});

test('FIX-B formatDimensions: absent dimension → "—"', () => {
  assert.equal(formatDimensions(undefined, 600), '—');
  assert.equal(formatDimensions(800, undefined), '—');
  assert.equal(formatDimensions(undefined, undefined), '—');
});

// ─── formatMediaDate — explicit en-US short format ─────────────────────────────

test('FIX-B formatMediaDate: ISO date → en-US short ("Jun 14, 2026")', () => {
  // Use midday UTC to avoid any local-timezone day rollover in CI.
  assert.equal(formatMediaDate('2026-06-14T12:00:00.000Z'), 'Jun 14, 2026');
  assert.equal(formatMediaDate('2026-01-01T12:00:00.000Z'), 'Jan 1, 2026');
});

test('FIX-B formatMediaDate: invalid date → returns the input unchanged', () => {
  assert.equal(formatMediaDate('not-a-date'), 'not-a-date');
  assert.equal(formatMediaDate(''), '');
});
