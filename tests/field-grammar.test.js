/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidEmail,
  isValidLanguageCode,
  isValidLanguageLabel,
} from '../dist/utils/field-grammar.js';

// --- isValidEmail -----------------------------------------------------------

test('isValidEmail accepts ordinary addresses', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('first.last+tag@sub.example.com'), true);
  assert.equal(isValidEmail("o'brien@example.io"), true);
});

test('isValidEmail rejects markup and malformed shapes', () => {
  assert.equal(isValidEmail('<img src=x onerror=alert(1)>'), false);
  assert.equal(isValidEmail('no-at-sign.example.com'), false);
  assert.equal(isValidEmail('two@@example.com'), false);
  assert.equal(isValidEmail('spaces in@example.com'), false);
  assert.equal(isValidEmail('trailing-dot@example.com.'), false);
  assert.equal(isValidEmail(''), false);
});

test('isValidEmail enforces the 254-character cap', () => {
  const local = 'a'.repeat(64);
  const domain = `${'b'.repeat(61)}.${'c'.repeat(61)}.${'d'.repeat(61)}.example.com`;
  const long = `${local}@${domain}`;
  assert.ok(long.length > 254);
  assert.equal(isValidEmail(long), false);
  const ok = `${'a'.repeat(20)}@example.com`;
  assert.equal(isValidEmail(ok), true);
});

// --- isValidLanguageLabel ---------------------------------------------------

test('isValidLanguageLabel accepts one-line unicode names', () => {
  assert.equal(isValidLanguageLabel('Español'), true);
  assert.equal(isValidLanguageLabel('中文'), true);
  assert.equal(isValidLanguageLabel('Português (BR)'), true);
  assert.equal(isValidLanguageLabel('x'.repeat(80)), true);
});

test('isValidLanguageLabel rejects empty, oversized and control characters', () => {
  assert.equal(isValidLanguageLabel(''), false);
  assert.equal(isValidLanguageLabel('   '), false);
  assert.equal(isValidLanguageLabel('x'.repeat(81)), false);
  assert.equal(isValidLanguageLabel('two\nlines'), false);
  assert.equal(isValidLanguageLabel('tab\tseparated'), false);
  assert.equal(isValidLanguageLabel('nul\u0000char'), false);
  assert.equal(isValidLanguageLabel('c1\u009Fchar'), false);
});

// --- isValidLanguageCode ----------------------------------------------------

test('isValidLanguageCode matches the HTTP handler grammar', () => {
  assert.equal(isValidLanguageCode('es'), true);
  assert.equal(isValidLanguageCode('pt-br'), true);
  assert.equal(isValidLanguageCode('ast'), true);
  assert.equal(isValidLanguageCode('ES'), false);
  assert.equal(isValidLanguageCode('<script>'), false);
  assert.equal(isValidLanguageCode(''), false);
  assert.equal(isValidLanguageCode('e'), false);
});
