import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema.ts';
import { schema as contentListSchema } from './src/components/ContentList.schema.ts';
import { schema as globalHeaderSchema } from './src/components/GlobalHeader.schema.ts';
import { schema as globalFooterSchema } from './src/components/GlobalFooter.schema.ts';

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
      blocks: [heroSchema, contentListSchema],
      globalBlocks: [
        { slug: 'header-cta', schema: globalHeaderSchema, label: 'Header CTA' },
        { slug: 'footer-extra', schema: globalFooterSchema, label: 'Footer content' },
      ],
    }),
  ],
});
