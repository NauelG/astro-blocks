/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * media-copy-guard.test.js — guards the media-surface vocabulary (issue #114).
 *
 * Two jobs:
 *   1. The picker titles itself by prop type (pure helper pickerTitleKeyForMode).
 *   2. Container surfaces (library, counters, picker grid) never say "image" —
 *      a regression guard so the "images-only" copy cannot creep back.
 *
 * Runs against dist/ (build first: `npm run build`), mirroring i18n-catalog.test.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../dist/routes/admin/i18n/catalogs.js';
import { pickerTitleKeyForMode } from '../dist/routes/admin/client/block-form/picker-title.js';

const LOCALES = ['en', 'es'];

// ─── 1. Picker title is mode-dependent ──────────────────────────────────────

test('pickerTitleKeyForMode maps image mode to the image key triple', () => {
  assert.deepEqual(pickerTitleKeyForMode('image'), {
    title: 'blockForm.pickerTitleImage',
    aria: 'blockForm.pickerAriaLabelImage',
    close: 'blockForm.pickerCloseImage',
  });
});

test('pickerTitleKeyForMode maps file mode to the media key triple', () => {
  assert.deepEqual(pickerTitleKeyForMode('file'), {
    title: 'blockForm.pickerTitleFile',
    aria: 'blockForm.pickerAriaLabelFile',
    close: 'blockForm.pickerCloseFile',
  });
});

test('picker title/aria/close pairs exist in every catalog', () => {
  const keys = [
    'blockForm.pickerTitleImage',
    'blockForm.pickerTitleFile',
    'blockForm.pickerAriaLabelImage',
    'blockForm.pickerAriaLabelFile',
    'blockForm.pickerCloseImage',
    'blockForm.pickerCloseFile',
  ];
  for (const locale of LOCALES) {
    for (const key of keys) {
      assert.ok(catalogs[locale][key], `${locale} missing ${key}`);
    }
  }
});

test('the old single-title picker keys are gone', () => {
  const removed = [
    'blockForm.pickerTitle',
    'blockForm.pickerAriaLabel',
    'blockForm.pickerClose',
  ];
  for (const locale of LOCALES) {
    for (const key of removed) {
      assert.ok(!(key in catalogs[locale]), `${locale} still has removed key ${key}`);
    }
  }
});

// ─── 2. Container surfaces never say "image" ────────────────────────────────

const IMAGE_WORD = /image|imagen/i;

test('picker-internal (grid/count/search) keys do not say "image"', () => {
  const containerKeys = [
    'blockForm.pickerLoading',
    'blockForm.pickerSearchLabel',
    'blockForm.pickerSearchAriaLabel',
    'blockForm.pickerUploadLabel',
    'blockForm.pickerEmpty',
    'blockForm.pickerCountOf',
    'blockForm.pickerCount0',
    'blockForm.pickerLoadError',
  ];
  for (const locale of LOCALES) {
    for (const key of containerKeys) {
      const value = catalogs[locale][key];
      assert.ok(value, `${locale} missing ${key}`);
      assert.ok(!IMAGE_WORD.test(value), `${locale} ${key} still says image: "${value}"`);
    }
  }
});

test('picker load-error key was renamed off "image"', () => {
  for (const locale of LOCALES) {
    assert.ok(!('blockForm.imageLoadError' in catalogs[locale]), `${locale} still has imageLoadError`);
    assert.ok(catalogs[locale]['blockForm.pickerLoadError'], `${locale} missing pickerLoadError`);
  }
});
