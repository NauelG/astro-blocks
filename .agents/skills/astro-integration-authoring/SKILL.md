---
name: astro-integration-authoring
description: Author an Astro integration as an npm package. Use when working with plugin/index.ts, injectRoute authoring, astro:config:setup hook, AstroIntegration return type, addVirtualImports, integration package structure, or peerDependency astro.
license: MIT
metadata:
  authors: "astro-blocks"
  version: "0.1.0"
---

# Astro Integration Authoring

This skill covers **authoring** an Astro integration as a publishable npm package — specifically writing `plugin/index.ts`, implementing lifecycle hooks, injecting routes, and generating runtime files at config time.

**Consumer-side patterns** (`.astro` component syntax, `Astro.props`, `client:*` directives, content collections, SSR adapter consumption) are out of scope here. Consult the `astro` skill for those.

---

## Scope Boundaries

| Topic | Covered here | Covered by `astro` skill |
|-------|-------------|--------------------------|
| `plugin/index.ts` hook authoring | ✅ | — |
| `injectRoute()` call signature | ✅ | — |
| Runtime codegen to `.astro-blocks/` | ✅ | — |
| `peerDependency` strategy | ✅ | — |
| Playground/consumer test harness | ✅ | — |
| `.astro` component frontmatter | — | ✅ |
| `Astro.props` access | — | ✅ |
| `client:*` hydration directives | — | ✅ |
| Content collections | — | ✅ |
| SSR adapter consumption | — | ✅ |

---

## Integration Hook Lifecycle

An integration returns an `AstroIntegration` object with a `hooks` map. This project uses three hooks.

### `astro:config:setup`

Fires synchronously during config resolution — before any build or server starts. This is the primary hook for route injection, codegen, and Vite config mutation.

**What it receives**: `{ config, injectRoute, addWatchFile, updateConfig, ... }`

**Common patterns** (see `plugin/index.ts` lines 108–206):
- Resolve the consumer project root via `getProjectRoot(config)` (line 109) — reads `config.root` or `process.env.ASTRO_BLOCKS_PROJECT_ROOT`
- Call `generateRuntime(projectRoot, options)` to write `.astro-blocks/` files (line 135)
- Call `injectRoute(...)` for every route the integration owns (lines 188–205)
- Mutate `config.vite` in place — set aliases, `ssr.noExternal`, `define` constants (lines 138–180)
- Call `ensureDefaultFiles()` to initialise data stores before routes are registered (line 113)

**Key constraint**: everything that injected routes depend on (generated files, aliases) MUST be done here — Astro resolves routes after this hook returns.

### `astro:server:start`

Fires after the Vite dev server is ready. Use for dev-only side effects (e.g. opening a browser tab, starting a file watcher). This project does not currently use this hook but it is part of the `AstroIntegration` interface.

**What it receives**: `{ address, server }`

### `astro:build:done`

Fires after the production build completes. Use for post-build tasks: generating a sitemap file, copying assets, writing a manifest.

**What it receives**: `{ dir, routes, pages }`

---

## `injectRoute()` Patterns

`injectRoute()` registers a route owned by the integration, not by the consumer's `src/pages/`. Call it inside `astro:config:setup`.

### Signature

```ts
injectRoute({
  pattern: string,     // URL pattern, e.g. '/cms' or '/[...slug]'
  entrypoint: string,  // Absolute path to the route file (inside the package)
  prerender?: boolean, // true = static output; false/omit = SSR
})
```

### `resolveCms` pattern (plugin/index.ts lines 137, 188–205)

The integration resolves entrypoints relative to its own package directory (`cmsDir`), not the consumer project root:

```ts
const cmsDir = path.resolve(__dirname, '..');  // line 15
const resolveCms = (file: string): string => path.join(cmsDir, 'routes', file);  // line 137

injectRoute({ pattern: '/cms', entrypoint: resolveCms('admin/index.astro') });
injectRoute({ pattern: '/cms/api/[...path]', entrypoint: resolveCms('api/catchall.js') });
```

Use `path.join(packageRoot, 'routes', file)` — do NOT pass bare package-relative strings; Astro requires an absolute path here.

### Dynamic patterns

For catch-all slug routes with conditional rendering mode (plugin/index.ts lines 202–205):

```ts
injectRoute({
  pattern: '/[...slug]',
  entrypoint: resolveCms(
    resolvedOptions.publicRendering === 'static' ? 'page-static.astro' : 'page.astro'
  ),
});
```

Set `prerender: false` explicitly on any SSR route if the consumer project has `output: 'static'` as default — otherwise Astro may try to prerender it.

---

## Runtime Code Generation

The `.astro-blocks/` codegen pattern writes consumer-project-specific JavaScript at `astro:config:setup` time. This is how the integration bridges consumer block imports (which vary per project) into injected routes (which live inside the package).

### Why codegen

Injected routes live inside the npm package and cannot statically `import` consumer-defined components. Instead, the integration writes a `runtime.mjs` file into the consumer's `.astro-blocks/` directory at startup, and injected routes import from that generated file.

### `generateRuntime()` (plugin/index.ts lines 39–81)

```
.astro-blocks/
  runtime.mjs      — exports Layout, componentMap (keyed by block name), schemaMap
  schema-map.mjs   — exports schemaMap only (used by the schema API)
```

Key steps inside `generateRuntime(projectRoot, options)`:
1. `resolveBlockEntries(projectRoot, options.blocks)` — maps block config to absolute component paths
2. Compute relative imports from `.astro-blocks/` to each component (line 46–48)
3. Write `runtime.mjs` with `import` statements + `componentMap` and `schemaMap` exports (lines 53–80)
4. The Vite alias `'astro-blocks-runtime'` points to this generated file (line 147)

**Timing constraint**: `generateRuntime` MUST complete before `injectRoute` is called. Because `astro:config:setup` is `async`, `await generateRuntime(...)` on line 135 guarantees the file exists when the Vite alias resolves.

---

## Virtual Imports (`addVirtualImports`)

`addVirtualImports` is **not used** in this project. This integration uses a Vite alias (`'astro-blocks-runtime'` → `.astro-blocks/runtime.mjs`) instead of virtual modules. Do not document or introduce virtual imports unless this project explicitly adopts them.

---

## Peer Dependencies

`astro` MUST be declared as a `peerDependency`, not a `devDependency` or regular `dependency`.

**Why**: The consumer project installs Astro — the integration must use the consumer's version, not bundle its own. Bundling Astro as a dependency would cause version conflicts and duplicate instances.

From `package.json` (line 70–72):
```json
"peerDependencies": {
  "astro": "^6.0.0"
}
```

Keep `astro` in `devDependencies` as well so it is available during local development and tests — but the published package relies on the consumer to satisfy the peer.

---

## Testing Integrations — The Playground Pattern

Integrations can only be exercised end-to-end by running them inside a real Astro project. This project uses two complementary test surfaces:

### Unit tests (`tests/*.test.js`)

Tests under `tests/` import from `dist/` (the built package output). They use `withTempProject` to spin up an isolated consumer project on disk, install the built tarball, and assert on HTTP responses or generated files. See the `node-test-runner` skill for the `withTempProject` helper and `node --test` runner patterns.

Run with: `npm test` (which runs `npm run build && node --test tests/*.test.js`).

### Playground (`playgrounds/`)

A full Astro workspace project under `playgrounds/` acts as an interactive consumer. Use `npm run dev:playground` to start it. The playground imports the locally built package via `scripts/install-playground-package.mjs`.

For a new injected route or codegen change: verify it in the playground interactively first, then write a `tests/*.test.js` assertion for regression coverage.

---

## Compact Rules

- Always return `AstroIntegration` from the plugin function — do not export hooks directly.
- Put ALL route injection, codegen, and Vite config in `astro:config:setup`; routes are resolved after this hook returns.
- Resolve entrypoints with `path.join(packageDir, 'routes', file)` — Astro requires absolute paths for `injectRoute`.
- Use `getProjectRoot(config)` (reads `config.root` || `ASTRO_BLOCKS_PROJECT_ROOT` || `cwd()`) for all consumer-filesystem writes.
- Write generated files to `.astro-blocks/` inside the consumer project root, then map them via a Vite alias — not virtual modules.
- Declare `astro` as `peerDependency` only (also in `devDependencies` for local dev); never as a regular `dependency`.
- Test injected routes end-to-end via the playground or `withTempProject` — unit tests on exported utilities alone are not sufficient.
