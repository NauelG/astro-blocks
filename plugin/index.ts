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
import { COMPONENT_PATH_KEY } from '../contract/index.js';
import type { AstroBlocksOptions, GlobalBlockDeclaration, GlobalBlockRuntimeEntry, PrimitivePropDef } from '../types/index.js';
import { DEFAULT_ALLOWED_FILE_TYPES } from '../utils/file-types.js';

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
  i18n: {
    routingStrategy: 'path-prefix' | 'subdomain' | 'domain';
  };
  allowedFileTypes: string[];
};

/**
 * Deduplicate and lowercase an array of strings.
 * Consistent with the normalisation performed by api/handlers.ts getAllowedFileTypes().
 */
function dedupeLowercase(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const lower = v.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(lower);
    }
  }
  return result;
}

function getProjectRoot(config?: { root?: string | URL }): string {
  const raw = process.env.ASTRO_BLOCKS_PROJECT_ROOT || config?.root || process.cwd();
  if (raw instanceof URL) return fileURLToPath(raw);
  if (typeof raw === 'string') return raw;
  return process.cwd();
}

const GLOBAL_BLOCK_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function validateGlobalBlocks(declarations: GlobalBlockDeclaration[]): void {
  const seen = new Set<string>();
  for (const { slug, schema } of declarations) {
    if (!GLOBAL_BLOCK_SLUG_REGEX.test(slug)) {
      throw new Error(
        `[astro-blocks] Invalid globalBlocks slug "${slug}". Slugs must match ^[a-z0-9][a-z0-9-]*$.`
      );
    }
    if (seen.has(slug)) {
      throw new Error(
        `[astro-blocks] Duplicate globalBlocks slug "${slug}". Each slug must be unique.`
      );
    }
    seen.add(slug);

    // Each declared schema must carry a component path (set by defineBlockSchema(..., import.meta.url))
    if (!schema || !(schema as unknown as Record<string, unknown>)[COMPONENT_PATH_KEY]) {
      throw new Error(
        `[astro-blocks] globalBlocks slug "${slug}": schema is missing __componentPath. ` +
        `Make sure you call defineBlockSchema(definition, import.meta.url) when defining the schema.`
      );
    }
  }
}

export async function generateRuntime(projectRoot: string, options: AstroBlocksOptions): Promise<GlobalBlockRuntimeEntry[]> {
  const layoutPath = options.layoutPath || './src/layouts/Layout.astro';
  const astroBlocksDir = path.join(projectRoot, '.astro-blocks');

  const relFromAstroBlocks = (absolutePath: string): string => {
    const normalized = path.isAbsolute(absolutePath) ? absolutePath : path.resolve(projectRoot, absolutePath);
    return path.relative(astroBlocksDir, normalized).replace(/\\/g, '/');
  };

  // Page-block entries
  const blockEntries = resolveBlockEntries(projectRoot, Array.isArray(options.blocks) ? options.blocks : []);

  // Global-block entries — resolve via the same pipeline to enforce __componentPath + key derivation
  const globalBlockDeclarations = Array.isArray(options.globalBlocks) ? options.globalBlocks : [];
  const globalBlockSchemas = globalBlockDeclarations.map((g) => g.schema);
  const globalBlockEntries = resolveBlockEntries(projectRoot, globalBlockSchemas);

  // Merge all entries for componentMap + schemaMap
  const allEntries = [...blockEntries, ...globalBlockEntries];
  const schemaMap = buildSchemaMap(allEntries);

  const layoutAbs = path.resolve(projectRoot, layoutPath);
  const layoutRel = relFromAstroBlocks(layoutAbs);

  // Thin runtime registry: only what's needed at render/admin time
  const registryEntries = globalBlockDeclarations.map((decl, i) => {
    const entry = globalBlockEntries[i];
    return {
      slug: decl.slug,
      schemaName: entry.key,
      componentPath: relFromAstroBlocks(entry.resolvedPath),
      label: decl.label,
    };
  });

  const registryLines =
    registryEntries.length === 0
      ? ['export const globalBlocksRegistry = [];']
      : [
          'export const globalBlocksRegistry = [',
          ...registryEntries.map((e) =>
            `  { slug: ${JSON.stringify(e.slug)}, schemaName: ${JSON.stringify(e.schemaName)}, componentPath: ${JSON.stringify(e.componentPath)}${e.label !== undefined ? `, label: ${JSON.stringify(e.label)}` : ''} },`
          ),
          '];',
        ];

  const runtimeLines = [
    `import Layout from ${JSON.stringify(layoutRel)};`,
    ...allEntries.map((entry) => {
      const relPath = relFromAstroBlocks(entry.resolvedPath);
      const variableName = entry.key.replace(/-/g, '_').replace(/\s/g, '_') || 'block';
      return `import * as ${variableName} from ${JSON.stringify(relPath)};`;
    }),
    'export { Layout };',
    'export const componentMap = {',
    ...allEntries.map((entry) => {
      const variableName = entry.key.replace(/-/g, '_').replace(/\s/g, '_') || 'block';
      return `  ${JSON.stringify(entry.key)}: ${variableName}.default,`;
    }),
    '};',
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '};',
    ...registryLines,
  ];

  const schemaMapLines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '};',
  ];

  await fs.mkdir(astroBlocksDir, { recursive: true });
  await fs.writeFile(path.join(astroBlocksDir, 'runtime.mjs'), runtimeLines.join('\n'), 'utf-8');
  await fs.writeFile(path.join(astroBlocksDir, 'schema-map.mjs'), schemaMapLines.join('\n'), 'utf-8');

  // Return the registry so the caller can bake it into the bundle (vite.define). The
  // precompiled API route (catchall.js) cannot import the 'astro-blocks-runtime' alias
  // like the .astro render paths do, and reading .astro-blocks/runtime.mjs from disk at
  // request time is unreliable in deployment (gitignored build artifact). Baking is the
  // robust source of truth for the admin global-block API.
  return registryEntries;
}

function resolveOptions(options: AstroBlocksOptions): ResolvedPluginOptions {
  const routingStrategy = options.i18n?.routingStrategy || 'path-prefix';

  return {
    ...options,
    publicRendering: options.publicRendering === 'static' ? 'static' : 'server',
    cache: {
      enabled: options.cache?.enabled ?? true,
      maxAge: options.cache?.maxAge ?? DEFAULT_CACHE_MAX_AGE,
      swr: options.cache?.swr ?? DEFAULT_CACHE_SWR,
    },
    i18n: {
      routingStrategy,
    },
    allowedFileTypes: (() => {
      const rawAllowedFileTypes = options.allowedFileTypes ?? DEFAULT_ALLOWED_FILE_TYPES;
      if (Array.isArray(rawAllowedFileTypes) && rawAllowedFileTypes.length === 0) {
        console.warn('[astro-blocks] allowedFileTypes is empty — all file uploads will be rejected. Omit the option (or pass null) to use the default list.');
      }
      return dedupeLowercase(rawAllowedFileTypes);
    })(),
  };
}

export type { AstroBlocksOptions } from '../types/index.js';
export { DEFAULT_ALLOWED_FILE_TYPES } from '../utils/file-types.js';

/**
 * Advisory validator for 'file' prop accept arrays (ADR-6).
 *
 * ADVISORY ONLY — this function warns; it does NOT mutate def.accept or drop
 * any MIMEs. The admin picker (Slice D) enforces the intersection of accept ∩
 * allowedFileTypes at render time. This call exists solely to surface
 * misconfiguration early at plugin setup, not to alter runtime behaviour.
 *
 * For each block schema's file prop with an `accept` array, emits exactly one
 * console.warn per MIME that is outside the global allowlist.
 * If `accept` is omitted, no warn is emitted (picker uses full allowlist).
 * Never throws — matches the tolerant warn style of the i18n fallback.
 *
 * @param blocks - Array of block schema definitions (the plugin options.blocks array).
 * @param allowedFileTypes - The resolved global allowlist from resolveOptions.
 */
export function validateFileProps(
  blocks: Array<{ name: string; items?: Record<string, unknown> }>,
  allowedFileTypes: string[]
): void {
  const globalAllowed = new Set(allowedFileTypes.map((m) => m.toLowerCase()));

  for (const block of blocks) {
    const items = block.items ?? {};
    for (const [propName, rawDef] of Object.entries(items)) {
      if (!rawDef || typeof rawDef !== 'object' || Array.isArray(rawDef)) continue;
      const def = rawDef as Partial<PrimitivePropDef>;
      if (def.type !== 'file') continue;
      const accept = def.accept;
      if (!Array.isArray(accept)) continue; // omitted → no warn, picker uses full allowlist

      for (const mime of accept) {
        const lower = typeof mime === 'string' ? mime.toLowerCase() : '';
        if (!globalAllowed.has(lower)) {
          console.warn(
            `[astro-blocks] Block "${block.name}" file prop "${propName}": accept type "${mime}" is not in allowedFileTypes and will be ignored by the media picker.`
          );
        }
      }
    }
  }
}

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

        if (Array.isArray(resolvedOptions.globalBlocks)) {
          validateGlobalBlocks(resolvedOptions.globalBlocks);
        }

        validateFileProps(resolvedOptions.blocks, resolvedOptions.allowedFileTypes);

        if (resolvedOptions.i18n.routingStrategy !== 'path-prefix') {
          console.warn(
            `[astro-blocks] i18n.routingStrategy="${resolvedOptions.i18n.routingStrategy}" is not available in this alpha. Falling back to "path-prefix".`
          );
          resolvedOptions.i18n.routingStrategy = 'path-prefix';
        }

        const globalBlocksRegistry = await generateRuntime(projectRoot, resolvedOptions);

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
        vite.define['import.meta.env.ASTRO_BLOCKS_ROUTING_STRATEGY'] = JSON.stringify(resolvedOptions.i18n.routingStrategy);
        vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'] = JSON.stringify(resolvedOptions.allowedFileTypes);
        // Bake the global-block registry into the bundle so the precompiled admin API
        // (catchall.js) resolves declarations without reading .astro-blocks/runtime.mjs
        // from disk — that gitignored artifact is often absent in deployed servers,
        // which 404'd every global-block open/edit. Double-encode: the outer JSON.stringify
        // emits a string literal that the route parses back with JSON.parse.
        vite.define['import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY'] = JSON.stringify(JSON.stringify(globalBlocksRegistry));

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
        injectRoute({ pattern: '/cms/media', entrypoint: resolveCms('admin/media.astro') });
        injectRoute({ pattern: '/cms/global-blocks', entrypoint: resolveCms('admin/global-blocks.astro') });
        injectRoute({ pattern: '/cms/pages', entrypoint: resolveCms('admin/pages.astro') });
        injectRoute({ pattern: '/cms/redirects', entrypoint: resolveCms('admin/redirects.astro') });
        injectRoute({ pattern: '/cms/configs', entrypoint: resolveCms('admin/configs.astro') });
        injectRoute({ pattern: '/cms/settings', entrypoint: resolveCms('admin/settings.astro') });
        injectRoute({ pattern: '/cms/cache', entrypoint: resolveCms('admin/cache.astro') });
        injectRoute({ pattern: '/cms/menus', entrypoint: resolveCms('admin/menus.astro') });
        injectRoute({ pattern: '/cms/languages', entrypoint: resolveCms('admin/languages.astro') });
        injectRoute({ pattern: '/cms/users', entrypoint: resolveCms('admin/users.astro') });
        injectRoute({ pattern: '/cms/import-export', entrypoint: resolveCms('admin/import-export.astro') });

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
