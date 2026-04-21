# AstroBlocks — AI Agent Context for Consumers

This file is for AI coding assistants (Claude, Copilot, Cursor, Windsurf, etc.) working inside a project that uses the `@astroblocks/astro-blocks` npm package. It describes the public API, data model, admin routes, authentication, and integration patterns that a consumer developer needs to work with.

---

## What This File Is

This file ships inside the `@astroblocks/astro-blocks` npm tarball. It lands at:

```
node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md
```

It is auto-versioned with the installed package. When the package is upgraded, re-run `npx astro-blocks init-ai` to refresh the reference in your project's `AGENTS.md` or `CLAUDE.md`.

**Audience**: developers building an Astro site that installs `@astroblocks/astro-blocks`.

**Not covered here**: release workflow, contributor onboarding, internal TDD discipline, GitHub Actions internals. See the repository's `AGENTS.md` for maintainer-facing documentation.

---

## Prerequisites

### Node.js version requirement

Node.js >= 18.0.0 is required (the package uses ESM and native async APIs).

### Required Astro version (peerDependency)

Astro 6.0 or higher is required. The integration registers Astro hooks via `astro:config:setup`.

### Required Astro adapter (SSR mode)

AstroBlocks runs in SSR mode by default. You must configure an Astro SSR adapter (`@astrojs/node`, `@astrojs/vercel`, etc.) in your `astro.config.mjs`. The only exception is if you set `publicRendering: 'static'` for all public pages — but admin routes still require SSR.

---

## Installation

### npm / pnpm / yarn

```sh
npm install @astroblocks/astro-blocks
# or
pnpm add @astroblocks/astro-blocks
# or
yarn add @astroblocks/astro-blocks
```

### Registering the integration in astro.config.mjs

```js
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { heroSchema } from './src/blocks/Hero.astro';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema],
    }),
  ],
});
```

---

## Integration Options Reference

All options are passed to `astroBlocks({})` in `astro.config.mjs`.

### `blocks` (required)

An array of `BlockSchema` objects exported from your block components. The plugin uses this list to register which components are available in the CMS page builder.

```ts
blocks: BlockSchema[]
```

### `layoutPath`

Path to your layout component. The CMS injects this layout around all CMS-managed public pages. Defaults to `'./src/layouts/Layout.astro'`.

```ts
layoutPath?: string  // default: './src/layouts/Layout.astro'
```

The layout receives the following props from the CMS runtime:

```ts
{
  title: string;
  seo: {
    title?: string;
    description?: string;
    canonical?: string;
    image?: string;
    nofollow?: boolean;
  };
  locale: string;
  alternates: { locale: string; path: string }[];
}
```

### `publicRendering`

Controls whether CMS-managed public pages are served via SSR or pre-rendered as static HTML.

```ts
publicRendering?: 'server' | 'static'  // default: 'server'
```

> Note: `'static'` disables redirect rules for public pages. Cache options have no effect in static mode.

### `cache`

Controls HTTP cache headers for SSR-rendered public pages. Has no effect in static mode.

```ts
cache?: {
  enabled?: boolean   // default: true
  maxAge?: number     // seconds, default: 60
  swr?: number        // stale-while-revalidate seconds, default: 300
}
```

### `i18n.routingStrategy`

Sets the i18n URL routing strategy. Only `'path-prefix'` is supported in v1.

```ts
i18n?: {
  routingStrategy?: 'path-prefix'  // default: 'path-prefix'
}
```

---

## Block Development

### What a block is

A block is an Astro component that renders a section of a CMS-managed page. Each block has a schema that defines its editable fields. The CMS page builder uses these schemas to render the editing UI.

### Defining a block component (.astro)

```astro
---
// src/blocks/Hero.astro
import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

const { title, subtitle, ctaLabel, ctaHref } = Astro.props;

export const heroSchema = defineBlockSchema(
  {
    name: 'Hero',
    key: 'hero',
    items: {
      title: { type: 'string', label: 'Title', required: true },
      subtitle: { type: 'text', label: 'Subtitle' },
      ctaLabel: { type: 'string', label: 'CTA Label' },
      ctaHref: { type: 'link', label: 'CTA URL' },
    },
  },
  import.meta.url  // REQUIRED — tells the plugin where this component lives
);
---

<section class="hero">
  <h1>{title}</h1>
  {subtitle && <p>{subtitle}</p>}
  {ctaHref && <a href={ctaHref}>{ctaLabel}</a>}
</section>
```

### Registering a block

Pass the exported schema to the `blocks` array in `astro.config.mjs`:

```js
import { heroSchema } from './src/blocks/Hero.astro';

astroBlocks({ blocks: [heroSchema] })
```

### `defineBlockSchema` — field types reference

Field types available in `items`:

| Type | Description | Notes |
|------|-------------|-------|
| `string` | Single-line text | Basic text input |
| `text` | Multi-line text | Textarea input |
| `number` | Numeric value | Number input |
| `boolean` | True/false toggle | Checkbox |
| `image` | Image with upload | Returns a URL string |
| `link` | URL or path | Text input for href values |
| `select` | Dropdown selection | Requires `options: string[]` |
| `array` | List of items | Requires `item` definition; supports sortable, minItems, maxItems |

**Array field example:**

```ts
items: {
  slides: {
    type: 'array',
    label: 'Slides',
    sortable: true,
    minItems: 1,
    maxItems: 10,
    item: {
      type: 'object',
      label: 'Slide',
      fields: {
        title: { type: 'string', label: 'Title' },
        image: { type: 'image', label: 'Image' },
      },
      summaryField: 'title',
    },
  },
}
```

**Localizable fields:**

Add `localizable: true` to any primitive field to enable per-language editing in the CMS.

### Layout props contract

The layout component at `layoutPath` receives these props from the CMS runtime:

```ts
interface LayoutProps {
  title: string;
  seo: SeoData;
  locale: string;
  alternates: { locale: string; path: string }[];
}
```

Access them in your layout:

```astro
---
const { title, seo, locale, alternates } = Astro.props;
---
```

### Gotchas and common mistakes

**`blocks` must be passed at config time, not runtime.** The plugin resolves component paths during the Astro build — you cannot dynamically add blocks.

**The layout wraps ALL CMS-managed pages.** Do not add a `<Layout>` wrapper inside a block component — the CMS injects the layout automatically.

**`.astro-blocks/` is generated — do not edit or commit it.** Add `.astro-blocks/` to your `.gitignore`. The plugin regenerates it on every build.

---

## Import Map (all public export paths)

All public exports from `@astroblocks/astro-blocks`:

### `.` — default export (the Astro integration)

```ts
import astroBlocks from '@astroblocks/astro-blocks';
```

Use in `astro.config.mjs` to register the integration.

### `./contract` — block schema utilities

```ts
import { defineBlockSchema, PROP_TYPES } from '@astroblocks/astro-blocks/contract';
import type { BlockSchema, PropDef, BlockInstance } from '@astroblocks/astro-blocks/contract';
```

Use in block components and layout files.

### `./getMenu` — menu data

```ts
import { getMenu } from '@astroblocks/astro-blocks/getMenu';
import type { MenuItem } from '@astroblocks/astro-blocks/getMenu';
```

### `./getConfig` — config key-value store

```ts
import { getConfig, getConfigMap } from '@astroblocks/astro-blocks/getConfig';
```

### `./getLanguages` — content languages

```ts
import { getLanguages } from '@astroblocks/astro-blocks/getLanguages';
```

### `./getI18nMeta` — i18n metadata for layouts

```ts
import { getI18nMeta } from '@astroblocks/astro-blocks/getI18nMeta';
import type { I18nMetaResult, I18nLayoutContext } from '@astroblocks/astro-blocks/getI18nMeta';
```

### `./components/GlobalBlock` — render a global block by slug

```astro
---
import GlobalBlock from '@astroblocks/astro-blocks/components/GlobalBlock';
---

<GlobalBlock slug="site-header" />
```

Renders the single component instance bound to the declared slug, with locale resolution applied to localizable props. Unknown slug → silent `console.warn` in dev, empty output in production. Declared slug with no stored entry → renders with empty props (no error).

---

## Generated Runtime (.astro-blocks/)

The plugin generates a `runtime.mjs` file in `.astro-blocks/` at build time. This file re-exports your layout and block components so the CMS route can render them.

**If you use the CMS catch-all page route, you do not need to import from `.astro-blocks/` directly.** The plugin handles this internally.

Add `.astro-blocks/` to `.gitignore`:

```
.astro-blocks/
```

---

## Data Model (files the plugin creates in your project)

The plugin stores all CMS content as JSON files in your project root under `data/`. These files are created automatically on first run.

| File | Contents |
|------|----------|
| `data/pages.json` | All CMS-managed pages (title, slug, blocks, SEO, status per locale) |
| `data/configs.json` | Key/value configuration entries |
| `data/menus.json` | Menu structures with localized items |
| `data/redirects.json` | Redirect rules (SSR mode only) |
| `data/languages.json` | Content language list with default locale |
| `data/users.json` | Admin user accounts (hashed passwords) |
| `data/global-blocks.json` | Global block props per declared slug (`{ globalBlocks: { [slug]: { props, updatedAt? } } }`) |
| `public/uploads/` | Uploaded files (images and documents) |

**Commit these files to git.** They are your CMS content source of truth.

Do NOT commit `.astro-blocks/` — it is generated.

---

## CMS Admin Routes (plugin-managed, read-only for consumers)

These routes are **INJECTED by the plugin via `injectRoute`**. Do NOT create them in `src/pages/` — they will conflict and cause routing errors.

| Route | Purpose |
|-------|---------|
| `/cms` | CMS dashboard — overview and navigation |
| `/cms/pages` | Page management — create, edit, publish pages |
| `/cms/redirects` | Redirect rules (SSR mode only) |
| `/cms/configs` | Config key/value store |
| `/cms/settings` | CMS settings (site name, base URL, SEO defaults) |
| `/cms/cache` | Cache management and invalidation |
| `/cms/menus` | Menu builder |
| `/cms/languages` | Content language management |
| `/cms/global-blocks` | Global block management — declared slugs with single-block form per slug |
| `/cms/users` | Admin user management |
| `/cms/api/[...path]` | Internal API used by the admin UI — do not call directly |

**These routes cannot be customized or overridden by consumers.** They are entirely managed by the plugin. If you need to customize the admin UI, file an issue — do not try to shadow these routes.

---

## Global Blocks

Global blocks are reusable singleton content sections — site headers, footers, promotional banners — that are edited once and rendered anywhere via the `<GlobalBlock>` component. Unlike page blocks, global blocks are not tied to a specific URL: each declared slug stores exactly **one set of props** in a shared JSON store.

> **v2 (schema-driven).** Each slug is bound to a specific `BlockSchema` at declaration time. The admin renders a single form for that schema's fields — there is no add/remove/reorder block-list UI. See the [Migration note](#migration-from-v1-alpha) below if you are upgrading from the earlier alpha.

### Declaring global blocks

Add a `globalBlocks` array to your integration options in `astro.config.mjs`. Each entry requires a `schema` produced by `defineBlockSchema`:

```js
import { defineConfig } from 'astro/config';
import astroBlocks from '@astroblocks/astro-blocks';
import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';
import { heroSchema } from './src/blocks/Hero.astro';
import { globalHeaderSchema } from './src/components/GlobalHeader.astro';
import { globalFooterSchema } from './src/components/GlobalFooter.astro';

export default defineConfig({
  integrations: [
    astroBlocks({
      blocks: [heroSchema],
      globalBlocks: [
        { slug: 'site-header', schema: globalHeaderSchema, label: 'Header' },
        { slug: 'site-footer', schema: globalFooterSchema },
      ],
    }),
  ],
});
```

**Config shape:**

```ts
globalBlocks?: Array<{
  slug: string;       // ^[a-z0-9][a-z0-9-]*$  — unique, static
  schema: BlockSchema; // produced by defineBlockSchema(..., import.meta.url) — REQUIRED
  label?: string;     // admin display label; falls back to schema.name, then slug
}>
```

**Slug rules:** lowercase alphanumeric and hyphens only (`^[a-z0-9][a-z0-9-]*$`). Slugs must be unique across `globalBlocks`. Duplicates or schemas missing `__componentPath` (i.e. `defineBlockSchema` called without `import.meta.url`) throw a descriptive error at build time.

**Static scope:** slugs are declared at config time, not at runtime. To add or remove a slug, edit `astro.config.mjs` and rebuild.

### Rendering a global block

Import and use the `<GlobalBlock>` component anywhere in your Astro project — layouts, pages, or other components:

```astro
---
import GlobalBlock from '@astroblocks/astro-blocks/components/GlobalBlock';
---

<GlobalBlock slug="site-header" />
<main><!-- page content --></main>
<GlobalBlock slug="site-footer" />
```

The component looks up the schema bound to the slug, loads the stored `props` from `data/global-blocks.json`, resolves localizable fields via `Astro.currentLocale`, and renders **exactly one** component instance. If the slug has no stored entry it renders with empty props (no error). If the slug is not declared in config it outputs nothing and logs a `console.warn` in dev mode.

### Admin UI

Navigate to `/cms/global-blocks` in the admin panel to manage global blocks. Each declared slug appears as a row with its resolved label and an Edit button. Clicking Edit opens a **single-block form modal** auto-generated from that slug's `schema.items` — the same field renderers used by the page block editor. There is no add/remove/reorder UI — there is always exactly one set of props per slug. Save triggers `PUT /cms/api/global-blocks/:slug` with `{ props }`.

### REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cms/api/global-blocks` | List all declared slugs with their stored props |
| `GET` | `/cms/api/global-blocks/:slug` | Get a single slug entry (404 if slug not declared) |
| `PUT` | `/cms/api/global-blocks/:slug` | Save props for a slug |

All endpoints require a valid `Authorization: Bearer <token>` header. There is no `POST` or `DELETE` — slugs are static.

**Request body for PUT:**

```json
{ "props": { "siteTitle": "My Site", "ctaLabel": "Contact" } }
```

**Response codes:**

| Code | Condition |
|------|-----------|
| `200` | Success — returns `{ globalBlocks: { [slug]: { props, updatedAt } } }` |
| `400` | `props` key missing, not an object, or fails schema validation |
| `404` | Slug not declared in config |

### Storage shape

Global block content is stored in `data/global-blocks.json`. Commit this file to git — it is your content source of truth.

```json
{
  "globalBlocks": {
    "site-header": {
      "props": { "siteTitle": "My Site", "ctaLabel": "Contact" },
      "updatedAt": "2026-04-21T12:00:00.000Z"
    },
    "site-footer": {
      "props": {}
    }
  }
}
```

Each slug stores `{ props: Record<string, unknown>, updatedAt?: string }`. Slugs with no stored entry return `{ props: {} }` from the API and render with empty props.

### i18n

Localizable props use the same `LocalizedValueMap` pattern as page blocks. When a prop is marked `localizable: true` in its schema, the stored value is an object keyed by locale code:

```json
{
  "props": {
    "siteTitle": { "en": "My Site", "es": "Mi Sitio" }
  }
}
```

The `<GlobalBlock>` component resolves the correct locale value at render time using `Astro.currentLocale`.

### Migration from v1 (alpha)

> **Alpha — breaking change.** This applies only if you used the earlier alpha release that accepted `{ slug, label }` (without `schema`) and stored `{ blocks: BlockInstance[] }` per slug.

- **Config:** add a `schema` field to each `globalBlocks` entry. `schema` must be produced by `defineBlockSchema(..., import.meta.url)`.
- **Data:** the first successful `PUT` after upgrading rewrites the stored entry to the new `{ props }` shape. On load, legacy entries (`{ blocks: [] }`) are silently treated as `{ props: {} }` — no data loss, no manual migration script required.
- **Rendering:** `<GlobalBlock>` now renders one component instance (not a list). If your layout depended on iterating `entry.blocks`, simplify to a single block type declared via `schema`.

### Known limitations

**Config/data drift is silently ignored.** If you remove a slug from `globalBlocks` in `astro.config.mjs`, the corresponding data in `data/global-blocks.json` is preserved but silently ignored — the admin UI will not show it, and the API will return 404 for it. To clean up orphaned data, remove the entry from `data/global-blocks.json` manually.

---

## Authentication (admin UI)

The admin UI at `/cms` uses JWT-based sessions. Sessions are created by logging in at `/cms` with an admin username and password.

### Required environment variables

You must set all three of the following for the admin UI to work:

| Variable | Description |
|----------|-------------|
| `ASTRO_BLOCKS_JWT_SECRET` | Secret used to sign and verify JWT session tokens. Use a long random string (32+ characters). |
| `ASTRO_BLOCKS_ADMIN_USER` | Email address for the initial admin account. |
| `ASTRO_BLOCKS_ADMIN_PASSWORD` | Password for the initial admin account. |

**These variables must be set in your server environment — not committed to git.** Add them to your `.env` file locally and set them as environment/runtime variables in your deployment platform.

Example `.env` (for local development only — never commit real values):

```sh
ASTRO_BLOCKS_JWT_SECRET=your-long-random-secret-here
ASTRO_BLOCKS_ADMIN_USER=admin@example.com
ASTRO_BLOCKS_ADMIN_PASSWORD=changeme
```

### JWT flow

1. User POSTs credentials to `/cms/api/[...path]` (login endpoint).
2. Server validates against `ASTRO_BLOCKS_ADMIN_USER` and `ASTRO_BLOCKS_ADMIN_PASSWORD`.
3. On success, a signed JWT is set as an `httpOnly` cookie.
4. Subsequent requests to `/cms/**` are authenticated by the cookie.
5. The JWT is signed using `ASTRO_BLOCKS_JWT_SECRET` — rotating this secret invalidates all sessions.

### Accessing the admin UI in production

Navigate to `https://yourdomain.com/cms` in a browser. Log in with the credentials set in your environment variables.

---

## Utility Functions

### `getMenu(key, locale?)` — returns menu items

Fetches menu items for a given menu selector and optional locale. Returns the menu tree from `data/menus.json`.

```ts
import { getMenu } from '@astroblocks/astro-blocks/getMenu';
import type { MenuItem } from '@astroblocks/astro-blocks/getMenu';

// In an Astro component or layout:
const navItems: MenuItem[] = await getMenu('main-nav', Astro.currentLocale);
```

`MenuItem` shape:
```ts
interface MenuItem {
  name: string;
  path: string;
  children?: MenuItem[];
}
```

If the menu selector does not exist, returns an empty array (never throws).

### `getConfig(key)` / `getConfigMap()` — config values

```ts
import { getConfig, getConfigMap } from '@astroblocks/astro-blocks/getConfig';

// Get a single value by key (case-insensitive key matching):
const mapsKey = await getConfig('GOOGLE_MAPS_API_KEY');

// Get all configs as a key/value map:
const allConfigs = await getConfigMap();
```

Returns `undefined` if the key does not exist (never throws).

### `getLanguages()` — language list

```ts
import { getLanguages } from '@astroblocks/astro-blocks/getLanguages';

const languages = await getLanguages();
// [{ code: 'en', label: 'English', enabled: true, isDefault: true }, ...]
```

### `getI18nMeta(context, options?)` — i18n metadata for `<head>`

```ts
import { getI18nMeta } from '@astroblocks/astro-blocks/getI18nMeta';
import type { I18nLayoutContext, I18nMetaResult } from '@astroblocks/astro-blocks/getI18nMeta';

// In your layout, after receiving alternates from CMS props:
const meta: I18nMetaResult = await getI18nMeta(
  { locale, defaultLocale, alternates },
  { baseUrl: 'https://yourdomain.com' }
);

// meta.htmlLang       → use as <html lang={meta.htmlLang}>
// meta.ogLocale       → use as <meta property="og:locale" content={meta.ogLocale}>
// meta.alternates     → use as <link rel="alternate" hrefLang={...} href={...}>
```

---

## i18n Routing

### Path-prefix strategy (only supported in v1)

All i18n routing uses path prefixes. For a site with `en` (default) and `es` languages:

- English page at slug `about` → served at `/about` (default locale has no prefix)
- Spanish page at slug `about` → served at `/es/about`

### How language prefixes work

The CMS generates routes for each page × locale combination. The catch-all route at `/cms/api/[...path]` handles routing internally. Your public pages are served directly by the Astro SSR adapter.

### Getting locale from request in layout

The CMS passes `locale` as a prop to your layout. Use `Astro.currentLocale` as a fallback if needed.

---

## Sitemap and robots.txt

### Auto-injected routes

The plugin injects `/sitemap.xml` and `/robots.txt` routes automatically. These return dynamically generated content based on your published pages.

### Customization is not supported

You cannot override the sitemap or robots.txt in v1. Do not create `src/pages/sitemap.xml.ts` or `src/pages/robots.txt.ts` — they will conflict with the injected routes.

---

## File Upload Behaviour

### `/uploads/[...path]` is injected by the plugin

The plugin injects a file-serving route at `/uploads/[...path]`. It serves files from `public/uploads/` in your project root.

Do NOT create `src/pages/uploads/` in your project.

### Upload storage location

Uploaded files are stored in `public/uploads/` in your project root. This directory is created automatically. Commit it to git if you want uploads to persist in your repository, or configure your deployment pipeline to persist it outside of git.

---

## Environment Variables Reference (complete list)

### Required

| Variable | Description |
|----------|-------------|
| `ASTRO_BLOCKS_JWT_SECRET` | JWT signing secret. Required for admin login to work. Minimum 32 characters recommended. |
| `ASTRO_BLOCKS_ADMIN_USER` | Admin account email address. |
| `ASTRO_BLOCKS_ADMIN_PASSWORD` | Admin account password. |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `ASTRO_BLOCKS_PROJECT_ROOT` | `process.cwd()` | Override the project root used by the plugin to read/write `data/` files. Rarely needed; used internally by tests. |

---

## Versioning and Updates

### How to get the latest AI context after upgrading

This file (`AGENTS.consumer.md`) is shipped inside the npm tarball and lives at:

```
node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md
```

It is versioned alongside the package. When you upgrade `@astroblocks/astro-blocks`, run:

```sh
npx astro-blocks init-ai
```

This command updates the reference in your `AGENTS.md` or `CLAUDE.md` so your AI assistant always reads the version-matched context file.

In reference mode (default), the command adds a Markdown link pointing to the installed file — no content is duplicated. In copy mode (`--copy`), it embeds the full content inline with a version comment.

---

## Known Limitations (v1)

- **Single-user auth**: No role-based access control yet. All authenticated users have full admin access.
- **No subdomain or domain i18n routing**: Only `path-prefix` routing strategy is supported. Subdomain and domain strategies are planned for a future release.
- **Static rendering + redirects**: When `publicRendering: 'static'`, redirect rules configured in `/cms/redirects` are not applied to public pages.
- **Cache options in static mode**: Cache configuration (`maxAge`, `swr`) has no effect when `publicRendering: 'static'`.
- **No block preview**: The CMS page builder does not render a live preview of blocks.

---

## License and Support

**License**: BUSL-1.1 (Business Source License 1.1). The package is source-available. Commercial use is subject to the terms of the license.

**GitHub issues**: [github.com/NauelG/astro-blocks/issues](https://github.com/NauelG/astro-blocks/issues)

**Changelog**: See `CHANGELOG.md` in the repository or the GitHub releases page.
