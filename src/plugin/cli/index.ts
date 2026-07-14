/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import process from 'node:process';
import { runInitAi } from './init-ai.js';
import type { Flags } from './init-ai.js';

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      flags.dryRun = true;
    } else if (arg === '--copy') {
      flags.copy = true;
    } else if (arg === '--file' && argv[i + 1]) {
      flags.file = argv[++i];
    }
  }
  return flags;
}

const subcommand = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

const commands: Record<string, (flags: Flags) => Promise<void>> = {
  'init-ai': (flags) => runInitAi(process.cwd(), flags),
};

const handler = commands[subcommand];
if (!handler) {
  process.stderr.write(`Unknown command: ${subcommand ?? '(none)'}\n`);
  process.stderr.write('Usage: astro-blocks <command>\n');
  process.stderr.write('Commands: init-ai\n');
  process.exit(1);
}

await handler(flags);
