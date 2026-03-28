/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

export const schema = defineBlockSchema(
  {
    name: 'Content List',
    icon: 'List',
    items: {
      heading: { type: 'string', label: 'Heading', localizable: true },
      tags: {
        type: 'array',
        label: 'Tags',
        localizable: true,
        minItems: 1,
        maxItems: 6,
        item: {
          type: 'string',
          label: 'Tag',
          required: true,
        },
      },
      faqs: {
        type: 'array',
        label: 'FAQs',
        localizable: true,
        item: {
          type: 'object',
          label: 'FAQ',
          summaryField: 'question',
          fields: {
            question: { type: 'string', label: 'Question', required: true },
            answer: { type: 'text', label: 'Answer', required: true },
          },
        },
      },
    },
  },
  new URL('./ContentList.astro', import.meta.url).href
);
