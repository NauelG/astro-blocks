import test from 'node:test';
import assert from 'node:assert/strict';

import { defineBlockSchema } from '../dist/contract/index.js';
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
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: {} }])?.message || '', /campo "Title" es obligatorio/);
});
