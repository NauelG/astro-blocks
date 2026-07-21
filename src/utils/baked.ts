/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * baked.ts — the one place that knows how a build-time value crosses the build boundary.
 *
 * The precompiled API route ships outside the consumer's Vite graph, so it cannot import runtime
 * artifacts; instead the plugin bakes them into `import.meta.env` via `vite.define`. This module
 * owns both ends of that bridge so no reader re-derives it — the invariant with the worst bug
 * record in the codebase (ADR-0009, #101/ADR-0025, the video/mp4 415).
 *
 * DOUBLE-ENCODE. `vite.define` splices its value into the bundle as raw SOURCE. A single
 * `JSON.stringify(array)` therefore becomes an array LITERAL in the emitted code, which the reader's
 * `typeof raw === 'string'` guard rejects — so the value silently never arrives and the reader falls
 * back to a default. Encoding twice emits a string literal the runtime parses back with JSON.parse.
 * That, precisely, is the bug that shipped `allowedFileTypes` as the default in every release.
 *
 * ISOMORPHIC by construction: no `node:*` import, no i18n import, no `Response`. Two of the readers
 * run in the browser (the admin block-form island, media.astro), so pulling server code in here
 * would drag it into the client bundle. A test asserts this mechanically.
 *
 * The module owns *how you know* a value is unresolved (the union below). It does NOT own *what
 * unresolved means*: for an artifact key that is a dev/test filesystem read and then a 500, built at
 * the server call site — never here (ADR-0033).
 */

/**
 * The keys baked as structured (double-encoded) values. The 6 scalar keys (`PROJECT_ROOT`,
 * `PUBLIC_RENDERING`, `CACHE_*`, `ROUTING_STRATEGY`) are single-encoded and read directly; they have
 * never had this bug, so they are deliberately not routed through here.
 */
export const STRUCTURED_KEYS = [
  'ASTRO_BLOCKS_ALLOWED_FILE_TYPES',
  'ASTRO_BLOCKS_CUSTOM_FILE_TYPES',
  'ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY',
  'ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY',
  'ASTRO_BLOCKS_SCHEMA_MAP',
] as const;

export type StructuredKey = (typeof STRUCTURED_KEYS)[number];

/**
 * Writer. Owns the single-vs-double encode decision so no caller re-derives it. See the
 * double-encode note above for why the value is stringified twice.
 */
export function defineBakedValue(
  define: Record<string, string>,
  key: StructuredKey,
  value: unknown,
): void {
  define[`import.meta.env.${key}`] = JSON.stringify(JSON.stringify(value));
}

/**
 * The result of decoding a baked value. Defined once and imported by the artifact loaders, so the
 * `{ ok: false; reason: 'unresolved' }` shape is not re-declared per loader (spec R8).
 */
/**
 * The failure arm shared by every artifact loader. Exported so `RegistryResult` / `SchemaMapResult`
 * reuse it instead of each re-declaring `{ ok: false; reason: 'unresolved' }` (spec R8). There is
 * exactly one way to fail — `unresolved` — and it lives here (spec R10).
 */
export type BakedUnresolved = { ok: false; reason: 'unresolved' };

export type BakedResolution<T> = { ok: true; value: T } | BakedUnresolved;

/**
 * The decode both key classes share: the `typeof raw === 'string'` guard, `JSON.parse`, and a
 * caller-supplied validator. `decode` returns the narrowed `T`, or `null` to reject (malformed or
 * wrong shape). Never throws — a malformed bake is `{ ok: false }`, not an exception.
 *
 * Takes `raw` as an argument (not read from `import.meta.env`) so the whole contract is unit-testable
 * without the build boundary.
 */
export function decodeBaked<T>(
  raw: unknown,
  decode: (parsed: unknown) => T | null,
): BakedResolution<T> {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const value = decode(JSON.parse(raw));
      if (value !== null) return { ok: true, value };
    } catch {
      // A malformed bake is unresolved, never a throw — the reader decides what that means.
    }
  }
  return { ok: false, reason: 'unresolved' };
}

/** Read the raw baked string for a key, isomorphically. `import.meta.env` is absent off the bundle. */
function readRawBaked(key: StructuredKey): unknown {
  return (import.meta as unknown as { env?: Record<string, unknown> }).env?.[key];
}

/**
 * Class B (config): a key whose absence means dev/test, where the documented default is correct.
 * Isomorphic. There is no fallback *decision* at the call site — the class is the entrypoint, not a
 * parameter (ADR-0033).
 */
export function readBakedConfig<T>(
  key: StructuredKey,
  opts: { decode: (parsed: unknown) => T | null; fallback: T },
): T {
  const res = decodeBaked(readRawBaked(key), opts.decode);
  return res.ok ? res.value : opts.fallback;
}

/**
 * Class A (artifact): a key whose absence is a broken deployment. Returns the union so the caller
 * can run its own dev/test filesystem fallback and, only if that also fails, fail loudly with a 500
 * (spec R7–R9). This module never builds that Response.
 */
export function readBakedArtifact<T>(
  key: StructuredKey,
  decode: (parsed: unknown) => T | null,
): BakedResolution<T> {
  return decodeBaked(readRawBaked(key), decode);
}
