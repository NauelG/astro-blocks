/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { AstroIntegration } from 'astro';

export interface AstroBlocksOptions {
  /** Path to the project layout (e.g. './src/layouts/Layout.astro'). */
  layoutPath?: string;
  /** Map of block name to component path (e.g. { hero: './src/components/Hero.astro' }). */
  components?: Record<string, string>;
}

declare const astroBlocks: (options?: AstroBlocksOptions) => AstroIntegration;

export default astroBlocks;
