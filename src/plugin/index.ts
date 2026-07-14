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
import type {
  AstroBlocksOptions,
  CustomFileTypeSpec,
  FileCategory,
  GlobalBlockDeclaration,
  GlobalBlockRuntimeEntry,
  PrimitivePropDef,
} from '../types/index.js';
import { BUILTIN_FILE_TYPES, DEFAULT_ALLOWED_FILE_TYPES } from '../utils/file-catalog.js';
import {
  DANGEROUS_EXTENSIONS,
  DANGEROUS_MIME,
  DANGEROUS_MIME_PATTERN,
} from '../utils/upload-gate.js';

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
  customFileTypes: CustomFileTypeSpec[];
  maxUploadBytes: Partial<Record<FileCategory, number>>;
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

const EXT_REGEX = /^\.[a-z0-9]+$/;
const VALID_FILE_CATEGORIES: ReadonlySet<string> = new Set(['image', 'video', 'audio', 'document']);

/**
 * Validate the file-type configuration at `astro:config:setup`, and THROW on violation
 * (ADR-0023). Modelled on validateGlobalBlocks below, which already throws on a bad slug.
 *
 * The rules:
 *
 *   V1/V2 — a customFileTypes row whose MIME or extension is on the hard denylist is
 *           rejected. The denylist always wins (ADR-0018), and the escape hatch is a
 *           registration, not a bypass. Payload CMS ships the bypass shape — defining
 *           `mimeTypes` on a collection skips its executable denylist entirely — and that
 *           is exactly the door we refuse to build.
 *   V3    — a row cannot shadow a builtin. A consumer redefining image/png would be
 *           overriding an audited serving policy with an unaudited one.
 *   V4    — a MIME in allowedFileTypes that the system cannot handle is a configuration
 *           error, and it fails the BUILD.
 *
 * V4 is the fix for the incident this change came from. It guarantees
 * `allowedFileTypes ⊆ catalog`, which is what makes the "allowlisted but unmapped" state —
 * where the security gate approved an upload and the extension lookup then rejected it with
 * a misleading 415 — unreachable. We do not patch the bug; we delete the state in which it
 * can exist.
 *
 * Note this is deliberately louder than the two warnings nearby (an empty allowlist, and a
 * schema `accept` that does not intersect). Those describe configs that are a NO-OP. This
 * describes a config the system cannot honour, and telling the consumer at build time — with
 * the offending MIME named and the supported list printed — is the whole point.
 */
export function validateFileTypeConfig(
  allowedFileTypes: string[],
  customFileTypes: CustomFileTypeSpec[] = [],
): void {
  const seen = new Set<string>();

  for (const raw of customFileTypes) {
    const mime = String(raw?.mime ?? '')
      .toLowerCase()
      .trim();
    const ext = String(raw?.ext ?? '')
      .toLowerCase()
      .trim();
    const category = String(raw?.category ?? '');

    if (!mime || !mime.includes('/')) {
      throw new Error(
        `[astro-blocks] customFileTypes: invalid mime "${raw?.mime}". Expected a MIME type like "application/zip".`,
      );
    }
    if (!EXT_REGEX.test(ext)) {
      throw new Error(
        `[astro-blocks] customFileTypes["${mime}"]: invalid ext "${raw?.ext}". Expected a lowercase dotted extension like ".zip".`,
      );
    }
    if (!VALID_FILE_CATEGORIES.has(category)) {
      throw new Error(
        `[astro-blocks] customFileTypes["${mime}"]: invalid category "${category}". Expected one of: image, video, audio, document.`,
      );
    }

    // V1 — denylisted MIME. The denylist beats the escape hatch, always.
    if (DANGEROUS_MIME.has(mime) || DANGEROUS_MIME_PATTERN.test(mime)) {
      throw new Error(
        `[astro-blocks] customFileTypes: "${mime}" is on the hard security denylist and cannot be registered. ` +
          `The denylist is not configurable — it exists so that a mistake in this file cannot turn the uploads directory into a way to serve scripts.`,
      );
    }
    // V2 — denylisted extension.
    if (DANGEROUS_EXTENSIONS.has(ext)) {
      throw new Error(
        `[astro-blocks] customFileTypes["${mime}"]: extension "${ext}" is on the hard security denylist and cannot be registered.`,
      );
    }
    // V3 — cannot shadow a builtin row.
    if (BUILTIN_FILE_TYPES.some((r) => r.mime === mime)) {
      throw new Error(
        `[astro-blocks] customFileTypes: "${mime}" is already a builtin file type and cannot be redefined. ` +
          `Remove it from customFileTypes; it is available through allowedFileTypes.`,
      );
    }
    if (seen.has(mime)) {
      throw new Error(`[astro-blocks] customFileTypes: duplicate mime "${mime}".`);
    }
    seen.add(mime);
  }

  // V4 — every allowed MIME must be one the system can actually handle.
  const supported = new Set([...BUILTIN_FILE_TYPES.map((r) => r.mime), ...seen]);
  for (const mime of allowedFileTypes) {
    if (!supported.has(mime)) {
      throw new Error(
        `[astro-blocks] allowedFileTypes: "${mime}" is not a supported file type.\n` +
          `  AstroBlocks derives the stored file extension from the validated MIME type (a security\n` +
          `  requirement — see ADR-0018), so it can only accept types it has a catalog row for.\n\n` +
          `  Supported: ${[...supported].sort().join(', ')}\n\n` +
          `  To add your own, register it with the customFileTypes plugin option:\n` +
          `    customFileTypes: [{ mime: '${mime}', ext: '.xxx', category: 'document' }]\n` +
          `  Registered types are always served as downloads, never rendered inline.`,
      );
    }
  }
}

const GLOBAL_BLOCK_SLUG_REGEX = /^[a-z0-9][a-z0-9-]*$/;

export function validateGlobalBlocks(declarations: GlobalBlockDeclaration[]): void {
  const seen = new Set<string>();
  for (const { slug, schema } of declarations) {
    if (!GLOBAL_BLOCK_SLUG_REGEX.test(slug)) {
      throw new Error(
        `[astro-blocks] Invalid globalBlocks slug "${slug}". Slugs must match ^[a-z0-9][a-z0-9-]*$.`,
      );
    }
    if (seen.has(slug)) {
      throw new Error(
        `[astro-blocks] Duplicate globalBlocks slug "${slug}". Each slug must be unique.`,
      );
    }
    seen.add(slug);

    // Each declared schema must carry a component path (set by defineBlockSchema(..., import.meta.url))
    if (!schema || !(schema as unknown as Record<string, unknown>)[COMPONENT_PATH_KEY]) {
      throw new Error(
        `[astro-blocks] globalBlocks slug "${slug}": schema is missing __componentPath. ` +
          `Make sure you call defineBlockSchema(definition, import.meta.url) when defining the schema.`,
      );
    }
  }
}

export async function generateRuntime(
  projectRoot: string,
  options: AstroBlocksOptions,
): Promise<GlobalBlockRuntimeEntry[]> {
  const layoutPath = options.layoutPath || './src/layouts/Layout.astro';
  const astroBlocksDir = path.join(projectRoot, '.astro-blocks');

  const relFromAstroBlocks = (absolutePath: string): string => {
    const normalized = path.isAbsolute(absolutePath)
      ? absolutePath
      : path.resolve(projectRoot, absolutePath);
    return path.relative(astroBlocksDir, normalized).replace(/\\/g, '/');
  };

  // Page-block entries
  const blockEntries = resolveBlockEntries(
    projectRoot,
    Array.isArray(options.blocks) ? options.blocks : [],
  );

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
          ...registryEntries.map(
            (e) =>
              `  { slug: ${JSON.stringify(e.slug)}, schemaName: ${JSON.stringify(e.schemaName)}, componentPath: ${JSON.stringify(e.componentPath)}${e.label !== undefined ? `, label: ${JSON.stringify(e.label)}` : ''} },`,
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
    ...Object.entries(schemaMap).map(
      ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    '};',
    ...registryLines,
  ];

  const schemaMapLines = [
    'export const schemaMap = {',
    ...Object.entries(schemaMap).map(
      ([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`,
    ),
    '};',
  ];

  await fs.mkdir(astroBlocksDir, { recursive: true });
  await fs.writeFile(path.join(astroBlocksDir, 'runtime.mjs'), runtimeLines.join('\n'), 'utf-8');
  await fs.writeFile(
    path.join(astroBlocksDir, 'schema-map.mjs'),
    schemaMapLines.join('\n'),
    'utf-8',
  );

  // Return the registry so the caller can bake it into the bundle (vite.define). The
  // precompiled API route (catchall.js) cannot import the 'astro-blocks-runtime' alias
  // like the .astro render paths do, and reading .astro-blocks/runtime.mjs from disk at
  // request time is unreliable in deployment (gitignored build artifact). Baking is the
  // robust source of truth for the admin global-block API.
  return registryEntries;
}

function resolveOptions(options: AstroBlocksOptions): ResolvedPluginOptions {
  const routingStrategy = options.i18n?.routingStrategy || 'path-prefix';

  const normalizedCustomFileTypes: CustomFileTypeSpec[] = (options.customFileTypes ?? []).map(
    (r) => ({
      mime: String(r?.mime ?? '')
        .toLowerCase()
        .trim(),
      ext: String(r?.ext ?? '')
        .toLowerCase()
        .trim(),
      category: r?.category,
    }),
  );

  const rawAllowedFileTypes = options.allowedFileTypes ?? DEFAULT_ALLOWED_FILE_TYPES;
  if (Array.isArray(rawAllowedFileTypes) && rawAllowedFileTypes.length === 0) {
    // A no-op config, not one we cannot honour: warn, do not throw. (Contrast with
    // validateFileTypeConfig, which throws — see its doc comment.)
    console.warn(
      '[astro-blocks] allowedFileTypes is empty — all file uploads will be rejected. Omit the option (or pass null) to use the default list.',
    );
  }
  const resolvedAllowedFileTypes = dedupeLowercase(rawAllowedFileTypes);

  // Throws on a MIME the system cannot handle, on a denylisted or duplicate registration,
  // and on a row that would shadow a builtin. The build fails here rather than an editor
  // meeting a misleading 415 at upload time.
  validateFileTypeConfig(resolvedAllowedFileTypes, normalizedCustomFileTypes);

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
    customFileTypes: normalizedCustomFileTypes,
    maxUploadBytes: options.maxUploadBytes ?? {},
    allowedFileTypes: resolvedAllowedFileTypes,
  };
}

export type { AstroBlocksOptions, CustomFileTypeSpec } from '../types/index.js';
export { DEFAULT_ALLOWED_FILE_TYPES } from '../utils/file-catalog.js';

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
  allowedFileTypes: string[],
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
            `[astro-blocks] Block "${block.name}" file prop "${propName}": accept type "${mime}" is not in allowedFileTypes and will be ignored by the media picker.`,
          );
        }
      }
    }
  }
}

/**
 * Guard the hard requirement that the consumer project has an SSR adapter configured.
 *
 * The CMS admin panel and its API routes are injected with `prerender = false`, so they
 * render on demand and cannot be served by a purely static build. Any adapter satisfies
 * this (@astrojs/node, @astrojs/vercel, @astrojs/netlify, @astrojs/cloudflare, …) — the
 * integration is deliberately adapter-agnostic, which is why this is a config-time guard
 * and not a `peerDependency` on a specific adapter package.
 *
 * `astro dev` renders on-demand routes without an adapter, so a missing adapter is only a
 * hard error at build time; in dev we warn instead of throwing so the local workflow keeps
 * working while still surfacing the problem early.
 *
 * Must run from `astro:config:done` (not `config:setup`): while a directly-declared
 * `adapter:` is already present during `config:setup`, an adapter injected dynamically by
 * another integration's `config:setup` (via `updateConfig`) may not be — and integration
 * ordering is not guaranteed. `config:done` sees the final resolved config, avoiding that
 * false negative. Note `config:done` does not expose `command`, so it is captured from
 * `config:setup` into a closure.
 */
export function assertAdapterConfigured(
  command: 'dev' | 'build' | 'preview' | 'sync',
  adapter: unknown,
): void {
  if (adapter) return;

  const message =
    '[astro-blocks] No SSR adapter is configured. The CMS admin panel and API routes render ' +
    'on demand and require an adapter (e.g. @astrojs/node, @astrojs/vercel, @astrojs/netlify, ' +
    '@astrojs/cloudflare). Add one via the `adapter` option in astro.config.';

  if (command === 'build') {
    throw new Error(`${message} Aborting build.`);
  }

  console.warn(`${message} \`astro build\` will fail until an adapter is configured.`);
}

export default function astroBlocks(options: AstroBlocksOptions): AstroIntegration {
  const resolvedOptions = resolveOptions(options);
  let astroCommand: 'dev' | 'build' | 'preview' | 'sync' = 'dev';

  return {
    name: 'astro-blocks',
    hooks: {
      'astro:config:setup': async ({ config, command, injectRoute }) => {
        astroCommand = command;
        const projectRoot = getProjectRoot(config);
        process.env.ASTRO_BLOCKS_PROJECT_ROOT = projectRoot;

        const { ensureDefaultFiles } = await import('../api/data.js');
        await ensureDefaultFiles();

        try {
          await fs.access(path.join(projectRoot, 'src', 'pages', 'index.astro'));
          console.warn(
            '[astro-blocks] Warning: src/pages/index.astro exists. It may take precedence over the CMS home page at /. If you want the home to be managed by the CMS, remove or rename src/pages/index.astro.',
          );
        } catch {
          // no index.astro, no conflict
        }

        if (!Array.isArray(resolvedOptions.blocks)) {
          throw new Error(
            '[astro-blocks] options.blocks is required and must be an array (e.g. blocks: [heroSchema, ...]).',
          );
        }

        const jwtSecretEnv =
          process.env.ASTRO_BLOCKS_JWT_SECRET?.trim() || process.env.CMS_JWT_SECRET?.trim();
        if (!jwtSecretEnv) {
          console.warn(
            '[astro-blocks] ASTRO_BLOCKS_JWT_SECRET is not set. Set it to a strong random value before deploying — ' +
              'in production the admin panel refuses to authenticate with the built-in fallback secret, and ' +
              'without it anyone could forge an owner session token.',
          );
        }

        if (Array.isArray(resolvedOptions.globalBlocks)) {
          validateGlobalBlocks(resolvedOptions.globalBlocks);
        }

        validateFileProps(resolvedOptions.blocks, resolvedOptions.allowedFileTypes);

        if (resolvedOptions.i18n.routingStrategy !== 'path-prefix') {
          console.warn(
            `[astro-blocks] i18n.routingStrategy="${resolvedOptions.i18n.routingStrategy}" is not available in this alpha. Falling back to "path-prefix".`,
          );
          resolvedOptions.i18n.routingStrategy = 'path-prefix';
        }

        const globalBlocksRegistry = await generateRuntime(projectRoot, resolvedOptions);

        const resolveCms = (file: string): string => path.join(cmsDir, 'routes', file);
        const vite = config.vite || {};
        const cacheProvider = (config as { experimental?: { cache?: { provider?: unknown } } })
          .experimental?.cache?.provider;

        vite.resolve = vite.resolve || {};
        vite.resolve.preserveSymlinks = true;
        const alias =
          vite.resolve.alias && !Array.isArray(vite.resolve.alias)
            ? (vite.resolve.alias as Record<string, string>)
            : {};
        alias['astro-blocks-runtime'] = path.join(projectRoot, '.astro-blocks', 'runtime.mjs');

        try {
          const picoResolved = require.resolve('@picocss/pico/package.json', {
            paths: [projectRoot],
          });
          const animateResolved = require.resolve('animate.css/package.json', {
            paths: [projectRoot],
          });
          alias['@picocss/pico'] = path.dirname(picoResolved);
          alias['animate.css'] = path.dirname(animateResolved);
        } catch {
          // dependencies not found at project level
        }
        vite.resolve.alias = alias;

        vite.server = vite.server || {};
        vite.server.watch = vite.server.watch || {};
        const ignored = Array.isArray(vite.server.watch.ignored)
          ? [...vite.server.watch.ignored]
          : [];
        ignored.push(`!${path.join(cmsDir, '**')}`);
        vite.server.watch.ignored = ignored;

        vite.define = vite.define || {};
        vite.define['import.meta.env.ASTRO_BLOCKS_PROJECT_ROOT'] = JSON.stringify(projectRoot);
        vite.define['import.meta.env.ASTRO_BLOCKS_PUBLIC_RENDERING'] = JSON.stringify(
          resolvedOptions.publicRendering,
        );
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_ENABLED'] = JSON.stringify(
          resolvedOptions.cache.enabled,
        );
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_MAX_AGE'] = JSON.stringify(
          resolvedOptions.cache.maxAge,
        );
        vite.define['import.meta.env.ASTRO_BLOCKS_CACHE_SWR'] = JSON.stringify(
          resolvedOptions.cache.swr,
        );
        vite.define['import.meta.env.ASTRO_BLOCKS_ROUTING_STRATEGY'] = JSON.stringify(
          resolvedOptions.i18n.routingStrategy,
        );
        // DOUBLE-encode. vite.define splices its value in as raw SOURCE, so a single
        // JSON.stringify(array) becomes an array LITERAL in the bundle — and the consumer of
        // this bridge (getAllowedFileTypes) guards with `typeof raw === 'string'`, so it
        // silently rejected the array and fell back to DEFAULT_ALLOWED_FILE_TYPES. The
        // consequence: allowedFileTypes never reached the server, in any released version.
        //
        // That, not the missing MIME_TO_EXT row, is what produced the reported video/mp4 415:
        // the upload was refused by the ALLOWLIST gate, because the allowlist was always the
        // shipped default. The outer JSON.stringify emits a string literal the runtime parses
        // back with JSON.parse — the same pattern GLOBAL_BLOCKS_REGISTRY below already used.
        vite.define['import.meta.env.ASTRO_BLOCKS_ALLOWED_FILE_TYPES'] = JSON.stringify(
          JSON.stringify(resolvedOptions.allowedFileTypes),
        );
        // Consumer-registered file types and the per-category size policy travel to the
        // runtime the same way the allowlist does: baked in at build time. The runtime ops
        // ceiling (ASTRO_BLOCKS_MAX_UPLOAD_BYTES) deliberately does NOT — it is read from
        // process.env at server boot so it can be lowered without a rebuild.
        vite.define['import.meta.env.ASTRO_BLOCKS_CUSTOM_FILE_TYPES'] = JSON.stringify(
          JSON.stringify(resolvedOptions.customFileTypes),
        );
        vite.define['import.meta.env.ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY'] = JSON.stringify(
          JSON.stringify(resolvedOptions.maxUploadBytes),
        );
        // Bake the global-block registry into the bundle so the precompiled admin API
        // (catchall.js) resolves declarations without reading .astro-blocks/runtime.mjs
        // from disk — that gitignored artifact is often absent in deployed servers,
        // which 404'd every global-block open/edit. Double-encode: the outer JSON.stringify
        // emits a string literal that the route parses back with JSON.parse.
        vite.define['import.meta.env.ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY'] = JSON.stringify(
          JSON.stringify(globalBlocksRegistry),
        );

        const existingNoExternal = vite.ssr?.noExternal ?? [];
        const cmsNoExternal = ['animate.css', '@picocss/pico'];
        vite.ssr = vite.ssr || {};
        vite.ssr.noExternal = Array.isArray(existingNoExternal)
          ? [...existingNoExternal, ...cmsNoExternal]
          : cmsNoExternal;

        config.vite = vite;

        if (
          resolvedOptions.publicRendering === 'server' &&
          resolvedOptions.cache.enabled &&
          !cacheProvider
        ) {
          console.warn(
            '[astro-blocks] publicRendering="server" with cache enabled requires Astro experimental.cache.provider. Falling back to SSR without active caching until the consumer configures a provider.',
          );
        }

        injectRoute({ pattern: '/cms', entrypoint: resolveCms('admin/index.astro') });
        injectRoute({ pattern: '/cms/media', entrypoint: resolveCms('admin/media.astro') });
        injectRoute({
          pattern: '/cms/global-blocks',
          entrypoint: resolveCms('admin/global-blocks.astro'),
        });
        injectRoute({ pattern: '/cms/pages', entrypoint: resolveCms('admin/pages.astro') });
        injectRoute({ pattern: '/cms/redirects', entrypoint: resolveCms('admin/redirects.astro') });
        injectRoute({ pattern: '/cms/configs', entrypoint: resolveCms('admin/configs.astro') });
        injectRoute({ pattern: '/cms/settings', entrypoint: resolveCms('admin/settings.astro') });
        injectRoute({ pattern: '/cms/cache', entrypoint: resolveCms('admin/cache.astro') });
        injectRoute({ pattern: '/cms/menus', entrypoint: resolveCms('admin/menus.astro') });
        injectRoute({ pattern: '/cms/languages', entrypoint: resolveCms('admin/languages.astro') });
        injectRoute({ pattern: '/cms/users', entrypoint: resolveCms('admin/users.astro') });
        injectRoute({
          pattern: '/cms/import-export',
          entrypoint: resolveCms('admin/import-export.astro'),
        });

        injectRoute({ pattern: '/sitemap-index.xml', entrypoint: resolveCms('sitemap-get.js') });
        injectRoute({ pattern: '/robots.txt', entrypoint: resolveCms('robots-get.js') });
        injectRoute({ pattern: '/cms/api/[...path]', entrypoint: resolveCms('api/catchall.js') });
        injectRoute({ pattern: '/uploads/[...path]', entrypoint: resolveCms('uploads-get.js') });
        injectRoute({
          pattern: '/[...slug]',
          entrypoint: resolveCms(
            resolvedOptions.publicRendering === 'static' ? 'page-static.astro' : 'page.astro',
          ),
        });
      },
      'astro:config:done': ({ config }) => {
        assertAdapterConfigured(astroCommand, config.adapter);
      },
    },
  };
}
