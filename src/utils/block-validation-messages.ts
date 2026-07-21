/*
Copyright (c) 2026 Nauel Gómez Gamero
Licensed under the Business Source License 1.1
*/

/**
 * block-validation-messages.ts — the single source of the English validation-message templates.
 *
 * Consumed by two places that must never disagree (#40, ADR-0034):
 *   - `utils/block-validation.ts` (isomorphic — server handlers AND the browser admin bundle) builds
 *     the backward-compat English `message` string from these templates. It imports this module
 *     rather than the admin i18n catalog, so it stays lean: importing `en.ts` would drag the whole
 *     677-key catalog into every bundle (the same layer boundary as ADR-0033).
 *   - `routes/admin/i18n/en.ts` SPREADS this module into the catalog, so these keys exist for the
 *     admin to localize.
 *
 * `as const` is LOAD-BEARING, not stylistic. Because `en.ts` spreads this object, a
 * `Record<string, string>` annotation here would erase the literal keys, collapse `keyof typeof en`
 * to `string`, and silently disable the compile-time catalog parity (`Record<CatalogKey, string>` in
 * es.ts). Do not annotate it. See ADR-0034.
 */
export const BLOCK_VALIDATION_MESSAGES = {
  'blockValidation.fieldRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" is required.',
  'blockValidation.fieldMustBeImage':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be an image object.',
  'blockValidation.fieldImageNeedsUrl':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires a valid URL.',
  'blockValidation.fieldCannotBeEmpty':
    'Block "{blockName}" (index {blockIndex}): field "{label}" cannot be empty.',
  'blockValidation.fieldAltMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — alt must be text.',
  'blockValidation.fieldCaptionMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — caption must be text.',
  'blockValidation.fieldDimInvalid':
    'Block "{blockName}" (index {blockIndex}): field "{label}" — {dim} must be a positive integer (> 0).',
  'blockValidation.fieldMustBeText':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be text.',
  'blockValidation.fieldInvalidOption':
    'Block "{blockName}" (index {blockIndex}): field "{label}" has an invalid option.',
  'blockValidation.fieldMustBeNumber':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a valid number.',
  'blockValidation.fieldMustBeBoolean':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a boolean.',
  'blockValidation.fieldMustBeFile':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be a file object.',
  'blockValidation.fieldFileNeedsUrl':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires a valid URL.',
  'blockValidation.arrayMustContainObjects':
    'Block "{blockName}" (index {blockIndex}): "{label}" must contain valid objects.',
  'blockValidation.arrayRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires at least {min} item(s).',
  'blockValidation.arrayMustBeArray':
    'Block "{blockName}" (index {blockIndex}): field "{label}" must be an array.',
  'blockValidation.arrayMinItems':
    'Block "{blockName}" (index {blockIndex}): field "{label}" requires at least {min} item(s).',
  'blockValidation.arrayMaxItems':
    'Block "{blockName}" (index {blockIndex}): field "{label}" allows at most {max} item(s).',
  'blockValidation.arrayIsRequired':
    'Block "{blockName}" (index {blockIndex}): field "{label}" is required.',
} as const;
