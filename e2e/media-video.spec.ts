/**
 * Video end-to-end: the reported incident, driven through a real browser.
 *
 * The unit tests seed the allowlist directly with __setAllowedFileTypesForTest, which is
 * exactly what let the real bug hide: the allowlist reaches the server through a vite.define
 * bridge that was single-encoded, so `allowedFileTypes` never actually arrived and every MP4
 * was refused by the allowlist gate. No amount of handler-level testing could see that.
 *
 * This spec runs against the built playground (allowedFileTypes includes video/mp4), so the
 * whole chain is exercised — plugin config → vite.define → bundle → handler → disk → serving.
 */

import { test, expect } from './fixtures/coverage';

const TEST_EMAIL = 'owner@example.com';
const TEST_PASSWORD = 'password123';

/**
 * A small but real MP4: a valid `ftyp` box followed by padding. The server gates on the
 * Content-Type header and never sniffs, but shipping plausible bytes keeps the test honest if
 * that ever changes.
 */
const MP4_MIN = Buffer.concat([
  Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex'),
  Buffer.alloc(64 * 1024),
]);

async function login(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/cms');
  await page.locator('#cms-auth-forms').waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('#cms-email-input').fill(TEST_EMAIL);
  await page.locator('#cms-password-input').fill(TEST_PASSWORD);
  await page.locator('#cms-login-btn').click();
  await page.locator('#admin-content').waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe('Video uploads', () => {
  test('an MP4 uploads through the media library, tiles as video, and serves ranges', async ({
    page,
  }) => {
    await login(page);
    await page.goto('/cms/media');
    await page.locator('#cms-media-dropzone').waitFor({ state: 'visible', timeout: 15_000 });

    const uploadResponse = page.waitForResponse(
      (r) => r.url().includes('/cms/api/upload') && r.request().method() === 'POST',
    );

    await page.locator('#cms-media-file-input').setInputFiles({
      name: 'e2e-clip.mp4',
      mimeType: 'video/mp4',
      buffer: MP4_MIN,
    });

    const res = await uploadResponse;

    // THE BUG: this was 415 — "Unsupported Media Type" — for a type the consumer had allowed.
    expect(res.status(), 'video/mp4 is in allowedFileTypes; the upload must not be refused').toBe(
      200,
    );

    const body = (await res.json()) as {
      url: string;
      entry: { fileCategory?: string; mimeType: string };
    };

    expect(body.url).toMatch(/\.mp4$/);
    expect(body.entry.mimeType).toBe('video/mp4');
    expect(body.entry.fileCategory, 'the category is declared by the catalog row').toBe('video');

    // The tile must say "video", not fall back to the document icon.
    const tile = page.locator(`.cms-media-card[data-media-url="${body.url}"]`);
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await expect(
      tile.locator('.cms-media-card-thumb--video'),
      'a video must not render with the PDF icon',
    ).toBeVisible();

    // ── Serving ──────────────────────────────────────────────────────────────
    // Safari asks for the first two bytes and, without a 206 + Content-Range, discards the
    // source and plays nothing. This is the assertion that makes "supports video" true.
    const probe = await page.request.get(body.url, { headers: { Range: 'bytes=0-1' } });
    expect(probe.status(), "Safari's two-byte probe must get a 206, or it will not play").toBe(206);
    expect(probe.headers()['content-range']).toBe(`bytes 0-1/${MP4_MIN.length}`);

    // A plain GET must advertise Range support, or no media element will attempt one.
    const plain = await page.request.get(body.url);
    expect(plain.status()).toBe(200);
    expect(plain.headers()['accept-ranges']).toBe('bytes');
    expect(plain.headers()['content-type']).toBe('video/mp4');

    // Seeking: an arbitrary mid-file window must come back as exactly that window.
    const seek = await page.request.get(body.url, { headers: { Range: 'bytes=1000-1099' } });
    expect(seek.status()).toBe(206);
    expect(seek.headers()['content-range']).toBe(`bytes 1000-1099/${MP4_MIN.length}`);
    expect((await seek.body()).length).toBe(100);
  });
});
