/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * Combined coverage runner.
 *
 * Collects raw V8 coverage from two sources into ONE temp directory and reports
 * over the merged set with c8 (which is source-map aware and merges all V8
 * dumps in a NODE_V8_COVERAGE-style directory):
 *   1. node:test integration/unit tests  (server + util code)
 *   2. Playwright e2e tests              (browser client JS + server, when present)
 *
 * c8 maps the compiled dist/*.js coverage back to the original .ts sources via
 * the emitted source maps, and writes an istanbul json-summary we read to drive
 * the README coverage badge.
 *
 * Usage:
 *   node scripts/coverage.mjs            # build + node:test coverage (+ e2e if present)
 *   node scripts/coverage.mjs --no-build # skip the build step (dist already current)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
// Shared raw V8 dump directory. Both node:test and (later) Playwright write here.
const rawDir = path.join(root, '.coverage-v8');
const outDir = path.join(root, 'coverage');

function run(cmd, args, env) {
  const res = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: false,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited with code ${res.status}`);
  }
}

function main() {
  const skipBuild = process.argv.includes('--no-build');

  // Clean previous raw coverage so stale runs don't pollute the merge.
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });

  if (!skipBuild) {
    run('npm', ['run', 'build']);
  }

  // 1. node:test — each child test process inherits NODE_V8_COVERAGE and writes
  //    its own coverage-*.json into the shared raw directory.
  const testFiles = fs
    .readdirSync(path.join(root, 'tests'))
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => path.join('tests', f));

  run('node', ['--test', ...testFiles], { NODE_V8_COVERAGE: rawDir });

  // 2. Playwright e2e coverage is appended into the same rawDir by the e2e
  //    setup when a Playwright config exists. (Wired in a later step.)

  // Report over the merged raw V8 data. --src + --include scope the denominator
  // to OUR compiled output only (never dependency code in node_modules).
  run('npx', [
    'c8',
    'report',
    '--temp-directory',
    rawDir,
    '--reports-dir',
    outDir,
    '--src',
    'dist',
    '--include',
    'dist/**/*.js',
    '--exclude',
    'dist/**/*.map',
    '--reporter',
    'json-summary',
    '--reporter',
    'lcov',
    '--reporter',
    'text-summary',
  ]);

  const summary = JSON.parse(
    fs.readFileSync(path.join(outDir, 'coverage-summary.json'), 'utf-8')
  );
  const pct = summary?.total?.lines?.pct;

  if (typeof pct !== 'number') {
    throw new Error('Could not read line coverage percentage from c8 summary.');
  }

  // Persist a stable, machine-readable summary for the badge generator.
  const summaryOut = {
    lines: summary.total.lines.pct,
    statements: summary.total.statements?.pct,
    functions: summary.total.functions?.pct,
    branches: summary.total.branches?.pct,
  };
  fs.writeFileSync(
    path.join(outDir, 'coverage-pct.json'),
    `${JSON.stringify(summaryOut, null, 2)}\n`
  );

  // eslint-disable-next-line no-console
  console.log(`\nCombined line coverage: ${pct}%`);
}

main();
