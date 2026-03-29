/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import { loadConfigs } from '../api/data.js';
import type { ConfigEntry } from '../types/index.js';

export type { ConfigEntry } from '../types/index.js';

function normalizeConfigKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Returns the value of a config key, matching keys case-insensitively.
 * If the key does not exist, returns undefined.
 */
export async function getConfig(key: string): Promise<string | undefined> {
  const target = normalizeConfigKey(String(key || ''));
  if (!target) return undefined;

  const data = await loadConfigs();
  const entry = (data.configs || []).find((item) => normalizeConfigKey(item.key) === target);
  return entry?.value;
}

/**
 * Returns all configs as a key/value map using stored keys.
 */
export async function getConfigMap(): Promise<Record<string, string>> {
  const data = await loadConfigs();
  const map: Record<string, string> = {};

  for (const entry of (data.configs || []) as ConfigEntry[]) {
    if (!entry?.key) continue;
    map[entry.key] = typeof entry.value === 'string' ? entry.value : '';
  }

  return map;
}
