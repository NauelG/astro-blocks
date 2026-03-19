import test from 'node:test';
import assert from 'node:assert/strict';

import { localizeBlockPropsForRender } from '../dist/utils/block-props.js';

test('localizeBlockPropsForRender localizes only render-localizable fields', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title' },
        priority: { type: 'number', label: 'Priority' },
      },
    },
  };
  const localeKeys = new Set(['es', 'en']);
  const props = {
    title: { es: 'Hola', en: 'Hello' },
    priority: { es: 1, en: 2 },
    subtitle: { es: 'Sub', en: 'Sub EN' },
  };

  const output = localizeBlockPropsForRender(props, 'hero', schemaMap, 'en', 'es', localeKeys);

  assert.equal(output.title, 'Hello');
  assert.equal(output.subtitle, 'Sub EN');
  assert.deepEqual(output.priority, { es: 1, en: 2 });
});
