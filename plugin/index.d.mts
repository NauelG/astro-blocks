/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { AstroIntegration } from 'astro';
import type { BlockSchema } from '../contract/index.js';

export interface AstroBlocksOptions {
  /** Path to the project layout (e.g. './src/layouts/Layout.astro'). */
  layoutPath?: string;
  /** Array of block schemas. Each schema must be imported from its component (export const schema = defineBlockSchema(..., import.meta.url)). */
  blocks: BlockSchema[];
}

declare const astroBlocks: (options?: AstroBlocksOptions) => AstroIntegration;

export default astroBlocks;
