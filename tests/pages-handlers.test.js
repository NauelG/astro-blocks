/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadPages } from '../dist/api/data.js';
import {
  handleGetBlockSchemas,
  handlePostPages,
  handlePutPage,
  handleDeletePage,
} from '../dist/api/handlers.js';

async function withTempProject(fn) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-pages-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();

  try {
    await fn(tempRoot);
  } finally {
    if (previousRoot === undefined) {
      delete process.env.ASTRO_BLOCKS_PROJECT_ROOT;
    } else {
      process.env.ASTRO_BLOCKS_PROJECT_ROOT = previousRoot;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

// Seed a minimal schema-map.mjs in the tempRoot .astro-blocks dir for block validation
async function seedSchemaMap(tempRoot, schemaMap) {
  const dir = path.join(tempRoot, '.astro-blocks');
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '};',
  ];
  await fs.writeFile(path.join(dir, 'schema-map.mjs'), lines.join('\n'), 'utf-8');
}

// --- handleGetBlockSchemas ---

test('handleGetBlockSchemas returns 500 when schema-map.mjs is missing', async () => {
  await withTempProject(async () => {
    // No schema-map.mjs seeded — should return an error
    const response = await handleGetBlockSchemas();
    assert.equal(response.status, 500);
    const body = await response.json();
    assert.ok(body.error, 'should include error message');
  });
});

test('handleGetBlockSchemas returns 200 with schema map when file is present', async () => {
  await withTempProject(async (tempRoot) => {
    await seedSchemaMap(tempRoot, {
      Hero: { name: 'Hero', items: { title: { type: 'string', label: 'Title', required: true } } },
    });

    const response = await handleGetBlockSchemas();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.Hero, 'should contain the Hero schema entry');
    assert.equal(body.Hero.name, 'Hero');
  });
});

// --- handlePostPages ---

test('handlePostPages creates a page with no blocks (happy path)', async () => {
  await withTempProject(async () => {
    const response = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Home', slug: '/', status: 'published', blocks: [] }),
      })
    );

    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.title, 'Home');
    assert.equal(page.slug, '/');
    assert.equal(page.status, 'published');
    assert.ok(page.id, 'page should have an id');
  });
});

test('handlePostPages persists the page to data store', async () => {
  await withTempProject(async () => {
    await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'About', slug: '/about', status: 'draft', blocks: [] }),
      })
    );

    const pagesData = await loadPages();
    assert.equal(pagesData.pages.length, 1);
    // slug is stored as a localized value map; check id and title persistence
    assert.ok(pagesData.pages[0].id);
  });
});

test('handlePostPages returns 400 on duplicate slug', async () => {
  await withTempProject(async () => {
    // Create first page
    await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Home', slug: '/', blocks: [] }),
      })
    );

    // Attempt duplicate slug
    const duplicate = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Home2', slug: '/', blocks: [] }),
      })
    );

    assert.equal(duplicate.status, 400);
    assert.equal((await duplicate.json()).error, 'Ya existe una página con ese slug para este idioma.');
  });
});

test('handlePostPages returns 400 when blocks contain an unknown block type', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed an empty schema map — 'Hero' won't be found
    await seedSchemaMap(tempRoot, {});

    const response = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          slug: '/test',
          blocks: [{ type: 'Hero', props: { title: 'Hello' } }],
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /unknown type "Hero"/);
  });
});

test('handlePostPages returns 400 when blocks fail schema prop validation', async () => {
  await withTempProject(async (tempRoot) => {
    // Seed a schema that requires a 'title' field
    await seedSchemaMap(tempRoot, {
      Hero: {
        name: 'Hero',
        items: { title: { type: 'string', label: 'Title', required: true } },
      },
    });

    const response = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          slug: '/test',
          blocks: [{ type: 'Hero', props: {} }], // missing required title
        }),
      })
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.match(body.error, /campo "Title" es obligatorio/);
  });
});

test('handlePostPages returns 500 when blocks are provided but schema-map.mjs is missing', async () => {
  await withTempProject(async () => {
    // No schema file seeded — providing blocks triggers schema load, which fails
    const response = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test',
          slug: '/test',
          blocks: [{ type: 'Hero', props: {} }],
        }),
      })
    );

    assert.equal(response.status, 500);
    const body = await response.json();
    assert.ok(body.error, 'should include error message');
  });
});

// --- handlePutPage ---

test('handlePutPage updates title and slug and persists changes', async () => {
  await withTempProject(async () => {
    // Create a page first
    const createRes = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Original', slug: '/original', status: 'draft', blocks: [] }),
      })
    );
    const created = await createRes.json();

    // Update it
    const putRes = await handlePutPage(
      created.id,
      new Request(`http://localhost/cms/api/pages/${created.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Updated', slug: '/updated', status: 'published' }),
      })
    );

    assert.equal(putRes.status, 200);
    const updated = await putRes.json();
    assert.equal(updated.title, 'Updated');
    // normalizeSlugInput strips the leading slash for single-segment slugs:
    // '/updated' → splitSlugSegments → ['updated'] → joinSlugSegments → 'updated'
    assert.equal(updated.slug, 'updated');
    assert.equal(updated.status, 'published');
  });
});

test('handlePutPage returns 404 for non-existent page id', async () => {
  await withTempProject(async () => {
    const response = await handlePutPage(
      'nonexistent-id',
      new Request('http://localhost/cms/api/pages/nonexistent-id', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Whatever' }),
      })
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
  });
});

test('handlePutPage returns 400 on duplicate slug during update', async () => {
  await withTempProject(async () => {
    // Create two pages
    const res1 = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Page One', slug: '/page-one', blocks: [] }),
      })
    );
    const page1 = await res1.json();

    const res2 = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Page Two', slug: '/page-two', blocks: [] }),
      })
    );
    const page2 = await res2.json();

    // Try to rename page2's slug to page1's slug
    const conflict = await handlePutPage(
      page2.id,
      new Request(`http://localhost/cms/api/pages/${page2.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: '/page-one' }),
      })
    );

    assert.equal(conflict.status, 400);
    assert.equal((await conflict.json()).error, 'Ya existe una página con ese slug para este idioma.');
  });
});

// --- handleDeletePage ---

test('handleDeletePage removes the page and returns 204', async () => {
  await withTempProject(async () => {
    // Create a page
    const createRes = await handlePostPages(
      new Request('http://localhost/cms/api/pages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'To Delete', slug: '/to-delete', blocks: [] }),
      })
    );
    const created = await createRes.json();

    // Delete it
    const deleteRes = await handleDeletePage(
      created.id,
      new Request(`http://localhost/cms/api/pages/${created.id}`, { method: 'DELETE' })
    );

    assert.equal(deleteRes.status, 204);

    // Verify it is gone from the store
    const pagesData = await loadPages();
    assert.equal(pagesData.pages.length, 0);
  });
});

test('handleDeletePage returns 404 for a non-existent page id', async () => {
  await withTempProject(async () => {
    const response = await handleDeletePage(
      'does-not-exist',
      new Request('http://localhost/cms/api/pages/does-not-exist', { method: 'DELETE' })
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error);
  });
});
