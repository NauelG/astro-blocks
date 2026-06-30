/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { DATA_SCHEMA_VERSION } from '../dist/api/schema-version.js';

test('A-2: DATA_SCHEMA_VERSION is a number', () => {
  assert.equal(typeof DATA_SCHEMA_VERSION, 'number');
});

test('A-2: DATA_SCHEMA_VERSION equals 1', () => {
  assert.equal(DATA_SCHEMA_VERSION, 1);
});

test('A-2: DATA_SCHEMA_VERSION is greater than 0', () => {
  assert.ok(DATA_SCHEMA_VERSION > 0);
});
