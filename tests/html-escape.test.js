/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Unit tests for the canonical HTML-escaping pair.
 *
 * Locks the exact char-by-char entity mapping for both escapeHtml (text
 * content) and escapeAttr (attribute value) so any future refactor cannot
 * silently change escaping behavior or reintroduce double-encoding.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, escapeAttr } from '../dist/utils/html-escape.js';

test('escapeHtml — individual char table', () => {
  assert.equal(escapeHtml('&'), '&amp;');
  assert.equal(escapeHtml('<'), '&lt;');
  assert.equal(escapeHtml('>'), '&gt;');
  assert.equal(escapeHtml('"'), '&quot;');
  assert.equal(escapeHtml("'"), '&#39;');
});

test('escapeHtml — all five combined', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeHtml — safe characters pass through untouched', () => {
  assert.equal(escapeHtml('Hello World 123'), 'Hello World 123');
});

test('escapeAttr — individual char table', () => {
  assert.equal(escapeAttr('&'), '&amp;');
  assert.equal(escapeAttr('<'), '&lt;');
  assert.equal(escapeAttr('>'), '&gt;');
  assert.equal(escapeAttr('"'), '&quot;');
  assert.equal(escapeAttr("'"), '&#39;');
});

test('escapeAttr — all five combined', () => {
  assert.equal(escapeAttr(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeAttr — no raw double-quote survives in a mixed string', () => {
  const result = escapeAttr('a"b');
  assert.ok(!result.includes('"'), `expected no raw double-quote in: ${result}`);
  assert.equal(result, 'a&quot;b');
});

test('ampersand-first / no double-encoding — escapeHtml', () => {
  const result = escapeHtml('Tom & Jerry');
  assert.equal(result, 'Tom &amp; Jerry');
  assert.ok(!result.includes('&amp;amp;'), `unexpected double-encoding in: ${result}`);
});

test('ampersand-first / no double-encoding — escapeAttr', () => {
  const result = escapeAttr('Tom & Jerry');
  assert.equal(result, 'Tom &amp; Jerry');
  assert.ok(!result.includes('&amp;amp;'), `unexpected double-encoding in: ${result}`);
});

test('a pre-existing entity-looking substring is not re-encoded', () => {
  // The literal string "&quot;" fed in raw must have its & escaped once,
  // never turned into &amp;quot; -> re-scanned again.
  const result = escapeHtml('&quot;');
  assert.equal(result, '&amp;quot;');
  assert.ok(!result.includes('&amp;amp;'), `unexpected double-encoding in: ${result}`);
});

test('attribute-breakout payload is fully escaped', () => {
  const payload = 'x" onmouseover="alert(1)';
  const result = escapeAttr(payload);
  assert.equal(result, 'x&quot; onmouseover=&quot;alert(1)');
  assert.ok(!result.includes('"'), `expected no raw double-quote in: ${result}`);
});

test('escapeHtml and escapeAttr are behaviorally equivalent (deliberate over-escape)', () => {
  const samples = [
    `&<>"'`,
    'Tom & Jerry',
    'x" onmouseover="alert(1)',
    "it's a test",
    'plain text',
    '',
  ];
  for (const sample of samples) {
    assert.equal(escapeHtml(sample), escapeAttr(sample), `mismatch for sample: ${sample}`);
  }
});

test('non-string input is coerced to string before escaping', () => {
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeAttr(42), '42');
});
