/*
 * Copyright (c) 2026 Nauel Gómez Gamero
 * Licensed under the Business Source License 1.1
 */

/**
 * Keeps `docs/DECISIONS.md` — the public decision index — in sync with the ADRs
 * that actually exist in `docs/adr/`.
 *
 * The index is not a nice-to-have that drifts quietly: it drifted for 34 ADRs.
 * `DECISIONS.md` called itself "the public discoverable decision log" while its
 * table stopped at ADR-006, so everything from 0007 on was undiscoverable to
 * anyone who trusted it. A hand-maintained index has no failure mode; this one
 * does.
 *
 *     node scripts/adr-index.mjs            # check (CI); exits 1 on drift
 *     node scripts/adr-index.mjs --write    # regenerate the table in place
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ADR_DIR = 'docs/adr';
const INDEX_FILE = 'docs/DECISIONS.md';
const START = '<!-- adr-index:start -->';
const END = '<!-- adr-index:end -->';

/** `0031-los-paneles-flotantes.md` → { number: '0031', file: '...' } */
const ADR_FILENAME = /^(\d{4})-[a-z0-9-]+\.md$/;

function readAdrs() {
  const entries = readdirSync(ADR_DIR)
    .filter((name) => ADR_FILENAME.test(name))
    .sort();

  return entries.map((file) => {
    const number = file.match(ADR_FILENAME)[1];
    const body = readFileSync(join(ADR_DIR, file), 'utf8');

    const title = body.match(/^#\s+\d{4}\s+—\s+(.+)$/m)?.[1]?.trim();
    if (!title) {
      throw new Error(`${file}: missing an "# NNNN — Title" heading`);
    }

    // `- **Status:** Accepted — because…` / `Superseded by [ADR-0023](./0023-….md)`.
    // Everything before the em dash is the status; the rest is the ADR's own prose.
    const statusLine = body.match(/^-\s+\*\*Status:\*\*\s+(.+)$/m)?.[1];
    if (!statusLine) {
      throw new Error(`${file}: missing a "- **Status:**" line`);
    }
    const status = statusLine.split('—')[0].trim().replace(/\s+/g, ' ');

    const date = body.match(/^-\s+\*\*Date:\*\*\s+(\d{4}-\d{2}-\d{2})\s*$/m)?.[1];
    if (!date) {
      throw new Error(`${file}: missing a "- **Date:** YYYY-MM-DD" line`);
    }

    return { number, file, title, status, date };
  });
}

/** Pipes inside a cell would break the row; the title is the only free text here. */
const escapeCell = (value) => value.replace(/\|/g, '\\|');

function renderTable(adrs) {
  const rows = adrs.map(
    ({ number, file, title, status, date }) =>
      `| [ADR-${number}](./adr/${file}) | ${escapeCell(title)} | ${escapeCell(status)} | ${date} |`,
  );
  return ['| # | Decision | Status | Date |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function main() {
  const write = process.argv.includes('--write');
  const adrs = readAdrs();

  if (adrs.length === 0) {
    console.error(`[adr-index] no ADRs found in ${ADR_DIR}/`);
    process.exit(1);
  }

  const source = readFileSync(INDEX_FILE, 'utf8');
  const startAt = source.indexOf(START);
  const endAt = source.indexOf(END);
  if (startAt === -1 || endAt === -1 || endAt < startAt) {
    console.error(`[adr-index] ${INDEX_FILE} is missing the ${START} / ${END} markers`);
    process.exit(1);
  }

  const table = renderTable(adrs);
  const updated = `${source.slice(0, startAt + START.length)}\n${table}\n${source.slice(endAt)}`;

  if (updated === source) {
    console.log(`[adr-index] ${INDEX_FILE} is in sync (${adrs.length} ADRs)`);
    return;
  }

  if (write) {
    writeFileSync(INDEX_FILE, updated);
    console.log(`[adr-index] rewrote the index in ${INDEX_FILE} (${adrs.length} ADRs)`);
    return;
  }

  console.error(
    `[adr-index] ${INDEX_FILE} does not match ${ADR_DIR}/ (${adrs.length} ADRs).\n` +
      "Run 'npm run adr:index' and commit the result.",
  );
  process.exit(1);
}

main();
