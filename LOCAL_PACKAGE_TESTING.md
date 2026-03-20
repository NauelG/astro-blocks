<!--
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
-->

# Local Package Testing

Use this flow to validate the packaged artifact before publishing.

## 1. Build the package

```bash
npm install
npm run build
```

## 2. Create the tarball

```bash
npm run pack:local
```

This generates a file like:

```text
astroblocks-astro-blocks-<version>.tgz
```

## 3. Install it in an Astro project

```bash
npm install /absolute/path/to/astroblocks-astro-blocks-<version>.tgz
```

## 4. Validate the consumer project

Run both:

```bash
npm run dev
npm run build
```

Then check:

- the site renders CMS pages
- `/cms` loads
- `/cms/api/*` works
- `/robots.txt` works
- `/sitemap-index.xml` works

## 5. Update the installed tarball

After changing AstroBlocks again:

```bash
npm run build
npm run pack:local
npm install /absolute/path/to/new/astroblocks-astro-blocks-<version>.tgz
```

## 6. Remove the local tarball package

```bash
npm uninstall @astroblocks/astro-blocks
```
