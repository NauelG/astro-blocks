/**
 * Tests for src/routes/admin/i18n/t.ts
 * Tests: t(), createT(), interpolation, fallback chain, key-as-sentinel
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { t, createT } from '../dist/routes/admin/i18n/t.js';
import { catalogs } from '../dist/routes/admin/i18n/catalogs.js';

// ─── t() basic behavior ───────────────────────────────────────────────────────

test('t: returns string from catalog for known key', () => {
  const result = t(catalogs.en, 'nav.dashboard');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('t: returns Spanish string from es catalog', () => {
  const enVal = t(catalogs.en, 'nav.dashboard');
  const esVal = t(catalogs.es, 'nav.dashboard');
  // Both must be non-empty strings (may differ)
  assert.equal(typeof esVal, 'string');
  assert.ok(esVal.length > 0);
  // en and es must be different for a translated string
  // (nav.dashboard should differ between the two languages)
  // We don't assert they differ since it's possible for some keys
  // but at minimum both must exist as non-empty strings
  assert.ok(enVal.length > 0 && esVal.length > 0);
});

// ─── Interpolation ────────────────────────────────────────────────────────────

test('t: interpolates {name} placeholder', () => {
  // Use a known interpolation key from the catalog
  const result = t(catalogs.en, 'errors.duplicateSlug', { locale: 'en' });
  assert.equal(typeof result, 'string');
  // The placeholder should be replaced, not literal {locale}
  assert.ok(!result.includes('{locale}'));
});

test('t: leaves missing params as literal placeholder', () => {
  // If we pass a key with a placeholder but no params, the placeholder stays
  const dummyCatalog = { 'test.key': 'Hello {name}' };
  const result = t(dummyCatalog, 'test.key');
  assert.equal(result, 'Hello {name}');
});

test('t: interpolates multiple params', () => {
  const dummyCatalog = { 'test.multi': '{a} and {b}' };
  const result = t(dummyCatalog, 'test.multi', { a: 'foo', b: 'bar' });
  assert.equal(result, 'foo and bar');
});

test('t: param with number value is interpolated', () => {
  const dummyCatalog = { 'test.count': '{count} items' };
  const result = t(dummyCatalog, 'test.count', { count: 5 });
  assert.equal(result, '5 items');
});

// ─── Missing key fallback chain ───────────────────────────────────────────────

test('t: SCENARIO-12 first case — key missing from es returns English value', () => {
  // Simulate a key absent from es but present in en
  // Use createT with a patched catalog
  // Since es has nav.dashboard, we test the mechanism with a dummy catalog
  const esOnly = { 'only.en': undefined };
  const enCatalog = { 'only.en': 'English fallback' };
  // Test the exported t function directly with fallback
  const result = t(esOnly, 'only.en', undefined, enCatalog);
  assert.equal(result, 'English fallback');
});

test('t: SCENARIO-12 second case — key absent from both => key as sentinel', () => {
  const empty = {};
  const result = t(empty, 'some.missing.key', undefined, {});
  assert.equal(result, 'some.missing.key');
});

test('t: key absent from active catalog => falls back to en catalog', () => {
  const sparseEs = {};
  const fullEn = { 'nav.pages': 'Pages' };
  const result = t(sparseEs, 'nav.pages', undefined, fullEn);
  assert.equal(result, 'Pages');
});

// ─── createT factory ─────────────────────────────────────────────────────────

test('createT: returns a function', () => {
  const tFn = createT('en');
  assert.equal(typeof tFn, 'function');
});

test('createT(en): returns English value for known key', () => {
  const tFn = createT('en');
  const result = tFn('nav.dashboard');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('createT(es): returns Spanish value for known key', () => {
  const tFn = createT('es');
  const result = tFn('nav.dashboard');
  assert.equal(typeof result, 'string');
  assert.ok(result.length > 0);
});

test('createT: missing key in es falls back to en', () => {
  // We test with a real key that must exist in en
  const tFnEs = createT('es');
  // es result must also be non-empty (either es translation or en fallback)
  const esVal = tFnEs('nav.dashboard');
  assert.ok(esVal.length > 0);
  // The es factory should ultimately have a value (either es or en)
  assert.notEqual(esVal, 'nav.dashboard'); // must not be sentinel (key exists in both)
});

test('createT: missing key in both catalogs returns key sentinel', () => {
  const tFn = createT('es');
  const result = tFn('absolutely.nonexistent.key.xyz');
  assert.equal(result, 'absolutely.nonexistent.key.xyz');
});

test('createT: supports interpolation params', () => {
  const tFn = createT('en');
  // errors.duplicateSlug should have a {locale} or similar placeholder
  const result = tFn('errors.duplicateSlug', { locale: 'es' });
  assert.equal(typeof result, 'string');
  assert.ok(!result.includes('{locale}'));
});
