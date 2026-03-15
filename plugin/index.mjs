/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmsDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function getProjectRoot(config) {
  const raw = process.env.ASTRO_BLOCKS_PROJECT_ROOT || config?.root || process.cwd();
  if (raw instanceof URL) return fileURLToPath(raw);
  if (typeof raw === 'string') return raw;
  return process.cwd();
}

async function generateRuntime(projectRoot, options) {
  const layoutPath = options.layoutPath || './src/layouts/Layout.astro';
  const components = options.components || {};
  const rel = (p) => {
    const from = path.join(projectRoot, '.astro-blocks');
    return path.relative(from, path.resolve(projectRoot, p)).replace(/\\/g, '/');
  };
  const layoutRel = rel(layoutPath);
  const lines = [
    `import Layout from ${JSON.stringify(layoutRel)};`,
    ...Object.entries(components).map(
      ([key, compPath]) => `import ${key.replace(/-/g, '_')} from ${JSON.stringify(rel(compPath))};`
    ),
    'export { Layout };',
    'export const componentMap = {',
    ...Object.entries(components).map(
      ([key]) => `  ${JSON.stringify(key)}: ${key.replace(/-/g, '_')},`
    ),
    '};',
  ];
  const outDir = path.join(projectRoot, '.astro-blocks');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, 'runtime.mjs'), lines.join('\n'), 'utf-8');
}

export default function astroBlocks(options = {}) {
  return {
    name: 'astro-blocks',
    hooks: {
      'astro:config:setup': async ({ config, injectRoute, updateConfig }) => {
        const projectRoot = getProjectRoot(config);
        process.env.ASTRO_BLOCKS_PROJECT_ROOT = projectRoot;
        const { ensureDefaultFiles } = await import('../api/data.mjs');
        await ensureDefaultFiles();

        try {
          await fs.access(path.join(projectRoot, 'src', 'pages', 'index.astro'));
          console.warn(
            '[astro-blocks] Warning: src/pages/index.astro exists. It may take precedence over the CMS home page at /. If you want the home to be managed by the CMS, remove or rename src/pages/index.astro.'
          );
        } catch {
          // no index.astro, no conflict
        }
        await generateRuntime(projectRoot, options);

        // Astro 6: output 'hybrid' was removed; use output: 'static' (default) with prerender per route.
        // Do not override user's output.

        // Use entrypoint path inside project's node_modules so Vite resolves imports from there (works with file: / npm link)
        const resolveCms = (file) => path.join(projectRoot, 'node_modules', 'astro-blocks', 'routes', file);

        config.vite = config.vite || {};
        config.vite.resolve = config.vite.resolve || {};
        config.vite.resolve.preserveSymlinks = true;
        config.vite.resolve.alias = config.vite.resolve.alias || {};
        config.vite.resolve.alias['astro-blocks-runtime'] = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');
        // Alias CMS UI deps to project's node_modules so they resolve when entrypoints are outside project (file: / link)
        try {
          const picoResolved = require.resolve('@picocss/pico/package.json', { paths: [projectRoot] });
          const animateResolved = require.resolve('animate.css/package.json', { paths: [projectRoot] });
          config.vite.resolve.alias['@picocss/pico'] = path.dirname(picoResolved);
          config.vite.resolve.alias['animate.css'] = path.dirname(animateResolved);
        } catch (_) {}
        // Ensure dev server watches the CMS package so style/layout changes apply without restart
        config.vite.server = config.vite.server || {};
        config.vite.server.watch = config.vite.server.watch || {};
        const ignored = Array.isArray(config.vite.server.watch.ignored) ? [...config.vite.server.watch.ignored] : [];
        ignored.push('!' + path.join(cmsDir, '**'));
        config.vite.server.watch.ignored = ignored;

        config.vite.define = config.vite.define || {};
        config.vite.define['import.meta.env.ASTRO_BLOCKS_PROJECT_ROOT'] = JSON.stringify(projectRoot);

        const existingNoExternal = config.vite.ssr?.noExternal ?? [];
        const cmsNoExternal = ['animate.css', '@picocss/pico'];
        config.vite.ssr = config.vite.ssr || {};
        config.vite.ssr.noExternal = Array.isArray(existingNoExternal)
          ? [...existingNoExternal, ...cmsNoExternal]
          : cmsNoExternal;

        injectRoute({ pattern: '/cms', entrypoint: resolveCms('admin/index.astro') });
        injectRoute({ pattern: '/cms/pages', entrypoint: resolveCms('admin/pages.astro') });
        injectRoute({ pattern: '/cms/settings', entrypoint: resolveCms('admin/settings.astro') });
        injectRoute({ pattern: '/cms/rebuild', entrypoint: resolveCms('admin/rebuild.astro') });
        injectRoute({ pattern: '/cms/menus', entrypoint: resolveCms('admin/menus.astro') });
        injectRoute({ pattern: '/cms/users', entrypoint: resolveCms('admin/users.astro') });

        injectRoute({ pattern: '/sitemap-index.xml', entrypoint: resolveCms('sitemap-get.mjs') });
        injectRoute({ pattern: '/robots.txt', entrypoint: resolveCms('robots-get.mjs') });

        injectRoute({ pattern: '/cms/api/[...path]', entrypoint: resolveCms('api/catchall.mjs') });

        injectRoute({ pattern: '/uploads/[...path]', entrypoint: resolveCms('uploads-get.mjs') });
        injectRoute({ pattern: '/[...slug]', entrypoint: resolveCms('page.astro') });
      },
    },
  };
}
