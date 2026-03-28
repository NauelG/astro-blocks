import { defineConfig, memoryCache } from 'astro/config';
import node from '@astrojs/node';
import astroBlocks from '@astroblocks/astro-blocks';
import { schema as heroSchema } from './src/components/Hero.schema.ts';
import { schema as contentListSchema } from './src/components/ContentList.schema.ts';

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
    }),
  ],
});
