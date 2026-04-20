/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export interface Flags {
  file?: string;
  dryRun?: boolean;
  copy?: boolean;
  /** Escape hatch for tests — override the package resolution function. Returns pkg dir path. */
  _resolverOverride?: () => string;
}

const IDEMPOTENCY_STRING = 'node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md';
const REFERENCE_SECTION = `
## AI Context from Dependencies

For astro-blocks AI context, read [\`node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md\`](./node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md)
`;

/**
 * Resolve the path to the installed astro-blocks package directory.
 * Uses import.meta.resolve (Node 18.19+) with a createRequire fallback.
 * Returns the package directory path (the dir containing package.json).
 */
function resolveInstalledPkgDir(): string {
  let pkgJsonPath: string;

  if (typeof import.meta.resolve === 'function') {
    pkgJsonPath = fileURLToPath(import.meta.resolve('@astroblocks/astro-blocks/package.json'));
  } else {
    // Node 18.0–18.18 fallback
    process.stderr.write('[astro-blocks] Node < 18.19 detected, using CommonJS resolver fallback.\n');
    const require = createRequire(import.meta.url);
    pkgJsonPath = require.resolve('@astroblocks/astro-blocks/package.json');
  }

  return path.dirname(pkgJsonPath);
}

/**
 * Resolve the package directory for copy mode.
 * Priority: _resolverOverride → installed package → CLI's own package root (dev/test fallback).
 */
function resolvePkgDirForCopy(flags: Flags): string {
  if (flags._resolverOverride) {
    return flags._resolverOverride();
  }
  try {
    return resolveInstalledPkgDir();
  } catch {
    // Not installed — use the CLI's own package root (for dev/test)
    const cliDir = path.dirname(fileURLToPath(import.meta.url));
    // dist/plugin/cli → go up 3 levels to repo/package root
    return path.resolve(cliDir, '..', '..', '..');
  }
}

/**
 * Detect which target file to modify in the consumer project.
 * Order: flags.file → AGENTS.md → CLAUDE.md → create AGENTS.md
 */
async function detectTargetFile(cwd: string, flags: Flags): Promise<{ targetPath: string; mustCreate: boolean }> {
  if (flags.file) {
    const p = path.isAbsolute(flags.file) ? flags.file : path.join(cwd, flags.file);
    return { targetPath: p, mustCreate: false };
  }

  const agentsPath = path.join(cwd, 'AGENTS.md');
  const claudePath = path.join(cwd, 'CLAUDE.md');

  try {
    await fs.access(agentsPath);
    return { targetPath: agentsPath, mustCreate: false };
  } catch {
    // AGENTS.md does not exist
  }

  try {
    await fs.access(claudePath);
    return { targetPath: claudePath, mustCreate: false };
  } catch {
    // CLAUDE.md does not exist either
  }

  return { targetPath: agentsPath, mustCreate: true };
}

export async function runInitAi(cwd: string, flags: Flags): Promise<void> {
  const { targetPath, mustCreate } = await detectTargetFile(cwd, flags);
  const fileName = path.basename(targetPath);

  // Read existing content (empty string if creating new)
  let existingContent = '';
  if (!mustCreate) {
    try {
      existingContent = await fs.readFile(targetPath, 'utf-8');
    } catch {
      // File was detected but disappeared — treat as new
    }
  }

  // Idempotency check
  if (existingContent.includes(IDEMPOTENCY_STRING)) {
    process.stdout.write(`[astro-blocks] Already configured in ${fileName}. No changes made.\n`);
    return;
  }

  const useCopy = flags.copy ?? false;
  let appendContent: string;

  if (useCopy || flags._resolverOverride !== undefined) {
    // copy mode OR test with resolver override
    let pkgDir: string | undefined;
    let fallbackActivated = false;

    try {
      pkgDir = resolvePkgDirForCopy(flags);
    } catch {
      // _resolverOverride threw — log warning and use CLI's own root
      process.stderr.write(
        '[astro-blocks] Could not resolve package path (Yarn PnP or package not found). Falling back to --copy mode.\n'
      );
      fallbackActivated = true;
      const cliDir = path.dirname(fileURLToPath(import.meta.url));
      pkgDir = path.resolve(cliDir, '..', '..', '..');
    }

    let agentsConsumerContent = '';
    let version = '0.0.0';

    try {
      agentsConsumerContent = await fs.readFile(path.join(pkgDir!, 'AGENTS.consumer.md'), 'utf-8');
    } catch {
      // File not found — use a fallback that still contains the idempotency string so
      // subsequent runs remain idempotent.
      agentsConsumerContent = [
        '# AstroBlocks — AI Agent Context for Consumers',
        '',
        `> This content was embedded by \`astro-blocks init-ai\`.`,
        `> Source: \`${IDEMPOTENCY_STRING}\``,
        '',
        'Update by re-running `npx astro-blocks init-ai` after upgrading.',
      ].join('\n');
    }

    try {
      const pkgJson = JSON.parse(await fs.readFile(path.join(pkgDir!, 'package.json'), 'utf-8'));
      version = pkgJson.version ?? '0.0.0';
    } catch {
      // keep default
    }

    const modeLabel = (useCopy && !fallbackActivated) ? 'copy mode' : 'copy fallback';
    appendContent = `\n## AI Context from Dependencies\n\n<!-- Generated by astro-blocks init-ai — package version: ${version}. Update by re-running this command after upgrading. -->\n\n${agentsConsumerContent}\n`;

    if (flags.dryRun) {
      process.stdout.write(`[astro-blocks] --dry-run (${modeLabel}): would append to ${fileName}:\n${appendContent}\n`);
      return;
    }
  } else {
    // Default reference mode — no package resolution needed
    appendContent = REFERENCE_SECTION;

    if (flags.dryRun) {
      process.stdout.write(`[astro-blocks] --dry-run: would append to ${fileName}:\n${appendContent}\n`);
      return;
    }
  }

  // Write or append
  const newContent = mustCreate ? appendContent.trimStart() : existingContent + appendContent;
  await fs.writeFile(targetPath, newContent, 'utf-8');

  const action = mustCreate ? 'created' : 'updated';
  process.stdout.write(`[astro-blocks] ${action} ${fileName} with AI context reference.\n`);
}
