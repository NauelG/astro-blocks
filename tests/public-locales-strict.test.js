import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getMenuItems,
  getMenuItemsStrict,
  getPageBySlug,
  getPageBySlugStrict,
  getPageLocaleViewStrict,
  getPublishedPages,
  getPublishedPagesStrict,
} from '../dist/api/data.js';

test('strict page helpers do not publish a locale variant that does not exist', () => {
  const pagesData = {
    pages: [
      {
        id: 'home',
        title: { es: 'Inicio' },
        slug: { es: '/' },
        status: { es: 'published' },
        blocks: [],
      },
    ],
  };

  assert.equal(getPublishedPages(pagesData, 'en', 'es').length, 1);
  assert.equal(getPublishedPagesStrict(pagesData, 'en').length, 0);
  assert.equal(Boolean(getPageBySlug(pagesData, '/', 'en', 'es')), true);
  assert.equal(Boolean(getPageBySlugStrict(pagesData, '/', 'en')), false);
});

test('strict page locale view keeps missing locale as draft instead of falling back', () => {
  const page = {
    id: 'home',
    title: { es: 'Inicio' },
    slug: { es: '/' },
    status: { es: 'published' },
    seo: { description: { es: 'Descripcion' } },
    blocks: [],
  };

  const strictView = getPageLocaleViewStrict(page, 'en');

  assert.equal(strictView.status, 'draft');
  assert.equal(strictView.title, 'Untitled');
  assert.equal(strictView.slug, '/');
  assert.equal(strictView.seo?.description, undefined);
});

test('strict menu helper returns empty list when locale does not exist', () => {
  const menu = {
    id: 'main',
    name: 'Main',
    selector: 'main',
    items: {
      es: [{ name: 'Inicio', path: '/' }],
    },
  };

  assert.equal(getMenuItems(menu, 'en', 'es').length, 1);
  assert.equal(getMenuItemsStrict(menu, 'en').length, 0);
});
