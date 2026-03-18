/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const rootDir = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCacheDir = path.join(rootDir, '.npm-cache');

async function run(command, args, cwd = rootDir) {
  await fs.mkdir(npmCacheDir, { recursive: true });
  return execFileAsync(command, args, {
    cwd,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir,
    },
  });
}

const { stdout } = await run(npmCommand, ['pack', '--json']);
const packResult = JSON.parse(stdout);
const tarballName = packResult?.[0]?.filename;

if (!tarballName) {
  throw new Error('Failed to determine packed tarball name.');
}

const tarballPath = path.join(rootDir, tarballName);

try {
  await run(npmCommand, ['install', '--workspace', 'astro-blocks-playground', '--no-save', tarballPath]);
} finally {
  await fs.rm(tarballPath, { force: true });
}
