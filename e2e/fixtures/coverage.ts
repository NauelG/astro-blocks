import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COVERAGE_DIR = path.join(__dirname, '../../.coverage-browser');

// Ensure coverage output directory exists
if (!fs.existsSync(COVERAGE_DIR)) {
  fs.mkdirSync(COVERAGE_DIR, { recursive: true });
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Start JS coverage before each test
    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await use(page);

    // Collect coverage entries after each test
    const entries = await page.coverage.stopJSCoverage();

    if (entries.length > 0) {
      const outPath = path.join(COVERAGE_DIR, `${randomUUID()}.json`);
      fs.writeFileSync(outPath, JSON.stringify(entries, null, 2));
    }
  },
});

export { expect };
