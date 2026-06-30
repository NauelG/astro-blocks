import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema.ts';
import { schema as contentListSchema } from './src/components/ContentList.schema.ts';
import { schema as globalHeaderSchema } from './src/components/GlobalHeader.schema.ts';
import { schema as globalFooterSchema } from './src/components/GlobalFooter.schema.ts';
import { schema as mediaShowcaseSchema } from './src/components/MediaShowcase.schema.ts';
import { schema as downloadButtonSchema } from './src/components/DownloadButton.schema.ts';

export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),
  // Client source maps are emitted only for coverage runs (COVERAGE=true) so the
  // e2e browser-coverage bridge can map bundled admin JS back to its .ts source.
  // Off by default — keeps the normal demo build clean.
  vite: { build: { sourcemap: process.env.COVERAGE === 'true' } },
  experimental: {
    cache: {
      provider: memoryCache(),
    },
  },
  integrations: [
    astroBlocks({
      layoutPath: './src/layouts/Layout.astro',
      blocks: [heroSchema, contentListSchema, mediaShowcaseSchema, downloadButtonSchema],
      globalBlocks: [
        { slug: 'header-cta', schema: globalHeaderSchema, label: 'Header CTA' },
        { slug: 'footer-extra', schema: globalFooterSchema, label: 'Footer content' },
      ],
    }),
  ],
});
