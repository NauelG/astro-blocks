/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { buildSchemaMap, resolveBlockEntries } from '../utils/blocks.js';
import type { AstroBlocksOptions } from '../types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmsDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const DEFAULT_CACHE_MAX_AGE = 60;
const DEFAULT_CACHE_SWR = 300;

type ResolvedPluginOptions = AstroBlocksOptions & {
  publicRendering: 'server' | 'static';
  cache: {
    enabled: boolean;
    maxAge: number;
    swr: number;
  };
};

function getProjectRoot(config?: { root?: string | URL }): string {
  const raw = process.env.ASTRO_BLOCKS_PROJECT_ROOT || config?.root || process.cwd();
  if (raw instanceof URL) return fileURLToPath(raw);
  if (typeof raw === 'string') return raw;
  return process.cwd();
}

async function generateRuntime(projectRoot: string, options: AstroBlocksOptions): Promise<void> {
  const layoutPath = options.layoutPath || './src/layouts/Layout.astro';
  const astroBlocksDir = path.join(projectRoot, '.astro-blocks');
  const blockEntries = resolveBlockEntries(projectRoot, Array.isArray(options.blocks) ? options.blocks : []);
  const schemaMap = buildSchemaMap(blockEntries);

  const relFromAstroBlocks = (absolutePath: string): string => {
    const normalized = path.isAbsolute(absolutePath) ? absolutePath : path.resolve(projectRoot, absolutePath);
    return path.relative(astroBlocksDir, normalized).replace(/\\/g, '/');
  };

  const layoutAbs = path.resolve(projectRoot, layoutPath);
  const layoutRel = relFromAstroBlocks(layoutAbs);

  const runtimeLines = [
    `import Layout from ${JSON.stringify(layoutRel)};`,
    ...blockEntries.map((entry) => {
      const relPath = relFromAstroBlocks(entry.resolvedPath);
      const variableName = entry.key.replace(/-/g, '_').replace(/\s/g, '_') || 'block';
      return `import * as ${variableName} from ${JSON.stringify(relPath)};`;
    }),
    'export { Layout };',
    'export const componentMap = {',
    ...blockEntries.map((entry) => {
      const variableName = entry.key.replace(/-/g, '_').replace(/\s/g, '_') || 'block';
      return `  ${JSON.stringify(entry.key)}: ${variableName}.default,`;
    }),
    '};',
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '};',
  ];

  const schemaMapLines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '};',
  ];

  await fs.mkdir(astroBlocksDir, { recursive: true });
  await fs.writeFile(path.join(astroBlocksDir, 'runtime.mjs'), runtimeLines.join('\n'), 'utf-8');
  await fs.writeFile(path.join(astroBlocksDir, 'schema-map.mjs'), schemaMapLines.join('\n'), 'utf-8');
}

function resolveOptions(options: AstroBlocksOptions): ResolvedPluginOptions {
  return {
    ...options,
    publicRendering: options.publicRendering === 'static' ? 'static' : 'server',
    cache: {
      enabled: options.cache?.enabled ?? true,
      maxAge: options.cache?.maxAge ?? DEFAULT_CACHE_MAX_AGE,
      swr: options.cache?.swr ?? DEFAULT_CACHE_SWR,
    },
  };
}

export type { AstroBlocksOptions } from '../types/index.js';

export default function astroBlocks(options: AstroBlocksOptions): AstroIntegration {
  const resolvedOptions = resolveOptions(options);

  return {
    name: 'astro-blocks',
    hooks: {
      'astro:config:setup': async ({ config, injectRoute }) => {
        const projectRoot = getProjectRoot(config);
        process.env.ASTRO_BLOCKS_PROJECT_ROOT = projectRoot;

        const { ensureDefaultFiles } = await import('../api/data.js');
        await ensureDefaultFiles();

        try {
          await fs.access(path.join(projectRoot, 'src', 'pages', 'index.astro'));
          console.warn(
            '[astro-blocks] Warning: src/pages/index.astro exists. It may take precedence over the CMS home page at /. If you want the home to be managed by the CMS, remove or rename src/pages/index.astro.'
          );
        } catch {
          // no index.astro, no conflict
        }

        if (!Array.isArray(resolvedOptions.blocks)) {
          throw new Error('[astro-blocks] options.blocks is required and must be an array (e.g. blocks: [heroSchema, ...]).');
        }

        await generateRuntime(projectRoot, resolvedOptions);

        const resolveCms = (file: string): string => path.join(cmsDir, 'routes', file);
        const vite = config.vite || {};
        const cacheProvider = (config as { experimental?: { cache?: { provider?: unknown } } }).experimental?.cache?.provider;

        vite.resolve = vite.resolve || {};
        vite.resolve.preserveSymlinks = true;
        const alias =
          vite.resolve.alias && !Array.isArray(vite.resolve.alias)
            ? (vite.resolve.alias as Record<string, string>)
            : {};
        alias['astro-blocks-runtime'] = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');

        try {
          const picoResolved = require.resolve('@picocss/pico/package.json', { paths: [projectRoot] });
          const animateResolved = require.resolve('animate.css/package.json', { paths: [projectRoot] });
          alias['@picocss/pico'] = path.dirname(picoResolved);
          alias['animate.css'] = path.dirname(animateResolved);
        } catch {
          // dependencies not found at project level
        }
        vite.resolve.alias = alias;

        vite.server = vite.server || {};
        vite.server.watch = vite.server.watch || {};
        const ignored = Array.isArray(vite.server.watch.ignored) ? [...vite.server.watch.ignored] : [];
        ignored.push(`!${path.join(cmsDir, '**')}`);
        vite.server.watch.ignored = ignored;

        vite.define = vite.define || {};
        vite.define['import.meta.env.ASTRO_BLOCKS_PROJECT_ROOT'] = JSON.stringify(projectRoot);
        vite.define['import.meta.env.ASTRO_BLOCKS_PUBLIC_RENDERING'] = JSON.stringify(resolvedOptions.publicRendering);
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_ENABLED'] = JSON.stringify(resolvedOptions.cache.enabled);
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_MAX_AGE'] = JSON.stringify(resolvedOptions.cache.maxAge);
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_SWR'] = JSON.stringify(resolvedOptions.cache.swr);

        const existingNoExternal = vite.ssr?.noExternal ?? [];
        const cmsNoExternal = ['animate.css', '@picocss/pico'];
        vite.ssr = vite.ssr || {};
        vite.ssr.noExternal = Array.isArray(existingNoExternal)
          ? [...existingNoExternal, ...cmsNoExternal]
          : cmsNoExternal;

        config.vite = vite;

        if (resolvedOptions.publicRendering === 'server' && resolvedOptions.cache.enabled && !cacheProvider) {
          console.warn(
            '[astro-blocks] publicRendering="server" with cache enabled requires Astro experimental.cache.provider. Falling back to SSR without active caching until the consumer configures a provider.'
          );
        }

        injectRoute({ pattern: '/cms', entrypoint: resolveCms('admin/index.astro') });
        injectRoute({ pattern: '/cms/pages', entrypoint: resolveCms('admin/pages.astro') });
        injectRoute({ pattern: '/cms/settings', entrypoint: resolveCms('admin/settings.astro') });
        injectRoute({ pattern: '/cms/cache', entrypoint: resolveCms('admin/cache.astro') });
        injectRoute({ pattern: '/cms/menus', entrypoint: resolveCms('admin/menus.astro') });
        injectRoute({ pattern: '/cms/users', entrypoint: resolveCms('admin/users.astro') });

        injectRoute({ pattern: '/sitemap-index.xml', entrypoint: resolveCms('sitemap-get.js') });
        injectRoute({ pattern: '/robots.txt', entrypoint: resolveCms('robots-get.js') });
        injectRoute({ pattern: '/cms/api/[...path]', entrypoint: resolveCms('api/catchall.js') });
        injectRoute({ pattern: '/uploads/[...path]', entrypoint: resolveCms('uploads-get.js') });
        injectRoute({
          pattern: '/[...slug]',
          entrypoint: resolveCms(resolvedOptions.publicRendering === 'static' ? 'page-static.astro' : 'page.astro'),
        });
      },
    },
  };
}
