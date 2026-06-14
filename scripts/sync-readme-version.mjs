// Syncs the README version badge with package.json#version.
//
// Run automatically by the `version` npm lifecycle hook during `npm version`
// (after the bump, before the release commit), so the README badge never drifts
// from the published version. Can also be run ad-hoc: `node scripts/sync-readme-version.mjs`.

import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;

const README = 'README.md';
const readme = readFileSync(README, 'utf8');

// shields.io badge: version-X.Y.Z[-alpha.N]-blue
const badgeRe = /version-\d+\.\d+\.\d+(?:-alpha\.\d+)?-blue/;

if (!badgeRe.test(readme)) {
  console.error('[sync-readme-version] version badge not found in README.md');
  process.exit(1);
}

const updated = readme.replace(badgeRe, `version-${version}-blue`);

if (updated === readme) {
  console.log(`[sync-readme-version] README badge already at ${version}`);
} else {
  writeFileSync(README, updated);
  console.log(`[sync-readme-version] README version badge → ${version}`);
}
