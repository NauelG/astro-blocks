import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { getDefaultLocale, getPageLocaleView, loadLanguages, loadPages } from '../dist/api/data.js';

test('loadPages preserves legacy scalar fields as localized values', async () => {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-legacy-pages-'));

  try {
    const dataDir = path.join(tempRoot, 'data');
    await fs.mkdir(dataDir, { recursive: true });

    await fs.writeFile(
      path.join(dataDir, 'pages.json'),
      JSON.stringify({
        pages: [
          {
            id: 'home',
            slug: '/',
            status: 'published',
            title: 'Home',
            blocks: [],
            indexable: true,
            seo: { title: 'Home SEO' },
          },
          {
            id: 'contact',
            slug: '/contact',
            status: 'draft',
            title: 'Contact',
            blocks: [],
            indexable: false,
            seo: { description: 'Contact page' },
          },
        ],
      }),
      'utf-8'
    );

    await fs.writeFile(
      path.join(dataDir, 'languages.json'),
      JSON.stringify({
        languages: [
          { code: 'es', label: 'Español', enabled: true, isDefault: true },
          { code: 'en', label: 'English', enabled: true, isDefault: false },
        ],
      }),
      'utf-8'
    );

    process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;

    const pagesData = await loadPages();
    const languagesData = await loadLanguages();
    const defaultLocale = getDefaultLocale(languagesData);
    const views = pagesData.pages.map((page) => getPageLocaleView(page, defaultLocale, defaultLocale));

    assert.equal(views[0].title, 'Home');
    assert.equal(views[0].slug, '/');
    assert.equal(views[0].status, 'published');
    assert.equal(views[0].seo?.title, 'Home SEO');

    assert.equal(views[1].title, 'Contact');
    assert.equal(views[1].slug, '/contact');
    assert.equal(views[1].status, 'draft');
    assert.equal(views[1].indexable, false);
    assert.equal(views[1].seo?.description, 'Contact page');
  } finally {
    if (previousRoot === undefined) delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    else process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

