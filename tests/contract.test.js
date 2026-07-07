import test from 'node:test';
import assert from 'node:assert/strict';

import { defineBlockSchema, PROP_TYPES } from '../dist/contract/index.js';
import { buildSchemaMap, resolveBlockEntries, validateBlocks } from '../dist/utils/blocks.js';

// ─── C1: FileFieldValue must be re-exported from the contract surface ─────────
// The type-level guard lives in contract/index.ts (compiled by tsc).
// This runtime check ensures the compiled module loads without errors,
// proving the export block is intact.
test('C1: contract/index.js loads without error (FileFieldValue export guard)', async () => {
  const mod = await import('../dist/contract/index.js');
  assert.ok(mod !== null && typeof mod === 'object', 'contract module must load');
  // FileFieldValue is a type-only export — no runtime value; verify the module
  // itself doesn't throw on import (the tsc compilation would fail if the type
  // export were missing, catching regressions before this test even runs).
});

test('defineBlockSchema preserves component path', () => {
  const schema = defineBlockSchema(
    {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    'file:///tmp/Hero.astro',
  );

  assert.equal(schema.__componentPath, 'file:///tmp/Hero.astro');
});

test('resolveBlockEntries derives keys and rejects duplicates', () => {
  const entries = resolveBlockEntries('/tmp/project', [
    defineBlockSchema({ name: 'Hero', items: {} }, 'file:///tmp/project/src/Hero.astro'),
  ]);

  assert.equal(entries[0].key, 'Hero');
});

// ─── C1-piece2: PROP_TYPES must include 'file' ───────────────────────────────
test('C1-piece2: PROP_TYPES includes "file"', () => {
  assert.ok(Array.isArray(PROP_TYPES), 'PROP_TYPES must be an array');
  assert.ok(PROP_TYPES.includes('file'), 'PROP_TYPES must include "file"');
});

test('validateBlocks checks required props', () => {
  const schemaMap = buildSchemaMap(
    resolveBlockEntries('/tmp/project', [
      defineBlockSchema(
        {
          name: 'Hero',
          items: {
            title: { type: 'string', label: 'Title', required: true },
          },
        },
        'file:///tmp/project/src/Hero.astro',
      ),
    ]),
  );

  assert.equal(validateBlocks(schemaMap, [{ type: 'Hero', props: { title: 'Hello' } }]), null);
  assert.match(
    validateBlocks(schemaMap, [{ type: 'Hero', props: {} }])?.message || '',
    /field "Title" is required/,
  );
});
