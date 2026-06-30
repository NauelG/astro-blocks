import test from 'node:test';
import assert from 'node:assert/strict';

import { defineBlockSchema, PROP_TYPES } from '../dist/contract/index.js';
import { buildSchemaMap, resolveBlockEntries, validateBlocks } from '../dist/utils/blocks.js';

test('defineBlockSchema preserves component path', () => {
  const schema = defineBlockSchema(
    {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title', required: true },
      },
    },
    'file:///tmp/Hero.astro'
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
        'file:///tmp/project/src/Hero.astro'
      ),
    ])
  );

  assert.equal(validateBlocks(schemaMap, [{ type: 'Hero', props: { title: 'Hello' } }]), null);
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: {} }])?.message || '', /field "Title" is required/);
});
