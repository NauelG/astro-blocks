/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * utils/file-catalog.ts
 *
 * The single source of truth for every file-type decision in the system (ADR-0023).
 *
 * A supported file type is a TUPLE, not an entry in one of several maps. Before this module
 * the system held five independent, hardcoded opinions about file types — the default
 * allowlist, the extension map, the raster set, the serving Content-Type map and the
 * inline/attachment set — with nothing deriving them from one another and nothing forcing
 * them to agree. Two of them already disagreed: `.avif` had an extension but no serving
 * Content-Type, so every AVIF variant the pipeline generated was served as
 * `application/octet-stream`.
 *
 * The keys of the old extension map were, in effect, a second allowlist: implicit, hardcoded,
 * and never named as one. A consumer could widen the declared allowlist and could not widen
 * that one, so an allowed-but-unmapped MIME passed the security gate and died one statement
 * later on a second 415. That is the bug this module exists to make impossible.
 *
 * Exports:
 *   - FileCategory / FileTypeRow    : the tuple
 *   - BUILTIN_FILE_TYPES            : the rows the system ships with
 *   - DEFAULT_ALLOWED_FILE_TYPES    : the rows that are ENABLED out of the box (a different question)
 *   - resolveCatalog()              : builtin rows + consumer-registered rows
 *   - lookupByMime / lookupByExt    : the only sanctioned way to ask about a file type
 *   - intersectAccept()             : schema `accept` ∩ global allowlist (unchanged behaviour)
 *
 * Pure module — no I/O, no side effects beyond a memoised parse of the injected config.
 */

import type { FileCategory } from '../types/index.js';

/**
 * Re-exported for callers that reason about the catalog. Defined in types/ because it is a
 * domain concept, not a detail of this module.
 *
 * Declared on the row — never parsed out of the MIME string. Deriving identity from a string
 * the client handed us is the class of mistake this module retires. Every mature CMS agrees:
 * Strapi validates a closed enum at the schema layer, Sanity picks the asset type by endpoint,
 * WordPress indexes its categories by extension. None of them splits the MIME to decide.
 */
export type { FileCategory };

/** One supported file type. `mime` is the primary key. */
export interface FileTypeRow {
  /** Canonical MIME type, lowercase. */
  mime: string;
  /**
   * The extension the file is STORED under, leading dot included.
   *
   * Always derived from the validated MIME, never from the uploaded filename — an SVG named
   * `foo.jpg` and served inline is stored XSS (ADR-0018). This column is what makes a closed
   * catalog unavoidable: the moment the extension comes from the MIME, an open allowlist has
   * no answer to "what extension does this unknown MIME get?". Strapi and Directus answer it
   * with the literal string ".false"; we answer it by refusing to admit the type at all.
   */
  ext: string;
  /** The Content-Type used when SERVING. Equal to `mime` for every builtin row. */
  contentType: string;
  /** What this file is. */
  category: FileCategory;
  /**
   * 'inline'     → no Content-Disposition; the browser may render it in our origin.
   * 'attachment' → always downloaded.
   *
   * A column, not an `if` in the serving route. `image/svg+xml` is 'attachment' because its
   * ROW says so, so the next route that serves a file cannot forget the rule.
   */
  disposition: 'inline' | 'attachment';
  /** True only for MIME types sharp may process (variant generation, dimension extraction). */
  raster: boolean;
}

/**
 * The file types the system knows how to handle: name on disk, serve with the right
 * Content-Type, classify, and render a tile for.
 *
 * This is NOT the allowlist. See DEFAULT_ALLOWED_FILE_TYPES.
 *
 * Every row is a security decision. `disposition: 'inline'` is a statement that the type is
 * safe to render in our own origin; adding a row means auditing that claim and checking the
 * MIME and extension against the denylist in `upload-gate.ts`.
 */
export const BUILTIN_FILE_TYPES: readonly FileTypeRow[] = Object.freeze([
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    contentType: 'image/jpeg',
    category: 'image',
    disposition: 'inline',
    raster: true,
  },
  {
    mime: 'image/png',
    ext: '.png',
    contentType: 'image/png',
    category: 'image',
    disposition: 'inline',
    raster: true,
  },
  {
    mime: 'image/webp',
    ext: '.webp',
    contentType: 'image/webp',
    category: 'image',
    disposition: 'inline',
    raster: true,
  },
  {
    mime: 'image/gif',
    ext: '.gif',
    contentType: 'image/gif',
    category: 'image',
    disposition: 'inline',
    raster: false,
  },
  {
    mime: 'image/avif',
    ext: '.avif',
    contentType: 'image/avif',
    category: 'image',
    disposition: 'inline',
    raster: false,
  },
  // Not raster: sharp reads AVIF, but the variant pipeline has never processed it and this
  // change does not alter what sharp touches. The row exists so the SERVING side knows what
  // AVIF is — the variant generator writes .avif files and the route could not name them.

  // SVG is allowed but never rendered in our origin: an uploaded SVG is a script host.
  {
    mime: 'image/svg+xml',
    ext: '.svg',
    contentType: 'image/svg+xml',
    category: 'image',
    disposition: 'attachment',
    raster: false,
  },

  {
    mime: 'application/pdf',
    ext: '.pdf',
    contentType: 'application/pdf',
    category: 'document',
    disposition: 'inline',
    raster: false,
  },

  // Video and audio: in the catalog, NOT in the default allowlist. Opt in via allowedFileTypes.
  {
    mime: 'video/mp4',
    ext: '.mp4',
    contentType: 'video/mp4',
    category: 'video',
    disposition: 'inline',
    raster: false,
  },
  {
    mime: 'video/webm',
    ext: '.webm',
    contentType: 'video/webm',
    category: 'video',
    disposition: 'inline',
    raster: false,
  },
  {
    mime: 'audio/mpeg',
    ext: '.mp3',
    contentType: 'audio/mpeg',
    category: 'audio',
    disposition: 'inline',
    raster: false,
  },
]);

/**
 * The MIME types accepted out of the box.
 *
 * Deliberately hand-written, and deliberately NOT `BUILTIN_FILE_TYPES.map(r => r.mime)`.
 * "What the system CAN handle" and "what is ENABLED by default" are different questions, and
 * conflating them is precisely what produced the bug this catalog fixes. Video and audio are in
 * the catalog and absent here: a consumer opts into them via `allowedFileTypes`.
 *
 * The one invariant that must hold between the two — every default is a catalog row — is
 * asserted by a test, not by construction, so that widening this list stays a conscious act.
 */
export const DEFAULT_ALLOWED_FILE_TYPES: string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'image/gif',
  'application/pdf',
];

/** A row registered by the consumer through `customFileTypes`. */
export interface CustomFileTypeSpec {
  mime: string;
  ext: string;
  category: FileCategory;
}

/**
 * Normalise a consumer-registered type into a catalog row.
 *
 * `contentType` and `disposition` are NOT the consumer's to choose. Every registered row is
 * forced to `application/octet-stream` + `attachment`, so a type we have never audited cannot
 * be rendered in the CMS's own origin — the escape hatch is structurally incapable of
 * reintroducing the stored XSS that the denylist exists to prevent.
 *
 * This is a registration, not a bypass. Payload CMS ships the bypass shape: defining
 * `mimeTypes` on a collection skips its executable denylist entirely, so a config as innocent
 * as `mimeTypes: ['image/*']` silently disables it. The denylist must always win (ADR-0018);
 * a bypass would make that promise conditional.
 */
export function toCatalogRow(spec: CustomFileTypeSpec): FileTypeRow {
  return {
    mime: spec.mime.toLowerCase().trim(),
    ext: spec.ext.toLowerCase().trim(),
    contentType: 'application/octet-stream',
    disposition: 'attachment',
    category: spec.category,
    raster: false,
  };
}

/**
 * Memoised effective catalog. Populated on first resolveCatalog() call.
 * Cleared by resetFileCatalogCache() for test isolation.
 */
let _catalogCache: FileTypeRow[] | null = null;

/**
 * The effective catalog: the builtin rows plus whatever the consumer registered.
 *
 * Custom rows travel from the plugin config into the runtime the same way the allowlist does —
 * serialised by `vite.define` into `import.meta.env` at build time. Anything that reads the
 * catalog at runtime must come through here.
 */
export function resolveCatalog(): FileTypeRow[] {
  if (_catalogCache !== null) return _catalogCache;

  // biome-ignore lint/suspicious/noExplicitAny: import.meta.env is untyped at this call site; narrowed immediately below
  const raw: string =
    (((import.meta as any).env as Record<string, unknown> | undefined)
      ?.ASTRO_BLOCKS_CUSTOM_FILE_TYPES as string) ?? '';

  const custom: FileTypeRow[] = [];
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const decoded = JSON.parse(raw);
      if (Array.isArray(decoded)) {
        for (const entry of decoded) {
          if (
            entry &&
            typeof entry.mime === 'string' &&
            typeof entry.ext === 'string' &&
            typeof entry.category === 'string'
          ) {
            custom.push(toCatalogRow(entry as CustomFileTypeSpec));
          }
        }
      }
    } catch {
      // Malformed env — the config validator already threw at build time for anything real.
    }
  }

  _catalogCache = [...BUILTIN_FILE_TYPES, ...custom];
  return _catalogCache;
}

/** Test hook: clears the memoised catalog. Mirrors resetAllowedFileTypesCache(). */
export function resetFileCatalogCache(): void {
  _catalogCache = null;
}

/** Test hook: seed the effective catalog directly. Pass null to restore normal resolution. */
export function __setCatalogForTest(rows: FileTypeRow[] | null): void {
  _catalogCache = rows;
}

/** The row for a MIME type, or null if the system cannot handle it. */
export function lookupByMime(
  mime: string,
  catalog: readonly FileTypeRow[] = resolveCatalog(),
): FileTypeRow | null {
  const key = mime.toLowerCase().trim();
  return catalog.find((r) => r.mime === key) ?? null;
}

/** The row for a stored extension (leading dot), or null if the system does not recognise it. */
export function lookupByExt(
  ext: string,
  catalog: readonly FileTypeRow[] = resolveCatalog(),
): FileTypeRow | null {
  const key = ext.toLowerCase().trim();
  return catalog.find((r) => r.ext === key) ?? null;
}

/** Whether a MIME goes through sharp. Replaces the standalone RASTER_MIME set. */
export function isRaster(
  mime: string,
  catalog: readonly FileTypeRow[] = resolveCatalog(),
): boolean {
  return lookupByMime(mime, catalog)?.raster ?? false;
}

/**
 * Compute the intersection of a schema-defined accept list and a global allowlist.
 *
 * Both sides are normalised to lowercase before comparison, so a schema entry like
 * `'Application/PDF'` matches a lowercase allowlist entry like `'application/pdf'`. The
 * returned values are always lowercase.
 *
 *   - `accept` omitted or empty  → returns the full `allowlist` unchanged
 *   - `accept` provided          → returns `accept` lowercased, keeping only entries that
 *                                  appear in `allowlist`
 *
 * Behaviour is unchanged from utils/file-types.ts. Note this is a UI affordance: the media
 * picker filters with it. The upload endpoint enforces the GLOBAL allowlist only — the request
 * carries no block or prop identity for the server to narrow against (tracked in #102).
 */
export function intersectAccept(accept: string[] | undefined, allowlist: string[]): string[] {
  if (!accept || accept.length === 0) return allowlist;
  return accept.map((m) => m.toLowerCase()).filter((m) => allowlist.includes(m));
}
