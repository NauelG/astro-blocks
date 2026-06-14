import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Media Showcase',
    icon: 'Image',
    items: {
      heroImage: { type: 'image', label: 'Hero Image' },
      galleryImage1: { type: 'image', label: 'Gallery Image 1' },
      galleryImage2: { type: 'image', label: 'Gallery Image 2' },
      caption: { type: 'string', label: 'Section Caption' },
    },
  },
  new URL('./MediaShowcase.astro', import.meta.url).href
);
