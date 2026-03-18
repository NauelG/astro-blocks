/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmCacheDir = path.join(rootDir, '.npm-cache');

await fs.mkdir(npmCacheDir, { recursive: true });

const child = spawn(npmCommand, ['pack'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_cache: npmCacheDir,
  },
});

const exitCode = await new Promise((resolve, reject) => {
  child.on('close', resolve);
  child.on('error', reject);
});

if (exitCode !== 0) {
  throw new Error(`npm pack exited with code ${exitCode}`);
}
