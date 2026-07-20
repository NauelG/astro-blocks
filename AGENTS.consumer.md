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

Node.js >= 22.12.0 is required. This floor is copied from Astro 7's own `engines` — Astro 7 refuses to start on Node 22.0–22.11, so declaring anything lower would be a guarantee the package cannot honour.

### Required Astro version (peerDependency)

Astro 7.0 or higher is required (`peerDependencies: astro ^7.0.0`). The integration registers Astro hooks via `astro:config:setup`. Exactly one Astro major is supported at a time — there is no compatibility branch for Astro 6, so AstroBlocks 3.x is the last line that supports it (ADR-0029).

Route caching is configured by **you**, at top-level `cache.provider`; it moved out of `experimental` when Astro 7 graduated the feature. AstroBlocks reads that value only to warn when `publicRendering: "server"` is combined with caching enabled and no provider — it never installs one.

### Required Astro adapter (SSR mode)

AstroBlocks runs in SSR mode by default. You must configure an Astro SSR adapter (`@astrojs/node`, `@astrojs/vercel`, etc.) in your `astro.config.mjs`. The only exception is if you set `publicRendering: 'static'` for all public pages — but admin routes still require SSR, so an adapter is always required.

The integration enforces this: if no adapter is configured, `astro build` fails fast with an actionable `[astro-blocks]` error instead of a cryptic Astro error. Under `astro dev` it logs a warning (dev renders on demand without an adapter) so the local workflow keeps working while still surfacing the problem.

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

### `allowedFileTypes`

Which file types the media upload endpoint accepts.

```ts
allowedFileTypes?: string[]
// default: ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif', 'application/pdf']
```

**This SELECTS from a catalog; it does not invent types.** AstroBlocks derives the stored file
extension from the validated MIME type (a security requirement — an SVG uploaded as `foo.jpg` and
served inline is stored XSS), so it can only accept types it has a catalog row for.

The catalog:

| MIME | Stored as | Category | Enabled by default |
|---|---|---|---|
| `image/jpeg` | `.jpg` | image | ✅ |
| `image/png` | `.png` | image | ✅ |
| `image/webp` | `.webp` | image | ✅ |
| `image/gif` | `.gif` | image | ✅ |
| `image/svg+xml` | `.svg` | image | ✅ (served as a download) |
| `image/avif` | `.avif` | image | — |
| `application/pdf` | `.pdf` | document | ✅ |
| `video/mp4` | `.mp4` | video | — |
| `video/webm` | `.webm` | video | — |
| `audio/mpeg` | `.mp3` | audio | — |

**A MIME type with no catalog row fails the build**, naming it and listing what is supported. It is
never silently ignored.

Video and audio are in the catalog and **off by default**. To enable video:

```ts
allowedFileTypes: [
  'image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif',
  'application/pdf',
  'video/mp4',
]
```

Once enabled, video and audio uploads are streamed to disk rather than buffered, and served with
HTTP Range support so the browser can seek (Safari refuses to play a media source that does not
answer a ranged request). They are **passthrough**: no dimensions, duration, poster frame or
transcoding.

A hard security denylist (HTML, JavaScript, executables, shell scripts) is **always enforced** and
cannot be re-enabled by any setting.

### `customFileTypes`

Registers a file type the catalog does not cover.

```ts
customFileTypes?: Array<{ mime: string; ext: string; category: 'image' | 'video' | 'audio' | 'document' }>
// default: []
```

```ts
astroBlocks({
  customFileTypes: [{ mime: 'application/zip', ext: '.zip', category: 'document' }],
  allowedFileTypes: [...defaults, 'application/zip'],
})
```

You supply the MIME, the extension and the category — **and nothing else**. Every registered type is
served as `application/octet-stream` with `Content-Disposition: attachment`, always. You cannot make
one render inline, and that is deliberate: a format AstroBlocks has never audited must not be able to
execute in the CMS's own origin.

The build fails if a registration is on the security denylist, shadows a builtin's MIME, or **borrows
a builtin's extension** (files are served by extension, so it would be served under the builtin's
rules).

### `maxUploadBytes`

Per-category upload ceiling, in bytes.

```ts
maxUploadBytes?: Partial<Record<'image' | 'video' | 'audio' | 'document', number>>
// defaults: image 5 MB, document 10 MB, audio 20 MB, video 200 MB
```

There is also an `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` **environment variable**: a single global limit
applied to every category, read at runtime, so it takes effect **without a rebuild** — the only
upload knob that does.

**Most specific wins:**

```
limit(category) = maxUploadBytes[category]          // build-time, per category
               ?? ASTRO_BLOCKS_MAX_UPLOAD_BYTES     // runtime, global
               ?? the built-in default for that category
```

Set neither and images stay at 5 MB while video gets 200 MB. Set only the environment variable and
that one number applies to everything.

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
| `image` | Image with upload | Returns an `ImageFieldValue` object (`{ url, alt?, caption?, width?, height? }`); legacy bare strings are coerced. Render with `<BlockImage>` |
| `link` | URL or path | Text input for href values |
| `select` | Dropdown selection | Requires `options: string[]` |
| `file` | Non-image file upload (PDF, video, audio, …) | Returns a `FileFieldValue` object (`{ url, filename?, mimeType?, download? }`). Optional `accept?: string[]` (MIME subset of `allowedFileTypes`) and `download?: boolean` meta. Use `fileDownloadUrl(value)` for server-enforced download — **omit it for video/audio**, or the browser downloads the file instead of playing it. Import helpers from `./getFileValue` |
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

### `./components/BlockImage` — render an image field value

```astro
---
import BlockImage from '@astroblocks/astro-blocks/components/BlockImage';
import type { ImageFieldValue } from '@astroblocks/astro-blocks/contract';

const { heroImage } = Astro.props; // heroImage: ImageFieldValue
---

<BlockImage image={heroImage} class="hero" loading="lazy" />
```

Renders an image from an `ImageFieldValue` (or a legacy string URL, which is coerced automatically). Always emits the `alt` attribute — WCAG 1.1.1 compliant. Omits `width` and `height` when absent. Accepts any additional HTML `img` attributes as spread props.

When responsive variants are available (`status:'ready'`), `BlockImage` automatically emits a `<picture>` element with avif + webp `<source>` elements and a fallback `<img>`. Props:

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `image` | `ImageFieldValue \| string` | required | Image field value or legacy URL |
| `sizes` | `string` | `'100vw'` | Value for `sizes` on `<source>` elements |
| `priority` | `boolean` | `false` | When `true`: `loading="eager"` + `fetchpriority="high"` (use for LCP images) |

### `./getMediaVariants` — read responsive variant data

```ts
import { getMediaVariants } from '@astroblocks/astro-blocks/getMediaVariants';

const mv = await getMediaVariants('/uploads/2026/06/my-image.jpg');
// mv.status   → 'ready' | 'processing' | 'failed' | 'none'
// mv.variants → [{ format: 'webp', width: 480, url: '…' }, …]
// mv.width / mv.height / mv.alt → from the registry
```

Reads `data/media.json` with an mtime-keyed in-memory cache. Returns `{ status: 'none', variants: [] }` gracefully when the registry is missing. Never throws.

> Full media guide (editor workflow, `ImageFieldValue`/`MediaEntry` shapes, API endpoints, limitations): `docs/media.md` in the package repository.

### `./getFileValue` — file field helpers

```ts
import {
  fileDownloadUrl,
  toFileValue,
  parseFileValue,
  isEmptyFileValue,
  mediaEntryToFileValue,
  serializeFileValueAttr,
} from '@astroblocks/astro-blocks/getFileValue';
import type { FileFieldValue } from '@astroblocks/astro-blocks/contract';
```

Helpers for `file`-type block prop values (`FileFieldValue`). Use `fileDownloadUrl(value)` in your component frontmatter to resolve the URL — when `value.download === true`, it appends `?download` so the server sets `Content-Disposition: attachment`. Example:

```astro
---
import { fileDownloadUrl } from '@astroblocks/astro-blocks/getFileValue';

const { brochure } = Astro.props; // brochure: FileFieldValue
---

<a href={fileDownloadUrl(brochure)} download={brochure.download ? brochure.filename : undefined}>
  Download PDF
</a>
```

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
| `data/media.json` | Media registry: one `MediaEntry` per upload (dimensions, alt, variants, status) |
| `public/uploads/` | Uploaded files and their generated responsive variants (`YYYY/MM` subdirectories) |

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
| `/cms/import-export` | Import/export — backup and restore selected content units (owner only) |
| `/cms/api/[...path]` | Internal API used by the admin UI — do not call directly |

**These routes cannot be customized or overridden by consumers.** They are entirely managed by the plugin. If you need to customize the admin UI, file an issue — do not try to shadow these routes.

---

## Import / Export (Backup and Restore)

Available since v3.3.0. All import and export endpoints require the `owner` role (JWT with owner claim). The bootstrap endpoint is the only exception and is gated behind a hard server-side check that no users exist yet.

### Admin page

Navigate to `/cms/import-export` in the admin panel. The page allows you to:

- Select one or more content units to export (downloads a `.zip`).
- Upload a previously exported `.zip` to import and replace selected units.
- Preview the `manifest.json` inside an uploaded archive before committing.
- Confirm the destructive replace-all action explicitly.

When the **Users** unit is imported, **every session on the instance is revoked** — not just the current browser's. The importing browser is redirected to the login screen; every other logged-in user and device is signed out too, and any token issued before the import stops being accepted. This is deliberate: a restore replaces the whole user store, so it is treated as a security event rather than a data operation. Expect to log in again everywhere after importing this unit.

### Content units

| Unit | Data replaced | Notes |
|------|--------------|-------|
| Users | `data/users.json` | Includes hashed passwords. Importing replaces all accounts. |
| Pages | `data/pages.json` | All CMS-managed pages, all locales. |
| Media | `data/media.json` + `public/uploads/` | Registry file and all uploaded binaries. |
| Global Blocks | `data/global-blocks.json` | All declared global block props. |
| Configuration | `data/configs.json`, `data/menus.json`, `data/redirects.json`, `data/languages.json`, site settings | All configuration data. |

### Export endpoint

```
GET /cms/api/export?units=users,pages,media,global-blocks,configuration
```

- **Auth**: `Authorization: Bearer <owner-token>` required.
- **Response**: `application/zip` stream containing the selected unit files and a `manifest.json` with the schema version and per-file SHA-256 checksums.
- **Query param `units`**: comma-separated list of unit keys (`users`, `pages`, `media`, `global-blocks`, `configuration`). Omitting `units` exports all five units.

### Import endpoint

```
POST /cms/api/import
Content-Type: multipart/form-data
```

- **Auth**: `Authorization: Bearer <owner-token>` required.
- **Body**: multipart field `file` containing the `.zip` archive.
- **Behaviour**: validates the zip structure and SHA-256 checksums from `manifest.json`, creates a pre-replace backup snapshot in `data/_backups/<ISO-timestamp>/` (the 5 most recent snapshots are retained), then REPLACE-ALLs the selected units.
- **Response codes**:

| Code | Condition |
|------|-----------|
| `200` | Success — returns `{ ok: true, units: string[] }` |
| `400` | Invalid zip, manifest mismatch, checksum failure, or oversized payload |
| `403` | Authenticated user is not the owner |

### Bootstrap import endpoint

```
POST /cms/api/import/bootstrap
Content-Type: multipart/form-data
```

- **Auth**: none — unauthenticated. Available **only when `data/users.json` contains no user accounts**.
- **Body**: multipart field `file` containing the `.zip` archive.
- **Behaviour**: identical to the authenticated import but skips JWT verification. Intended for seeding a fresh instance from the login screen before any admin account exists.
- **Security**: the server performs a hard check that the user store is empty on every request. If any users exist, the endpoint returns `403` regardless of auth state.

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

The admin UI at `/cms` authenticates with a JWT carried in a request header, **verified against the user store on every request**. Sessions are therefore revocable, not stateless: each user record holds a session generation, and a token whose generation no longer matches is rejected. Deleting a user, changing a password, or importing the Users unit takes effect immediately on tokens already issued. The admin account is created on **first login** — there are no admin credentials to configure in the environment.

### Required environment variable

You must set one variable for the admin UI to be usable in production:

| Variable | Description |
|----------|-------------|
| `ASTRO_BLOCKS_JWT_SECRET` | Secret used to sign and verify JWT session tokens. Use a long random string (32+ characters). |

> **Security (required in production):** if `ASTRO_BLOCKS_JWT_SECRET` is not set, a production
> server **refuses to authenticate** — the login endpoint returns `503` and no session is issued.
> This is deliberate: without a configured secret the server would fall back to a public built-in
> value and anyone could forge an owner session token. In development the fallback is tolerated
> with a loud warning so you can iterate without setup. `CMS_JWT_SECRET` is accepted as a
> deprecated legacy alias and will be removed in a future release — prefer `ASTRO_BLOCKS_JWT_SECRET`.

**Set this in your server environment — not committed to git.** Add it to your `.env` file locally and set it as an environment/runtime variable in your deployment platform.

### Login throttling (and its limits)

Repeated failed logins for the same email are answered with a growing delay (a few free attempts,
then doubling to a cap of seconds). A correct password clears it. The delay is identical for emails
that do not exist, and a throttled attempt returns the same `401` as any other failure — so the
throttle never reveals which accounts are real.

**Do not treat this as the deployment's rate limit.** It is held in memory per process: lost on
restart, not shared across instances. It is keyed by **email only, never by client IP** — behind a
proxy the observed address is the proxy's, and `X-Forwarded-For` is caller-controlled, so neither is
a value this package can trust. When advising on a deployment, recommend a rate limit on
`/cms/api/auth/login` at the reverse proxy or edge; the built-in throttle exists so an instance is
not defenseless without one.

Example `.env` (for local development only — never commit real values):

```sh
ASTRO_BLOCKS_JWT_SECRET=your-long-random-secret-here
```

### Login / session flow

1. The user POSTs `{ email, password }` to the login endpoint under `/cms/api/[...path]`.
2. **First login bootstraps the owner:** if no users exist yet, the first successful POST creates
   the owner account with the submitted credentials. Subsequent logins validate the email and
   password against the stored (scrypt-hashed) account.
3. On success the server returns a signed JWT (HS256, 7-day expiry) in the JSON response body.
4. The admin client stores that token and sends it as an `Authorization: Bearer <token>` header
   (an `x-cms-token` header is also accepted) on subsequent `/cms/api/**` requests.
5. The JWT is signed with `ASTRO_BLOCKS_JWT_SECRET` — rotating this secret invalidates all sessions.

### Accessing the admin UI in production

Navigate to `https://yourdomain.com/cms` in a browser. The first person to log in creates the owner
account, so complete that initial login yourself over a trusted connection right after deploying.

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

### Required (production)

| Variable | Description |
|----------|-------------|
| `ASTRO_BLOCKS_JWT_SECRET` | JWT signing secret. **Required in production** — without it the admin login endpoint returns `503` and no session is issued. Minimum 32 characters recommended. Legacy alias: `CMS_JWT_SECRET` (deprecated). The admin account itself is created on first login; there are no admin username/password env vars. |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `ASTRO_BLOCKS_PROJECT_ROOT` | `process.cwd()` | Override the project root used by the plugin to read/write `data/` files. Rarely needed; used internally by tests. |
| `ASTRO_BLOCKS_MAX_UPLOAD_BYTES` | `5242880` (5 MB) | Maximum accepted media upload size, in bytes. Uploads larger than this are rejected. |
| `ASTRO_BLOCKS_MAX_IMPORT_FILE_BYTES` | `52428800` (50 MB) | Maximum decompressed size per individual file during import. Files exceeding this limit cause the import to be rejected. |
| `ASTRO_BLOCKS_MAX_IMPORT_TOTAL_BYTES` | `524288000` (500 MB) | Maximum total decompressed size of all files in an imported zip. Exceeded total causes the import to be rejected. |
| `ASTRO_BLOCKS_MAX_IMPORT_COMPRESSED_BYTES` | `1073741824` (1 GB) | Maximum compressed body size accepted by the import endpoints. Requests exceeding this are rejected before decompression. |

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
