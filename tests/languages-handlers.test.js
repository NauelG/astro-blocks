/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { ensureDefaultFiles, loadLanguages } from '../dist/api/data.js';
import {
  handleDeleteLanguage,
  handleGetLanguages,
  handlePostLanguages,
  handlePutLanguage,
} from '../dist/api/handlers.js';

/**
 * A temp project is, by default, a project that WORKS — which since ADR-0025 means one whose
 * block schema map resolves. Pass `{ seedSchema: false }` to get a broken one on purpose.
 */
async function withTempProject(fn, { seedSchema = true } = {}) {
  const previousRoot = process.env.ASTRO_BLOCKS_PROJECT_ROOT;
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'astro-blocks-languages-'));

  process.env.ASTRO_BLOCKS_PROJECT_ROOT = tempRoot;
  await ensureDefaultFiles();
  if (seedSchema) await seedSchemaMap(tempRoot);

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

// Seed a minimal schema-map.mjs in the tempRoot .astro-blocks dir. handleDeleteLanguage
// strips the locale from every page's block props, which needs the schema map — so an
// unresolvable one is a hard failure (ADR-0025), not a null-schema best effort.
async function seedSchemaMap(tempRoot, schemaMap = { Hero: { name: 'Hero', items: {} } }) {
  const dir = path.join(tempRoot, '.astro-blocks');
  await fs.mkdir(dir, { recursive: true });
  const lines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '};',
  ];
  await fs.writeFile(path.join(dir, 'schema-map.mjs'), lines.join('\n'), 'utf-8');
}

test('handleGetLanguages returns default language list', async () => {
  await withTempProject(async () => {
    const response = await handleGetLanguages();

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(Array.isArray(body.languages));
    // The default setup ships with Spanish as the only language
    assert.equal(body.languages.length, 1);
    assert.equal(body.languages[0].code, 'es');
    assert.equal(body.languages[0].isDefault, true);
  });
});

test('language handlers support full CRUD lifecycle', async () => {
  await withTempProject(async () => {
    // Add a new language
    const postResponse = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'EN', label: 'English', enabled: true }),
      }),
    );

    assert.equal(postResponse.status, 200);
    const created = await postResponse.json();
    // Code should be normalized to lowercase
    assert.equal(created.code, 'en');
    assert.equal(created.label, 'English');
    assert.equal(created.enabled, true);

    // List — should now have 2 (es + en)
    const getResponse = await handleGetLanguages();
    const listed = await getResponse.json();
    assert.equal(listed.languages.length, 2);
    assert.ok(listed.languages.some((lang) => lang.code === 'en'));

    // Update the language label
    const putResponse = await handlePutLanguage(
      'en',
      new Request('http://localhost/cms/api/languages/en', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'English (US)' }),
      }),
    );

    assert.equal(putResponse.status, 200);
    const updated = await putResponse.json();
    assert.equal(updated.label, 'English (US)');
    assert.equal(updated.code, 'en');

    // Verify persisted state via data loader
    const persisted = await loadLanguages();
    const enEntry = persisted.languages.find((lang) => lang.code === 'en');
    assert.ok(enEntry);
    assert.equal(enEntry.label, 'English (US)');

    // Delete the added language
    const deleteResponse = await handleDeleteLanguage('en');
    assert.equal(deleteResponse.status, 200);
    const deleteBody = await deleteResponse.json();
    assert.equal(deleteBody.ok, true);
    assert.equal(deleteBody.deletedLocale, 'en');

    // Verify only the default (es) remains
    const afterDelete = await loadLanguages();
    assert.equal(afterDelete.languages.length, 1);
    assert.equal(afterDelete.languages[0].code, 'es');
  });
});

/**
 * S-7. Deleting a language is destructive and irreversible: it strips the locale from every
 * page and menu. It must not run on a schema map the system could not resolve.
 *
 * Asserting the 500 is the easy half. The half that matters is that NOTHING was written —
 * before ADR-0025 this handler ignored the resolution failure and deleted anyway.
 */
test('handleDeleteLanguage returns 500 and writes nothing when the schema map cannot be resolved', async () => {
  await withTempProject(
    async (tempRoot) => {
      const dataDir = path.join(tempRoot, 'data');
      const read = async (file) => fs.readFile(path.join(dataDir, file), 'utf-8');

      await handlePostLanguages(
        new Request('http://localhost/cms/api/languages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
        }),
      );

      const before = {
        languages: await read('languages.json'),
        pages: await read('pages.json'),
        menus: await read('menus.json'),
      };

      const response = await handleDeleteLanguage('en');
      assert.equal(response.status, 500);

      assert.equal(
        await read('languages.json'),
        before.languages,
        'languages.json must be untouched',
      );
      assert.equal(await read('pages.json'), before.pages, 'pages.json must be untouched');
      assert.equal(await read('menus.json'), before.menus, 'menus.json must be untouched');
    },
    { seedSchema: false },
  );
});

test('handlePostLanguages rejects missing code', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'No Code' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Language code is required.');
  });
});

test('handlePostLanguages rejects invalid code format', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'invalid code!', label: 'Bad' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid language code. Use format like "es" or "pt-br".');
  });
});

test('handlePostLanguages rejects an invalid label, localized', async () => {
  await withTempProject(async () => {
    const twoLines = 'two\nlines';
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'fr', label: twoLines }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid language label. Use a single line of up to 80 characters.');

    const oversized = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'es',
        },
        body: JSON.stringify({ code: 'fr', label: 'x'.repeat(81) }),
      }),
    );

    assert.equal(oversized.status, 400);
    const oversizedBody = await oversized.json();
    assert.equal(
      oversizedBody.error,
      'Etiqueta de idioma no válida. Usa una sola línea de hasta 80 caracteres.',
    );
  });
});

test('handlePostLanguages still falls back to code when label is empty', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'fr', label: '   ' }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.label, 'fr');
  });
});

test('handlePutLanguage rejects an invalid label and keeps the stored one', async () => {
  await withTempProject(async () => {
    const response = await handlePutLanguage(
      'es',
      new Request('http://localhost/cms/api/languages/es', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'tab\there' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Invalid language label. Use a single line of up to 80 characters.');

    const list = await (await handleGetLanguages()).json();
    const es = list.languages.find((language) => language.code === 'es');
    assert.notEqual(es.label, 'tab\there');
  });
});

test('handlePostLanguages rejects duplicate language code', async () => {
  await withTempProject(async () => {
    // 'es' is already in the default data
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'es', label: 'Español Duplicado' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'A language with that code already exists.');
  });
});

test('handlePostLanguages normalizes code to lowercase before duplicate check', async () => {
  await withTempProject(async () => {
    // 'es' exists as default; sending 'ES' should still be a duplicate
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'ES', label: 'Español Upper' }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'A language with that code already exists.');
  });
});

test('handleDeleteLanguage returns 404 for unknown code', async () => {
  await withTempProject(async () => {
    const response = await handleDeleteLanguage('xx');
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Not found');
  });
});

test('handleDeleteLanguage refuses to delete the last language', async () => {
  await withTempProject(async () => {
    // Only 'es' exists — cannot delete it
    const response = await handleDeleteLanguage('es');
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'Cannot delete the last language.');
  });
});

test('handlePutLanguage returns 404 for unknown code', async () => {
  await withTempProject(async () => {
    const response = await handlePutLanguage(
      'xx',
      new Request('http://localhost/cms/api/languages/xx', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: 'Does not exist' }),
      }),
    );

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.ok(body.error, 'should include error message');
  });
});

test('handlePutLanguage refuses to disable the only enabled language', async () => {
  await withTempProject(async () => {
    // 'es' is the only language and the only enabled one
    const response = await handlePutLanguage(
      'es',
      new Request('http://localhost/cms/api/languages/es', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.error, 'At least one enabled language must exist.');
  });
});

test('handlePutLanguage can disable a non-last enabled language', async () => {
  await withTempProject(async () => {
    // Add English first
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      }),
    );
    assert.equal(post.status, 200);

    // Now disable Spanish — 'en' is still enabled so this should pass
    const put = await handlePutLanguage(
      'es',
      new Request('http://localhost/cms/api/languages/es', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    assert.equal(put.status, 200);
    const body = await put.json();
    assert.equal(body.enabled, false);

    // Persisted state — 'en' should still be enabled
    const persisted = await loadLanguages();
    const en = persisted.languages.find((lang) => lang.code === 'en');
    assert.ok(en);
    assert.equal(en.enabled, true);
  });
});

test('handleDeleteLanguage reports affected pages and menus counts', async () => {
  await withTempProject(async () => {
    // Add English
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      }),
    );
    assert.equal(post.status, 200);

    // Delete it — no pages or menus have 'en' content, so counts should be 0
    const deleteResponse = await handleDeleteLanguage('en');
    assert.equal(deleteResponse.status, 200);
    const body = await deleteResponse.json();
    assert.equal(body.ok, true);
    assert.equal(body.deletedLocale, 'en');
    assert.ok(typeof body.affectedPages === 'number');
    assert.ok(typeof body.affectedMenus === 'number');
    assert.equal(body.affectedPages, 0);
    assert.equal(body.affectedMenus, 0);
  });
});

test('handlePostLanguages with isDefault:true promotes the new language as default', async () => {
  await withTempProject(async () => {
    // Add English and mark it as default
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true, isDefault: true }),
      }),
    );
    assert.equal(post.status, 200);
    const created = await post.json();
    assert.equal(created.isDefault, true);

    // Verify persisted: 'en' is now default, 'es' should no longer be
    const persisted = await loadLanguages();
    const en = persisted.languages.find((lang) => lang.code === 'en');
    const es = persisted.languages.find((lang) => lang.code === 'es');
    assert.ok(en);
    assert.ok(es);
    assert.equal(en.isDefault, true);
    assert.equal(es.isDefault, false);
  });
});

test('handlePutLanguage can update isDefault to promote a language', async () => {
  await withTempProject(async () => {
    // Add English
    const post = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'en', label: 'English', enabled: true }),
      }),
    );
    assert.equal(post.status, 200);

    // Promote English to default via PUT
    const put = await handlePutLanguage(
      'en',
      new Request('http://localhost/cms/api/languages/en', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      }),
    );
    assert.equal(put.status, 200);
    const body = await put.json();
    assert.equal(body.isDefault, true);

    // Persisted — 'es' should no longer be default
    const persisted = await loadLanguages();
    const es = persisted.languages.find((lang) => lang.code === 'es');
    assert.ok(es);
    assert.equal(es.isDefault, false);
  });
});

test('handlePostLanguages accepts valid BCP-47 subtag codes like pt-br', async () => {
  await withTempProject(async () => {
    const response = await handlePostLanguages(
      new Request('http://localhost/cms/api/languages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'pt-br', label: 'Português (Brasil)', enabled: true }),
      }),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.code, 'pt-br');
  });
});
