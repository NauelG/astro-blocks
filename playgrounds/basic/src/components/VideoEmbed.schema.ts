import { defineBlockSchema } from '@astroblocks/astro-blocks/contract';

/**
 * VideoEmbed — the regression baseline for the video/mp4 415 incident.
 *
 * This is VERBATIM the configuration the reporter used: a `file` prop with
 * `accept: ['video/mp4']`, backed by `video/mp4` in the plugin's `allowedFileTypes`
 * (see astro.config.mjs). It returned 415 on every upload.
 *
 * If that ever regresses, it surfaces here first.
 */
export const schema = defineBlockSchema(
  {
    name: 'Video Embed',
    icon: 'Video',
    items: {
      video: {
        type: 'file',
        label: 'Video file (MP4)',
        accept: ['video/mp4'],
      },
      caption: { type: 'string', label: 'Caption' },
    },
  },
  new URL('./VideoEmbed.astro', import.meta.url).href,
);
