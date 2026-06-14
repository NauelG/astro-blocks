/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * capture-media-screenshots.mjs
 *
 * End-to-end tool that regenerates the two media-feature screenshots:
 *   img/media-library.png  — /cms/media library page
 *   img/image-picker.png   — image-field picker modal cropped to the panel
 *
 * Steps (idempotent — safe to re-run):
 *   1. Generate 6 gradient placeholder images via sharp+SVG (no real content).
 *   2. Reset playground media state (empty uploads dir + blank media.json).
 *   3. Start the playground dev server; handle localhost/IPv6 quirks on macOS.
 *   4. Authenticate as owner; upload all 6 placeholders with Origin header for CSRF.
 *   5. Poll /cms/api/media until every upload has status "ready".
 *   6. Capture both screenshots with Playwright (1440×900, Chromium, light theme).
 *   7. Tear down the dev server cleanly — even on error.
 *
 * Usage:
 *   node scripts/capture-media-screenshots.mjs
 *
 * Prerequisites:
 *   npx playwright install chromium
 */

import path from 'node:path';
import net from 'node:net';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { TextEncoder } from 'node:util';
import { readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { chromium } from 'playwright';

// ── Paths ────────────────────────────────────────────────────────────────────

const ROOT = process.cwd();
const PLAYGROUND_DIR = path.join(ROOT, 'playgrounds', 'basic');
const PLAYGROUND_UPLOADS_DIR = path.join(PLAYGROUND_DIR, 'public', 'uploads');
const PLAYGROUND_MEDIA_JSON = path.join(PLAYGROUND_DIR, 'data', 'media.json');

const IMG_DIR = path.join(ROOT, 'img');
const MEDIA_LIBRARY_PATH = path.join(IMG_DIR, 'media-library.png');
const IMAGE_PICKER_PATH = path.join(IMG_DIR, 'image-picker.png');

// Temporary directory for generated placeholder files.
const PLACEHOLDERS_DIR = '/tmp/astro-blocks-placeholders';

// ── Auth ─────────────────────────────────────────────────────────────────────

// This secret must match CMS_JWT_SECRET passed to the dev server below.
// capture-readme-screenshots.mjs uses the same value — keep them in sync.
const JWT_SECRET = 'astro-blocks-readme-screenshots';

const SCREENSHOT_USER = {
  id: 'readme-screenshots',
  email: 'screenshots@astroblocks.local',
  role: 'owner',
};

// ── Server config ─────────────────────────────────────────────────────────────

// 127.0.0.1 rather than 'localhost': on macOS, Astro resolves 'localhost' to
// the IPv6 loopback (::1) and binds there. Fetch calls to 127.0.0.1 then hit a
// different interface and get ECONNREFUSED. Pinning to 127.0.0.1 everywhere
// avoids the mismatch. See also the --host flag passed to `astro dev` below.
const HOST = '127.0.0.1';
const DEFAULT_PORT = 4328; // One above capture-readme-screenshots.mjs (4327) to avoid port collisions.
const SERVER_READY_TIMEOUT_MS = 120_000;
const UPLOAD_POLL_INTERVAL_MS = 2_000;
const UPLOAD_READY_TIMEOUT_MS = 90_000;

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 1 — Generate gradient placeholder images
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a complete SVG string for a placeholder image.
 * Produces abstract gradient art — no real or brand content.
 */
function buildSvg({ width, height, label, gradientType, colors, gradientDir = 'diagonal', shapes }) {
  const id = `g${Math.floor(Math.random() * 9999)}`;

  let gradientDef;
  if (gradientType === 'radial') {
    gradientDef = `
      <radialGradient id="${id}" cx="50%" cy="50%" r="70%" fx="50%" fy="50%">
        ${colors.map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`).join('\n        ')}
      </radialGradient>`;
  } else {
    const dirs = {
      horizontal: { x1: '0%', y1: '50%', x2: '100%', y2: '50%' },
      vertical:   { x1: '50%', y1: '0%', x2: '50%',  y2: '100%' },
      diagonal:   { x1: '0%',  y1: '0%', x2: '100%', y2: '100%' },
    };
    const d = dirs[gradientDir] || dirs.diagonal;
    gradientDef = `
      <linearGradient id="${id}" x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}">
        ${colors.map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`).join('\n        ')}
      </linearGradient>`;
  }

  const fontSize = Math.max(18, Math.round(width * 0.022));
  const labelX = width / 2;
  const labelY = height - Math.round(height * 0.06);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    ${gradientDef}
  </defs>
  <!-- Background -->
  <rect width="${width}" height="${height}" fill="url(#${id})"/>
  <!-- Shapes -->
  ${shapes}
  <!-- Label -->
  <text
    x="${labelX}" y="${labelY}"
    font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
    font-size="${fontSize}"
    font-weight="600"
    fill="rgba(255,255,255,0.75)"
    text-anchor="middle"
    letter-spacing="2"
  >${label}</text>
</svg>`;
}

// Six abstract placeholder definitions — generic filenames, varied dimensions.
const PLACEHOLDER_IMAGES = [
  {
    filename: 'mountain-sunrise.jpg',
    width: 1920, height: 1080,
    format: 'jpeg', quality: 90,
    svg: () => buildSvg({
      width: 1920, height: 1080,
      label: 'Mountain Sunrise',
      gradientType: 'linear', gradientDir: 'vertical',
      colors: ['#1a0533', '#7b1f4a', '#c45c0a', '#f0931b', '#ffd97b'],
      shapes: `
        <circle cx="960" cy="370" r="130" fill="rgba(255,220,80,0.85)"/>
        <circle cx="960" cy="370" r="160" fill="rgba(255,180,40,0.25)"/>
        <circle cx="960" cy="370" r="200" fill="rgba(255,140,0,0.12)"/>
        <polygon points="0,1080 460,380 920,1080" fill="rgba(20,10,40,0.65)"/>
        <polygon points="1000,1080 1460,340 1920,1080" fill="rgba(15,5,30,0.55)"/>
        <polygon points="600,1080 960,450 1320,1080" fill="rgba(30,15,60,0.45)"/>
        <ellipse cx="960" cy="420" rx="700" ry="140" fill="rgba(255,140,0,0.15)"/>
      `,
    }),
  },
  {
    filename: 'abstract-waves.png',
    width: 1600, height: 900,
    format: 'png',
    svg: () => buildSvg({
      width: 1600, height: 900,
      label: 'Abstract Waves',
      gradientType: 'linear', gradientDir: 'diagonal',
      colors: ['#0a1628', '#0d3b6e', '#0e7d8c', '#22d4c5'],
      shapes: `
        <path d="M-100,600 Q200,480 500,580 T1100,520 T1700,600 L1700,900 L-100,900 Z" fill="rgba(14,125,140,0.35)"/>
        <path d="M-100,680 Q300,560 600,660 T1200,600 T1700,680 L1700,900 L-100,900 Z" fill="rgba(10,50,90,0.45)"/>
        <path d="M-100,760 Q400,640 700,740 T1300,680 T1700,760 L1700,900 L-100,900 Z" fill="rgba(8,30,60,0.5)"/>
        <circle cx="1300" cy="200" r="180" fill="rgba(34,212,197,0.12)"/>
        <circle cx="200" cy="180" r="40" fill="rgba(255,255,255,0.07)"/>
        <circle cx="800" cy="120" r="25" fill="rgba(255,255,255,0.06)"/>
      `,
    }),
  },
  {
    filename: 'ocean-gradient.webp',
    width: 1200, height: 1200,
    format: 'webp', quality: 88,
    svg: () => buildSvg({
      width: 1200, height: 1200,
      label: 'Ocean Gradient',
      gradientType: 'radial',
      colors: ['#22d4c5', '#0e7d8c', '#0d3b6e', '#060f1f'],
      shapes: `
        ${Array.from({ length: 8 }, (_, row) =>
          Array.from({ length: 8 }, (_, col) =>
            `<circle cx="${130 + col * 140}" cy="${130 + row * 140}" r="3" fill="rgba(255,255,255,0.08)"/>`
          ).join('')
        ).join('')}
        <circle cx="600" cy="600" r="350" fill="none" stroke="rgba(34,212,197,0.15)" stroke-width="2"/>
        <circle cx="600" cy="600" r="450" fill="none" stroke="rgba(34,212,197,0.10)" stroke-width="1.5"/>
        <circle cx="600" cy="600" r="220" fill="rgba(34,212,197,0.12)"/>
      `,
    }),
  },
  {
    filename: 'city-skyline.jpg',
    width: 2000, height: 1000,
    format: 'jpeg', quality: 90,
    svg: () => buildSvg({
      width: 2000, height: 1000,
      label: 'City Skyline',
      gradientType: 'linear', gradientDir: 'vertical',
      colors: ['#0d0221', '#1a0533', '#3b0f7f', '#6a26d9', '#a060f5'],
      shapes: `
        <circle cx="1750" cy="120" r="55" fill="rgba(255,240,200,0.9)"/>
        <circle cx="1780" cy="105" r="48" fill="rgba(60,20,120,0.85)"/>
        <rect x="220"  y="480" width="100" height="520" fill="rgba(20,8,55,0.85)"/>
        <rect x="410"  y="440" width="90"  height="560" fill="rgba(25,10,60,0.85)"/>
        <rect x="580"  y="400" width="120" height="600" fill="rgba(30,12,70,0.9)"/>
        <rect x="800"  y="350" width="140" height="650" fill="rgba(35,15,80,0.9)"/>
        <rect x="1050" y="380" width="110" height="620" fill="rgba(30,12,70,0.85)"/>
        <rect x="1250" y="330" width="130" height="670" fill="rgba(35,15,80,0.9)"/>
        <rect x="1480" y="430" width="100" height="570" fill="rgba(30,12,70,0.85)"/>
        <rect x="1765" y="400" width="110" height="600" fill="rgba(30,12,70,0.85)"/>
        <ellipse cx="1000" cy="1000" rx="900" ry="120" fill="rgba(106,38,217,0.25)"/>
      `,
    }),
  },
  {
    filename: 'forest-banner.jpg',
    width: 1920, height: 800,
    format: 'jpeg', quality: 90,
    svg: () => buildSvg({
      width: 1920, height: 800,
      label: 'Forest Banner',
      gradientType: 'linear', gradientDir: 'vertical',
      colors: ['#0a1f0a', '#0e3b1a', '#166534', '#22a849', '#6ee7a0'],
      shapes: `
        <ellipse cx="960" cy="0" rx="700" ry="200" fill="rgba(110,231,160,0.12)"/>
        ${[80,200,320,440,560,680,800,920,1040,1160,1280,1400,1520,1640,1760,1880].map((x, i) => {
          const h = 180 + (i % 3) * 40;
          const w = 90 + (i % 4) * 20;
          return `<polygon points="${x},${800} ${x - w/2},${800 - h} ${x + w/2},${800 - h}" fill="rgba(15,60,25,0.55)"/>`;
        }).join('')}
        ${[0,140,280,420,560,700,840,980,1120,1260,1400,1540,1680,1820,1960].map((x, i) => {
          const h = 260 + (i % 4) * 55;
          const w = 120 + (i % 3) * 30;
          return `<polygon points="${x},${800} ${x - w/2},${800 - h} ${x + w/2},${800 - h}" fill="rgba(14,59,26,0.70)"/>`;
        }).join('')}
        ${[60,220,380,540,700,860,1020,1180,1340,1500,1660,1820].map((x, i) => {
          const h = 380 + (i % 5) * 70;
          const w = 140 + (i % 4) * 25;
          return `<polygon points="${x},${800} ${x - w/2},${800 - h} ${x + w/2},${800 - h}" fill="rgba(10,31,10,0.85)"/>`;
        }).join('')}
        <rect x="0" y="730" width="1920" height="70" fill="rgba(8,25,8,0.6)"/>
      `,
    }),
  },
  {
    filename: 'sunset-hero.png',
    width: 1500, height: 1000,
    format: 'png',
    svg: () => buildSvg({
      width: 1500, height: 1000,
      label: 'Sunset Hero',
      gradientType: 'linear', gradientDir: 'vertical',
      colors: ['#0d1b36', '#3a0d3a', '#8b1a4a', '#d4436b', '#f47b5a', '#fbb84e'],
      shapes: `
        <circle cx="750" cy="520" r="90" fill="rgba(255,220,100,0.9)"/>
        <circle cx="750" cy="520" r="120" fill="rgba(255,190,60,0.30)"/>
        <circle cx="750" cy="520" r="160" fill="rgba(255,150,30,0.15)"/>
        <ellipse cx="750" cy="560" rx="600" ry="90" fill="rgba(255,140,60,0.20)"/>
        <path d="M0,580 Q375,540 750,580 T1500,560 L1500,1000 L0,1000 Z" fill="rgba(10,20,60,0.80)"/>
        <path d="M0,650 Q375,620 750,650 T1500,630 L1500,1000 L0,1000 Z" fill="rgba(8,15,45,0.85)"/>
        <path d="M0,730 Q375,710 750,730 T1500,715 L1500,1000 L0,1000 Z" fill="rgba(5,10,30,0.90)"/>
        <ellipse cx="750" cy="700" rx="80" ry="220" fill="rgba(255,200,80,0.18)"/>
        <ellipse cx="300"  cy="220" rx="180" ry="35" fill="rgba(255,160,120,0.15)"/>
        <ellipse cx="1200" cy="180" rx="150" ry="28" fill="rgba(255,140,100,0.12)"/>
      `,
    }),
  },
];

async function generatePlaceholders() {
  await fs.mkdir(PLACEHOLDERS_DIR, { recursive: true });

  for (const img of PLACEHOLDER_IMAGES) {
    const svgBuffer = Buffer.from(img.svg());
    const outPath = path.join(PLACEHOLDERS_DIR, img.filename);

    let pipeline = sharp(svgBuffer, { density: 72 });
    if (img.format === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: img.quality ?? 90, mozjpeg: true });
    } else if (img.format === 'webp') {
      pipeline = pipeline.webp({ quality: img.quality ?? 88 });
    } else {
      pipeline = pipeline.png({ compressionLevel: 8 });
    }

    await pipeline.toFile(outPath);
    console.log(`[media-screenshots] Generated placeholder: ${img.filename}`);
  }

  console.log(`[media-screenshots] ${PLACEHOLDER_IMAGES.length} placeholders ready in ${PLACEHOLDERS_DIR}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 2 — Reset playground media state
// ═══════════════════════════════════════════════════════════════════════════════

async function resetPlaygroundMedia() {
  // Wipe all previously uploaded files so only our fresh placeholders appear.
  if (existsSync(PLAYGROUND_UPLOADS_DIR)) {
    await fs.rm(PLAYGROUND_UPLOADS_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(PLAYGROUND_UPLOADS_DIR, { recursive: true });

  // Reset media.json to an empty uploads list.
  await fs.writeFile(PLAYGROUND_MEDIA_JSON, JSON.stringify({ uploads: [] }, null, 2), 'utf8');

  console.log('[media-screenshots] Playground media state reset to clean slate');
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 3 — Dev server lifecycle (mirrors capture-readme-screenshots.mjs)
// ═══════════════════════════════════════════════════════════════════════════════

async function findOpenPort(start) {
  let port = start;
  while (port < start + 30) {
    const isOpen = await new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, HOST, () => server.close(() => resolve(true)));
    });
    if (isOpen) return port;
    port += 1;
  }
  throw new Error(`No free port found from ${start} to ${start + 29}`);
}

async function waitForServer(baseUrl, timeoutMs = SERVER_READY_TIMEOUT_MS) {
  const start = Date.now();
  let lastError = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/cms`);
      // 200, 401, and 302 all indicate the server is up and routing correctly.
      if (res.ok || res.status === 401 || res.status === 302) return;
      lastError = new Error(`Unexpected status: ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await sleep(500);
  }

  throw new Error(`Timeout waiting for server at ${baseUrl}: ${String(lastError)}`);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(new Error(`Command failed (${command} ${args.join(' ')}), exit code: ${code ?? 'null'}`));
    });
  });
}

async function closeDevServer(child) {
  if (!child || child.killed) return;
  child.kill('SIGTERM');
  const timeout = sleep(5000).then(() => {
    if (!child.killed) child.kill('SIGKILL');
  });
  await Promise.race([once(child, 'exit'), timeout]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 4 — Auth + upload
// ═══════════════════════════════════════════════════════════════════════════════

async function createAuthToken() {
  return new SignJWT({ email: SCREENSHOT_USER.email, role: SCREENSHOT_USER.role })
    .setSubject(SCREENSHOT_USER.id)
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(new TextEncoder().encode(JWT_SECRET));
}

async function uploadFile(baseUrl, filePath, token) {
  const filename = path.basename(filePath);
  const fileBuffer = await readFile(filePath);

  const mimeMap = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.webp': 'image/webp',
  };
  const ext = path.extname(filename).toLowerCase();
  const mime = mimeMap[ext] || 'application/octet-stream';

  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mime }), filename);

  const res = await fetch(`${baseUrl}/cms/api/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      // Astro's built-in CSRF guard compares Origin to the request host.
      // Without this header the upload returns 403 — it is not optional.
      Origin: baseUrl,
    },
    body: form,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Upload failed for ${filename}: HTTP ${res.status} — ${text}`);

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Non-JSON upload response: ${text}`); }

  const entry = json.entry ?? json;
  console.log(`[media-screenshots] Uploaded ${filename} → id=${entry.id ?? '?'} status=${entry.status ?? '?'}`);
  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 5 — Poll until variants are ready
// ═══════════════════════════════════════════════════════════════════════════════

async function waitForUploadReady(baseUrl, uploadId, token) {
  const start = Date.now();
  while (Date.now() - start < UPLOAD_READY_TIMEOUT_MS) {
    await sleep(UPLOAD_POLL_INTERVAL_MS);
    try {
      const res = await fetch(`${baseUrl}/cms/api/media`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { process.stdout.write('?'); continue; }
      const data = await res.json();
      const uploads = Array.isArray(data.uploads) ? data.uploads : (Array.isArray(data) ? data : []);
      const entry = uploads.find(u => u.id === uploadId);
      if (entry?.status === 'ready') {
        console.log(`[media-screenshots] Upload ${uploadId} is ready`);
        return;
      }
      process.stdout.write('.');
    } catch {
      process.stdout.write('!');
    }
  }
  throw new Error(`Upload ${uploadId} did not reach "ready" within ${UPLOAD_READY_TIMEOUT_MS}ms`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP 6 — Playwright capture
// ═══════════════════════════════════════════════════════════════════════════════

async function openCmsPage(page, url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('#admin-content:not(.cms-hidden)', { timeout: 20000 });
  await page.waitForSelector('.cms-topbar', { timeout: 15000 });
}

async function captureScreenshots(baseUrl, token) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
  });

  // Inject auth into sessionStorage before any page navigation.
  await context.addInitScript(
    ({ authToken, user }) => {
      sessionStorage.setItem('cms-token', authToken);
      sessionStorage.setItem('cms-user', JSON.stringify(user));
    },
    { authToken: token, user: SCREENSHOT_USER }
  );

  const page = await context.newPage();

  try {
    // ── Screenshot 1: /cms/media ─────────────────────────────────────────────
    console.log('[media-screenshots] Navigating to /cms/media ...');
    await openCmsPage(page, `${baseUrl}/cms/media`);

    // Wait for at least one media card to appear in the grid.
    await page.waitForSelector('#cms-media-grid .cms-media-card', { timeout: 20000 });

    // Wait until at least half the thumbnails have actually loaded (naturalWidth > 0).
    // This prevents capturing broken-image icons instead of real thumbnails.
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('#cms-media-grid .cms-media-card-img');
      if (imgs.length === 0) return false;
      const loaded = Array.from(imgs).filter(img => img.naturalWidth > 0);
      return loaded.length >= Math.ceil(imgs.length * 0.5);
    }, { timeout: 20000 });

    // Allow any CSS enter-transitions to settle.
    await sleep(800);

    await page.screenshot({ path: MEDIA_LIBRARY_PATH, type: 'png', fullPage: false });
    console.log(`[media-screenshots] Saved ${path.relative(ROOT, MEDIA_LIBRARY_PATH)}`);

    // ── Screenshot 2: image-field picker modal ───────────────────────────────
    console.log('[media-screenshots] Navigating to /cms/pages ...');
    await openCmsPage(page, `${baseUrl}/cms/pages`);
    await page.waitForSelector('#cms-pages-tbody', { timeout: 15000 });

    // Open the first page's editor (Home has a MediaShowcase block with image fields).
    const editBtn = page.locator('.cms-page-edit').first();
    if (await editBtn.count() === 0) throw new Error('No page edit button found — pages list empty');
    await editBtn.click();

    await page.waitForSelector('#page-detail-modal[open]', { timeout: 15000 });
    await page.waitForSelector('.cms-page-detail-layout', { timeout: 15000 });
    await page.waitForSelector('.cms-block-item', { timeout: 15000 });

    // Expand the MediaShowcase block so its image fields become visible.
    const mediaBlockToggle = page
      .locator('.cms-block-item')
      .filter({ has: page.locator('.cms-block-item-name', { hasText: 'Media Showcase' }) })
      .locator('.cms-block-item-toggle');

    if (await mediaBlockToggle.count() > 0) {
      await mediaBlockToggle.first().click();
      await page.waitForFunction(() => {
        const names = document.querySelectorAll('.cms-block-item-name');
        for (const name of names) {
          if (name.textContent?.includes('Media Showcase')) {
            const body = name.closest('.cms-block-item')?.querySelector('.cms-block-item-body');
            return body && !body.classList.contains('cms-hidden');
          }
        }
        return false;
      }, { timeout: 10000 });
      await sleep(300);
    } else {
      // Fallback: expand blocks one by one until a picker button appears.
      const allToggles = page.locator('.cms-block-item-toggle');
      for (let i = 0; i < await allToggles.count(); i++) {
        await allToggles.nth(i).click();
        await sleep(200);
        if (await page.locator('[data-picker-for]').count() > 0) break;
      }
    }

    if (await page.locator('[data-picker-for]').count() === 0) {
      throw new Error('No image picker button found after expanding MediaShowcase block');
    }

    // Open the image picker modal.
    await page.locator('[data-picker-for]').first().scrollIntoViewIfNeeded();
    await page.locator('[data-picker-for]').first().click();

    await page.waitForSelector('#cms-media-picker[open]', { timeout: 15000 });
    await page.waitForSelector('.cms-media-picker-grid', { timeout: 20000 });

    // Wait for picker thumbnails to load before capturing.
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('.cms-media-picker-grid .cms-media-picker-img');
      if (imgs.length === 0) return false;
      const loaded = Array.from(imgs).filter(img => img.naturalWidth > 0);
      return loaded.length >= Math.ceil(imgs.length * 0.5);
    }, { timeout: 20000 });

    await sleep(800);

    // Crop to the picker panel for a clean, focused screenshot.
    const pickerPanel = page.locator('.cms-media-picker-panel');
    if (await pickerPanel.count() > 0) {
      await pickerPanel.screenshot({ path: IMAGE_PICKER_PATH, type: 'png' });
    } else {
      await page.screenshot({ path: IMAGE_PICKER_PATH, type: 'png', fullPage: false });
    }
    console.log(`[media-screenshots] Saved ${path.relative(ROOT, IMAGE_PICKER_PATH)}`);

  } finally {
    await context.close();
    await browser.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  // ── Step 1: Generate placeholder images ────────────────────────────────────
  console.log('[media-screenshots] Generating placeholder images...');
  await generatePlaceholders();

  // ── Step 2: Reset playground media state ───────────────────────────────────
  console.log('[media-screenshots] Resetting playground media state...');
  await resetPlaygroundMedia();

  // ── Step 3: Prepare package + start dev server ─────────────────────────────
  console.log('[media-screenshots] Preparing playground package...');
  await runCommand('npm', ['run', 'prepare:playground'], { cwd: ROOT, env: process.env });

  const port = await findOpenPort(DEFAULT_PORT);
  const baseUrl = `http://${HOST}:${port}`;

  console.log(`[media-screenshots] Starting playground at ${baseUrl}...`);

  // We spawn `astro dev` directly (same pattern as capture-readme-screenshots.mjs)
  // rather than `npm run dev:playground` so we control host/port precisely.
  //
  // macOS: passing --host 127.0.0.1 forces Astro to bind on the IPv4 loopback.
  // Without it, Astro resolves 'localhost' to the IPv6 address (::1) on macOS
  // and our fetch calls to 127.0.0.1 hit a different interface → ECONNREFUSED.
  const devServer = spawn('npx', ['astro', 'dev', '--host', HOST, '--port', String(port)], {
    cwd: PLAYGROUND_DIR,
    env: {
      ...process.env,
      // The JWT we sign must be verifiable server-side with the same key.
      // Both sides must agree; this env var is what the CMS reads at startup.
      CMS_JWT_SECRET: JWT_SECRET,
    },
    stdio: 'inherit',
  });

  try {
    await waitForServer(baseUrl);

    // Short settle — let HMR stabilise before we start making API requests.
    await sleep(2000);

    // ── Step 4: Auth + upload ─────────────────────────────────────────────────
    console.log('[media-screenshots] Creating auth token...');
    const token = await createAuthToken();

    console.log('[media-screenshots] Uploading placeholder images...');
    const uploadedIds = [];
    for (const img of PLACEHOLDER_IMAGES) {
      const filePath = path.join(PLACEHOLDERS_DIR, img.filename);
      const entry = await uploadFile(baseUrl, filePath, token);
      if (entry.id) uploadedIds.push(entry.id);
    }

    // ── Step 5: Wait for variants ─────────────────────────────────────────────
    console.log('\n[media-screenshots] Waiting for image variants to be processed...');
    for (const id of uploadedIds) {
      await waitForUploadReady(baseUrl, id, token);
    }
    console.log('[media-screenshots] All uploads ready');

    // Let the UI sync with the processed state.
    await sleep(1500);

    // ── Step 6: Playwright ────────────────────────────────────────────────────
    console.log('[media-screenshots] Capturing screenshots...');
    await fs.mkdir(IMG_DIR, { recursive: true });
    await captureScreenshots(baseUrl, token);

  } catch (err) {
    if (String(err).includes("Executable doesn't exist")) {
      console.error('[media-screenshots] Chromium is not installed.');
      console.error('[media-screenshots] Run: npx playwright install chromium');
    }
    throw err;
  } finally {
    // ── Step 7: Tear down server — always runs, even on error ────────────────
    console.log('[media-screenshots] Stopping dev server...');
    await closeDevServer(devServer);
  }

  console.log('[media-screenshots] Done.');
}

main().catch((err) => {
  console.error('[media-screenshots] Fatal:', err);
  process.exit(1);
});
