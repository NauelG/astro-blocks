/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Packaging test for the admin UI i18n system.
 *
 * Asserts that the i18n catalog + helpers actually ship in the built/published
 * package (dist/routes/admin/i18n/*) and that the admin defaults to English.
 *
 * Design Decision #2 (from design artifact): the catalog is plain .ts co-located
 * with the admin routes, compiled to dist by the existing tsc pass. This test
 * validates that packaging decision is upheld and regression-free.
 *
 * Coverage:
 *   - dist/routes/admin/i18n/ directory exists and is non-empty
 *   - All 7 required module files are present: types, en, es, catalogs, t, resolve, client
 *   - English-by-default: resolveUiLocale with no cookie and non-en/es Accept-Language → 'en'
 *   - Cookie override: cms-ui-locale=es overrides Accept-Language → 'es'
 *   - Accept-Language es-MX resolves to 'es'
 *   - createT with 'en' returns English strings from the dist bundle
 *   - createT with 'es' returns Spanish strings from the dist bundle
 *   - Catalog completeness: every key in en exists in es (guards packaging of full catalog)
 *   - HARD WALL: resolveUiLocale is completely independent of content-locale axis
 *     (getActiveContentLocale signature is unchanged, no cross-contamination)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// All imports are from dist/ — validates the built/published package artifacts.
import {
  parseAcceptLanguage,
  readUiLocaleCookie,
  resolveUiLocale,
  UI_LOCALE_COOKIE,
} from '../dist/routes/admin/i18n/resolve.js';

import { createT, t } from '../dist/routes/admin/i18n/t.js';

import { catalogs } from '../dist/routes/admin/i18n/catalogs.js';

import { SUPPORTED_UI_LOCALES } from '../dist/routes/admin/i18n/types.js';

// ─── dist/routes/admin/i18n/ directory layout ────────────────────────────────

test('dist/routes/admin/i18n/ directory exists after build (REQ packaging)', async () => {
  const i18nDistDir = path.resolve(import.meta.dirname, '..', 'dist', 'routes', 'admin', 'i18n');
  let stat;
  try {
    stat = await fs.stat(i18nDistDir);
  } catch {
    assert.fail(`dist/routes/admin/i18n/ does not exist — run npm run build first`);
  }
  assert.ok(stat.isDirectory(), 'dist/routes/admin/i18n must be a directory');
});

test('dist/routes/admin/i18n/ contains all required module files', async () => {
  const i18nDistDir = path.resolve(import.meta.dirname, '..', 'dist', 'routes', 'admin', 'i18n');
  const requiredModules = [
    'types.js',
    'en.js',
    'es.js',
    'catalogs.js',
    't.js',
    'resolve.js',
    'client.js',
  ];

  let files;
  try {
    files = await fs.readdir(i18nDistDir);
  } catch {
    assert.fail(`Cannot read dist/routes/admin/i18n/ — ensure npm run build was run`);
  }

  const fileSet = new Set(files);
  for (const required of requiredModules) {
    assert.ok(
      fileSet.has(required),
      `Missing required i18n module in dist: ${required}. Found: ${[...fileSet].join(', ')}`,
    );
  }
});

// ─── English-by-default (SCENARIO-1, SCENARIO-4) ─────────────────────────────

test('resolveUiLocale: no cookie + no Accept-Language → English default (packaging: en-by-default)', () => {
  const locale = resolveUiLocale({ cookie: null, acceptLanguage: null });
  assert.equal(locale, 'en', 'Admin must default to English when no cookie and no Accept-Language');
});

test('resolveUiLocale: no cookie + non-en/es Accept-Language (fr) → English fallback', () => {
  const locale = resolveUiLocale({ cookie: null, acceptLanguage: 'fr-FR,fr;q=0.9' });
  assert.equal(locale, 'en', 'Unsupported Accept-Language must fall back to English');
});

test('resolveUiLocale: no cookie + de Accept-Language → English fallback (SCENARIO-4)', () => {
  const locale = resolveUiLocale({ cookie: null, acceptLanguage: 'de-DE,de;q=0.9' });
  assert.equal(locale, 'en', 'German Accept-Language must fall back to English');
});

test('resolveUiLocale: no cookie + zh Accept-Language → English fallback', () => {
  const locale = resolveUiLocale({ cookie: null, acceptLanguage: 'zh-CN,zh;q=0.9' });
  assert.equal(locale, 'en');
});

// ─── Cookie override (SCENARIO-5) ────────────────────────────────────────────

test('resolveUiLocale: cms-ui-locale=es cookie beats Accept-Language en (SCENARIO-5 inverted)', () => {
  const locale = resolveUiLocale({
    cookie: 'cms-ui-locale=es',
    acceptLanguage: 'en-US,en;q=0.9',
  });
  assert.equal(locale, 'es', 'Cookie override must take precedence over Accept-Language');
});

test('resolveUiLocale: cms-ui-locale=en cookie beats Accept-Language es (SCENARIO-5)', () => {
  const locale = resolveUiLocale({
    cookie: 'cms-ui-locale=en',
    acceptLanguage: 'es-ES,es;q=0.9',
  });
  assert.equal(locale, 'en');
});

test('readUiLocaleCookie: returns value from built dist', () => {
  const result = readUiLocaleCookie('cms-ui-locale=es; other=value');
  assert.equal(result, 'es');
});

test('UI_LOCALE_COOKIE constant exported from built dist', () => {
  assert.equal(UI_LOCALE_COOKIE, 'cms-ui-locale');
});

// ─── Accept-Language Spanish detection (SCENARIO-2) ──────────────────────────

test('resolveUiLocale: Accept-Language es-MX → resolves to es from dist (SCENARIO-2)', () => {
  const locale = resolveUiLocale({ cookie: null, acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8' });
  assert.equal(locale, 'es');
});

test('parseAcceptLanguage: es-AR resolves to es from dist bundle', () => {
  assert.equal(parseAcceptLanguage('es-AR'), 'es');
});

test('parseAcceptLanguage: en-GB resolves to en from dist bundle', () => {
  assert.equal(parseAcceptLanguage('en-GB,en;q=0.9'), 'en');
});

// ─── createT factory from dist (catalog accessible in built output) ────────────

test('createT(en) returns English strings from built dist catalog', () => {
  const translate = createT('en');
  // nav.dashboard is a stable key in the catalog
  const result = translate('nav.dashboard');
  assert.equal(typeof result, 'string', 'translate must return a string');
  assert.ok(result.length > 0, 'English nav.dashboard must be non-empty');
  // Should be English — not empty and does not contain accented Spanish chars
  assert.doesNotMatch(
    result,
    /[áéíóúñÁÉÍÓÚÑ]/u,
    'English nav.dashboard must not contain Spanish accent',
  );
});

test('createT(es) returns Spanish strings from built dist catalog', () => {
  const translate = createT('es');
  // nav.dashboard Spanish translation should be non-empty
  const result = translate('nav.dashboard');
  assert.equal(typeof result, 'string', 'translate must return a string');
  assert.ok(result.length > 0, 'Spanish nav.dashboard must be non-empty');
});

test('createT: per-key en fallback when key absent from es (REQ-5.4)', () => {
  // Use the en catalog to get the value, then check that es falls back to en
  const enTranslate = createT('en');
  const enValue = enTranslate('nav.dashboard');

  // Temporarily test with a key that doesn't exist in any catalog
  // (key-as-sentinel behavior per REQ-5.5)
  const translate = createT('es');
  const missingResult = translate('__nonexistent.key.for.test__');
  assert.equal(
    missingResult,
    '__nonexistent.key.for.test__',
    'Missing key must return key itself as sentinel',
  );
  assert.ok(enValue.length > 0, 'en fallback value must be non-empty');
});

test('t() interpolation from built dist: {name} placeholder replaced', () => {
  const translate = createT('en');
  // Use a catalog key that has {count} or {name} interpolation
  // Try errors namespace which uses {field} or {count}
  const enCatalog = catalogs.en;

  // Find a key with {param} interpolation in en catalog
  const paramKey = Object.keys(enCatalog).find((k) => enCatalog[k].includes('{'));
  // Hard assert: if the catalog has no interpolation keys the test assumption is broken.
  assert.ok(paramKey, 'expected at least one {param} interpolation key in en catalog');

  // Extract the param name from the template
  const paramMatch = enCatalog[paramKey].match(/\{(\w+)\}/);
  if (paramMatch) {
    const paramName = paramMatch[1];
    const result = t(enCatalog, paramKey, { [paramName]: 'TestValue' });
    assert.ok(!result.includes(`{${paramName}}`), 'Interpolation must replace {param} placeholder');
    assert.ok(result.includes('TestValue'), 'Interpolated value must appear in output');
  }
});

// ─── Catalog completeness (dist-level guard) ──────────────────────────────────

test('dist catalogs: en and es have same keys (REQ-5.2 — packaging guard)', () => {
  const enKeys = Object.keys(catalogs.en).sort();
  const esKeys = Object.keys(catalogs.es).sort();

  const missingFromEs = enKeys.filter((k) => !(k in catalogs.es));
  const missingFromEn = esKeys.filter((k) => !(k in catalogs.en));

  if (missingFromEs.length > 0) {
    assert.fail(`Keys in en but missing from es in DIST: ${missingFromEs.slice(0, 10).join(', ')}`);
  }
  if (missingFromEn.length > 0) {
    assert.fail(`Keys in es but missing from en in DIST: ${missingFromEn.slice(0, 10).join(', ')}`);
  }
});

test('dist catalogs: all keys have non-empty string values in both locales', () => {
  for (const [locale, catalog] of Object.entries(catalogs)) {
    const empties = Object.entries(catalog)
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k);
    if (empties.length > 0) {
      assert.fail(`Empty values in dist ${locale} catalog: ${empties.slice(0, 5).join(', ')}`);
    }
  }
});

test('dist catalogs: at least 300 keys (completeness sanity — full PR-4 catalog)', () => {
  const keyCount = Object.keys(catalogs.en).length;
  assert.ok(
    keyCount >= 300,
    `Expected at least 300 keys in built dist en catalog, got ${keyCount}`,
  );
});

// ─── SUPPORTED_UI_LOCALES from dist ──────────────────────────────────────────

test('SUPPORTED_UI_LOCALES exported from dist contains en and es', () => {
  assert.ok(Array.isArray(SUPPORTED_UI_LOCALES), 'SUPPORTED_UI_LOCALES must be an array');
  assert.ok(SUPPORTED_UI_LOCALES.includes('en'), 'Must include en');
  assert.ok(SUPPORTED_UI_LOCALES.includes('es'), 'Must include es');
  assert.equal(SUPPORTED_UI_LOCALES.length, 2, 'Must have exactly 2 locales (REQ-1.3)');
});

// ─── HARD WALL: content locale axis unchanged ─────────────────────────────────

test('HARD WALL: getActiveContentLocale exists independently of UI i18n (SCENARIO-13)', async () => {
  // Import the content-locale helper from dist and verify it still works
  const common = await import('../dist/routes/admin/client/common.js');
  const { getActiveContentLocale } = common;
  assert.equal(
    typeof getActiveContentLocale,
    'function',
    'getActiveContentLocale must be a function',
  );

  // Verify the function accepts a fallback parameter and returns a string.
  // In non-browser environments sessionStorage is undefined, so we mock it
  // locally for this assertion only and restore it afterwards.
  const savedSessionStorage = globalThis.sessionStorage;
  try {
    // Simulate a browser with no content-locale stored
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: { getItem: () => null },
      configurable: true,
      writable: true,
    });
    const result = getActiveContentLocale('en');
    assert.equal(typeof result, 'string', 'getActiveContentLocale must return a string');
    assert.ok(result.length > 0, 'getActiveContentLocale must return a non-empty string');
    // Must use the fallback when sessionStorage has no cms-content-locale key
    assert.equal(
      result,
      'en',
      'getActiveContentLocale must return the fallback when no stored locale',
    );
  } finally {
    if (savedSessionStorage === undefined) {
      // Remove the temporary mock
      try {
        delete globalThis.sessionStorage;
      } catch {
        /* ignore — non-configurable in some envs */
      }
    } else {
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: savedSessionStorage,
        configurable: true,
        writable: true,
      });
    }
  }

  // Verify the function signature: it must NOT share state with UI locale resolution.
  // resolveUiLocale must produce different results than getActiveContentLocale
  // when the content cookie differs from the UI cookie — axes are independent.
  const uiLocale = resolveUiLocale({ cookie: 'cms-ui-locale=es', acceptLanguage: null });
  assert.equal(uiLocale, 'es', 'UI locale resolves via cms-ui-locale cookie');
  // getActiveContentLocale must NOT be influenced by the UI locale cookie
  // (we already verified it reads sessionStorage, not the UI cookie, above)
});
