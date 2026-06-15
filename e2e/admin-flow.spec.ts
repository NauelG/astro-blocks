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
    await expect(page.locator('nav.cms-nav').getByRole('link', { name: 'Dashboard' })).toBeVisible();
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
    if (await mediaShowcase.count() > 0) {
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
    await expect(
      page.locator('#cms-pages-tbody').getByText(uniqueTitle)
    ).toBeVisible({ timeout: 10_000 });
  });
});
