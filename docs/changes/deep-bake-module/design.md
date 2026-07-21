<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Design — The deep bake module

## 1. The module (`src/utils/baked.ts`)

Isomorphic by construction: no `node:*` import, no i18n import, no `Response`. This is what lets the
two browser readers (`file-accept.ts`, `media.astro`) use it without pulling server code into the
client bundle. A test asserts the constraint mechanically (§5).

```ts
/** The structured keys — double-encoded because vite.define splices raw source. */
const STRUCTURED_KEYS = [
  'ASTRO_BLOCKS_ALLOWED_FILE_TYPES',
  'ASTRO_BLOCKS_CUSTOM_FILE_TYPES',
  'ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY',
  'ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY',
  'ASTRO_BLOCKS_SCHEMA_MAP',
] as const;
type StructuredKey = (typeof STRUCTURED_KEYS)[number];

/**
 * Writer. Owns the single-vs-double encode decision so no caller re-derives it.
 * A structured value is JSON.stringify'd twice: the outer call emits a *string literal* into the
 * bundle source that the runtime parses back, instead of an array/object literal the guard rejects.
 */
export function defineBakedValue(
  define: Record<string, string>,
  key: StructuredKey,
  value: unknown,
): void {
  define[`import.meta.env.${key}`] = JSON.stringify(JSON.stringify(value));
}

export type BakedResolution<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'unresolved' };

/**
 * The decode both classes share: the `typeof raw === 'string'` guard + JSON.parse + a caller
 * validator. `decode` returns the narrowed T, or null to reject (malformed / wrong shape).
 * Never throws — a malformed bake is `{ ok: false }`, not an exception.
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
      // fall through — malformed bake is unresolved, never a throw
    }
  }
  return { ok: false, reason: 'unresolved' };
}

/** Read the raw baked string for a key, isomorphically. */
function readRawBaked(key: StructuredKey): unknown {
  return (import.meta as unknown as { env?: Record<string, unknown> }).env?.[key];
}

/**
 * Class B: a key whose absence means dev/test, where the documented default is correct.
 * Isomorphic. There is no fallback *decision* at the call site — passing a fallback is not the same
 * as choosing between fallback and hard-fail, which is what #116's interface got wrong.
 */
export function readBakedConfig<T>(
  key: StructuredKey,
  opts: { decode: (parsed: unknown) => T | null; fallback: T },
): T {
  const res = decodeBaked(readRawBaked(key), opts.decode);
  return res.ok ? res.value : opts.fallback;
}

/** Class A: read the baked value only, returning the union for the caller's disk-seam fallback. */
export function readBakedArtifact<T>(
  key: StructuredKey,
  decode: (parsed: unknown) => T | null,
): BakedResolution<T> {
  return decodeBaked(readRawBaked(key), decode);
}
```

Note `readBakedArtifact` returns the union rather than taking an `onUnresolved`. The class-A caller
still owns *what unresolved means* — for it, a filesystem read, and only then a 500. The module owns
*how you know it is unresolved*. That boundary is the whole point (ADR-0033).

## 2. Writer migration (`src/plugin/index.ts`)

The 5 structured assignments at `:590-618` collapse to:

```ts
defineBakedValue(vite.define, 'ASTRO_BLOCKS_ALLOWED_FILE_TYPES', resolvedOptions.allowedFileTypes);
defineBakedValue(vite.define, 'ASTRO_BLOCKS_CUSTOM_FILE_TYPES', resolvedOptions.customFileTypes);
defineBakedValue(vite.define, 'ASTRO_BLOCKS_MAX_UPLOAD_BYTES_BY_CATEGORY', resolvedOptions.maxUploadBytes);
defineBakedValue(vite.define, 'ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY', globalBlocksRegistry);
defineBakedValue(vite.define, 'ASTRO_BLOCKS_SCHEMA_MAP', schemaMap);
```

The 6 scalar `JSON.stringify` assignments stay verbatim — out of scope, and mixing them in would make
`defineBakedValue` take a class parameter, re-opening the decision it exists to close. The post-mortem
comment at `:580-589` moves into `defineBakedValue`'s doc comment: it explains the mechanism, and the
mechanism now lives in one place.

## 3. Class-A readers (fail loud, server-only)

`route-table.ts` and `schema-loading.ts` keep their structure; only the baked-decode head changes:

```ts
const decoded = readBakedArtifact<GlobalBlockRuntimeEntry[]>(
  'ASTRO_BLOCKS_GLOBAL_BLOCKS_REGISTRY',
  (p) => (Array.isArray(p) ? (p as GlobalBlockRuntimeEntry[]) : null),
);
if (decoded.ok) return { ok: true, entries: decoded.value };
// unchanged below: dev/test disk read of .astro-blocks/*.mjs, then the ADR-0009/0025 console.error
// + { ok: false, reason: 'unresolved' }.
```

`RegistryResult` / `SchemaMapResult` both re-use `BakedResolution`'s `{ ok:false, reason:'unresolved' }`
arm imported from the module, so the union is declared once (acceptance criterion). The disk read, the
`console.error` and the `localizedJsonError(..., 500)` are untouched — they are correct and Node/server
bound.

## 4. Class-B readers (default, isomorphic)

All five become one call plus a validator. The validators are where today's divergence gets
normalised into one behaviour:

```ts
// media.ts getAllowedFileTypes — the empty-allowlist behaviour change lives here.
const parsed = readBakedConfig<string[]>('ASTRO_BLOCKS_ALLOWED_FILE_TYPES', {
  decode: (p) =>
    Array.isArray(p) && p.every((v) => typeof v === 'string' && v.trim().length > 0)
      ? [...new Set(p.map((v) => v.toLowerCase().trim()))]
      : null,
  fallback: DEFAULT_ALLOWED_FILE_TYPES,
});
// ... then the existing catalog intersection (ADR-0023) is unchanged.
```

The decoder accepts a valid **empty** array (it passes `every`), so `[]` resolves to `[]` rather than
falling back. `media.astro` and `file-accept.ts` adopt the *same* decoder, so all three now:

- respect an empty allowlist (offer nothing / reject everything, matching the server), and
- reject non-string elements (`[123]` → `null` → fallback, instead of `as string[]` garbage).

Where the three still legitimately differ is only in **what a valid result is used for** — a `Set`
for the server gate, a comma-joined `accept` string for the panel — never in how the bake is decoded.

`file-catalog.ts` (`CUSTOM_FILE_TYPES`) and `getCategoryPolicy` (`MAX_UPLOAD_BYTES_BY_CATEGORY`) move
to `readBakedConfig` with their existing per-entry validators intact; no behaviour change for those
two, they were already the strict readers.

## 5. What is and isn't unit-testable (verified, not assumed)

`import.meta.env` is `undefined` in `node --test` and is **per-module** — a test file assigning its
own `import.meta.env` cannot reach the one `baked.js` reads. This is exactly why the existing bake
coverage is indirect (the `runtimeValueOf` *simulation*, the retired source-regex). So the split is:

- **`decodeBaked(raw, decode)` takes the raw string as an argument** → fully unit-testable with no
  `import.meta` at all. The double-encode round trip and every decode/validate branch live and are
  proven here.
- **The validators** (the `decode` callbacks — where the empty-allowlist behaviour change lives) are
  **named exports**, unit-tested directly with `[]`, `[123]`, valid arrays. Because all three
  `ALLOWED_FILE_TYPES` readers import the *same* validator, testing it once proves they agree.
- **`readBakedConfig` / `readBakedArtifact`** are thin glue over `readRawBaked` + `decodeBaked`
  (`res.ok ? res.value : fallback`). The `import.meta.env` read is not unit-reachable; it is proven
  behaviourally by the e2e (the standalone server resolves with no `.astro-blocks/` beside it), the
  same stance ADR-0025 and `schema-map-bake-guard.test.js` already take. No test seam is added to a
  production signature to work around this.

## 6. Tests

`tests/baked.test.js` — the module, directly, which #116 asks for to replace the fragile source-regex:

- **round trip**: `defineBakedValue` writes a value; simulating vite's substitution (the outer string
  is spliced as source, the runtime `JSON.parse`s it) and calling `decodeBaked` returns it. This is
  the double-encode contract as an executable assertion, not a regex over source.
- `decodeBaked` on a *single*-encoded value (an array literal, not a string) → `{ ok: false }`. This
  is the `video/mp4` bug's exact shape; it must be caught by the type of the raw, not by luck.
- malformed JSON, `undefined`, empty string, wrong shape → `{ ok: false }`, never a throw.
- **empty structured value is a value, not a failure**: `"{}"` and `"[]"` decode to `{}` / `[]`, so a
  project declaring no blocks (class A) and an empty allowlist (class B) both resolve rather than
  fall back.

`readBakedConfig` / `readBakedArtifact` themselves are one-line glue over `decodeBaked` and are not
unit-driven (§5): their `import.meta.env` read is unreachable under `node --test`. They are covered
by e2e (T8).

`tests/file-catalog.test.js` — the behaviour change, at the **shared validator** the three readers
now import. This is where it *is* unit-testable, because `decodeAllowlist` takes its input directly:

- **empty allowlist is a value, not a fallback**: `decodeAllowlist([])` → `[]`. The three readers all
  call this, so an empty allowlist resolves to empty on every path instead of the old `length > 0`
  fallback to the full catalog. This is the assertion that would fail against `main`, where the admin
  readers never shared this decoder.
- **non-string elements are rejected**: `decodeAllowlist([123])` → `null`, so it never reaches the
  `accept` attribute as garbage.

The *end-to-end* "server rejects all AND panel offers none" is proven by e2e, not asserted here —
the `import.meta.env` path is not unit-reachable, and pinning the shared decoder is what guarantees
the three agree.

`schema-map-bake-guard.test.js` — retire or downgrade. Its own tail comment (its lines 65-85) admits a
source-grep guard "cannot fail" reliably; `baked.test.js`'s round trip is the real assertion it was
standing in for. Downgrade to a lint-level note or delete, per what review prefers.

## 7. What is deliberately *not* touched

- The 6 scalar bake keys — direct `import.meta.env` reads, no hazard.
- The `.astro-blocks/*.mjs` disk seam and both `localizedJsonError(..., 500)` responses.
- `MAX_UPLOAD_BYTES` from `process.env`.
- The `astro:config:setup` hook's structure (#121).
