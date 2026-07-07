/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Tests for PR-4 Part A — client-side translate helper (ct) resolution.
 *
 * Because ct() reads window.getCmsUiLocale(), we test the underlying
 * getUiLocale() fallback chain by stubbing document.cookie and verifying
 * that ct() returns keys from the correct catalog.
 *
 * Note: these tests run in Node.js (no DOM). The module guards against
 * typeof window === 'undefined' and returns DEFAULT_UI_LOCALE ('en').
 * We test the pure logic via createT() + catalogs directly, which is what
 * ct() delegates to.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Import from dist (compiled output) — same convention as all other tests
import { createT } from '../dist/routes/admin/i18n/t.js';
import { catalogs } from '../dist/routes/admin/i18n/catalogs.js';

test('ct equivalent: createT("en") resolves English string for common.noDate', () => {
  const t = createT('en');
  assert.equal(t('common.noDate'), 'No date');
});

test('ct equivalent: createT("es") resolves Spanish string for common.noDate', () => {
  const t = createT('es');
  assert.equal(t('common.noDate'), 'Sin fecha');
});

test('ct equivalent: createT("en") resolves pageEditor.newPage', () => {
  const t = createT('en');
  assert.equal(t('pageEditor.newPage'), 'New page');
});

test('ct equivalent: createT("es") resolves pageEditor.newPage', () => {
  const t = createT('es');
  assert.equal(t('pageEditor.newPage'), 'Nueva página');
});

test('ct equivalent: createT("en") resolves pageEditor.saveError', () => {
  const t = createT('en');
  assert.equal(t('pageEditor.saveError'), 'Error saving');
});

test('ct equivalent: createT("en") resolves pageEditor.blockDuplicated', () => {
  const t = createT('en');
  assert.equal(t('pageEditor.blockDuplicated'), 'Block duplicated.');
});

test('ct equivalent: createT("es") resolves pageEditor.blockDuplicated', () => {
  const t = createT('es');
  assert.equal(t('pageEditor.blockDuplicated'), 'Bloque duplicado.');
});

test('ct equivalent: createT("en") resolves menus.newMenuForm', () => {
  const t = createT('en');
  assert.equal(t('menus.newMenuForm'), 'New menu');
});

test('ct equivalent: createT("es") resolves menus.newMenuForm', () => {
  const t = createT('es');
  assert.equal(t('menus.newMenuForm'), 'Nuevo menú');
});

test('ct equivalent: createT("en") resolves redirects.deleted', () => {
  const t = createT('en');
  assert.equal(t('redirects.deleted'), 'Redirect deleted.');
});

test('ct equivalent: createT("en") resolves configs.deleted', () => {
  const t = createT('en');
  assert.equal(t('configs.deleted'), 'Parameter deleted.');
});

test('ct equivalent: createT("en") resolves globalBlocks.saved', () => {
  const t = createT('en');
  assert.equal(t('globalBlocks.saved'), 'Global block saved successfully.');
});

test('ct equivalent: createT("es") resolves globalBlocks.networkError', () => {
  const t = createT('es');
  assert.equal(t('globalBlocks.networkError'), 'Error de red al guardar. Revisa la conexión.');
});

test('ct equivalent: createT("en") resolves pageEditor.arrayMaxReached with interpolation', () => {
  const t = createT('en');
  assert.equal(
    t('pageEditor.arrayMaxReached', { value: '5' }),
    'You have reached the maximum of 5 item(s) in this field.',
  );
});

test('ct equivalent: createT("en") resolves blockForm.maxReached with interpolation', () => {
  const t = createT('en');
  assert.equal(t('blockForm.maxReached', { max: '3' }), 'You have reached the maximum of 3 items.');
});

test('ct equivalent: createT("en") resolves dialog.defaultErrorTitle', () => {
  const t = createT('en');
  assert.equal(t('dialog.defaultErrorTitle'), 'Error');
});

test('ct equivalent: createT("es") resolves dialog.defaultConfirmLabel', () => {
  const t = createT('es');
  assert.equal(t('dialog.defaultConfirmLabel'), 'Confirmar');
});

test('ct equivalent: getUiLocale() returns "en" in Node (no window)', async () => {
  // Dynamically import client.ts compiled output.
  // In Node.js, window is undefined, so getUiLocale() must return 'en'.
  const { getUiLocale } = await import('../dist/routes/admin/i18n/client.js');
  assert.equal(getUiLocale(), 'en');
});

test('ct equivalent: catalogs["en"] and catalogs["es"] both contain common.noDate', () => {
  assert.ok('common.noDate' in catalogs.en, 'en catalog missing common.noDate');
  assert.ok('common.noDate' in catalogs.es, 'es catalog missing common.noDate');
});

test('ct equivalent: catalogs["en"].common.noDate is "No date"', () => {
  assert.equal(catalogs.en['common.noDate'], 'No date');
});

test('ct equivalent: catalogs["es"].common.noDate is "Sin fecha"', () => {
  assert.equal(catalogs.es['common.noDate'], 'Sin fecha');
});
