import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema.ts';
import { schema as contentListSchema } from './src/components/ContentList.schema.ts';
import { schema as globalHeaderSchema } from './src/components/GlobalHeader.schema.ts';
import { schema as globalFooterSchema } from './src/components/GlobalFooter.schema.ts';
import { schema as mediaShowcaseSchema } from './src/components/MediaShowcase.schema.ts';
import { schema as downloadButtonSchema } from './src/components/DownloadButton.schema.ts';
import { schema as videoEmbedSchema } from './src/components/VideoEmbed.schema.ts';

export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  // Client source maps are emitted only for coverage runs (COVERAGE=true) so the
  // e2e browser-coverage bridge can map bundled admin JS back to its .ts source.
  // Off by default — keeps the normal demo build clean.
  vite: { build: { sourcemap: process.env.COVERAGE === 'true' } },
  cache: {
    provider: memoryCache(),
  },
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [
        heroSchema,
        contentListSchema,
        mediaShowcaseSchema,
        downloadButtonSchema,
        videoEmbedSchema,
      ],
      // Video is in the catalog but NOT enabled by default: the system knows how to handle it,
      // and you opt in. This is exactly what the reporter of the video/mp4 415 had configured.
      // It is the regression baseline — if this ever 415s again, it shows up here.
      allowedFileTypes: [
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/svg+xml',
        'image/gif',
        'application/pdf',
        'video/mp4',
        'application/zip',
      ],
      // The escape hatch. A registered type is ALWAYS served as application/octet-stream with
      // Content-Disposition: attachment — the consumer cannot ask for inline, which is what makes
      // registration incapable of reintroducing stored XSS. That property only exists for real once
      // the config survives the vite.define bridge, so the playground carries it and e2e asserts it.
      customFileTypes: [{ mime: 'application/zip', ext: '.zip', category: 'document' }],
      globalBlocks: [
        { slug: 'header-cta', schema: globalHeaderSchema, label: 'Header CTA' },
        { slug: 'footer-extra', schema: globalFooterSchema, label: 'Footer content' },
      ],
    }),
  ],
});
