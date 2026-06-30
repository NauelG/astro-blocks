import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Download Button',
    icon: 'FileDown',
    items: {
      file: {
        type: 'file',
        label: 'PDF File',
        accept: ['application/pdf'],
        download: true,
      },
      label: { type: 'string', label: 'Button Label' },
    },
  },
  new URL('./DownloadButton.astro', import.meta.url).href
);
