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
  }, /does not support nested fields/);
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
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: { tags: [] } }])?.message || '', /is required|requires at least 1 item/);
  assert.match(validateBlocks(schemaMap, [{ type: 'Hero', props: { tags: ['a', '', 'c'] } }])?.message || '', /element 2/);
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
    /Respuesta|is required|required/
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

// ─── T1.1: messageKey presence and bilingual rendering ───────────────────────

test('T1.1: validateBlockPropsAgainstSchema issue has messageKey + params', () => {
  const issue = validateBlockPropsAgainstSchema('Hero', 0, {
    title: { type: 'string', label: 'Title', required: true },
  }, {});
  assert.ok(issue !== null, 'missing required field must produce a validation error');
  assert.ok(typeof issue.messageKey === 'string', 'issue must have a messageKey');
  assert.ok(typeof issue.params === 'object', 'issue must have params');
  assert.equal(issue.messageKey, 'blockValidation.fieldRequired');
  assert.ok(issue.params.blockName === 'Hero', 'params must include blockName');
  assert.ok(issue.params.label === 'Title', 'params must include label');
});

test('T1.1: issue.message is English (backward compat)', () => {
  const issue = validateBlockPropsAgainstSchema('Hero', 0, {
    title: { type: 'string', label: 'Title', required: true },
  }, {});
  assert.ok(issue !== null);
  assert.match(issue.message, /field "Title" is required/);
  // Must NOT be Spanish
  assert.ok(!issue.message.includes('obligatorio'), 'issue.message must not be Spanish');
});

// ─── Slice C: 'file' prop type validation (deferred from Slice A) ─────────────
// C1 piece 1: 'file' must be in PRIMITIVE_TYPES (isPrimitivePropType)
// C1 piece 2: 'file' must be accepted in PROP_TYPES contract (covered in contract.test.js)
// C1 piece 3: validatePrimitiveValue must have a 'file' branch

const FILE_SCHEMA = {
  brochure: { type: 'file', label: 'Brochure PDF', required: false },
};

const FILE_SCHEMA_REQUIRED = {
  brochure: { type: 'file', label: 'Brochure PDF', required: true },
};

test('C1-piece1: isPrimitivePropType accepts "file" (schema validates without error)', () => {
  // validateSchemaItemsDefinition calls isPrimitivePropType — if 'file' is absent it returns an error
  const msg = validateSchemaItemsDefinition(
    { brochure: { type: 'file', label: 'PDF' } },
    'Download'
  );
  assert.equal(msg, null, `expected null but got: ${msg}`);
});

test('C1-piece3: valid file value with url passes validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {
    brochure: { url: '/uploads/2026/06/doc.pdf' },
  });
  assert.equal(issue, null, 'valid file value with url must pass');
});

test('C1-piece3: file value with all optional fields passes validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {
    brochure: { url: '/uploads/doc.pdf', filename: 'report.pdf', mimeType: 'application/pdf', download: true },
  });
  assert.equal(issue, null, 'full file value must pass');
});

test('C1-piece3: null file value on optional prop passes', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {
    brochure: null,
  });
  assert.equal(issue, null, 'null on optional file prop must pass');
});

test('C1-piece3: missing file value on optional prop passes', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {});
  assert.equal(issue, null, 'absent optional file prop must pass');
});

test('C1-piece3: file value without url (non-object) fails validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {
    brochure: 'not-an-object',
  });
  assert.ok(issue !== null, 'non-object file value must fail');
});

test('C1-piece3: file value with numeric url fails validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA, {
    brochure: { url: 123 },
  });
  assert.ok(issue !== null, 'numeric url must fail');
});

test('C1-piece3: required file value with empty url fails validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA_REQUIRED, {
    brochure: { url: '' },
  });
  assert.ok(issue !== null, 'required file with empty url must fail');
});

test('C1-piece3: required file value with non-empty url passes', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA_REQUIRED, {
    brochure: { url: '/uploads/doc.pdf' },
  });
  assert.equal(issue, null, 'required file with valid url must pass');
});

test('C1-piece3: required null file value fails validation', () => {
  const issue = validateBlockPropsAgainstSchema('Download', 0, FILE_SCHEMA_REQUIRED, {
    brochure: null,
  });
  assert.ok(issue !== null, 'null on required file prop must fail');
});
