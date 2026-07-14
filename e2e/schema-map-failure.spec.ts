/**
 * When the block schema map cannot be resolved, the admin must SAY SO.
 *
 * ADR-0025 made the API fail loudly — a 500 with a localized message instead of a degraded
 * 200. That is only half the promise. The admin client used to swallow the failure:
 *
 *   - page-editor  → `catch { addBlockBtn.disabled = true; schemaMap = {} }`
 *     The owner got a dead "Add block" button and no explanation.
 *   - global-blocks-editor → `catch { return {} }`, falling through to a `!schema?.items`
 *     branch that reported **"schema not found for <name>"** — a confident lie. The schemas
 *     did not fail to CONTAIN the block; they failed to LOAD. It sent the owner hunting for a
 *     misconfigured schema that was perfectly fine.
 *
 * A server that screams into a client that shrugs is still a silent failure. These tests force
 * the failure by intercepting the endpoint, because the real bug can no longer be reproduced
 * naturally — the schema map is baked now, which was the point.
 */

import { test, expect } from './fixtures/coverage';

const TEST_EMAIL = 'owner@example.com';
const TEST_PASSWORD = 'password123';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-email-input').fill(TEST_EMAIL);
  await page.locator('#cms-password-input').fill(TEST_PASSWORD);
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

/** Exactly what the API returns when neither the bake nor the disk artifact resolves. */
async function breakSchemaMap(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/cms/api/block-schemas', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Failed to load block schemas.', missing: [] }),
    }),
  );
}

test.describe('An unresolvable schema map is visible in the admin', () => {
  test('the page editor reports it instead of just disabling "add block"', async ({ page }) => {
    await login(page);
    await breakSchemaMap(page);

    await page.goto('/cms/pages');
    await page.locator('#cms-page-new-btn').click();

    const toast = page.locator('#cms-toast-region .cms-toast--error');
    await expect(toast).toBeVisible({ timeout: 10_000 });
    await expect(toast).toContainText(/schema/i);

    // The button is still disabled — that part was right. It just was not an explanation.
    await expect(page.locator('#page-detail-blocks-add')).toBeDisabled();
  });

  test('the global-block editor does not blame a schema that is fine', async ({ page }) => {
    await login(page);
    await breakSchemaMap(page);

    await page.goto('/cms/global-blocks');
    await page.locator('.cms-global-block-edit').first().click();

    const error = page.locator('#global-block-error');
    await expect(error).toBeVisible({ timeout: 10_000 });

    // The load failure must be reported as a load failure. "Not found" would send the owner
    // debugging a schema that is not broken — the exact class of confident-wrong answer this
    // whole change exists to eliminate.
    await expect(error).not.toContainText(/not found/i);
    await expect(error).toContainText(/failed to load/i);
  });
});
