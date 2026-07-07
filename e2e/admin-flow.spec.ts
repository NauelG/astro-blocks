/**
 * Critical-path E2E suite for the AstroBlocks admin panel.
 *
 * Test A — first login creates the owner and reaches the authenticated dashboard.
 * Test B — create a page with a block and verify it persists in the list.
 *
 * Auth strategy: sessionStorage-based tokens cannot be persisted via storageState
 * (storageState only carries cookies + localStorage). Each test logs in via the UI.
 * On a fresh .e2e-data store the FIRST login creates the owner automatically;
 * subsequent logins use the same credentials.
 */

import { test, expect } from './fixtures/coverage';

const TEST_EMAIL = 'owner@example.com';
const TEST_PASSWORD = 'password123';

// Smallest valid 1×1 PNG — enough for the upload allowlist + imageSize probe.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
// Minimal PDF byte stream — the server gates on the application/pdf MIME, not structure.
const PDF_MIN = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
  'utf-8',
);

// Helper: log in through the CMS login screen.
// Waits for the authenticated panel (#admin-content) to become visible.
async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');

  // Wait for the auth forms to appear (the JS fetches /cms/api/auth/status first)
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });

  await page.locator('#cms-email-input').fill(TEST_EMAIL);
  await page.locator('#cms-password-input').fill(TEST_PASSWORD);
  await page.locator('#cms-login-btn').click();

  // After successful login the page reloads and #admin-content becomes visible
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

// Helper: open the new-page modal, fill title/slug, add the named block, and return
// the modal locator. The freshly added block auto-expands (openBlockIndex = last), so
// its field controls are immediately reachable inside .cms-block-item-body.
async function openNewPageWithBlock(
  page: import('@playwright/test').Page,
  blockName: string,
): Promise<import('@playwright/test').Locator> {
  await page.goto('/cms/pages');
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#cms-page-new-btn').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-page-new-btn').click();

  const modal = page.locator('#page-detail-modal');
  await modal.waitFor({ state: 'visible', timeout: 10_000 });

  const uniqueSuffix = Date.now();
  await page.locator('#page-detail-title').fill(`E2E Upload ${uniqueSuffix}`);
  await page.locator('#page-detail-slug').fill(`/e2e-upload-${uniqueSuffix}`);

  await page.locator('#page-detail-blocks-add').click();
  const blockSelectModal = page.locator('#page-detail-block-select-modal');
  await blockSelectModal.waitFor({ state: 'visible', timeout: 10_000 });
  await blockSelectModal.getByText(blockName, { exact: true }).click();
  await blockSelectModal.waitFor({ state: 'hidden', timeout: 10_000 });

  await expect(page.locator('#page-detail-blocks-list .cms-block-item')).toHaveCount(1, {
    timeout: 10_000,
  });

  return modal;
}

// Helper: upload a file through the already-open media picker and return the upload
// response. The picker binds its file-input change listener only AFTER the media list
// finishes loading (openPickerDialog awaits pickerLoadPage, then binds), so a single
// setInputFiles can race ahead of the listener and leave the upload button disabled.
// Re-applying the file re-fires change until the button enables — deterministic.
async function uploadThroughPicker(
  page: import('@playwright/test').Page,
  fileSpec: { name: string; mimeType: string; buffer: Buffer },
): Promise<import('@playwright/test').Response> {
  const fileInput = page.locator('#cms-picker-file-input');
  const uploadBtn = page.locator('#cms-picker-upload-btn');

  await expect(async () => {
    await fileInput.setInputFiles(fileSpec);
    await expect(uploadBtn).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  const uploadResponse = page.waitForResponse(
    (r) => r.url().includes('/cms/api/upload') && r.request().method() === 'POST',
  );
  await uploadBtn.click();
  return uploadResponse;
}

test.describe('Admin panel', () => {
  test('Test A: first login creates owner and reaches dashboard', async ({ page }) => {
    await page.goto('/cms');

    // The login form card is shown when not authenticated
    await expect(page.locator('#login-form')).toBeVisible({ timeout: 10_000 });

    // Wait for the async status check to resolve and reveal the auth form fields
    await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });

    // Fill in credentials — on a fresh store this creates the owner
    await page.locator('#cms-email-input').fill(TEST_EMAIL);
    await page.locator('#cms-password-input').fill(TEST_PASSWORD);
    await page.locator('#cms-login-btn').click();

    // After login the page reloads; the authenticated panel must become visible
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    // Sidebar nav is the stable authenticated indicator
    await expect(page.locator('nav.cms-nav')).toBeVisible();

    // The "Dashboard" link must be present in the sidebar
    await expect(
      page.locator('nav.cms-nav').getByRole('link', { name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('Test B: create a page with a block and it persists', async ({ page }) => {
    // Log in first — owner was created in Test A (tests run serially, workers: 1)
    await login(page);

    // Navigate to the Pages section
    await page.goto('/cms/pages');

    // Wait for the authenticated panel to be visible (admin-content holds the page UI)
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    // Wait for the "Nueva página" button to be present — confirms the page UI is ready
    await page.locator('#cms-page-new-btn').waitFor({ state: 'visible', timeout: 15_000 });

    // Click "Nueva página" to open the page-creation modal
    await page.locator('#cms-page-new-btn').click();

    // The detail modal dialog must open
    const modal = page.locator('#page-detail-modal');
    await modal.waitFor({ state: 'visible', timeout: 10_000 });

    // Fill in title and slug — both unique per test run to avoid conflicts
    const uniqueSuffix = Date.now();
    const uniqueTitle = `E2E Page ${uniqueSuffix}`;
    const uniqueSlug = `/e2e-test-${uniqueSuffix}`;
    await page.locator('#page-detail-title').fill(uniqueTitle);

    // Fill in a slug
    await page.locator('#page-detail-slug').fill(uniqueSlug);

    // Add a block — click "Añadir bloque" to open the block-type selector
    await page.locator('#page-detail-blocks-add').click();

    // The block-select modal dialog must open
    const blockSelectModal = page.locator('#page-detail-block-select-modal');
    await blockSelectModal.waitFor({ state: 'visible', timeout: 10_000 });

    // Pick the "Media Showcase" block — it has no required fields, so it can be
    // saved with empty props. Exercises block-form.ts and common.ts in the browser.
    const blockItems = blockSelectModal.locator('.cms-blocks-select-item');
    await blockItems.first().waitFor({ state: 'visible', timeout: 10_000 });

    // Prefer "Media Showcase" (no required fields); fall back to the first block
    const mediaShowcase = blockSelectModal.getByText('Media Showcase', { exact: true });
    if ((await mediaShowcase.count()) > 0) {
      await mediaShowcase.click();
    } else {
      await blockItems.first().click();
    }

    // The block-select modal should close after picking
    await blockSelectModal.waitFor({ state: 'hidden', timeout: 10_000 });

    // The block list should now contain at least one block item
    await expect(page.locator('#page-detail-blocks-list .cms-block-item')).toHaveCount(1, {
      timeout: 10_000,
    });

    // Save the page (draft) — click the "Guardar" submit button
    await page.locator('#page-detail-submit').click();

    // The modal should close after a successful save
    await modal.waitFor({ state: 'hidden', timeout: 15_000 });

    // Verify the newly created page appears in the table
    await expect(page.locator('#cms-pages-tbody').getByText(uniqueTitle)).toBeVisible({
      timeout: 10_000,
    });
  });

  // Regression: the block editor's image/file pickers must upload through the same
  // raw-binary protocol as the media grid. They previously sent multipart/form-data,
  // which the server rejected (handleUpload reads request.arrayBuffer(), never parses
  // multipart) — surfacing as an "unauthorized" upload. These tests drive the real
  // picker UI and assert the POST /cms/api/upload the browser sends is accepted (200).

  test('Test C: uploading an image from a block succeeds (not 401)', async ({ page }) => {
    await login(page);
    // "Media Showcase" exposes image fields (heroImage, galleryImage1/2)
    await openNewPageWithBlock(page, 'Media Showcase');

    // The auto-expanded block body holds the image field's "Choose image" button
    const blockBody = page.locator('#page-detail-blocks-list .cms-block-item-body').first();
    const chooseImage = blockBody.locator('.cms-image-field-choose').first();
    await chooseImage.waitFor({ state: 'visible', timeout: 10_000 });
    await chooseImage.click();

    // The singleton media picker dialog opens
    const picker = page.locator('#cms-media-picker');
    await picker.waitFor({ state: 'visible', timeout: 10_000 });

    // Select an in-memory PNG and upload it. The exact regression guard: the request
    // the browser sends must be accepted (200), not 401/403.
    const response = await uploadThroughPicker(page, {
      name: 'e2e-hero.png',
      mimeType: 'image/png',
      buffer: PNG_1x1,
    });
    expect(response.status()).toBe(200);

    // On success the picker closes and the image field flips to its selected state
    await picker.waitFor({ state: 'hidden', timeout: 10_000 });
    await expect(blockBody.locator('.cms-image-field--has-value').first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(blockBody.locator('[data-choose-label]').first()).toHaveText('Replace', {
      timeout: 10_000,
    });
  });

  test('Test D: uploading a file (PDF) from a block succeeds (not 401)', async ({ page }) => {
    await login(page);
    // "Download Button" exposes a file field (accept: application/pdf)
    await openNewPageWithBlock(page, 'Download Button');

    const blockBody = page.locator('#page-detail-blocks-list .cms-block-item-body').first();
    const chooseFile = blockBody.locator('.cms-file-field-choose').first();
    await chooseFile.waitFor({ state: 'visible', timeout: 10_000 });
    await chooseFile.click();

    const picker = page.locator('#cms-media-picker');
    await picker.waitFor({ state: 'visible', timeout: 10_000 });

    const response = await uploadThroughPicker(page, {
      name: 'e2e-doc.pdf',
      mimeType: 'application/pdf',
      buffer: PDF_MIN,
    });
    expect(response.status()).toBe(200);

    await picker.waitFor({ state: 'hidden', timeout: 10_000 });
    await expect(blockBody.locator('[data-file-choose-label]').first()).toHaveText('Replace', {
      timeout: 10_000,
    });
  });

  // Regression: the bodyless "Invalidate cache" POST previously carried no Content-Type,
  // tripping Astro's origin-check middleware (403) behind a proxy. It now sends
  // application/json like every other admin call. Assert the POST is accepted.
  test('Test E: cache invalidation POST is accepted (not 403)', async ({ page }) => {
    await login(page);
    await page.goto('/cms/cache');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    const invalidateBtn = page.locator('#cache-invalidate-btn');
    await invalidateBtn.waitFor({ state: 'visible', timeout: 15_000 });

    const invalidateResponse = page.waitForResponse(
      (r) => r.url().includes('/cms/api/cache/invalidate') && r.request().method() === 'POST',
    );
    await invalidateBtn.click();

    const response = await invalidateResponse;
    expect(response.status()).toBe(200);
  });

  // Regression: opening/editing a global block must resolve the block declaration from
  // the registry. The API previously read .astro-blocks/runtime.mjs from disk at request
  // time — a gitignored build artifact that is absent in deployed/data-dir-rooted setups
  // (as here: ASTRO_BLOCKS_PROJECT_ROOT points at .e2e-data, which has no .astro-blocks),
  // so every global-block GET/PUT 404'd even though rendering worked via the bundled alias.
  test('Test F: opening a global block resolves its declaration (not 404)', async ({ page }) => {
    await login(page);
    await page.goto('/cms/global-blocks');
    await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });

    // Call the exact endpoint the editor uses, with the real session token, from the page
    // context. "header-cta" is declared in the playground's globalBlocks config.
    const status = await page.evaluate(async () => {
      const token = (window as unknown as { getCmsToken?: () => string }).getCmsToken?.() ?? '';
      const res = await fetch('/cms/api/global-blocks/header-cta', {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    });

    expect(status).toBe(200);
  });
});
