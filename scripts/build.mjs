/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { readAndValidateFeaturesManifest } from './features-manifest.mjs';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const watchMode = process.argv.includes('--watch');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

async function removeDist() {
  await fs.rm(distDir, { recursive: true, force: true });
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(source, target) {
  await ensureDir(path.dirname(target));
  await fs.copyFile(source, target);
}

async function copyRouteAstroFiles(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);

      if (entry.isDirectory()) {
        await copyRouteAstroFiles(sourcePath, targetPath);
        return;
      }

      if (entry.isFile() && entry.name.endsWith('.astro')) {
        await copyFile(sourcePath, targetPath);
      }
    })
  );
}

async function copyStaticAssets() {
  await copyRouteAstroFiles(path.join(rootDir, 'routes'), path.join(distDir, 'routes'));
  await copyRouteAstroFiles(path.join(rootDir, 'components'), path.join(distDir, 'components'));
  await fs.cp(path.join(rootDir, 'styles'), path.join(distDir, 'styles'), { recursive: true });
  await fs.cp(path.join(rootDir, 'img'), path.join(distDir, 'img'), { recursive: true });
  await fs.cp(path.join(rootDir, 'meta'), path.join(distDir, 'meta'), { recursive: true });
  await copyFile(path.join(rootDir, 'package.json'), path.join(distDir, 'package.json'));
}

function runTsc() {
  return new Promise((resolve, reject) => {
    const args = ['exec', 'tsc', '--', '--project', 'tsconfig.json', ...(watchMode ? ['--watch'] : [])];
    const child = spawn(npmCommand, args, {
      cwd: rootDir,
      stdio: 'inherit',
    });

    if (watchMode) {
      resolve();
      return;
    }

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tsc exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function addShebang() {
  const cliPath = path.join(distDir, 'plugin', 'cli', 'index.js');
  try {
    await fs.access(cliPath);
  } catch {
    return; // CLI not built — safe guard
  }
  const content = await fs.readFile(cliPath, 'utf-8');
  if (!content.startsWith('#!/usr/bin/env node')) {
    await fs.writeFile(cliPath, '#!/usr/bin/env node\n' + content, 'utf-8');
  }
  await fs.chmod(cliPath, 0o755);
}

await readAndValidateFeaturesManifest({ rootDir });
await removeDist();
await copyStaticAssets();
await runTsc();
await addShebang();
