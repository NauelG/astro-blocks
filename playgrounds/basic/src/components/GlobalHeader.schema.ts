import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'GlobalHeader',
    items: {
      siteTitle: { type: 'string', label: 'Site Title', localizable: true },
      ctaLabel: { type: 'string', label: 'CTA Label', localizable: true },
      demo: { type: 'boolean', label: 'Demo' }
    },
  },
  new URL('./GlobalHeader.astro', import.meta.url).href
);
