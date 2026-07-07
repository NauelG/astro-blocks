// Syncs the README coverage badge with the latest coverage run.
//
// Reads coverage/coverage-pct.json (produced by `node scripts/coverage.mjs`)
// and rewrites the shields.io coverage badge in README.md. Run automatically by
// the `version` npm lifecycle hook during `npm version` so the badge never
// drifts from the real number. Ad-hoc: `node scripts/coverage-badge.mjs`.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SUMMARY = 'coverage/coverage-pct.json';
const README = 'README.md';

if (!existsSync(SUMMARY)) {
  console.error(`[coverage-badge] ${SUMMARY} not found — run \`node scripts/coverage.mjs\` first.`);
  process.exit(1);
}

const { lines } = JSON.parse(readFileSync(SUMMARY, 'utf8'));
if (typeof lines !== 'number') {
  console.error('[coverage-badge] no numeric "lines" pct in coverage summary.');
  process.exit(1);
}

// shields.io named colors by coverage band.
const color =
  lines >= 90
    ? 'brightgreen'
    : lines >= 80
      ? 'green'
      : lines >= 70
        ? 'yellowgreen'
        : lines >= 60
          ? 'yellow'
          : lines >= 50
            ? 'orange'
            : 'red';

const readme = readFileSync(README, 'utf8');

// Matches: coverage-<pct>%25-<color>  (the %25 is an URL-encoded "%")
const badgeRe = /coverage-[\d.]+%25-[a-z]+/;

if (!badgeRe.test(readme)) {
  console.error('[coverage-badge] coverage badge not found in README.md');
  process.exit(1);
}

const next = `coverage-${lines}%25-${color}`;
const updated = readme.replace(badgeRe, next);

if (updated === readme) {
  console.log(`[coverage-badge] README badge already at ${lines}% (${color})`);
} else {
  writeFileSync(README, updated);
  console.log(`[coverage-badge] README coverage badge → ${lines}% (${color})`);
}
