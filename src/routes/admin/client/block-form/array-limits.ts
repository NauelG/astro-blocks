/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * array-limits.ts — min/max boundary logic for array-type block props.
 */

/** Info passed to onArrayLimitReached when an add/delete hits a min/max boundary. */
export interface ArrayLimitInfo {
  prop: string;
  limit: 'min' | 'max';
  value: number;
}

/**
 * Pure helper: given the current array length and its PropDef, returns limit info if the
 * array is AT or BEYOND a min/max boundary, or null if no limit applies.
 *
 * Used internally by the add/delete handlers and exported so tests can verify the logic.
 *
 * Convention:
 *   - "max" → currentLength >= maxItems (cannot add)
 *   - "min" → currentLength <= minItems (cannot delete)
 */
export function checkArrayLimitReached(
  currentLength: number,
  def: { maxItems?: number; minItems?: number },
): { limit: 'min' | 'max'; value: number } | null {
  const maxItems = typeof def.maxItems === 'number' ? def.maxItems : null;
  const minItems = typeof def.minItems === 'number' ? def.minItems : null;
  if (maxItems !== null && currentLength >= maxItems) return { limit: 'max', value: maxItems };
  if (minItems !== null && currentLength <= minItems) return { limit: 'min', value: minItems };
  return null;
}
