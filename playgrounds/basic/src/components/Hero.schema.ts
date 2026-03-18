import { defineBlockSchema } from 'astro-blocks/contract';

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
