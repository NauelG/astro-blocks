/**
 * Tests for catalog VALUE quality and shape.
 *
 * Key parity (en ≡ es) is NOT tested here — it is compiler-enforced bidirectionally by
 * `es satisfies Record<CatalogKey, string>` (a missing key is TS1360, an extra key is TS2353;
 * #40, ADR-0034). Re-checking it at runtime would only duplicate the compiler and invite a reader
 * to stop trusting it. What the type system does NOT cover lives here: no empty values, all values
 * are strings, es is actually translated, expected namespaces exist.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../dist/routes/admin/i18n/catalogs.js';

test('catalogs has en and es keys', () => {
  assert.ok('en' in catalogs, 'catalogs must have en');
  assert.ok('es' in catalogs, 'catalogs must have es');
});

test('en catalog is a non-empty object', () => {
  assert.equal(typeof catalogs.en, 'object');
  assert.ok(Object.keys(catalogs.en).length > 0, 'en catalog must not be empty');
});

test('es catalog is a non-empty object', () => {
  assert.equal(typeof catalogs.es, 'object');
  assert.ok(Object.keys(catalogs.es).length > 0, 'es catalog must not be empty');
});

// Key parity (en ≡ es, both directions) is compiler-enforced — see the file header. The former
// runtime parity test that lived here was removed as redundant with tsc (#40, ADR-0034).

test('no key maps to an empty string in en catalog', () => {
  const empties = Object.entries(catalogs.en)
    .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    .map(([k]) => k);
  if (empties.length > 0) {
    assert.fail(`Empty values in en catalog: ${empties.slice(0, 5).join(', ')}`);
  }
});

test('no key maps to an empty string in es catalog', () => {
  const empties = Object.entries(catalogs.es)
    .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
    .map(([k]) => k);
  if (empties.length > 0) {
    assert.fail(`Empty values in es catalog: ${empties.slice(0, 5).join(', ')}`);
  }
});

test('all catalog values are strings', () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(
        typeof value,
        'string',
        `catalogs.${locale}["${key}"] must be a string, got ${typeof value}`,
      );
    }
  }
});

test('catalogs has expected namespaces: nav, errors, auth, common', () => {
  const enKeys = Object.keys(catalogs.en);
  const hasNav = enKeys.some((k) => k.startsWith('nav.'));
  const hasErrors = enKeys.some((k) => k.startsWith('errors.'));
  const hasAuth = enKeys.some((k) => k.startsWith('auth.'));
  const hasCommon = enKeys.some((k) => k.startsWith('common.'));

  assert.ok(hasNav, 'en catalog must have nav.* keys');
  assert.ok(hasErrors, 'en catalog must have errors.* keys');
  assert.ok(hasAuth, 'en catalog must have auth.* keys');
  assert.ok(hasCommon, 'en catalog must have common.* keys');
});

test('catalog has at least 80 keys (completeness sanity check)', () => {
  const keyCount = Object.keys(catalogs.en).length;
  assert.ok(keyCount >= 80, `Expected at least 80 keys in en catalog, got ${keyCount}`);
});

test('es values differ from en for at least some keys (es≠en sanity: REQ-5.3)', () => {
  // A catalog where every key has the same value in es and en is almost
  // certainly untranslated. Require at least 30% of keys to differ.
  const enEntries = Object.entries(catalogs.en);
  const identicalCount = enEntries.filter(([k, v]) => catalogs.es[k] === v).length;
  const diffCount = enEntries.length - identicalCount;
  const diffRatio = diffCount / enEntries.length;

  assert.ok(
    diffRatio >= 0.3,
    `es catalog appears untranslated: only ${diffCount}/${enEntries.length} keys differ from en (${(diffRatio * 100).toFixed(1)}% < 30% required)`,
  );
});
