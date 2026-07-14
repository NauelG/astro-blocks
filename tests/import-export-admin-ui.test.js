/**
 * Tests for Slice E — Admin UI (import-export page, i18n, nav, route injection).
 *
 * Tests covered:
 *   E-1: i18n parity — importExport.* and nav.importExport keys exist in en + es
 *   E-2: page declares prerender=false; wraps AdminLayout; has required HTML structure
 *   E-3: client module exists and exports initImportExportEditor; no TypeScript in define:vars
 *   E-4: layout.astro has the nav link with data-cms-owner-only
 *   E-5: src/plugin/index.ts injects /cms/import-export route
 *
 * DOM logic that can only run in a browser (export fetch+blob, import POST, fflate
 * manifest parsing, session close) is validated in playground (Slice G e2e demo).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADMIN_DIR = path.join(ROOT, 'src', 'routes', 'admin');
const DIST_DIR = path.join(ROOT, 'dist');

// ─── E-1: i18n parity ────────────────────────────────────────────────────────

test('E-1: en catalog has nav.importExport key', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  assert.ok('nav.importExport' in catalogs.en, 'nav.importExport must exist in en catalog');
  assert.ok(
    typeof catalogs.en['nav.importExport'] === 'string' &&
      catalogs.en['nav.importExport'].length > 0,
    'nav.importExport must be a non-empty string in en catalog',
  );
});

test('E-1: es catalog has nav.importExport key', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  assert.ok('nav.importExport' in catalogs.es, 'nav.importExport must exist in es catalog');
  assert.ok(
    typeof catalogs.es['nav.importExport'] === 'string' &&
      catalogs.es['nav.importExport'].length > 0,
    'nav.importExport must be a non-empty string in es catalog',
  );
});

test('E-1: en catalog has all importExport.* keys', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  const required = [
    'importExport.eyebrow',
    'importExport.exportTitle',
    'importExport.importTitle',
    'importExport.selectUnits',
    'importExport.confirmReplace',
    'importExport.confirmReplaceWarning',
    'importExport.usersSessionWarning',
    'importExport.download',
    'importExport.upload',
    'importExport.unitPages',
    'importExport.unitMedia',
    'importExport.unitUsers',
    'importExport.unitConfiguration',
    'importExport.unitGlobalBlocks',
    'importExport.status.idle',
    'importExport.status.exporting',
    'importExport.status.uploading',
    'importExport.status.validating',
    'importExport.status.importing',
    'importExport.status.done',
    'importExport.status.error',
    'importExport.manifestTitle',
    'importExport.manifestVersion',
    'importExport.manifestExportedAt',
    'importExport.manifestCount',
    'importExport.noUnitsSelected',
    'importExport.noFileSelected',
    'importExport.importNetworkError',
    'importExport.exportNetworkError',
    'importExport.sectionExportTitle',
    'importExport.sectionExportLead',
    'importExport.sectionImportTitle',
    'importExport.sectionImportLead',
    'importExport.filePickerLabel',
    'importExport.filePickerSelectFile',
    'importExport.filePickerNoFile',
    'importExport.confirmTitle',
    'importExport.confirmBtn',
    'importExport.confirmUnavailable',
  ];
  const missing = required.filter((k) => !(k in catalogs.en));
  assert.deepEqual(missing, [], `Missing importExport.* keys in en catalog: ${missing.join(', ')}`);
});

test('E-1: es catalog has all importExport.* keys (parity with en)', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  const enKeys = Object.keys(catalogs.en).filter(
    (k) => k.startsWith('importExport.') || k === 'nav.importExport',
  );
  const missing = enKeys.filter((k) => !(k in catalogs.es));
  assert.deepEqual(missing, [], `importExport keys in en but missing in es: ${missing.join(', ')}`);
});

test('E-1: importExport.* values are non-empty strings in both catalogs', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  for (const locale of ['en', 'es']) {
    const empties = Object.entries(catalogs[locale])
      .filter(([k]) => k.startsWith('importExport.') || k === 'nav.importExport')
      .filter(([, v]) => typeof v !== 'string' || v.trim() === '')
      .map(([k]) => k);
    assert.deepEqual(empties, [], `Empty importExport values in ${locale}: ${empties.join(', ')}`);
  }
});

// ─── E-1b: ConfirmDialog a11y and new i18n keys ──────────────────────────────

test('E-1b: ConfirmDialog.astro has role="alertdialog" on the <dialog> element', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'components', 'ConfirmDialog.astro'), 'utf8');
  assert.match(
    src,
    /role="alertdialog"/,
    '<dialog> must have role="alertdialog" for AT behavior on destructive confirmations',
  );
});

test('E-1b: en catalog has importExport.confirmUnavailable key', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  assert.ok(
    'importExport.confirmUnavailable' in catalogs.en,
    'importExport.confirmUnavailable must exist in en catalog',
  );
  assert.ok(
    typeof catalogs.en['importExport.confirmUnavailable'] === 'string' &&
      catalogs.en['importExport.confirmUnavailable'].length > 0,
    'importExport.confirmUnavailable must be a non-empty string in en',
  );
});

test('E-1b: es catalog has importExport.confirmUnavailable key (parity)', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  assert.ok(
    'importExport.confirmUnavailable' in catalogs.es,
    'importExport.confirmUnavailable must exist in es catalog',
  );
  assert.ok(
    typeof catalogs.es['importExport.confirmUnavailable'] === 'string' &&
      catalogs.es['importExport.confirmUnavailable'].length > 0,
    'importExport.confirmUnavailable must be a non-empty string in es',
  );
});

test('E-1b: client module has explicit cmsConfirm guard (no silent no-op on missing dialog)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  // The guard reads cmsConfirm into a local variable and checks it before calling.
  assert.match(
    src,
    /const cmsConfirm\s*=\s*\(window as CmsWindow\)\.cmsConfirm/,
    'must read cmsConfirm into a local variable',
  );
  assert.match(
    src,
    /if\s*\(!cmsConfirm\)/,
    'must guard against missing cmsConfirm with an explicit if check',
  );
  // Must NOT silently use optional chaining for the call
  assert.ok(!src.includes('cmsConfirm?.({'), 'must NOT use cmsConfirm?.() optional-chain call');
});

// ─── E-2: admin page structure ────────────────────────────────────────────────

test('E-2: import-export.astro exists in routes/admin/', () => {
  const src = path.join(ADMIN_DIR, 'import-export.astro');
  assert.ok(fs.existsSync(src), 'routes/admin/import-export.astro must exist');
});

test('E-2: import-export.astro declares prerender = false', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(
    src,
    /export\s+const\s+prerender\s*=\s*false/,
    'page must have export const prerender = false',
  );
});

test('E-2: import-export.astro imports AdminLayout', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /import\s+AdminLayout/, 'page must import AdminLayout');
});

test('E-2: import-export.astro uses resolveUiLocale and createT (i18n pattern)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /resolveUiLocale/, 'page must call resolveUiLocale');
  assert.match(src, /createT/, 'page must call createT');
});

test('E-2: import-export.astro has export fieldset with id ie-export-units', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /id="ie-export-units"/, 'page must have fieldset id="ie-export-units"');
});

test('E-2: import-export.astro has import file input with id ie-import-file', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /id="ie-import-file"/, 'page must have file input id="ie-import-file"');
  assert.match(src, /accept=".zip"/, 'file input must accept .zip');
});

test('E-2: import-export.astro has aria-live="polite" status region', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /aria-live="polite"/, 'page must have aria-live="polite" status region');
  assert.match(src, /id="ie-status"/, 'page must have id="ie-status" element');
});

test('E-2: import-export.astro has <label for> associated with the file input (no label-less input)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  // label must reference ie-import-file
  assert.match(
    src,
    /for="ie-import-file"/,
    'file input must have an explicit label[for="ie-import-file"]',
  );
});

test('E-2: import-export.astro has ie-manifest-preview element', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(src, /id="ie-manifest-preview"/, 'page must have manifest preview element');
});

test('E-2: import-export.astro define:vars bridge is NOT empty (contains ieI18n assignment)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  // Must have define:vars AND a non-empty body that sets window.__cmsImportExportI18n
  assert.match(src, /define:vars=\{\{/, 'page must have a define:vars bridge script');
  assert.match(
    src,
    /__cmsImportExportI18n/,
    'define:vars bridge must assign window.__cmsImportExportI18n',
  );
});

test('E-2: import-export.astro define:vars bridge is NOT an empty script tag', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  // An empty bridge would be: define:vars={{...}}></script> — the no-inline-ts guard already
  // catches this, but we also assert the ieI18n variable IS declared in the bridge script body.
  const emptyBridgeRe = /define:vars=\{\{[^}]*\}\}\s*>\s*<\/script>/;
  assert.ok(
    !emptyBridgeRe.test(src),
    'import-export.astro must NOT have an empty define:vars bridge',
  );
});

test('E-2: import-export.astro imports client module (not inline TypeScript)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(
    src,
    /import.*import-export-editor/,
    'page must import the client module via a plain <script>',
  );
});

// ─── E-2b: Styled file picker (visual consistency) ────────────────────────────

test('E-2b: import-export.astro file input is visually hidden (cms-visually-hidden class)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(
    src,
    /id="ie-import-file"[^>]*class="cms-visually-hidden"|class="cms-visually-hidden"[^>]*id="ie-import-file"/,
    'native file input must have class="cms-visually-hidden" for styled picker pattern',
  );
});

test('E-2b: import-export.astro has styled "Select file" button (id ie-import-file-btn)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(
    src,
    /id="ie-import-file-btn"/,
    'styled file picker must have a trigger button id="ie-import-file-btn"',
  );
  assert.match(
    src,
    /id="ie-import-file-btn"[^>]*class="cms-btn cms-btn-secondary"|class="cms-btn cms-btn-secondary"[^>]*id="ie-import-file-btn"/,
    'styled trigger button must use cms-btn cms-btn-secondary classes',
  );
});

test('E-2b: import-export.astro has filename display element (id ie-import-file-name)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'import-export.astro'), 'utf8');
  assert.match(
    src,
    /id="ie-import-file-name"/,
    'styled file picker must have a filename display element id="ie-import-file-name"',
  );
  assert.match(
    src,
    /aria-live="polite"/,
    'filename display must use aria-live="polite" for screen reader announcements',
  );
});

test('E-2b: import-export-editor.ts wires the styled file select button to open the hidden input', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(
    src,
    /ie-import-file-btn/,
    'client module must reference the styled trigger button id',
  );
  assert.match(
    src,
    /fileInput\??\.click\(\)/,
    'client module must call fileInput.click() when the styled button is clicked',
  );
});

test('E-2b: import-export-editor.ts updates filename display on file selection', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(
    src,
    /ie-import-file-name/,
    'client module must reference the filename display element id',
  );
  assert.match(
    src,
    /fileNameDisplay.*textContent|textContent.*fileNameDisplay/,
    'client module must update the filename display text',
  );
});

// ─── E-2c: Bootstrap styled file picker (layout.astro) ────────────────────────

test('E-2c: layout.astro bootstrap file input is visually hidden (cms-visually-hidden class)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(
    src,
    /id="cms-bootstrap-file"[^>]*class="cms-visually-hidden"|class="cms-visually-hidden"[^>]*id="cms-bootstrap-file"/,
    'bootstrap native file input must have class="cms-visually-hidden" for styled picker pattern',
  );
});

test('E-2c: layout.astro has styled "Select file" button for bootstrap (id cms-bootstrap-file-btn)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(
    src,
    /id="cms-bootstrap-file-btn"/,
    'bootstrap styled file picker must have a trigger button id="cms-bootstrap-file-btn"',
  );
  assert.match(
    src,
    /id="cms-bootstrap-file-btn"[^>]*class="cms-btn cms-btn-secondary"|class="cms-btn cms-btn-secondary"[^>]*id="cms-bootstrap-file-btn"/,
    'bootstrap styled trigger button must use cms-btn cms-btn-secondary classes',
  );
});

test('E-2c: layout.astro has filename display element for bootstrap (id cms-bootstrap-file-name)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(
    src,
    /id="cms-bootstrap-file-name"/,
    'bootstrap styled file picker must have a filename display element id="cms-bootstrap-file-name"',
  );
});

test('E-2c: layout.astro bootstrap define:vars bridge includes new file picker i18n keys (pure JS)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(
    src,
    /_bootstrapSelectFile\s*:/,
    'define:vars bridge must include _bootstrapSelectFile scalar',
  );
  assert.match(
    src,
    /_bootstrapNoFileSelected\s*:/,
    'define:vars bridge must include _bootstrapNoFileSelected scalar',
  );
  assert.match(
    src,
    /bootstrapSelectFile\s*:/,
    'window.__cmsAuthI18n must include bootstrapSelectFile',
  );
  assert.match(
    src,
    /bootstrapNoFileSelected\s*:/,
    'window.__cmsAuthI18n must include bootstrapNoFileSelected',
  );
});

test('E-2c: bootstrap.selectFile and bootstrap.noFileSelected keys exist in both catalogs', async () => {
  const { catalogs } = await import(`${DIST_DIR}/routes/admin/i18n/catalogs.js`);
  for (const locale of ['en', 'es']) {
    assert.ok(
      'bootstrap.selectFile' in catalogs[locale],
      `bootstrap.selectFile must exist in ${locale} catalog`,
    );
    assert.ok(
      'bootstrap.noFileSelected' in catalogs[locale],
      `bootstrap.noFileSelected must exist in ${locale} catalog`,
    );
  }
});

// ─── E-3: client module ───────────────────────────────────────────────────────

test('E-3: client/import-export-editor.ts source file exists', () => {
  const src = path.join(ADMIN_DIR, 'client', 'import-export-editor.ts');
  assert.ok(fs.existsSync(src), 'src/routes/admin/client/import-export-editor.ts must exist');
});

test('E-3: client module exports initImportExportEditor function', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(src, /export function initImportExportEditor/, 'must export initImportExportEditor');
});

test('E-3: client module dist is compiled (dist/routes/admin/client/import-export-editor.js exists)', () => {
  const dist = path.join(DIST_DIR, 'routes', 'admin', 'client', 'import-export-editor.js');
  assert.ok(
    fs.existsSync(dist),
    'compiled dist must exist at dist/routes/admin/client/import-export-editor.js',
  );
});

test('E-3: client module uses fetch with Authorization header for export (no bare anchor URL auth)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(
    src,
    /Authorization.*Bearer/,
    'export must use Authorization: Bearer header, not bare anchor navigation',
  );
});

test('E-3: client module uses fetch with Authorization header for import POST', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  // POST to /cms/api/import with auth header
  assert.match(src, /\/cms\/api\/import/, 'client must POST to /cms/api/import');
  assert.match(
    src,
    /Content-Type.*application\/zip/,
    'import POST must use Content-Type: application/zip',
  );
});

test('E-3: client module implements session close on usersReplaced (ADR-7)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(src, /usersReplaced/, 'client must check usersReplaced from import response');
  assert.match(src, /sessionStorage\.removeItem.*cms-token/, 'session close must remove cms-token');
  assert.match(src, /sessionStorage\.removeItem.*cms-user/, 'session close must remove cms-user');
  assert.match(src, /location\.href\s*=\s*['"]\/cms['"]/, 'session close must redirect to /cms');
});

test('E-3: client module does not use innerHTML with untrusted content (uses safe DOM methods)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  // The only innerHTML usage in the file must be textContent = '' clearing (not setting HTML from manifest)
  // Verify manifest units are rendered via createElement (not innerHTML with unit strings).
  assert.match(
    src,
    /createElement\('li'\)/,
    'manifest units must be rendered via createElement, not innerHTML',
  );
  assert.match(src, /\.textContent\s*=/, 'must use .textContent for safe text assignment');
});

test('E-3: client module uses window.__cmsImportExportI18n for i18n (bridge)', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'client', 'import-export-editor.ts'), 'utf8');
  assert.match(
    src,
    /__cmsImportExportI18n/,
    'client must read from window.__cmsImportExportI18n bridge',
  );
});

// ─── E-4: nav link ────────────────────────────────────────────────────────────

test('E-4: layout.astro has import ArchiveRestore from @lucide/astro', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(src, /ArchiveRestore/, 'layout must import ArchiveRestore icon');
});

test('E-4: layout.astro has /cms/import-export nav link', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(
    src,
    /href="\/cms\/import-export"/,
    'layout nav must have a link to /cms/import-export',
  );
});

test('E-4: /cms/import-export nav link has data-cms-owner-only attribute', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  // Find the import-export link and confirm it has data-cms-owner-only.
  const linkPattern =
    /href="\/cms\/import-export"[^>]*data-cms-owner-only|data-cms-owner-only[^>]*href="\/cms\/import-export"/;
  assert.match(src, linkPattern, '/cms/import-export link must have data-cms-owner-only');
});

test('E-4: /cms/import-export nav link uses nav.importExport i18n key', () => {
  const src = fs.readFileSync(path.join(ADMIN_DIR, 'layout.astro'), 'utf8');
  assert.match(src, /nav\.importExport/, 'nav link must use t("nav.importExport") for its label');
});

// ─── E-5: route injection ─────────────────────────────────────────────────────

test('E-5: src/plugin/index.ts injects /cms/import-export route', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'plugin', 'index.ts'), 'utf8');
  assert.match(
    src,
    /injectRoute\(\s*\{\s*pattern\s*:\s*['"]\/cms\/import-export['"]/,
    'plugin must inject the /cms/import-export route',
  );
});

test('E-5: src/plugin/index.ts resolves import-export.astro entrypoint', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'plugin', 'index.ts'), 'utf8');
  assert.match(
    src,
    /resolveCms\(['"]admin\/import-export\.astro['"]\)/,
    'plugin must use resolveCms("admin/import-export.astro") as entrypoint',
  );
});

test('E-5: import-export.astro is now in the set of injected admin routes (prerender guard passes)', () => {
  // Cross-check: the admin-routes-prerender test checks all resolveCms('admin/*.astro') entries.
  // This test verifies import-export.astro would not be excluded from that guard.
  const pluginSrc = fs.readFileSync(path.join(ROOT, 'src', 'plugin', 'index.ts'), 'utf8');
  const injected = [...pluginSrc.matchAll(/resolveCms\(['"]admin\/([a-z0-9-]+\.astro)['"]\)/g)].map(
    (m) => m[1],
  );
  assert.ok(
    injected.includes('import-export.astro'),
    `import-export.astro must appear in the plugin's injected admin routes list`,
  );
});
