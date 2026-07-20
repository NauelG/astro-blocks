/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * The enhanced select panel is position: fixed (#138, ADR-0031). A `fixed` element only resolves
 * against the viewport while no ancestor establishes a containing block, and transform / filter /
 * will-change all do — .cms-topbar-dropdown animates with a transform, which put the UI-locale
 * panel ~1000px off-screen after #138 shipped.
 *
 * These cover all three contexts a select lives in, because #138 verified only one and generalised.
 */

import { test, expect } from '@playwright/test';

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-email-input').fill('owner@example.com');
  await page.locator('#cms-password-input').fill('password123');
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

/** Geometry of the open panel relative to its own trigger — the invariant, in every context. */
async function openPanelGeometry(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const menu = document.querySelector('.cms-select--open .cms-select-menu') as HTMLElement | null;
    const trigger = document.querySelector(
      '.cms-select--open .cms-select-trigger',
    ) as HTMLElement | null;
    if (!menu || !trigger) return null;
    const m = menu.getBoundingClientRect();
    const t = trigger.getBoundingClientRect();
    return {
      alignedLeft: Math.abs(m.left - t.left) <= 1,
      sameWidth: Math.abs(m.width - t.width) <= 1,
      adjacent: Math.abs(m.top - t.bottom) <= 8 || Math.abs(m.bottom - t.top) <= 8,
      onScreen:
        m.left >= 0 && m.top >= 0 && m.right <= window.innerWidth && m.bottom <= window.innerHeight,
    };
  });
}

test('select panel: topbar (no containing block)', async ({ page }) => {
  await login(page);
  await page
    .locator('#cms-content-locale-select')
    .locator('xpath=..')
    .locator('.cms-select-trigger')
    .click();
  await page.waitForTimeout(300);
  const g = await openPanelGeometry(page);
  expect(g, 'the panel must be open').not.toBeNull();
  expect(g).toMatchObject({ alignedLeft: true, sameWidth: true, adjacent: true, onScreen: true });
});

test('select panel: inside the profile dropdown (transformed ancestor)', async ({ page }) => {
  await login(page);
  await page.locator('#cms-profile-trigger').click();
  await page.waitForTimeout(300);
  await page
    .locator('#cms-ui-locale-select')
    .locator('xpath=..')
    .locator('.cms-select-trigger')
    .click();
  await page.waitForTimeout(300);
  const g = await openPanelGeometry(page);
  expect(g, 'the panel must be open').not.toBeNull();
  expect(g).toMatchObject({ alignedLeft: true, sameWidth: true, adjacent: true, onScreen: true });
});

test('select panel: inside a modal (clipping ancestors)', async ({ page }) => {
  await login(page);
  await page.goto('/cms/redirects');
  await page.locator('#cms-redirect-new-btn').click();
  await page.locator('#redirect-detail-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.locator('#redirect-detail-modal .cms-select-trigger').first().click();
  await page.waitForTimeout(300);
  const g = await openPanelGeometry(page);
  expect(g, 'the panel must be open').not.toBeNull();
  expect(g).toMatchObject({ alignedLeft: true, sameWidth: true, adjacent: true, onScreen: true });
});
