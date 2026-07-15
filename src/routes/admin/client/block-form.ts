/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * block-form.ts — public facade for the single-block field renderer.
 *
 * Pure re-export shim (the ADR-0012 pattern, cf. src/api/handlers.ts): the
 * implementation lives in ./block-form/ — mount.ts (mountBlockForm + options),
 * field-renderers.ts, field-dom-sync.ts, picker-dialog.ts, array-limits.ts,
 * file-accept.ts and field-helpers.ts. Do not add logic here.
 */

export { mountBlockForm } from './block-form/mount.js';
export type { BlockFormHandle, BlockFormOptions, FieldChangeInfo } from './block-form/mount.js';
export { checkArrayLimitReached } from './block-form/array-limits.js';
export type { ArrayLimitInfo } from './block-form/array-limits.js';
