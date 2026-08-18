/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import type { ExportUnit } from '../types/index.js';
import {
  isValidEmail,
  isValidLanguageCode,
  isValidLanguageLabel,
} from '../utils/field-grammar.js';

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
    if (typeof u['id'] !== 'string' || u['id'] === '') {
      return { ok: false, reason: 'each user must have a non-empty string "id"' };
    }
    if (typeof u['email'] !== 'string' || u['email'] === '') {
      return { ok: false, reason: 'each user must have a non-empty string "email"' };
    }
    if (!isValidEmail(u['email'])) {
      return { ok: false, reason: `user "${u['id']}": invalid email format` };
    }
    if (typeof u['passwordHash'] !== 'string' || u['passwordHash'] === '') {
      return { ok: false, reason: 'each user must have a non-empty string "passwordHash"' };
    }
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
 * Validates the languages data file. Same grammars as the HTTP handlers
 * (utils/field-grammar.ts) — the import pipeline is not a back door past them
 * (ADR-0015, #108). Lenient about keys beyond code/label.
 */
export function validateLanguagesFile(data: unknown): ValidationResult {
  if (typeof data !== 'object' || data === null) {
    return { ok: false, reason: 'languages data must be a non-null object' };
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d['languages'])) {
    return { ok: false, reason: 'languages data must have a "languages" array' };
  }
  for (const language of d['languages'] as unknown[]) {
    if (typeof language !== 'object' || language === null) {
      return { ok: false, reason: 'each language must be an object' };
    }
    const l = language as Record<string, unknown>;
    if (typeof l['code'] !== 'string' || !isValidLanguageCode(l['code'])) {
      return { ok: false, reason: `invalid language code "${l['code']}"` };
    }
    if (l['label'] !== undefined) {
      if (typeof l['label'] !== 'string' || !isValidLanguageLabel(l['label'])) {
        return {
          ok: false,
          reason: `language "${l['code']}": invalid label (one line, max 80 characters)`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Per-file validators, consulted by validateStagedImport in addition to the
 * unit validator. The file path is the discriminator — the configuration unit
 * spans five files and its unit validator cannot know which one it is seeing.
 */
export const fileValidators: Record<string, (data: unknown) => ValidationResult> = {
  'data/languages.json': validateLanguagesFile,
};

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
