/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ExportUnit } from '../types/index.js';

type ValidationResult = { ok: boolean; reason?: string };

const VALID_ROLES = new Set(['owner', 'user']);

/**
 * Validates the users unit data structure.
 * Enforces role in { 'owner', 'user' } per types/index.ts:200.
 */
export function validateUsersUnit(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'users data must be a non-null object' };
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d['users'])) {
    return { ok: false, reason: 'users data must have a "users" array' };
  }
  for (const user of d['users'] as unknown[]) {
    if (typeof user !== 'object' || user === null) {
      return { ok: false, reason: 'each user must be an object' };
    }
    const u = user as Record<string, unknown>;
    if (!VALID_ROLES.has(u['role'] as string)) {
      return {
        ok: false,
        reason: `invalid role "${u['role']}" — must be "owner" or "user"`,
      };
    }
  }
  return { ok: true };
}

/**
 * Validates the pages unit data structure (lenient — top-key shape only).
 */
export function validatePagesUnit(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'pages data must be a non-null object' };
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d['pages'])) {
    return { ok: false, reason: 'pages data must have a "pages" array' };
  }
  return { ok: true };
}

/**
 * Validates the media unit data structure.
 */
export function validateMediaUnit(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'media data must be a non-null object' };
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d['uploads'])) {
    return { ok: false, reason: 'media data must have an "uploads" array' };
  }
  return { ok: true };
}

/**
 * Validates the configuration unit data structure.
 * Configuration covers site, configs, menus, redirects, languages — validated individually.
 * At the unit level we only validate by checking each known top-level shape.
 */
export function validateConfigurationUnit(data: unknown): ValidationResult {
  // Configuration is an object containing one or more of the individual data objects.
  // We accept any non-null object at this level (each file is validated separately on import).
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'configuration data must be a non-null object' };
  }
  return { ok: true };
}

/**
 * Validates the global-blocks unit data structure.
 */
export function validateGlobalBlocksUnit(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'global-blocks data must be a non-null object' };
  }
  const d = data as Record<string, unknown>;
  if (typeof d['globalBlocks'] !== 'object' || d['globalBlocks'] === null) {
    // Also accept { blocks: [] } shape as mentioned in spec
    if (!Array.isArray(d['blocks'])) {
      return {
        ok: false,
        reason: 'global-blocks data must have a "globalBlocks" object or "blocks" array',
      };
    }
  }
  return { ok: true };
}

/**
 * Unified validator map keyed by ExportUnit.
 */
export const unitValidators: Record<ExportUnit, (data: unknown) => ValidationResult> = {
  pages: validatePagesUnit,
  media: validateMediaUnit,
  users: validateUsersUnit,
  configuration: validateConfigurationUnit,
  'global-blocks': validateGlobalBlocksUnit,
};
