/**
 * Tests for catalog completeness and structure.
 * Verifies: en + es have same keys, no empty values, catalog shape.
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

test('en and es catalogs have same keys (completeness: REQ-5.2)', () => {
  const enKeys = Object.keys(catalogs.en).sort();
  const esKeys = Object.keys(catalogs.es).sort();

  const missingFromEs = enKeys.filter((k) => !catalogs.es[k]);
  const missingFromEn = esKeys.filter((k) => !catalogs.en[k]);

  if (missingFromEs.length > 0) {
    assert.fail(`Keys in en but missing/empty in es: ${missingFromEs.slice(0, 10).join(', ')}`);
  }
  if (missingFromEn.length > 0) {
    assert.fail(`Keys in es but missing/empty in en: ${missingFromEn.slice(0, 10).join(', ')}`);
  }
});

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
        `catalogs.${locale}["${key}"] must be a string, got ${typeof value}`
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
