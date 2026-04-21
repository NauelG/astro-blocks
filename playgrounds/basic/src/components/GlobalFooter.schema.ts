import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'GlobalFooter',
    items: {
      copyright: { type: 'string', label: 'Copyright', localizable: true },
      showSocials: { type: 'boolean', label: 'Show socials' },
    },
  },
  new URL('./GlobalFooter.astro', import.meta.url).href
);
