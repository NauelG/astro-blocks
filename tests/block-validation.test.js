/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';

import { defineBlockSchema } from '../dist/contract/index.js';
import { validateSchemaItemsDefinition, validateBlockPropsAgainstSchema } from '../dist/utils/block-validation.js';
import { buildSchemaMap, resolveBlockEntries, validateBlocks } from '../dist/utils/blocks.js';

test('validateSchemaItemsDefinition rejects invalid array object summaryField', () => {
  const message = validateSchemaItemsDefinition(
    {
      faqs: {
        type: 'array',
        label: 'FAQs',
        item: {
          type: 'object',
          label: 'FAQ',
          summaryField: 'missing',
          fields: {
            question: { type: 'string', label: 'Question' },
          },
        },
      },
    },
    'Hero'
  );

  assert.match(message || '', /summaryField/);
});

test('resolveBlockEntries fails fast on unsupported nested array schema', () => {
  assert.throws(() => {
    resolveBlockEntries('/tmp/project', [
      defineBlockSchema(
        {
          name: 'Hero',
          items: {
            list: {
              type: 'array',
              label: 'List',
              item: {
                type: 'object',
                label: 'List item',
                fields: {
                  nested: {
                    // @ts-expect-error: runtime schema validation must reject this shape.
                    type: 'array',
                    label: 'Nested',
                    item: { type: 'string', label: 'Text' },
                  },
                },
              },
            },
          },
        },
        'file:///tmp/project/src/Hero.astro'
      ),
    ]);
  }, /no soporta fields anidados/);
});

test('validateBlocks supports array primitive limits', () => {
  const schemaMap = buildSchemaMap(
    resolveBlockEntries('/tmp/project', [
      defineBlockSchema(
        {
          name: 'Hero',
          items: {
            tags: {
              type: 'array',
              label: 'Tags',
              required: true,
              minItems: 1,
              maxItems: 3,
              item: { type: 'string', label: 'Tag' },
            },
          },
        },
        'file:///tmp/project/src/Hero.astro'
      ),
    ])
  );

  assert.equal(validateBlocks(schemaMap, [{ type: 'Hero', props: { tags: ['alpha', 'beta'] } }]), null);
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: { tags: [] } }])?.message || '', /es obligatorio|requiere al menos 1 elemento/);
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: { tags: ['a', '', 'c'] } }])?.message || '', /elemento 2/);
});

test('validateBlocks validates required fields inside array<object>', () => {
  const schemaMap = buildSchemaMap(
    resolveBlockEntries('/tmp/project', [
      defineBlockSchema(
        {
          name: 'FAQ',
          items: {
            faqs: {
              type: 'array',
              label: 'FAQs',
              item: {
                type: 'object',
                label: 'FAQ',
                summaryField: 'question',
                fields: {
                  question: { type: 'string', label: 'Pregunta', required: true },
                  answer: { type: 'text', label: 'Respuesta', required: true },
                },
              },
            },
          },
        },
        'file:///tmp/project/src/FAQ.astro'
      ),
    ])
  );

  assert.equal(
    validateBlocks(schemaMap, [
      {
        type: 'FAQ',
        props: {
          faqs: [{ question: '¿Qué es AstroBlocks?', answer: 'Un CMS de bloques.' }],
        },
      },
    ]),
    null
  );

  assert.match(
    validateBlocks(schemaMap, [{ type: 'FAQ', props: { faqs: [{ question: 'Sin respuesta' }] } }])?.message || '',
    /Respuesta/
  );
});

// ─── FIX-2: image validator must reject zero and negative dimensions ───────────

const IMAGE_SCHEMA = {
  hero: { type: 'image', label: 'Hero image', required: false },
};

test('FIX-2: validator rejects negative width on image prop', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', width: -1, height: 100 },
  });
  assert.ok(issue !== null, 'negative width must produce a validation error');
  assert.match(issue.message, /width/);
});

test('FIX-2: validator rejects zero width on image prop', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', width: 0, height: 100 },
  });
  assert.ok(issue !== null, 'zero width must produce a validation error');
  assert.match(issue.message, /width/);
});

test('FIX-2: validator rejects negative height on image prop', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', width: 800, height: -1 },
  });
  assert.ok(issue !== null, 'negative height must produce a validation error');
  assert.match(issue.message, /height/);
});

test('FIX-2: validator rejects zero height on image prop', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', width: 800, height: 0 },
  });
  assert.ok(issue !== null, 'zero height must produce a validation error');
  assert.match(issue.message, /height/);
});

test('FIX-2: validator accepts positive integer dimensions on image prop', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', width: 800, height: 600 },
  });
  assert.equal(issue, null, 'positive integer dimensions must pass validation');
});

// ─── P2: caption validation (media-caption change) ────────────────────────────

test('validator accepts string caption', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', caption: 'A visible description' },
  });
  assert.equal(issue, null, 'string caption must pass validation');
});

test('validator accepts absent caption', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok' },
  });
  assert.equal(issue, null, 'missing caption must pass validation');
});

test('validator rejects non-string caption (boolean)', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', caption: true },
  });
  assert.ok(issue !== null, 'boolean caption must produce a validation error');
  assert.match(issue.message, /caption/);
});

test('validator rejects non-string caption (number)', () => {
  const issue = validateBlockPropsAgainstSchema('TestBlock', 0, IMAGE_SCHEMA, {
    hero: { url: '/img.jpg', alt: 'ok', caption: 42 },
  });
  assert.ok(issue !== null, 'number caption must produce a validation error');
  assert.match(issue.message, /caption/);
});
