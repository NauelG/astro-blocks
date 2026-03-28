/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

import fs from 'node:fs/promises';
import path from 'node:path';

export const FEATURES_MANIFEST_RELATIVE_PATH = path.join('meta', 'features.json');

const ALLOWED_STATUSES = new Set(['stable', 'alpha', 'experimental']);
const ALLOWED_CATEGORIES = new Set([
  'admin',
  'editor',
  'publishing',
  'seo',
  'navigation',
  'media',
  'auth',
  'i18n',
  'runtime',
  'performance',
  'api',
]);

const SEMVER_LIKE_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const FEATURE_ID_PATTERN = /^[a-z0-9-]+$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateFeaturesManifest(manifest) {
  const errors = [];

  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['Root value must be an object.'];
  }

  if (!Number.isInteger(manifest.schemaVersion)) {
    errors.push('"schemaVersion" must be an integer.');
  } else if (manifest.schemaVersion !== 1) {
    errors.push('"schemaVersion" must be 1.');
  }

  if (!Array.isArray(manifest.features)) {
    errors.push('"features" must be an array.');
    return errors;
  }

  if (manifest.features.length === 0) {
    errors.push('"features" must contain at least one feature.');
  }

  const ids = new Set();

  manifest.features.forEach((feature, index) => {
    const prefix = `features[${index}]`;

    if (!feature || typeof feature !== 'object' || Array.isArray(feature)) {
      errors.push(`${prefix} must be an object.`);
      return;
    }

    if (!isNonEmptyString(feature.id)) {
      errors.push(`${prefix}.id must be a non-empty string.`);
    } else {
      if (!FEATURE_ID_PATTERN.test(feature.id)) {
        errors.push(`${prefix}.id must match ${FEATURE_ID_PATTERN}.`);
      }
      if (ids.has(feature.id)) {
        errors.push(`${prefix}.id "${feature.id}" is duplicated.`);
      }
      ids.add(feature.id);
    }

    if (!isNonEmptyString(feature.title)) {
      errors.push(`${prefix}.title must be a non-empty string.`);
    }

    if (!isNonEmptyString(feature.summary)) {
      errors.push(`${prefix}.summary must be a non-empty string.`);
    }

    if (!isNonEmptyString(feature.category)) {
      errors.push(`${prefix}.category must be a non-empty string.`);
    } else if (!ALLOWED_CATEGORIES.has(feature.category)) {
      errors.push(`${prefix}.category "${feature.category}" is not allowed.`);
    }

    if (!isNonEmptyString(feature.status)) {
      errors.push(`${prefix}.status must be a non-empty string.`);
    } else if (!ALLOWED_STATUSES.has(feature.status)) {
      errors.push(`${prefix}.status "${feature.status}" is not allowed.`);
    }

    if (!isNonEmptyString(feature.sinceVersion)) {
      errors.push(`${prefix}.sinceVersion must be a non-empty string.`);
    } else if (!SEMVER_LIKE_PATTERN.test(feature.sinceVersion)) {
      errors.push(`${prefix}.sinceVersion "${feature.sinceVersion}" is not semver-like.`);
    }

    if (!isNonEmptyString(feature.updatedIn)) {
      errors.push(`${prefix}.updatedIn must be a non-empty string.`);
    } else if (!SEMVER_LIKE_PATTERN.test(feature.updatedIn)) {
      errors.push(`${prefix}.updatedIn "${feature.updatedIn}" is not semver-like.`);
    }

    if (feature.docsPath !== undefined && !isNonEmptyString(feature.docsPath)) {
      errors.push(`${prefix}.docsPath must be a non-empty string when present.`);
    }
  });

  return errors;
}

export async function readAndValidateFeaturesManifest(options = {}) {
  const rootDir = options.rootDir || process.cwd();
  const manifestPath = path.join(rootDir, FEATURES_MANIFEST_RELATIVE_PATH);
  const raw = await fs.readFile(manifestPath, 'utf-8');

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${error.message}`);
  }

  const errors = validateFeaturesManifest(parsed);
  if (errors.length > 0) {
    const detail = errors.map((entry) => `- ${entry}`).join('\n');
    throw new Error(`Invalid features manifest at ${manifestPath}:\n${detail}`);
  }

  return {
    manifestPath,
    manifest: parsed,
  };
}
