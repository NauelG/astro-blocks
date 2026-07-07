import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeBlockPropsForLocale,
  projectBlockProps,
  removeLocaleFromLocalizedMap,
  removeLocaleFromPage,
} from '../dist/utils/locale-projection.js';

const localeKeys = new Set(['es', 'en']);

test('projectBlockProps projects a localized map value to the requested locale', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title' },
      },
    },
  };
  const block = {
    type: 'hero',
    props: {
      title: { es: 'Hola', en: 'Hello' },
    },
  };

  const output = projectBlockProps(block, schemaMap, 'en', localeKeys);
  assert.equal(output.title, 'Hello');
});

test('projectBlockProps coerces image-type props via toImageValue', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        picture: { type: 'image', label: 'Picture' },
      },
    },
  };
  const block = {
    type: 'hero',
    props: {
      picture: '/img/a.jpg',
    },
  };

  const output = projectBlockProps(block, schemaMap, 'en', localeKeys);
  assert.equal(output.picture.url, '/img/a.jpg');
});

test('projectBlockProps passes through non-localized, non-image props unchanged', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        priority: { type: 'number', label: 'Priority' },
      },
    },
  };
  const block = {
    type: 'hero',
    props: { priority: 3 },
  };

  const output = projectBlockProps(block, schemaMap, 'en', localeKeys);
  assert.equal(output.priority, 3);
});

test('mergeBlockPropsForLocale merges an incoming non-localized value into an existing localized map', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title', localizable: true },
      },
    },
  };
  const existingBlock = {
    type: 'hero',
    props: { title: { es: 'Hola', en: 'Hello' } },
  };
  const incomingBlock = {
    type: 'hero',
    props: { title: 'Bonjour' },
  };

  const merged = mergeBlockPropsForLocale(
    existingBlock,
    incomingBlock,
    schemaMap,
    'fr',
    localeKeys,
  );
  assert.deepEqual(merged.props.title, { es: 'Hola', en: 'Hello', fr: 'Bonjour' });
});

test('mergeBlockPropsForLocale preserves existing props not present in the incoming block', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title', localizable: false },
        subtitle: { type: 'string', label: 'Subtitle', localizable: false },
      },
    },
  };
  const existingBlock = {
    type: 'hero',
    props: { title: 'Hello', subtitle: 'Kept' },
  };
  const incomingBlock = {
    type: 'hero',
    props: { title: 'Updated' },
  };

  const merged = mergeBlockPropsForLocale(
    existingBlock,
    incomingBlock,
    schemaMap,
    'en',
    localeKeys,
  );
  assert.equal(merged.props.title, 'Updated');
  assert.equal(merged.props.subtitle, 'Kept');
  assert.equal(merged.type, 'hero');
});

test('removeLocaleFromLocalizedMap drops the given locale and preserves others', () => {
  const result = removeLocaleFromLocalizedMap({ es: 'Hola', en: 'Hello' }, 'es');
  assert.deepEqual(result, { en: 'Hello' });
});

test('removeLocaleFromLocalizedMap returns undefined when no locales remain', () => {
  const result = removeLocaleFromLocalizedMap({ es: 'Hola' }, 'es');
  assert.equal(result, undefined);
});

test('removeLocaleFromLocalizedMap passes through non-map input unchanged', () => {
  assert.equal(removeLocaleFromLocalizedMap(undefined, 'es'), undefined);
});

test('removeLocaleFromPage returns null when removing the last remaining locale', () => {
  const page = {
    title: { es: 'Inicio' },
    slug: { es: 'inicio' },
    status: { es: 'published' },
    blocks: [],
  };

  const result = removeLocaleFromPage(page, 'es', null, localeKeys);
  assert.equal(result, null);
});

test('removeLocaleFromPage strips the given locale from titles, slugs, status, seo and blocks', () => {
  const schemaMap = {
    hero: {
      name: 'Hero',
      items: {
        title: { type: 'string', label: 'Title', localizable: true },
      },
    },
  };
  const page = {
    title: { es: 'Inicio', en: 'Home' },
    slug: { es: 'inicio', en: 'home' },
    status: { es: 'published', en: 'published' },
    seo: {
      title: { es: 'SEO ES', en: 'SEO EN' },
    },
    blocks: [
      {
        type: 'hero',
        props: { title: { es: 'Hola', en: 'Hello' } },
      },
    ],
  };

  const result = removeLocaleFromPage(page, 'en', schemaMap, localeKeys);
  assert.deepEqual(result.title, { es: 'Inicio' });
  assert.deepEqual(result.slug, { es: 'inicio' });
  assert.deepEqual(result.status, { es: 'published' });
  assert.deepEqual(result.seo.title, { es: 'SEO ES' });
  assert.deepEqual(result.blocks[0].props.title, { es: 'Hola' });
});
