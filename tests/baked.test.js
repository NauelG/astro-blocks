/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The bake mechanism as an executable contract (#116, ADR-0033).
 *
 * `decodeBaked` takes the raw string as an ARGUMENT, so the whole round trip is unit-testable
 * without import.meta.env — which is undefined under `node --test` and is per-module anyway. This
 * is the real assertion the retired `schema-map-bake-guard.test.js` source-regex stood in for.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { decodeBaked, defineBakedValue } from '../dist/utils/baked.js';

// Model vite.define: the define VALUE is spliced into the bundle source verbatim, so what the
// runtime observes for `import.meta.env.KEY` is `JSON.parse(defineValue)`.
function runtimeValueOf(defineValue) {
  return JSON.parse(defineValue);
}

const identity = (parsed) => parsed;

// ─── the double-encode round trip ────────────────────────────────────────────

test('round trip: defineBakedValue → vite substitution → decodeBaked returns the value', () => {
  const value = ['video/mp4', 'image/png'];
  const define = {};
  defineBakedValue(define, 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES', value);

  const raw = runtimeValueOf(define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES']);
  // The runtime sees a STRING, not an array literal — that is the whole point of double-encoding.
  assert.equal(typeof raw, 'string');

  const res = decodeBaked(raw, identity);
  assert.deepEqual(res, { ok: true, value });
});

test('round trip preserves an object value', () => {
  const value = { 'blocks/hero': '/abs/hero.schema.mjs' };
  const define = {};
  defineBakedValue(define, 'ASTRO_BLOCKS_SCHEMA_MAP', value);
  const raw = runtimeValueOf(define['import.meta.env.ASTRO_BLOCKS_SCHEMA_MAP']);
  assert.deepEqual(decodeBaked(raw, identity), { ok: true, value });
});

// ─── the single-encode bug shape ─────────────────────────────────────────────

test('a single-encoded value is rejected (the video/mp4 415 shape)', () => {
  // A single JSON.stringify emits an array/object LITERAL into the bundle, so the runtime sees the
  // parsed array, not a string. decodeBaked must reject it rather than accept a half-decoded value.
  const singleEncoded = runtimeValueOf(JSON.stringify(['video/mp4']));
  assert.deepEqual(singleEncoded, ['video/mp4']); // it is an array, not a string
  assert.deepEqual(decodeBaked(singleEncoded, identity), { ok: false, reason: 'unresolved' });
});

// ─── malformed / absent → unresolved, never a throw ──────────────────────────

test('malformed and absent inputs are unresolved, not exceptions', () => {
  assert.deepEqual(decodeBaked(undefined, identity), { ok: false, reason: 'unresolved' });
  assert.deepEqual(decodeBaked('', identity), { ok: false, reason: 'unresolved' });
  assert.deepEqual(decodeBaked('   ', identity), { ok: false, reason: 'unresolved' });
  assert.deepEqual(decodeBaked('{not json', identity), { ok: false, reason: 'unresolved' });
  assert.deepEqual(decodeBaked(42, identity), { ok: false, reason: 'unresolved' });
});

test('a validator returning null is unresolved', () => {
  const rejectAll = () => null;
  const raw = runtimeValueOf(JSON.stringify(JSON.stringify(['image/png'])));
  assert.deepEqual(decodeBaked(raw, rejectAll), { ok: false, reason: 'unresolved' });
});

// ─── empty structured value is a value, not a failure (spec R6) ───────────────

test('an empty object and an empty array decode successfully', () => {
  const emptyObj = runtimeValueOf(JSON.stringify(JSON.stringify({})));
  const emptyArr = runtimeValueOf(JSON.stringify(JSON.stringify([])));
  assert.deepEqual(decodeBaked(emptyObj, identity), { ok: true, value: {} });
  assert.deepEqual(decodeBaked(emptyArr, identity), { ok: true, value: [] });
});

// ─── the module is isomorphic (no node/i18n in the browser bundle) ───────────

test('baked.js pulls in no node builtins and no i18n', () => {
  const src = fs.readFileSync(new URL('../dist/utils/baked.js', import.meta.url), 'utf8');
  // A crude source check — but here it CAN fail deterministically: adding such an import changes
  // the source. That is what distinguishes it from the schema-map guard this replaces.
  assert.ok(!/from ['"]node:/.test(src), 'baked.js must not import a node builtin');
  assert.ok(
    !/handlers\/shared|localizedJsonError|\/i18n\//.test(src),
    'baked.js must not import i18n/Response code',
  );
});
