/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { COMPONENT_PATH_KEY } from '../contract/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cmsDir = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function getProjectRoot(config) {
  const raw = process.env.ASTRO_BLOCKS_PROJECT_ROOT || config?.root || process.cwd();
  if (raw instanceof URL) return fileURLToPath(raw);
  if (typeof raw === 'string') return raw;
  return process.cwd();
}

/**
 * Serialize schema for schemaMap (name, icon, items only; no internal path).
 * @param {import('../contract/index.mjs').BlockSchema} schema
 * @returns {{ name: string, icon?: string, items: Record<string, import('../contract/index.mjs').PropDef> }}
 */
function serializeSchemaForRuntime(schema) {
  return {
    name: schema.name,
    ...(schema.icon !== undefined && { icon: schema.icon }),
    items: schema.items || {},
  };
}

async function generateRuntime(projectRoot, options) {
  const layoutPath = options.layoutPath || './src/layouts/Layout.astro';
  const blocks = Array.isArray(options.blocks) ? options.blocks : [];

  const astroBlocksDir = path.join(projectRoot, '.astro-blocks');

  const relFromAstroBlocks = (absolutePath) => {
    const normalized = path.isAbsolute(absolutePath) ? absolutePath : path.resolve(projectRoot, absolutePath);
    return path.relative(astroBlocksDir, normalized).replace(/\\/g, '/');
  };

  const layoutAbs = path.resolve(projectRoot, layoutPath);
  const layoutRel = relFromAstroBlocks(layoutAbs);

  const blockEntries = [];
  const seenKeys = new Set();

  for (let i = 0; i < blocks.length; i++) {
    const schema = blocks[i];
    const componentPathUrl = schema[COMPONENT_PATH_KEY];
    if (componentPathUrl === undefined || componentPathUrl === null || String(componentPathUrl).trim() === '') {
      const name = schema.name || `block at index ${i}`;
      throw new Error(
        `[astro-blocks] Block schema for "${name}" is missing component path. Use defineBlockSchema(definition, import.meta.url) in the component.`
      );
    }

    const resolvedPath =
      typeof componentPathUrl === 'string' && componentPathUrl.startsWith('file:')
        ? fileURLToPath(componentPathUrl)
        : path.resolve(projectRoot, String(componentPathUrl));

    const key = typeof schema.key === 'string' && schema.key.trim() ? schema.key.trim() : path.basename(resolvedPath, '.astro');
    if (seenKeys.has(key)) {
      throw new Error(`[astro-blocks] Duplicate block key: ${key}. Use schema.key to disambiguate or rename the component file.`);
    }
    seenKeys.add(key);

    const relPath = relFromAstroBlocks(resolvedPath);
    const varName = key.replace(/-/g, '_').replace(/\s/g, '_') || `block_${i}`;
    blockEntries.push({ key, varName, relPath, schema });
  }

  const schemaMapLines = blockEntries.map((e) => {
    const serialized = serializeSchemaForRuntime(e.schema);
    return `  ${JSON.stringify(e.key)}: ${JSON.stringify(serialized)},`;
  });

  const runtimeLines = [
    `import Layout from ${JSON.stringify(layoutRel)};`,
    ...blockEntries.map((e) => `import * as ${e.varName} from ${JSON.stringify(e.relPath)};`),
    'export { Layout };',
    'export const componentMap = {',
    ...blockEntries.map((e) => `  ${JSON.stringify(e.key)}: ${e.varName}.default,`),
    '};',
    'export const schemaMap = {',
    ...schemaMapLines,
    '};',
  ];

  const schemaMapOnlyLines = [
    'export const schemaMap = {',
    ...schemaMapLines,
    '};',
  ];

  await fs.mkdir(astroBlocksDir, { recursive: true });
  await fs.writeFile(path.join(astroBlocksDir, 'runtime.mjs'), runtimeLines.join('\n'), 'utf-8');
  await fs.writeFile(path.join(astroBlocksDir, 'schema-map.mjs'), schemaMapOnlyLines.join('\n'), 'utf-8');
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

        if (!Array.isArray(options.blocks)) {
          throw new Error('[astro-blocks] options.blocks is required and must be an array (e.g. blocks: [heroSchema, ...]).');
        }

        await generateRuntime(projectRoot, options);

        const resolveCms = (file) => path.join(projectRoot, 'node_modules', 'astro-blocks', 'routes', file);

        config.vite = config.vite || {};
        config.vite.resolve = config.vite.resolve || {};
        config.vite.resolve.preserveSymlinks = true;
        config.vite.resolve.alias = config.vite.resolve.alias || {};
        config.vite.resolve.alias['astro-blocks-runtime'] = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');
        try {
          const picoResolved = require.resolve('@picocss/pico/package.json', { paths: [projectRoot] });
          const animateResolved = require.resolve('animate.css/package.json', { paths: [projectRoot] });
          config.vite.resolve.alias['@picocss/pico'] = path.dirname(picoResolved);
          config.vite.resolve.alias['animate.css'] = path.dirname(animateResolved);
        } catch (_) {}
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
