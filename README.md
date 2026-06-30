<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

<p align="center">
  <img src="img/blocks_logo.jpg" alt="AstroBlocks" width="160" />
</p>

<h1 align="center">AstroBlocks</h1>
<p align="center">
  <strong>Block-first CMS for Astro projects.</strong><br />
  Pages, menus, params, settings and a responsive media library stored in JSON, with your own Astro components as blocks.
</p>

<p align="center">
  <a href="./CHANGELOG.md"><img src="https://img.shields.io/badge/version-3.2.1-blue" alt="version" /></a>
  <img src="https://img.shields.io/badge/coverage-92.48%25-brightgreen" alt="coverage" />
  <a href="https://www.npmjs.com/package/@astroblocks/astro-blocks"><img src="https://img.shields.io/npm/v/%40astroblocks%2Fastro-blocks?logo=npm" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@astroblocks/astro-blocks"><img src="https://img.shields.io/npm/dm/%40astroblocks%2Fastro-blocks?logo=npm" alt="npm downloads" /></a>
  <img src="https://img.shields.io/badge/status-stable-brightgreen" alt="stable" />
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js" alt="Node 18+" /></a>
  <a href="https://astro.build"><img src="https://img.shields.io/badge/Astro-6+-FF5D01?logo=astro" alt="Astro 6+" /></a>
</p>

---

## Why AstroBlocks

- Edit pages in `/cms` without adding a database.
- Keep full control over the rendered HTML by using your own Astro components.
- Define blocks with a small, explicit schema contract.
- Manage media in a built-in library with responsive images, alt text and captions out of the box.
- Store content in `data/*.json` and uploads in `public/uploads/`.
- Generate `sitemap-index.xml` and `robots.txt` from the same content source.
- Keep consumer imports explicit and type-safe.

<p align="center">
  <img src="img/dashboard.jpg" alt="AstroBlocks dashboard" width="860" style="border-radius:8px" />
</p>

---

## Block Editor

The page editor is the core of AstroBlocks. It is designed as a compact block builder so content, SEO and structure can be managed from a single workflow.

- **Block-first editing:** pages are built by stacking your own Astro components as CMS blocks.
- **Compact builder UI:** block cards show the most relevant context first and keep advanced editing one step away.
- **SEO and content together:** title, slug, indexability and SEO metadata live in the same editing surface.
- **Ordering without friction:** blocks can be reordered, duplicated and removed directly from the editor.

<p align="center">
  <img src="img/page_editor.jpg" alt="AstroBlocks page editor" width="860" style="border-radius:8px" />
</p>

---

## Requirements

| Dependency | Version |
| --- | --- |
| Node.js | 18+ |
| Astro | 6+ |
| Adapter | `@astrojs/node` 10+ |

AstroBlocks defaults to **SSR public pages + Astro experimental cache**. Use `output: 'static'` plus a server adapter so `/cms`, `/cms/api`, `/robots.txt`, `/sitemap-index.xml` and CMS-managed public pages can run dynamically.

---

## Install

### From npm

```bash
npm install @astroblocks/astro-blocks
npm install @astrojs/node
```

### From a local tarball

Use this when you want to validate a locally built package:

```bash
npm install /absolute/path/to/astroblocks-astro-blocks-<version>.tgz
```

The tarball flow is documented in [LOCAL_PACKAGE_TESTING.md](./LOCAL_PACKAGE_TESTING.md).

---

## Recommended Imports

Keep imports split by responsibility:

```ts
import astroBlocks from '@astroblocks/astro-blocks';
import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';
import { getConfig } from '@astroblocks/astro-blocks/getConfig';
import { getI18nMeta } from '@astroblocks/astro-blocks/getI18nMeta';
import { getLanguages } from '@astroblocks/astro-blocks/getLanguages';
import { getMediaVariants } from '@astroblocks/astro-blocks/getMediaVariants';
import { getMenu } from '@astroblocks/astro-blocks/getMenu';
import BlockImage from '@astroblocks/astro-blocks/components/BlockImage';
```

- `@astroblocks/astro-blocks` is the Astro integration entrypoint.
- `@astroblocks/astro-blocks/contract` is the public block-schema contract.
- `@astroblocks/astro-blocks/getConfig` reads CMS parameters from `data/configs.json` at runtime.
- `@astroblocks/astro-blocks/getI18nMeta` builds `hreflang`, `html lang` and OpenGraph locale metadata from AstroBlocks i18n context.
- `@astroblocks/astro-blocks/getLanguages` reads configured content languages for locale switchers.
- `@astroblocks/astro-blocks/getMediaVariants` reads responsive image variant data from `data/media.json` with mtime caching.
- `@astroblocks/astro-blocks/getMenu` is the runtime helper for reading menu items inside your site.
- `@astroblocks/astro-blocks/components/BlockImage` renders images with automatic `<picture>`/srcset when variants are ready.

---

## Quick Start

### 1. Configure Astro

```ts
import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema.ts';

export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  experimental: {
    cache: {
      provider: memoryCache(),
    },
  },
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema],
    }),
  ],
});
```

### 2. Define a block component

```astro
---
interface Props {
  title: string;
  subtitle?: string;
}

const { title, subtitle } = Astro.props;
---

<section>
  <h1>{title}</h1>
  {subtitle && <p>{subtitle}</p>}
</section>
```

### 3. Define its schema

```ts
import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Hero',
    icon: 'Layout',
    items: {
      title: { type: 'string', label: 'Title', required: true },
      subtitle: { type: 'text', label: 'Subtitle' },
    },
  },
  new URL('./Hero.astro', import.meta.url).href
);
```

Array fields are also supported for repeatable content:

```ts
items: {
  tags: {
    type: 'array',
    label: 'Tags',
    minItems: 1,
    maxItems: 6,
    item: { type: 'string', label: 'Tag' },
  },
  faqs: {
    type: 'array',
    label: 'FAQs',
    item: {
      type: 'object',
      label: 'FAQ',
      summaryField: 'question',
      fields: {
        question: { type: 'string', label: 'Question', required: true },
        answer: { type: 'text', label: 'Answer', required: true },
      },
    },
  },
}
```

### 4. Provide a layout for CMS-rendered pages

Your layout receives these props:

| Prop | Meaning |
| --- | --- |
| `title` | Final page title |
| `description` | Final meta description |
| `canonical` | Canonical URL |
| `noindex` | Whether the page is non-indexable |
| `site` | Data from `data/site.json` |
| `seo` | Final SEO object, including absolute `image` when present |
| `i18n` | i18n context for the current page (`locale`, `defaultLocale`, `alternates`) |

Example:

```astro
---
import { getMenu } from '@astroblocks/astro-blocks/getMenu';
import { getI18nMeta } from '@astroblocks/astro-blocks/getI18nMeta';

const { title, description, canonical, noindex, seo, site, i18n } = Astro.props;
const menu = await getMenu('main');
const i18nMeta = getI18nMeta(i18n, { baseUrl: site?.baseUrl });
---

<html lang={i18nMeta?.htmlLang || 'en'}>
  <head>
    <title>{title}</title>
    {description && <meta name="description" content={description} />}
    {canonical && <link rel="canonical" href={canonical} />}
    {noindex && <meta name="robots" content={seo?.nofollow ? 'noindex, nofollow' : 'noindex'} />}
    {seo?.image && <meta property="og:image" content={seo.image} />}
    {i18nMeta?.alternates.map((entry) => (
      <link rel="alternate" hreflang={entry.hrefLang} href={entry.href} />
    ))}
    {i18nMeta?.ogLocale && <meta property="og:locale" content={i18nMeta.ogLocale} />}
    {i18nMeta?.ogLocaleAlternate.map((entry) => (
      <meta property="og:locale:alternate" content={entry} />
    ))}
  </head>
  <body>
    <nav>
      {menu.map((item) => <a href={item.path}>{item.name}</a>)}
    </nav>
    <slot />
  </body>
</html>
```

> In SSR mode (`publicRendering: 'server'`), AstroBlocks can use `Accept-Language` on `/` to redirect to a non-default enabled locale when available. Locale preference is then persisted with a cookie so users can switch language and keep their chosen locale.

---

## Data Model

AstroBlocks creates and reads these files in the **consumer project root**:

| Path | Purpose |
| --- | --- |
| `data/pages.json` | Pages, slug, status, blocks, `indexable`, SEO |
| `data/site.json` | Site name, base URL, favicon, logo, colors, default SEO |
| `data/menus.json` | Menus and nested menu items |
| `data/redirects.json` | Manual redirect rules (`from`, `to`, `301/302`, `enabled`) |
| `data/configs.json` | Global key/value parameters consumable from code (`key`, `value`, `description`) |
| `data/languages.json` | Content languages (`code`, `label`, `enabled`, `isDefault`) |
| `data/users.json` | CMS users |
| `data/media.json` | Media registry: uploaded files, dimensions, alt text, variants and status |
| `public/uploads/` | Uploaded files and responsive image variants (YYYY/MM subdirectories) |

You can version these files in your project repository if that fits your workflow.

---

## CMS Routes

| Route | Purpose |
| --- | --- |
| `/cms` | Dashboard |
| `/cms/pages` | Pages |
| `/cms/media` | Media library (upload, browse, pick, delete) |
| `/cms/redirects` | Redirect rules |
| `/cms/configs` | Global parameters |
| `/cms/menus` | Menus |
| `/cms/settings` | Site settings |
| `/cms/users` | Users |
| `/cms/languages` | Content languages |
| `/cms/cache` | Invalidate AstroBlocks cache |

API routes are available under `/cms/api/*`.

---

## Media Library and Responsive Images

> For the full guide — editor workflow, the `ImageFieldValue`/`MediaEntry` shapes, the API endpoints, and limitations — see [docs/media.md](./docs/media.md).

### Upload and Library

The media library lives at `/cms/media`. From there you can:

- **Upload images** — drag-and-drop or click to select. Accepts JPEG, PNG, WebP, SVG, GIF up to 5 MB.
- **Edit alt text** inline — alt text is stored alongside each file and used as the default when the image is picked in a block.
- **Browse and pick** — use the image field picker in the page editor to select an uploaded asset. Dimensions are captured at upload time and stored in the registry.
- **Delete** — removes the original file, all responsive variants, and the registry entry.

Uploaded files live under `public/uploads/YYYY/MM/` in your project root. The registry is kept in `data/media.json`.

### Responsive Images (Automatic Variant Generation)

When a raster image (JPEG, PNG, WebP) is uploaded, AstroBlocks automatically generates WebP and AVIF variants at these breakpoints — but **only when the breakpoint is strictly less than the original width** (no upscaling):

| Breakpoint | Generated |
| --- | --- |
| 480 px | Always when original > 480 |
| 800 px | When original > 800 |
| 1200 px | When original > 1200 |
| 1920 px | When original > 1920 |

Variant generation is **asynchronous**: the upload response returns immediately with `status:'processing'`. The status transitions to `'ready'` when all variants are written, or to `'failed'` on any sharp error. The original is **always retained** and served as the `<img>` fallback regardless of outcome.

SVG files receive `status:'ready'` with no variants — they are served as a plain `<img>` (no rasterization).

> **Serverless caveat:** variant generation runs in-process after the upload response. On serverless targets the process may freeze before generation completes. `@astrojs/node` standalone is the supported deployment target for responsive image generation.

### `<BlockImage>` Component

`BlockImage` is the recommended way to render images from block props. It automatically serves a `<picture>` element with avif + webp sources when variants are ready, and falls back to a plain `<img>` otherwise — with no change required in your block components.

```astro
---
import BlockImage from '@astroblocks/astro-blocks/components/BlockImage';
---

<!-- Default: lazy loading, 100vw sizing -->
<BlockImage image={block.props.image} />

<!-- Hero/LCP image: eager loading + fetchpriority=high -->
<BlockImage image={block.props.heroImage} priority={true} />

<!-- Custom sizes for a grid layout -->
<BlockImage
  image={block.props.galleryImage}
  sizes="(max-width: 640px) 100vw, 50vw"
/>
```

**Props:**

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `image` | `ImageFieldValue \| string` | required | Image value from a block prop or a legacy URL string |
| `sizes` | `string` | `'100vw'` | Value for the `sizes` attribute on `<source>` elements |
| `priority` | `boolean` | `false` | When `true`: `loading="eager"` + `fetchpriority="high"`. Use for LCP images |

When `status:'ready'` and variants exist, `BlockImage` emits:

```html
<picture>
  <source type="image/avif" srcset="…-480.avif 480w, …-800.avif 800w" sizes="100vw" />
  <source type="image/webp" srcset="…-480.webp 480w, …-800.webp 800w" sizes="100vw" />
  <img src="/uploads/2026/06/original.jpg" alt="…" width="1920" height="1080" loading="lazy" decoding="async" />
</picture>
```

When `status` is `'processing'`, `'failed'`, or the entry is legacy/SVG, it emits a plain `<img>` — so the page is never broken.

The `alt` attribute is **always** present, even when empty (`alt=""`), following WCAG 1.1.1.

### `getMediaVariants` Helper

For advanced use cases where you need to read variant data directly:

```ts
import { getMediaVariants } from '@astroblocks/astro-blocks/getMediaVariants';

const mv = await getMediaVariants('/uploads/2026/06/my-image.jpg');
// mv.status   → 'ready' | 'processing' | 'failed' | 'none'
// mv.variants → [{ format: 'webp', width: 480, url: '…' }, …]
// mv.width    → original width (when captured)
// mv.height   → original height (when captured)
// mv.alt      → default alt text from the registry
```

The helper reads `data/media.json` with an mtime-keyed in-memory cache, so repeated calls within a render cycle do not re-read disk. It returns `{ status: 'none', variants: [] }` gracefully when the registry is missing (SSG build safety) — never throws.

---

## Menus In Your Site

```astro
---
import { getMenu } from '@astroblocks/astro-blocks/getMenu';

const mainMenu = await getMenu('main', { locale: 'es' });
---

<nav>
  {mainMenu.map((item) => (
    <a href={item.path}>{item.name}</a>
  ))}
</nav>
```

Returned menu items have this shape:

```ts
type MenuItem = {
  name: string;
  path: string;
  children?: MenuItem[];
};
```

---

## Languages In Your Site

```astro
---
import { getLanguages } from '@astroblocks/astro-blocks/getLanguages';

const { languages, defaultLocale } = await getLanguages();
---

<nav>
  {languages.map((language) => (
    <a href={language.code === defaultLocale ? '/' : `/${language.code}`}>
      {language.label}
    </a>
  ))}
</nav>
```

---

## Config Parameters In Your Site

```astro
---
import { getConfig, getConfigMap } from '@astroblocks/astro-blocks/getConfig';

const mapsKey = await getConfig('GOOGLE_MAPS_API_KEY');
const allConfigs = await getConfigMap();
---
```

- `getConfig(key)` matches keys case-insensitively and returns `string | undefined`.
- `getConfigMap()` returns every configured key/value pair as an object.
- In SSR mode, updates from `/cms/configs` are available after save + cache invalidation.
- In `publicRendering: 'static'`, values are fixed at build time until the next rebuild.

---

## Plugin Options

| Option | Description |
| --- | --- |
| `layoutPath` | Path to the Astro layout used when AstroBlocks renders a page |
| `blocks` | Array of block schemas imported from your `.schema.ts` files |
| `publicRendering` | `'server'` by default. Use `'static'` to opt back into prerendered public pages |
| `cache` | Cache behavior for SSR public pages. Enabled by default when the consumer configures an Astro cache provider |
| `i18n.routingStrategy` | Public routing contract for localized paths (`'path-prefix'` in this version) |

### Cache Provider

AstroBlocks does **not** configure Astro's cache provider for you. The consumer project must opt into Astro's experimental cache explicitly:

```ts
import { defineConfig, memoryCache } from 'astro/config';

export default defineConfig({
  experimental: {
    cache: {
      provider: memoryCache(),
    },
  },
});
```

Without a provider, AstroBlocks will keep serving pages in SSR mode, but caching and invalidation will be inactive.

### Static Opt-Out

If you want the public site to stay prerendered:

```ts
astroBlocks({
  layoutPath: './src/layouts/Layout.astro',
  blocks: [heroSchema],
  publicRendering: 'static',
});
```

> Redirect rules are SSR-only in this MVP. When `publicRendering: 'static'`, redirects configured in `/cms/redirects` are not applied.

---

## Using with AI Tools

`@astroblocks/astro-blocks` ships a consumer-facing AI context file (`AGENTS.consumer.md`) inside the npm tarball. AI coding assistants (Claude, Copilot, Cursor, Windsurf, etc.) can read this file to understand the integration API, block development patterns, admin routes, and environment variables without you having to explain them manually.

**One-line setup:**

```sh
npx astro-blocks init-ai
```

This command detects your project's `AGENTS.md` or `CLAUDE.md` (creating `AGENTS.md` if neither exists) and appends a reference to the consumer context file. The reference points to the installed package:

```
node_modules/@astroblocks/astro-blocks/AGENTS.consumer.md
```

The context file is **auto-versioned with the installed package** — when you upgrade `@astroblocks/astro-blocks`, re-run `npx astro-blocks init-ai` to refresh the reference.

Use `--copy` to embed the full content inline instead of a reference link:

```sh
npx astro-blocks init-ai --copy
```

---

## Consumer Troubleshooting

### Content changes do not appear on the public site

CMS-managed public pages are served in SSR by default. If changes do not appear:

- make sure the page is `published`
- make sure your project is using the AstroBlocks catch-all route and not a conflicting file in `src/pages/`
- make sure your server adapter is configured correctly
- make sure Astro experimental cache is configured if you expect cache invalidation to work

In development, Astro exposes the cache API but does not cache real responses. Validate cache behavior in a built project or preview-like environment.

`Regenerate site` runs a fresh build artifact, but it is not required to see content changes during development.

### The CMS routes do not work

Check all of these:

- you are using Astro 6+
- you have a server adapter configured
- `output: 'static'` is enabled
- the integration is included in `astro.config.*`

### My home page is not coming from the CMS

If your project already has `src/pages/index.astro`, Astro may serve that file instead of the CMS home page.

### The layout receives a relative SEO image

AstroBlocks already converts relative `seo.image` values to absolute URLs before passing them to your layout. Use `seo.image` directly for `og:image` and `twitter:image`.

### I want to validate a local build before publishing

Use the tarball flow documented in [LOCAL_PACKAGE_TESTING.md](./LOCAL_PACKAGE_TESTING.md).

---

## For Maintainers

This README is intentionally consumer-focused.

If you are working on AstroBlocks itself, use:

- [DEVELOPING.md](./DEVELOPING.md) for build, workspace, playground and release workflow
- [AGENTS.md](./AGENTS.md) for repository-specific implementation rules
